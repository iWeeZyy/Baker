"""L'abonnement stocké : lecture, écriture, et le palier qui en découle.

Frontière assumée : `subscription_state.py` décide (pur, testable par table),
ce module-ci touche `db.subscriptions`, et `routers/subscription.py` expose
les routes. Un document par utilisateur, index unique sur `user_id`.

Forme du document :

    {user_id, plan, status, source: revenuecat|manual, store, product_id,
     revenuecat_app_user_id, started_at, current_period_end, trial_end,
     cancel_at_period_end, grace_until, last_event_id, updated_at,
     history: [{event_id, type, plan, status, at}, ...]}

`history` est volontairement gardé sur le document plutôt que dans une
collection à part : il se lit toujours avec l'abonnement, jamais seul, et il
est borné par le nombre d'événements de facturation d'un compte — quelques
dizaines par an au plus.
"""
from datetime import datetime, timezone
from typing import Optional

import subscription_state
from core import db
from plans import resolve_plan

# Au-delà, on tronque : un journal de facturation n'a pas vocation à grossir
# sans fin sur un document lu à chaque requête verrouillée.
MAX_HISTORY = 50


async def get_subscription(user_id: str) -> Optional[dict]:
    return await db.subscriptions.find_one({"user_id": user_id}, {"_id": 0})


async def plan_for(user: dict, now: Optional[datetime] = None) -> str:
    """Le palier en vigueur, abonnement compris.

    C'est le point d'entrée que `gating.py` et `/me/plan` utilisent. Il coûte
    une lecture de plus par requête verrouillée — assumé : la seule
    alternative serait un cache par requête, que ce projet n'a nulle part, et
    un palier calculé sur une valeur périmée serait pire qu'une requête.
    """
    return resolve_plan(user, await get_subscription(user["user_id"]), now)


async def record_event(user_id: str, *, event_id: Optional[str], event_type: str,
                       plan: str, status: str, product_id: Optional[str] = None,
                       store: Optional[str] = None,
                       current_period_end=None, trial_end=None,
                       cancel_at_period_end: bool = False,
                       grace_until=None, app_user_id: Optional[str] = None,
                       source: str = "revenuecat") -> dict:
    """Applique un événement de facturation. Idempotent sur `event_id`.

    Un même événement rejoué — ce que tout fournisseur de webhook fait en cas
    de doute sur la livraison — ne doit pas produire deux lignes d'historique
    ni rouvrir un abonnement déjà résilié. La comparaison avec `last_event_id`
    suffit ici : les événements d'un compte arrivent en série, pas en
    parallèle, et rien dans cette app ne les traite concurremment.
    """
    existant = await get_subscription(user_id)
    if existant and event_id and existant.get("last_event_id") == event_id:
        return existant  # déjà appliqué

    maintenant = datetime.now(timezone.utc)
    doc = dict(existant or {"user_id": user_id, "started_at": maintenant})
    doc.update({
        "plan": plan,
        "status": status,
        "source": source,
        "store": store or doc.get("store"),
        "product_id": product_id or doc.get("product_id"),
        "revenuecat_app_user_id": app_user_id or doc.get("revenuecat_app_user_id"),
        "current_period_end": current_period_end,
        "trial_end": trial_end,
        "cancel_at_period_end": bool(cancel_at_period_end),
        "grace_until": grace_until,
        "last_event_id": event_id,
        "updated_at": maintenant,
    })
    historique = list(doc.get("history") or [])
    historique.append({
        "event_id": event_id,
        "type": event_type,
        "plan": plan,
        "status": status,
        "at": maintenant,
    })
    doc["history"] = historique[-MAX_HISTORY:]

    await db.subscriptions.update_one(
        {"user_id": user_id}, {"$set": doc}, upsert=True)
    doc.pop("_id", None)
    return doc


def public_state(subscription: Optional[dict], now: Optional[datetime] = None) -> dict:
    """Ce que `/me/plan` expose sous la clé `subscription`."""
    return subscription_state.describe(subscription, now)
