"""État d'un abonnement : quel palier est réellement en vigueur, et jusqu'à quand.

Module **pur** — aucune base, aucun réseau, `now` injectable — pour que chaque
état, chaque transition et chaque bascule d'échéance soit un test par table.
La lecture en base vit dans `subscriptions.py` ; le webhook, dans
`routers/subscription.py`.

**Le timestamp fait foi, jamais la chaîne `status`.** C'est la décision
centrale de ce fichier. Un abonnement annulé mais payé jusqu'à la fin du mois
rend encore son palier ; un abonnement marqué `active` dont l'échéance est
passée ne rend rien. Ce projet ne fait tourner aucune tâche de fond : sans
cette règle, il faudrait un cron pour rétrograder les comptes expirés, et un
serveur qui redémarre au mauvais moment laisserait des abonnements payants
ouverts indéfiniment. Ici, l'expiration est calculée à la lecture, donc elle
ne peut pas être « oubliée ».

**Une rétrogradation ne supprime jamais rien.** Elle ne fait que changer ce
que `resolve_plan` renvoie. Les données restent, et l'invariant de
`gating.py` (aucun verrou sur une lecture ni sur une suppression) garantit
qu'elles restent consultables.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from entitlements import FREE, TIER_ORDER, normalize

# Les cinq états que le cahier des charges demande. `status` est une étiquette
# descriptive — utile pour l'affichage et le journal — mais jamais l'autorité
# sur ce qui est accordé : voir le docstring du module.
ACTIVE = "active"
TRIALING = "trialing"
CANCELLED = "cancelled"      # résilié, mais encore actif jusqu'à l'échéance
EXPIRED = "expired"
PAST_DUE = "past_due"        # paiement échoué, période de grâce en cours

STATUSES = (ACTIVE, TRIALING, CANCELLED, EXPIRED, PAST_DUE)

# Les états qui donnent droit au palier tant que l'échéance n'est pas passée.
# `expired` en est exclu par définition ; `past_due` a sa propre fenêtre.
_GRANTING = frozenset({ACTIVE, TRIALING, CANCELLED})

DEFAULT_GRACE_DAYS = 3


def grace_days() -> int:
    """Jours de sursis après un paiement échoué, avant la rétrogradation.

    Un prélèvement qui échoue est le plus souvent une carte expirée, pas un
    abandon : couper l'accès le jour même punirait quelqu'un qui n'a rien
    demandé. Configurable sans rebuild.
    """
    try:
        return max(0, int(os.environ.get("PAYMENT_GRACE_DAYS", DEFAULT_GRACE_DAYS)))
    except (TypeError, ValueError):
        return DEFAULT_GRACE_DAYS


def _as_datetime(value) -> Optional[datetime]:
    """Accepte un datetime ou une chaîne ISO ; rend toujours un datetime tz-aware.

    Mongo rend des datetimes, un webhook rend des chaînes : les deux passent
    par ici plutôt que par deux chemins qui finiraient par diverger. Une
    valeur illisible vaut « pas d'échéance » — donc pas de droit accordé —
    plutôt que de faire échouer la requête d'un utilisateur.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def is_granting(subscription: Optional[dict], now: Optional[datetime] = None) -> bool:
    """Cet abonnement ouvre-t-il encore des droits à cet instant ?"""
    if not subscription:
        return False
    now = now or datetime.now(timezone.utc)
    status = subscription.get("status")

    if status == PAST_DUE:
        # La grâce court depuis `grace_until` s'il est fourni par le
        # fournisseur, sinon depuis l'échéance + le délai configuré.
        limite = _as_datetime(subscription.get("grace_until"))
        if limite is None:
            echeance = _as_datetime(subscription.get("current_period_end"))
            limite = echeance + timedelta(days=grace_days()) if echeance else None
        return limite is not None and now < limite

    if status not in _GRANTING:
        return False

    echeance = _as_datetime(subscription.get("current_period_end"))
    # Pas d'échéance connue = pas de droit. Mieux vaut rétrograder à tort un
    # document incomplet que d'ouvrir un palier payant sur une absence.
    return echeance is not None and now < echeance


def plan_of(subscription: Optional[dict], now: Optional[datetime] = None) -> str:
    """Le palier que cet abonnement accorde réellement, ou Free."""
    if not is_granting(subscription, now):
        return FREE
    return normalize(subscription.get("plan"))


def describe(subscription: Optional[dict], now: Optional[datetime] = None) -> dict:
    """Ce que l'écran d'abonnement affiche — jamais une date inventée.

    `renews_at` n'est rempli que pour un abonnement qui se renouvellera
    vraiment ; un abonnement résilié porte `ends_at` à la place. Les deux
    sont mutuellement exclusifs, pour que l'écran n'ait pas à deviner lequel
    des deux mots employer.
    """
    now = now or datetime.now(timezone.utc)
    if not subscription:
        return {"status": None, "plan": FREE, "active": False,
                "renews_at": None, "ends_at": None, "in_grace": False}

    status = subscription.get("status")
    actif = is_granting(subscription, now)
    echeance = _as_datetime(subscription.get("current_period_end"))
    resilie = status == CANCELLED or bool(subscription.get("cancel_at_period_end"))
    return {
        "status": status,
        "plan": plan_of(subscription, now),
        "active": actif,
        "renews_at": None if resilie or not actif else (echeance.isoformat() if echeance else None),
        "ends_at": (echeance.isoformat() if echeance else None) if resilie else None,
        "in_grace": actif and status == PAST_DUE,
        "trial": status == TRIALING,
    }


# ---------- Produits ----------
# `product_id` du store → palier. Les identifiants réels seront ceux créés
# dans App Store Connect et Play Console ; les valeurs ci-dessous sont la
# convention proposée, à confirmer au moment de créer les produits.
PRODUCT_TIERS = {
    "levanea_pro_monthly": "pro",
    "levanea_pro_plus_monthly": "pro_plus",
    "levanea_team_monthly": "team",
}


def tier_for_product(product_id: Optional[str]) -> Optional[str]:
    """Le palier vendu par ce produit, ou `None` si on ne le connaît pas.

    Un produit inconnu n'accorde rien : un identifiant mal saisi dans la
    console du store ne doit pas pouvoir ouvrir un palier au hasard.
    """
    if not product_id:
        return None
    tier = PRODUCT_TIERS.get(product_id)
    return tier if tier in TIER_ORDER else None
