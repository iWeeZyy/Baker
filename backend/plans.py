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
