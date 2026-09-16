"""Application des droits : une ligne par route à verrouiller.

`entitlements.py` dit ce qu'une offre donne ; ce module-ci le fait respecter.
Il touche la base (compter des recettes, des productions, des appels IA), il
n'est donc pas pur — c'est la frontière assumée entre les deux.

Trois propriétés tiennent tout le reste :

1. **L'interrupteur ne gouverne que les restrictions NOUVELLES.**
   `ENTITLEMENTS_ENFORCED` est faux par défaut : tant que l'abonnement n'est
   pas achetable, refuser une fonctionnalité reviendrait à la retirer à tout
   le monde sans aucun moyen de la débloquer. Mais la règle « personne ne
   perd une fonctionnalité » a un revers d'égale importance — **personne ne
   doit gagner en silence une limite qui existait déjà**. Le quota de trois
   productions par mois est appliqué depuis l'origine de l'offre Pro et
   couvert par `test_productions_api.py::TestFreePlanLimit` ; le laisser
   tomber avec l'interrupteur rendrait les productions illimitées pour tous.
   D'où `ALWAYS_ENFORCED_QUOTAS`.

2. **Un verrou ne se pose jamais sur une lecture.** Uniquement sur ce qui
   crée ou modifie. C'est ce qui rend une rétrogradation non destructive :
   un compte qui retombe en Gratuit avec 300 recettes les garde et continue
   de les consulter, il ne peut simplement plus en créer de nouvelles.

3. **Le contrat d'erreur existant ne bouge pas.** Un quota épuisé renvoie
   toujours `{"error": "plan_limit_reached", "limit", "used", "period",
   "message"}` — forme déjà lue par `isPlanLimitError` et par la redirection
   vers l'écran d'abonnement. La forme `plan_feature_locked` la rejoint pour
   les fonctionnalités réservées, et le frontend traite les deux pareil.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException

import entitlements
from core import db, get_current_user
from plans import entitlements_enforced, resolve_plan

# Ce qui était déjà appliqué avant ce chantier, et le reste quoi qu'il arrive.
# Voir la propriété 1 du module : l'interrupteur n'a pas le droit de desserrer
# une limite existante, seulement de retenir les nouvelles.
ALWAYS_ENFORCED_QUOTAS = frozenset({"productions_per_month"})


def _month_start(now: Optional[datetime] = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    return datetime(now.year, now.month, 1, tzinfo=timezone.utc)


async def usage(user_id: str, key: str) -> int:
    """Consommation actuelle de l'utilisateur pour ce quota.

    Compté au moment de la requête à partir des collections du domaine —
    même choix que partout ailleurs dans cette base (classement, compteurs
    de likes) : aucun compteur dénormalisé à maintenir, aucune tâche de
    fond, et un chiffre qui ne peut pas dériver de la réalité.
    """
    if key == "recipes_total":
        # `author_id` + `is_user_submitted` : le prédicat déjà utilisé par
        # badges.py. Il exclut les recettes du catalogue, sans quoi chaque
        # compte démarrerait à 194 et ne pourrait jamais rien publier.
        return await db.recipes.count_documents(
            {"author_id": user_id, "is_user_submitted": True})
    if key == "productions_per_month":
        return await db.productions.count_documents(
            {"user_id": user_id, "created_at": {"$gte": _month_start()}})
    if key == "ai_messages_per_month":
        return await db.ai_usage.count_documents(
            {"user_id": user_id, "kind": "chat", "created_at": {"$gte": _month_start()}})
    if key == "scans_per_month":
        return await db.ai_usage.count_documents(
            {"user_id": user_id, "kind": "scan", "created_at": {"$gte": _month_start()}})
    if key == "org_members":
        return await db.org_members.count_documents(
            {"user_id": user_id, "status": "active"})
    if key == "schedule_employees":
        # Borne par document, pas cumulative : la grille envoyée porte tout
        # l'effectif, donc l'appelant passe `amount=len(employees)` et il n'y
        # a rien à compter en base.
        return 0
    raise KeyError(f"quota sans compteur : {key}")


_QUOTA_LIBELLES = {
    "recipes_total": "recettes",
    "productions_per_month": "productions",
    "ai_messages_per_month": "messages à l'assistant",
    "scans_per_month": "scans de recette",
    "schedule_employees": "employés",
    "org_members": "membres d'équipe",
}


def _quota_message(key: str, limit: int, period: str) -> str:
    """Le texte lu par l'utilisateur. Jamais le nom technique du quota."""
    quoi = _QUOTA_LIBELLES.get(key, key)
    if limit == 0:
        return "Cette fonctionnalité n'est pas incluse dans votre offre."
    if period == "month":
        return f"Vous avez atteint les {limit} {quoi} par mois de votre offre."
    return f"Vous avez atteint la limite de {limit} {quoi} de votre offre."


async def check(user: dict, *, feature: Optional[str] = None,
                quota: Optional[str] = None, amount: int = 1) -> None:
    """Lève si le palier ne permet pas l'action. Ne renvoie rien sinon.

    `amount` sert aux écritures qui consomment plus d'une unité d'un coup
    (une grille de personnel enregistre N employés en une requête).
    """
    enforced = entitlements_enforced()
    plan = resolve_plan(user)

    # Les fonctionnalités réservées sont toutes nouvelles : tant que
    # l'abonnement n'est pas achetable, elles sont déclarées sans être
    # refusées.
    if feature and enforced and not entitlements.has_feature(plan, feature):
        required = entitlements.MIN_TIER[feature]
        raise HTTPException(403, {
            "error": "plan_feature_locked",
            "feature": feature,
            "required_plan": required,
            # Le libellé de l'offre, pas son identifiant : c'est ce que
            # l'application affichera faute de meilleure copie.
            "message": f"Cette fonctionnalité est réservée à l'offre "
                       f"{entitlements.PLAN_LABELS[required]}.",
        })

    if not quota:
        return
    if not (enforced or quota in ALWAYS_ENFORCED_QUOTAS):
        return

    limit = entitlements.quota(plan, quota)
    if limit is None:
        return
    used = await usage(user["user_id"], quota)
    if used + amount <= limit:
        return
    period = entitlements.quota_period(quota)
    raise HTTPException(403, {
        "error": "plan_limit_reached",
        "limit": limit,
        "used": used,
        "period": period,
        "message": _quota_message(quota, limit, period),
    })


def require(*, feature: Optional[str] = None, quota: Optional[str] = None,
            amount: int = 1):
    """Dépendance FastAPI : remplace `Depends(get_current_user)` en place.

        async def create_recipe(inp, user: dict = Depends(require(quota="recipes_total"))):

    Elle renvoie le même document utilisateur, pour que la signature et le
    corps de la route restent inchangés.
    """
    async def dependency(user: dict = Depends(get_current_user)) -> dict:
        await check(user, feature=feature, quota=quota, amount=amount)
        return user
    return dependency


async def record_ai_usage(user_id: str, kind: str) -> None:
    """Journalise un appel IA réussi, calqué sur `db.ad_events`.

    Écrit **même interrupteur éteint** : le jour où les quotas s'appliqueront,
    les chiffres seront déjà réels au lieu de repartir de zéro. Jamais
    bloquant — un échec d'écriture ici ne doit pas faire perdre à
    l'utilisateur la réponse qu'il vient d'obtenir.
    """
    try:
        await db.ai_usage.insert_one({
            "user_id": user_id,
            "kind": kind,
            "created_at": datetime.now(timezone.utc),
        })
    except Exception:  # noqa: BLE001 — journal d'usage, jamais critique
        pass
