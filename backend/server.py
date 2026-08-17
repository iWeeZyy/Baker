from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Form
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
import anthropic
import os
import uuid
import logging
import hashlib
import hmac
import base64
import json
import time
import re
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional
from datetime import datetime, timezone
import bcrypt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from seed_data import RECIPES_SEED, TIPS_SEED

# ---------- Config ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
APP_NAME = "bakers-app"

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
anthropic_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

UPLOADS_DIR = ROOT_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]

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
    payload = verify_jwt(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"user_id": payload["user_id"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ---------- Storage Helpers (local disk) ----------
def _resolve_upload_path(path: str) -> Path:
    resolved = (UPLOADS_DIR / path).resolve()
    if resolved != UPLOADS_DIR.resolve() and UPLOADS_DIR.resolve() not in resolved.parents:
        raise HTTPException(400, "Invalid path")
    return resolved

def put_object(path: str, data: bytes, content_type: str) -> dict:
    dest = _resolve_upload_path(path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    dest.with_suffix(dest.suffix + ".meta").write_text(content_type)
    return {"path": path}

def get_object(path: str):
    src = _resolve_upload_path(path)
    if not src.is_file():
        raise FileNotFoundError(path)
    meta_file = src.with_suffix(src.suffix + ".meta")
    content_type = meta_file.read_text().strip() if meta_file.is_file() else "application/octet-stream"
    return src.read_bytes(), content_type

# ---------- Models ----------
class RegisterInput(BaseModel):
    email: EmailStr
    password: str
    name: str

class LoginInput(BaseModel):
    email: EmailStr
    password: str

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
    step_images: List[Optional[str]] = Field(default_factory=list)
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
    step_images: List[Optional[str]] = Field(default_factory=list)
    image_path: Optional[str] = None

class ChatMessageInput(BaseModel):
    message: str
    session_id: Optional[str] = None

class CommentInput(BaseModel):
    content: str
    parent_id: Optional[str] = None

class NoteInput(BaseModel):
    content: str

class FriendRequestInput(BaseModel):
    user_id: str

class RespondInput(BaseModel):
    accept: bool

class MessageInput(BaseModel):
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

@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user_id": user["user_id"], "email": user["email"], "name": user.get("name"), "picture": user.get("picture")}

@api_router.post("/auth/logout")
async def logout():
    # JWT is stateless: the client discards the token. Nothing to invalidate server-side.
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
async def list_recipes(category: Optional[str] = None, sort: Optional[str] = None):
    q = {}
    if category and category != "Tous":
        q["category"] = category
    cursor = db.recipes.find(q, {"_id": 0}).sort("created_at", -1)
    docs = await cursor.to_list(500)
    docs = await enrich_recipes(docs)
    if sort == "popular":
        docs.sort(key=lambda d: d.get("like_count", 0), reverse=True)
    return docs

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

# ---------- Friends ----------
def _pair(a: str, b: str):
    return sorted([a, b])

def _pair_key(a: str, b: str) -> str:
    return "|".join(sorted([a, b]))

async def _are_friends(a: str, b: str) -> bool:
    return bool(await db.friendships.find_one({"pair_key": _pair_key(a, b)}))

async def _friend_status(me: str, other: str) -> str:
    if me == other:
        return "me"
    if await _are_friends(me, other):
        return "friends"
    if await db.friend_requests.find_one({"from_user_id": me, "to_user_id": other, "status": "pending"}):
        return "pending_sent"
    if await db.friend_requests.find_one({"from_user_id": other, "to_user_id": me, "status": "pending"}):
        return "pending_received"
    return "none"

def _public_user(u: dict) -> dict:
    return {"user_id": u["user_id"], "name": u.get("name") or "Boulanger", "picture": u.get("picture")}

@api_router.get("/users/search")
async def search_users(q: str = "", user: dict = Depends(get_current_user)):
    q = (q or "").strip()
    if len(q) < 2:
        return []
    cursor = db.users.find(
        {"name": {"$regex": re.escape(q), "$options": "i"}, "user_id": {"$ne": user["user_id"]}},
        {"_id": 0, "password_hash": 0},
    ).limit(20)
    out = []
    for u in await cursor.to_list(20):
        pu = _public_user(u)
        pu["friend_status"] = await _friend_status(user["user_id"], u["user_id"])
        out.append(pu)
    return out

@api_router.get("/users/{user_id}/profile")
async def public_profile(user_id: str, user: dict = Depends(get_current_user)):
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    if not u:
        raise HTTPException(404, "Utilisateur introuvable")
    docs = await db.recipes.find({"author_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    docs = await enrich_recipes(docs)
    total_likes = sum(d.get("like_count", 0) for d in docs)
    pu = _public_user(u)
    pu["created_at"] = u.get("created_at")
    return {
        "user": pu,
        "recipes": docs,
        "recipe_count": len(docs),
        "total_likes": total_likes,
        "friend_status": await _friend_status(user["user_id"], user_id),
    }

@api_router.post("/friends/request")
async def send_friend_request(inp: FriendRequestInput, user: dict = Depends(get_current_user)):
    me = user["user_id"]
    target = inp.user_id
    if target == me:
        raise HTTPException(400, "Impossible de s'ajouter soi-même")
    if not await db.users.find_one({"user_id": target}):
        raise HTTPException(404, "Utilisateur introuvable")
    if await _are_friends(me, target):
        return {"status": "friends"}
    # If the other user already sent a pending request, accept it directly
    rev = await db.friend_requests.find_one({"from_user_id": target, "to_user_id": me, "status": "pending"})
    if rev:
        await db.friend_requests.update_one({"id": rev["id"]}, {"$set": {"status": "accepted"}})
        try:
            await db.friendships.insert_one({
                "users": _pair(me, target),
                "pair_key": _pair_key(me, target),
                "created_at": datetime.now(timezone.utc),
            })
        except DuplicateKeyError:
            pass
        return {"status": "friends"}
    existing = await db.friend_requests.find_one({"from_user_id": me, "to_user_id": target, "status": "pending"})
    if existing:
        return {"status": "pending_sent"}
    await db.friend_requests.insert_one({
        "id": str(uuid.uuid4()),
        "from_user_id": me,
        "to_user_id": target,
        "status": "pending",
        "created_at": datetime.now(timezone.utc),
    })
    return {"status": "pending_sent"}

@api_router.get("/friends/requests")
async def incoming_requests(user: dict = Depends(get_current_user)):
    reqs = await db.friend_requests.find({"to_user_id": user["user_id"], "status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(100)
    out = []
    for r in reqs:
        u = await db.users.find_one({"user_id": r["from_user_id"]}, {"_id": 0, "password_hash": 0})
        if u:
            out.append({"id": r["id"], "from_user": _public_user(u), "created_at": r["created_at"]})
    return out

@api_router.post("/friends/requests/{request_id}/respond")
async def respond_request(request_id: str, inp: RespondInput, user: dict = Depends(get_current_user)):
    req = await db.friend_requests.find_one({"id": request_id, "to_user_id": user["user_id"], "status": "pending"})
    if not req:
        raise HTTPException(404, "Demande introuvable")
    new_status = "accepted" if inp.accept else "declined"
    await db.friend_requests.update_one({"id": request_id}, {"$set": {"status": new_status}})
    if inp.accept:
        if not await _are_friends(user["user_id"], req["from_user_id"]):
            try:
                await db.friendships.insert_one({
                    "users": _pair(user["user_id"], req["from_user_id"]),
                    "pair_key": _pair_key(user["user_id"], req["from_user_id"]),
                    "created_at": datetime.now(timezone.utc),
                })
            except DuplicateKeyError:
                pass
        return {"status": "friends"}
    return {"status": "declined"}

@api_router.get("/friends")
async def list_friends(user: dict = Depends(get_current_user)):
    me = user["user_id"]
    fs = await db.friendships.find({"users": me}, {"_id": 0}).to_list(500)
    out = []
    for f in fs:
        other_id = next((x for x in f["users"] if x != me), None)
        if not other_id:
            continue
        u = await db.users.find_one({"user_id": other_id}, {"_id": 0, "password_hash": 0})
        if not u:
            continue
        pk = _pair_key(me, other_id)
        last = await db.messages.find_one({"pair": pk}, {"_id": 0}, sort=[("created_at", -1)])
        unread = await db.messages.count_documents({"pair": pk, "to_user_id": me, "read": False})
        pu = _public_user(u)
        pu["last_message"] = {"content": last["content"], "from_me": last["from_user_id"] == me, "created_at": last["created_at"]} if last else None
        pu["unread"] = unread
        out.append(pu)
    out.sort(key=lambda x: (x["last_message"]["created_at"] if x["last_message"] else datetime.min), reverse=True)
    return out

# ---------- Messages ----------
@api_router.get("/messages/{friend_id}")
async def get_messages(friend_id: str, user: dict = Depends(get_current_user)):
    me = user["user_id"]
    if not await _are_friends(me, friend_id):
        raise HTTPException(403, "Vous devez être amis pour discuter")
    pk = _pair_key(me, friend_id)
    msgs = await db.messages.find({"pair": pk}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    await db.messages.update_many({"pair": pk, "to_user_id": me, "read": False}, {"$set": {"read": True}})
    return msgs

@api_router.post("/messages/{friend_id}")
async def send_message(friend_id: str, inp: MessageInput, user: dict = Depends(get_current_user)):
    me = user["user_id"]
    if not await _are_friends(me, friend_id):
        raise HTTPException(403, "Vous devez être amis pour discuter")
    content = inp.content.strip()
    if not content:
        raise HTTPException(400, "Message vide")
    doc = {
        "id": str(uuid.uuid4()),
        "pair": _pair_key(me, friend_id),
        "from_user_id": me,
        "to_user_id": friend_id,
        "content": content,
        "read": False,
        "created_at": datetime.now(timezone.utc),
    }
    await db.messages.insert_one(doc)
    doc.pop("_id", None)
    return doc

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
CHAT_SYSTEM_PROMPT = (
    "Tu es un assistant expert boulanger français, chaleureux et précis. "
    "Tu réponds aux questions techniques sur la boulangerie, la viennoiserie et la pâtisserie : "
    "fermentation, hydratation, façonnage, cuisson, dépannage. Réponds en français, "
    "avec des conseils concrets, des températures, des temps précis. Sois concis (max 200 mots)."
)

@api_router.post("/chat")
async def chat(inp: ChatMessageInput, user: dict = Depends(get_current_user)):
    if not anthropic_client:
        raise HTTPException(503, "L'assistant IA n'est pas configuré (ANTHROPIC_API_KEY manquante)")
    session_id = inp.session_id or f"{user['user_id']}_default"

    history = await db.chat_messages.find(
        {"user_id": user["user_id"], "session_id": session_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(50)
    messages = [{"role": m["role"], "content": m["content"]} for m in history]
    messages.append({"role": "user", "content": inp.message})

    await db.chat_messages.insert_one({
        "user_id": user["user_id"],
        "session_id": session_id,
        "role": "user",
        "content": inp.message,
        "created_at": datetime.now(timezone.utc),
    })

    try:
        response = await anthropic_client.messages.create(
            model="claude-sonnet-5",
            max_tokens=800,
            system=CHAT_SYSTEM_PROMPT,
            messages=messages,
        )
    except anthropic.APIError as e:
        logger.error(f"Anthropic API error: {e}")
        raise HTTPException(502, "L'assistant IA est momentanément indisponible, réessaie dans un instant")

    resp_text = "".join(b.text for b in response.content if b.type == "text")

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
    await db.recipes.create_index("id", unique=True)
    await db.recipes.create_index("category")
    await db.favorites.create_index([("user_id", 1), ("recipe_id", 1)], unique=True)
    await db.likes.create_index([("user_id", 1), ("recipe_id", 1)], unique=True)
    await db.likes.create_index("recipe_id")
    await db.comments.create_index("recipe_id")
    await db.notes.create_index([("user_id", 1), ("recipe_id", 1)], unique=True)

    # Backfill pair_key on any friendship docs predating this field, so the
    # unique index below never fails at startup on an existing database.
    async for f in db.friendships.find({"pair_key": {"$exists": False}}, {"users": 1}):
        await db.friendships.update_one(
            {"_id": f["_id"]}, {"$set": {"pair_key": _pair_key(*f["users"])}}
        )
    await db.friendships.create_index("users")
    # Prevents a race between two concurrent accept flows from creating two
    # friendship docs for the same pair (which would show the friend twice).
    await db.friendships.create_index("pair_key", unique=True)
    await db.friend_requests.create_index([("to_user_id", 1), ("status", 1)])
    await db.friend_requests.create_index([("from_user_id", 1), ("status", 1)])
    await db.messages.create_index([("pair", 1), ("created_at", 1)])

    # Seed/sync built-in recipes: content (incl. image_url) is kept in sync with
    # RECIPES_SEED on every startup, so a fix to seed_data.py reaches the DB on
    # the next deploy without needing a manual reseed. Community-submitted
    # recipes (is_user_submitted=True) are never touched here.
    for r in RECIPES_SEED:
        await db.recipes.update_one(
            {"title": r["title"], "is_user_submitted": False},
            {
                "$set": r,
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "author_id": None,
                    "author_name": "Chef Bakers",
                    "is_user_submitted": False,
                    "created_at": datetime.now(timezone.utc),
                },
            },
            upsert=True,
        )
    logger.info(f"Synced {len(RECIPES_SEED)} built-in recipes")

    tip_count = await db.tips.count_documents({})
    if tip_count == 0:
        tips = [{"id": str(uuid.uuid4()), **t} for t in TIPS_SEED]
        await db.tips.insert_many(tips)
        logger.info(f"Seeded {len(tips)} tips")

app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
