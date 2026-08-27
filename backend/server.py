from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Form, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.encoders import jsonable_encoder
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
from collections import defaultdict
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional
from datetime import datetime, timezone
import bcrypt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from seed_data import RECIPES_SEED, TIPS_SEED, DEMO_BOTS
import production
import staff
import costing
import imaging
import moderation
from plans import resolve_plan, limits_for, production_quota, ads_config
from families import CATEGORIES, FAMILIES, FAMILY_KEYS, family_of
from tips_seed import TIP_CATEGORIES

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

# Une arborescence séparée pour les photos de message, jamais atteignable
# par la route publique /files/{path} ci-dessous (qui est ancrée sur
# UPLOADS_DIR et refuse de résoudre en dehors). Les photos de message sont
# privées : elles ne sont servies que par /messages/photos/{message_id}, qui
# vérifie l'authentification et l'appartenance à la conversation à chaque
# requête. Deux racines distinctes — pas une vérification de préfixe sur une
# racine partagée — pour qu'un bug dans cette vérification ne puisse jamais
# exposer une photo privée via la route publique.
PRIVATE_DIR = ROOT_DIR / "private_uploads"
PRIVATE_DIR.mkdir(exist_ok=True)

# Un envoi brut au-delà de cette taille est refusé avant tout traitement
# (point 12 du cahier des charges). Généreux pour une photo de téléphone ;
# ce n'est pas une limite en flux continu, juste un plafond raisonnable.
MAX_PHOTO_UPLOAD_BYTES = 12 * 1024 * 1024

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

# ---------- Storage Helpers (private — message photos only) ----------
def _resolve_private_path(path: str) -> Path:
    resolved = (PRIVATE_DIR / path).resolve()
    if resolved != PRIVATE_DIR.resolve() and PRIVATE_DIR.resolve() not in resolved.parents:
        raise HTTPException(400, "Invalid path")
    return resolved

def put_private_object(path: str, data: bytes, content_type: str) -> dict:
    dest = _resolve_private_path(path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    dest.with_suffix(dest.suffix + ".meta").write_text(content_type)
    return {"path": path}

def get_private_object(path: str):
    src = _resolve_private_path(path)
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
    # How many pieces one batch produces. Optional: when absent, production
    # planning falls back to counting batches rather than inventing a yield.
    yield_pieces: Optional[int] = None
    # Professional sheet: yield_label, prep, pointage, detente, appret, cuisson,
    # conservation, dough_temp, oven, equipment[]. Kept as one optional object
    # rather than a dozen loose fields, and absent means "not stated" — the book
    # is never guessed at.
    technical: Optional[dict] = None
    # The work this recipe was taken from, credited on the recipe screen.
    source: Optional[str] = None
    # Browsing rank between the category and the sheet ("biscuits", "tartes").
    # Assigned from families.py for the catalogue; falls back to the category's
    # catch-all for community recipes, so nothing is unreachable.
    family: Optional[str] = None
    # L'archétype visuel — la forme, pas le produit (voir products.py). Il porte
    # l'illustration de la fiche à défaut de photo. Absent quand aucun dessin de
    # la bibliothèque ne rend la forme honnêtement, et la fiche reste alors sans
    # image : un dessin approximatif montrerait autre chose que la recette.
    product: Optional[str] = None
    image_url: str = ""
    image_path: Optional[str] = None
    # Le crédit de la photo — photographe, profil, page source, licence. Les
    # API Guidelines de Pexels l'exigent dès qu'on passe par leur API, plus
    # largement que la licence elle-même. Absent quand la fiche n'a pas de
    # photo : on ne crédite que ce qu'on affiche (voir recipe_photos.py).
    image_credit: Optional[dict] = None
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
    yield_pieces: Optional[int] = None
    technical: Optional[dict] = None
    source: Optional[str] = None
    family: Optional[str] = None
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

REPORT_REASONS = {"sexual", "illegal", "violence", "harassment", "spam", "other"}

class MessageReportInput(BaseModel):
    reason: str
    note: Optional[str] = None

class ProductionLineInput(BaseModel):
    recipe_id: str
    quantity: float
    mode: str = "batches"  # "pieces" | "batches"

class ProductionInput(BaseModel):
    date: str  # YYYY-MM-DD
    target_time: Optional[str] = None  # HH:MM
    notes: str = ""
    lines: List[ProductionLineInput] = Field(default_factory=list)

class StepPatchInput(BaseModel):
    status: Optional[str] = None
    duration_minutes: Optional[int] = None

class ScheduleDayInput(BaseModel):
    off: bool = False
    start: str = ""
    end: str = ""

class ScheduleEmployeeInput(BaseModel):
    employee_id: Optional[str] = None
    name: str = ""
    days: List[Optional[ScheduleDayInput]] = Field(default_factory=list)
    overtime_minutes: int = 0

class ScheduleInput(BaseModel):
    week_start: str  # YYYY-MM-DD, the Sunday that opens the week
    notes: str = ""
    employees: List[ScheduleEmployeeInput] = Field(default_factory=list)

class RawMaterialInput(BaseModel):
    name: str
    category: Optional[str] = None
    supplier: Optional[str] = None
    purchase_price: float
    purchase_quantity: float
    purchase_unit: str  # kg | g | l | ml | cl | piece

class CostLineItemInput(BaseModel):
    label: str
    cost: float

class CostHistoryInput(BaseModel):
    recipe_id: Optional[str] = None
    recipe_title: Optional[str] = None
    ingredients: List[str] = Field(default_factory=list)
    pieces: Optional[float] = None
    packaging: List[CostLineItemInput] = Field(default_factory=list)
    other_costs: List[CostLineItemInput] = Field(default_factory=list)
    price_overrides: dict = Field(default_factory=dict)  # normalized ingredient name -> unit price
    sale_price_ht: Optional[float] = None
    vat_rate: Optional[float] = None

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
async def list_recipes(category: Optional[str] = None, family: Optional[str] = None,
                       sort: Optional[str] = None):
    q = {}
    if category and category != "Tous":
        q["category"] = category
    if family:
        q["family"] = family
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
    fields = inp.dict()
    # A client that sends no family — or an unknown one — still gets a browsable
    # recipe: the category's catch-all rather than nothing at all.
    if fields.get("family") not in FAMILY_KEYS:
        fields["family"] = family_of(fields["title"], fields["category"])
    r = Recipe(
        **fields,
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

async def _create_friendship(a: str, b: str) -> None:
    """Idempotent: the unique pair_key index makes concurrent calls safe."""
    try:
        await db.friendships.insert_one({
            "users": _pair(a, b),
            "pair_key": _pair_key(a, b),
            "created_at": datetime.now(timezone.utc),
        })
    except DuplicateKeyError:
        pass

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
    target_user = await db.users.find_one({"user_id": target}, {"_id": 0})
    if not target_user:
        raise HTTPException(404, "Utilisateur introuvable")
    if await _are_friends(me, target):
        return {"status": "friends"}
    # Demo bots accept instantly — nobody is on the other side to tap "accept",
    # and their whole purpose is to make the app testable with a single account.
    if target_user.get("is_bot"):
        await _create_friendship(me, target)
        return {"status": "friends"}
    # If the other user already sent a pending request, accept it directly
    rev = await db.friend_requests.find_one({"from_user_id": target, "to_user_id": me, "status": "pending"})
    if rev:
        await db.friend_requests.update_one({"id": rev["id"]}, {"$set": {"status": "accepted"}})
        await _create_friendship(me, target)
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
        await _create_friendship(user["user_id"], req["from_user_id"])
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

@api_router.delete("/friends/{friend_id}")
async def remove_friend(friend_id: str, user: dict = Depends(get_current_user)):
    me = user["user_id"]
    await db.friendships.delete_one({"pair_key": _pair_key(me, friend_id)})
    # Also clear any leftover request records so a future re-request starts clean.
    await db.friend_requests.delete_many({
        "$or": [
            {"from_user_id": me, "to_user_id": friend_id},
            {"from_user_id": friend_id, "to_user_id": me},
        ]
    })
    return {"status": "removed"}

# ---------- Messages ----------
MESSAGES_PAGE_SIZE = 50

@api_router.get("/messages/{friend_id}")
async def get_messages(friend_id: str, before: Optional[str] = None, user: dict = Depends(get_current_user)):
    me = user["user_id"]
    if not await _are_friends(me, friend_id):
        raise HTTPException(403, "Vous devez être amis pour discuter")
    pk = _pair_key(me, friend_id)
    q = {"pair": pk}
    if before:
        try:
            cursor_dt = datetime.fromisoformat(before.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "Paramètre 'before' invalide")
        q["created_at"] = {"$lt": cursor_dt}
    # Fetch the most recent page (newest-first), then reverse to chronological
    # order for display. This guarantees the latest messages are always
    # reachable regardless of how long the conversation history is.
    msgs = await db.messages.find(q, {"_id": 0}).sort("created_at", -1).limit(MESSAGES_PAGE_SIZE).to_list(MESSAGES_PAGE_SIZE)
    msgs.reverse()
    has_more = len(msgs) == MESSAGES_PAGE_SIZE
    if not before:
        await db.messages.update_many({"pair": pk, "to_user_id": me, "read": False}, {"$set": {"read": True}})
    return {"messages": msgs, "has_more": has_more}

async def _deliver_message(from_id: str, to_id: str, content: str, extra: Optional[dict] = None) -> dict:
    """Enregistre un message et le pousse vers les sockets actifs du destinataire.

    `extra` porte les champs propres à un message photo, en plus de ceux
    d'un message texte (type, photo_path, photo_blur_path, moderation),
    sans donner aux messages photo une collection ou un chemin de
    livraison/diffusion séparé.
    """
    doc = {
        "id": str(uuid.uuid4()),
        "pair": _pair_key(from_id, to_id),
        "from_user_id": from_id,
        "to_user_id": to_id,
        "content": content,
        "type": "text",
        "read": False,
        "created_at": datetime.now(timezone.utc),
        **(extra or {}),
    }
    await db.messages.insert_one(doc)
    doc.pop("_id", None)
    await _push_to_user(to_id, {"type": "new_message", "message": doc})
    return doc

@api_router.post("/messages/{friend_id}")
async def send_message(
    friend_id: str,
    inp: MessageInput,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    me = user["user_id"]
    if not await _are_friends(me, friend_id):
        raise HTTPException(403, "Vous devez être amis pour discuter")
    content = inp.content.strip()
    if not content:
        raise HTTPException(400, "Message vide")
    doc = await _deliver_message(me, friend_id, content)
    recipient = await db.users.find_one({"user_id": friend_id}, {"_id": 0, "password_hash": 0})
    if recipient and recipient.get("is_bot"):
        # Answered in the background so the sender's request returns immediately;
        # the reply reaches them over the WebSocket a moment later.
        background_tasks.add_task(_bot_reply, recipient, me, content)
    return doc

@api_router.post("/messages/{friend_id}/photo")
async def send_photo_message(
    friend_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Envoie une photo dans une conversation. La photo est toujours envoyée
    — une classification « sensible » change seulement la façon dont elle
    est ensuite montrée au destinataire (floutée, derrière un
    avertissement), jamais le fait qu'elle soit envoyée. Seule une
    classification « bloquée » (explicite sans ambiguïté) est refusée
    d'emblée, avant qu'un seul octet ne soit écrit en stockage.
    """
    me = user["user_id"]
    if not await _are_friends(me, friend_id):
        raise HTTPException(403, "Vous devez être amis pour discuter")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(400, "Fichier vide")
    if len(raw_bytes) > MAX_PHOTO_UPLOAD_BYTES:
        raise HTTPException(413, "Image trop volumineuse (12 Mo max)")

    try:
        display_bytes = await run_in_threadpool(imaging.prepare_display, raw_bytes)
    except Exception:
        raise HTTPException(400, "Fichier image invalide")

    # C'est l'image d'affichage (déjà redimensionnée) qui est analysée, pas
    # l'envoi brut — un payload plus léger vers le fournisseur, et rien de
    # plus grand que ce qui sera réellement affiché ne quitte jamais le
    # serveur (point 10 du cahier des charges).
    result = await run_in_threadpool(moderation.analyze, display_bytes)

    if result.level == moderation.BLOCKED:
        raise HTTPException(
            422,
            "Cette image ne peut pas être envoyée : elle a été détectée comme un contenu manifestement interdit.",
        )

    pk = _pair_key(me, friend_id)
    photo_id = uuid.uuid4().hex
    photo_path = f"{APP_NAME}/messages/{pk}/{photo_id}.jpg"
    await run_in_threadpool(put_private_object, photo_path, display_bytes, "image/jpeg")

    photo_blur_path = None
    if result.level == moderation.SENSITIVE:
        blur_bytes = await run_in_threadpool(imaging.make_blur_preview, raw_bytes)
        photo_blur_path = f"{APP_NAME}/messages/{pk}/{photo_id}_blur.jpg"
        await run_in_threadpool(put_private_object, photo_blur_path, blur_bytes, "image/jpeg")

    doc = await _deliver_message(me, friend_id, "", extra={
        "type": "photo",
        "photo_path": photo_path,
        "photo_blur_path": photo_blur_path,
        "moderation": {
            "level": result.level,
            "score": result.score,
            "provider": result.provider,
            "status": result.status,
            "checked_at": datetime.now(timezone.utc),
        },
    })
    # Pas de réponse automatique du bot à une photo — son circuit de
    # réponse est uniquement textuel (voir _bot_reply), et lui apprendre à
    # réagir à des images sort du cadre de cette fonctionnalité.
    return doc

@api_router.get("/messages/photos/{message_id}")
async def get_message_photo(message_id: str, variant: str = "display", user: dict = Depends(get_current_user)):
    """Sert une photo de message. Nécessite d'être l'une des deux parties de
    ce message précis ET d'être toujours ami avec l'autre — la même règle
    que GET /messages/{friend_id} applique déjà à l'historique texte,
    reprise telle quelle plutôt que réinventée. Deviner l'identifiant d'un
    autre message ne prouve jamais qu'une chose : qu'on n'en fait pas
    partie (403/404) ; cela ne peut jamais servir à atteindre la photo de
    quelqu'un d'autre.
    """
    me = user["user_id"]
    msg = await db.messages.find_one({"id": message_id, "type": "photo"}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "Photo introuvable")
    other = msg["to_user_id"] if msg["from_user_id"] == me else msg["from_user_id"] if msg["to_user_id"] == me else None
    if other is None:
        raise HTTPException(403, "Accès refusé")
    if not await _are_friends(me, other):
        raise HTTPException(403, "Vous devez être amis pour voir cette photo")

    if variant == "blur":
        path = msg.get("photo_blur_path")
        if not path:
            raise HTTPException(404, "Pas d'aperçu flouté pour cette photo")
    else:
        path = msg.get("photo_path")

    try:
        content, ctype = await run_in_threadpool(get_private_object, path)
    except Exception:
        raise HTTPException(404, "Fichier introuvable")
    return Response(content=content, media_type=ctype)

@api_router.post("/messages/{message_id}/report")
async def report_message(message_id: str, inp: MessageReportInput, user: dict = Depends(get_current_user)):
    me = user["user_id"]
    if inp.reason not in REPORT_REASONS:
        raise HTTPException(400, f"Motif invalide. Attendu: {', '.join(sorted(REPORT_REASONS))}")
    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "Message introuvable")
    if me not in (msg["from_user_id"], msg["to_user_id"]):
        raise HTTPException(403, "Vous ne faites pas partie de cette conversation")
    reported_user_id = msg["to_user_id"] if msg["from_user_id"] == me else msg["from_user_id"]
    doc = {
        "id": str(uuid.uuid4()),
        "message_id": message_id,
        "reporter_id": me,
        "reported_user_id": reported_user_id,
        "reason": inp.reason,
        "note": (inp.note or "").strip()[:1000] or None,
        "created_at": datetime.now(timezone.utc),
    }
    await db.reports.insert_one(doc)
    return {"status": "reported"}

# ---------- Realtime (WebSocket) ----------
ws_connections: dict = defaultdict(set)

async def _push_to_user(user_id: str, payload: dict):
    if user_id not in ws_connections:
        return
    # WebSocket.send_json uses plain json.dumps, unlike HTTP responses which
    # go through FastAPI's encoder — datetimes etc. must be pre-encoded here.
    safe_payload = jsonable_encoder(payload)
    dead = []
    for ws in ws_connections.get(user_id, ()):
        try:
            await ws.send_json(safe_payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        ws_connections[user_id].discard(ws)

@api_router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, token: str = ""):
    payload = verify_jwt(token)
    if not payload:
        await websocket.close(code=4401)
        return
    user = await db.users.find_one({"user_id": payload["user_id"]}, {"_id": 0})
    if not user:
        await websocket.close(code=4401)
        return
    user_id = user["user_id"]
    await websocket.accept()
    ws_connections[user_id].add(websocket)
    try:
        while True:
            # We don't expect meaningful client->server messages on this
            # socket (it's push-only); receiving just keeps the connection
            # alive and lets us detect disconnects promptly.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_connections[user_id].discard(websocket)
        if not ws_connections[user_id]:
            del ws_connections[user_id]

# ---------- Demo bots ----------
BOT_HISTORY_LIMIT = 20

async def _generate_bot_reply(bot: dict, human_id: str, incoming: str) -> str:
    """Ask the AI for an in-character reply, with a plain fallback.

    The fallback matters: the bot exists to prove a message got through, so it
    must answer even when the AI is unavailable (no key, no credit, API down).
    """
    fallback = (
        f"Bien reçu ton message : « {incoming[:120]} ». "
        "Je ne peux pas te répondre en détail pour le moment, mais c'est bien arrivé !"
    )
    if not anthropic_client:
        return fallback
    pk = _pair_key(bot["user_id"], human_id)
    history = await db.messages.find({"pair": pk}, {"_id": 0}).sort("created_at", -1).limit(BOT_HISTORY_LIMIT).to_list(BOT_HISTORY_LIMIT)
    history.reverse()
    messages = [
        {
            "role": "assistant" if m["from_user_id"] == bot["user_id"] else "user",
            "content": m["content"],
        }
        for m in history
    ]
    if not messages or messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": incoming})
    try:
        response = await anthropic_client.messages.create(
            model="claude-sonnet-5",
            max_tokens=300,
            system=(
                f"{bot['persona']}\n\n"
                "Tu discutes par messages privés dans une application de boulangers. "
                "Réponds en français, sur un ton naturel de conversation, en 2 phrases maximum."
            ),
            messages=messages,
        )
    except anthropic.APIError as e:
        logger.warning(f"Bot reply failed for {bot['user_id']}: {e}")
        return fallback
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    return text or fallback

async def _bot_reply(bot: dict, human_id: str, incoming: str) -> None:
    try:
        reply = await _generate_bot_reply(bot, human_id, incoming)
        await _deliver_message(bot["user_id"], human_id, reply)
    except Exception as e:
        logger.error(f"Bot reply delivery failed for {bot['user_id']}: {e}")

async def _seed_demo_bots() -> None:
    for bot in DEMO_BOTS:
        await db.users.update_one(
            {"user_id": bot["user_id"]},
            {
                "$set": {
                    "email": bot["email"],
                    "name": bot["name"],
                    "persona": bot["persona"],
                    "is_bot": True,
                },
                "$setOnInsert": {
                    "user_id": bot["user_id"],
                    # No password_hash at all: /auth/login rejects accounts
                    # without one, so these can never be logged into.
                    "provider": "bot",
                    "picture": None,
                    "created_at": datetime.now(timezone.utc),
                },
            },
            upsert=True,
        )
    logger.info(f"Synced {len(DEMO_BOTS)} demo bots")

    # Optionally pre-friend the bots with one real account, so they show up in
    # "Mes amis" without any manual step. Set DEMO_FRIENDS_EMAIL to enable.
    owner_email = os.environ.get("DEMO_FRIENDS_EMAIL", "").strip().lower()
    if not owner_email:
        return
    owner = await db.users.find_one({"email": owner_email}, {"_id": 0, "password_hash": 0})
    if not owner:
        logger.info(f"DEMO_FRIENDS_EMAIL={owner_email} not registered yet; skipping auto-friending")
        return
    for bot in DEMO_BOTS:
        await _create_friendship(owner["user_id"], bot["user_id"])
    logger.info(f"Auto-friended {len(DEMO_BOTS)} demo bots with {owner_email}")

# ---------- Production planning ----------
STEP_STATUSES = ("todo", "doing", "done")

def _validate_date(value: str) -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except (ValueError, TypeError):
        raise HTTPException(422, "Date invalide (format attendu : AAAA-MM-JJ)")
    return value

def _validate_time(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        datetime.strptime(value, "%H:%M")
    except ValueError:
        raise HTTPException(422, "Heure invalide (format attendu : HH:MM)")
    return value

async def _build_lines_and_steps(inp: ProductionInput):
    """Snapshot each recipe into the production.

    Ingredients, steps and yield are copied in rather than referenced, so a
    later edit to the recipe never silently rewrites a planning the baker has
    already organised their night around.
    """
    lines, steps = [], []
    for item in inp.lines:
        if item.quantity is None or item.quantity <= 0:
            raise HTTPException(422, "La quantité doit être supérieure à 0")
        if item.mode not in ("pieces", "batches"):
            raise HTTPException(422, "Mode invalide (attendu : pieces ou batches)")
        recipe = await db.recipes.find_one({"id": item.recipe_id}, {"_id": 0})
        if not recipe:
            raise HTTPException(404, "Recette introuvable")
        line_id = str(uuid.uuid4())
        lines.append({
            "line_id": line_id,
            "recipe_id": recipe["id"],
            "recipe_title": recipe.get("title") or "Recette",
            "mode": item.mode,
            "quantity": float(item.quantity),
            "yield_pieces": recipe.get("yield_pieces"),
            "ingredients": recipe.get("ingredients") or [],
        })
        steps.extend(production.build_steps(line_id, recipe.get("title") or "Recette", recipe.get("steps") or []))
    return lines, steps

def _carry_over_step_state(old_doc: dict, new_lines: list, new_steps: list) -> None:
    """Preserve progress across an edit.

    Steps are rebuilt from the recipes on every update, so they are matched back
    to the old ones by (recipe, position). Without this, changing a quantity
    would wipe the ticks of a baker already halfway through their morning.
    """
    old_line_recipe = {l["line_id"]: l.get("recipe_id") for l in old_doc.get("lines", [])}
    previous = {}
    for step in old_doc.get("steps", []):
        key = (old_line_recipe.get(step.get("line_id")), step.get("order"))
        previous[key] = step
    new_line_recipe = {l["line_id"]: l.get("recipe_id") for l in new_lines}
    for step in new_steps:
        old = previous.get((new_line_recipe.get(step["line_id"]), step["order"]))
        if not old:
            continue
        step["status"] = old.get("status", "todo")
        # A duration the baker typed in is theirs to keep; one read from the
        # recipe is re-derived so recipe fixes flow through.
        if old.get("duration_source") == "manual" and old.get("duration_minutes") is not None:
            step["duration_minutes"] = old["duration_minutes"]
            step["duration_source"] = "manual"

async def _productions_used_this_month(user_id: str) -> int:
    now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    return await db.productions.count_documents({"user_id": user_id, "created_at": {"$gte": start}})

async def _plan_state(user: dict) -> dict:
    plan = resolve_plan(user)
    quota = production_quota(plan)
    used = await _productions_used_this_month(user["user_id"])
    return {
        "plan": plan,
        "limits": limits_for(plan),
        "productions_used": used,
        "productions_limit": quota,
        "productions_remaining": None if quota is None else max(0, quota - used),
        # Whether this user may be shown ads at all. Decided here rather than in
        # the app so a Pro account can never be served one by a client bug.
        "ads": ads_config(plan),
    }

async def _enforce_production_quota(user: dict) -> None:
    """Server-side gate. The client is never trusted with this decision."""
    state = await _plan_state(user)
    quota = state["productions_limit"]
    if quota is None or state["productions_used"] < quota:
        return
    # A structured payload, not a bare error: it lets the app present Baker Pro
    # instead of a dead end.
    raise HTTPException(403, {
        "error": "plan_limit_reached",
        "limit": quota,
        "used": state["productions_used"],
        "period": "month",
        "message": f"Vous avez utilisé vos {quota} productions gratuites de ce mois-ci.",
    })

def _production_detail(doc: dict) -> dict:
    doc.pop("_id", None)
    computed = production.summarize(doc.get("lines"), doc.get("steps"), doc.get("date"), doc.get("target_time"))
    return {**doc, **computed}

def _production_summary(doc: dict) -> dict:
    steps = doc.get("steps") or []
    done = sum(1 for s in steps if s.get("status") == "done")
    return {
        "id": doc["id"],
        "date": doc.get("date"),
        "target_time": doc.get("target_time"),
        "notes": doc.get("notes", ""),
        "recipe_titles": [l.get("recipe_title") for l in doc.get("lines") or []],
        "line_count": len(doc.get("lines") or []),
        "steps_total": len(steps),
        "steps_done": done,
        "total_pieces": production.total_pieces([production.normalize_line(l) for l in doc.get("lines") or []]),
        "created_at": doc.get("created_at"),
    }

@api_router.get("/me/plan")
async def my_plan(user: dict = Depends(get_current_user)):
    return await _plan_state(user)

@api_router.get("/productions")
async def list_productions(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = {"user_id": user["user_id"]}
    if date_from or date_to:
        rng = {}
        if date_from:
            rng["$gte"] = _validate_date(date_from)
        if date_to:
            rng["$lte"] = _validate_date(date_to)
        q["date"] = rng
    docs = await db.productions.find(q, {"_id": 0}).sort("date", -1).to_list(500)
    return [_production_summary(d) for d in docs]

@api_router.post("/productions")
async def create_production(inp: ProductionInput, user: dict = Depends(get_current_user)):
    await _enforce_production_quota(user)
    date = _validate_date(inp.date)
    target_time = _validate_time(inp.target_time)
    lines, steps = await _build_lines_and_steps(inp)
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "date": date,
        "target_time": target_time,
        "notes": (inp.notes or "").strip(),
        "lines": lines,
        "steps": steps,
        "created_at": now,
        "updated_at": now,
    }
    await db.productions.insert_one(doc)
    return _production_detail(doc)

@api_router.get("/productions/{production_id}")
async def get_production(production_id: str, user: dict = Depends(get_current_user)):
    # Scoped by user_id: someone else's id is indistinguishable from a missing one.
    doc = await db.productions.find_one({"id": production_id, "user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Production introuvable")
    return _production_detail(doc)

@api_router.put("/productions/{production_id}")
async def update_production(production_id: str, inp: ProductionInput, user: dict = Depends(get_current_user)):
    existing = await db.productions.find_one({"id": production_id, "user_id": user["user_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Production introuvable")
    date = _validate_date(inp.date)
    target_time = _validate_time(inp.target_time)
    lines, steps = await _build_lines_and_steps(inp)
    _carry_over_step_state(existing, lines, steps)
    update = {
        "date": date,
        "target_time": target_time,
        "notes": (inp.notes or "").strip(),
        "lines": lines,
        "steps": steps,
        "updated_at": datetime.now(timezone.utc),
    }
    await db.productions.update_one({"id": production_id, "user_id": user["user_id"]}, {"$set": update})
    return _production_detail({**existing, **update})

@api_router.delete("/productions/{production_id}")
async def delete_production(production_id: str, user: dict = Depends(get_current_user)):
    res = await db.productions.delete_one({"id": production_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Production introuvable")
    return {"status": "deleted"}

@api_router.patch("/productions/{production_id}/steps/{step_id}")
async def update_production_step(
    production_id: str,
    step_id: str,
    inp: StepPatchInput,
    user: dict = Depends(get_current_user),
):
    doc = await db.productions.find_one({"id": production_id, "user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Production introuvable")
    step = next((s for s in doc.get("steps", []) if s.get("step_id") == step_id), None)
    if not step:
        raise HTTPException(404, "Étape introuvable")
    if inp.status is not None:
        if inp.status not in STEP_STATUSES:
            raise HTTPException(422, f"Statut invalide (attendu : {', '.join(STEP_STATUSES)})")
        step["status"] = inp.status
    if inp.duration_minutes is not None:
        if inp.duration_minutes < 0:
            raise HTTPException(422, "La durée ne peut pas être négative")
        step["duration_minutes"] = inp.duration_minutes
        step["duration_source"] = "manual"
    await db.productions.update_one(
        {"id": production_id, "user_id": user["user_id"]},
        {"$set": {"steps": doc["steps"], "updated_at": datetime.now(timezone.utc)}},
    )
    return _production_detail(doc)

# ---------- Staff schedules ----------
def _validate_week_start(value: str) -> str:
    """The week always opens on a Sunday, matching the printed grid."""
    try:
        d = datetime.strptime(value, "%Y-%m-%d")
    except (ValueError, TypeError):
        raise HTTPException(422, "Date invalide (format attendu : AAAA-MM-JJ)")
    # Monday is 0 in Python; Sunday is 6.
    if d.weekday() != 6:
        raise HTTPException(422, "La semaine doit commencer un dimanche")
    return value

def _build_schedule_employees(inp: ScheduleInput) -> list:
    if len(inp.employees) > staff.MAX_EMPLOYEES:
        raise HTTPException(422, f"{staff.MAX_EMPLOYEES} personnes au maximum")

    employees = []
    for item in inp.employees:
        name = (item.name or "").strip()
        if not name:
            raise HTTPException(422, "Chaque personne doit avoir un nom")
        if item.overtime_minutes < 0:
            raise HTTPException(422, "Les heures supplémentaires ne peuvent pas être négatives")

        days = [(d.model_dump() if d else None) for d in item.days][:staff.DAYS]
        days += [None] * (staff.DAYS - len(days))
        for day in days:
            # Refuse unreadable times here rather than storing a cell that would
            # silently count as zero hours in every total downstream.
            if day and not day.get("off") and (day.get("start") or day.get("end")):
                if staff.shift_minutes(day.get("start", ""), day.get("end", "")) is None:
                    raise HTTPException(422, f"Horaire invalide pour {name} (format attendu : 8:00)")

        employees.append({
            "employee_id": item.employee_id or str(uuid.uuid4()),
            "name": name,
            "days": days,
            "overtime_minutes": int(item.overtime_minutes),
        })
    return employees

def _schedule_detail(doc: dict) -> dict:
    doc.pop("_id", None)
    return {**doc, **staff.summarize(doc.get("employees"))}

def _schedule_summary(doc: dict) -> dict:
    computed = staff.summarize(doc.get("employees"))
    return {
        "id": doc["id"],
        "week_start": doc.get("week_start"),
        "notes": doc.get("notes", ""),
        "employee_count": len(doc.get("employees") or []),
        "grand_total_minutes": computed["grand_total_minutes"],
        "updated_at": doc.get("updated_at"),
    }

@api_router.get("/schedules")
async def list_schedules(user: dict = Depends(get_current_user)):
    docs = await db.schedules.find({"user_id": user["user_id"]}, {"_id": 0}).sort("week_start", -1).to_list(200)
    return [_schedule_summary(d) for d in docs]

@api_router.post("/schedules")
async def create_schedule(inp: ScheduleInput, user: dict = Depends(get_current_user)):
    week_start = _validate_week_start(inp.week_start)
    employees = _build_schedule_employees(inp)
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "week_start": week_start,
        "notes": (inp.notes or "").strip(),
        "employees": employees,
        "created_at": now,
        "updated_at": now,
    }
    await db.schedules.insert_one(doc)
    return _schedule_detail(doc)

@api_router.get("/schedules/{schedule_id}")
async def get_schedule(schedule_id: str, user: dict = Depends(get_current_user)):
    doc = await db.schedules.find_one({"id": schedule_id, "user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Emploi du temps introuvable")
    return _schedule_detail(doc)

@api_router.put("/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, inp: ScheduleInput, user: dict = Depends(get_current_user)):
    existing = await db.schedules.find_one({"id": schedule_id, "user_id": user["user_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Emploi du temps introuvable")
    update = {
        "week_start": _validate_week_start(inp.week_start),
        "notes": (inp.notes or "").strip(),
        "employees": _build_schedule_employees(inp),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.schedules.update_one({"id": schedule_id, "user_id": user["user_id"]}, {"$set": update})
    return _schedule_detail({**existing, **update})

@api_router.delete("/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str, user: dict = Depends(get_current_user)):
    res = await db.schedules.delete_one({"id": schedule_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Emploi du temps introuvable")
    return {"status": "deleted"}

@api_router.post("/schedules/{schedule_id}/duplicate")
async def duplicate_schedule(schedule_id: str, inp: dict = None, user: dict = Depends(get_current_user)):
    """Copy a week onto another one, keeping names, shifts and days off."""
    source = await db.schedules.find_one({"id": schedule_id, "user_id": user["user_id"]}, {"_id": 0})
    if not source:
        raise HTTPException(404, "Emploi du temps introuvable")

    week_start = _validate_week_start((inp or {}).get("week_start") or "")
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "week_start": week_start,
        # The note belongs to its week ("Armand off jeudi"), so it is not copied.
        "notes": "",
        "employees": [
            {**e, "employee_id": str(uuid.uuid4())}
            for e in (source.get("employees") or [])
        ],
        "created_at": now,
        "updated_at": now,
    }
    await db.schedules.insert_one(doc)
    return _schedule_detail(doc)

# ---------- Cost calculator (matières premières, coût de revient) ----------
# Prices are per baker (user_id-scoped), not global: two bakeries pay two
# different suppliers. A raw material is identified by its normalized name,
# same key as `production.normalize_name` uses for the shopping list — one
# matching rule for both features rather than two that could disagree.
def _raw_material_doc(inp: RawMaterialInput, user_id: str, existing: Optional[dict] = None) -> dict:
    name = inp.name.strip()
    if not name:
        raise HTTPException(422, "Le nom est obligatoire")
    try:
        derived = costing.derive_unit_prices(inp.purchase_price, inp.purchase_quantity, inp.purchase_unit)
    except ValueError as e:
        raise HTTPException(422, str(e))
    now = datetime.now(timezone.utc)
    doc = {
        "name": name,
        "category": (inp.category or None),
        "supplier": (inp.supplier or None),
        "purchase_price": inp.purchase_price,
        "purchase_quantity": inp.purchase_quantity,
        "purchase_unit": inp.purchase_unit,
        **derived,
        "updated_at": now,
    }
    if existing:
        return {**existing, **doc}
    doc.update({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "normalized_name": production.normalize_name(name),
        "created_at": now,
    })
    return doc

@api_router.get("/raw-materials")
async def list_raw_materials(user: dict = Depends(get_current_user)):
    return await db.raw_materials.find({"user_id": user["user_id"]}, {"_id": 0}).sort("name", 1).to_list(1000)

@api_router.post("/raw-materials")
async def upsert_raw_material(inp: RawMaterialInput, user: dict = Depends(get_current_user)):
    """Create a raw material, or update it in place if the name already exists.

    This is the "modifier facilement le prix" path: re-entering "Farine T65"
    with a new price updates the same record instead of creating a duplicate
    that the matching logic would then have to choose between.
    """
    normalized = production.normalize_name(inp.name.strip())
    existing = await db.raw_materials.find_one({"user_id": user["user_id"], "normalized_name": normalized}, {"_id": 0})
    doc = _raw_material_doc(inp, user["user_id"], existing)
    if existing:
        await db.raw_materials.update_one({"id": existing["id"]}, {"$set": doc})
    else:
        await db.raw_materials.insert_one(doc)
        doc.pop("_id", None)
    return doc

@api_router.put("/raw-materials/{material_id}")
async def update_raw_material(material_id: str, inp: RawMaterialInput, user: dict = Depends(get_current_user)):
    existing = await db.raw_materials.find_one({"id": material_id, "user_id": user["user_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Matière première introuvable")
    normalized = production.normalize_name(inp.name.strip())
    conflict = await db.raw_materials.find_one({
        "user_id": user["user_id"], "normalized_name": normalized, "id": {"$ne": material_id},
    })
    if conflict:
        raise HTTPException(409, f"« {conflict['name']} » existe déjà")
    doc = _raw_material_doc(inp, user["user_id"], existing)
    doc["normalized_name"] = normalized
    await db.raw_materials.update_one({"id": material_id}, {"$set": doc})
    return doc

@api_router.delete("/raw-materials/{material_id}")
async def delete_raw_material(material_id: str, user: dict = Depends(get_current_user)):
    res = await db.raw_materials.delete_one({"id": material_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Matière première introuvable")
    return {"status": "deleted"}

@api_router.get("/recipes/{recipe_id}/cost")
async def recipe_cost_badge(recipe_id: str, user: dict = Depends(get_current_user)):
    """The small "Coût estimé" badge on the recipe screen.

    `available` is false whenever any ingredient's price is unknown — never a
    number computed by silently skipping what's missing, which would read as
    a real cost while actually being wrong.
    """
    recipe = await db.recipes.find_one({"id": recipe_id}, {"_id": 0})
    if not recipe:
        raise HTTPException(404, "Recette introuvable")
    materials = await db.raw_materials.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(1000)
    result = costing.compute_recipe_cost(
        recipe.get("ingredients") or [], materials, [], [], recipe.get("yield_pieces"),
    )
    if result["has_missing_prices"] or result["cost_per_piece"] is None:
        return {"available": False}
    return {
        "available": True,
        "cost_per_piece": result["cost_per_piece"],
        "total_cost": result["total_cost"],
        "pieces": result["pieces"],
    }

@api_router.post("/cost/history")
async def save_cost_calculation(inp: CostHistoryInput, user: dict = Depends(get_current_user)):
    """Save a calculation as a frozen snapshot.

    Results are computed once, here, and stored as-is: a later change to a
    raw material's price must never rewrite a calculation already saved (the
    baker priced last month's croissants at last month's flour price, and
    that figure has to stay what it was).
    """
    materials = await db.raw_materials.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(1000)
    packaging = [p.dict() for p in inp.packaging]
    other_costs = [o.dict() for o in inp.other_costs]
    result = costing.compute_recipe_cost(
        inp.ingredients, materials, packaging, other_costs, inp.pieces, inp.price_overrides,
    )
    sale = costing.compute_sale_metrics(result["cost_per_piece"], inp.pieces, inp.sale_price_ht, inp.vat_rate)
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "recipe_id": inp.recipe_id,
        "recipe_title": inp.recipe_title or "Calcul libre",
        "input": inp.dict(),
        "result": result,
        "sale": sale,
        "created_at": now,
    }
    await db.cost_calculations.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.get("/cost/history")
async def list_cost_history(recipe_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"user_id": user["user_id"]}
    if recipe_id:
        q["recipe_id"] = recipe_id
    return await db.cost_calculations.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)

@api_router.get("/cost/history/{calc_id}")
async def get_cost_history_entry(calc_id: str, user: dict = Depends(get_current_user)):
    doc = await db.cost_calculations.find_one({"id": calc_id, "user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Calcul introuvable")
    return doc

@api_router.delete("/cost/history/{calc_id}")
async def delete_cost_history_entry(calc_id: str, user: dict = Depends(get_current_user)):
    res = await db.cost_calculations.delete_one({"id": calc_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Calcul introuvable")
    return {"status": "deleted"}

# ---------- Tips ----------
# The library stays small enough (a few hundred entries at most) that the app
# fetches it whole and searches client-side, the same choice already made for
# families/recipes browsing — one request, then instant local filtering
# rather than a round trip on every keystroke.
@api_router.get("/tips")
async def list_tips(category: Optional[str] = None):
    # "Toutes" is the tips chip's "no filter" label ("Tous" is the recipes
    # one) — both are accepted so a client can't silently get zero results by
    # sending the wrong one.
    q = {}
    if category and category not in ("Tous", "Toutes"):
        q["category"] = category
    cursor = db.tips.find(q, {"_id": 0})
    return await cursor.to_list(500)

@api_router.get("/tips/favorites")
async def my_tip_favorites(user: dict = Depends(get_current_user)):
    favs = await db.tip_favorites.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(500)
    ids = [f["tip_id"] for f in favs]
    return await db.tips.find({"id": {"$in": ids}}, {"_id": 0}).to_list(500)

@api_router.get("/tips/favorite-ids")
async def my_tip_favorite_ids(user: dict = Depends(get_current_user)):
    """The bare id set, for marking ⭐ on a whole list without one request per card."""
    favs = await db.tip_favorites.find({"user_id": user["user_id"]}, {"_id": 0, "tip_id": 1}).to_list(500)
    return [f["tip_id"] for f in favs]

@api_router.post("/tips/{tip_id}/favorite")
async def toggle_tip_favorite(tip_id: str, user: dict = Depends(get_current_user)):
    existing = await db.tip_favorites.find_one({"user_id": user["user_id"], "tip_id": tip_id})
    if existing:
        await db.tip_favorites.delete_one({"user_id": user["user_id"], "tip_id": tip_id})
        return {"favorited": False}
    await db.tip_favorites.insert_one({"user_id": user["user_id"], "tip_id": tip_id, "created_at": datetime.now(timezone.utc)})
    return {"favorited": True}

# ---------- Categories ----------
@api_router.get("/categories")
async def categories():
    return {
        # « Tous » est une puce d'interface, pas une catégorie : le reste vient
        # de families.py, qui décide seul de ce qui existe.
        "recipes": ["Tous", *CATEGORIES],
        "tips": ["Toutes", *TIP_CATEGORIES],
    }

@api_router.get("/families")
async def families(include_empty: bool = False):
    """The families that actually hold something, in display order.

    A family is only returned when it has recipes: a tile that opens on an
    empty list is worse than no tile. That also keeps the three catch-alls out
    of the grid until a community recipe lands in one.

    `include_empty` is for the share form, which has to offer a family before
    anything is in it.
    """
    counts = {
        row["_id"]: row["n"]
        async for row in db.recipes.aggregate([
            {"$group": {"_id": "$family", "n": {"$sum": 1}}},
        ])
    }
    return [
        {**f, "count": counts.get(f["key"], 0)}
        for f in FAMILIES
        if include_empty or counts.get(f["key"])
    ]

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
async def retire_built_ins(recipes, dependents, keep_titles) -> list:
    """Delete built-in recipes that the seed no longer carries.

    The startup sync only ever upserts, so a sheet dropped from `seed_data.py`
    would otherwise live on in every database that already holds it. Retiring
    content has to be a deploy, not a manual cleanup.

    Two rules make this safe to run on every boot:
      - only `is_user_submitted: False` documents are considered, so a deploy
        can never remove a recipe a member of the community wrote;
      - the likes, comments, notes and favourites of a deleted recipe go with
        it, since rows pointing at nothing would still be counted.

    Returns the titles removed, for the log.
    """
    doomed = await recipes.find(
        {"is_user_submitted": False, "title": {"$nin": list(keep_titles)}},
        {"_id": 0, "id": 1, "title": 1},
    ).to_list(1000)
    if not doomed:
        return []
    ids = [d["id"] for d in doomed]
    await recipes.delete_many({"id": {"$in": ids}})
    for collection in dependents:
        await collection.delete_many({"recipe_id": {"$in": ids}})
    return [d["title"] for d in doomed]


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
    await db.messages.create_index("id", unique=True)
    await db.reports.create_index("message_id")
    await db.reports.create_index("reported_user_id")
    await db.productions.create_index([("user_id", 1), ("date", -1)])
    # Backs the monthly Free-plan count.
    await db.productions.create_index([("user_id", 1), ("created_at", -1)])
    await db.schedules.create_index([("user_id", 1), ("week_start", -1)])
    await db.tips.create_index("title", unique=True)
    await db.tips.create_index("category")
    await db.tip_favorites.create_index([("user_id", 1), ("tip_id", 1)], unique=True)
    await db.raw_materials.create_index([("user_id", 1), ("normalized_name", 1)], unique=True)
    await db.cost_calculations.create_index([("user_id", 1), ("created_at", -1)])
    await db.cost_calculations.create_index([("user_id", 1), ("recipe_id", 1)])

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

    retired = await retire_built_ins(
        db.recipes,
        [db.likes, db.comments, db.notes, db.favorites],
        {r["title"] for r in RECIPES_SEED},
    )
    if retired:
        logger.info(f"Retired {len(retired)} built-in recipes: {', '.join(retired)}")

    # Tips are synced the same way as recipes rather than seeded once: a tip
    # added to TIPS_SEED would otherwise never reach a database that already
    # holds the first batch.
    for t in TIPS_SEED:
        await db.tips.update_one(
            {"title": t["title"]},
            {"$set": t, "$setOnInsert": {"id": str(uuid.uuid4())}},
            upsert=True,
        )
    logger.info(f"Synced {len(TIPS_SEED)} tips")

    await _seed_demo_bots()

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
