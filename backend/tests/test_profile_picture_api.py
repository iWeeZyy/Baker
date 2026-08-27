"""Tests de la photo de profil : POST/DELETE /auth/me/picture.

Suit le style de test_messaging_photos.py : les tests dont l'issue dépend
du niveau de modération exact (bloqué/accepté) sont ignorés (skip) quand
le serveur testé ne tourne pas avec MODERATION_PROVIDER=stub ; tous les
autres (authentification, remplacement, suppression, tailles/formats,
isolation entre comptes, fraîcheur dans les commentaires/recettes) sont
indépendants du fournisseur et tournent toujours.
"""
import io
import os

import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "test.avatar.a@bakers.app"
TEST_PASS = "TestAvatarA2026!"
TEST_NAME = "Chef Avatar A"

TEST_EMAIL_B = "test.avatar.b@bakers.app"
TEST_PASS_B = "TestAvatarB2026!"
TEST_NAME_B = "Chef Avatar B"

STUB_ACTIVE = os.environ.get("MODERATION_PROVIDER", "").strip().lower() == "stub"
requires_stub = pytest.mark.skipif(
    not STUB_ACTIVE,
    reason="nécessite que le serveur testé tourne avec MODERATION_PROVIDER=stub",
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


def h(token):
    return {"Authorization": f"Bearer {token}"}


def _solid_jpeg(color, size=(300, 300)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    buf.seek(0)
    return buf


def GREY(): return _solid_jpeg((150, 150, 150))
def RED(): return _solid_jpeg((255, 0, 0))
def ORANGE(): return _solid_jpeg((255, 150, 0))


def _upload(token, fileobj, filename="avatar.jpg"):
    return requests.post(
        f"{API}/auth/me/picture",
        files={"file": (filename, fileobj, "image/jpeg")},
        headers=h(token),
        timeout=30,
    )


class TestUploadGuards:
    def test_requires_auth(self):
        r = requests.post(f"{API}/auth/me/picture", files={"file": ("a.jpg", GREY(), "image/jpeg")}, timeout=30)
        assert r.status_code == 401

    def test_empty_file_rejected(self, token):
        r = requests.post(
            f"{API}/auth/me/picture",
            files={"file": ("empty.jpg", io.BytesIO(b""), "image/jpeg")},
            headers=h(token), timeout=30,
        )
        assert r.status_code == 400

    def test_non_image_upload_rejected(self, token):
        r = requests.post(
            f"{API}/auth/me/picture",
            files={"file": ("notes.txt", io.BytesIO(b"this is not an image"), "text/plain")},
            headers=h(token), timeout=30,
        )
        assert r.status_code == 400

    def test_oversized_upload_rejected(self, token):
        big = io.BytesIO(b"0" * (13 * 1024 * 1024))
        r = requests.post(
            f"{API}/auth/me/picture",
            files={"file": ("big.jpg", big, "image/jpeg")},
            headers=h(token), timeout=30,
        )
        assert r.status_code == 413


class TestUploadAndDisplay:
    def test_upload_updates_me_and_is_fetchable(self, token):
        r = _upload(token, GREY())
        assert r.status_code == 200, r.text
        picture = r.json()["picture"]
        assert picture

        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me["picture"] == picture

        got = requests.get(f"{API}/files/{picture}", timeout=30)
        assert got.status_code == 200
        assert got.headers["content-type"].startswith("image/")

    def test_appears_in_public_user_search(self, token, token_b):
        _upload(token, GREY())
        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        results = requests.get(f"{API}/users/search", params={"q": TEST_NAME}, headers=h(token_b), timeout=30).json()
        found = next((u for u in results if u["user_id"] == me["user_id"]), None)
        assert found is not None
        assert found["picture"] == me["picture"]

    def test_replacing_deletes_the_old_file(self, token):
        first = _upload(token, GREY()).json()["picture"]
        second = _upload(token, GREY(size=(200, 200))).json()["picture"]
        assert second != first
        assert requests.get(f"{API}/files/{first}", timeout=30).status_code == 404
        assert requests.get(f"{API}/files/{second}", timeout=30).status_code == 200


class TestDelete:
    def test_delete_requires_auth(self):
        r = requests.delete(f"{API}/auth/me/picture", timeout=30)
        assert r.status_code == 401

    def test_delete_removes_file_and_resets_to_none(self, token):
        picture = _upload(token, GREY()).json()["picture"]
        r = requests.delete(f"{API}/auth/me/picture", headers=h(token), timeout=30)
        assert r.status_code == 200
        assert r.json()["picture"] is None

        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me["picture"] is None
        assert requests.get(f"{API}/files/{picture}", timeout=30).status_code == 404


class TestAccountIsolation:
    def test_one_account_cannot_affect_anothers_picture(self, token, token_b):
        # Aucune route ne prend un user_id cible : l'upload/la suppression
        # agissent toujours sur le compte du JWT, jamais sur un autre.
        pic_a = _upload(token, GREY()).json()["picture"]
        _upload(token_b, ORANGE() if STUB_ACTIVE else GREY())
        requests.delete(f"{API}/auth/me/picture", headers=h(token_b), timeout=30)

        me_a = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me_a["picture"] == pic_a


class TestLiveFreshness:
    """La photo affichée sur un commentaire ou une recette est toujours
    celle du compte au moment de la lecture, jamais une copie figée au
    moment de la création."""

    def test_comment_reflects_current_picture_not_a_snapshot(self, token):
        recipe_id = requests.get(f"{API}/recipes", timeout=30).json()[0]["id"]
        comment = requests.post(
            f"{API}/recipes/{recipe_id}/comments",
            json={"content": "TEST_avatar fraicheur"},
            headers=h(token), timeout=30,
        ).json()
        new_picture = _upload(token, GREY()).json()["picture"]

        comments = requests.get(f"{API}/recipes/{recipe_id}/comments", timeout=30).json()
        found = next(c for c in comments if c["id"] == comment["id"])
        assert found["user_picture"] == new_picture

    def test_recipe_author_picture_reflects_current_picture(self, token):
        picture = _upload(token, GREY()).json()["picture"]
        recipe = requests.post(
            f"{API}/recipes",
            json={
                "title": "TEST_avatar recette fraicheur", "category": "Pains", "difficulty": "Facile",
                "time_minutes": 30, "description": "desc", "ingredients": ["farine"], "steps": ["petrir"],
            },
            headers=h(token), timeout=30,
        ).json()
        listed = requests.get(f"{API}/recipes", timeout=30).json()
        found = next(r for r in listed if r["id"] == recipe["id"])
        assert found["author_picture"] == picture


class TestModerationPolicy:
    @requires_stub
    def test_blocked_picture_is_rejected_and_unchanged(self, token):
        current = _upload(token, GREY()).json()["picture"]
        r = _upload(token, RED())
        assert r.status_code == 422
        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me["picture"] == current

    @requires_stub
    def test_sensitive_picture_is_accepted(self, token):
        r = _upload(token, ORANGE())
        assert r.status_code == 200, r.text
