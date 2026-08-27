"""Classifies an uploaded message photo as normal / sensitive / blocked.

The rule the rest of the app builds on: a "potentially sexual" photo is never
blocked outright. It is sent, but the recipient sees it blurred behind a
warning until they choose to reveal it. Only content the provider scores as
unambiguously explicit is refused at send time.

Provider: Sightengine's nudity detection API. Chosen over Google Cloud Vision
SafeSearch and AWS Rekognition for this project specifically because it needs
only a lightweight API user/secret pair from a web signup — no cloud console,
no billing account, no IAM — which matches how this app already onboards a
single-purpose API key (see PEXELS_API_KEY). Its free tier (2,000 checks／month,
capped at 500/day, no surprise overage billing) comfortably covers a
friends-only messaging feature at this app's scale, and Sightengine states
end-user images can be deleted immediately after processing rather than
retained (see https://sightengine.com/security and their DPA) — relevant
since these are private, personal photos (point 10 of the message-photo spec).

The three-class classic `nudity` model (raw / partial / safe) is used rather
than the newer, far more granular `nudity-2.1` model: its field names have
been stable for years and are widely documented, which matters because
sightengine.com was unreachable from the environment this integration was
written in (network policy), so the exact 2.1 payload could not be verified
against a live call before writing this client. `_sightengine_score` isolates
the one HTTP call and the one bit of payload-parsing that would need
revisiting if that assumption turns out wrong — everything else in this
module is provider-agnostic.

Two thresholds turn the provider's score into one of three levels, read from
the environment (MODERATION_SENSITIVE_THRESHOLD, MODERATION_BLOCK_THRESHOLD)
so they can be retuned without a rebuild, per the spec. `classify()` is pure
and takes plain floats, so the threshold logic is unit-tested directly without
any network access — same pattern as production.py / staff.py / costing.py.
"""
import logging
import os
from dataclasses import dataclass

import requests

logger = logging.getLogger(__name__)

NORMAL = "normal"
SENSITIVE = "sensitive"
BLOCKED = "blocked"

PROVIDER = os.environ.get("MODERATION_PROVIDER", "sightengine").strip().lower()
SIGHTENGINE_API_USER = os.environ.get("SIGHTENGINE_API_USER", "").strip()
SIGHTENGINE_API_SECRET = os.environ.get("SIGHTENGINE_API_SECRET", "").strip()
SIGHTENGINE_URL = "https://api.sightengine.com/1.0/check.json"
SIGHTENGINE_TIMEOUT = 10  # seconds — keeps "Vérification de l'image…" from stalling a send

# Score thresholds against the provider's explicit-content likelihood, 0..1.
SENSITIVE_THRESHOLD = float(os.environ.get("MODERATION_SENSITIVE_THRESHOLD", "0.30"))
BLOCK_THRESHOLD = float(os.environ.get("MODERATION_BLOCK_THRESHOLD", "0.90"))

# What a message gets tagged as when the provider can't be reached, isn't
# configured, or errors. Never "normal": an unanalyzed photo must not be
# presented as safe by default (spec point 16).
FALLBACK_LEVEL = os.environ.get("MODERATION_FALLBACK", SENSITIVE).strip().lower()
if FALLBACK_LEVEL not in (NORMAL, SENSITIVE, BLOCKED):
    FALLBACK_LEVEL = SENSITIVE


@dataclass
class ModerationResult:
    level: str      # normal | sensitive | blocked
    score: float    # the explicit-content score that drove the decision, 0..1
    provider: str   # "sightengine" | "stub" | "fallback"
    status: str     # "checked" | "unavailable"


def classify(raw: float, partial: float) -> tuple:
    """Pure threshold logic — no network, no I/O. Returns (level, score).

    `raw` (full nudity) is the only score that can reach BLOCKED. `partial`
    (partial nudity / suggestive) can only ever push a photo to SENSITIVE,
    never to BLOCKED — per the spec, potential nudity alone is never treated
    as forbidden, only unambiguous, fully explicit content is.
    """
    if raw >= BLOCK_THRESHOLD:
        return BLOCKED, raw
    if raw >= SENSITIVE_THRESHOLD or partial >= SENSITIVE_THRESHOLD:
        return SENSITIVE, max(raw, partial)
    return NORMAL, max(raw, partial)


def _sightengine_score(image_bytes: bytes) -> tuple:
    """Calls Sightengine's classic nudity model. Raises on any failure —
    the caller (`analyze`) turns that into the configured fallback level.
    Returns (raw, partial).
    """
    if not (SIGHTENGINE_API_USER and SIGHTENGINE_API_SECRET):
        raise RuntimeError("Sightengine credentials not configured")
    resp = requests.post(
        SIGHTENGINE_URL,
        files={"media": ("photo.jpg", image_bytes, "image/jpeg")},
        data={
            "models": "nudity",
            "api_user": SIGHTENGINE_API_USER,
            "api_secret": SIGHTENGINE_API_SECRET,
        },
        timeout=SIGHTENGINE_TIMEOUT,
    )
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("status") != "success":
        raise RuntimeError(f"Sightengine returned an error: {payload}")
    nudity = payload.get("nudity", {})
    return float(nudity.get("raw", 0.0)), float(nudity.get("partial", 0.0))


def _stub_score(image_bytes: bytes) -> tuple:
    """Deterministic, network-free stand-in for Sightengine, used only when
    MODERATION_PROVIDER=stub (test suite / local dev without credentials —
    never set in production). Classifies by the image's own average colour
    rather than its filename or any metadata, so it still exercises real
    image bytes end to end: a solid red swatch simulates raw explicit
    content, solid orange simulates partial/suggestive content, solid blue
    simulates a provider outage (for testing the fallback path), anything
    else is safe.
    """
    import io
    from PIL import Image

    with Image.open(io.BytesIO(image_bytes)) as im:
        r, g, b = im.convert("RGB").resize((1, 1)).getpixel((0, 0))
    if r < 80 and g < 80 and b > 200:
        raise RuntimeError("stub: simulated provider outage")
    if r > 200 and g < 80 and b < 80:
        return 0.97, 0.0
    if r > 200 and 100 <= g <= 180 and b < 80:
        return 0.0, 0.6
    return 0.02, 0.02


def analyze(image_bytes: bytes) -> ModerationResult:
    """The single entry point the server calls before storing a photo
    message. Never raises: a provider failure becomes the configured
    fallback level instead of aborting the send (spec point 16 — "ne fais
    pas planter l'envoi").
    """
    try:
        if PROVIDER == "stub":
            raw, partial = _stub_score(image_bytes)
        elif PROVIDER == "off":
            raise RuntimeError("Image moderation explicitly disabled")
        else:
            raw, partial = _sightengine_score(image_bytes)
    except Exception as exc:
        logger.warning("Image moderation unavailable (falling back to '%s'): %s", FALLBACK_LEVEL, exc)
        return ModerationResult(level=FALLBACK_LEVEL, score=0.0, provider="fallback", status="unavailable")
    level, score = classify(raw, partial)
    return ModerationResult(level=level, score=score, provider=PROVIDER, status="checked")
