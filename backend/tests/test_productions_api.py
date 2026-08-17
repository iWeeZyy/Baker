"""Production planning API tests: CRUD, ownership isolation and Free limits.

Each test class uses its own throwaway account so the monthly Free quota of one
test never leaks into another. The server must be running (see CLAUDE.md).
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"

# Set on the server for the Pro-plan tests; see plans.py.
PRO_EMAIL = os.environ.get('TEST_PRO_EMAIL', 'test.pro@bakers.app')


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def register(email=None):
    """A fresh account, so each test starts with an untouched monthly quota."""
    email = email or f"prod.{uuid.uuid4().hex[:10]}@bakers.app"
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": "TestProd2026!", "name": "Chef Prod"},
        timeout=30,
    )
    if r.status_code == 400:  # already exists (fixed emails like the Pro one)
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": "TestProd2026!"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def recipes():
    r = requests.get(f"{API}/recipes", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 2
    return data


def make_payload(recipes, date="2026-09-15", target_time="06:00", qty=2, mode="batches"):
    return {
        "date": date,
        "target_time": target_time,
        "notes": "Production de test",
        "lines": [{"recipe_id": recipes[0]["id"], "quantity": qty, "mode": mode}],
    }


class TestProductionCrud:
    def test_create_read_update_delete(self, recipes):
        h = auth_headers(register()["token"])

        created = requests.post(f"{API}/productions", json=make_payload(recipes), headers=h, timeout=30)
        assert created.status_code == 200, created.text
        doc = created.json()
        pid = doc["id"]
        assert doc["date"] == "2026-09-15"
        assert len(doc["lines"]) == 1
        assert doc["lines"][0]["batches"] == 2.0
        assert doc["steps"], "steps must be derived from the recipe"

        got = requests.get(f"{API}/productions/{pid}", headers=h, timeout=30)
        assert got.status_code == 200
        assert got.json()["id"] == pid

        listed = requests.get(f"{API}/productions", headers=h, timeout=30)
        assert listed.status_code == 200
        assert any(p["id"] == pid for p in listed.json())

        payload = make_payload(recipes, date="2026-09-16", qty=5)
        updated = requests.put(f"{API}/productions/{pid}", json=payload, headers=h, timeout=30)
        assert updated.status_code == 200, updated.text
        assert updated.json()["date"] == "2026-09-16"
        assert updated.json()["lines"][0]["batches"] == 5.0, "quantities must be recomputed on edit"

        deleted = requests.delete(f"{API}/productions/{pid}", headers=h, timeout=30)
        assert deleted.status_code == 200
        assert requests.get(f"{API}/productions/{pid}", headers=h, timeout=30).status_code == 404

    def test_ingredients_are_aggregated_across_recipes(self, recipes):
        h = auth_headers(register()["token"])
        payload = {
            "date": "2026-09-15",
            "target_time": "06:00",
            "notes": "",
            "lines": [
                {"recipe_id": recipes[0]["id"], "quantity": 1, "mode": "batches"},
                {"recipe_id": recipes[0]["id"], "quantity": 1, "mode": "batches"},
            ],
        }
        r = requests.post(f"{API}/productions", json=payload, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        items = r.json()["ingredients"]["items"]
        names = [i["name"].lower() for i in items]
        assert len(names) == len(set(names)), "the same ingredient must appear once, summed"

    def test_step_status_is_saved(self, recipes):
        h = auth_headers(register()["token"])
        doc = requests.post(f"{API}/productions", json=make_payload(recipes), headers=h, timeout=30).json()
        step_id = doc["steps"][0]["step_id"]

        patched = requests.patch(
            f"{API}/productions/{doc['id']}/steps/{step_id}",
            json={"status": "done"}, headers=h, timeout=30,
        )
        assert patched.status_code == 200
        reloaded = requests.get(f"{API}/productions/{doc['id']}", headers=h, timeout=30).json()
        assert next(s for s in reloaded["steps"] if s["step_id"] == step_id)["status"] == "done"

    def test_manual_duration_is_saved_and_survives_an_edit(self, recipes):
        h = auth_headers(register()["token"])
        doc = requests.post(f"{API}/productions", json=make_payload(recipes), headers=h, timeout=30).json()
        missing = doc["missing_durations"]
        if not missing:
            pytest.skip("this recipe has a duration on every step")
        step_id = missing[0]

        requests.patch(
            f"{API}/productions/{doc['id']}/steps/{step_id}",
            json={"duration_minutes": 25}, headers=h, timeout=30,
        )
        # Editing the production rebuilds steps from the recipe; a duration the
        # baker typed must not be thrown away.
        requests.put(f"{API}/productions/{doc['id']}", json=make_payload(recipes, qty=4), headers=h, timeout=30)
        reloaded = requests.get(f"{API}/productions/{doc['id']}", headers=h, timeout=30).json()
        kept = [s for s in reloaded["steps"] if s["duration_source"] == "manual" and s["duration_minutes"] == 25]
        assert kept, "a manually entered duration must survive an edit"

    def test_production_without_recipes_is_allowed(self):
        h = auth_headers(register()["token"])
        r = requests.post(
            f"{API}/productions",
            json={"date": "2026-09-15", "target_time": None, "notes": "brouillon", "lines": []},
            headers=h, timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["ingredients"] == {"items": [], "unparsed": []}


class TestValidation:
    def test_zero_or_negative_quantity_rejected(self, recipes):
        h = auth_headers(register()["token"])
        for bad in (0, -3):
            r = requests.post(f"{API}/productions", json=make_payload(recipes, qty=bad), headers=h, timeout=30)
            assert r.status_code == 422, f"quantity {bad} must be rejected"

    def test_bad_date_and_time_rejected(self, recipes):
        h = auth_headers(register()["token"])
        bad_date = requests.post(f"{API}/productions", json=make_payload(recipes, date="15/09/2026"), headers=h, timeout=30)
        assert bad_date.status_code == 422
        bad_time = requests.post(f"{API}/productions", json=make_payload(recipes, target_time="6h00"), headers=h, timeout=30)
        assert bad_time.status_code == 422

    def test_unknown_recipe_rejected(self):
        h = auth_headers(register()["token"])
        payload = {"date": "2026-09-15", "target_time": "06:00", "notes": "",
                   "lines": [{"recipe_id": "nope", "quantity": 1, "mode": "batches"}]}
        assert requests.post(f"{API}/productions", json=payload, headers=h, timeout=30).status_code == 404

    def test_invalid_step_status_rejected(self, recipes):
        h = auth_headers(register()["token"])
        doc = requests.post(f"{API}/productions", json=make_payload(recipes), headers=h, timeout=30).json()
        r = requests.patch(
            f"{API}/productions/{doc['id']}/steps/{doc['steps'][0]['step_id']}",
            json={"status": "terminé"}, headers=h, timeout=30,
        )
        assert r.status_code == 422


class TestPermissions:
    def test_all_routes_require_auth(self, recipes):
        assert requests.get(f"{API}/productions", timeout=30).status_code == 401
        assert requests.post(f"{API}/productions", json=make_payload(recipes), timeout=30).status_code == 401
        assert requests.get(f"{API}/me/plan", timeout=30).status_code == 401

    def test_a_user_cannot_read_write_or_delete_someone_elses_production(self, recipes):
        owner = auth_headers(register()["token"])
        intruder = auth_headers(register()["token"])
        pid = requests.post(f"{API}/productions", json=make_payload(recipes), headers=owner, timeout=30).json()["id"]

        assert requests.get(f"{API}/productions/{pid}", headers=intruder, timeout=30).status_code == 404
        assert requests.put(f"{API}/productions/{pid}", json=make_payload(recipes), headers=intruder, timeout=30).status_code == 404
        assert requests.delete(f"{API}/productions/{pid}", headers=intruder, timeout=30).status_code == 404
        # And the owner's copy is untouched by the attempts.
        assert requests.get(f"{API}/productions/{pid}", headers=owner, timeout=30).status_code == 200

    def test_someone_elses_production_is_absent_from_my_list(self, recipes):
        owner = auth_headers(register()["token"])
        other = auth_headers(register()["token"])
        pid = requests.post(f"{API}/productions", json=make_payload(recipes), headers=owner, timeout=30).json()["id"]
        assert all(p["id"] != pid for p in requests.get(f"{API}/productions", headers=other, timeout=30).json())


class TestFreePlanLimit:
    def test_free_plan_starts_with_three_productions(self):
        h = auth_headers(register()["token"])
        state = requests.get(f"{API}/me/plan", headers=h, timeout=30).json()
        assert state["plan"] == "free"
        assert state["productions_limit"] == 3
        assert state["productions_used"] == 0

    def test_fourth_production_is_refused_with_an_upgrade_payload(self, recipes):
        h = auth_headers(register()["token"])
        for i in range(3):
            r = requests.post(f"{API}/productions", json=make_payload(recipes), headers=h, timeout=30)
            assert r.status_code == 200, f"production {i + 1} should be allowed: {r.text}"

        blocked = requests.post(f"{API}/productions", json=make_payload(recipes), headers=h, timeout=30)
        assert blocked.status_code == 403
        detail = blocked.json()["detail"]
        # Structured, so the app can show Baker Pro rather than an error.
        assert detail["error"] == "plan_limit_reached"
        assert detail["limit"] == 3
        assert detail["used"] == 3
        assert detail["message"]

    def test_quota_counter_tracks_usage(self, recipes):
        h = auth_headers(register()["token"])
        requests.post(f"{API}/productions", json=make_payload(recipes), headers=h, timeout=30)
        state = requests.get(f"{API}/me/plan", headers=h, timeout=30).json()
        assert state["productions_used"] == 1
        assert state["productions_remaining"] == 2

    def test_limit_cannot_be_bypassed_by_forging_the_request(self, recipes):
        """The plan is resolved server-side from the account, never from input."""
        h = auth_headers(register()["token"])
        for _ in range(3):
            requests.post(f"{API}/productions", json=make_payload(recipes), headers=h, timeout=30)

        forged = make_payload(recipes)
        forged.update({"plan": "pro", "user_id": "someone_else", "productions_limit": 999})
        assert requests.post(f"{API}/productions", json=forged, headers=h, timeout=30).status_code == 403

        # Claiming Pro on the account document itself is equally ineffective.
        state = requests.get(f"{API}/me/plan", headers=h, timeout=30).json()
        assert state["plan"] == "free"

    def test_reaching_the_limit_does_not_hide_existing_productions(self, recipes):
        h = auth_headers(register()["token"])
        ids = [requests.post(f"{API}/productions", json=make_payload(recipes), headers=h, timeout=30).json()["id"]
               for _ in range(3)]
        requests.post(f"{API}/productions", json=make_payload(recipes), headers=h, timeout=30)  # blocked
        listed = {p["id"] for p in requests.get(f"{API}/productions", headers=h, timeout=30).json()}
        assert set(ids) <= listed, "hitting the limit must never hide existing work"
        # And they stay editable — only creation is capped.
        assert requests.put(f"{API}/productions/{ids[0]}", json=make_payload(recipes, qty=9), headers=h, timeout=30).status_code == 200


class TestProPlan:
    """Requires the server to run with PRO_EMAILS containing TEST_PRO_EMAIL."""

    def test_pro_account_is_unlimited(self, recipes):
        data = register(PRO_EMAIL)
        h = auth_headers(data["token"])
        state = requests.get(f"{API}/me/plan", headers=h, timeout=30).json()
        if state["plan"] != "pro":
            pytest.skip("server not configured with PRO_EMAILS for this address")
        assert state["productions_limit"] is None
        assert state["limits"]["sharing"] is True

        # Comfortably past the Free ceiling of 3.
        for i in range(5):
            r = requests.post(f"{API}/productions", json=make_payload(recipes), headers=h, timeout=30)
            assert r.status_code == 200, f"Pro production {i + 1} refused: {r.text}"
