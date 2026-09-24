"""Organisations (offre Équipe) : /organisations*.

Couche fine : chaque route résout ses dépendances (utilisateur, contexte
d'organisation) et délègue à `organisations.py`, même découpage que
`routers/subscription.py`/`subscriptions.py`. Aucune route ici n'importe
`server.py` — voir `core.py`, "aucun risque d'import circulaire".
"""
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import dashboard
import organisations
from core import db, get_current_user
from gating import require

router = APIRouter(prefix="/api/organisations")


class OrganisationCreateInput(BaseModel):
    name: str
    shop_name: Optional[str] = None


class OrgInviteInput(BaseModel):
    email: str
    role: str  # "manager" | "employee"
    shop_ids: Optional[List[str]] = None


class OrgRoleInput(BaseModel):
    role: str  # "manager" | "employee"


class RespondInput(BaseModel):
    accept: bool


@router.post("")
async def create_organisation(
    inp: OrganisationCreateInput,
    user: dict = Depends(require(feature="org_team")),
):
    return await organisations.create_organisation(user, inp.name, inp.shop_name)


@router.get("/me")
async def my_organisations(
    user: dict = Depends(get_current_user),
    org: dict = Depends(organisations.get_org_context),
):
    return await organisations.list_my_organisations(user, org)


@router.post("/{org_id}/activate")
async def activate_organisation(org_id: str, user: dict = Depends(get_current_user)):
    return await organisations.activate_organisation(user, org_id)


@router.get("/members")
async def list_members(org: dict = Depends(organisations.get_org_context)):
    return await organisations.list_members(org)


@router.post("/invites")
async def send_invite(
    inp: OrgInviteInput,
    user: dict = Depends(get_current_user),
    org: dict = Depends(organisations.get_org_context),
):
    return await organisations.send_invite(user, org, inp.email, inp.role, inp.shop_ids)


@router.get("/invites")
async def list_incoming_invites(user: dict = Depends(get_current_user)):
    return await organisations.list_incoming_invites(user)


@router.post("/invites/{invite_id}/respond")
async def respond_invite(invite_id: str, inp: RespondInput, user: dict = Depends(get_current_user)):
    return await organisations.respond_invite(user, invite_id, inp.accept)


@router.put("/members/{member_user_id}/role")
async def update_member_role(
    member_user_id: str,
    inp: OrgRoleInput,
    user: dict = Depends(get_current_user),
    org: dict = Depends(organisations.get_org_context),
):
    return await organisations.update_member_role(user, org, member_user_id, inp.role)


@router.delete("/members/{member_user_id}")
async def remove_member(
    member_user_id: str,
    user: dict = Depends(get_current_user),
    org: dict = Depends(organisations.get_org_context),
):
    return await organisations.remove_member(user, org, member_user_id)


@router.get("/dashboard")
async def get_dashboard(
    period: str = "week",
    user: dict = Depends(get_current_user),
    org: dict = Depends(organisations.get_org_context),
):
    return await dashboard.build(db, user, org, period)
