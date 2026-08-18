"""Free / Pro plan definitions.

Single source of truth for what each plan allows. Kept apart from server.py so
the limits can be reasoned about (and tested) on their own, and so plugging a
real billing provider in later only touches `resolve_plan`.
"""
import os
from typing import Optional

FREE = "free"
PRO = "pro"

# `None` means unlimited. Feature flags are declared here even when the feature
# is not built yet, so shipping one later is a flag flip rather than a redesign.
PLAN_LIMITS = {
    FREE: {
        "productions_per_month": 3,
        "multi_day": False,
        "recurring": False,
        "sharing": False,
        "full_history": False,
    },
    PRO: {
        "productions_per_month": None,
        "multi_day": True,
        "recurring": True,
        "sharing": True,
        "full_history": True,
    },
}


def _pro_emails() -> set:
    """Emails granted Pro, from the PRO_EMAILS env var (comma-separated).

    There is no billing provider yet. This is the honest stand-in: it lives
    server-side, so it cannot be forged by a client, and swapping it for a real
    subscription check later means rewriting only this function.
    """
    raw = os.environ.get("PRO_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def resolve_plan(user: dict) -> str:
    """The plan actually in force for a user, never trusting client input."""
    if (user.get("email") or "").lower() in _pro_emails():
        return PRO
    return PRO if user.get("plan") == PRO else FREE


def limits_for(plan: str) -> dict:
    return PLAN_LIMITS.get(plan, PLAN_LIMITS[FREE])


def production_quota(plan: str) -> Optional[int]:
    """Monthly production allowance; None means unlimited."""
    return limits_for(plan)["productions_per_month"]


# ---------- Advertising ----------
# Ads are decided server-side for two reasons: a client bug can never show one
# to a Pro user, and the frequency can be retuned without an App Store release.
def ads_allowed(plan: str) -> bool:
    """Only Free users may ever be shown an ad."""
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
