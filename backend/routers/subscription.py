"""Abonnements : le webhook du fournisseur de facturation.

**Rien n'est achetable aujourd'hui.** Aucun SDK n'est installé, aucune route
ne déclenche de paiement. Ce fichier existe pour que la couture ait la bonne
forme le jour où RevenueCat sera branché — et pour qu'elle soit testée d'ici
là avec des charges utiles synthétiques, plutôt que découverte en production.

Pourquoi un webhook plutôt qu'une validation de reçu côté client : c'est le
serveur qui doit rester la source de vérité du palier. Un client peut mentir,
être hors ligne au moment d'un renouvellement, ou être réinstallé sur un autre
téléphone — le webhook, lui, arrive quoi qu'il arrive, et `resolve_plan` lit
ensuite l'état stocké. C'est aussi ce qui fait fonctionner la restauration
d'achat sans code dédié : le palier suit le compte, pas l'appareil.
"""
import hmac
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request

import subscription_state
import subscriptions
from core import db, get_current_user

router = APIRouter(prefix="/api")

# RevenueCat regroupe ses événements en quelques types ; on ne retient que
# ceux qui changent réellement ce à quoi l'utilisateur a droit.
_STATUS_BY_EVENT = {
    "INITIAL_PURCHASE": subscription_state.ACTIVE,
    "RENEWAL": subscription_state.ACTIVE,
    "PRODUCT_CHANGE": subscription_state.ACTIVE,
    "UNCANCELLATION": subscription_state.ACTIVE,
    "TRIAL_STARTED": subscription_state.TRIALING,
    "CANCELLATION": subscription_state.CANCELLED,
    "EXPIRATION": subscription_state.EXPIRED,
    "BILLING_ISSUE": subscription_state.PAST_DUE,
}


def _authorize(authorization: Optional[str]) -> None:
    """Le secret partagé, comparé en temps constant.

    Sans `REVENUECAT_WEBHOOK_SECRET` configuré, la route refuse tout : une
    route de facturation ouverte par défaut serait un moyen d'accorder un
    palier payant à n'importe qui.
    """
    attendu = os.environ.get("REVENUECAT_WEBHOOK_SECRET", "")
    if not attendu:
        raise HTTPException(503, "Webhook de facturation non configuré")
    fourni = (authorization or "").strip()
    if fourni.lower().startswith("bearer "):
        fourni = fourni[7:].strip()
    if not hmac.compare_digest(fourni, attendu):
        raise HTTPException(401, "Signature invalide")


@router.post("/webhooks/revenuecat")
async def revenuecat_webhook(request: Request,
                             authorization: Optional[str] = Header(None)):
    """Applique un événement de facturation à l'abonnement d'un utilisateur.

    Renvoie toujours 200 sur un événement compris mais sans effet (type
    inconnu, utilisateur introuvable) : un fournisseur de webhook qui reçoit
    une erreur réessaie en boucle, et retenter n'arrangerait rien dans ces
    deux cas. Les vraies erreurs — secret absent ou faux — répondent, elles,
    par un code d'échec.
    """
    _authorize(authorization)
    corps = await request.json()
    event = (corps or {}).get("event") or {}

    type_event = event.get("type")
    statut = _STATUS_BY_EVENT.get(type_event)
    if statut is None:
        return {"status": "ignored", "reason": "type non suivi"}

    # `app_user_id` est le `user_id` Levanea : c'est l'application qui le
    # fournit à RevenueCat à la connexion, jamais l'inverse.
    user_id = event.get("app_user_id")
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "user_id": 1}) if user_id else None
    if not user:
        return {"status": "ignored", "reason": "utilisateur inconnu"}

    palier = subscription_state.tier_for_product(event.get("product_id"))
    if palier is None and statut not in (subscription_state.EXPIRED,):
        # Produit inconnu : on n'invente pas de palier. L'événement est
        # journalisé comme ignoré plutôt que d'accorder quoi que ce soit.
        return {"status": "ignored", "reason": "produit inconnu"}

    doc = await subscriptions.record_event(
        user["user_id"],
        event_id=event.get("id"),
        event_type=type_event,
        plan=palier or subscription_state.FREE,
        status=statut,
        product_id=event.get("product_id"),
        store=event.get("store"),
        app_user_id=user_id,
        current_period_end=event.get("expiration_at_ms") and _from_ms(event["expiration_at_ms"]),
        trial_end=event.get("trial_end_at_ms") and _from_ms(event["trial_end_at_ms"]),
        cancel_at_period_end=(statut == subscription_state.CANCELLED),
        grace_until=event.get("grace_period_expiration_at_ms") and _from_ms(event["grace_period_expiration_at_ms"]),
    )
    return {"status": "applied", "plan": doc["plan"], "subscription_status": doc["status"]}


def _from_ms(ms) -> Optional[str]:
    """Les horodatages RevenueCat sont en millisecondes epoch."""
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


@router.get("/me/subscription")
async def my_subscription(user: dict = Depends(get_current_user)):
    """L'état d'abonnement du compte courant, tel que l'écran l'affiche.

    Séparé de `/me/plan` — celui-ci répond « à quoi ai-je droit », celle-ci
    « où en est mon abonnement ». Un compte sans abonnement obtient un état
    neutre plutôt qu'un 404 : ne pas être abonné est un état normal.
    """
    sub = await subscriptions.get_subscription(user["user_id"])
    return subscriptions.public_state(sub)
