"""Commandes pro (offre Équipe) : /pro-orders*.

Couche fine sur `orders.py`/`production.py`, même découpage que
`routers/production.py`. Réservé aux organisations (`pro_orders`,
`entitlements.MIN_TIER = TEAM`) : sans organisation active, il n'y a rien
à commander en commun avec des collègues.
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import orders
import production
from core import db, get_current_user
from org_scope import can_delete, scope, stamp
from organisations import get_org_context

router = APIRouter(prefix="/api/pro-orders")


class OrderItemInput(BaseModel):
    recipe_id: str
    quantity: float
    mode: str = "batches"  # "pieces" | "batches"


class OrderInput(BaseModel):
    client_name: str
    client_contact: str = ""
    items: List[OrderItemInput] = Field(default_factory=list)
    pickup_date: str  # YYYY-MM-DD
    pickup_time: Optional[str] = None  # HH:MM
    status: str = "pending"
    price_total: Optional[float] = None
    deposit_paid: Optional[float] = None
    notes: str = ""


class OrderStatusInput(BaseModel):
    status: str


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


def _validate_status(value: str) -> str:
    if value not in orders.ORDER_STATUSES:
        raise HTTPException(422, f"Statut invalide (attendu : {', '.join(orders.ORDER_STATUSES)})")
    return value


def _validate_prices(price_total: Optional[float], deposit_paid: Optional[float]) -> None:
    if price_total is not None and price_total < 0:
        raise HTTPException(422, "Le prix total ne peut pas être négatif")
    if deposit_paid is not None and deposit_paid < 0:
        raise HTTPException(422, "L'acompte ne peut pas être négatif")
    if price_total is not None and deposit_paid is not None and deposit_paid > price_total:
        raise HTTPException(422, "L'acompte ne peut pas dépasser le prix total")


async def _build_items(items_in: List[OrderItemInput]) -> List[dict]:
    """Snapshot each recipe into the order — same principle as productions:
    a later recipe edit must never silently rewrite a commitment already
    made to a client."""
    if not items_in:
        raise HTTPException(422, "Une commande doit porter au moins un article")
    items = []
    for item in items_in:
        if item.quantity is None or item.quantity <= 0:
            raise HTTPException(422, "La quantité doit être supérieure à 0")
        if item.mode not in ("pieces", "batches"):
            raise HTTPException(422, "Mode invalide (attendu : pieces ou batches)")
        recipe = await db.recipes.find_one({"id": item.recipe_id}, {"_id": 0})
        if not recipe:
            raise HTTPException(404, "Recette introuvable")
        items.append({
            "item_id": str(uuid.uuid4()),
            "recipe_id": recipe["id"],
            "recipe_title": recipe.get("title") or "Recette",
            "mode": item.mode,
            "quantity": float(item.quantity),
            "yield_pieces": recipe.get("yield_pieces"),
            "ingredients": recipe.get("ingredients") or [],
        })
    return items


def _order_detail(doc: dict) -> dict:
    doc.pop("_id", None)
    return {
        **doc,
        "balance_due": orders.balance_due(doc.get("price_total"), doc.get("deposit_paid")),
        "ingredients": production.aggregate_ingredients(orders.scaled_lines_for_order(doc.get("items"))),
    }


def _order_summary(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "client_name": doc.get("client_name"),
        "pickup_date": doc.get("pickup_date"),
        "pickup_time": doc.get("pickup_time"),
        "status": doc.get("status"),
        "item_count": len(doc.get("items") or []),
        "recipe_titles": [i.get("recipe_title") for i in doc.get("items") or []],
        "price_total": doc.get("price_total"),
        "balance_due": orders.balance_due(doc.get("price_total"), doc.get("deposit_paid")),
        "created_at": doc.get("created_at"),
    }


@router.post("")
async def create_order(
    inp: OrderInput,
    user: dict = Depends(get_current_user),
    org: dict = Depends(get_org_context),
):
    if not org.get("org_id"):
        raise HTTPException(422, "Les commandes pro supposent une organisation active.")
    # Import différé pour éviter le cycle documenté dans gating.require()
    # (organisations.py <-> gating.py) — même précédent que
    # update_production_step()/dashboard.build() pour org_tasks/org_dashboard.
    from gating import check
    await check(user, feature="pro_orders", org=org)
    client_name = (inp.client_name or "").strip()
    if not client_name:
        raise HTTPException(422, "Le nom du client est obligatoire")
    pickup_date = _validate_date(inp.pickup_date)
    pickup_time = _validate_time(inp.pickup_time)
    status = _validate_status(inp.status)
    _validate_prices(inp.price_total, inp.deposit_paid)
    items = await _build_items(inp.items)
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        **stamp(user, org),
        "client_name": client_name,
        "client_contact": (inp.client_contact or "").strip(),
        "items": items,
        "pickup_date": pickup_date,
        "pickup_time": pickup_time,
        "status": status,
        "price_total": inp.price_total,
        "deposit_paid": inp.deposit_paid,
        "notes": (inp.notes or "").strip(),
        "created_at": now,
        "updated_at": now,
    }
    await db.pro_orders.insert_one(doc)
    return _order_detail(doc)


@router.get("")
async def list_orders(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    status: Optional[str] = None,
    user: dict = Depends(get_current_user),
    org: dict = Depends(get_org_context),
):
    q = {**scope(user, org)}
    if date_from or date_to:
        rng = {}
        if date_from:
            rng["$gte"] = _validate_date(date_from)
        if date_to:
            rng["$lte"] = _validate_date(date_to)
        q["pickup_date"] = rng
    if status:
        q["status"] = _validate_status(status)
    docs = await db.pro_orders.find(q, {"_id": 0}).sort("pickup_date", 1).to_list(500)
    return [_order_summary(d) for d in docs]


@router.get("/aggregate")
async def aggregate_orders_for_date(
    date: str,
    user: dict = Depends(get_current_user),
    org: dict = Depends(get_org_context),
):
    """Besoin matières agrégé des commandes actives d'une date donnée —
    pour consulter le besoin avant même qu'une production existe ce
    jour-là (voir `routers/production.py::_production_detail`, qui fait le
    même calcul une fois une production créée)."""
    pickup_date = _validate_date(date)
    docs = await db.pro_orders.find(
        {**scope(user, org), "pickup_date": pickup_date}, {"_id": 0}).to_list(500)
    order_count = sum(1 for d in docs if orders.is_active(d.get("status") or "pending"))
    return {
        "date": pickup_date,
        "order_count": order_count,
        "ingredients": orders.aggregate_orders(docs),
    }


@router.get("/{order_id}")
async def get_order(
    order_id: str, user: dict = Depends(get_current_user), org: dict = Depends(get_org_context),
):
    doc = await db.pro_orders.find_one({"id": order_id, **scope(user, org)}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Commande introuvable")
    return _order_detail(doc)


@router.put("/{order_id}")
async def update_order(
    order_id: str, inp: OrderInput,
    user: dict = Depends(get_current_user),
    org: dict = Depends(get_org_context),
):
    existing = await db.pro_orders.find_one({"id": order_id, **scope(user, org)}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Commande introuvable")
    from gating import check
    await check(user, feature="pro_orders", org=org)
    client_name = (inp.client_name or "").strip()
    if not client_name:
        raise HTTPException(422, "Le nom du client est obligatoire")
    pickup_date = _validate_date(inp.pickup_date)
    pickup_time = _validate_time(inp.pickup_time)
    status = _validate_status(inp.status)
    _validate_prices(inp.price_total, inp.deposit_paid)
    items = await _build_items(inp.items)
    update = {
        "client_name": client_name,
        "client_contact": (inp.client_contact or "").strip(),
        "items": items,
        "pickup_date": pickup_date,
        "pickup_time": pickup_time,
        "status": status,
        "price_total": inp.price_total,
        "deposit_paid": inp.deposit_paid,
        "notes": (inp.notes or "").strip(),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.pro_orders.update_one({"id": order_id, **scope(user, org)}, {"$set": update})
    return _order_detail({**existing, **update})


@router.patch("/{order_id}/status")
async def update_order_status(
    order_id: str, inp: OrderStatusInput,
    user: dict = Depends(get_current_user), org: dict = Depends(get_org_context),
):
    """Changer le statut seul ne consomme aucun droit — la commande existe
    déjà et a été créée sous licence Équipe ; suivre son avancement (cochée
    prête, récupérée...) est un geste quotidien, pas la fonctionnalité
    elle-même. Même logique que le statut d'une étape de production, jamais
    verrouillé pour lui-même."""
    status = _validate_status(inp.status)
    doc = await db.pro_orders.find_one({"id": order_id, **scope(user, org)}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Commande introuvable")
    await db.pro_orders.update_one(
        {"id": order_id, **scope(user, org)},
        {"$set": {"status": status, "updated_at": datetime.now(timezone.utc)}},
    )
    return _order_detail({**doc, "status": status})


@router.delete("/{order_id}")
async def delete_order(
    order_id: str, user: dict = Depends(get_current_user), org: dict = Depends(get_org_context),
):
    doc = await db.pro_orders.find_one({"id": order_id, **scope(user, org)}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Commande introuvable")
    if not can_delete(user, org, doc):
        raise HTTPException(403, "Seuls l'auteur ou l'encadrement peuvent supprimer cette commande.")
    await db.pro_orders.delete_one({"id": order_id, **scope(user, org)})
    return {"status": "deleted"}
