"""Phase 7a, commit 3/3 : `scope()`/`stamp()`/`can_delete()` branchés dans
`routers/{production,staff,cost}.py`.

Ce fichier couvre le seul comportement neuf introduit par ce commit — le
partage réel des productions, plannings et matières premières entre membres
d'une même organisation — jamais retesté ailleurs :

- deux collègues (même organisation active) voient et modifient les mêmes
  documents ;
- un tiers hors organisation (ou dans une autre) ne les voit jamais ;
- supprimer le document d'un collègue est réservé à l'encadrement
  (`can_delete`), jamais à un simple employé ;
- un compte qui n'entre jamais dans une organisation garde exactement le
  comportement d'avant ce commit — déjà couvert en détail par
  `test_productions_api.py`/`test_schedules_api.py`/`test_cost_api.py`,
  répété ici brièvement pour la forme, pas dupliqué.

Créer une organisation exige le palier Équipe (`feature="org_team"`), donc
sous `ENTITLEMENTS_ENFORCED` ce fichier bascule sur SA PROPRE adresse
`PLAN_OVERRIDES` dédiée (`test.org.sharing@bakers.app`), même raison que
`test_organisations_api.py` (voir son en-tête) — jamais partagée avec une
autre classe pour éviter une course `pytest-xdist --dist loadscope` sur
`active_org_id`.

Le quota `productions_per_month` partagé par organisation (voir
`gating.usage(org_id=...)`, testé en pur dans `test_gating_calc.py`) n'est
PAS ré-exercé ici au niveau HTTP : créer une organisation exige déjà le
palier Équipe, qui n'a aucun plafond de productions — la situation "quota
fini partagé entre collègues" ne peut donc jamais se produire en pratique
tant que seule l'offre la plus haute donne accès aux organisations.
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"

_OWNER_EMAIL = os.environ.get('TEST_ORG_SHARING_EMAIL', 'test.org.sharing@bakers.app')
_OWNER_PASSWORD = 'TestOrgTeam2026!'


def _register(email=None, password=None, name="Chef"):
    email = email or f"orgshare.{uuid.uuid4().hex[:10]}@bakers.app"
    password = password or "TestOrgShare2026!"
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


def _owner():
    """Un compte capable de créer une organisation, dans les deux positions
    de l'interrupteur — même helper que `test_organisations_api.py`."""
    probe_token, probe_uid = _register()
    if not _plan(probe_token)["enforced"]:
        return probe_token, probe_uid
    r = requests.post(f"{API}/auth/register",
                      json={"email": _OWNER_EMAIL, "password": _OWNER_PASSWORD, "name": "Chef Équipe"}, timeout=30)
    if r.status_code == 400:
        r = requests.post(f"{API}/auth/login", json={"email": _OWNER_EMAIL, "password": _OWNER_PASSWORD}, timeout=30)
        if r.status_code == 401:
            pytest.skip(f"{_OWNER_EMAIL} existe déjà avec un autre mot de passe (base non vierge)")
    assert r.status_code == 200, r.text
    body = r.json()
    return body["token"], body["user"]["user_id"]


@pytest.fixture(scope="module")
def recipes():
    r = requests.get(f"{API}/recipes", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 1
    return data


def _production_payload(recipes, date="2026-10-06"):
    return {"date": date, "target_time": "06:00", "notes": "Partagée",
            "lines": [{"recipe_id": recipes[0]["id"], "quantity": 2, "mode": "batches"}]}


def _org_with_employee():
    """Une organisation fraîche, avec un employé qui l'a rejointe."""
    owner_token, owner_uid = _owner()
    emp_token, emp_uid = _register()
    org = requests.post(f"{API}/organisations", json={"name": f"Partage {uuid.uuid4().hex[:6]}"},
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


class TestProductionsPartagees:
    def test_un_collegue_voit_et_lit_la_production_de_l_autre(self, recipes):
        owner_token, _owner_uid, emp_token, _emp_uid, _org = _org_with_employee()
        created = requests.post(f"{API}/productions", json=_production_payload(recipes),
                                headers=_h(owner_token), timeout=30)
        assert created.status_code == 200, created.text
        prod_id = created.json()["id"]

        listed = requests.get(f"{API}/productions", headers=_h(emp_token), timeout=30).json()
        assert prod_id in {p["id"] for p in listed}
        detail = requests.get(f"{API}/productions/{prod_id}", headers=_h(emp_token), timeout=30)
        assert detail.status_code == 200

    def test_un_tiers_hors_organisation_ne_la_voit_jamais(self, recipes):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee()
        created = requests.post(f"{API}/productions", json=_production_payload(recipes, date="2026-10-07"),
                                headers=_h(owner_token), timeout=30)
        prod_id = created.json()["id"]

        outsider_token, _ = _register()
        listed = requests.get(f"{API}/productions", headers=_h(outsider_token), timeout=30).json()
        assert prod_id not in {p["id"] for p in listed}
        r = requests.get(f"{API}/productions/{prod_id}", headers=_h(outsider_token), timeout=30)
        assert r.status_code == 404  # existe, mais indiscernable d'un id inconnu

    def test_un_employe_ne_peut_pas_supprimer_la_production_du_proprietaire(self, recipes):
        owner_token, _owner_uid, emp_token, _emp_uid, _org = _org_with_employee()
        created = requests.post(f"{API}/productions", json=_production_payload(recipes, date="2026-10-08"),
                                headers=_h(owner_token), timeout=30)
        prod_id = created.json()["id"]

        r = requests.delete(f"{API}/productions/{prod_id}", headers=_h(emp_token), timeout=30)
        assert r.status_code == 403
        # Toujours là : le refus n'a rien effacé.
        assert requests.get(f"{API}/productions/{prod_id}", headers=_h(owner_token), timeout=30).status_code == 200

    def test_le_proprietaire_peut_supprimer_la_production_d_un_employe(self, recipes):
        owner_token, _owner_uid, emp_token, _emp_uid, _org = _org_with_employee()
        created = requests.post(f"{API}/productions", json=_production_payload(recipes, date="2026-10-09"),
                                headers=_h(emp_token), timeout=30)
        prod_id = created.json()["id"]

        r = requests.delete(f"{API}/productions/{prod_id}", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200

    def test_un_employe_peut_toujours_supprimer_la_sienne(self, recipes):
        owner_token, _owner_uid, emp_token, _emp_uid, _org = _org_with_employee()
        created = requests.post(f"{API}/productions", json=_production_payload(recipes, date="2026-10-10"),
                                headers=_h(emp_token), timeout=30)
        prod_id = created.json()["id"]

        r = requests.delete(f"{API}/productions/{prod_id}", headers=_h(emp_token), timeout=30)
        assert r.status_code == 200


class TestPlanningPartage:
    def _payload(self, week_start="2026-10-04"):  # un dimanche
        return {"week_start": week_start, "employees": [
            {"name": "Nuit", "days": [{"start": "22:00", "end": "6:00", "off": False}] + [None] * 6},
        ]}

    def test_un_collegue_voit_le_planning_de_l_autre(self):
        owner_token, _owner_uid, emp_token, _emp_uid, _org = _org_with_employee()
        created = requests.post(f"{API}/schedules", json=self._payload(), headers=_h(owner_token), timeout=30)
        assert created.status_code == 200, created.text
        sched_id = created.json()["id"]

        listed = requests.get(f"{API}/schedules", headers=_h(emp_token), timeout=30).json()
        assert sched_id in {s["id"] for s in listed}

    def test_un_employe_ne_peut_pas_supprimer_le_planning_du_proprietaire(self):
        owner_token, _owner_uid, emp_token, _emp_uid, _org = _org_with_employee()
        created = requests.post(f"{API}/schedules", json=self._payload("2026-10-11"),
                                headers=_h(owner_token), timeout=30)
        sched_id = created.json()["id"]
        r = requests.delete(f"{API}/schedules/{sched_id}", headers=_h(emp_token), timeout=30)
        assert r.status_code == 403


class TestMatieresPremierePartagees:
    def test_un_collegue_voit_la_matiere_de_l_autre(self):
        owner_token, _owner_uid, emp_token, _emp_uid, _org = _org_with_employee()
        name = f"Farine partagée {uuid.uuid4().hex[:6]}"
        created = requests.post(f"{API}/raw-materials", json={
            "name": name, "purchase_price": 20, "purchase_quantity": 25, "purchase_unit": "kg",
        }, headers=_h(owner_token), timeout=30)
        assert created.status_code == 200, created.text

        listed = requests.get(f"{API}/raw-materials", headers=_h(emp_token), timeout=30).json()
        assert any(m["name"] == name for m in listed)

    def test_re_saisir_le_meme_nom_met_a_jour_l_unique_ligne_partagee(self):
        """Le piège explicite du chantier : sans un `scope()` partagé pour la
        recherche de doublon, deux collègues pourraient chacun garder leur
        propre « Farine T65 » à des prix différents sans jamais s'en
        apercevoir."""
        owner_token, _owner_uid, emp_token, _emp_uid, _org = _org_with_employee()
        name = f"Beurre partagé {uuid.uuid4().hex[:6]}"
        requests.post(f"{API}/raw-materials", json={
            "name": name, "purchase_price": 10, "purchase_quantity": 1, "purchase_unit": "kg",
        }, headers=_h(owner_token), timeout=30)

        before = requests.get(f"{API}/raw-materials", headers=_h(emp_token), timeout=30).json()
        count_before = len(before)

        updated = requests.post(f"{API}/raw-materials", json={
            "name": name.lower(), "purchase_price": 12, "purchase_quantity": 1, "purchase_unit": "kg",
        }, headers=_h(emp_token), timeout=30)
        assert updated.status_code == 200, updated.text
        assert abs(updated.json()["price_per_kg"] - 12.0) < 1e-9

        after = requests.get(f"{API}/raw-materials", headers=_h(owner_token), timeout=30).json()
        assert len(after) == count_before  # aucun doublon créé

    def test_un_employe_ne_peut_pas_supprimer_la_matiere_du_proprietaire(self):
        owner_token, _owner_uid, emp_token, _emp_uid, _org = _org_with_employee()
        created = requests.post(f"{API}/raw-materials", json={
            "name": f"Sucre {uuid.uuid4().hex[:6]}", "purchase_price": 2, "purchase_quantity": 1, "purchase_unit": "kg",
        }, headers=_h(owner_token), timeout=30).json()

        r = requests.delete(f"{API}/raw-materials/{created['id']}", headers=_h(emp_token), timeout=30)
        assert r.status_code == 403


class TestNonRegressionHorsOrganisation:
    """Un compte qui n'entre jamais dans une organisation garde exactement
    le comportement d'avant ce commit — la même propriété que
    `test_gating_api.py::TestJamaisDeVerrouSurUneLecture`, rejouée ici
    seulement pour production/planning/matière première."""

    def test_lectures_et_creation_restent_ouvertes(self, recipes):
        token, _ = _register()
        created = requests.post(f"{API}/productions", json=_production_payload(recipes, date="2026-10-12"),
                                headers=_h(token), timeout=30)
        assert created.status_code == 200, created.text
        assert requests.get(f"{API}/productions", headers=_h(token), timeout=30).status_code == 200
        assert requests.get(f"{API}/raw-materials", headers=_h(token), timeout=30).status_code == 200

    def test_le_createur_seul_reste_maitre_de_ses_propres_documents(self, recipes):
        token, _ = _register()
        created = requests.post(f"{API}/productions", json=_production_payload(recipes, date="2026-10-13"),
                                headers=_h(token), timeout=30).json()
        # Sans organisation, l'auteur reste seul juge — la suppression réussit.
        r = requests.delete(f"{API}/productions/{created['id']}", headers=_h(token), timeout=30)
        assert r.status_code == 200
