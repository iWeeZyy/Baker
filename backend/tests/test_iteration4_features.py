"""Iteration 4 backend tests:
- Threaded comments (parent_id)
- Recipe listings enriched with like_count + coup_de_coeur badge
"""
import os
import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
EMAIL = "test.baker@bakers.app"
PASSWORD = "TestBaker2026!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    if r.status_code != 200:
        # register if not exists
        rr = requests.post(f"{BASE}/api/auth/register", json={"email": EMAIL, "password": PASSWORD, "name": "Chef Test"}, timeout=30)
        assert rr.status_code == 200, rr.text
        return rr.json()["token"]
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def recipe_id():
    r = requests.get(f"{BASE}/api/recipes", timeout=30)
    assert r.status_code == 200
    recipes = r.json()
    assert len(recipes) > 0
    return recipes[0]["id"]


# ---------- Threaded comments ----------
class TestThreadedComments:
    def test_add_top_level_and_reply(self, auth_headers, recipe_id):
        # top-level
        top = requests.post(
            f"{BASE}/api/recipes/{recipe_id}/comments",
            json={"content": "TEST_iter4 top-level comment"},
            headers=auth_headers, timeout=30,
        )
        assert top.status_code == 200, top.text
        top_data = top.json()
        assert top_data["parent_id"] is None
        assert top_data["content"] == "TEST_iter4 top-level comment"
        top_id = top_data["id"]

        # reply
        reply = requests.post(
            f"{BASE}/api/recipes/{recipe_id}/comments",
            json={"content": "TEST_iter4 reply", "parent_id": top_id},
            headers=auth_headers, timeout=30,
        )
        assert reply.status_code == 200, reply.text
        assert reply.json()["parent_id"] == top_id

    def test_list_returns_parent_id_field(self, recipe_id):
        r = requests.get(f"{BASE}/api/recipes/{recipe_id}/comments", timeout=30)
        assert r.status_code == 200
        comments = r.json()
        assert len(comments) >= 2
        # ordering ascending
        times = [c["created_at"] for c in comments]
        assert times == sorted(times), "comments should be sorted ascending (oldest first)"
        # at least one top-level and one reply (treat missing parent_id as top-level for legacy docs)
        top_levels = [c for c in comments if c.get("parent_id") is None]
        replies = [c for c in comments if c.get("parent_id")]
        # New comments created via iteration4 API must include the field explicitly
        recent = [c for c in comments if c.get("content", "").startswith("TEST_iter4")]
        for c in recent:
            assert "parent_id" in c, f"iter4-created comment missing parent_id: {c}"
        assert top_levels, "expected at least one top-level"
        assert replies, "expected at least one reply"
        # reply.parent_id must reference an existing top-level id
        top_ids = {c["id"] for c in top_levels}
        assert any(r["parent_id"] in top_ids for r in replies)


# ---------- Like enrichment + coup_de_coeur ----------
class TestCoupDeCoeurEnrichment:
    def test_listing_has_like_count_and_coup_de_coeur(self):
        r = requests.get(f"{BASE}/api/recipes", timeout=30)
        assert r.status_code == 200
        recipes = r.json()
        for rec in recipes:
            assert "like_count" in rec, f"missing like_count in {rec.get('id')}"
            assert isinstance(rec["like_count"], int)
            assert "coup_de_coeur" in rec
            assert isinstance(rec["coup_de_coeur"], bool)

    def test_like_makes_recipe_coup_de_coeur(self, auth_headers, recipe_id):
        # Ensure the recipe has at least 1 like
        state = requests.get(f"{BASE}/api/recipes/{recipe_id}/likes", headers=auth_headers, timeout=30).json()
        if not state.get("liked"):
            r = requests.post(f"{BASE}/api/recipes/{recipe_id}/like", headers=auth_headers, timeout=30)
            assert r.status_code == 200
            assert r.json()["liked"] is True

        # global list should now show like_count >=1 and coup_de_coeur=true
        r = requests.get(f"{BASE}/api/recipes", timeout=30)
        recipes = r.json()
        target = next((x for x in recipes if x["id"] == recipe_id), None)
        assert target is not None
        assert target["like_count"] >= 1
        assert target["coup_de_coeur"] is True

    def test_single_recipe_has_enrichment(self, recipe_id):
        r = requests.get(f"{BASE}/api/recipes/{recipe_id}", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "like_count" in d and isinstance(d["like_count"], int)
        assert "coup_de_coeur" in d and isinstance(d["coup_de_coeur"], bool)
        assert d["like_count"] >= 1
        assert d["coup_de_coeur"] is True

    def test_mine_and_favorites_have_enrichment(self, auth_headers, recipe_id):
        # Add favorite to guarantee at least 1 favorite result
        state = requests.get(f"{BASE}/api/recipes/{recipe_id}/favorite", headers=auth_headers, timeout=30).json()
        if not state.get("favorited"):
            requests.post(f"{BASE}/api/recipes/{recipe_id}/favorite", headers=auth_headers, timeout=30)

        for path in ["/api/recipes/mine", "/api/recipes/favorites"]:
            r = requests.get(f"{BASE}{path}", headers=auth_headers, timeout=30)
            assert r.status_code == 200, f"{path} -> {r.status_code}"
            for rec in r.json():
                assert "like_count" in rec
                assert "coup_de_coeur" in rec
