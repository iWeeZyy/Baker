"""L'offre Équipe : organisations, appartenances, invitations.

Impur — touche `db` — même famille que `subscriptions.py` : la décision pure
(qui peut quoi, quel filtre appliquer, quelle appartenance retenir comme
active) vit dans `org_scope.py` ; ici, uniquement la lecture/écriture en
base et l'assemblage des réponses. `routers/organisations.py` reste une
couche fine qui délègue à ce module, même découpage que
`routers/subscription.py`/`subscriptions.py`.

Le patron de code (invitation, acceptation, retrait) est copié de la
fonctionnalité sociale « Team » de `server.py` (`db.team_members`/
`db.team_invites`) — un simple gabarit, sans aucun rapport avec cette
entité : Team est une relation symétrique entre pairs, une organisation est
asymétrique (un ou plusieurs propriétaires, des rôles hiérarchiques).

Un compte peut appartenir à **plusieurs organisations à la fois** (un
boulanger qui dépanne dans une autre boutique) — décision prise avec Lucas.
`get_org_context()` résout laquelle fait foi pour la requête en cours via
`org_scope.resolve_active_membership()` : une sélection explicite
(`db.users.active_org_id`) si elle est encore valide, sinon l'unique
appartenance active s'il n'y en a qu'une, sinon rien — jamais un mélange.
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import Depends, HTTPException

from core import db, get_current_user
from org_scope import can_delete, can_invite, resolve_active_membership  # noqa: F401 (can_delete réexporté pour les routeurs)

MAX_NAME_LENGTH = 80
ROLES = ("manager", "employee")  # rôles qu'une invitation peut viser — jamais "owner"


def _public_member(user_doc: dict, member: dict) -> dict:
    """La forme d'une ligne de roster — mêmes champs que `_public_user`
    (server.py) pour un visage/nom cohérents ailleurs dans l'app, mais
    reconstruits ici : les routeurs n'importent jamais server.py (voir
    core.py, "aucun risque d'import circulaire")."""
    return {
        "user_id": member["user_id"],
        "name": user_doc.get("name") or "Boulanger",
        "picture": user_doc.get("picture"),
        "role": member["role"],
        "shop_ids": member.get("shop_ids") or [],
        "joined_at": member.get("created_at"),
    }


def _public_organisation(org: dict) -> dict:
    return {"id": org["id"], "name": org["name"], "owner_user_id": org["owner_user_id"],
            "shops": org.get("shops") or []}


async def get_org_context(user: dict = Depends(get_current_user)) -> dict:
    """Le contexte d'organisation de la requête en cours — résolu une fois,
    mis en cache par FastAPI pour la durée de la requête (même fonction,
    mêmes paramètres). Jamais `None` : un dict aux clés toujours présentes,
    nulles hors organisation, pour que `scope()`/`check()` n'aient qu'à
    lire `org.get("org_id")` sans distinguer "pas de contexte" de "contexte
    vide".
    """
    empty = {"org_id": None, "role": None, "shop_ids": None,
             "owner_user_id": None, "billing_user": None, "memberships": []}
    memberships = await db.org_members.find(
        {"user_id": user["user_id"], "status": "active"}, {"_id": 0}).to_list(50)
    if not memberships:
        return empty
    chosen = resolve_active_membership(memberships, user.get("active_org_id"))
    if chosen is None:
        return {**empty, "memberships": memberships}
    org = await db.organisations.find_one({"id": chosen["org_id"]}, {"_id": 0})
    if not org:
        # Incohérence (organisation supprimée entre-temps) : jamais un 500,
        # se comporte comme si l'appelant n'était dans aucune organisation.
        return {**empty, "memberships": memberships}
    if org["owner_user_id"] == user["user_id"]:
        billing_user = user
    else:
        billing_user = await db.users.find_one(
            {"user_id": org["owner_user_id"]}, {"_id": 0, "password_hash": 0}) or user
    return {"org_id": org["id"], "role": chosen["role"], "shop_ids": chosen.get("shop_ids") or [],
            "owner_user_id": org["owner_user_id"], "billing_user": billing_user,
            "memberships": memberships}


async def create_organisation(user: dict, name: str, shop_name: Optional[str] = None) -> dict:
    name = (name or "").strip()
    if not name:
        raise HTTPException(422, "Le nom de l'organisation est obligatoire.")
    if len(name) > MAX_NAME_LENGTH:
        raise HTTPException(422, f"Le nom ne peut pas dépasser {MAX_NAME_LENGTH} caractères.")
    now = datetime.now(timezone.utc)
    org_id = str(uuid.uuid4())
    org = {
        "id": org_id,
        "name": name,
        "owner_user_id": user["user_id"],
        "shops": [{"shop_id": str(uuid.uuid4()), "name": (shop_name or "").strip() or "Boutique principale",
                   "is_default": True}],
        "created_at": now, "updated_at": now,
    }
    await db.organisations.insert_one(org)
    await db.org_members.insert_one({
        "id": str(uuid.uuid4()), "org_id": org_id, "user_id": user["user_id"], "role": "owner",
        "shop_ids": [org["shops"][0]["shop_id"]], "status": "active", "invited_by": None,
        "created_at": now, "updated_at": now,
    })
    # On vient de la créer : elle devient l'espace de travail actif, y
    # compris pour un compte qui appartenait déjà à d'autres organisations
    # (sans quoi la nouvelle organisation serait invisible tant que le
    # compte n'a que ça).
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"active_org_id": org_id}})
    return _public_organisation(org)


async def list_my_organisations(user: dict, org: dict) -> dict:
    memberships = org.get("memberships") or []
    if not memberships:
        return {"organisations": [], "active_org_id": None}
    org_ids = [m["org_id"] for m in memberships]
    docs = await db.organisations.find({"id": {"$in": org_ids}}, {"_id": 0}).to_list(len(org_ids))
    by_id = {d["id"]: d for d in docs}
    active_org_id = org.get("org_id")
    out = []
    for m in memberships:
        doc = by_id.get(m["org_id"])
        if not doc:
            continue  # organisation supprimée entre-temps : simplement absente, jamais une erreur
        out.append({"org_id": doc["id"], "name": doc["name"], "role": m["role"],
                    "active": doc["id"] == active_org_id})
    return {"organisations": out, "active_org_id": active_org_id}


async def activate_organisation(user: dict, org_id: str) -> dict:
    member = await db.org_members.find_one(
        {"org_id": org_id, "user_id": user["user_id"], "status": "active"}, {"_id": 0})
    if not member:
        raise HTTPException(404, "Vous n'êtes pas membre de cette organisation.")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"active_org_id": org_id}})
    fresh_user = {**user, "active_org_id": org_id}
    return await list_my_organisations(fresh_user, await get_org_context(fresh_user))


async def list_members(org: dict) -> List[dict]:
    if not org.get("org_id"):
        raise HTTPException(404, "Aucune organisation active.")
    members = await db.org_members.find(
        {"org_id": org["org_id"], "status": "active"}, {"_id": 0}).sort("created_at", 1).to_list(200)
    if not members:
        return []
    user_ids = [m["user_id"] for m in members]
    users_by_id = {u["user_id"]: u async for u in
                   db.users.find({"user_id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0})}
    return [_public_member(users_by_id[m["user_id"]], m) for m in members if m["user_id"] in users_by_id]


async def send_invite(user: dict, org: dict, email: str, role: str,
                      shop_ids: Optional[List[str]] = None) -> dict:
    if not org.get("org_id"):
        raise HTTPException(404, "Aucune organisation active.")
    if role not in ROLES:
        raise HTTPException(422, f"Rôle invalide (attendu : {', '.join(ROLES)})")
    if not can_invite(org.get("role"), role):
        raise HTTPException(403, "Vous n'avez pas le droit d'inviter à ce rôle.")

    email = (email or "").strip().lower()
    target = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "Aucun compte Levanea n'utilise cette adresse e-mail.")
    if target["user_id"] == user["user_id"]:
        raise HTTPException(400, "Vous ne pouvez pas vous inviter vous-même.")

    org_id = org["org_id"]
    already = await db.org_members.find_one(
        {"org_id": org_id, "user_id": target["user_id"], "status": "active"})
    if already:
        raise HTTPException(409, "Cette personne fait déjà partie de l'organisation.")
    pending = await db.org_invites.find_one(
        {"org_id": org_id, "to_user_id": target["user_id"], "status": "pending"})
    if pending:
        return {"status": "pending_sent"}

    # gating.check() importé ici plutôt qu'en tête de module : gating.require()
    # importe organisations.py à la demande (org_aware=True), un import en
    # tête créerait le même cycle que celui documenté dans gating.require().
    from gating import check
    await check(user, feature="org_team", quota="org_members", amount=1, org=org)

    invite_id = str(uuid.uuid4())
    await db.org_invites.insert_one({
        "id": invite_id, "org_id": org_id, "from_user_id": user["user_id"],
        "to_user_id": target["user_id"], "to_email": email, "role": role,
        "shop_ids": shop_ids or [], "status": "pending",
        "created_at": datetime.now(timezone.utc),
    })
    return {"status": "sent", "id": invite_id}


async def list_incoming_invites(user: dict) -> List[dict]:
    invites = await db.org_invites.find(
        {"to_user_id": user["user_id"], "status": "pending"}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    if not invites:
        return []
    org_ids = list({i["org_id"] for i in invites})
    from_ids = list({i["from_user_id"] for i in invites})
    orgs_by_id = {o["id"]: o async for o in db.organisations.find({"id": {"$in": org_ids}}, {"_id": 0})}
    users_by_id = {u["user_id"]: u async for u in
                   db.users.find({"user_id": {"$in": from_ids}}, {"_id": 0, "password_hash": 0})}
    out = []
    for i in invites:
        org = orgs_by_id.get(i["org_id"])
        sender = users_by_id.get(i["from_user_id"])
        if not org:
            continue  # organisation retirée entre-temps : l'invitation n'a plus de sens
        out.append({
            "id": i["id"], "org_id": i["org_id"], "org_name": org["name"], "role": i["role"],
            "from_user_id": i["from_user_id"],
            "from_user_name": (sender or {}).get("name") or "Boulanger",
            "created_at": i["created_at"],
        })
    return out


async def respond_invite(user: dict, invite_id: str, accept: bool) -> dict:
    invite = await db.org_invites.find_one(
        {"id": invite_id, "to_user_id": user["user_id"], "status": "pending"})
    if not invite:
        raise HTTPException(404, "Invitation introuvable.")
    new_status = "accepted" if accept else "declined"
    await db.org_invites.update_one({"id": invite_id}, {"$set": {"status": new_status}})
    if not accept:
        return {"status": new_status}

    now = datetime.now(timezone.utc)
    # Upsert sur (org_id, user_id) plutôt qu'un simple insert : rejoindre une
    # organisation qu'on a déjà quittée (ligne existante `status: "removed"`)
    # ré-active la même ligne plutôt que d'en créer une seconde — l'index
    # unique sur (org_id, user_id) l'imposerait de toute façon.
    await db.org_members.update_one(
        {"org_id": invite["org_id"], "user_id": user["user_id"]},
        {"$set": {"role": invite["role"], "shop_ids": invite.get("shop_ids") or [],
                  "status": "active", "invited_by": invite["from_user_id"], "updated_at": now},
         "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now}},
        upsert=True,
    )
    return {"status": new_status}


async def update_member_role(user: dict, org: dict, member_user_id: str, role: str) -> dict:
    if not org.get("org_id"):
        raise HTTPException(404, "Aucune organisation active.")
    if org.get("role") != "owner":
        raise HTTPException(403, "Seul le propriétaire peut changer un rôle.")
    if role not in ROLES:
        raise HTTPException(422, f"Rôle invalide (attendu : {', '.join(ROLES)})")
    if member_user_id == org["owner_user_id"]:
        raise HTTPException(400, "Le propriétaire ne change pas son propre rôle ici.")
    res = await db.org_members.update_one(
        {"org_id": org["org_id"], "user_id": member_user_id, "status": "active"},
        {"$set": {"role": role, "updated_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Membre introuvable dans cette organisation.")
    return {"status": "updated"}


async def remove_member(user: dict, org: dict, member_user_id: str) -> dict:
    if not org.get("org_id"):
        raise HTTPException(404, "Aucune organisation active.")
    if member_user_id == org["owner_user_id"]:
        raise HTTPException(400, "Le propriétaire ne peut pas être retiré de son organisation.")
    is_self = member_user_id == user["user_id"]
    if not is_self and org.get("role") not in ("owner", "manager"):
        raise HTTPException(403, "Seuls le propriétaire ou un responsable peuvent retirer un autre membre.")
    res = await db.org_members.update_one(
        {"org_id": org["org_id"], "user_id": member_user_id, "status": "active"},
        {"$set": {"status": "removed", "updated_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        # Pas (ou plus) membre actif : peut-être seulement invité et jamais
        # encore accepté. `send_invite` interdit une invitation en attente
        # vers un membre déjà actif, donc les deux cas ne se recoupent
        # jamais — annuler l'invitation est ce que fait réellement « retirer
        # quelqu'un » ici, plutôt qu'un 404 qui laisserait une invitation
        # envoyée par erreur sans aucun moyen de l'annuler.
        cancelled = await db.org_invites.update_many(
            {"org_id": org["org_id"], "to_user_id": member_user_id, "status": "pending"},
            {"$set": {"status": "declined"}},
        )
        if cancelled.modified_count == 0:
            raise HTTPException(404, "Membre introuvable dans cette organisation.")
        return {"status": "invite_cancelled"}
    # Purge les invitations résiduelles vers cette personne pour cette
    # organisation — même principe que `remove_team_member` (server.py) ;
    # défensif ici, puisque `send_invite` empêche normalement qu'un membre
    # actif ait aussi une invitation en attente dans la même organisation.
    await db.org_invites.update_many(
        {"org_id": org["org_id"], "to_user_id": member_user_id, "status": "pending"},
        {"$set": {"status": "declined"}},
    )
    # Un compte qui se retire lui-même et avait cette organisation comme
    # espace de travail actif retombe proprement : plus rien ne la
    # sélectionne, `resolve_active_membership` gérera le repli tout seul au
    # prochain appel. Rien à faire ici de plus — `active_org_id` peut
    # continuer à pointer vers une organisation dont on n'est plus membre
    # sans risque : `get_org_context` ne retient `chosen` que si la ligne
    # d'appartenance existe encore parmi les `memberships` actives.
    return {"status": "removed"}
