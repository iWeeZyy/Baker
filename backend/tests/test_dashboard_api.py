"""Phase 7d : tableau de bord manager d'une organisation
(`GET /organisations/dashboard`).

Même patron de comptes que `test_organisations_api.py` : ce fichier a DEUX
classes, chacune avec sa propre adresse `PLAN_OVERRIDES` dédiée
(`test.org.dashboard.acces@bakers.app`, `test.org.dashboard.contenu@bakers.app`)
plutôt qu'un compte partagé entre elles — `pytest-xdist --dist loadscope`
peut répartir deux classes sur deux workers différents, et un compte
partagé verrait son `active_org_id` changer sous les pieds de l'une par
l'autre (créer une organisation exige le palier Équipe, donc sous
`ENTITLEMENTS_ENFORCED` un compte jetable ne suffit plus).

Les quatre sections (production, personnel, coûts, tâches) réutilisent
chacune un calcul déjà testé ailleurs (production.py, staff.py, costing.py,
l'attribution de tâches de la phase 7c) — ce fichier vérifie l'assemblage
HTTP (accès, période, agrégation across plusieurs documents), pas les
maths elles-mêmes (déjà couvertes en pur par test_dashboard_calc.py).
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"

_ACCES_OWNER_EMAIL = os.environ.get('TEST_ORG_DASHBOARD_ACCES_EMAIL', 'test.org.dashboard.acces@bakers.app')
_CONTENU_OWNER_EMAIL = os.environ.get('TEST_ORG_DASHBOARD_CONTENU_EMAIL', 'test.org.dashboard.contenu@bakers.app')
_OWNER_PASSWORD = 'TestOrgTeam2026!'


def _iso_date(days_offset=0):
    return (datetime.now(timezone.utc) + timedelta(days=days_offset)).strftime("%Y-%m-%d")


def _register(email=None, password=None, name="Chef"):
    email = email or f"orgdash.{uuid.uuid4().hex[:10]}@bakers.app"
    password = password or "TestOrgDash2026!"
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
    de l'interrupteur — même helper que `test_organisations_api.py`, un
    email dédié par classe appelante (voir en-tête du fichier)."""
    probe_token, probe_uid = _register()
    if not _plan(probe_token)["enforced"]:
        return probe_token, probe_uid
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": _OWNER_PASSWORD, "name": "Chef Tableau"}, timeout=30)
    if r.status_code == 400:
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": _OWNER_PASSWORD}, timeout=30)
        if r.status_code == 401:
            pytest.skip(f"{email} existe déjà avec un autre mot de passe (base non vierge)")
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


def _production_payload(recipes, date):
    return {"date": date, "target_time": "06:00", "notes": "Tableau de bord",
            "lines": [{"recipe_id": recipes[0]["id"], "quantity": 2, "mode": "batches"}]}


def _schedule_payload(week_start):
    return {"week_start": week_start, "employees": [
        {"name": "Nuit", "days": [{"start": "22:00", "end": "6:00", "off": False}] + [None] * 6},
    ]}


def _dashboard(token, period="week"):
    return requests.get(f"{API}/organisations/dashboard", params={"period": period},
                        headers=_h(token), timeout=30)


def _org_with_employee(owner_email):
    owner_token, owner_uid = _owner(owner_email)
    emp_token, emp_uid = _register()
    org = requests.post(f"{API}/organisations", json={"name": f"Tableau {uuid.uuid4().hex[:6]}"},
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


class TestAccesTableauDeBord:
    def test_hors_organisation_est_refuse(self):
        token, _uid = _register()
        r = _dashboard(token)
        assert r.status_code == 422

    def test_un_simple_employe_est_refuse(self):
        _owner_token, _owner_uid, emp_token, _emp_uid, _org = _org_with_employee(_ACCES_OWNER_EMAIL)
        r = _dashboard(emp_token)
        assert r.status_code == 403

    def test_le_proprietaire_y_a_acces(self):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_ACCES_OWNER_EMAIL)
        r = _dashboard(owner_token)
        assert r.status_code == 200

    def test_un_manager_y_a_acces(self):
        owner_token, _owner_uid, emp_token, emp_uid, _org = _org_with_employee(_ACCES_OWNER_EMAIL)
        promote = requests.put(f"{API}/organisations/members/{emp_uid}/role",
                               json={"role": "manager"}, headers=_h(owner_token), timeout=30)
        assert promote.status_code == 200, promote.text
        r = _dashboard(emp_token)
        assert r.status_code == 200

    def test_periode_invalide_est_refusee(self):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_ACCES_OWNER_EMAIL)
        r = _dashboard(owner_token, period="decade")
        assert r.status_code == 422


class TestContenuDuTableauDeBord:
    def test_les_quatre_sections_sont_remplies(self, recipes):
        owner_token, owner_uid, emp_token, emp_uid, _org = _org_with_employee(_CONTENU_OWNER_EMAIL)

        # Production.
        created = requests.post(f"{API}/productions", json=_production_payload(recipes, _iso_date(0)),
                                headers=_h(owner_token), timeout=30)
        assert created.status_code == 200, created.text
        prod_id = created.json()["id"]
        step_id = created.json()["steps"][0]["step_id"]

        # Tâche assignée à l'employé.
        assign = requests.patch(f"{API}/productions/{prod_id}/steps/{step_id}",
                                json={"assignee_user_id": emp_uid, "status": "done"},
                                headers=_h(owner_token), timeout=30)
        assert assign.status_code == 200, assign.text

        # Personnel.
        sched = requests.post(f"{API}/schedules", json=_schedule_payload("2026-10-04"),
                              headers=_h(owner_token), timeout=30)
        assert sched.status_code == 200, sched.text

        # Coûts et marges.
        requests.post(f"{API}/raw-materials", json={
            "name": f"Farine tableau {uuid.uuid4().hex[:6]}",
            "purchase_price": 20, "purchase_quantity": 25, "purchase_unit": "kg",
        }, headers=_h(owner_token), timeout=30)

        body = _dashboard(owner_token, period="all").json()

        assert body["period"] == "all"
        assert body["production"]["production_count"] >= 1
        assert isinstance(body["production"]["ingredients"]["items"], list)

        assert body["staff"]["schedule_count"] >= 1
        assert body["staff"]["worked_minutes"] > 0

        assert body["cost"]["calculation_count"] >= 0  # aucun calcul sauvegardé encore

        member_ids = {m["user_id"] for m in body["tasks"]["members"]}
        assert emp_uid in member_ids
        emp_row = next(m for m in body["tasks"]["members"] if m["user_id"] == emp_uid)
        assert emp_row["done"] >= 1
        # Le propriétaire, membre actif sans rien assigné, apparaît quand
        # même à zéro (voir summarize_tasks : "qui n'a encore rien reçu").
        assert owner_uid in member_ids

    def test_un_calcul_de_cout_enregistre_apparait_dans_la_section_couts(self):
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_CONTENU_OWNER_EMAIL)
        requests.post(f"{API}/raw-materials", json={
            "name": f"Beurre tableau {uuid.uuid4().hex[:6]}",
            "purchase_price": 75, "purchase_quantity": 10, "purchase_unit": "kg",
        }, headers=_h(owner_token), timeout=30)
        saved = requests.post(f"{API}/cost/history", json={
            "recipe_title": "Test tableau de bord",
            "ingredients": ["10 g de levure fraîche"],  # jamais dans raw-materials : total_cost reste None
            "pieces": 1,
            "sale_price_ht": 5.0,
        }, headers=_h(owner_token), timeout=30)
        assert saved.status_code == 200, saved.text

        body = _dashboard(owner_token, period="all").json()
        assert body["cost"]["calculation_count"] >= 1

    def test_une_production_hors_de_la_fenetre_n_est_pas_comptee(self, recipes):
        """Le cœur de la fenêtre glissante : une production d'il y a 40 jours
        n'apparaît jamais dans une période "week" (7 jours), mais compte
        bien dans "all"."""
        owner_token, _owner_uid, _emp_token, _emp_uid, _org = _org_with_employee(_CONTENU_OWNER_EMAIL)
        old = requests.post(f"{API}/productions", json=_production_payload(recipes, _iso_date(-40)),
                            headers=_h(owner_token), timeout=30)
        assert old.status_code == 200, old.text
        recent = requests.post(f"{API}/productions", json=_production_payload(recipes, _iso_date(0)),
                               headers=_h(owner_token), timeout=30)
        assert recent.status_code == 200, recent.text

        within_week = _dashboard(owner_token, period="week").json()
        everything = _dashboard(owner_token, period="all").json()

        assert everything["production"]["production_count"] >= 2
        assert within_week["production"]["production_count"] == 1

    def test_un_ancien_membre_avec_des_etapes_historiques_reste_visible(self, recipes):
        """Un employé retiré de l'organisation après avoir terminé des
        étapes ne doit pas faire disparaître ce travail du tableau de bord —
        voir CLAUDE.md, jamais de comptage silencieusement perdu."""
        owner_token, _owner_uid, emp_token, emp_uid, _org = _org_with_employee(_CONTENU_OWNER_EMAIL)
        created = requests.post(f"{API}/productions", json=_production_payload(recipes, _iso_date(0)),
                                headers=_h(owner_token), timeout=30)
        prod_id, step_id = created.json()["id"], created.json()["steps"][0]["step_id"]
        requests.patch(f"{API}/productions/{prod_id}/steps/{step_id}",
                       json={"assignee_user_id": emp_uid, "status": "done"},
                       headers=_h(owner_token), timeout=30)

        removed = requests.delete(f"{API}/organisations/members/{emp_uid}", headers=_h(owner_token), timeout=30)
        assert removed.status_code == 200, removed.text

        body = _dashboard(owner_token, period="all").json()
        member_ids = {m["user_id"] for m in body["tasks"]["members"]}
        assert emp_uid in member_ids
