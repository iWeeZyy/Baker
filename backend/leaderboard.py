"""
Classement communautaire : créateurs, recettes, créations, par période.

Fenêtres glissantes, pas de découpage calendaire : "cette semaine" = les 7
derniers jours, "ce mois-ci" = les 30 derniers jours, "cette année" = les 365
derniers jours, "depuis toujours" = aucun filtre. Plus simple qu'un calcul de
semaine ISO/mois calendaire avec fuseau horaire, et un choix défendable pour
un classement d'activité récente.

Score = somme pondérée de cinq signaux, jamais uniquement les likes : publier
une recette/création rapporte un forfait modeste ; les signaux les plus
difficiles à fabriquer (commentaire reçu, nouvel abonné) pèsent plus que les
likes, les plus faciles à accumuler — un utilisateur qui publie beaucoup sans
jamais être suivi ni commenté reste en bas du classement.

Anti-triche : un like/abonnement retiré-puis-remis ne laisse jamais qu'une
seule ligne active en base (index uniques déjà en place sur
(user_id,recipe_id)/(follower_id,followee_id) dans server.py), donc aucun
risque de double comptage par re-toggle, quel que soit le nombre de fois où
l'action est répétée — rien à faire de plus pour ça. Le vecteur réel fermé
ici, dans reduce_engagement() : l'auto-like/auto-commentaire (un utilisateur
qui aime ou commente son propre contenu) est explicitement exclu du score
reçu, aussi bien pour le score Créateurs que pour le classement Recettes/
Créations — sinon un utilisateur pourrait aimer sa propre recette en boucle
pour gonfler artificiellement sa position.

Duplication de contenu et faux comptes : hors périmètre, explicitement —
aucune détection de doublon ni de lutte anti-sybil n'existe ailleurs dans
cette app ; en construire une pour ce seul classement inventerait une
infrastructure que rien d'autre ne possède. La pondération (publier seul
rapporte peu, l'engagement reçu rapporte plus) décourage déjà structurellement
le spam de publication.
"""
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

POINTS_RECIPE_PUBLISHED = 15
POINTS_CREATION_PUBLISHED = 15
POINTS_LIKE_RECEIVED = 3
POINTS_COMMENT_RECEIVED = 5
POINTS_NEW_FOLLOWER = 8

PERIOD_DAYS: Dict[str, Optional[int]] = {"week": 7, "month": 30, "year": 365, "all": None}
DEFAULT_LIMIT = 50
MAX_LIMIT = 50


def period_start(period: str, now: Optional[datetime] = None) -> Optional[datetime]:
    """Borne inférieure (incluse) de la fenêtre glissante, ou None pour
    "depuis toujours". `now` est injectable pour les tests."""
    if period not in PERIOD_DAYS:
        raise ValueError(f"Période inconnue : {period}")
    days = PERIOD_DAYS[period]
    if days is None:
        return None
    now = now or datetime.now(timezone.utc)
    return now - timedelta(days=days)


def reduce_engagement(events: List[dict], ownership: Dict[str, str]) -> Tuple[Dict[str, int], Dict[str, int]]:
    """events : {"content_id", "actor_user_id"} déjà extraits d'un curseur
    Mongo période-filtré. ownership : content_id -> propriétaire.

    Retourne (by_content, by_owner) : compte par contenu (classement
    Recettes/Créations) et compte par propriétaire (score Créateurs), en
    excluant l'auto-engagement dans les deux à la fois — un seul passage."""
    by_content: Dict[str, int] = {}
    by_owner: Dict[str, int] = {}
    for ev in events:
        content_id = ev["content_id"]
        owner_id = ownership.get(content_id)
        if owner_id is None or owner_id == ev["actor_user_id"]:
            continue
        by_content[content_id] = by_content.get(content_id, 0) + 1
        by_owner[owner_id] = by_owner.get(owner_id, 0) + 1
    return by_content, by_owner


def _clamp_limit(limit: int) -> int:
    return max(1, min(limit, MAX_LIMIT))


async def _recipe_owner_map(db) -> Dict[str, str]:
    owner = {}
    async for r in db.recipes.find({"is_user_submitted": True}, {"_id": 0, "id": 1, "author_id": 1}):
        if r.get("author_id"):
            owner[r["id"]] = r["author_id"]
    return owner


async def _creation_owner_map(db) -> Dict[str, str]:
    owner = {}
    async for c in db.creations.find({}, {"_id": 0, "id": 1, "user_id": 1}):
        owner[c["id"]] = c["user_id"]
    return owner


async def _recipe_like_events(db, start: Optional[datetime]) -> List[dict]:
    q: dict = {} if start is None else {"created_at": {"$gte": start}}
    events = []
    async for d in db.likes.find(q, {"_id": 0, "recipe_id": 1, "user_id": 1}):
        events.append({"content_id": d["recipe_id"], "actor_user_id": d["user_id"]})
    return events


async def _creation_like_events(db, start: Optional[datetime]) -> List[dict]:
    q: dict = {} if start is None else {"created_at": {"$gte": start}}
    events = []
    async for d in db.creation_likes.find(q, {"_id": 0, "creation_id": 1, "user_id": 1}):
        events.append({"content_id": d["creation_id"], "actor_user_id": d["user_id"]})
    return events


async def _comment_events(db, start: Optional[datetime]) -> List[dict]:
    q: dict = {} if start is None else {"created_at": {"$gte": start}}
    events = []
    async for d in db.comments.find(q, {"_id": 0, "recipe_id": 1, "user_id": 1}):
        events.append({"content_id": d["recipe_id"], "actor_user_id": d["user_id"]})
    return events


async def _recipes_published_counts(db, start: Optional[datetime]) -> Dict[str, int]:
    q: dict = {"is_user_submitted": True}
    if start is not None:
        q["created_at"] = {"$gte": start}
    pipeline = [{"$match": q}, {"$group": {"_id": "$author_id", "c": {"$sum": 1}}}]
    counts = {}
    async for row in db.recipes.aggregate(pipeline):
        if row["_id"]:
            counts[row["_id"]] = row["c"]
    return counts


async def _creations_published_counts(db, start: Optional[datetime]) -> Dict[str, int]:
    q: dict = {} if start is None else {"created_at": {"$gte": start}}
    pipeline = [{"$match": q}, {"$group": {"_id": "$user_id", "c": {"$sum": 1}}}]
    counts = {}
    async for row in db.creations.aggregate(pipeline):
        counts[row["_id"]] = row["c"]
    return counts


async def _follower_gain_counts(db, start: Optional[datetime]) -> Dict[str, int]:
    q: dict = {} if start is None else {"created_at": {"$gte": start}}
    pipeline = [{"$match": q}, {"$group": {"_id": "$followee_id", "c": {"$sum": 1}}}]
    counts = {}
    async for row in db.follows.aggregate(pipeline):
        counts[row["_id"]] = row["c"]
    return counts


def _add_points(scores: Dict[str, int], counts: Dict[str, int], weight: int) -> None:
    for uid, c in counts.items():
        scores[uid] = scores.get(uid, 0) + c * weight


async def compute_creator_rankings(db, period: str, viewer_id: str, limit: int = DEFAULT_LIMIT) -> Tuple[List[dict], Optional[dict]]:
    """Retourne (top, my_rank). `top` est une liste de {user_id, score, rank}
    — jamais les profils complets : server.py résout _public_user()/following
    uniquement pour les lignes réellement affichées, jamais pour l'ensemble
    du classement calculé en mémoire."""
    limit = _clamp_limit(limit)
    start = period_start(period)

    recipe_owner = await _recipe_owner_map(db)
    creation_owner = await _creation_owner_map(db)

    _, likes_by_owner = reduce_engagement(await _recipe_like_events(db, start), recipe_owner)
    _, creation_likes_by_owner = reduce_engagement(await _creation_like_events(db, start), creation_owner)
    _, comments_by_owner = reduce_engagement(await _comment_events(db, start), recipe_owner)

    scores: Dict[str, int] = {}
    _add_points(scores, await _recipes_published_counts(db, start), POINTS_RECIPE_PUBLISHED)
    _add_points(scores, await _creations_published_counts(db, start), POINTS_CREATION_PUBLISHED)
    _add_points(scores, likes_by_owner, POINTS_LIKE_RECEIVED)
    _add_points(scores, creation_likes_by_owner, POINTS_LIKE_RECEIVED)
    _add_points(scores, comments_by_owner, POINTS_COMMENT_RECEIVED)
    _add_points(scores, await _follower_gain_counts(db, start), POINTS_NEW_FOLLOWER)

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)

    my_rank = None
    for idx, (uid, score) in enumerate(ranked, start=1):
        if uid == viewer_id:
            my_rank = {"rank": idx, "score": score}
            break

    top = [{"user_id": uid, "score": score, "rank": idx} for idx, (uid, score) in enumerate(ranked[:limit], start=1)]
    return top, my_rank


async def compute_recipe_rankings(db, period: str, limit: int = DEFAULT_LIMIT) -> List[dict]:
    limit = _clamp_limit(limit)
    start = period_start(period)
    recipe_owner = await _recipe_owner_map(db)
    by_content, _ = reduce_engagement(await _recipe_like_events(db, start), recipe_owner)
    ranked = sorted(by_content.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    return [{"id": rid, "score": c, "rank": idx} for idx, (rid, c) in enumerate(ranked, start=1)]


async def compute_creation_rankings(db, period: str, limit: int = DEFAULT_LIMIT) -> List[dict]:
    limit = _clamp_limit(limit)
    start = period_start(period)
    creation_owner = await _creation_owner_map(db)
    by_content, _ = reduce_engagement(await _creation_like_events(db, start), creation_owner)
    ranked = sorted(by_content.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    return [{"id": cid, "score": c, "rank": idx} for idx, (cid, c) in enumerate(ranked, start=1)]
