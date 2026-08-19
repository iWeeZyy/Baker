"""Tips API: listing, category filter, categories taxonomy, favorites.

The server must be running (see CLAUDE.md).
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
    email = f"tipsapi.{uuid.uuid4().hex[:10]}@bakers.app"
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": "TestTips2026!", "name": "Astucieux"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="class")
def token():
    return register()


class TestTipsList:
    def test_list_all(self):
        r = requests.get(f"{API}/tips", timeout=30)
        assert r.status_code == 200
        docs = r.json()
        assert len(docs) >= 60

    def test_every_tip_has_the_library_fields(self):
        docs = requests.get(f"{API}/tips", timeout=30).json()
        for t in docs:
            assert t["id"] and t["title"] and t["category"] and t["content"]
            assert isinstance(t["keywords"], list)
            assert t["source"]

    def test_filter_by_category(self):
        docs = requests.get(f"{API}/tips", params={"category": "Viennoiserie"}, timeout=30).json()
        assert len(docs) > 0
        assert all(t["category"] == "Viennoiserie" for t in docs)

    def test_category_toutes_is_the_no_filter_sentinel(self):
        # The tips chip says "Toutes" (feminine, "astuces"), unlike the
        # recipes chip's "Tous" — both must bypass filtering rather than
        # match a category that doesn't exist and return nothing.
        all_docs = requests.get(f"{API}/tips", timeout=30).json()
        via_toutes = requests.get(f"{API}/tips", params={"category": "Toutes"}, timeout=30).json()
        assert len(via_toutes) == len(all_docs)

    def test_problem_solving_tips_carry_the_structured_fields(self):
        docs = requests.get(f"{API}/tips", params={"category": "Problèmes & solutions"}, timeout=30).json()
        assert len(docs) > 0
        for t in docs:
            assert t.get("problem")
            assert isinstance(t.get("solutions"), list) and t["solutions"]


class TestCategoriesTaxonomy:
    def test_categories_endpoint_exposes_the_full_tips_taxonomy(self):
        cats = requests.get(f"{API}/categories", timeout=30).json()["tips"]
        assert cats[0] == "Toutes"
        for expected in [
            "Pétrissage", "Farines", "Hydratation", "Température", "Fermentation",
            "Façonnage", "Cuisson", "Viennoiserie", "Conservation",
            "Problèmes & solutions", "Général",
        ]:
            assert expected in cats

    def test_every_tip_category_is_declared_in_the_taxonomy(self):
        cats = set(requests.get(f"{API}/categories", timeout=30).json()["tips"])
        docs = requests.get(f"{API}/tips", timeout=30).json()
        for t in docs:
            assert t["category"] in cats


class TestTipFavorites:
    def test_toggle_favorite(self, token):
        h = auth_headers(token)
        tip_id = requests.get(f"{API}/tips", timeout=30).json()[0]["id"]

        r1 = requests.post(f"{API}/tips/{tip_id}/favorite", headers=h, timeout=30)
        assert r1.status_code == 200 and r1.json()["favorited"] is True

        ids = requests.get(f"{API}/tips/favorite-ids", headers=h, timeout=30).json()
        assert tip_id in ids

        favs = requests.get(f"{API}/tips/favorites", headers=h, timeout=30).json()
        assert any(t["id"] == tip_id for t in favs)

        r2 = requests.post(f"{API}/tips/{tip_id}/favorite", headers=h, timeout=30)
        assert r2.status_code == 200 and r2.json()["favorited"] is False

        ids_after = requests.get(f"{API}/tips/favorite-ids", headers=h, timeout=30).json()
        assert tip_id not in ids_after

    def test_favorites_are_isolated_per_user(self, token):
        h = auth_headers(token)
        other = auth_headers(register())
        tip_id = requests.get(f"{API}/tips", timeout=30).json()[1]["id"]
        requests.post(f"{API}/tips/{tip_id}/favorite", headers=h, timeout=30)

        mine = requests.get(f"{API}/tips/favorite-ids", headers=h, timeout=30).json()
        theirs = requests.get(f"{API}/tips/favorite-ids", headers=other, timeout=30).json()
        assert tip_id in mine
        assert tip_id not in theirs

    def test_favorites_require_auth(self):
        tip_id = requests.get(f"{API}/tips", timeout=30).json()[0]["id"]
        r = requests.post(f"{API}/tips/{tip_id}/favorite", timeout=30)
        assert r.status_code in (401, 403)
