from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Form
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import uuid
import logging
import hashlib
import hmac
import base64
import json
import time
import requests
import httpx
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional
from datetime import datetime, timedelta, timezone
import bcrypt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from seed_data import RECIPES_SEED, TIPS_SEED

# ---------- Config ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
APP_NAME = "bakers-app"

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
_storage_key: Optional[str] = None

app = FastAPI()
api_router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# ---------- Auth Helpers (JWT) ----------
def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")

def _b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * ((4 - len(data) % 4) % 4))

def sign_jwt(user_id: str) -> str:
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64url(json.dumps({
        "user_id": user_id,
        "exp": int(time.time()) + 60 * 60 * 24 * 30,
    }, separators=(",", ":")).encode())
    sig = _b64url(hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"

def verify_jwt(token: str) -> Optional[dict]:
    try:
        h, p, s = token.split(".")
        expected = _b64url(hmac.new(JWT_SECRET.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(expected, s):
            return None
        payload = json.loads(_b64url_decode(p))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None

async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization[7:]
    # Try JWT (email/password auth)
    payload = verify_jwt(token)
    if payload:
        user = await db.users.find_one({"user_id": payload["user_id"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    # Try session_token (Google auth)
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid token")
    exp = session.get("expires_at")
    if exp and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp and exp < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ---------- Storage Helpers ----------
def init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key

def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()

def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")

# ---------- Models ----------
class RegisterInput(BaseModel):
    email: EmailStr
    password: str
    name: str

class LoginInput(BaseModel):
    email: EmailStr
    password: str

class GoogleSessionInput(BaseModel):
    session_id: str

class AuthResponse(BaseModel):
    token: str
    user: dict

class Recipe(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    category: str
    difficulty: str
    time_minutes: int
    hydration: int = 0
    image_url: str = ""
    image_path: Optional[str] = None
    description: str
    ingredients: List[str]
    steps: List[str]
    author_id: Optional[str] = None
    author_name: Optional[str] = None
    is_user_submitted: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class RecipeCreateInput(BaseModel):
    title: str
    category: str
    difficulty: str
    time_minutes: int
    hydration: int = 0
    description: str
    ingredients: List[str]
    steps: List[str]
    image_path: Optional[str] = None

class ChatMessageInput(BaseModel):
    message: str
    session_id: Optional[str] = None

class CommentInput(BaseModel):
    content: str
    parent_id: Optional[str] = None

class NoteInput(BaseModel):
    content: str

# ---------- Auth Endpoints ----------
@api_router.post("/auth/register", response_model=AuthResponse)
async def register(inp: RegisterInput):
    existing = await db.users.find_one({"email": inp.email.lower()}, {"_id": 0})
    if existing:
        raise HTTPException(400, "Email déjà utilisé")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    pw_hash = bcrypt.hashpw(inp.password.encode(), bcrypt.gensalt()).decode()
    user_doc = {
        "user_id": user_id,
        "email": inp.email.lower(),
        "name": inp.name,
        "password_hash": pw_hash,
        "provider": "email",
        "picture": None,
        "created_at": datetime.now(timezone.utc),
    }
    await db.users.insert_one(user_doc)
    token = sign_jwt(user_id)
    user_doc.pop("password_hash", None)
    user_doc.pop("_id", None)
    return {"token": token, "user": {"user_id": user_id, "email": inp.email.lower(), "name": inp.name, "picture": None}}

@api_router.post("/auth/login", response_model=AuthResponse)
async def login(inp: LoginInput):
    user = await db.users.find_one({"email": inp.email.lower()}, {"_id": 0})
    if not user or not user.get("password_hash"):
        raise HTTPException(401, "Email ou mot de passe invalide")
    if not bcrypt.checkpw(inp.password.encode(), user["password_hash"].encode()):
        raise HTTPException(401, "Email ou mot de passe invalide")
    token = sign_jwt(user["user_id"])
    return {"token": token, "user": {"user_id": user["user_id"], "email": user["email"], "name": user["name"], "picture": user.get("picture")}}

@api_router.post("/auth/session", response_model=AuthResponse)
async def google_session(inp: GoogleSessionInput):
    async with httpx.AsyncClient(timeout=30) as h:
        resp = await h.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": inp.session_id},
        )
        if resp.status_code != 200:
            raise HTTPException(401, "Invalid session")
        data = resp.json()
    email = data["email"].lower()
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name"), "picture": data.get("picture")}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": data.get("name"),
            "picture": data.get("picture"),
            "provider": "google",
            "created_at": datetime.now(timezone.utc),
        })
    session_token = data["session_token"]
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })
    return {"token": session_token, "user": {"user_id": user_id, "email": email, "name": data.get("name"), "picture": data.get("picture")}}

@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user_id": user["user_id"], "email": user["email"], "name": user.get("name"), "picture": user.get("picture")}

@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}

# ---------- Recipes ----------
COUP_DE_COEUR_TOP_N = 5

async def _like_counts(recipe_ids):
    counts = {}
    if not recipe_ids:
        return counts
    pipeline = [
        {"$match": {"recipe_id": {"$in": recipe_ids}}},
        {"$group": {"_id": "$recipe_id", "c": {"$sum": 1}}},
    ]
    async for row in db.likes.aggregate(pipeline):
        counts[row["_id"]] = row["c"]
    return counts

async def _global_top_liked():
    pipeline = [
        {"$group": {"_id": "$recipe_id", "c": {"$sum": 1}}},
        {"$sort": {"c": -1}},
        {"$limit": COUP_DE_COEUR_TOP_N},
    ]
    ids = set()
    async for row in db.likes.aggregate(pipeline):
        if row["c"] > 0:
            ids.add(row["_id"])
    return ids

async def enrich_recipes(docs):
    ids = [d["id"] for d in docs]
    counts = await _like_counts(ids)
    top = await _global_top_liked()
    for d in docs:
        d["like_count"] = counts.get(d["id"], 0)
        d["coup_de_coeur"] = d["id"] in top
    return docs

@api_router.get("/recipes")
async def list_recipes(category: Optional[str] = None):
    q = {}
    if category and category != "Tous":
        q["category"] = category
    cursor = db.recipes.find(q, {"_id": 0}).sort("created_at", -1)
    docs = await cursor.to_list(500)
    return await enrich_recipes(docs)

@api_router.get("/recipes/mine")
async def my_recipes(user: dict = Depends(get_current_user)):
    cursor = db.recipes.find({"author_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    docs = await cursor.to_list(500)
    return await enrich_recipes(docs)

@api_router.get("/recipes/favorites")
async def my_favorites(user: dict = Depends(get_current_user)):
    favs = await db.favorites.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(500)
    ids = [f["recipe_id"] for f in favs]
    cursor = db.recipes.find({"id": {"$in": ids}}, {"_id": 0})
    docs = await cursor.to_list(500)
    return await enrich_recipes(docs)

@api_router.get("/recipes/{recipe_id}")
async def get_recipe(recipe_id: str):
    r = await db.recipes.find_one({"id": recipe_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Recette introuvable")
    (r,) = await enrich_recipes([r])
    return r

@api_router.post("/recipes")
async def create_recipe(inp: RecipeCreateInput, user: dict = Depends(get_current_user)):
    r = Recipe(
        **inp.dict(),
        author_id=user["user_id"],
        author_name=user.get("name"),
        is_user_submitted=True,
    )
    doc = r.dict()
    await db.recipes.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.post("/recipes/{recipe_id}/favorite")
async def toggle_favorite(recipe_id: str, user: dict = Depends(get_current_user)):
    existing = await db.favorites.find_one({"user_id": user["user_id"], "recipe_id": recipe_id})
    if existing:
        await db.favorites.delete_one({"user_id": user["user_id"], "recipe_id": recipe_id})
        return {"favorited": False}
    await db.favorites.insert_one({"user_id": user["user_id"], "recipe_id": recipe_id, "created_at": datetime.now(timezone.utc)})
    return {"favorited": True}

@api_router.get("/recipes/{recipe_id}/favorite")
async def is_favorite(recipe_id: str, user: dict = Depends(get_current_user)):
    existing = await db.favorites.find_one({"user_id": user["user_id"], "recipe_id": recipe_id})
    return {"favorited": bool(existing)}

# ---------- Likes ----------
@api_router.get("/recipes/{recipe_id}/likes")
async def get_likes(recipe_id: str, user: dict = Depends(get_current_user)):
    count = await db.likes.count_documents({"recipe_id": recipe_id})
    liked = await db.likes.find_one({"user_id": user["user_id"], "recipe_id": recipe_id})
    return {"count": count, "liked": bool(liked)}

@api_router.post("/recipes/{recipe_id}/like")
async def toggle_like(recipe_id: str, user: dict = Depends(get_current_user)):
    existing = await db.likes.find_one({"user_id": user["user_id"], "recipe_id": recipe_id})
    if existing:
        await db.likes.delete_one({"user_id": user["user_id"], "recipe_id": recipe_id})
        liked = False
    else:
        await db.likes.insert_one({"user_id": user["user_id"], "recipe_id": recipe_id, "created_at": datetime.now(timezone.utc)})
        liked = True
    count = await db.likes.count_documents({"recipe_id": recipe_id})
    return {"liked": liked, "count": count}

# ---------- Comments ----------
@api_router.get("/recipes/{recipe_id}/comments")
async def get_comments(recipe_id: str):
    cursor = db.comments.find({"recipe_id": recipe_id}, {"_id": 0}).sort("created_at", 1)
    return await cursor.to_list(500)

@api_router.post("/recipes/{recipe_id}/comments")
async def add_comment(recipe_id: str, inp: CommentInput, user: dict = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "recipe_id": recipe_id,
        "parent_id": inp.parent_id,
        "user_id": user["user_id"],
        "user_name": user.get("name") or "Boulanger",
        "user_picture": user.get("picture"),
        "content": inp.content.strip(),
        "created_at": datetime.now(timezone.utc),
    }
    await db.comments.insert_one(doc)
    doc.pop("_id", None)
    return doc

# ---------- Personal Notes ----------
@api_router.get("/recipes/{recipe_id}/note")
async def get_note(recipe_id: str, user: dict = Depends(get_current_user)):
    note = await db.notes.find_one({"user_id": user["user_id"], "recipe_id": recipe_id}, {"_id": 0})
    return {"content": note["content"] if note else ""}

@api_router.put("/recipes/{recipe_id}/note")
async def save_note(recipe_id: str, inp: NoteInput, user: dict = Depends(get_current_user)):
    await db.notes.update_one(
        {"user_id": user["user_id"], "recipe_id": recipe_id},
        {"$set": {"content": inp.content, "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"content": inp.content}

# ---------- Tips ----------
@api_router.get("/tips")
async def list_tips(category: Optional[str] = None):
    q = {}
    if category and category != "Tous":
        q["category"] = category
    cursor = db.tips.find(q, {"_id": 0})
    return await cursor.to_list(500)

# ---------- Categories ----------
@api_router.get("/categories")
async def categories():
    return {
        "recipes": ["Tous", "Pains", "Viennoiseries", "Pâtisseries"],
        "tips": ["Tous", "Fermentation", "Hydratation", "Cuisson", "Façonnage", "Dépannage"],
    }

# ---------- Image Upload ----------
@api_router.post("/upload")
async def upload_image(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ext = (file.filename or "img.jpg").split(".")[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "heic"):
        ext = "jpg"
    path = f"{APP_NAME}/uploads/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    data = await file.read()
    content_type = file.content_type or f"image/{ext}"
    await run_in_threadpool(put_object, path, data, content_type)
    return {"path": path}

@api_router.get("/files/{path:path}")
async def download_file(path: str):
    try:
        content, ctype = await run_in_threadpool(get_object, path)
    except Exception as e:
        raise HTTPException(404, f"File not found: {e}")
    return Response(content=content, media_type=ctype)

# ---------- AI Chat ----------
@api_router.post("/chat")
async def chat(inp: ChatMessageInput, user: dict = Depends(get_current_user)):
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    session_id = inp.session_id or f"{user['user_id']}_default"
    system = (
        "Tu es un assistant expert boulanger français, chaleureux et précis. "
        "Tu réponds aux questions techniques sur la boulangerie, la viennoiserie et la pâtisserie : "
        "fermentation, hydratation, façonnage, cuisson, dépannage. Réponds en français, "
        "avec des conseils concrets, des températures, des temps précis. Sois concis (max 200 mots)."
    )
    chat_client = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system,
    ).with_model("anthropic", "claude-sonnet-5")

    # Save user message
    await db.chat_messages.insert_one({
        "user_id": user["user_id"],
        "session_id": session_id,
        "role": "user",
        "content": inp.message,
        "created_at": datetime.now(timezone.utc),
    })

    resp_text = await chat_client.send_message(UserMessage(text=inp.message))

    await db.chat_messages.insert_one({
        "user_id": user["user_id"],
        "session_id": session_id,
        "role": "assistant",
        "content": resp_text,
        "created_at": datetime.now(timezone.utc),
    })

    return {"reply": resp_text, "session_id": session_id}

@api_router.get("/chat/history")
async def chat_history(user: dict = Depends(get_current_user), session_id: Optional[str] = None):
    sid = session_id or f"{user['user_id']}_default"
    cursor = db.chat_messages.find({"user_id": user["user_id"], "session_id": sid}, {"_id": 0}).sort("created_at", 1)
    return await cursor.to_list(500)

# ---------- Startup ----------
@app.on_event("startup")
async def startup():
    # Indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.recipes.create_index("id", unique=True)
    await db.recipes.create_index("category")
    await db.favorites.create_index([("user_id", 1), ("recipe_id", 1)], unique=True)
    await db.likes.create_index([("user_id", 1), ("recipe_id", 1)], unique=True)
    await db.likes.create_index("recipe_id")
    await db.comments.create_index("recipe_id")
    await db.notes.create_index([("user_id", 1), ("recipe_id", 1)], unique=True)

    # Seed recipes if empty
    count = await db.recipes.count_documents({})
    if count == 0:
        docs = []
        for r in RECIPES_SEED:
            docs.append({
                "id": str(uuid.uuid4()),
                **r,
                "author_id": None,
                "author_name": "Chef Emergent",
                "is_user_submitted": False,
                "created_at": datetime.now(timezone.utc),
            })
        await db.recipes.insert_many(docs)
        logger.info(f"Seeded {len(docs)} recipes")

    tip_count = await db.tips.count_documents({})
    if tip_count == 0:
        tips = [{"id": str(uuid.uuid4()), **t} for t in TIPS_SEED]
        await db.tips.insert_many(tips)
        logger.info(f"Seeded {len(tips)} tips")

    # Init storage
    try:
        await run_in_threadpool(init_storage)
        logger.info("Storage initialized")
    except Exception as e:
        logger.warning(f"Storage init failed: {e}")

app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
