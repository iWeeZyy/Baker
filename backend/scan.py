"""Pourcentages boulangers et hydratation calculés à partir d'ingrédients
scannés — fonctions pures, même famille que production.py/costing.py.

La même règle que le reste du projet : ne jamais deviner. Le pourcentage
boulanger n'existe que s'il y a une farine identifiable ; l'hydratation
n'existe que si l'eau et la farine le sont toutes les deux, sans
ambiguïté — jamais un autre liquide (lait, beurre fondu…) compté comme de
l'eau, exactement la réserve déjà documentée dans seed_books.py pour les
recettes du catalogue ("un trempage, du cacao ou une pâte à la bière
rendraient le chiffre arithmétiquement juste mais trompeur").
"""
from typing import List, Optional

from production import normalize_name, parse_ingredient, to_base

# Toute farine compte pour le 100% de référence, quel que soit son type
# (T45, T55, T65…) — seule la présence du mot "farine" dans le nom
# normalisé est vérifiée, jamais une liste fermée de types.
_FLOUR_MARKER = "farine"

# Volontairement une liste fermée et étroite : "eau" seule, ou qualifiée
# par sa température. Jamais un nom qui contient juste "eau" en
# sous-chaîne ("eau de fleur d'oranger" n'est pas de l'eau de coulage).
_WATER_NAMES = {"eau", "eau froide", "eau tiede", "eau glacee", "eau chaude"}


def _weight_totals(ingredient_lines: List[str]) -> dict:
    """Poids total (en grammes) par ligne parsable, regroupé par nom
    normalisé. L'eau en ml est comptée comme des grammes (densité ~1,
    convention standard en boulangerie pour l'hydratation)."""
    totals: dict = {}
    for line in ingredient_lines or []:
        parsed = parse_ingredient(line)
        if not parsed:
            continue
        base_qty, base_unit = to_base(parsed["quantity"], parsed["unit"])
        if base_unit not in ("g", "ml"):
            continue
        key = normalize_name(parsed["name"])
        totals[key] = totals.get(key, 0.0) + base_qty
    return totals


def bakers_percentages(ingredient_lines: List[str]) -> Optional[dict]:
    """`{nom affiché: pourcentage}` avec la farine totale comme référence
    à 100 %. `None` si aucune farine n'est identifiable — jamais un
    pourcentage calculé sur une base à zéro."""
    totals = _weight_totals(ingredient_lines)
    flour_total = sum(qty for name, qty in totals.items() if _FLOUR_MARKER in name)
    if flour_total <= 0:
        return None
    percentages = {}
    for line in ingredient_lines or []:
        parsed = parse_ingredient(line)
        if not parsed:
            continue
        base_qty, base_unit = to_base(parsed["quantity"], parsed["unit"])
        if base_unit not in ("g", "ml"):
            continue
        percentages[parsed["name"]] = round(base_qty / flour_total * 100, 1)
    return percentages


def compute_hydration(ingredient_lines: List[str]) -> int:
    """Hydratation en pourcentage entier, ou 0 si non déterminable sans
    ambiguïté — la même convention que Recipe.hydration côté serveur."""
    totals = _weight_totals(ingredient_lines)
    flour_total = sum(qty for name, qty in totals.items() if _FLOUR_MARKER in name)
    water_total = sum(qty for name, qty in totals.items() if name in _WATER_NAMES)
    if flour_total <= 0 or water_total <= 0:
        return 0
    return round(water_total / flour_total * 100)
