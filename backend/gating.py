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
   les fonctionnalités réservées, et le frontend traite les deux pareil. Un
   champ `"quota"` (la clé précise) s'y ajoute depuis le chantier des
   quotas d'essai Free, pour les routes qui vérifient plusieurs quotas à la
   fois (voir `quotas=` sur `check()`/`require()`) — un client qui ignore ce
   champ continue de fonctionner à l'identique.

**Concurrence, assumé** : `check()` puis l'insertion qui suit forment deux
étapes séparées (lire le compteur, puis écrire) — deux requêtes simultanées
peuvent en théorie toutes les deux lire un compteur encore sous la limite
et toutes les deux passer. Cette fenêtre existe déjà, sans correctif,
depuis les tout premiers quotas de ce module (`recipes_total`,
`productions_per_month`) ; les nouveaux quotas d'essai Free héritent
délibérément de la même caractéristique plutôt que d'introduire un
mécanisme de verrouillage atomique parallèle, à l'échelle de cette
application (usage réel, pas un système à fort trafic). La mitigation
pratique reste côté client : désactiver le bouton d'action pendant la
requête en vol, déjà le patron partout dans l'app.
"""
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from fastapi import Depends, HTTPException

import entitlements
import subscriptions
from core import db, get_current_user
from plans import entitlements_enforced

# Ce qui était déjà appliqué avant ce chantier, et le reste quoi qu'il arrive.
# Voir la propriété 1 du module : l'interrupteur n'a pas le droit de desserrer
# une limite existante, seulement de retenir les nouvelles.
ALWAYS_ENFORCED_QUOTAS = frozenset({"productions_per_month"})


def _month_start(now: Optional[datetime] = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    return datetime(now.year, now.month, 1, tzinfo=timezone.utc)


async def usage(user_id: str, key: str, *, org_id: Optional[str] = None) -> int:
    """Consommation actuelle pour ce quota.

    Compté au moment de la requête à partir des collections du domaine —
    même choix que partout ailleurs dans cette base (classement, compteurs
    de likes) : aucun compteur dénormalisé à maintenir, aucune tâche de
    fond, et un chiffre qui ne peut pas dériver de la réalité.

    `org_id`, optionnel : quand fourni, `productions_per_month` se compte
    par organisation plutôt que par compte — des collègues qui partagent le
    même planning épuisent le même quota, pas chacun le leur. Absent (le cas
    par défaut, tous les autres appelants), rien ne change.
    """
    if key == "recipes_total":
        # `author_id` + `is_user_submitted` : le prédicat déjà utilisé par
        # badges.py. Il exclut les recettes du catalogue, sans quoi chaque
        # compte démarrerait à 194 et ne pourrait jamais rien publier.
        return await db.recipes.count_documents(
            {"author_id": user_id, "is_user_submitted": True})
    if key == "productions_per_month":
        filtre = {"org_id": org_id} if org_id else {"user_id": user_id}
        return await db.productions.count_documents(
            {**filtre, "created_at": {"$gte": _month_start()}})
    if key == "ai_messages_per_month":
        return await db.ai_usage.count_documents(
            {"user_id": user_id, "kind": "chat", "created_at": {"$gte": _month_start()}})
    if key == "scans_per_month":
        return await db.ai_usage.count_documents(
            {"user_id": user_id, "kind": "scan", "created_at": {"$gte": _month_start()}})
    if key == "org_members":
        # Sans organisation, rien à limiter : ce quota n'a de sens que dans
        # le flux d'invitation, qui fournit toujours un org_id.
        if not org_id:
            return 0
        # Le plafond du cahier des charges est « 15 employés », pas « 15
        # personnes propriétaire compris » — le propriétaire (qui possède
        # toujours sa propre ligne dans org_members, voir organisations.py)
        # est donc exclu du compte, sans quoi créer l'organisation
        # consommerait déjà une place sur les 15 avant la première
        # invitation.
        actifs = await db.org_members.count_documents(
            {"org_id": org_id, "status": "active", "role": {"$ne": "owner"}})
        # + invitations en attente, pour qu'envoyer plusieurs invitations
        # d'un coup ne puisse jamais, une fois toutes acceptées, dépasser
        # le plafond.
        en_attente = await db.org_invites.count_documents({"org_id": org_id, "status": "pending"})
        return actifs + en_attente
    if key == "schedule_employees":
        # Borne par document, pas cumulative : la grille envoyée porte tout
        # l'effectif, donc l'appelant passe `amount=len(employees)` et il n'y
        # a rien à compter en base.
        return 0
    if key == "scans_total":
        # Usage à vie, jamais filtré par date : contrairement à
        # scans_per_month (le quota mensuel payant, inchangé), un scan
        # gratuit consommé reste consommé même si la recette qui en est
        # issue est supprimée ensuite — journal d'événements, pas un compte
        # de documents. Compte aussi bien `kind="scan"` (photo) que
        # `kind="instagram_import"` (légende collée) : les deux routes
        # partagent la fonctionnalité `recipe_scan` et doivent partager le
        # même plafond d'essai, sans quoi l'import Instagram contournerait
        # librement le quota du scan photo.
        return await db.ai_usage.count_documents(
            {"user_id": user_id, "kind": {"$in": ["scan", "instagram_import"]}})
    if key == "adapts_total":
        # Même logique que scans_total. `record_ai_usage(user_id, "adapt")`
        # est déjà appelé après chaque adaptation IA réussie (server.py) —
        # ce quota est la première chose à en tenir compte.
        return await db.ai_usage.count_documents({"user_id": user_id, "kind": "adapt"})
    if key == "collections_total":
        # Stock, jamais org-scopé : les collections n'ont aucune intégration
        # organisation dans ce code, contrairement aux productions/grilles.
        return await db.collections.count_documents({"user_id": user_id})
    if key == "schedules_total":
        # Stock : nombre de grilles actuellement conservées (supprimer une
        # grille libère une place) — même mécanique que recipes_total, sur
        # une collection différente. Org-scopé comme schedule_employees et
        # productions_per_month : des collègues partageant un planning
        # épuisent le même quota.
        filtre = {"org_id": org_id} if org_id else {"user_id": user_id}
        return await db.schedules.count_documents(filtre)
    raise KeyError(f"quota sans compteur : {key}")


_QUOTA_LIBELLES = {
    "recipes_total": "recettes",
    "productions_per_month": "productions",
    "ai_messages_per_month": "messages à l'assistant",
    "scans_per_month": "scans de recette",
    "schedule_employees": "employés",
    "org_members": "membres d'équipe",
    "scans_total": "scans de recette gratuits",
    "adapts_total": "adaptations gratuites",
    "collections_total": "collections",
    "schedules_total": "plannings personnel",
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
                quota: Optional[str] = None, amount: int = 1,
                quotas: Optional[List[Tuple[str, int]]] = None,
                org: Optional[dict] = None) -> None:
    """Lève si le palier ne permet pas l'action. Ne renvoie rien sinon.

    `amount` sert aux écritures qui consomment plus d'une unité d'un coup
    (une grille de personnel enregistre N employés en une requête).

    `quotas`, optionnel : une liste de `(clé, quantité)` quand une route doit
    satisfaire PLUSIEURS quotas indépendants à la fois, avec des quantités
    différentes — le cas du scan (un quota d'essai à vie `scans_total` ET le
    quota mensuel payant `scans_per_month`, préexistant, inchangé, tous deux
    amount=1) ou d'une grille de personnel (`schedules_total`, amount=1 —
    une grille de plus — ET `schedule_employees`, amount=len(employees)).
    `quota`/`amount` reste le raccourci pour le cas à un seul quota (la
    majorité des routes) ; les deux formes se combinent si besoin. Chaque
    quota de la liste est vérifié indépendamment — le premier qui échoue
    lève pour SA clé précise (voir le champ `"quota"` de l'erreur), les
    autres ne sont jamais atteints.

    `org`, optionnel (le contexte rendu par `organisations.get_org_context`) :
    quand fourni et non vide, le palier appliqué est celui du **propriétaire**
    de l'organisation active (`org["billing_user"]`), pas celui de
    l'appelant — un employé Gratuit doit profiter du palier Équipe de son
    employeur, jamais du sien. Le compteur d'usage, lui, reste scopé par
    organisation via `org["org_id"]` (voir `usage()`).
    """
    enforced = entitlements_enforced()
    billing_user = (org or {}).get("billing_user") or user
    plan = await subscriptions.plan_for(billing_user)

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

    a_verifier: List[Tuple[str, int]] = list(quotas or [])
    if quota:
        a_verifier = [(quota, amount)] + a_verifier

    for cle, qte in a_verifier:
        if not (enforced or cle in ALWAYS_ENFORCED_QUOTAS):
            continue
        limit = entitlements.quota(plan, cle)
        if limit is None:
            continue
        used = await usage(user["user_id"], cle, org_id=(org or {}).get("org_id"))
        if used + qte <= limit:
            continue
        period = entitlements.quota_period(cle)
        raise HTTPException(403, {
            "error": "plan_limit_reached",
            "quota": cle,
            "limit": limit,
            "used": used,
            "period": period,
            "message": _quota_message(cle, limit, period),
        })


def require(*, feature: Optional[str] = None, quota: Optional[str] = None,
            amount: int = 1, quotas: Optional[List[Tuple[str, int]]] = None,
            org_aware: bool = False):
    """Dépendance FastAPI : remplace `Depends(get_current_user)` en place.

        async def create_recipe(inp, user: dict = Depends(require(quota="recipes_total"))):

    Elle renvoie le même document utilisateur, pour que la signature et le
    corps de la route restent inchangés. `quotas` (liste de `(clé, quantité)`)
    se combine avec `quota`/`amount` — voir `check()`.

    `org_aware=True` résout aussi le contexte d'organisation de l'appelant
    (`organisations.get_org_context`) et le passe à `check()` — à utiliser
    sur les routes dont le palier/quota doit tenir compte d'une organisation
    partagée (voir `routers/production.py::create_production`). Import
    tardif, à l'intérieur de la fonction : `organisations.py` importe
    `gating.check`, un import en tête de ce module créerait un cycle.
    """
    if not org_aware:
        async def dependency(user: dict = Depends(get_current_user)) -> dict:
            await check(user, feature=feature, quota=quota, amount=amount, quotas=quotas)
            return user
        return dependency

    from organisations import get_org_context

    async def dependency(user: dict = Depends(get_current_user),
                         org: dict = Depends(get_org_context)) -> dict:
        await check(user, feature=feature, quota=quota, amount=amount, quotas=quotas, org=org)
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
