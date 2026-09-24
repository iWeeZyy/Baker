"""Ad events: POST /ads/event.

A minimal event log for the AdMob integration — deliberately not a
third-party analytics SDK. Follows the same "compute at request time from
domain collections" pattern already used by leaderboard.py: this collection
is written to on the few ad events that matter (impression, click,
interstitial shown, rewarded completed/skipped) and read back with plain
Mongo queries later, not a dashboard built now.

Whether an ad is allowed at all is decided by plans.py::ads_config() and
returned from GET /me/plan — this router only records what happened after
that decision, for measuring reach/frequency/Free→Pro conversion later.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, get_current_user
from plans import resolve_plan

router = APIRouter(prefix="/api")

AD_EVENT_TYPES = ("impression", "click", "interstitial_shown", "rewarded_completed", "rewarded_skipped")
AD_PLACEMENTS = ("home", "recipe_list", "interstitial", "rewarded")


class AdEventInput(BaseModel):
    event_type: str
    placement: str


@router.post("/ads/event")
async def log_ad_event(inp: AdEventInput, user: dict = Depends(get_current_user)):
    """Fire-and-forget event log — the client never blocks or breaks on this.

    Recorded even in the unexpected case of a Pro account's call (the client
    never renders an ad to render for Pro — see AdSlot/canShowAds — so this
    endpoint has nothing to gate on its own) so a client bug would show up in
    the data rather than being silently dropped.
    """
    if inp.event_type not in AD_EVENT_TYPES:
        raise HTTPException(422, f"event_type invalide (attendu : {', '.join(AD_EVENT_TYPES)})")
    if inp.placement not in AD_PLACEMENTS:
        raise HTTPException(422, f"placement invalide (attendu : {', '.join(AD_PLACEMENTS)})")
    await db.ad_events.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "plan": resolve_plan(user),
        "event_type": inp.event_type,
        "placement": inp.placement,
        "created_at": datetime.now(timezone.utc),
    })
    return {"status": "logged"}
