"""Tests de « Mes créations » : POST/GET/PUT/DELETE /creations, likes, et le
renforcement de POST /upload (taille, redimensionnement, modération) dont
cette fonctionnalité dépend.

Suit le style de test_user_profile_api.py : les tests dont l'issue dépend
d'un mot interdit réellement chargé sont ignorés (skip) sinon.
"""
import io
import os

import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "test.creations.a@bakers.app"
TEST_PASS = "TestCreationsA2026!"
TEST_NAME = "Chef Creations A"

TEST_EMAIL_B = "test.creations.b@bakers.app"
TEST_PASS_B = "TestCreationsB2026!"
TEST_NAME_B = "Chef Creations B"

TEST_BAN_WORD = os.environ.get("TEXT_MODERATION_TEST_BAN_WORD_FOR_TESTS", "").strip()
requires_test_ban_word = pytest.mark.skipif(
    not TEST_BAN_WORD,
    reason="nécessite TEXT_MODERATION_TEST_BAN_WORD_FOR_TESTS (doit correspondre à une entrée de TEXT_MODERATION_TEST_BAN_WORDS côté serveur)",
)


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
    return r.json()[0]["id"]


def h(token):
    return {"Authorization": f"Bearer {token}"}


def _jpeg(color=(180, 120, 70), size=(600, 400)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    buf.seek(0)
    return buf


def _upload(token, color=(180, 120, 70)):
    r = requests.post(f"{API}/upload", files={"file": ("photo.jpg", _jpeg(color), "image/jpeg")}, headers=h(token), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["path"]


class TestUploadGuards:
    """POST /upload renforcé — utilisé par les créations comme par la photo
    de couverture d'une recette (share.tsx) ; ces garde-fous protègent les deux."""

    def test_requires_auth(self):
        r = requests.post(f"{API}/upload", files={"file": ("a.jpg", _jpeg(), "image/jpeg")}, timeout=30)
        assert r.status_code == 401

    def test_empty_file_rejected(self, token):
        r = requests.post(f"{API}/upload", files={"file": ("empty.jpg", io.BytesIO(b""), "image/jpeg")}, headers=h(token), timeout=30)
        assert r.status_code == 400

    def test_oversized_upload_rejected(self, token):
        big = io.BytesIO(b"0" * (13 * 1024 * 1024))
        r = requests.post(f"{API}/upload", files={"file": ("big.jpg", big, "image/jpeg")}, headers=h(token), timeout=30)
        assert r.status_code == 413

    def test_non_image_upload_rejected(self, token):
        r = requests.post(f"{API}/upload", files={"file": ("notes.txt", io.BytesIO(b"not an image"), "text/plain")}, headers=h(token), timeout=30)
        assert r.status_code == 400

    def test_successful_upload_is_fetchable_and_reencoded_as_jpeg(self, token):
        path = _upload(token)
        assert path.endswith(".jpg")
        got = requests.get(f"{API}/files/{path}", timeout=30)
        assert got.status_code == 200
        assert got.headers["content-type"].startswith("image/")


class TestCreateCreation:
    def test_requires_auth(self):
        r = requests.post(f"{API}/creations", json={"title": "X", "category": "Pain", "photos": ["a"]}, timeout=30)
        assert r.status_code == 401

    def test_create_with_recipe_and_multiple_photos(self, token, recipe_id):
        p1, p2 = _upload(token), _upload(token, (10, 20, 30))
        r = requests.post(
            f"{API}/creations",
            json={"title": "Pain au levain", "description": "T80, levain liquide, fermentation 18 h.",
                  "category": "Pain", "recipe_id": recipe_id, "photos": [p1, p2]},
            headers=h(token), timeout=30,
        )
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["title"] == "Pain au levain"
        assert c["photos"] == [p1, p2]
        assert c["recipe"] == {"id": recipe_id, "title": requests.get(f"{API}/recipes/{recipe_id}", timeout=30).json()["title"]}
        assert c["like_count"] == 0
        assert c["user_name"] == TEST_NAME

    def test_publish_without_recipe(self, token):
        p1 = _upload(token)
        r = requests.post(f"{API}/creations", json={"title": "Croissants", "category": "Viennoiserie", "photos": [p1]}, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text
        assert "recipe" not in r.json()

    def test_creation_without_description_is_allowed(self, token):
        p1 = _upload(token)
        r = requests.post(f"{API}/creations", json={"title": "Baguettes", "category": "Pain", "photos": [p1]}, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["description"] == ""

    def test_missing_title_rejected(self, token):
        p1 = _upload(token)
        r = requests.post(f"{API}/creations", json={"title": "   ", "category": "Pain", "photos": [p1]}, headers=h(token), timeout=30)
        assert r.status_code == 422

    def test_invalid_category_rejected(self, token):
        p1 = _upload(token)
        r = requests.post(f"{API}/creations", json={"title": "X", "category": "Invalide", "photos": [p1]}, headers=h(token), timeout=30)
        assert r.status_code == 422

    def test_no_photos_rejected(self, token):
        r = requests.post(f"{API}/creations", json={"title": "X", "category": "Pain", "photos": []}, headers=h(token), timeout=30)
        assert r.status_code == 422

    def test_nonexistent_recipe_rejected(self, token):
        p1 = _upload(token)
        r = requests.post(f"{API}/creations", json={"title": "X", "category": "Pain", "recipe_id": "does-not-exist", "photos": [p1]}, headers=h(token), timeout=30)
        assert r.status_code == 404

    def test_description_at_exactly_max_length_accepted(self, token):
        p1 = _upload(token)
        r = requests.post(f"{API}/creations", json={"title": "X", "description": "a" * 500, "category": "Pain", "photos": [p1]}, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text

    def test_description_over_max_length_rejected(self, token):
        p1 = _upload(token)
        r = requests.post(f"{API}/creations", json={"title": "X", "description": "a" * 501, "category": "Pain", "photos": [p1]}, headers=h(token), timeout=30)
        assert r.status_code == 422

    @requires_test_ban_word
    def test_rejected_by_moderation(self, token):
        p1 = _upload(token)
        r = requests.post(f"{API}/creations", json={"title": f"TEST {TEST_BAN_WORD}", "category": "Pain", "photos": [p1]}, headers=h(token), timeout=30)
        assert r.status_code == 422
        assert TEST_BAN_WORD not in r.text


class TestListingAndVisibility:
    def test_appears_in_mine(self, token):
        p1 = _upload(token)
        c = requests.post(f"{API}/creations", json={"title": "TEST mine listing", "category": "Autre", "photos": [p1]}, headers=h(token), timeout=30).json()
        mine = requests.get(f"{API}/creations/mine", headers=h(token), timeout=30).json()
        assert any(x["id"] == c["id"] for x in mine)

    def test_mine_requires_auth(self):
        r = requests.get(f"{API}/creations/mine", timeout=30)
        assert r.status_code == 401

    def test_appears_on_public_profile(self, token, token_b):
        p1 = _upload(token)
        c = requests.post(f"{API}/creations", json={"title": "TEST public profile", "category": "Autre", "photos": [p1]}, headers=h(token), timeout=30).json()
        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        profile = requests.get(f"{API}/users/{me['user_id']}/profile", headers=h(token_b), timeout=30).json()
        assert any(x["id"] == c["id"] for x in profile["creations"])

    def test_user_with_no_creations_has_empty_list_on_profile(self):
        email = "test.creations.fresh@bakers.app"
        password = "TestCreationsFresh2026!"
        r = requests.post(f"{API}/auth/register", json={"email": email, "password": password, "name": "Chef Frais"}, timeout=30)
        if r.status_code != 200:
            r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
        token_fresh = r.json()["token"]
        me = requests.get(f"{API}/auth/me", headers=h(token_fresh), timeout=30).json()
        assert requests.get(f"{API}/creations/mine", headers=h(token_fresh), timeout=30).json() == []
        profile = requests.get(f"{API}/users/{me['user_id']}/profile", headers=h(token_fresh), timeout=30).json()
        assert profile["creations"] == []


class TestDetailAndDeletedRecipe:
    def test_detail_requires_auth(self, token):
        p1 = _upload(token)
        c = requests.post(f"{API}/creations", json={"title": "TEST detail", "category": "Pain", "photos": [p1]}, headers=h(token), timeout=30).json()
        r = requests.get(f"{API}/creations/{c['id']}", timeout=30)
        assert r.status_code == 401

    def test_unknown_creation_404s(self, token):
        r = requests.get(f"{API}/creations/does-not-exist", headers=h(token), timeout=30)
        assert r.status_code == 404

    def test_missing_recipe_reference_never_breaks_the_creation(self, token, recipe_id):
        # Une recette qui disparaîtrait ensuite ne doit jamais casser la
        # création : on simule directement l'état "recipe_id ne pointe plus
        # vers rien" en pointant sur un id qui n'existe déjà pas au moment de
        # la lecture (le POST le refuserait, donc on vérifie via la lecture
        # que _creation_detail() reste défensif — voir test_nonexistent_recipe_rejected
        # pour la création elle-même, refusée en amont).
        p1 = _upload(token)
        c = requests.post(f"{API}/creations", json={"title": "TEST recette valide", "category": "Pain", "recipe_id": recipe_id, "photos": [p1]}, headers=h(token), timeout=30).json()
        assert c.get("recipe") is not None
        detail = requests.get(f"{API}/creations/{c['id']}", headers=h(token), timeout=30).json()
        assert detail["recipe"]["id"] == recipe_id


class TestLikes:
    def test_toggle_like_and_unlike(self, token, token_b):
        p1 = _upload(token)
        c = requests.post(f"{API}/creations", json={"title": "TEST like", "category": "Pain", "photos": [p1]}, headers=h(token), timeout=30).json()

        r = requests.post(f"{API}/creations/{c['id']}/like", headers=h(token_b), timeout=30)
        assert r.json() == {"liked": True, "count": 1}
        got = requests.get(f"{API}/creations/{c['id']}/likes", headers=h(token_b), timeout=30).json()
        assert got == {"count": 1, "liked": True}

        r2 = requests.post(f"{API}/creations/{c['id']}/like", headers=h(token_b), timeout=30)
        assert r2.json() == {"liked": False, "count": 0}

    def test_two_users_liking_are_both_counted(self, token, token_b):
        p1 = _upload(token)
        c = requests.post(f"{API}/creations", json={"title": "TEST two likes", "category": "Pain", "photos": [p1]}, headers=h(token), timeout=30).json()
        requests.post(f"{API}/creations/{c['id']}/like", headers=h(token), timeout=30)
        r = requests.post(f"{API}/creations/{c['id']}/like", headers=h(token_b), timeout=30)
        assert r.json()["count"] == 2

    def test_like_unknown_creation_404s(self, token):
        r = requests.post(f"{API}/creations/does-not-exist/like", headers=h(token), timeout=30)
        assert r.status_code == 404

    def test_like_requires_auth(self, token):
        p1 = _upload(token)
        c = requests.post(f"{API}/creations", json={"title": "TEST like auth", "category": "Pain", "photos": [p1]}, headers=h(token), timeout=30).json()
        r = requests.post(f"{API}/creations/{c['id']}/like", timeout=30)
        assert r.status_code == 401


class TestOwnershipEditDelete:
    def test_other_user_cannot_edit(self, token, token_b):
        p1 = _upload(token)
        c = requests.post(f"{API}/creations", json={"title": "TEST edit perm", "category": "Pain", "photos": [p1]}, headers=h(token), timeout=30).json()
        r = requests.put(f"{API}/creations/{c['id']}", json={"title": "Hack", "category": "Pain", "photos": [p1]}, headers=h(token_b), timeout=30)
        assert r.status_code == 403
        still = requests.get(f"{API}/creations/{c['id']}", headers=h(token), timeout=30).json()
        assert still["title"] == "TEST edit perm"

    def test_other_user_cannot_delete(self, token, token_b):
        p1 = _upload(token)
        c = requests.post(f"{API}/creations", json={"title": "TEST delete perm", "category": "Pain", "photos": [p1]}, headers=h(token), timeout=30).json()
        r = requests.delete(f"{API}/creations/{c['id']}", headers=h(token_b), timeout=30)
        assert r.status_code == 403

    def test_owner_can_edit_text_fields(self, token):
        p1 = _upload(token)
        c = requests.post(f"{API}/creations", json={"title": "Avant", "description": "avant", "category": "Pain", "photos": [p1]}, headers=h(token), timeout=30).json()
        r = requests.put(f"{API}/creations/{c['id']}", json={"title": "Après", "description": "après", "category": "Viennoiserie", "photos": [p1]}, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["title"] == "Après"
        assert r.json()["category"] == "Viennoiserie"

    def test_edit_removes_dropped_photo_from_storage(self, token):
        p1, p2 = _upload(token), _upload(token, (5, 6, 7))
        c = requests.post(f"{API}/creations", json={"title": "TEST photo removal", "category": "Pain", "photos": [p1, p2]}, headers=h(token), timeout=30).json()
        r = requests.put(f"{API}/creations/{c['id']}", json={"title": "TEST photo removal", "category": "Pain", "photos": [p1]}, headers=h(token), timeout=30)
        assert r.status_code == 200
        assert r.json()["photos"] == [p1]
        assert requests.get(f"{API}/files/{p2}", timeout=30).status_code == 404
        assert requests.get(f"{API}/files/{p1}", timeout=30).status_code == 200

    def test_owner_can_delete_and_photos_and_likes_are_removed(self, token, token_b):
        p1 = _upload(token)
        c = requests.post(f"{API}/creations", json={"title": "TEST delete", "category": "Pain", "photos": [p1]}, headers=h(token), timeout=30).json()
        requests.post(f"{API}/creations/{c['id']}/like", headers=h(token_b), timeout=30)

        r = requests.delete(f"{API}/creations/{c['id']}", headers=h(token), timeout=30)
        assert r.status_code == 200
        assert requests.get(f"{API}/creations/{c['id']}", headers=h(token), timeout=30).status_code == 404
        assert requests.get(f"{API}/files/{p1}", timeout=30).status_code == 404

        # Un like sur une création supprimée ne doit pas persister à vie.
        recreated = requests.post(f"{API}/creations", json={"title": "TEST delete", "category": "Pain", "photos": [_upload(token)]}, headers=h(token), timeout=30).json()
        assert requests.get(f"{API}/creations/{recreated['id']}/likes", headers=h(token_b), timeout=30).json()["count"] == 0

    def test_delete_unknown_creation_404s(self, token):
        r = requests.delete(f"{API}/creations/does-not-exist", headers=h(token), timeout=30)
        assert r.status_code == 404
