"""Tests d'« Abonnements » (Follow) : relation asymétrique et instantanée
(sans demande/acceptation, contrairement à Amis/Team) — POST
/users/{id}/follow (toggle), GET /users/{id}/followers, GET
/users/{id}/following, et les extensions de /users/search et
/users/{id}/profile dont elle dépend.

Suit le style de test_team_api.py : trois comptes de module (A, B, C)
enregistrés une fois. Contrairement à test_team_api.py, TOUTES les
mutations de relation (suivre/ne plus suivre) vivent dans une seule classe
séquentielle (`TestFollowFlow`) : sous `-n 2 --dist loadscope`, deux
classes différentes du même module peuvent s'exécuter en parallèle sur des
workers distincts, et cette suite manipule un jeu de comptes trop restreint
(A/B/C) pour que deux classes touchant la même paire ne se percutent pas.
Seuls les tests réellement indépendants (aucune mutation, aucun état
partagé) restent dans des classes séparées.
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL_A = "test.follow.a@bakers.app"
TEST_PASS_A = "TestFollowA2026!"
TEST_NAME_A = "Chef Follow A"

TEST_EMAIL_B = "test.follow.b@bakers.app"
TEST_PASS_B = "TestFollowB2026!"
TEST_NAME_B = "Chef Follow B"

TEST_EMAIL_C = "test.follow.c@bakers.app"
TEST_PASS_C = "TestFollowC2026!"
TEST_NAME_C = "Chef Follow C"


def _login_or_register(email, password, name):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code == 200:
        return r.json()
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": password, "name": name}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def auth_a():
    return _login_or_register(TEST_EMAIL_A, TEST_PASS_A, TEST_NAME_A)


@pytest.fixture(scope="module")
def auth_b():
    return _login_or_register(TEST_EMAIL_B, TEST_PASS_B, TEST_NAME_B)


@pytest.fixture(scope="module")
def auth_c():
    return _login_or_register(TEST_EMAIL_C, TEST_PASS_C, TEST_NAME_C)


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
def user_a(auth_a):
    return auth_a["user"]["user_id"]


@pytest.fixture(scope="module")
def user_b(auth_b):
    return auth_b["user"]["user_id"]


@pytest.fixture(scope="module")
def user_c(auth_c):
    return auth_c["user"]["user_id"]


def h(token):
    return {"Authorization": f"Bearer {token}"}


def _ensure_unfollowed(token, other_id):
    """Best-effort : si une relation résiduelle existe (run précédent), la
    retire pour que la classe reparte d'un état propre."""
    prof = requests.get(f"{API}/users/{other_id}/profile", headers=h(token), timeout=30).json()
    if prof["following"]:
        requests.post(f"{API}/users/{other_id}/follow", headers=h(token), timeout=30)


class TestIndependentChecks:
    """Aucune de ces vérifications ne mute ou ne dépend d'une relation
    A/B/C partagée — sûres à exécuter en parallèle avec TestFollowFlow."""

    def test_cannot_follow_self(self, token_a, user_a):
        r = requests.post(f"{API}/users/{user_a}/follow", headers=h(token_a), timeout=30)
        assert r.status_code == 400

    def test_follow_unknown_user_404s(self, token_a):
        r = requests.post(f"{API}/users/does-not-exist/follow", headers=h(token_a), timeout=30)
        assert r.status_code == 404

    def test_follow_requires_auth(self, user_b):
        r = requests.post(f"{API}/users/{user_b}/follow", timeout=30)
        assert r.status_code in (401, 403)

    def test_lists_require_auth(self, user_a):
        r = requests.get(f"{API}/users/{user_a}/followers", timeout=30)
        assert r.status_code in (401, 403)
        r = requests.get(f"{API}/users/{user_a}/following", timeout=30)
        assert r.status_code in (401, 403)

    def test_lists_unknown_user_404s(self, token_a):
        r = requests.get(f"{API}/users/does-not-exist/followers", headers=h(token_a), timeout=30)
        assert r.status_code == 404
        r = requests.get(f"{API}/users/does-not-exist/following", headers=h(token_a), timeout=30)
        assert r.status_code == 404

    def test_profile_requires_auth(self, user_a):
        r = requests.get(f"{API}/users/{user_a}/profile", timeout=30)
        assert r.status_code in (401, 403)

    def test_profile_reports_zero_counts_for_a_fresh_user(self, token_a):
        fresh = _login_or_register("test.follow.fresh@bakers.app", "TestFollowFresh2026!", "Chef Follow Fresh")
        r = requests.get(f"{API}/users/{fresh['user']['user_id']}/profile", headers=h(token_a), timeout=30)
        data = r.json()
        assert data["follower_count"] == 0
        assert data["following_count"] == 0
        assert data["following"] is False
        assert data["comment_count"] == 0

    def test_pagination_shape_with_limit(self, token_a, user_a):
        r = requests.get(f"{API}/users/{user_a}/followers?limit=1", headers=h(token_a), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data["users"]) <= 1
        assert "has_more" in data and "count" in data


class TestFollowFlow:
    """Vie complète d'une relation A -> B (recherche, toggle, compteurs,
    listes), puis réciprocité/indépendance via B -> C, et enfin la
    vérification de permission — toutes séquentielles dans une seule classe
    pour rester sûres sous `-n 2 --dist loadscope`."""

    def test_00_reset(self, token_a, token_b, token_c, user_a, user_b, user_c):
        _ensure_unfollowed(token_a, user_b)
        _ensure_unfollowed(token_b, user_c)
        _ensure_unfollowed(token_a, user_c)

    def test_01_search_default_not_following(self, token_a, user_b):
        r = requests.get(f"{API}/users/search?q=Chef Follow B", headers=h(token_a), timeout=30)
        assert r.status_code == 200
        row = next(u for u in r.json() if u["user_id"] == user_b)
        assert row["following"] is False

    def test_02_follow_creates_relation_and_increments_counts(self, token_a, token_b, user_a, user_b):
        r = requests.post(f"{API}/users/{user_b}/follow", headers=h(token_a), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["following"] is True
        assert body["follower_count"] == 1

        prof_b = requests.get(f"{API}/users/{user_b}/profile", headers=h(token_a), timeout=30).json()
        assert prof_b["following"] is True
        assert prof_b["follower_count"] == 1

        prof_a = requests.get(f"{API}/users/{user_a}/profile", headers=h(token_b), timeout=30).json()
        assert prof_a["following_count"] == 1

    def test_03_search_reflects_follow(self, token_a, user_b):
        r = requests.get(f"{API}/users/search?q=Chef Follow B", headers=h(token_a), timeout=30)
        row = next(u for u in r.json() if u["user_id"] == user_b)
        assert row["following"] is True

    def test_04_lists_reflect_relation(self, token_a, token_b, user_a, user_b):
        r = requests.get(f"{API}/users/{user_b}/followers", headers=h(token_b), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert any(u["user_id"] == user_a for u in data["users"])
        assert data["count"] == 1

        r = requests.get(f"{API}/users/{user_a}/following", headers=h(token_a), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert any(u["user_id"] == user_b for u in data["users"])
        assert data["count"] == 1

    def test_05_reciprocity_is_not_automatic(self, token_a, token_b, user_a):
        # A follows B (from test_02) must not make B follow A.
        prof_a_seen_by_b = requests.get(f"{API}/users/{user_a}/profile", headers=h(token_b), timeout=30).json()
        assert prof_a_seen_by_b["following"] is False

    def test_06_chain_does_not_propagate(self, token_a, token_b, token_c, user_a, user_c):
        # A follows B (test_02). B now follows C too. A must not automatically follow C.
        r = requests.post(f"{API}/users/{user_c}/follow", headers=h(token_b), timeout=30)
        assert r.status_code == 200
        assert r.json()["following"] is True

        prof_c_seen_by_a = requests.get(f"{API}/users/{user_c}/profile", headers=h(token_a), timeout=30).json()
        assert prof_c_seen_by_a["following"] is False

    def test_07_following_row_reflects_viewer_not_owner(self, token_a, token_c, user_b, user_c):
        # B's followers list (just A) viewed by C: C doesn't follow A, so
        # A's row must show following: false — independent of B's own
        # relations, which is exactly what the "following" field on a list
        # row means (does the *viewer* follow this person).
        r = requests.get(f"{API}/users/{user_b}/followers", headers=h(token_c), timeout=30)
        row = next(u for u in r.json()["users"])
        assert row["following"] is False

    def test_08_follow_is_always_scoped_to_caller(self, token_a, token_c, user_a, user_b):
        # C follows/unfollows B twice — must never affect A's own relation to B.
        requests.post(f"{API}/users/{user_b}/follow", headers=h(token_c), timeout=30)
        requests.post(f"{API}/users/{user_b}/follow", headers=h(token_c), timeout=30)
        prof_b_seen_by_a = requests.get(f"{API}/users/{user_b}/profile", headers=h(token_a), timeout=30).json()
        assert prof_b_seen_by_a["following"] is True

    def test_09_toggle_again_unfollows(self, token_a, user_b):
        r = requests.post(f"{API}/users/{user_b}/follow", headers=h(token_a), timeout=30)
        assert r.status_code == 200
        assert r.json()["following"] is False

        prof_b = requests.get(f"{API}/users/{user_b}/profile", headers=h(token_a), timeout=30).json()
        assert prof_b["following"] is False
        assert prof_b["follower_count"] == 0

    def test_10_cleanup(self, token_b, user_c):
        _ensure_unfollowed(token_b, user_c)
