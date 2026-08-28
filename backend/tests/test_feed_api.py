"""Tests du fil des abonnements (GET /feed) : fusionne les recettes et
créations récentes des personnes suivies, pagination par curseur
(before/has_more), jamais les publications d'un utilisateur non suivi.

Comme test_follows_api.py, toute mutation d'une même relation/contenu
partagé reste dans une seule classe séquentielle sous `-n 2
--dist loadscope` — deux comptes dédiés à la pagination (D/E) évitent toute
interférence de comptage avec le flux principal (A/B/C).
"""
import io
import os

import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"


def _login_or_register(email, password, name):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code == 200:
        return r.json()
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": password, "name": name}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def h(token):
    return {"Authorization": f"Bearer {token}"}


def _jpeg(color=(180, 120, 70)):
    buf = io.BytesIO()
    Image.new("RGB", (40, 40), color).save(buf, format="JPEG")
    buf.seek(0)
    return buf


def _upload(token):
    r = requests.post(f"{API}/upload", files={"file": ("photo.jpg", _jpeg(), "image/jpeg")}, headers=h(token), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["path"]


def _recipe_payload(title):
    return {
        "title": title, "category": "Pains", "difficulty": "Facile", "time_minutes": 60,
        "hydration": 65, "description": "Test fil", "ingredients": ["500 g farine", "300 g eau"],
        "steps": ["Etape 1", "Etape 2"],
    }


@pytest.fixture(scope="module")
def auth_a():
    return _login_or_register("test.feed.a@bakers.app", "TestFeedA2026!", "Chef Feed A")


@pytest.fixture(scope="module")
def auth_b():
    return _login_or_register("test.feed.b@bakers.app", "TestFeedB2026!", "Chef Feed B")


@pytest.fixture(scope="module")
def auth_c():
    return _login_or_register("test.feed.c@bakers.app", "TestFeedC2026!", "Chef Feed C")


@pytest.fixture(scope="module")
def auth_d():
    return _login_or_register("test.feed.d@bakers.app", "TestFeedD2026!", "Chef Feed D")


@pytest.fixture(scope="module")
def auth_e():
    return _login_or_register("test.feed.e@bakers.app", "TestFeedE2026!", "Chef Feed E")


@pytest.fixture(scope="module")
def token_a(auth_a):
    return auth_a["token"]


@pytest.fixture(scope="module")
def token_b(auth_b):
    return auth_b["token"]


@pytest.fixture(scope="module")
def token_c(auth_c):
    return auth_c["token"]


@pytest.fixture(scope="module")
def token_d(auth_d):
    return auth_d["token"]


@pytest.fixture(scope="module")
def token_e(auth_e):
    return auth_e["token"]


@pytest.fixture(scope="module")
def user_a(auth_a):
    return auth_a["user"]["user_id"]


@pytest.fixture(scope="module")
def user_b(auth_b):
    return auth_b["user"]["user_id"]


@pytest.fixture(scope="module")
def user_d(auth_d):
    return auth_d["user"]["user_id"]


@pytest.fixture(scope="module")
def user_e(auth_e):
    return auth_e["user"]["user_id"]


def _ensure_unfollowed(token, other_id):
    prof = requests.get(f"{API}/users/{other_id}/profile", headers=h(token), timeout=30).json()
    if prof["following"]:
        requests.post(f"{API}/users/{other_id}/follow", headers=h(token), timeout=30)


def _ensure_followed(token, other_id):
    prof = requests.get(f"{API}/users/{other_id}/profile", headers=h(token), timeout=30).json()
    if not prof["following"]:
        requests.post(f"{API}/users/{other_id}/follow", headers=h(token), timeout=30)


class TestIndependentChecks:
    def test_feed_requires_auth(self):
        r = requests.get(f"{API}/feed", timeout=30)
        assert r.status_code in (401, 403)

    def test_invalid_before_rejected(self, token_c):
        r = requests.get(f"{API}/feed?before=not-a-date", headers=h(token_c), timeout=30)
        assert r.status_code == 400

    def test_empty_feed_when_following_nobody(self, token_c):
        r = requests.get(f"{API}/feed", headers=h(token_c), timeout=30)
        assert r.status_code == 200
        assert r.json() == {"items": [], "has_more": False}


class TestFeedFlow:
    """A suit B. Vérifie l'apparition/absence des recettes et créations
    de B dans le fil de A, la fusion+tri, les compteurs, et l'exclusion
    d'un contenu publié par quelqu'un que le viewer ne suit pas (C)."""

    def test_01_follow_b(self, token_a, user_b):
        _ensure_followed(token_a, user_b)

    def test_02_recipe_appears_in_feed(self, token_a, token_b):
        r = requests.post(f"{API}/recipes", json=_recipe_payload("TEST_Fil_Recette"), headers=h(token_b), timeout=30)
        assert r.status_code == 200, r.text
        recipe_id = r.json()["id"]

        r = requests.get(f"{API}/feed", headers=h(token_a), timeout=30)
        assert r.status_code == 200
        item = next(i for i in r.json()["items"] if i["id"] == recipe_id)
        assert item["kind"] == "recipe"
        assert item["title"] == "TEST_Fil_Recette"
        assert item["author_name"] == "Chef Feed B"
        assert item["like_count"] == 0
        assert item["liked"] is False
        assert item["comment_count"] == 0

    def test_03_comment_count_reflects_comments(self, token_a, token_b):
        recipe_id = next(i["id"] for i in requests.get(f"{API}/feed", headers=h(token_a), timeout=30).json()["items"] if i["title"] == "TEST_Fil_Recette")
        r = requests.post(f"{API}/recipes/{recipe_id}/comments", json={"content": "Superbe !"}, headers=h(token_a), timeout=30)
        assert r.status_code == 200, r.text

        item = next(i for i in requests.get(f"{API}/feed", headers=h(token_a), timeout=30).json()["items"] if i["id"] == recipe_id)
        assert item["comment_count"] == 1

    def test_04_creation_appears_and_sorts_before_older_recipe(self, token_a, token_b):
        photo = _upload(token_b)
        r = requests.post(
            f"{API}/creations",
            json={"title": "TEST_Fil_Creation", "category": "Pain", "photos": [photo]},
            headers=h(token_b), timeout=30,
        )
        assert r.status_code == 200, r.text
        creation_id = r.json()["id"]

        items = requests.get(f"{API}/feed", headers=h(token_a), timeout=30).json()["items"]
        creation_item = next(i for i in items if i["id"] == creation_id)
        assert creation_item["kind"] == "creation"
        assert creation_item["author_name"] == "Chef Feed B"
        assert creation_item["photos"] == [photo]
        assert creation_item["like_count"] == 0
        assert "comment_count" not in creation_item  # pas de commentaires sur les créations

        # La création (plus récente) doit précéder la recette dans le fil.
        recipe_idx = next(idx for idx, i in enumerate(items) if i["title"] == "TEST_Fil_Recette")
        creation_idx = next(idx for idx, i in enumerate(items) if i["id"] == creation_id)
        assert creation_idx < recipe_idx

    def test_05_like_reflected_in_feed(self, token_a):
        recipe_id = next(i["id"] for i in requests.get(f"{API}/feed", headers=h(token_a), timeout=30).json()["items"] if i["title"] == "TEST_Fil_Recette")
        r = requests.post(f"{API}/recipes/{recipe_id}/like", headers=h(token_a), timeout=30)
        assert r.status_code == 200

        item = next(i for i in requests.get(f"{API}/feed", headers=h(token_a), timeout=30).json()["items"] if i["id"] == recipe_id)
        assert item["liked"] is True
        assert item["like_count"] == 1

    def test_06_non_follower_does_not_see_it(self, token_c, token_b):
        r = requests.post(f"{API}/recipes", json=_recipe_payload("TEST_Fil_Recette_Autre"), headers=h(token_b), timeout=30)
        recipe_id = r.json()["id"]
        r = requests.get(f"{API}/feed", headers=h(token_c), timeout=30)
        # C ne suit personne (voir TestIndependentChecks) — le fil reste vide.
        assert not any(i["id"] == recipe_id for i in r.json()["items"])

    def test_07_unfollow_removes_content_from_feed(self, token_a, user_b):
        recipe_id = next(i["id"] for i in requests.get(f"{API}/feed", headers=h(token_a), timeout=30).json()["items"] if i["title"] == "TEST_Fil_Recette")
        requests.post(f"{API}/users/{user_b}/follow", headers=h(token_a), timeout=30)  # unfollow
        r = requests.get(f"{API}/feed", headers=h(token_a), timeout=30)
        assert not any(i["id"] == recipe_id for i in r.json()["items"])


class TestFeedPagination:
    """Compte dédié (D suit E) pour ne pas mélanger ses assertions de
    pagination exactes avec le contenu créé par TestFeedFlow."""

    def test_01_follow_and_seed_more_than_a_page(self, token_d, token_e, user_e):
        _ensure_followed(token_d, user_e)
        for i in range(22):
            r = requests.post(f"{API}/recipes", json=_recipe_payload(f"TEST_Fil_Pagination_{i:02d}"), headers=h(token_e), timeout=30)
            assert r.status_code == 200, r.text

    def test_02_first_page_has_20_and_more(self, token_d):
        r = requests.get(f"{API}/feed", headers=h(token_d), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data["items"]) == 20
        assert data["has_more"] is True
        # Le plus récent (dernier créé) est en tête.
        assert data["items"][0]["title"] == "TEST_Fil_Pagination_21"

    def test_03_second_page_has_remainder_and_no_duplicates(self, token_d):
        # N'assume pas une base vierge (des recettes d'autres runs peuvent
        # s'être accumulées pour E) : vérifie des invariants, pas un compte
        # global exact — le curseur (avant le plus ancien élément de la
        # page 1) doit toujours renvoyer les deux plus anciennes de CE lot
        # (00 et 01), jamais dupliquées avec la page 1, jamais plus récentes
        # que le curseur.
        first = requests.get(f"{API}/feed", headers=h(token_d), timeout=30).json()
        cursor = first["items"][-1]["created_at"]
        # requests.get(..., params=...) encode correctement le '+' d'un
        # timestamp avec fuseau — jamais une interpolation brute dans l'URL.
        r = requests.get(f"{API}/feed", params={"before": cursor}, headers=h(token_d), timeout=30)
        assert r.status_code == 200
        second = r.json()

        first_ids = {i["id"] for i in first["items"]}
        second_ids = {i["id"] for i in second["items"]}
        assert first_ids.isdisjoint(second_ids)

        first_titles = {i["title"] for i in first["items"]}
        second_titles = {i["title"] for i in second["items"]}
        assert "TEST_Fil_Pagination_00" not in first_titles
        assert "TEST_Fil_Pagination_01" not in first_titles
        assert "TEST_Fil_Pagination_00" in second_titles
        assert "TEST_Fil_Pagination_01" in second_titles

        assert all(i["created_at"] < cursor for i in second["items"])

    def test_04_cleanup(self, token_d, user_e):
        _ensure_unfollowed(token_d, user_e)
