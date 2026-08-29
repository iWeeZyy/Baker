"""
Catalogue des badges — mêmes principes que `families.py`/`products.py` : une
liste Python statique, jamais une collection Mongo synchronisée au démarrage.
La condition de déblocage d'un badge est du code exécutable (une fonction ne
peut pas vivre proprement dans une description figée en base), donc la garder
uniquement ici évite de la dupliquer entre un `requirement` stocké et
l'évaluateur qui le lit — une seule source de vérité. Seul `db.user_badges`
(quel badge, pour quel utilisateur, depuis quand) est en base : c'est la seule
partie qui a vraiment un cycle de vie par utilisateur.

Cinq familles de condition (jamais un moteur générique tout-terrain) :
  - "event_count"      : compte les lignes de `db.user_xp_events` d'une
                          nature donnée pour l'utilisateur (le registre XP sert
                          aussi de source de progression, sans compteur séparé)
                          — sauf "recipe_published"/"creation_published", qui
                          comptent directement `db.recipes`/`db.creations`
                          (voir `_DIRECT_COUNT_SOURCES` : le plafond journalier
                          anti-abus de l'XP ne doit jamais ralentir une
                          progression de badge légitime).
  - "special_counter"  : lit un champ dénormalisé sur `db.user_levels`
                          (`current_streak`) — la seule condition qui a besoin
                          d'un état qui ne se déduit ni du registre XP ni
                          d'une autre collection déjà indexée.
  - "levain_recipes"   : compte `db.recipes` de l'utilisateur dont un
                          ingrédient contient "levain" — une requête directe
                          sur une collection déjà indexée par `author_id`,
                          jamais un compteur dénormalisé à maintenir en plus.
  - "leaderboard_rank" : évalué paresseusement à la lecture du classement
                          (aucun événement d'écriture n'y correspond), jamais
                          à l'écriture — voir `check_leaderboard_badges`.
  - "hidden_time_window": la seule condition du badge caché démonstratif
                          (section 17 de la demande, explicitement optionnelle).

`check_badges_after_event()` n'évalue jamais l'ensemble du catalogue : une
table `_EVENT_TO_BADGES`, construite une fois à l'import, ne retient que les
badges dont la nature d'événement correspond à celle qui vient de se produire
— réponse directe à "ne pas recalculer tous les badges à chaque événement".
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from pymongo.errors import DuplicateKeyError

BADGES: List[dict] = [
    # ---------- Boulanger (recettes) ----------
    {"id": "first_recipe", "name": "Première recette", "description": "Publier sa première recette.",
     "category": "boulanger", "icon": "🥖", "rarity": "commun", "hidden": False,
     "requirement": {"kind": "event_count", "event": "recipe_published", "threshold": 1}},
    {"id": "recipes_10", "name": "Collectionneur", "description": "Publier 10 recettes.",
     "category": "boulanger", "icon": "🥖", "rarity": "rare", "hidden": False,
     "requirement": {"kind": "event_count", "event": "recipe_published", "threshold": 10}},
    {"id": "recipes_50", "name": "Bibliothèque", "description": "Publier 50 recettes.",
     "category": "boulanger", "icon": "🥖", "rarity": "epique", "hidden": False,
     "requirement": {"kind": "event_count", "event": "recipe_published", "threshold": 50}},
    {"id": "recipes_100", "name": "Maître des recettes", "description": "Publier 100 recettes.",
     "category": "boulanger", "icon": "🥖", "rarity": "legendaire", "hidden": False,
     "requirement": {"kind": "event_count", "event": "recipe_published", "threshold": 100}},
    {"id": "levain_10", "name": "Maître du levain", "description": "Publier 10 recettes utilisant du levain.",
     "category": "boulanger", "icon": "🌾", "rarity": "epique", "hidden": False,
     "requirement": {"kind": "levain_recipes", "threshold": 10}},

    # ---------- Créateur (créations) ----------
    {"id": "first_creation", "name": "Première création", "description": "Publier sa première création.",
     "category": "createur", "icon": "📸", "rarity": "commun", "hidden": False,
     "requirement": {"kind": "event_count", "event": "creation_published", "threshold": 1}},
    {"id": "creations_25", "name": "Créateur", "description": "Publier 25 créations.",
     "category": "createur", "icon": "📸", "rarity": "rare", "hidden": False,
     "requirement": {"kind": "event_count", "event": "creation_published", "threshold": 25}},
    {"id": "creation_likes_500", "name": "Artiste", "description": "Recevoir 500 likes sur ses créations.",
     "category": "createur", "icon": "📸", "rarity": "legendaire", "hidden": False,
     "requirement": {"kind": "event_count", "event": "like_received", "threshold": 500,
                      "meta_filter": {"content_type": "creation"}}},

    # ---------- Communauté (likes / commentaires reçus) ----------
    {"id": "likes_10", "name": "Premiers encouragements", "description": "Recevoir 10 likes.",
     "category": "communaute", "icon": "❤️", "rarity": "commun", "hidden": False,
     "requirement": {"kind": "event_count", "event": "like_received", "threshold": 10}},
    {"id": "likes_100", "name": "Apprécié", "description": "Recevoir 100 likes.",
     "category": "communaute", "icon": "❤️", "rarity": "rare", "hidden": False,
     "requirement": {"kind": "event_count", "event": "like_received", "threshold": 100}},
    {"id": "likes_500", "name": "Populaire", "description": "Recevoir 500 likes.",
     "category": "communaute", "icon": "❤️", "rarity": "epique", "hidden": False,
     "requirement": {"kind": "event_count", "event": "like_received", "threshold": 500}},
    {"id": "comments_50", "name": "Actif", "description": "Recevoir 50 commentaires.",
     "category": "communaute", "icon": "💬", "rarity": "rare", "hidden": False,
     "requirement": {"kind": "event_count", "event": "comment_received", "threshold": 50}},

    # ---------- Social (amis / abonnés) ----------
    {"id": "first_friend", "name": "Premier ami", "description": "Avoir son premier ami.",
     "category": "social", "icon": "👥", "rarity": "commun", "hidden": False,
     "requirement": {"kind": "event_count", "event": "friend_made", "threshold": 1}},
    {"id": "friends_25", "name": "Réseau", "description": "Avoir 25 amis.",
     "category": "social", "icon": "👥", "rarity": "epique", "hidden": False,
     "requirement": {"kind": "event_count", "event": "friend_made", "threshold": 25}},
    {"id": "followers_100", "name": "Suivi", "description": "Obtenir 100 abonnés.",
     "category": "social", "icon": "👤", "rarity": "rare", "hidden": False,
     "requirement": {"kind": "event_count", "event": "new_follower", "threshold": 100}},
    {"id": "followers_500", "name": "Influence", "description": "Obtenir 500 abonnés.",
     "category": "social", "icon": "👤", "rarity": "legendaire", "hidden": False,
     "requirement": {"kind": "event_count", "event": "new_follower", "threshold": 500}},

    # ---------- Classement (évalués paresseusement, jamais à l'écriture) ----------
    {"id": "top_100", "name": "Top 100", "description": "Entrer dans le Top 100 du classement Créateurs.",
     "category": "classement", "icon": "🏆", "rarity": "commun", "hidden": False,
     "requirement": {"kind": "leaderboard_rank", "category": "creators", "threshold": 100}},
    {"id": "top_50", "name": "Top 50", "description": "Entrer dans le Top 50 du classement Créateurs.",
     "category": "classement", "icon": "🏆", "rarity": "rare", "hidden": False,
     "requirement": {"kind": "leaderboard_rank", "category": "creators", "threshold": 50}},
    {"id": "top_10", "name": "Top 10", "description": "Entrer dans le Top 10 du classement Créateurs.",
     "category": "classement", "icon": "🏆", "rarity": "epique", "hidden": False,
     "requirement": {"kind": "leaderboard_rank", "category": "creators", "threshold": 10}},
    {"id": "rank_1", "name": "Numéro 1", "description": "Atteindre la première place du classement Créateurs.",
     "category": "classement", "icon": "🥇", "rarity": "legendaire", "hidden": False,
     "requirement": {"kind": "leaderboard_rank", "category": "creators", "threshold": 1}},

    # ---------- Régularité ----------
    {"id": "streak_3", "name": "Régulier", "description": "Être actif 3 jours consécutifs.",
     "category": "regularite", "icon": "🔥", "rarity": "commun", "hidden": False,
     "requirement": {"kind": "special_counter", "field": "current_streak", "threshold": 3}},
    {"id": "streak_14", "name": "Assidu", "description": "Être actif 14 jours consécutifs.",
     "category": "regularite", "icon": "🔥", "rarity": "epique", "hidden": False,
     "requirement": {"kind": "special_counter", "field": "current_streak", "threshold": 14}},
    {"id": "night_owl", "name": "Nocturne", "description": "Effectuer une action sur Bakers entre minuit et 5h du matin.",
     "category": "regularite", "icon": "🌙", "rarity": "rare", "hidden": True,
     "requirement": {"kind": "hidden_time_window", "hour_start": 0, "hour_end": 5}},
]

# Les badges "publier N recettes/créations" comptent directement depuis
# db.recipes/db.creations plutôt que depuis le registre XP : le plafond
# journalier de l'action (défense en profondeur contre le farming d'XP, voir
# gamification.XP_RULES) ne doit jamais ralentir une progression de badge
# légitime — un utilisateur qui importe 20 recettes réelles en une session
# (via le scan, par exemple) a bien 20 recettes publiées, même si seule une
# partie de cette session a rapporté de l'XP ce jour-là. Les likes/
# commentaires reçus restent comptés depuis le registre : leur plafond
# journalier est assez large pour ne jamais fausser une progression réaliste.
_DIRECT_COUNT_SOURCES = {
    "recipe_published": lambda db, user_id: db.recipes.count_documents({"author_id": user_id, "is_user_submitted": True}),
    "creation_published": lambda db, user_id: db.creations.count_documents({"user_id": user_id}),
}

_BY_ID: Dict[str, dict] = {b["id"]: b for b in BADGES}

# Construites une fois à l'import — jamais recalculées par requête.
_EVENT_TO_BADGES: Dict[str, List[str]] = {}
_GLOBAL_BADGE_IDS: List[str] = []
_LEADERBOARD_BADGES: List[dict] = []
for _b in BADGES:
    _req = _b["requirement"]
    if _req["kind"] == "event_count":
        _EVENT_TO_BADGES.setdefault(_req["event"], []).append(_b["id"])
    elif _req["kind"] == "levain_recipes":
        _EVENT_TO_BADGES.setdefault("recipe_published", []).append(_b["id"])
    elif _req["kind"] == "special_counter" and _req["field"] == "current_streak":
        _GLOBAL_BADGE_IDS.append(_b["id"])
    elif _req["kind"] == "hidden_time_window":
        _GLOBAL_BADGE_IDS.append(_b["id"])
    elif _req["kind"] == "leaderboard_rank":
        _LEADERBOARD_BADGES.append(_b)


def public_badge(badge: dict, unlocked: bool) -> dict:
    """Jamais le `requirement` brut au client (même prudence que la
    modération de texte : ne pas exposer le mécanisme exact). Un badge caché
    encore verrouillé est rendu en "???" — révélé une fois obtenu, jamais
    avant, conformément à la section 17."""
    masked = badge.get("hidden") and not unlocked
    return {
        "id": badge["id"],
        "name": "???" if masked else badge["name"],
        "description": None if masked else badge["description"],
        "category": badge["category"],
        "icon": "🔒" if masked else badge["icon"],
        "rarity": badge["rarity"],
        "hidden": badge.get("hidden", False),
    }


async def _event_count(db, user_id: str, req: dict) -> int:
    event = req["event"]
    direct = _DIRECT_COUNT_SOURCES.get(event)
    if direct is not None and not req.get("meta_filter"):
        return await direct(db, user_id)
    q: dict = {"user_id": user_id, "kind": event}
    for k, v in (req.get("meta_filter") or {}).items():
        q[f"meta.{k}"] = v
    return await db.user_xp_events.count_documents(q)


async def _levain_recipe_count(db, user_id: str) -> int:
    return await db.recipes.count_documents({
        "author_id": user_id, "is_user_submitted": True,
        "ingredients": {"$regex": "levain", "$options": "i"},
    })


async def _is_unlocked(db, user_id: str, badge: dict, context: Optional[dict]) -> bool:
    req = badge["requirement"]
    kind = req["kind"]
    if kind == "event_count":
        count = await _event_count(db, user_id, req)
        return count >= req["threshold"]
    if kind == "levain_recipes":
        count = await _levain_recipe_count(db, user_id)
        return count >= req["threshold"]
    if kind == "special_counter":
        row = await db.user_levels.find_one({"user_id": user_id}, {"_id": 0, req["field"]: 1})
        return ((row or {}).get(req["field"]) or 0) >= req["threshold"]
    if kind == "hidden_time_window":
        hour = (context or {}).get("hour_utc")
        return hour is not None and req["hour_start"] <= hour < req["hour_end"]
    return False


async def check_badges_after_event(db, user_id: str, event_kind: str, context: Optional[dict] = None) -> List[dict]:
    """N'évalue que les badges candidats pour `event_kind` (plus les quelques
    badges "globaux" — régularité et le badge caché — qui peuvent se
    déclencher après n'importe quelle action XP). Retourne les badges
    nouvellement débloqués (jamais déjà obtenus)."""
    candidates = list(dict.fromkeys(_EVENT_TO_BADGES.get(event_kind, []) + _GLOBAL_BADGE_IDS))
    if not candidates:
        return []
    already = set()
    async for d in db.user_badges.find({"user_id": user_id, "badge_id": {"$in": candidates}}, {"_id": 0, "badge_id": 1}):
        already.add(d["badge_id"])
    now = datetime.now(timezone.utc)
    unlocked = []
    for badge_id in candidates:
        if badge_id in already:
            continue
        badge = _BY_ID[badge_id]
        if not await _is_unlocked(db, user_id, badge, context):
            continue
        try:
            await db.user_badges.insert_one({"user_id": user_id, "badge_id": badge_id, "unlocked_at": now})
        except DuplicateKeyError:
            continue
        unlocked.append(badge)
    return unlocked


async def check_leaderboard_badges(db, user_id: str, rank: Optional[int]) -> List[dict]:
    """Seule famille de badge évaluée à la lecture plutôt qu'à l'écriture —
    un rang n'a de sens qu'au moment où le classement est calculé, et
    `GET /leaderboard/creators` calcule déjà `my_rank` pour l'appelant."""
    if rank is None:
        return []
    candidates = [b["id"] for b in _LEADERBOARD_BADGES if rank <= b["requirement"]["threshold"]]
    if not candidates:
        return []
    already = set()
    async for d in db.user_badges.find({"user_id": user_id, "badge_id": {"$in": candidates}}, {"_id": 0, "badge_id": 1}):
        already.add(d["badge_id"])
    now = datetime.now(timezone.utc)
    unlocked = []
    for badge_id in candidates:
        if badge_id in already:
            continue
        try:
            await db.user_badges.insert_one({"user_id": user_id, "badge_id": badge_id, "unlocked_at": now})
        except DuplicateKeyError:
            continue
        unlocked.append(_BY_ID[badge_id])
    return unlocked


async def badge_progress(db, user_id: str, badge: dict) -> dict:
    """Progression d'un badge verrouillé pour l'écran de détail / la page
    Mes badges (section 26) — quelques `count_documents` indexés par
    utilisateur, jamais un recalcul pour l'ensemble des utilisateurs."""
    req = badge["requirement"]
    kind = req["kind"]
    if kind == "event_count":
        current = await _event_count(db, user_id, req)
        return {"current": current, "threshold": req["threshold"]}
    if kind == "levain_recipes":
        current = await _levain_recipe_count(db, user_id)
        return {"current": current, "threshold": req["threshold"]}
    if kind == "special_counter":
        row = await db.user_levels.find_one({"user_id": user_id}, {"_id": 0, req["field"]: 1})
        current = (row or {}).get(req["field"]) or 0
        return {"current": current, "threshold": req["threshold"]}
    # Le rang au classement et le badge caché n'ont pas de fraction "N/seuil"
    # significative à afficher — jamais une progression inventée.
    return {"current": None, "threshold": None}
