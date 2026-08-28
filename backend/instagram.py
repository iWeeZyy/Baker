"""Validation d'un identifiant Instagram — pur, sans DB ni réseau, même
famille que `production.py`/`text_moderation.py`.

Le problème que ce module résout : un utilisateur peut coller un nom
d'utilisateur nu (`lucas_boulanger`), préfixé (`@lucas_boulanger`) ou une URL
Instagram complète (avec ou sans `www.`, `http(s)://`, slash final, query
string). Dans tous les cas, seul le nom d'utilisateur est retenu et stocké —
jamais une URL — pour qu'il n'existe qu'une seule donnée à partir de laquelle
`instagram_profile_url()` reconstruit le lien à l'affichage. C'est aussi ce
qui empêche de stocker un lien vers un domaine arbitraire : une URL qui n'est
pas sur `instagram.com`/`www.instagram.com` est rejetée avant même d'en
extraire quoi que ce soit.

`frontend/src/instagram.ts` est un miroir exact de ces règles ; les deux
doivent toujours changer ensemble.
"""
import re
from urllib.parse import urlparse

USERNAME_RE = re.compile(r"^[A-Za-z0-9._]{1,30}$")
INSTAGRAM_HOSTS = {"instagram.com", "www.instagram.com"}


def parse_instagram_username(raw: str) -> str:
    """Renvoie le nom d'utilisateur validé, ou lève `ValueError` si `raw`
    n'est ni un nom d'utilisateur plausible ni une URL Instagram valide."""
    text = (raw or "").strip()
    if not text:
        raise ValueError("Identifiant Instagram vide")

    candidate = text
    lower = text.lower()
    looks_like_url = "://" in text or lower.startswith("instagram.com") or lower.startswith("www.instagram.com")
    if looks_like_url:
        url = text if "://" in text else f"https://{text}"
        parsed = urlparse(url)
        if parsed.hostname is None or parsed.hostname.lower() not in INSTAGRAM_HOSTS:
            raise ValueError("Seuls les liens instagram.com sont acceptés")
        segments = [s for s in parsed.path.split("/") if s]
        if not segments:
            raise ValueError("Lien Instagram sans nom d'utilisateur")
        candidate = segments[0]
    elif candidate.startswith("@"):
        candidate = candidate[1:]

    if not USERNAME_RE.match(candidate):
        raise ValueError("Nom d'utilisateur Instagram invalide")
    return candidate


def instagram_profile_url(username: str) -> str:
    """Construite uniquement à l'affichage — jamais stockée."""
    return f"https://www.instagram.com/{username}/"
