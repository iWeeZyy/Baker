"""Cost-of-production maths for the baker's cost calculator.

Pure functions: no database, no network, no framework — same discipline as
`production.py` and `staff.py`, and for the same reason: a cost figure a
baker prices their bread from has to be checked, not trusted on faith.

Two rules carried over from `production.py`, plus one specific to money:
  - Never invent data. An ingredient with no matching price is flagged
    `price_missing`, never priced at 0 — a silent zero would understate every
    total built on top of it.
  - Never guess a quantity. A line with no leading number ("Sel, poivre du
    moulin") is `unparsed` and excluded from the sum, not assumed to cost
    nothing and not assumed to cost something.
  - Round only for display. Every function here returns full-precision
    floats; the caller decides how to show them.
"""
import re
from typing import Dict, List, Optional

import production

# A bare count with no explicit weight/volume unit: "3 œufs", "2 pommes",
# "1 tablette de chocolat noir". `production.parse_ingredient` deliberately
# leaves these unparsed (it has no unit to convert), but a cost calculator
# needs *some* quantity for them, so they are costed by the piece instead.
# Tried only after `parse_ingredient` fails, so "500 g de farine" is never
# reinterpreted as "500 pièces de g de farine".
_BARE_COUNT = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s+(?:de\s+|d[''’]\s*)?(.+?)\s*$", re.I)

# What a purchase unit contributes to, one basis per family. A raw material
# is priced on exactly one of these — a baker buys flour by weight and eggs
# by the piece, never both — so an ingredient line can only match a raw
# material whose basis agrees with its own unit.
_WEIGHT_UNITS = {"kg": 1.0, "g": 0.001}
_VOLUME_UNITS = {"l": 1.0, "ml": 0.001, "cl": 0.01}


def derive_unit_prices(purchase_price: float, purchase_quantity: float, purchase_unit: str) -> dict:
    """The price per kg/L/piece implied by a purchase, computed once at entry.

    Exactly one of the three is set — the one the purchase unit's family
    supports — the other two stay None rather than a fabricated conversion
    (a price per litre for a raw material bought by the piece means nothing).
    """
    if purchase_quantity <= 0:
        raise ValueError("La quantité achetée doit être supérieure à 0")
    if purchase_price < 0:
        raise ValueError("Le prix ne peut pas être négatif")

    if purchase_unit in _WEIGHT_UNITS:
        kg_qty = purchase_quantity * _WEIGHT_UNITS[purchase_unit]
        return {"price_per_kg": purchase_price / kg_qty, "price_per_l": None, "price_per_piece": None}
    if purchase_unit in _VOLUME_UNITS:
        l_qty = purchase_quantity * _VOLUME_UNITS[purchase_unit]
        return {"price_per_kg": None, "price_per_l": purchase_price / l_qty, "price_per_piece": None}
    if purchase_unit == "piece":
        return {"price_per_kg": None, "price_per_l": None, "price_per_piece": purchase_price / purchase_quantity}
    raise ValueError("Unité d'achat inconnue (attendu : kg, g, l, ml, cl ou piece)")


def price_lookup(raw_materials: List[dict]) -> Dict[str, dict]:
    """Raw materials keyed by their normalized name, for O(1) matching."""
    return {rm["normalized_name"]: rm for rm in raw_materials}


def cost_line(line: str, prices: Dict[str, dict], overrides: Optional[Dict[str, float]] = None) -> dict:
    """Price one ingredient line.

    `overrides` maps a normalized name to a unit price to use *instead of*
    the stored raw material's price — the simulation path ("what if flour
    goes to 1,05 €/kg"), which must never touch the stored price itself.
    """
    parsed = production.parse_ingredient(line)
    if parsed:
        base_qty, base_unit = production.to_base(parsed["quantity"], parsed["unit"])
        name = parsed["name"]
        kind = "weight" if base_unit == "g" else "volume"
    else:
        bare = _BARE_COUNT.match(line or "")
        if not bare:
            return {"raw": line, "status": "unparsed"}
        try:
            base_qty = float(bare.group(1).replace(",", "."))
        except ValueError:
            return {"raw": line, "status": "unparsed"}
        name = bare.group(2).strip()
        base_unit, kind = "piece", "piece"

    key = production.normalize_name(name)
    override = (overrides or {}).get(key)
    rm = prices.get(key)

    if override is not None:
        unit_price = override
    elif rm:
        unit_price = {"weight": rm.get("price_per_kg"), "volume": rm.get("price_per_l"), "piece": rm.get("price_per_piece")}[kind]
    else:
        unit_price = None

    if unit_price is None:
        return {
            "raw": line, "status": "price_missing", "name": name,
            "quantity": base_qty, "unit": base_unit,
            "raw_material_id": rm.get("id") if rm else None,
        }

    divisor = 1000.0 if kind in ("weight", "volume") else 1.0
    cost = (base_qty / divisor) * unit_price
    return {
        "raw": line, "status": "ok", "name": name,
        "quantity": base_qty, "unit": base_unit,
        "unit_price": unit_price, "cost": cost,
        "raw_material_id": rm.get("id") if rm else None,
    }


def compute_recipe_cost(
    ingredient_lines: List[str],
    raw_materials: List[dict],
    packaging: List[dict],
    other_costs: List[dict],
    pieces: Optional[float],
    overrides: Optional[Dict[str, float]] = None,
) -> dict:
    """The full cost breakdown of a recipe (or a free-form list of lines).

    `total_cost` and `cost_per_piece` are None — never 0 — the moment a
    single ingredient is missing a price: a total that silently drops what
    it doesn't know the price of would understate every recipe using it.
    """
    prices = price_lookup(raw_materials)
    items = [cost_line(line, prices, overrides) for line in (ingredient_lines or [])]
    missing = [i for i in items if i["status"] == "price_missing"]
    unparsed = [i for i in items if i["status"] == "unparsed"]
    ok = [i for i in items if i["status"] == "ok"]

    raw_materials_cost = None if missing else sum(i["cost"] for i in ok)
    packaging_cost = sum(float(p.get("cost") or 0) for p in (packaging or []))
    other_cost = sum(float(o.get("cost") or 0) for o in (other_costs or []))
    total_cost = None if raw_materials_cost is None else raw_materials_cost + packaging_cost + other_cost

    cost_per_piece = None
    if total_cost is not None and pieces and pieces > 0:
        cost_per_piece = total_cost / pieces

    return {
        "items": items,
        "has_missing_prices": bool(missing),
        "missing_count": len(missing),
        "unparsed_count": len(unparsed),
        "raw_materials_cost": raw_materials_cost,
        "packaging_cost": packaging_cost,
        "other_cost": other_cost,
        "total_cost": total_cost,
        "pieces": pieces,
        "cost_per_piece": cost_per_piece,
    }


def compute_sale_metrics(
    cost_per_piece: Optional[float],
    pieces: Optional[float],
    sale_price_ht: Optional[float],
    vat_rate: Optional[float],
) -> dict:
    """Revenue, margin, taux de marge and taux de marque for a sale price.

    Taux de marge = (prix de vente HT - coût de revient) / coût de revient
    Taux de marque = (prix de vente HT - coût de revient) / prix de vente HT

    Margin is computed against the HT price, since VAT is collected on the
    state's behalf and is never part of the baker's own revenue. `vat_rate`
    is never assumed: with none given, `sale_price_ttc` stays None rather
    than silently equal to the HT price (which would imply a 0% rate that
    nobody chose).
    """
    result = {
        "sale_price_ht": sale_price_ht,
        "vat_rate": vat_rate,
        "sale_price_ttc": None,
        "revenue_ht": None,
        "margin_per_piece": None,
        "margin_total": None,
        "margin_rate_pct": None,
        "markup_rate_pct": None,
    }
    if sale_price_ht is not None and vat_rate is not None:
        result["sale_price_ttc"] = sale_price_ht * (1 + vat_rate / 100.0)
    if sale_price_ht is None or cost_per_piece is None:
        return result

    margin = sale_price_ht - cost_per_piece
    result["margin_per_piece"] = margin
    if pieces and pieces > 0:
        result["margin_total"] = margin * pieces
        result["revenue_ht"] = sale_price_ht * pieces
    if cost_per_piece > 0:
        result["margin_rate_pct"] = (margin / cost_per_piece) * 100.0
    if sale_price_ht > 0:
        result["markup_rate_pct"] = (margin / sale_price_ht) * 100.0
    return result
