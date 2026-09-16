"""Ce qui dépend de l'environnement : palier en vigueur, publicité.

La table des droits elle-même vit dans `entitlements.py`, pur et sans
`os.environ` — ici on ne garde que ce qui lit la configuration du serveur
(liste d'e-mails, interrupteurs) et ce qui en découle. Les quatre offres
(`FREE`/`PRO`/`PRO_PLUS`/`TEAM`) sont ré-exportées ci-dessous pour que les
modules qui importaient déjà `plans.FREE`/`plans.PRO` n'aient rien à changer.

Brancher un vrai fournisseur de facturation ne touchera que `resolve_plan`.
"""
import os
from typing import Optional

from entitlements import (  # noqa: F401  (ré-exports : plans.FREE, plans.PRO…)
    FREE,
    PRO,
    PRO_PLUS,
    TEAM,
    TIER_ORDER,
    normalize,
    quota,
)

# Forme héritée, conservée telle quelle parce qu'une application déjà livrée
# lit ces clés dans `/me/plan`. Les quatre drapeaux ne sont appliqués nulle
# part (aucune de ces fonctionnalités n'est construite) ; le seul chiffre qui
# compte vraiment, `productions_per_month`, est tiré d'`entitlements` pour
# qu'il n'existe qu'à un seul endroit.
_LEGACY_FLAGS = ("multi_day", "recurring", "sharing", "full_history")

PLAN_LIMITS = {
    tier: {
        "productions_per_month": quota(tier, "productions_per_month"),
        **{flag: tier != FREE for flag in _LEGACY_FLAGS},
    }
    for tier in TIER_ORDER
}


def _pro_emails() -> set:
    """Emails granted Pro, from the PRO_EMAILS env var (comma-separated).

    There is no billing provider yet. This is the honest stand-in: it lives
    server-side, so it cannot be forged by a client, and swapping it for a real
    subscription check later means rewriting only this function.
    """
    raw = os.environ.get("PRO_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def _plan_overrides() -> dict:
    """`PLAN_OVERRIDES="a@b.fr:team,c@d.fr:pro_plus"` — e-mail → palier.

    Même rôle que `PRO_EMAILS`, étendu aux paliers que celui-ci ne sait pas
    exprimer. Côté serveur, donc infalsifiable par un client, et destiné à
    disparaître derrière un vrai abonnement. Un palier inconnu est ignoré
    plutôt que d'accorder quoi que ce soit.
    """
    out = {}
    for entry in os.environ.get("PLAN_OVERRIDES", "").split(","):
        email, _, tier = entry.partition(":")
        email, tier = email.strip().lower(), tier.strip().lower()
        if email and tier in TIER_ORDER:
            out[email] = tier
    return out


def resolve_plan(user: dict) -> str:
    """The plan actually in force for a user, never trusting client input.

    `PRO_EMAILS` est consulté en premier et reste prioritaire : c'est la
    liste historique, celle sur laquelle reposent la CI et les tests existants.
    """
    email = (user.get("email") or "").lower()
    if email in _pro_emails():
        return PRO
    override = _plan_overrides().get(email)
    if override:
        return override
    # `plan` n'est écrit par aucune route : il ne peut venir que de la base,
    # jamais d'une requête ni d'un jeton. Un palier inconnu retombe sur Free.
    return normalize(user.get("plan"))


def entitlements_enforced() -> bool:
    """Les droits sont-ils réellement appliqués, ou seulement déclarés ?

    Défaut **off**, même esprit que `ADS_ENABLED` : tant que l'abonnement
    n'est pas achetable, refuser une fonctionnalité reviendrait à la retirer
    à tout le monde sans aucun moyen de la débloquer. Éteint, le serveur
    calcule et annonce les droits mais ne bloque rien.
    """
    return _env_flag("ENTITLEMENTS_ENFORCED")


def limits_for(plan: str) -> dict:
    return PLAN_LIMITS.get(normalize(plan), PLAN_LIMITS[FREE])


def production_quota(plan: str) -> Optional[int]:
    """Monthly production allowance; None means unlimited."""
    return limits_for(plan)["productions_per_month"]


# ---------- Advertising ----------
# Ads are decided server-side for two reasons: a client bug can never show one
# to a Pro user, and the frequency can be retuned without an App Store release.
def ads_allowed(plan: str) -> bool:
    """Only Free users may ever be shown an ad.

    Deliberately phrased as "not Free" being ad-free, never as an enumerated
    allow-list of paid tiers. `PLAN_LIMITS` only has FREE/PRO today, but a
    future Pro+ or Équipe tier becomes ad-free automatically the moment
    `resolve_plan()` returns anything other than FREE for it — no change
    needed here. Rewriting this as `plan in (PRO, PRO_PLUS, TEAM)` would
    silently start showing ads to any future tier someone forgets to list.
    """
    return plan == FREE


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int, minimum: int) -> int:
    """An int from the environment, floored.

    The floor matters: a misconfigured interval of 0 would ask the app to
    insert an ad between every item forever.
    """
    try:
        return max(minimum, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def ads_config(plan: str) -> dict:
    """What the app is allowed to display for this user.

    `ADS_ENABLED` is the single kill switch, and it defaults to **off**:
    turning ads on while Baker Pro cannot actually be bought would impose them
    on every user with no way out. It is meant to be flipped the day an in-app
    purchase exists.
    """
    available = _env_flag("ADS_ENABLED")
    on = available and ads_allowed(plan)
    return {
        # Whether Baker serves ads at all, regardless of this user's plan. Lets
        # the Pro screen promise "no ads" only while that promise means something.
        "available": available,
        "enabled": on,
        "network": (os.environ.get("ADS_NETWORK", "").strip() or "none") if on else "none",
        # Home: a single slot, between two sections.
        "home_slot": on,
        # Recipe list: first slot after N cards, then one every M.
        "list_first_slot": _env_int("ADS_LIST_FIRST_SLOT", 6, 1),
        "list_interval": _env_int("ADS_LIST_INTERVAL", 10, 1),
    }
