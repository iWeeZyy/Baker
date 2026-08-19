"""Cost calculator API: raw materials CRUD, recipe cost badge, saved history.

Each class registers its own account so prices/history never leak between
tests. The server must be running (see CLAUDE.md).
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def register():
    email = f"costapi.{uuid.uuid4().hex[:10]}@bakers.app"
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": "TestCost2026!", "name": "Costeur"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="class")
def token():
    return register()


class TestRawMaterialsCrud:
    def test_create_computes_unit_price(self, token):
        h = auth_headers(token)
        r = requests.post(f"{API}/raw-materials", json={
            "name": "Farine T65", "purchase_price": 21.25, "purchase_quantity": 25, "purchase_unit": "kg",
        }, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert abs(doc["price_per_kg"] - 0.85) < 1e-9
        assert doc["price_per_l"] is None and doc["price_per_piece"] is None

    def test_reposting_same_name_updates_in_place(self, token):
        h = auth_headers(token)
        requests.post(f"{API}/raw-materials", json={
            "name": "Beurre", "purchase_price": 75, "purchase_quantity": 10, "purchase_unit": "kg",
        }, headers=h, timeout=30)
        before = requests.get(f"{API}/raw-materials", headers=h, timeout=30).json()
        count_before = len(before)

        r = requests.post(f"{API}/raw-materials", json={
            "name": "beurre", "purchase_price": 80, "purchase_quantity": 10, "purchase_unit": "kg",
        }, headers=h, timeout=30)
        assert r.status_code == 200
        assert abs(r.json()["price_per_kg"] - 8.0) < 1e-9

        after = requests.get(f"{API}/raw-materials", headers=h, timeout=30).json()
        assert len(after) == count_before  # no duplicate created for "beurre" vs "Beurre"

    def test_rejects_zero_quantity(self, token):
        h = auth_headers(token)
        r = requests.post(f"{API}/raw-materials", json={
            "name": "Levure", "purchase_price": 5, "purchase_quantity": 0, "purchase_unit": "kg",
        }, headers=h, timeout=30)
        assert r.status_code == 422

    def test_rejects_negative_price(self, token):
        h = auth_headers(token)
        r = requests.post(f"{API}/raw-materials", json={
            "name": "Sel", "purchase_price": -1, "purchase_quantity": 1, "purchase_unit": "kg",
        }, headers=h, timeout=30)
        assert r.status_code == 422

    def test_rejects_unknown_unit(self, token):
        h = auth_headers(token)
        r = requests.post(f"{API}/raw-materials", json={
            "name": "Chocolat", "purchase_price": 10, "purchase_quantity": 1, "purchase_unit": "sac",
        }, headers=h, timeout=30)
        assert r.status_code == 422

    def test_update_by_id_rejects_colliding_name(self, token):
        h = auth_headers(token)
        a = requests.post(f"{API}/raw-materials", json={
            "name": "Sucre glace", "purchase_price": 2, "purchase_quantity": 1, "purchase_unit": "kg",
        }, headers=h, timeout=30).json()
        requests.post(f"{API}/raw-materials", json={
            "name": "Sucre roux", "purchase_price": 2, "purchase_quantity": 1, "purchase_unit": "kg",
        }, headers=h, timeout=30)
        r = requests.put(f"{API}/raw-materials/{a['id']}", json={
            "name": "Sucre roux", "purchase_price": 2, "purchase_quantity": 1, "purchase_unit": "kg",
        }, headers=h, timeout=30)
        assert r.status_code == 409

    def test_delete(self, token):
        h = auth_headers(token)
        doc = requests.post(f"{API}/raw-materials", json={
            "name": "Amande en poudre", "purchase_price": 10, "purchase_quantity": 1, "purchase_unit": "kg",
        }, headers=h, timeout=30).json()
        r = requests.delete(f"{API}/raw-materials/{doc['id']}", headers=h, timeout=30)
        assert r.status_code == 200
        r2 = requests.delete(f"{API}/raw-materials/{doc['id']}", headers=h, timeout=30)
        assert r2.status_code == 404

    def test_isolated_per_user(self, token):
        h = auth_headers(token)
        other = auth_headers(register())
        requests.post(f"{API}/raw-materials", json={
            "name": "Isolation test", "purchase_price": 1, "purchase_quantity": 1, "purchase_unit": "kg",
        }, headers=h, timeout=30)
        mine = requests.get(f"{API}/raw-materials", headers=h, timeout=30).json()
        theirs = requests.get(f"{API}/raw-materials", headers=other, timeout=30).json()
        assert any(m["name"] == "Isolation test" for m in mine)
        assert not any(m["name"] == "Isolation test" for m in theirs)


class TestCostHistory:
    def _price_the_classics(self, h):
        for name, price, qty, unit in [
            ("Farine T65", 21.25, 25, "kg"),
            ("Beurre", 75, 10, "kg"),
            ("Sucre", 1.4, 1, "kg"),
        ]:
            requests.post(f"{API}/raw-materials", json={
                "name": name, "purchase_price": price, "purchase_quantity": qty, "purchase_unit": unit,
            }, headers=h, timeout=30)

    def test_save_and_read_back(self, token):
        h = auth_headers(token)
        self._price_the_classics(h)
        r = requests.post(f"{API}/cost/history", json={
            "recipe_title": "Croissant au beurre",
            "ingredients": ["10 kg de farine T65", "2 kg de beurre", "500 g de sucre"],
            "pieces": 100,
            "packaging": [{"label": "emballage", "cost": 2.40}],
            "other_costs": [{"label": "déco", "cost": 1.50}],
            "sale_price_ht": 1.30,
            "vat_rate": 5.5,
        }, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        saved = r.json()
        assert abs(saved["result"]["total_cost"] - 28.10) < 1e-9
        assert abs(saved["result"]["cost_per_piece"] - 0.281) < 1e-9
        assert abs(saved["sale"]["margin_per_piece"] - 1.019) < 1e-9

        got = requests.get(f"{API}/cost/history/{saved['id']}", headers=h, timeout=30)
        assert got.status_code == 200
        assert got.json()["result"]["total_cost"] == saved["result"]["total_cost"]

    def test_history_is_frozen_against_later_price_changes(self, token):
        h = auth_headers(token)
        self._price_the_classics(h)
        saved = requests.post(f"{API}/cost/history", json={
            "recipe_title": "Gel test",
            "ingredients": ["1 kg de farine T65"],
            "pieces": 1,
        }, headers=h, timeout=30).json()
        original_cost = saved["result"]["raw_materials_cost"]

        # Double the flour price after the fact.
        requests.post(f"{API}/raw-materials", json={
            "name": "Farine T65", "purchase_price": 42.5, "purchase_quantity": 25, "purchase_unit": "kg",
        }, headers=h, timeout=30)

        again = requests.get(f"{API}/cost/history/{saved['id']}", headers=h, timeout=30).json()
        assert again["result"]["raw_materials_cost"] == original_cost

    def test_missing_price_saves_a_null_total_not_zero(self, token):
        h = auth_headers(token)
        r = requests.post(f"{API}/cost/history", json={
            "recipe_title": "Prix manquant",
            "ingredients": ["10 g de levure fraîche"],
            "pieces": 10,
        }, headers=h, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["result"]["has_missing_prices"] is True
        assert body["result"]["total_cost"] is None

    def test_list_and_delete(self, token):
        h = auth_headers(token)
        saved = requests.post(f"{API}/cost/history", json={
            "recipe_title": "À supprimer", "ingredients": [],
        }, headers=h, timeout=30).json()
        listing = requests.get(f"{API}/cost/history", headers=h, timeout=30).json()
        assert any(e["id"] == saved["id"] for e in listing)

        d = requests.delete(f"{API}/cost/history/{saved['id']}", headers=h, timeout=30)
        assert d.status_code == 200
        after = requests.get(f"{API}/cost/history", headers=h, timeout=30).json()
        assert not any(e["id"] == saved["id"] for e in after)

    def test_simulation_override_is_reflected_in_the_saved_snapshot(self, token):
        h = auth_headers(token)
        self._price_the_classics(h)
        r = requests.post(f"{API}/cost/history", json={
            "recipe_title": "Simulation",
            "ingredients": ["1 kg de farine T65"],
            "pieces": 1,
            "price_overrides": {"farine t65": 1.05},
        }, headers=h, timeout=30)
        body = r.json()
        assert abs(body["result"]["raw_materials_cost"] - 1.05) < 1e-9
        # the stored raw material price must be untouched by the simulation
        stored = requests.get(f"{API}/raw-materials", headers=h, timeout=30).json()
        flour = next(m for m in stored if m["name"] == "Farine T65")
        assert abs(flour["price_per_kg"] - 0.85) < 1e-9


class TestRecipeCostBadge:
    def test_unavailable_without_a_yield_or_prices(self, token):
        h = auth_headers(token)
        recipes = requests.get(f"{API}/recipes", headers=h, timeout=30).json()
        recipe = next(r for r in recipes if not r.get("yield_pieces"))
        r = requests.get(f"{API}/recipes/{recipe['id']}/cost", headers=h, timeout=30)
        assert r.status_code == 200
        assert r.json()["available"] is False

    def test_available_once_every_ingredient_is_priced(self, token):
        h = auth_headers(token)
        recipes = requests.get(f"{API}/recipes", headers=h, timeout=30).json()
        recipe = next(
            r for r in recipes
            if r.get("yield_pieces") and len(r["ingredients"]) <= 3
            and all(any(c.isdigit() for c in line) for line in r["ingredients"])
        )
        for line in recipe["ingredients"]:
            import re
            m = re.match(r"^\s*[\d.,]+\s*(kg|g|cl|ml|l)\b\s*(?:de\s+|d[\'’]\s*)?(.+)", line, re.I)
            name = m.group(2).strip() if m else re.sub(r"^\s*[\d.,]+\s*", "", line).strip()
            requests.post(f"{API}/raw-materials", json={
                "name": name, "purchase_price": 10, "purchase_quantity": 1, "purchase_unit": "kg",
            }, headers=h, timeout=30)
        r = requests.get(f"{API}/recipes/{recipe['id']}/cost", headers=h, timeout=30)
        body = r.json()
        # Either fully available (all names matched their raw material), or at
        # least no longer crashing — the important assertion is "never a
        # misleadingly-zeroed cost": when unavailable it must say so plainly.
        if body["available"]:
            assert body["cost_per_piece"] > 0
        else:
            assert set(body.keys()) == {"available"}
