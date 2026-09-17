"""Phase 7c : attribution d'une étape de production à un collègue
(`assignee_user_id`, `PATCH /productions/{id}/steps/{step_id}`).

Même patron de comptes que `test_org_sharing_api.py` (compte propriétaire
dédié `test.org.tasks@bakers.app` sous `ENTITLEMENTS_ENFORCED`, pour la même
raison : créer une organisation exige le palier Équipe, et
`pytest-xdist --dist loadscope` interdit de partager un compte porteur
d'`active_org_id` entre classes réparties sur des workers différents).
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"

_OWNER_EMAIL = os.environ.get('TEST_ORG_TASKS_EMAIL', 'test.org.tasks@bakers.app')
_OWNER_PASSWORD = 'TestOrgTeam2026!'


def _register(email=None, password=None, name="Chef"):
    email = email or f"orgtasks.{uuid.uuid4().hex[:10]}@bakers.app"
    password = password or "TestOrgTasks2026!"
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
    de l'interrupteur — même helper que `test_organisations_api.py`/
    `test_org_sharing_api.py`."""
    probe_token, probe_uid = _register()
    if not _plan(probe_token)["enforced"]:
        return probe_token, probe_uid
    r = requests.post(f"{API}/auth/register",
                      json={"email": _OWNER_EMAIL, "password": _OWNER_PASSWORD, "name": "Chef Tâches"}, timeout=30)
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


def _production_payload(recipes, date="2026-11-02"):
    return {"date": date, "target_time": "06:00", "notes": "Attribution",
            "lines": [{"recipe_id": recipes[0]["id"], "quantity": 2, "mode": "batches"}]}


def _org_with_employee():
    """Une organisation fraîche, avec un employé qui l'a rejointe — même
    helper que `test_org_sharing_api.py`."""
    owner_token, owner_uid = _owner()
    emp_token, emp_uid = _register()
    org = requests.post(f"{API}/organisations", json={"name": f"Tâches {uuid.uuid4().hex[:6]}"},
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


class TestAttributionDeTaches:
    def test_assigner_hors_organisation_est_refuse(self, recipes):
        """Un compte qui n'a jamais entendu parler d'une organisation ne
        peut pas assigner une étape — même à lui-même : `org_tasks` n'a de
        sens que partagé avec des collègues."""
        token, uid = _register()
        created = requests.post(f"{API}/productions", json=_production_payload(recipes),
                                headers=_h(token), timeout=30)
        assert created.status_code == 200, created.text
        step_id = created.json()["steps"][0]["step_id"]

        r = requests.patch(f"{API}/productions/{created.json()['id']}/steps/{step_id}",
                           json={"assignee_user_id": uid}, headers=_h(token), timeout=30)
        assert r.status_code == 422

    def test_assigner_un_collegue_reussit_et_persiste(self, recipes):
        owner_token, owner_uid, emp_token, emp_uid, _org = _org_with_employee()
        created = requests.post(f"{API}/productions", json=_production_payload(recipes, date="2026-11-03"),
                                headers=_h(owner_token), timeout=30)
        assert created.status_code == 200, created.text
        prod_id, step_id = created.json()["id"], created.json()["steps"][0]["step_id"]

        r = requests.patch(f"{API}/productions/{prod_id}/steps/{step_id}",
                           json={"assignee_user_id": emp_uid}, headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        step = next(s for s in r.json()["steps"] if s["step_id"] == step_id)
        assert step["assignee_user_id"] == emp_uid

        # Le collègue voit lui aussi l'attribution (document partagé).
        detail = requests.get(f"{API}/productions/{prod_id}", headers=_h(emp_token), timeout=30).json()
        assert next(s for s in detail["steps"] if s["step_id"] == step_id)["assignee_user_id"] == emp_uid

    def test_assigner_quelqu_un_hors_de_l_organisation_est_refuse(self, recipes):
        owner_token, owner_uid, _emp_token, _emp_uid, _org = _org_with_employee()
        created = requests.post(f"{API}/productions", json=_production_payload(recipes, date="2026-11-04"),
                                headers=_h(owner_token), timeout=30)
        prod_id, step_id = created.json()["id"], created.json()["steps"][0]["step_id"]
        outsider_token, outsider_uid = _register()

        r = requests.patch(f"{API}/productions/{prod_id}/steps/{step_id}",
                           json={"assignee_user_id": outsider_uid}, headers=_h(owner_token), timeout=30)
        assert r.status_code == 422

    def test_desassigner_ne_demande_aucun_droit(self, recipes):
        """Retirer une attribution ne verrouille jamais — même invariant que
        can_delete()/une suppression : un retrait ne coûte jamais de droit."""
        owner_token, owner_uid, emp_token, emp_uid, _org = _org_with_employee()
        created = requests.post(f"{API}/productions", json=_production_payload(recipes, date="2026-11-05"),
                                headers=_h(owner_token), timeout=30)
        prod_id, step_id = created.json()["id"], created.json()["steps"][0]["step_id"]
        requests.patch(f"{API}/productions/{prod_id}/steps/{step_id}",
                       json={"assignee_user_id": emp_uid}, headers=_h(owner_token), timeout=30)

        r = requests.patch(f"{API}/productions/{prod_id}/steps/{step_id}",
                           json={"assignee_user_id": ""}, headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        step = next(s for s in r.json()["steps"] if s["step_id"] == step_id)
        assert step["assignee_user_id"] is None

    def test_l_attribution_survit_a_une_modification_de_la_production(self, recipes):
        owner_token, owner_uid, emp_token, emp_uid, _org = _org_with_employee()
        payload = _production_payload(recipes, date="2026-11-06")
        created = requests.post(f"{API}/productions", json=payload, headers=_h(owner_token), timeout=30)
        prod_id, step_id = created.json()["id"], created.json()["steps"][0]["step_id"]
        requests.patch(f"{API}/productions/{prod_id}/steps/{step_id}",
                       json={"assignee_user_id": emp_uid}, headers=_h(owner_token), timeout=30)

        # Un PUT reconstruit les étapes depuis la recette : seule la note change ici.
        updated_payload = {**payload, "notes": "Attribution modifiée"}
        updated = requests.put(f"{API}/productions/{prod_id}", json=updated_payload,
                               headers=_h(owner_token), timeout=30)
        assert updated.status_code == 200, updated.text
        # Une seule recette dans cette production, donc l'étape d'ordre 0
        # est réapparue à la même place après reconstruction des étapes.
        step = next(s for s in updated.json()["steps"] if s["order"] == 0)
        assert step["assignee_user_id"] == emp_uid
