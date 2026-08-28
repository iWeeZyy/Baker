"""Tests des notifications minimales : nouvel abonné, nouvelle recette,
nouvelle création — générées uniquement pour les abonnés ayant le réglage
correspondant activé (jamais à tout le monde), plus GET/POST de lecture.

Comme test_follows_api.py/test_feed_api.py, toute mutation d'un même état
partagé reste dans une seule classe séquentielle sous `-n 2
--dist loadscope`.
"""
import os

import pytest
import requests

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


def _recipe_payload(title):
    return {
        "title": title, "category": "Pains", "difficulty": "Facile", "time_minutes": 60,
        "hydration": 65, "description": "Test notif", "ingredients": ["500 g farine", "300 g eau"],
        "steps": ["Etape 1", "Etape 2"],
    }


@pytest.fixture(scope="module")
def auth_f():
    return _login_or_register("test.notif.f@bakers.app", "TestNotifF2026!", "Chef Notif F")


@pytest.fixture(scope="module")
def auth_g():
    return _login_or_register("test.notif.g@bakers.app", "TestNotifG2026!", "Chef Notif G")


@pytest.fixture(scope="module")
def auth_h():
    return _login_or_register("test.notif.h@bakers.app", "TestNotifH2026!", "Chef Notif H")


@pytest.fixture(scope="module")
def token_f(auth_f):
    return auth_f["token"]


@pytest.fixture(scope="module")
def token_g(auth_g):
    return auth_g["token"]


@pytest.fixture(scope="module")
def token_h(auth_h):
    return auth_h["token"]


@pytest.fixture(scope="module")
def user_f(auth_f):
    return auth_f["user"]["user_id"]


@pytest.fixture(scope="module")
def user_g(auth_g):
    return auth_g["user"]["user_id"]


def _unread_count(token):
    return requests.get(f"{API}/notifications/unread-count", headers=h(token), timeout=30).json()["count"]


def _latest(token, ntype=None):
    docs = requests.get(f"{API}/notifications", headers=h(token), timeout=30).json()["notifications"]
    if ntype:
        docs = [d for d in docs if d["type"] == ntype]
    return docs[0] if docs else None


class TestIndependentChecks:
    def test_list_requires_auth(self):
        r = requests.get(f"{API}/notifications", timeout=30)
        assert r.status_code in (401, 403)

    def test_unread_count_requires_auth(self):
        r = requests.get(f"{API}/notifications/unread-count", timeout=30)
        assert r.status_code in (401, 403)

    def test_mark_read_requires_auth(self):
        r = requests.post(f"{API}/notifications/does-not-exist/read", timeout=30)
        assert r.status_code in (401, 403)

    def test_mark_read_unknown_id_is_a_harmless_noop(self, token_f):
        r = requests.post(f"{API}/notifications/does-not-exist/read", headers=h(token_f), timeout=30)
        assert r.status_code == 200

    def test_invalid_before_rejected(self, token_f):
        r = requests.get(f"{API}/notifications?before=not-a-date", headers=h(token_f), timeout=30)
        assert r.status_code == 400


class TestNotificationFlow:
    """G suit F. F publie. Vérifie les trois types de notification, le
    respect du réglage par type, et qu'un non-abonné (H) n'est jamais
    notifié."""

    def test_01_reset(self, token_f, token_g, user_f, user_g):
        prof = requests.get(f"{API}/users/{user_f}/profile", headers=h(token_g), timeout=30).json()
        if prof["following"]:
            requests.post(f"{API}/users/{user_f}/follow", headers=h(token_g), timeout=30)
        requests.post(f"{API}/notifications/read-all", headers=h(token_f), timeout=30)
        requests.post(f"{API}/notifications/read-all", headers=h(token_g), timeout=30)

    def test_02_follow_notifies_the_followee(self, token_f, token_g, user_f, user_g):
        before = _unread_count(token_f)
        r = requests.post(f"{API}/users/{user_f}/follow", headers=h(token_g), timeout=30)
        assert r.status_code == 200
        assert r.json()["following"] is True

        assert _unread_count(token_f) == before + 1
        notif = _latest(token_f, "new_follower")
        assert notif is not None
        assert notif["actor_id"] == user_g
        assert notif["actor_name"] == "Chef Notif G"
        assert notif["read"] is False

    def test_03_mark_single_notification_read(self, token_f):
        notif = _latest(token_f, "new_follower")
        before = _unread_count(token_f)
        r = requests.post(f"{API}/notifications/{notif['id']}/read", headers=h(token_f), timeout=30)
        assert r.status_code == 200
        assert _unread_count(token_f) == before - 1

        docs = requests.get(f"{API}/notifications", headers=h(token_f), timeout=30).json()["notifications"]
        marked = next(d for d in docs if d["id"] == notif["id"])
        assert marked["read"] is True

    def test_04_new_recipe_notifies_followers_with_setting_enabled(self, token_f, token_g, user_f):
        # Default notify_new_recipe is True — confirm it via GET /auth/me.
        me_g = requests.get(f"{API}/auth/me", headers=h(token_g), timeout=30).json()
        assert me_g["notify_new_recipe"] is True

        before = _unread_count(token_g)
        r = requests.post(f"{API}/recipes", json=_recipe_payload("TEST_Notif_Recette_1"), headers=h(token_f), timeout=30)
        assert r.status_code == 200
        recipe_id = r.json()["id"]

        assert _unread_count(token_g) == before + 1
        notif = _latest(token_g, "new_recipe")
        assert notif["actor_id"] == user_f
        assert notif["target_id"] == recipe_id

    def test_05_disabling_setting_stops_that_type_only(self, token_f, token_g):
        r = requests.put(f"{API}/auth/me", json={"notify_new_recipe": False}, headers=h(token_g), timeout=30)
        assert r.status_code == 200
        assert r.json()["notify_new_recipe"] is False

        before = _unread_count(token_g)
        r = requests.post(f"{API}/recipes", json=_recipe_payload("TEST_Notif_Recette_2"), headers=h(token_f), timeout=30)
        assert r.status_code == 200
        assert _unread_count(token_g) == before  # no new notification: setting disabled

        # Restore for subsequent tests / other runs.
        requests.put(f"{API}/auth/me", json={"notify_new_recipe": True}, headers=h(token_g), timeout=30)

    def test_06_new_creation_notifies_followers(self, token_f, token_g, user_f):
        before = _unread_count(token_g)
        r = requests.post(
            f"{API}/creations",
            json={"title": "TEST_Notif_Creation", "category": "Pain", "photos": ["fake/path.jpg"]},
            headers=h(token_f), timeout=30,
        )
        assert r.status_code == 200, r.text
        creation_id = r.json()["id"]

        assert _unread_count(token_g) == before + 1
        notif = _latest(token_g, "new_creation")
        assert notif["actor_id"] == user_f
        assert notif["target_id"] == creation_id

    def test_07_non_follower_never_notified(self, token_f, token_h):
        before = _unread_count(token_h)
        requests.post(f"{API}/recipes", json=_recipe_payload("TEST_Notif_Recette_NonSuivi"), headers=h(token_f), timeout=30)
        assert _unread_count(token_h) == before

    def test_08_mark_all_read(self, token_g):
        assert _unread_count(token_g) > 0
        r = requests.post(f"{API}/notifications/read-all", headers=h(token_g), timeout=30)
        assert r.status_code == 200
        assert _unread_count(token_g) == 0

    def test_09_cleanup(self, token_f, token_g, user_f):
        requests.post(f"{API}/users/{user_f}/follow", headers=h(token_g), timeout=30)  # unfollow
