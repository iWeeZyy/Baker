"""Iteration 3: Tests for likes, comments, notes, timer/calc backend features."""
import os
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://baker-recipes-1.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

TEST_EMAIL = "test.baker@bakers.app"
TEST_PASS = "TestBaker2026!"
TEST_NAME = "Chef Test"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASS}, timeout=30)
    if r.status_code == 200:
        return r.json()["token"]
    r = requests.post(f"{API}/auth/register", json={"email": TEST_EMAIL, "password": TEST_PASS, "name": TEST_NAME}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def recipe_id():
    r = requests.get(f"{API}/recipes", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert len(data) > 0
    return data[0]["id"]


def h(token):
    return {"Authorization": f"Bearer {token}"}


# ---- LIKES ----
class TestLikes:
    def test_get_likes_requires_auth(self, recipe_id):
        r = requests.get(f"{API}/recipes/{recipe_id}/likes", timeout=30)
        assert r.status_code == 401

    def test_get_likes_initial(self, token, recipe_id):
        r = requests.get(f"{API}/recipes/{recipe_id}/likes", headers=h(token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "count" in d and "liked" in d
        assert isinstance(d["count"], int)
        assert isinstance(d["liked"], bool)

    def test_toggle_like_on(self, token, recipe_id):
        # Ensure clean state: read then, if liked, toggle off first
        cur = requests.get(f"{API}/recipes/{recipe_id}/likes", headers=h(token), timeout=30).json()
        if cur["liked"]:
            requests.post(f"{API}/recipes/{recipe_id}/like", headers=h(token), timeout=30)
        before = requests.get(f"{API}/recipes/{recipe_id}/likes", headers=h(token), timeout=30).json()
        r = requests.post(f"{API}/recipes/{recipe_id}/like", headers=h(token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["liked"] is True
        assert d["count"] == before["count"] + 1
        # Verify via GET
        after = requests.get(f"{API}/recipes/{recipe_id}/likes", headers=h(token), timeout=30).json()
        assert after["liked"] is True
        assert after["count"] == d["count"]

    def test_toggle_like_off(self, token, recipe_id):
        # ensure on
        cur = requests.get(f"{API}/recipes/{recipe_id}/likes", headers=h(token), timeout=30).json()
        if not cur["liked"]:
            requests.post(f"{API}/recipes/{recipe_id}/like", headers=h(token), timeout=30)
        before = requests.get(f"{API}/recipes/{recipe_id}/likes", headers=h(token), timeout=30).json()
        r = requests.post(f"{API}/recipes/{recipe_id}/like", headers=h(token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["liked"] is False
        assert d["count"] == before["count"] - 1


# ---- COMMENTS ----
class TestComments:
    def test_get_comments_public(self, recipe_id):
        r = requests.get(f"{API}/recipes/{recipe_id}/comments", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_add_comment_requires_auth(self, recipe_id):
        r = requests.post(f"{API}/recipes/{recipe_id}/comments", json={"content": "hello"}, timeout=30)
        assert r.status_code == 401

    def test_add_comment(self, token, recipe_id):
        payload = {"content": "TEST_iter3 super recette ! Merci"}
        r = requests.post(f"{API}/recipes/{recipe_id}/comments", json=payload, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["content"] == payload["content"]
        assert c["user_name"] == TEST_NAME
        assert "id" in c
        # Verify via GET
        lst = requests.get(f"{API}/recipes/{recipe_id}/comments", timeout=30).json()
        ids = [x["id"] for x in lst]
        assert c["id"] in ids
        # user_name persisted
        found = next(x for x in lst if x["id"] == c["id"])
        assert found["user_name"] == TEST_NAME


# ---- NOTES ----
class TestNotes:
    def test_get_note_requires_auth(self, recipe_id):
        r = requests.get(f"{API}/recipes/{recipe_id}/note", timeout=30)
        assert r.status_code == 401

    def test_save_and_get_note(self, token, recipe_id):
        content = "TEST_iter3 Ma note personnelle: hydratation 72% ok"
        r = requests.put(f"{API}/recipes/{recipe_id}/note", json={"content": content}, headers=h(token), timeout=30)
        assert r.status_code == 200
        assert r.json()["content"] == content
        # persistence
        g = requests.get(f"{API}/recipes/{recipe_id}/note", headers=h(token), timeout=30)
        assert g.status_code == 200
        assert g.json()["content"] == content

    def test_note_upsert_overwrite(self, token, recipe_id):
        new_content = "TEST_iter3 Note updated v2"
        requests.put(f"{API}/recipes/{recipe_id}/note", json={"content": new_content}, headers=h(token), timeout=30)
        g = requests.get(f"{API}/recipes/{recipe_id}/note", headers=h(token), timeout=30).json()
        assert g["content"] == new_content

    def test_note_empty_for_new_recipe(self, token):
        # A recipe id that has no note
        r = requests.get(f"{API}/recipes/nonexistent-fake-id/note", headers=h(token), timeout=30)
        assert r.status_code == 200
        assert r.json()["content"] == ""
