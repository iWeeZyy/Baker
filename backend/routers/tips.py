"""Tips: /tips*.

Fifth and last extraction of this first slice out of server.py's monolith
(see CLAUDE.md, "server.py, JWT, CI"). Imports `db`/`get_current_user` from
core.py rather than from server.py, the same pattern the other extracted
routers already use.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends

from core import db, get_current_user

router = APIRouter(prefix="/api")


# The library stays small enough (a few hundred entries at most) that the app
# fetches it whole and searches client-side, the same choice already made for
# families/recipes browsing — one request, then instant local filtering
# rather than a round trip on every keystroke.
@router.get("/tips")
async def list_tips(category: Optional[str] = None):
    # "Toutes" is the tips chip's "no filter" label ("Tous" is the recipes
    # one) — both are accepted so a client can't silently get zero results by
    # sending the wrong one.
    q = {}
    if category and category not in ("Tous", "Toutes"):
        q["category"] = category
    cursor = db.tips.find(q, {"_id": 0})
    return await cursor.to_list(500)

@router.get("/tips/favorites")
async def my_tip_favorites(user: dict = Depends(get_current_user)):
    favs = await db.tip_favorites.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(500)
    ids = [f["tip_id"] for f in favs]
    return await db.tips.find({"id": {"$in": ids}}, {"_id": 0}).to_list(500)

@router.get("/tips/favorite-ids")
async def my_tip_favorite_ids(user: dict = Depends(get_current_user)):
    """The bare id set, for marking ⭐ on a whole list without one request per card."""
    favs = await db.tip_favorites.find({"user_id": user["user_id"]}, {"_id": 0, "tip_id": 1}).to_list(500)
    return [f["tip_id"] for f in favs]

@router.post("/tips/{tip_id}/favorite")
async def toggle_tip_favorite(tip_id: str, user: dict = Depends(get_current_user)):
    existing = await db.tip_favorites.find_one({"user_id": user["user_id"], "tip_id": tip_id})
    if existing:
        await db.tip_favorites.delete_one({"user_id": user["user_id"], "tip_id": tip_id})
        return {"favorited": False}
    await db.tip_favorites.insert_one({"user_id": user["user_id"], "tip_id": tip_id, "created_at": datetime.now(timezone.utc)})
    return {"favorited": True}
