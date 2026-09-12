"""Cost calculator: /raw-materials*, /recipes/{id}/cost, /cost/history*.

Fourth extraction out of server.py's monolith (see CLAUDE.md, "server.py,
JWT, CI"). Imports `db`/`get_current_user` from core.py rather than from
server.py, the same pattern the other extracted routers already use.
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import costing
import production
from core import db, get_current_user

router = APIRouter(prefix="/api")


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

@router.get("/raw-materials")
async def list_raw_materials(user: dict = Depends(get_current_user)):
    return await db.raw_materials.find({"user_id": user["user_id"]}, {"_id": 0}).sort("name", 1).to_list(1000)

@router.post("/raw-materials")
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

@router.put("/raw-materials/{material_id}")
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

@router.delete("/raw-materials/{material_id}")
async def delete_raw_material(material_id: str, user: dict = Depends(get_current_user)):
    res = await db.raw_materials.delete_one({"id": material_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Matière première introuvable")
    return {"status": "deleted"}

@router.get("/recipes/{recipe_id}/cost")
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

@router.post("/cost/history")
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

@router.get("/cost/history")
async def list_cost_history(recipe_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"user_id": user["user_id"]}
    if recipe_id:
        q["recipe_id"] = recipe_id
    return await db.cost_calculations.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)

@router.get("/cost/history/{calc_id}")
async def get_cost_history_entry(calc_id: str, user: dict = Depends(get_current_user)):
    doc = await db.cost_calculations.find_one({"id": calc_id, "user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Calcul introuvable")
    return doc

@router.delete("/cost/history/{calc_id}")
async def delete_cost_history_entry(calc_id: str, user: dict = Depends(get_current_user)):
    res = await db.cost_calculations.delete_one({"id": calc_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Calcul introuvable")
    return {"status": "deleted"}
