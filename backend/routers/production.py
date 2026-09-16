"""Production planning: /me/plan, /productions*.

Second extraction out of server.py's monolith (see CLAUDE.md, "server.py,
JWT, CI"). Imports `db`/`get_current_user` from core.py rather than from
server.py, the same pattern production.py/staff.py/costing.py already use
for `db` (passed as a parameter) — no route module ever imports server.py,
so there is no risk of a circular import.
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import entitlements
import production
import subscriptions
from core import db, get_current_user
from gating import require
from plans import ads_config, entitlements_enforced, limits_for, production_quota, resolve_plan

router = APIRouter(prefix="/api")

STEP_STATUSES = ("todo", "doing", "done")


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
    """La charge utile de `/me/plan`.

    Elle **s'étend, ne rétrécit jamais** : une application déjà livrée lit
    `plan`, `limits`, `productions_*` et `ads`, donc ces clés gardent leur nom
    et leur forme. Les clés `enforced`/`features`/`quotas`/`plans` s'ajoutent
    à côté pour les quatre offres.
    """
    sub = await subscriptions.get_subscription(user["user_id"])
    plan = resolve_plan(user, sub)
    quota = production_quota(plan)
    used = await _productions_used_this_month(user["user_id"])
    enforced = entitlements_enforced()
    return {
        "plan": plan,
        "limits": limits_for(plan),
        "productions_used": used,
        "productions_limit": quota,
        "productions_remaining": None if quota is None else max(0, quota - used),
        # Whether this user may be shown ads at all. Decided here rather than in
        # the app so a Pro account can never be served one by a client bug.
        "ads": ads_config(plan),
        # Les droits sont-ils réellement appliqués ? L'application n'a pas à le
        # savoir — `locked` ci-dessous replie déjà la réponse — mais l'écran
        # d'abonnement l'affiche pour ne rien promettre de faux.
        "enforced": enforced,
        # Par fonctionnalité : `allowed` = la vérité de l'offre (argumentaire),
        # `locked` = ce que l'application doit respecter. Le seul champ sur
        # lequel un écran a le droit de brancher est `locked`.
        "features": entitlements.features_for(plan, enforced),
        # Plafonds seuls pour l'instant : `used`/`remaining` demandent de
        # compter en base, ce que gating.py apportera avec les compteurs.
        # `productions_*` ci-dessus reste le seul compteur déjà réel.
        "quotas": entitlements.quotas_for(plan),
        # Le catalogue des offres, pour que l'écran d'abonnement se construise
        # à partir du serveur : changer un prix ou ajouter un palier ne
        # demande alors aucune livraison sur les stores.
        "plans": entitlements.plan_catalogue(),
        # Où en est l'abonnement lui-même — distinct de « à quoi ai-je droit ».
        # Neutre tant que rien n'est achetable, jamais une date inventée.
        "subscription": subscriptions.public_state(sub),
    }

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

@router.get("/me/plan")
async def my_plan(user: dict = Depends(get_current_user)):
    return await _plan_state(user)

@router.get("/productions")
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

@router.post("/productions")
async def create_production(
    inp: ProductionInput,
    user: dict = Depends(require(quota="productions_per_month")),
):
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

@router.get("/productions/{production_id}")
async def get_production(production_id: str, user: dict = Depends(get_current_user)):
    # Scoped by user_id: someone else's id is indistinguishable from a missing one.
    doc = await db.productions.find_one({"id": production_id, "user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Production introuvable")
    return _production_detail(doc)

@router.put("/productions/{production_id}")
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

@router.delete("/productions/{production_id}")
async def delete_production(production_id: str, user: dict = Depends(get_current_user)):
    res = await db.productions.delete_one({"id": production_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Production introuvable")
    return {"status": "deleted"}

@router.patch("/productions/{production_id}/steps/{step_id}")
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
