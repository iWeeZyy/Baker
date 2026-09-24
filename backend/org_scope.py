"""Ce qui rend une donnée partagée entre collègues, sans rien casser pour
tous les comptes qui n'appartiennent à aucune organisation.

Module **pur** — aucune base, aucun réseau, même famille que
`entitlements.py`/`text_moderation.py` — pour que chaque règle soit un test
direct. La lecture en base (résoudre l'organisation active d'un compte) vit
dans `organisations.py` ; ici, uniquement les décisions.

**`scope()` hors organisation doit rester identique, bit à bit, au littéral
`{"user_id": user["user_id"]}` déjà écrit partout dans `routers/production.py`,
`routers/staff.py` et `routers/cost.py` aujourd'hui.** C'est ce qui garantit
qu'un compte qui n'a jamais entendu parler d'une organisation ne voit
strictement rien changer : ni ce qu'il voit, ni ce qu'il peut faire.

**Un compte peut appartenir à plusieurs organisations à la fois** (un
boulanger qui dépanne dans une autre boutique un après-midi) — décision
prise avec Lucas au moment de concevoir ce module, en rupture avec un
premier jet qui aurait limité un compte à une seule organisation. D'où
`resolve_active_membership()` : un contexte ambigu (plusieurs
appartenances, aucune sélection valide) ne se devine jamais — il retombe
sur « hors organisation » plutôt que de mélanger les données de deux
employeurs différents.
"""
from typing import Optional

ROLES = ("owner", "manager", "employee")


def scope(user: dict, org: Optional[dict]) -> dict:
    """Le filtre à fusionner dans une requête de lecture, de mise à jour ou
    de suppression.

    Hors organisation (`org` vide, ou sans `org_id` résolu — voir
    `resolve_active_membership`) : exactement `{"user_id": ...}`, le
    littéral déjà en place partout. Dans une organisation : `{"org_id":
    ...}`, jamais `user_id` — un collègue doit voir et modifier les
    documents des autres membres, pas seulement les siens.
    """
    org_id = (org or {}).get("org_id")
    if org_id:
        return {"org_id": org_id}
    return {"user_id": user["user_id"]}


def stamp(user: dict, org: Optional[dict]) -> dict:
    """Les champs à fusionner dans un document **nouvellement créé**.

    `user_id` reste toujours l'auteur, jamais remplacé par `org_id` : c'est
    ce qui permet à `can_delete()` de distinguer « mon document » de « le
    document d'un collègue », et ce qui portera un jour `assignee_user_id`
    (l'attribution de tâches, phase 7c) sans ambiguïté sur qui a créé quoi.
    `org_id` s'ajoute à côté quand un contexte d'organisation est actif,
    jamais à la place.
    """
    out = {"user_id": user["user_id"]}
    org_id = (org or {}).get("org_id")
    if org_id:
        out["org_id"] = org_id
    return out


def can_delete(user: dict, org: Optional[dict], doc: dict) -> bool:
    """Qui a le droit d'effacer ce document précis.

    L'auteur peut toujours effacer ce qu'il a créé, organisation ou pas —
    jamais une exception à cette règle. Le document d'un collègue ne peut
    être effacé que par le propriétaire ou un manager de l'organisation
    *active* : un simple employé peut voir et modifier les documents
    partagés, mais pas les supprimer au nom des autres.
    """
    if doc.get("user_id") == user.get("user_id"):
        return True
    return (org or {}).get("role") in ("owner", "manager")


def can_view_dashboard(role: Optional[str]) -> bool:
    """Qui peut voir le tableau de bord manager d'une organisation (phase
    7d). Propriétaire et encadrement seulement — un simple employé voit son
    propre travail ailleurs dans l'app, jamais la vue d'ensemble de
    l'affaire (chiffre d'affaires, marges, activité de ses collègues)."""
    return role in ("owner", "manager")


def can_invite(actor_role: Optional[str], target_role: str) -> bool:
    """Qui peut inviter qui. Le propriétaire invite à n'importe quel rôle
    subalterne ; un manager ne peut inviter qu'au rôle employé — jamais à
    manager, pour qu'il ne puisse pas se fabriquer des pairs. Un employé ne
    peut inviter personne."""
    if target_role not in ("manager", "employee"):
        return False
    if actor_role == "owner":
        return True
    if actor_role == "manager":
        return target_role == "employee"
    return False


def resolve_active_membership(memberships: list, active_org_id: Optional[str]) -> Optional[dict]:
    """Laquelle des appartenances actives d'un compte fait foi maintenant.

    Une sélection explicite et toujours valide (`active_org_id` pointe vers
    une des `memberships`) gagne toujours. À défaut, une seule organisation
    active ne laisse aucune ambiguïté et est retenue d'office — c'est le cas
    très largement majoritaire (un seul employeur), et ça évite d'imposer
    une bascule manuelle à qui n'en a jamais besoin. Dans tout autre cas
    (plusieurs organisations, aucune sélection ou une sélection périmée) :
    `None` — un contexte ambigu ne se devine jamais. L'appelant retombe
    alors sur `scope()`/`stamp()` sans organisation, jamais sur un mélange
    des données de deux employeurs.
    """
    if active_org_id:
        match = next((m for m in memberships if m.get("org_id") == active_org_id), None)
        if match:
            return match
    if len(memberships) == 1:
        return memberships[0]
    return None
