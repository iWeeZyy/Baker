"""Iteration 3: Tests for likes, comments, notes, timer/calc backend features."""
import os
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"

TEST_EMAIL = "test.baker@bakers.app"
TEST_PASS = "TestBaker2026!"
TEST_NAME = "Chef Test"

TEST_EMAIL_B = "test.baker.b@bakers.app"
TEST_PASS_B = "TestBakerB2026!"
TEST_NAME_B = "Chef Test B"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASS}, timeout=30)
    if r.status_code == 200:
        return r.json()["token"]
    r = requests.post(f"{API}/auth/register", json={"email": TEST_EMAIL, "password": TEST_PASS, "name": TEST_NAME}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def token_b():
    # Deuxième compte, dédié aux tests de likes multi-utilisateurs (le
    # compteur doit refléter plusieurs utilisateurs, et le like de l'un ne
    # doit jamais affecter celui de l'autre).
    r = requests.post(f"{API}/auth/login", json={"email": TEST_EMAIL_B, "password": TEST_PASS_B}, timeout=30)
    if r.status_code == 200:
        return r.json()["token"]
    r = requests.post(f"{API}/auth/register", json={"email": TEST_EMAIL_B, "password": TEST_PASS_B, "name": TEST_NAME_B}, timeout=30)
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

    def test_post_like_requires_auth(self, recipe_id):
        r = requests.post(f"{API}/recipes/{recipe_id}/like", timeout=30)
        assert r.status_code == 401

    def test_state_persists_across_a_fresh_fetch(self, token, recipe_id):
        # Simule une fermeture/réouverture de l'app : l'état vient
        # uniquement de la base, pas d'un état en mémoire côté serveur.
        _ensure_liked(token, recipe_id, True)
        after = requests.get(f"{API}/recipes/{recipe_id}/likes", headers=h(token), timeout=30).json()
        assert after["liked"] is True
        again = requests.get(f"{API}/recipes/{recipe_id}/likes", headers=h(token), timeout=30).json()
        assert again == after

    def test_two_users_liking_same_recipe_are_both_counted(self, token, token_b, recipe_id):
        _ensure_liked(token, recipe_id, False)
        _ensure_liked(token_b, recipe_id, False)
        base = requests.get(f"{API}/recipes/{recipe_id}/likes", headers=h(token), timeout=30).json()["count"]

        r_a = requests.post(f"{API}/recipes/{recipe_id}/like", headers=h(token), timeout=30).json()
        assert r_a["liked"] is True
        assert r_a["count"] == base + 1

        r_b = requests.post(f"{API}/recipes/{recipe_id}/like", headers=h(token_b), timeout=30).json()
        assert r_b["liked"] is True
        assert r_b["count"] == base + 2

        # Chacun voit son propre état, indépendamment de l'autre.
        seen_by_a = requests.get(f"{API}/recipes/{recipe_id}/likes", headers=h(token), timeout=30).json()
        seen_by_b = requests.get(f"{API}/recipes/{recipe_id}/likes", headers=h(token_b), timeout=30).json()
        assert seen_by_a["liked"] is True and seen_by_a["count"] == base + 2
        assert seen_by_b["liked"] is True and seen_by_b["count"] == base + 2

    def test_one_users_like_is_unaffected_by_another_users_toggle(self, token, token_b, recipe_id):
        # Aucune route ne prend un user_id en paramètre pour cette action :
        # le toggle agit toujours sur l'utilisateur du JWT. On vérifie ici
        # qu'un utilisateur ne peut pas, même involontairement, changer
        # l'état de like d'un autre.
        _ensure_liked(token, recipe_id, True)
        _ensure_liked(token_b, recipe_id, True)

        requests.post(f"{API}/recipes/{recipe_id}/like", headers=h(token_b), timeout=30)  # B se retire

        state_a = requests.get(f"{API}/recipes/{recipe_id}/likes", headers=h(token), timeout=30).json()
        assert state_a["liked"] is True  # le like de A est intact

        state_b = requests.get(f"{API}/recipes/{recipe_id}/likes", headers=h(token_b), timeout=30).json()
        assert state_b["liked"] is False


def _ensure_liked(token, recipe_id, want_liked):
    cur = requests.get(f"{API}/recipes/{recipe_id}/likes", headers=h(token), timeout=30).json()
    if cur["liked"] != want_liked:
        requests.post(f"{API}/recipes/{recipe_id}/like", headers=h(token), timeout=30)


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

    def test_comment_carries_a_like_count_publicly(self, token, recipe_id):
        c = requests.post(f"{API}/recipes/{recipe_id}/comments", json={"content": "TEST_iter3 like_count"}, headers=h(token), timeout=30).json()
        lst = requests.get(f"{API}/recipes/{recipe_id}/comments", timeout=30).json()
        found = next(x for x in lst if x["id"] == c["id"])
        assert found["like_count"] == 0


# ---- COMMENT LIKES ----
class TestCommentLikes:
    def test_like_requires_auth(self, token, recipe_id):
        c = requests.post(f"{API}/recipes/{recipe_id}/comments", json={"content": "TEST_iter3 cl auth"}, headers=h(token), timeout=30).json()
        r = requests.post(f"{API}/comments/{c['id']}/like", timeout=30)
        assert r.status_code == 401

    def test_like_unknown_comment_404s(self, token):
        r = requests.post(f"{API}/comments/does-not-exist/like", headers=h(token), timeout=30)
        assert r.status_code == 404

    def test_toggle_updates_public_count(self, token, recipe_id):
        c = requests.post(f"{API}/recipes/{recipe_id}/comments", json={"content": "TEST_iter3 cl toggle"}, headers=h(token), timeout=30).json()
        r = requests.post(f"{API}/comments/{c['id']}/like", headers=h(token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["liked"] is True and d["count"] == 1
        lst = requests.get(f"{API}/recipes/{recipe_id}/comments", timeout=30).json()
        assert next(x for x in lst if x["id"] == c["id"])["like_count"] == 1

        r2 = requests.post(f"{API}/comments/{c['id']}/like", headers=h(token), timeout=30).json()
        assert r2["liked"] is False and r2["count"] == 0

    def test_two_users_liking_the_same_comment_are_both_counted(self, token, token_b, recipe_id):
        c = requests.post(f"{API}/recipes/{recipe_id}/comments", json={"content": "TEST_iter3 cl two users"}, headers=h(token), timeout=30).json()
        requests.post(f"{API}/comments/{c['id']}/like", headers=h(token), timeout=30)
        r_b = requests.post(f"{API}/comments/{c['id']}/like", headers=h(token_b), timeout=30).json()
        assert r_b["liked"] is True and r_b["count"] == 2

    def test_mine_endpoint_reports_only_my_likes(self, token, token_b, recipe_id):
        c1 = requests.post(f"{API}/recipes/{recipe_id}/comments", json={"content": "TEST_iter3 cl mine 1"}, headers=h(token), timeout=30).json()
        c2 = requests.post(f"{API}/recipes/{recipe_id}/comments", json={"content": "TEST_iter3 cl mine 2"}, headers=h(token), timeout=30).json()
        requests.post(f"{API}/comments/{c1['id']}/like", headers=h(token), timeout=30)
        requests.post(f"{API}/comments/{c2['id']}/like", headers=h(token_b), timeout=30)

        mine_a = requests.get(f"{API}/recipes/{recipe_id}/comments/likes/mine", headers=h(token), timeout=30).json()
        mine_b = requests.get(f"{API}/recipes/{recipe_id}/comments/likes/mine", headers=h(token_b), timeout=30).json()
        assert c1["id"] in mine_a["liked_comment_ids"] and c2["id"] not in mine_a["liked_comment_ids"]
        assert c2["id"] in mine_b["liked_comment_ids"] and c1["id"] not in mine_b["liked_comment_ids"]

    def test_mine_endpoint_requires_auth(self, recipe_id):
        r = requests.get(f"{API}/recipes/{recipe_id}/comments/likes/mine", timeout=30)
        assert r.status_code == 401


# ---- COMMENT DELETION ----
class TestDeleteComment:
    def test_delete_requires_auth(self, token, recipe_id):
        c = requests.post(f"{API}/recipes/{recipe_id}/comments", json={"content": "TEST_iter3 del auth"}, headers=h(token), timeout=30).json()
        r = requests.delete(f"{API}/recipes/{recipe_id}/comments/{c['id']}", timeout=30)
        assert r.status_code == 401

    def test_cannot_delete_someone_elses_comment(self, token, token_b, recipe_id):
        c = requests.post(f"{API}/recipes/{recipe_id}/comments", json={"content": "TEST_iter3 del other"}, headers=h(token), timeout=30).json()
        r = requests.delete(f"{API}/recipes/{recipe_id}/comments/{c['id']}", headers=h(token_b), timeout=30)
        assert r.status_code == 403
        # toujours là
        lst = requests.get(f"{API}/recipes/{recipe_id}/comments", timeout=30).json()
        assert any(x["id"] == c["id"] for x in lst)

    def test_delete_unknown_comment_404s(self, token, recipe_id):
        r = requests.delete(f"{API}/recipes/{recipe_id}/comments/does-not-exist", headers=h(token), timeout=30)
        assert r.status_code == 404

    def test_delete_own_comment_removes_it(self, token, recipe_id):
        c = requests.post(f"{API}/recipes/{recipe_id}/comments", json={"content": "TEST_iter3 del own"}, headers=h(token), timeout=30).json()
        r = requests.delete(f"{API}/recipes/{recipe_id}/comments/{c['id']}", headers=h(token), timeout=30)
        assert r.status_code == 200
        assert c["id"] in r.json()["deleted_ids"]
        lst = requests.get(f"{API}/recipes/{recipe_id}/comments", timeout=30).json()
        assert not any(x["id"] == c["id"] for x in lst)

    def test_deleting_a_comment_cascades_to_its_replies(self, token, token_b, recipe_id):
        root = requests.post(f"{API}/recipes/{recipe_id}/comments", json={"content": "TEST_iter3 del cascade root"}, headers=h(token), timeout=30).json()
        reply = requests.post(
            f"{API}/recipes/{recipe_id}/comments",
            json={"content": "TEST_iter3 del cascade reply", "parent_id": root["id"]},
            headers=h(token_b), timeout=30,
        ).json()
        r = requests.delete(f"{API}/recipes/{recipe_id}/comments/{root['id']}", headers=h(token), timeout=30)
        assert r.status_code == 200
        assert set(r.json()["deleted_ids"]) == {root["id"], reply["id"]}
        lst = requests.get(f"{API}/recipes/{recipe_id}/comments", timeout=30).json()
        assert not any(x["id"] in (root["id"], reply["id"]) for x in lst)

    def test_deleting_a_comment_removes_its_likes(self, token, recipe_id):
        c = requests.post(f"{API}/recipes/{recipe_id}/comments", json={"content": "TEST_iter3 del likes"}, headers=h(token), timeout=30).json()
        requests.post(f"{API}/comments/{c['id']}/like", headers=h(token), timeout=30)
        requests.delete(f"{API}/recipes/{recipe_id}/comments/{c['id']}", headers=h(token), timeout=30)
        mine = requests.get(f"{API}/recipes/{recipe_id}/comments/likes/mine", headers=h(token), timeout=30).json()
        assert c["id"] not in mine["liked_comment_ids"]


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
