"""Le webhook RevenueCat et `/me/subscription`, vus depuis l'API.

Le webhook a besoin d'un secret partagé pour être testé authentifié — la
même valeur doit configurer le serveur (`REVENUECAT_WEBHOOK_SECRET`) et ce
fichier. Comme `PRO_EMAILS`/`PLAN_OVERRIDES`, la variable vit dans l'`env:`
du job CI, partagée telle quelle entre le processus uvicorn et pytest (pas
besoin d'un second nom "_FOR_TESTS" : ce n'est pas une liste qu'on fusionne,
c'est un seul secret que les deux côtés doivent connaître). Faute de cette
variable, les tests qui en ont besoin s'ignorent plutôt que d'échouer —
même convention que `TestProPlan` dans `test_productions_api.py`.

Le refus sans secret configuré (`_authorize` renvoie 503) est un état du
*serveur*, pas du compte : il ne peut pas être déclenché contre un serveur
partagé qui, lui, a un secret. Il est testé directement en unitaire dans
`test_subscriptions_calc.py`, pas ici.
"""
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"

WEBHOOK_SECRET = os.environ.get("REVENUECAT_WEBHOOK_SECRET", "")

requires_webhook_secret = pytest.mark.skipif(
    not WEBHOOK_SECRET,
    reason="REVENUECAT_WEBHOOK_SECRET non configuré sur ce serveur",
)


def _register():
    email = f"sub.{uuid.uuid4().hex[:10]}@bakers.app"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": "TestSub2026!", "name": "Chef Abonné"},
                      timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"], r.json()["user"]["user_id"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _plan(token):
    r = requests.get(f"{API}/me/plan", headers=_h(token), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _subscription(token):
    r = requests.get(f"{API}/me/subscription", headers=_h(token), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _webhook(payload, secret=None):
    headers = {"Authorization": f"Bearer {secret if secret is not None else WEBHOOK_SECRET}"}
    return requests.post(f"{API}/webhooks/revenuecat", json={"event": payload},
                         headers=headers, timeout=30)


def _event(user_id, **over):
    base = {
        "id": f"evt-{uuid.uuid4().hex}",
        "type": "INITIAL_PURCHASE",
        "app_user_id": user_id,
        "product_id": "levanea_pro_plus_monthly",
        "store": "app_store",
        "expiration_at_ms": 4102444800000,  # 2100-01-01, largement dans le futur
    }
    base.update(over)
    return base


class TestSansCompteAbonnement:
    """Un compte qui n'a jamais reçu de webhook obtient un état neutre."""

    def test_etat_neutre_jamais_un_404(self):
        token, _ = _register()
        body = _subscription(token)
        assert body == {
            "status": None, "plan": "free", "active": False,
            "renews_at": None, "ends_at": None, "in_grace": False,
        }

    def test_le_palier_effectif_reste_free(self):
        token, _ = _register()
        assert _plan(token)["plan"] == "free"


@requires_webhook_secret
class TestAutorisation:
    def test_mauvais_secret_est_refuse(self):
        r = _webhook(_event("peu-importe"), secret="mauvais-secret")
        assert r.status_code == 401

    def test_sans_en_tete_est_refuse(self):
        r = requests.post(f"{API}/webhooks/revenuecat", json={"event": _event("peu-importe")},
                          timeout=30)
        assert r.status_code == 401

    def test_le_prefixe_bearer_est_optionnel(self):
        """`_authorize` accepte le secret nu, pas seulement `Bearer <secret>`."""
        _, uid = _register()
        r = requests.post(f"{API}/webhooks/revenuecat",
                          json={"event": _event(uid, type="TYPE_INCONNU")},
                          headers={"Authorization": WEBHOOK_SECRET}, timeout=30)
        assert r.status_code == 200


@requires_webhook_secret
class TestEvenementsIgnores:
    """Compris mais sans effet : toujours 200, jamais retenté en boucle par
    le fournisseur de webhook."""

    def test_type_inconnu(self):
        _, uid = _register()
        r = _webhook(_event(uid, type="UN_TYPE_QUI_N_EXISTE_PAS"))
        assert r.status_code == 200
        assert r.json()["status"] == "ignored"
        assert _plan(_register()[0])["plan"] == "free"  # rien n'a fuité ailleurs

    def test_utilisateur_inconnu(self):
        r = _webhook(_event("un-user-id-qui-n-existe-pas"))
        assert r.status_code == 200
        assert r.json()["status"] == "ignored"

    def test_produit_inconnu_n_accorde_rien(self):
        _, uid = _register()
        r = _webhook(_event(uid, product_id="produit-jamais-cree-dans-la-console"))
        assert r.status_code == 200
        assert r.json()["status"] == "ignored"


@requires_webhook_secret
class TestApplicationDUnAbonnement:
    def test_un_achat_initial_accorde_le_palier(self):
        token, uid = _register()
        r = _webhook(_event(uid, product_id="levanea_pro_plus_monthly"))
        assert r.status_code == 200
        assert r.json() == {"status": "applied", "plan": "pro_plus", "subscription_status": "active"}
        assert _plan(token)["plan"] == "pro_plus"
        state = _subscription(token)
        assert state["status"] == "active"
        assert state["plan"] == "pro_plus"
        assert state["active"] is True
        assert state["renews_at"] is not None
        assert state["ends_at"] is None

    def test_une_resiliation_promet_une_fin_pas_un_renouvellement(self):
        token, uid = _register()
        _webhook(_event(uid, product_id="levanea_team_monthly"))
        r = _webhook(_event(uid, type="CANCELLATION", product_id="levanea_team_monthly",
                            id=f"evt-cancel-{uuid.uuid4().hex}"))
        assert r.status_code == 200
        state = _subscription(token)
        # Résilié mais encore payé jusqu'à l'échéance (2100) : le palier reste
        # accordé, seule l'intention change.
        assert state["plan"] == "team"
        assert state["active"] is True
        assert state["renews_at"] is None
        assert state["ends_at"] is not None
        assert _plan(token)["plan"] == "team"

    def test_une_expiration_retombe_sur_free(self):
        token, uid = _register()
        _webhook(_event(uid, product_id="levanea_pro_monthly"))
        r = _webhook(_event(uid, type="EXPIRATION", id=f"evt-expire-{uuid.uuid4().hex}"))
        assert r.status_code == 200
        assert _plan(token)["plan"] == "free"
        assert _subscription(token)["active"] is False

    def test_rien_n_a_disparu_en_retombant_sur_free(self):
        """La garantie centrale du chantier : une rétrogradation ne supprime
        jamais rien. Une recette créée sous un palier payant reste lisible
        une fois l'abonnement expiré."""
        token, uid = _register()
        _webhook(_event(uid, product_id="levanea_pro_monthly"))
        created = requests.post(f"{API}/recipes", json={
            "title": f"Pain de l'abonné {uuid.uuid4().hex[:6]}",
            "category": "Pains", "difficulty": "facile", "time_minutes": 60,
            "description": "Une pâte simple, pétrie puis façonnée.",
            "ingredients": ["500 g farine T65", "350 g eau", "10 g sel"],
            "steps": ["Pétrir 10 min.", "Pointage 1 h.", "Façonner et cuire 25 min."],
        }, headers=_h(token), timeout=30)
        assert created.status_code == 200, created.text
        rid = created.json()["id"]

        _webhook(_event(uid, type="EXPIRATION", id=f"evt-expire-{uuid.uuid4().hex}"))
        assert _plan(token)["plan"] == "free"
        r = requests.get(f"{API}/recipes/{rid}", headers=_h(token), timeout=30)
        assert r.status_code == 200


@requires_webhook_secret
class TestIdempotence:
    """Rejouer le même `event.id` — ce que tout fournisseur de webhook fait
    en cas de doute sur la livraison — ne doit produire aucun effet visible
    de plus, et surtout ne pas rouvrir un abonnement déjà résilié."""

    def test_le_meme_evenement_rejoue_ne_change_rien(self):
        token, uid = _register()
        event = _event(uid, product_id="levanea_pro_monthly")
        first = _webhook(event)
        assert first.status_code == 200
        state_apres_premier = _subscription(token)

        # Rejouer EXACTEMENT le même corps, id compris.
        second = _webhook(event)
        assert second.status_code == 200
        assert second.json() == first.json()
        assert _subscription(token) == state_apres_premier

    def test_consecutive_replays_of_the_latest_event_stay_deduped(self):
        """La garantie ne porte que sur le DERNIER événement livré — c'est ce
        qu'un fournisseur de webhook rejoue réellement en cas de doute sur une
        livraison. Trois rejeux d'affilée du même événement le plus récent ne
        doivent produire qu'une seule application, quel que soit le nombre de
        tentatives."""
        token, uid = _register()
        event = _event(uid, product_id="levanea_pro_monthly")
        for _ in range(3):
            r = _webhook(event)
            assert r.status_code == 200
        assert _subscription(token)["plan"] == "pro"
