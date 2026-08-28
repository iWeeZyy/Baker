"""Tests du Classement (Leaderboard) : GET /leaderboard/creators|recipes|
creations, par période. Toute mutation partagée (publier, aimer, commenter,
suivre, supprimer) vit dans une seule classe séquentielle
(`TestLeaderboardFlow`), même convention que test_follows_api.py — sous
`-n 2 --dist loadscope`, deux classes du même module peuvent tourner en
parallèle sur des workers distincts, donc les comptes D/E de ce fichier ne
sont utilisés que par cette classe.
"""
import io
import os

import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"


def _jpeg(color=(180, 120, 70)):
    buf = io.BytesIO()
    Image.new("RGB", (40, 40), color).save(buf, format="JPEG")
    buf.seek(0)
    return buf


def _login_or_register(email, password, name):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code == 200:
        return r.json()
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": password, "name": name}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def h(token):
    return {"Authorization": f"Bearer {token}"}


def _recipe_payload(title):
    return {
        "title": title, "category": "Pains", "difficulty": "Facile", "time_minutes": 60,
        "hydration": 65, "description": "Test classement", "ingredients": ["500 g farine", "300 g eau"],
        "steps": ["Etape 1", "Etape 2"],
    }


@pytest.fixture(scope="module")
def auth_d():
    return _login_or_register("test.leaderboard.d@bakers.app", "TestLeaderboardD2026!", "Chef Leaderboard D")


@pytest.fixture(scope="module")
def auth_e():
    return _login_or_register("test.leaderboard.e@bakers.app", "TestLeaderboardE2026!", "Chef Leaderboard E")


@pytest.fixture(scope="module")
def auth_f():
    return _login_or_register("test.leaderboard.f@bakers.app", "TestLeaderboardF2026!", "Chef Leaderboard F")


@pytest.fixture(scope="module")
def token_d(auth_d):
    return auth_d["token"]


@pytest.fixture(scope="module")
def token_e(auth_e):
    return auth_e["token"]


@pytest.fixture(scope="module")
def token_f(auth_f):
    return auth_f["token"]


@pytest.fixture(scope="module")
def user_d(auth_d):
    return auth_d["user"]["user_id"]


@pytest.fixture(scope="module")
def user_e(auth_e):
    return auth_e["user"]["user_id"]


class TestIndependentChecks:
    def test_creators_requires_auth(self):
        r = requests.get(f"{API}/leaderboard/creators", timeout=30)
        assert r.status_code in (401, 403)

    def test_recipes_requires_auth(self):
        r = requests.get(f"{API}/leaderboard/recipes", timeout=30)
        assert r.status_code in (401, 403)

    def test_creations_requires_auth(self):
        r = requests.get(f"{API}/leaderboard/creations", timeout=30)
        assert r.status_code in (401, 403)

    def test_invalid_period_rejected(self, token_f):
        for path in ("creators", "recipes", "creations"):
            r = requests.get(f"{API}/leaderboard/{path}", params={"period": "decade"}, headers=h(token_f), timeout=30)
            assert r.status_code == 400

    def test_all_four_periods_accepted(self, token_f):
        for period in ("week", "month", "year", "all"):
            r = requests.get(f"{API}/leaderboard/creators", params={"period": period}, headers=h(token_f), timeout=30)
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["period"] == period
            assert isinstance(data["top"], list)

    def test_fresh_account_has_no_rank_yet(self, token_f):
        # A brand-new account with zero activity must never get an invented
        # rank — my_rank stays null rather than a fabricated "#1".
        r = requests.get(f"{API}/leaderboard/creators", headers=h(token_f), timeout=30)
        assert r.status_code == 200
        assert r.json()["my_rank"] is None

    def test_limit_is_bounded(self, token_f):
        r = requests.get(f"{API}/leaderboard/creators", params={"limit": 10000}, headers=h(token_f), timeout=30)
        assert r.status_code == 200
        assert len(r.json()["top"]) <= 50

    def test_catalog_recipes_never_scored(self, token_f):
        # Liking a built-in catalog recipe (author_id=None, is_user_submitted
        # False) must never surface it in /leaderboard/recipes nor credit
        # anyone's creator score.
        catalog = next(r for r in requests.get(f"{API}/recipes", headers=h(token_f), timeout=30).json() if not r.get("is_user_submitted"))
        requests.post(f"{API}/recipes/{catalog['id']}/like", headers=h(token_f), timeout=30)
        try:
            items = requests.get(f"{API}/leaderboard/recipes", params={"period": "all"}, headers=h(token_f), timeout=30).json()["items"]
            assert not any(i["id"] == catalog["id"] for i in items)
        finally:
            requests.post(f"{API}/recipes/{catalog['id']}/like", headers=h(token_f), timeout=30)  # unlike, leave state clean


class TestLeaderboardFlow:
    """D publie, E interagit avec le contenu de D — vérifie le score par
    signal, l'auto-engagement exclu, le classement recettes/créations, la
    pastille following, et la suppression qui retire du classement."""

    def test_01_publishing_a_recipe_scores_points(self, token_d, user_d):
        r = requests.post(f"{API}/recipes", json=_recipe_payload("TEST_Classement_Recette"), headers=h(token_d), timeout=30)
        assert r.status_code == 200, r.text
        data = requests.get(f"{API}/leaderboard/creators", params={"period": "all"}, headers=h(token_d), timeout=30).json()
        assert data["my_rank"] is not None
        assert data["my_rank"]["score"] >= 15  # POINTS_RECIPE_PUBLISHED

    def test_02_self_like_does_not_inflate_own_score(self, token_d, user_d):
        recipe_id = next(i["id"] for i in requests.get(f"{API}/recipes/mine", headers=h(token_d), timeout=30).json() if i["title"] == "TEST_Classement_Recette")
        before = requests.get(f"{API}/leaderboard/creators", params={"period": "all"}, headers=h(token_d), timeout=30).json()["my_rank"]["score"]
        requests.post(f"{API}/recipes/{recipe_id}/like", headers=h(token_d), timeout=30)  # D likes their own recipe
        after = requests.get(f"{API}/leaderboard/creators", params={"period": "all"}, headers=h(token_d), timeout=30).json()["my_rank"]["score"]
        assert after == before
        requests.post(f"{API}/recipes/{recipe_id}/like", headers=h(token_d), timeout=30)  # unlike, clean state

    def test_03_like_from_someone_else_scores_and_ranks_the_recipe(self, token_d, token_e, user_d):
        recipe_id = next(i["id"] for i in requests.get(f"{API}/recipes/mine", headers=h(token_d), timeout=30).json() if i["title"] == "TEST_Classement_Recette")
        before = requests.get(f"{API}/leaderboard/creators", params={"period": "all"}, headers=h(token_d), timeout=30).json()["my_rank"]["score"]
        r = requests.post(f"{API}/recipes/{recipe_id}/like", headers=h(token_e), timeout=30)
        assert r.status_code == 200
        after = requests.get(f"{API}/leaderboard/creators", params={"period": "all"}, headers=h(token_d), timeout=30).json()["my_rank"]["score"]
        assert after == before + 3  # POINTS_LIKE_RECEIVED

        recipes = requests.get(f"{API}/leaderboard/recipes", params={"period": "all"}, headers=h(token_d), timeout=30).json()["items"]
        item = next(i for i in recipes if i["id"] == recipe_id)
        assert item["like_count"] == 1
        assert item["author_id"] == user_d

    def test_04_comment_scores_points(self, token_d, token_e, user_d):
        recipe_id = next(i["id"] for i in requests.get(f"{API}/recipes/mine", headers=h(token_d), timeout=30).json() if i["title"] == "TEST_Classement_Recette")
        before = requests.get(f"{API}/leaderboard/creators", params={"period": "all"}, headers=h(token_d), timeout=30).json()["my_rank"]["score"]
        r = requests.post(f"{API}/recipes/{recipe_id}/comments", json={"content": "Superbe !"}, headers=h(token_e), timeout=30)
        assert r.status_code == 200, r.text
        after = requests.get(f"{API}/leaderboard/creators", params={"period": "all"}, headers=h(token_d), timeout=30).json()["my_rank"]["score"]
        assert after == before + 5  # POINTS_COMMENT_RECEIVED

    def test_05_new_follower_scores_points(self, token_d, token_e, user_d):
        before = requests.get(f"{API}/leaderboard/creators", params={"period": "all"}, headers=h(token_d), timeout=30).json()["my_rank"]["score"]
        r = requests.post(f"{API}/users/{user_d}/follow", headers=h(token_e), timeout=30)
        assert r.status_code == 200
        after = requests.get(f"{API}/leaderboard/creators", params={"period": "all"}, headers=h(token_d), timeout=30).json()["my_rank"]["score"]
        assert after == before + 8  # POINTS_NEW_FOLLOWER

    def test_06_following_flag_stamped_on_creator_rows(self, token_e, user_d):
        # E follows D (previous test) - D's row in the leaderboard, seen by
        # E, must reflect that.
        data = requests.get(f"{API}/leaderboard/creators", params={"period": "all"}, headers=h(token_e), timeout=30).json()
        row = next((u for u in data["top"] if u["user_id"] == user_d), None)
        assert row is not None
        assert row["following"] is True
        requests.post(f"{API}/users/{user_d}/follow", headers=h(token_e), timeout=30)  # unfollow, clean state

    def test_07_creation_published_and_liked(self, token_d, token_e, user_d):
        img = requests.post(f"{API}/upload", files={"file": ("photo.jpg", _jpeg(), "image/jpeg")}, headers=h(token_d), timeout=30).json()["path"]
        r = requests.post(
            f"{API}/creations",
            json={"title": "TEST_Classement_Creation", "category": "Pain", "photos": [img]},
            headers=h(token_d), timeout=30,
        )
        assert r.status_code == 200, r.text
        creation_id = r.json()["id"]
        requests.post(f"{API}/creations/{creation_id}/like", headers=h(token_e), timeout=30)

        creations = requests.get(f"{API}/leaderboard/creations", params={"period": "all"}, headers=h(token_d), timeout=30).json()["items"]
        item = next(i for i in creations if i["id"] == creation_id)
        assert item["like_count"] == 1
        assert item["user_id"] == user_d

    def test_08_deleting_a_creation_removes_it_from_the_leaderboard(self, token_d):
        creation_id = next(i["id"] for i in requests.get(f"{API}/creations/mine", headers=h(token_d), timeout=30).json() if i["title"] == "TEST_Classement_Creation")
        r = requests.delete(f"{API}/creations/{creation_id}", headers=h(token_d), timeout=30)
        assert r.status_code == 200
        creations = requests.get(f"{API}/leaderboard/creations", params={"period": "all"}, headers=h(token_d), timeout=30).json()["items"]
        assert not any(i["id"] == creation_id for i in creations)
