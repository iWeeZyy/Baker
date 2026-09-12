"""Shared infrastructure: database connection and JWT authentication.

First extraction out of server.py's monolith (see CLAUDE.md, "server.py,
JWT, CI"). New route modules import `db` and `get_current_user` from here
rather than from server.py, to avoid circular imports — the same pattern
already used by production.py/staff.py/costing.py, which take `db` as a
parameter instead of importing it from server.
"""
import base64
import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import Header, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * ((4 - len(data) % 4) % 4))


def sign_jwt(user_id: str, token_version: int = 0) -> str:
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64url(json.dumps({
        "user_id": user_id,
        "exp": int(time.time()) + 60 * 60 * 24 * 30,
        # Copie de db.users.token_version au moment de l'émission — comparée
        # à la valeur courante dans get_current_user. Incrémenter ce champ
        # (POST /auth/logout-all) invalide d'un coup tous les jetons émis
        # avant, sur tous les appareils, sans liste de révocation ni nouvelle
        # collection. Absent chez un jeton déjà émis avant l'ajout de ce
        # champ -> vaut 0 par défaut des deux côtés, donc rien n'est cassé
        # au déploiement.
        "tv": token_version,
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
    if payload.get("tv", 0) != user.get("token_version", 0):
        raise HTTPException(status_code=401, detail="Invalid token")
    return user
