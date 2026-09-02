"""
Niveaux et XP — progression Levanea.

Module pur (aucune route ici), même famille que `production.py`/`leaderboard.py`.
Contrairement au classement (`leaderboard.py`), qui recalcule tout à la lecture,
ce module est **incrémental** : chaque action XP-éligible passe par `award_xp()`,
qui met à jour une seule fois `db.user_levels` au moment de l'événement — jamais
un recalcul complet à l'ouverture d'un profil.

Anti-abus : `award_xp()` exige une clé d'idempotence unique par événement
(`event_key`), portée par un index unique sur `db.user_xp_events.event_key` —
même idiome `try/except DuplicateKeyError` déjà utilisé par
`toggle_like`/`toggle_follow`/`_create_friendship` dans server.py. Un like
retiré-puis-remis par la même personne, un follow/unfollow/follow, ou une
double soumission ne peuvent donc jamais réattribuer la même récompense — la
clé encode la relation elle-même (ex. "like_received:recipe:{id}:{liker_id}"),
pas un simple compteur qu'il faudrait protéger séparément. Les actions
répétables à volonté avec un nouvel identifiant à chaque fois (écrire un
commentaire, publier) sont en plus bornées par un plafond journalier ou à vie
par nature d'événement (`XP_RULES`), vérifié sur le même index — défense en
profondeur, pas une détection comportementale.

Barème ancré sur la pondération déjà validée par `leaderboard.py` (recette
publiée > commentaire reçu > like reçu, un like coûtant moins cher à obtenir
qu'un commentaire ou un abonné), à une échelle multipliée pour que 20 niveaux
représentent plusieurs mois d'activité réelle plutôt que quelques heures.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional

from pymongo.errors import DuplicateKeyError

# ---------- Niveaux ----------
# XP cumulé requis pour ATTEINDRE chaque niveau (niveau 1 = 0). Une simple
# liste ordonnée : ajouter un niveau plus tard ne demande qu'une ligne de plus
# ici, jamais un changement de logique.
LEVELS = [
    {"level": 1, "title": "Débutant", "xp_required": 0},
    {"level": 2, "title": "Apprenti", "xp_required": 80},
    {"level": 3, "title": "Aide-boulanger", "xp_required": 200},
    {"level": 4, "title": "Boulanger", "xp_required": 380},
    {"level": 5, "title": "Boulanger confirmé", "xp_required": 620},
    {"level": 6, "title": "Ouvrier", "xp_required": 920},
    {"level": 7, "title": "Artisan", "xp_required": 1300},
    {"level": 8, "title": "Artisan confirmé", "xp_required": 1750},
    {"level": 9, "title": "Expert", "xp_required": 2280},
    {"level": 10, "title": "Expert confirmé", "xp_required": 2900},
    {"level": 11, "title": "Chef de fournil", "xp_required": 3600},
    {"level": 12, "title": "Chef de fournil confirmé", "xp_required": 4400},
    {"level": 13, "title": "Maître du fournil", "xp_required": 5300},
    {"level": 14, "title": "Maître du fournil confirmé", "xp_required": 6300},
    {"level": 15, "title": "Virtuose de la pâte", "xp_required": 7400},
    {"level": 16, "title": "Virtuose confirmé", "xp_required": 8600},
    {"level": 17, "title": "Figure de la communauté", "xp_required": 9900},
    {"level": 18, "title": "Référence Levanea", "xp_required": 11300},
    {"level": 19, "title": "Légende du fournil", "xp_required": 12800},
    {"level": 20, "title": "Légende de Levanea", "xp_required": 14400},
]

MAX_LEVEL = LEVELS[-1]["level"]


def level_for_xp(xp: int) -> dict:
    """Résout un total d'XP en {level, title, xp, xp_into_level,
    xp_for_next_level, xp_remaining, next_level_title}. Pure — aucune DB.

    `xp_remaining`/`next_level_title` sont `None` au niveau 20 (rien au-delà,
    jamais un palier inventé)."""
    xp = max(0, int(xp))
    current = LEVELS[0]
    nxt = None
    for i, row in enumerate(LEVELS):
        if xp >= row["xp_required"]:
            current = row
            nxt = LEVELS[i + 1] if i + 1 < len(LEVELS) else None
        else:
            break
    xp_into_level = xp - current["xp_required"]
    if nxt is None:
        return {
            "level": current["level"], "title": current["title"], "xp": xp,
            "xp_into_level": xp_into_level, "xp_for_next_level": None,
            "xp_remaining": None, "next_level_title": None,
        }
    xp_for_next_level = nxt["xp_required"] - current["xp_required"]
    return {
        "level": current["level"], "title": current["title"], "xp": xp,
        "xp_into_level": xp_into_level, "xp_for_next_level": xp_for_next_level,
        "xp_remaining": nxt["xp_required"] - xp, "next_level_title": nxt["title"],
    }


# ---------- Barème XP ----------
# `daily_cap`/`lifetime_cap` sont le nombre maximum d'événements de cette
# nature qui rapportent de l'XP par jour UTC / à vie pour un même utilisateur
# — `None` veut dire "pas de plafond" (déjà fermé par la clé de déduplication
# elle-même, ex. un like reçu ne peut de toute façon être compté qu'une fois
# par paire (contenu, personne qui aime), pour toujours).
XP_RULES = {
    "recipe_published": {"points": 100, "daily_cap": 5, "lifetime_cap": None},
    "creation_published": {"points": 50, "daily_cap": 5, "lifetime_cap": None},
    "like_received": {"points": 5, "daily_cap": 100, "lifetime_cap": None},
    "comment_received": {"points": 10, "daily_cap": 20, "lifetime_cap": None},
    "comment_written": {"points": 3, "daily_cap": 10, "lifetime_cap": None},
    "new_follower": {"points": 10, "daily_cap": None, "lifetime_cap": None},
    "friend_made": {"points": 15, "daily_cap": None, "lifetime_cap": None},
    "collection_created": {"points": 5, "daily_cap": None, "lifetime_cap": 10},
}


def _day_start(now: Optional[datetime] = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


async def _update_streak(db, user_id: str, today: str) -> None:
    """Un jour UTC (YYYY-MM-DD), pas un jour par fuseau utilisateur — aucune
    notion de fuseau horaire n'existe ailleurs dans cette app
    (`leaderboard.py` a fait le même choix pour la même raison)."""
    row = await db.user_levels.find_one({"user_id": user_id}, {"_id": 0, "current_streak": 1, "last_active_date": 1})
    last = (row or {}).get("last_active_date")
    streak = (row or {}).get("current_streak") or 0
    if last == today:
        return
    if last:
        yesterday = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
        streak = streak + 1 if last == yesterday else 1
    else:
        streak = 1
    await db.user_levels.update_one(
        {"user_id": user_id},
        {"$set": {"current_streak": streak, "last_active_date": today}},
        upsert=True,
    )


async def award_xp(db, user_id: str, kind: str, event_key: str, meta: Optional[dict] = None) -> dict:
    """Attribue l'XP d'un événement `kind` si — et seulement si — sa clé
    `event_key` n'a jamais été récompensée et que le plafond de la journée/à
    vie n'est pas dépassé. Retourne {"awarded": bool, "leveled_up": {...}|None}.

    Ne fait jamais confiance à l'appelant pour la légitimité de l'événement :
    c'est aux points d'appel (server.py) de n'appeler ceci qu'après qu'une
    action métier a réellement réussi (recette insérée, commentaire inséré,
    etc.) — jamais avant, jamais sur une supposition."""
    rule = XP_RULES.get(kind)
    if rule is None:
        return {"awarded": False, "leveled_up": None}

    now = datetime.now(timezone.utc)
    full_key = f"{kind}:{event_key}"

    if rule["daily_cap"] is not None:
        count_today = await db.user_xp_events.count_documents(
            {"user_id": user_id, "kind": kind, "created_at": {"$gte": _day_start(now)}}
        )
        if count_today >= rule["daily_cap"]:
            return {"awarded": False, "leveled_up": None}
    if rule["lifetime_cap"] is not None:
        count_lifetime = await db.user_xp_events.count_documents({"user_id": user_id, "kind": kind})
        if count_lifetime >= rule["lifetime_cap"]:
            return {"awarded": False, "leveled_up": None}

    try:
        await db.user_xp_events.insert_one({
            "event_key": full_key, "user_id": user_id, "kind": kind,
            "points": rule["points"], "meta": meta or {}, "created_at": now,
        })
    except DuplicateKeyError:
        return {"awarded": False, "leveled_up": None}

    before = await db.user_levels.find_one({"user_id": user_id}, {"_id": 0, "xp": 1})
    xp_before = (before or {}).get("xp") or 0
    xp_after = xp_before + rule["points"]
    await db.user_levels.update_one(
        {"user_id": user_id},
        {"$inc": {"xp": rule["points"]}, "$set": {"updated_at": now}},
        upsert=True,
    )
    await _update_streak(db, user_id, now.strftime("%Y-%m-%d"))

    level_before = level_for_xp(xp_before)["level"]
    level_after = level_for_xp(xp_after)["level"]
    leveled_up = None
    if level_after > level_before:
        detail = level_for_xp(xp_after)
        leveled_up = {"level": detail["level"], "title": detail["title"]}
    return {"awarded": True, "leveled_up": leveled_up}


async def get_level_detail(db, user_id: str) -> dict:
    """Détail complet pour l'écran de profil propre. Un utilisateur sans
    aucune ligne `user_levels` (jamais encore d'action XP) reste au niveau 1,
    0 XP — jamais une erreur, jamais une valeur devinée."""
    row = await db.user_levels.find_one({"user_id": user_id}, {"_id": 0})
    xp = (row or {}).get("xp") or 0
    detail = level_for_xp(xp)
    detail["current_streak"] = (row or {}).get("current_streak") or 0
    detail["favorite_badge_id"] = (row or {}).get("favorite_badge_id")
    return detail
