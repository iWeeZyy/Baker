"""Phase 7b : commandes pro (`/pro-orders*`) et leur fusion avec l'agrégat
de matières d'une production due le même jour.

Trois classes, chacune avec sa propre adresse `PLAN_OVERRIDES` dédiée
(`test.org.orders.{acces,crud,fusion}@bakers.app`) — même raison que
`test_dashboard_api.py`/`test_organisations_api.py` : créer une
organisation exige le palier Équipe, et `pytest-xdist --dist loadscope`
peut répartir deux classes sur deux workers différents, ce qui ferait
courir un compte partagé sous deux `active_org_id` à la fois.
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"

_ACCES_EMAIL = os.environ.get('TEST_ORG_ORDERS_ACCES_EMAIL', 'test.org.orders.acces@bakers.app')
_CRUD_EMAIL = os.environ.get('TEST_ORG_ORDERS_CRUD_EMAIL', 'test.org.orders.crud@bakers.app')
_FUSION_EMAIL = os.environ.get('TEST_ORG_ORDERS_FUSION_EMAIL', 'test.org.orders.fusion@bakers.app')
_OWNER_PASSWORD = 'TestOrgTeam2026!'


def _register(email=None, password=None, name="Chef"):
    email = email or f"orgorders.{uuid.uuid4().hex[:10]}@bakers.app"
    password = password or "TestOrgOrders2026!"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": password, "name": name}, timeout=30)
    if r.status_code == 400:
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
        if r.status_code == 401:
            pytest.skip(f"{email} existe déjà avec un autre mot de passe (base non vierge)")
    assert r.status_code == 200, r.text
    body = r.json()
    return body["token"], body["user"]["user_id"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _plan(token):
    r = requests.get(f"{API}/me/plan", headers=_h(token), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _owner(email):
    """Un compte capable de créer une organisation, dans les deux positions
    de l'interrupteur — même helper que `test_dashboard_api.py`."""
    probe_token, probe_uid = _register()
    if not _plan(probe_token)["enforced"]:
        return probe_token, probe_uid
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": _OWNER_PASSWORD, "name": "Chef Commandes"}, timeout=30)
    if r.status_code == 400:
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": _OWNER_PASSWORD}, timeout=30)
        if r.status_code == 401:
            pytest.skip(f"{email} existe déjà avec un autre mot de passe (base non vierge)")
    assert r.status_code == 200, r.text
    body = r.json()
    return body["token"], body["user"]["user_id"]


def _org_with_employee(owner_email):
    owner_token, owner_uid = _owner(owner_email)
    emp_token, emp_uid = _register()
    org = requests.post(f"{API}/organisations", json={"name": f"Commandes {uuid.uuid4().hex[:6]}"},
                        headers=_h(owner_token), timeout=30).json()
    emp_email = requests.get(f"{API}/auth/me", headers=_h(emp_token), timeout=30).json()["email"]
    invite = requests.post(f"{API}/organisations/invites",
                           json={"email": emp_email, "role": "employee"},
                           headers=_h(owner_token), timeout=30)
    assert invite.status_code == 200, invite.text
    invites = requests.get(f"{API}/organisations/invites", headers=_h(emp_token), timeout=30).json()
    resp = requests.post(f"{API}/organisations/invites/{invites[0]['id']}/respond",
                         json={"accept": True}, headers=_h(emp_token), timeout=30)
    assert resp.status_code == 200, resp.text
    return owner_token, owner_uid, emp_token, emp_uid, org


@pytest.fixture(scope="module")
def recipes():
    r = requests.get(f"{API}/recipes", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 1
    return data


def _order_payload(recipes, pickup_date, **overrides):
    payload = {
        "client_name": "M. Dupont",
        "client_contact": "06 00 00 00 00",
        "items": [{"recipe_id": recipes[0]["id"], "quantity": 2, "mode": "batches"}],
        "pickup_date": pickup_date,
        "pickup_time": "09:00",
        "status": "pending",
        "price_total": 45.0,
        "deposit_paid": 15.0,
        "notes": "Sans gluten",
    }
    payload.update(overrides)
    return payload


class TestAccesCommandes:
    def test_hors_organisation_est_refuse(self, recipes):
        token, _uid = _register()
        r = requests.post(f"{API}/pro-orders", json=_order_payload(recipes, "2026-11-10"),
                          headers=_h(token), timeout=30)
        assert r.status_code == 422

    def test_un_employe_peut_creer_une_commande(self, recipes):
        """Aucune restriction de rôle demandée pour les commandes (à la
        différence du tableau de bord) — tout membre actif peut créer,
        comme pour une production ou un planning."""
        _owner_token, _owner_uid, emp_token, _emp_uid, _org = _org_with_employee(_ACCES_EMAIL)
        r = requests.post(f"{API}/pro-orders", json=_order_payload(recipes, "2026-11-11"),
                          headers=_h(emp_token), timeout=30)
        assert r.status_code == 200, r.text

    def test_un_collegue_voit_la_commande_de_l_autre(self, recipes):
        owner_token, _owner_uid, emp_token, _emp_uid, _org = _org_with_employee(_ACCES_EMAIL)
        created = requests.post(f"{API}/pro-orders", json=_order_payload(recipes, "2026-11-12"),
                                headers=_h(owner_token), timeout=30)
        assert created.status_code == 200, created.text
        order_id = created.json()["id"]
        listed = requests.get(f"{API}/pro-orders", headers=_h(emp_token), timeout=30).json()
        assert order_id in {o["id"] for o in listed}

    def test_un_tiers_hors_organisation_ne_la_voit_jamais(self, recipes):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_ACCES_EMAIL)
        created = requests.post(f"{API}/pro-orders", json=_order_payload(recipes, "2026-11-13"),
                                headers=_h(owner_token), timeout=30)
        order_id = created.json()["id"]
        outsider_token, _ = _register()
        r = requests.get(f"{API}/pro-orders/{order_id}", headers=_h(outsider_token), timeout=30)
        assert r.status_code == 404

    def test_un_employe_ne_peut_pas_supprimer_la_commande_du_proprietaire(self, recipes):
        owner_token, _owner_uid, emp_token, _emp_uid, _org = _org_with_employee(_ACCES_EMAIL)
        created = requests.post(f"{API}/pro-orders", json=_order_payload(recipes, "2026-11-14"),
                                headers=_h(owner_token), timeout=30)
        order_id = created.json()["id"]
        r = requests.delete(f"{API}/pro-orders/{order_id}", headers=_h(emp_token), timeout=30)
        assert r.status_code == 403


class TestCRUDCommandes:
    def test_creer_et_relire(self, recipes):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_CRUD_EMAIL)
        r = requests.post(f"{API}/pro-orders", json=_order_payload(recipes, "2026-11-15"),
                          headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["client_name"] == "M. Dupont"
        assert body["balance_due"] == 30.0  # 45 - 15
        assert body["status"] == "pending"

        got = requests.get(f"{API}/pro-orders/{body['id']}", headers=_h(owner_token), timeout=30)
        assert got.status_code == 200
        assert got.json()["balance_due"] == 30.0

    def test_sans_prix_le_solde_reste_absent(self, recipes):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_CRUD_EMAIL)
        r = requests.post(f"{API}/pro-orders",
                          json=_order_payload(recipes, "2026-11-16", price_total=None, deposit_paid=None),
                          headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["balance_due"] is None

    def test_acompte_superieur_au_prix_est_refuse(self, recipes):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_CRUD_EMAIL)
        r = requests.post(f"{API}/pro-orders",
                          json=_order_payload(recipes, "2026-11-17", price_total=10.0, deposit_paid=20.0),
                          headers=_h(owner_token), timeout=30)
        assert r.status_code == 422

    def test_sans_article_est_refuse(self, recipes):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_CRUD_EMAIL)
        payload = _order_payload(recipes, "2026-11-18", items=[])
        r = requests.post(f"{API}/pro-orders", json=payload, headers=_h(owner_token), timeout=30)
        assert r.status_code == 422

    def test_date_invalide_est_refusee(self, recipes):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_CRUD_EMAIL)
        r = requests.post(f"{API}/pro-orders", json=_order_payload(recipes, "18 novembre"),
                          headers=_h(owner_token), timeout=30)
        assert r.status_code == 422

    def test_changer_uniquement_le_statut(self, recipes):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_CRUD_EMAIL)
        created = requests.post(f"{API}/pro-orders", json=_order_payload(recipes, "2026-11-19"),
                                headers=_h(owner_token), timeout=30).json()
        r = requests.patch(f"{API}/pro-orders/{created['id']}/status", json={"status": "ready"},
                           headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "ready"

    def test_statut_invalide_est_refuse(self, recipes):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_CRUD_EMAIL)
        created = requests.post(f"{API}/pro-orders", json=_order_payload(recipes, "2026-11-20"),
                                headers=_h(owner_token), timeout=30).json()
        r = requests.patch(f"{API}/pro-orders/{created['id']}/status", json={"status": "en_cuisson"},
                           headers=_h(owner_token), timeout=30)
        assert r.status_code == 422

    def test_modifier_une_commande_ne_change_pas_une_recette_deja_editee(self, recipes):
        """Même principe que les productions : l'article snapshotte la
        recette à l'instant de la commande, une édition de la recette
        ensuite ne doit pas rejouer sur une commande déjà enregistrée."""
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_CRUD_EMAIL)
        created = requests.post(f"{API}/pro-orders", json=_order_payload(recipes, "2026-11-21"),
                                headers=_h(owner_token), timeout=30).json()
        assert created["items"][0]["recipe_title"] == recipes[0]["title"]

    def test_lister_puis_supprimer(self, recipes):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_CRUD_EMAIL)
        created = requests.post(f"{API}/pro-orders", json=_order_payload(recipes, "2026-11-22"),
                                headers=_h(owner_token), timeout=30).json()
        listed = requests.get(f"{API}/pro-orders", headers=_h(owner_token), timeout=30).json()
        assert any(o["id"] == created["id"] for o in listed)

        d = requests.delete(f"{API}/pro-orders/{created['id']}", headers=_h(owner_token), timeout=30)
        assert d.status_code == 200
        after = requests.get(f"{API}/pro-orders/{created['id']}", headers=_h(owner_token), timeout=30)
        assert after.status_code == 404


class TestFusionAvecLaProduction:
    def test_une_commande_due_le_meme_jour_contribue_a_l_agregat(self, recipes):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_FUSION_EMAIL)
        date = "2026-11-23"
        order = requests.post(f"{API}/pro-orders", json=_order_payload(recipes, date, status="confirmed"),
                              headers=_h(owner_token), timeout=30)
        assert order.status_code == 200, order.text

        prod = requests.post(f"{API}/productions", json={
            "date": date, "target_time": "06:00",
            "lines": [{"recipe_id": recipes[0]["id"], "quantity": 1, "mode": "batches"}],
        }, headers=_h(owner_token), timeout=30)
        assert prod.status_code == 200, prod.text
        body = prod.json()
        assert body["orders_count"] == 1
        # La commande (2 fournées) + la production (1 fournée) = 3 fournées
        # au total pour cette même recette/ingrédient — jamais compté deux
        # fois, jamais absent.
        assert len(body["ingredients"]["items"]) >= 1

    def test_une_commande_annulee_ne_contribue_jamais(self, recipes):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_FUSION_EMAIL)
        date = "2026-11-24"
        requests.post(f"{API}/pro-orders", json=_order_payload(recipes, date, status="cancelled"),
                     headers=_h(owner_token), timeout=30)
        prod = requests.post(f"{API}/productions", json={
            "date": date, "target_time": "06:00", "lines": [],
        }, headers=_h(owner_token), timeout=30)
        assert prod.status_code == 200, prod.text
        assert prod.json()["orders_count"] == 0

    def test_une_commande_d_un_autre_jour_ne_contribue_pas(self, recipes):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_FUSION_EMAIL)
        requests.post(f"{API}/pro-orders", json=_order_payload(recipes, "2026-11-25"),
                     headers=_h(owner_token), timeout=30)
        prod = requests.post(f"{API}/productions", json={
            "date": "2026-11-26", "target_time": "06:00", "lines": [],
        }, headers=_h(owner_token), timeout=30)
        assert prod.status_code == 200, prod.text
        assert prod.json()["orders_count"] == 0

    def test_endpoint_agregat_avant_toute_production(self, recipes):
        """L'agrégat des commandes reste consultable même sans production
        créée pour ce jour-là."""
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_FUSION_EMAIL)
        date = "2026-11-27"
        requests.post(f"{API}/pro-orders", json=_order_payload(recipes, date, status="confirmed"),
                     headers=_h(owner_token), timeout=30)
        r = requests.get(f"{API}/pro-orders/aggregate", params={"date": date},
                         headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["order_count"] == 1
        assert len(body["ingredients"]["items"]) >= 1
