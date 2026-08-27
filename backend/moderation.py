"""Classe une photo de message en normale / sensible / bloquée.

La règle sur laquelle repose tout le reste : une photo « potentiellement
sexuelle » n'est jamais bloquée d'office. Elle est envoyée, mais le
destinataire la voit floutée derrière un avertissement tant qu'il n'a pas
choisi de l'afficher. Seul un contenu que le fournisseur note comme
explicite sans ambiguïté est refusé à l'envoi.

Fournisseur : l'API de détection de nudité de Sightengine. Préférée à Google
Cloud Vision SafeSearch et à AWS Rekognition pour ce projet précisément parce
qu'elle ne demande qu'une simple paire utilisateur/secret obtenue par
inscription — pas de console cloud, pas de compte de facturation, pas d'IAM —
ce qui correspond à la façon dont l'application intègre déjà une clé à usage
unique (voir PEXELS_API_KEY). Son palier gratuit (2 000 vérifications/mois,
plafonné à 500/jour, sans facturation surprise en cas de dépassement) couvre
largement une messagerie entre amis à l'échelle de cette application, et
Sightengine indique pouvoir supprimer les images d'un utilisateur final
immédiatement après traitement plutôt que les conserver (voir
https://sightengine.com/security et leur DPA) — ce qui compte puisqu'il
s'agit de photos privées et personnelles (point 10 du cahier des charges).

Le modèle classique à trois classes `nudity` (raw / partial / safe) est
utilisé plutôt que le modèle `nudity-2.1`, bien plus récent et granulaire :
ses noms de champs sont stables et documentés depuis des années, ce qui
compte car sightengine.com était inaccessible depuis l'environnement où cette
intégration a été écrite (politique réseau), donc le format exact de la
réponse 2.1 n'a pas pu être vérifié par un appel réel avant l'écriture de ce
client. `_sightengine_score` isole le seul appel HTTP et le seul bout
d'analyse de réponse qu'il faudrait revoir si cette hypothèse s'avère
fausse — tout le reste de ce module est indépendant du fournisseur.

Deux seuils transforment le score du fournisseur en l'un des trois niveaux,
lus depuis l'environnement (MODERATION_SENSITIVE_THRESHOLD,
MODERATION_BLOCK_THRESHOLD) afin de pouvoir être retouchés sans reconstruire
l'application, comme demandé. `classify()` est pure et prend de simples
flottants, ce qui permet de tester la logique de seuil directement, sans
aucun accès réseau — même principe que production.py / staff.py / costing.py.
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
SIGHTENGINE_TIMEOUT = 10  # secondes — évite que « Vérification de l'image… » ne bloque un envoi

# Seuils appliqués au score de contenu explicite du fournisseur, entre 0 et 1.
SENSITIVE_THRESHOLD = float(os.environ.get("MODERATION_SENSITIVE_THRESHOLD", "0.30"))
BLOCK_THRESHOLD = float(os.environ.get("MODERATION_BLOCK_THRESHOLD", "0.90"))

# Le niveau attribué à une photo quand le fournisseur est injoignable, non
# configuré, ou renvoie une erreur. Jamais "normal" : une photo non analysée
# ne doit jamais être présentée comme sûre par défaut (point 16 du cahier
# des charges).
FALLBACK_LEVEL = os.environ.get("MODERATION_FALLBACK", SENSITIVE).strip().lower()
if FALLBACK_LEVEL not in (NORMAL, SENSITIVE, BLOCKED):
    FALLBACK_LEVEL = SENSITIVE


@dataclass
class ModerationResult:
    level: str      # normal | sensitive | blocked
    score: float    # le score de contenu explicite qui a motivé la décision, 0..1
    provider: str   # "sightengine" | "stub" | "fallback"
    status: str     # "checked" | "unavailable"


def classify(raw: float, partial: float) -> tuple:
    """Logique de seuil pure — ni réseau, ni entrée/sortie. Renvoie (niveau, score).

    Seul `raw` (nudité complète) peut atteindre BLOCKED. `partial` (nudité
    partielle / suggestive) ne peut jamais faire plus que pousser une photo
    vers SENSITIVE, jamais vers BLOCKED — conformément au cahier des
    charges, une nudité potentielle seule n'est jamais traitée comme
    interdite ; seul un contenu explicite sans ambiguïté l'est.
    """
    if raw >= BLOCK_THRESHOLD:
        return BLOCKED, raw
    if raw >= SENSITIVE_THRESHOLD or partial >= SENSITIVE_THRESHOLD:
        return SENSITIVE, max(raw, partial)
    return NORMAL, max(raw, partial)


def _sightengine_score(image_bytes: bytes) -> tuple:
    """Appelle le modèle classique de nudité de Sightengine. Lève une
    exception en cas d'échec — c'est l'appelant (`analyze`) qui la
    transforme en niveau de repli. Renvoie (raw, partial).
    """
    if not (SIGHTENGINE_API_USER and SIGHTENGINE_API_SECRET):
        raise RuntimeError("Identifiants Sightengine non configurés")
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
        raise RuntimeError(f"Sightengine a renvoyé une erreur : {payload}")
    nudity = payload.get("nudity", {})
    return float(nudity.get("raw", 0.0)), float(nudity.get("partial", 0.0))


def _stub_score(image_bytes: bytes) -> tuple:
    """Simulacre déterministe et sans réseau de Sightengine, utilisé
    uniquement quand MODERATION_PROVIDER=stub (suite de tests / développement
    local sans identifiants — jamais en production). Classe selon la couleur
    moyenne de l'image elle-même, pas selon son nom de fichier ni aucune
    métadonnée, pour continuer à exercer de vrais octets d'image de bout en
    bout : un aplat rouge simule un contenu explicite (raw), un aplat orange
    simule un contenu partiel/suggestif, un aplat bleu simule une panne du
    fournisseur (pour tester le repli), tout le reste est sans danger.
    """
    import io
    from PIL import Image

    with Image.open(io.BytesIO(image_bytes)) as im:
        r, g, b = im.convert("RGB").resize((1, 1)).getpixel((0, 0))
    if r < 80 and g < 80 and b > 200:
        raise RuntimeError("stub : panne du fournisseur simulée")
    if r > 200 and g < 80 and b < 80:
        return 0.97, 0.0
    if r > 200 and 100 <= g <= 180 and b < 80:
        return 0.0, 0.6
    return 0.02, 0.02


def analyze(image_bytes: bytes) -> ModerationResult:
    """Le point d'entrée unique appelé par le serveur avant de stocker une
    photo de message. Ne lève jamais d'exception : un échec du fournisseur
    devient le niveau de repli configuré plutôt que de faire échouer l'envoi
    (point 16 du cahier des charges — « ne fais pas planter l'envoi »).
    """
    try:
        if PROVIDER == "stub":
            raw, partial = _stub_score(image_bytes)
        elif PROVIDER == "off":
            raise RuntimeError("Modération d'image explicitement désactivée")
        else:
            raw, partial = _sightengine_score(image_bytes)
    except Exception as exc:
        logger.warning("Modération d'image indisponible (repli sur '%s') : %s", FALLBACK_LEVEL, exc)
        return ModerationResult(level=FALLBACK_LEVEL, score=0.0, provider="fallback", status="unavailable")
    level, score = classify(raw, partial)
    return ModerationResult(level=level, score=score, provider=PROVIDER, status="checked")
