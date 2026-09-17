"""Commandes pro (phase 7b) : ce qui est pur dans une commande client —
les statuts, le reste à payer, et l'agrégation des besoins matières de
plusieurs commandes à la fois.

Une ligne de commande a la même forme qu'une ligne de production
(`recipe_id`/`mode`/`quantity`/`yield_pieces`/`ingredients`), donc le
calcul de mise à l'échelle est le même : ce module réutilise
`production.normalize_line`/`scale_ingredients`/`aggregate_ingredients`
plutôt que de le réécrire.

Réservé aux organisations (palier Équipe, `pro_orders` dans
`entitlements.MIN_TIER`) — cadré avec Lucas avant d'écrire ce module, comme
Mode Fournil/Organisation/le tableau de bord avant lui.
"""
from typing import List, Optional

import production

ORDER_STATUSES = ("pending", "confirmed", "ready", "picked_up", "cancelled")

# Une commande annulée ne doit jamais gonfler l'agrégat de matières d'une
# journée — c'est la seule chose qui distingue un statut "actif" ici.
_ACTIVE_STATUSES = frozenset(s for s in ORDER_STATUSES if s != "cancelled")


def is_active(status: str) -> bool:
    return status in _ACTIVE_STATUSES


def balance_due(price_total: Optional[float], deposit_paid: Optional[float]) -> Optional[float]:
    """Reste à payer. `None` si aucun prix n'a été saisi pour cette
    commande — jamais 0, qui laisserait croire à tort qu'elle est soldée
    (même règle que costing.py pour un coût manquant : une donnée absente
    reste absente)."""
    if price_total is None:
        return None
    return price_total - (deposit_paid or 0.0)


def scaled_lines_for_order(items: List[dict]) -> List[dict]:
    """Les lignes d'ingrédients d'une commande mises à l'échelle — même
    pipeline `normalize_line` -> `scale_ingredients` qu'une ligne de
    production, jamais un second calcul."""
    scaled: List[dict] = []
    for item in items or []:
        normalized = production.normalize_line(item)
        scaled.extend(production.scale_ingredients(
            normalized.get("ingredients") or [], normalized.get("batches") or 0))
    return scaled


def aggregate_orders(orders: List[dict]) -> dict:
    """Besoin matières agrégé de plusieurs commandes à la fois — mêmes
    clés (`items`/`unparsed`) que `production.aggregate_ingredients`, pour
    que le frontend affiche une commande et une production de façon
    identique. Une commande annulée n'y contribue jamais."""
    scaled: List[dict] = []
    for order in orders:
        if not is_active(order.get("status") or "pending"):
            continue
        scaled.extend(scaled_lines_for_order(order.get("items")))
    return production.aggregate_ingredients(scaled)
