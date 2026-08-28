"""Tests des 5 nouveaux types d'activité sociale ajoutés par la Messagerie :
new_friend_request, friend_request_accepted, new_comment, new_comment_reply,
new_like (regroupé). Les 3 types déjà existants (new_follower, new_recipe,
new_creation) sont couverts par test_notifications_api.py et restent
inchangés — ce fichier ne teste que l'extension.

Comme les autres suites de relations, toute mutation d'un même état
partagé reste dans une seule classe séquentielle sous `-n 2
--dist loadscope` — comptes de module dédiés, jamais partagés ailleurs.
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL_A = "test.activity.a@bakers.app"
TEST_PASS_A = "TestActivityA2026!"
TEST_NAME_A = "Chef Activity A"

TEST_EMAIL_B = "test.activity.b@bakers.app"
TEST_PASS_B = "TestActivityB2026!"
TEST_NAME_B = "Chef Activity B"

TEST_EMAIL_C = "test.activity.c@bakers.app"
TEST_PASS_C = "TestActivityC2026!"
TEST_NAME_C = "Chef Activity C"


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
        "hydration": 65, "description": "Test activité", "ingredients": ["500 g farine", "300 g eau"],
        "steps": ["Etape 1", "Etape 2"],
    }


@pytest.fixture(scope="module")
def auth_a():
    return _login_or_register(TEST_EMAIL_A, TEST_PASS_A, TEST_NAME_A)


@pytest.fixture(scope="module")
def auth_b():
    return _login_or_register(TEST_EMAIL_B, TEST_PASS_B, TEST_NAME_B)


@pytest.fixture(scope="module")
def auth_c():
    return _login_or_register(TEST_EMAIL_C, TEST_PASS_C, TEST_NAME_C)


def _notif_types(token):
    body = requests.get(f"{API}/notifications", headers=h(token), timeout=30).json()
    return body["notifications"]


class TestFriendRequestActivity:
    def test_new_friend_request_notifies_recipient(self, auth_a, auth_b):
        send = requests.post(f"{API}/friends/request", json={"user_id": auth_b["user"]["user_id"]}, headers=h(auth_a["token"]), timeout=30)
        assert send.status_code == 200
        if send.json()["status"] == "friends":
            pytest.skip("already friends from a previous run — nothing to assert")
        notifs = _notif_types(auth_b["token"])
        match = [n for n in notifs if n["type"] == "new_friend_request" and n["actor_id"] == auth_a["user"]["user_id"]]
        assert match, notifs

    def test_accepting_notifies_original_sender(self, auth_a, auth_b):
        reqs = requests.get(f"{API}/friends/requests", headers=h(auth_b["token"]), timeout=30).json()
        pending = next((r for r in reqs if r["from_user"]["user_id"] == auth_a["user"]["user_id"]), None)
        if pending is None:
            pytest.skip("already friends — no pending request left to accept")
        accept = requests.post(f"{API}/friends/requests/{pending['id']}/respond", json={"accept": True}, headers=h(auth_b["token"]), timeout=30)
        assert accept.status_code == 200
        notifs = _notif_types(auth_a["token"])
        match = [n for n in notifs if n["type"] == "friend_request_accepted" and n["actor_id"] == auth_b["user"]["user_id"]]
        assert match, notifs


class TestCommentActivity:
    def test_new_comment_notifies_recipe_owner_with_data(self, auth_a, auth_b):
        recipe = requests.post(f"{API}/recipes", json=_recipe_payload("TEST_Activity_Recipe"), headers=h(auth_a["token"]), timeout=30).json()
        comment = requests.post(
            f"{API}/recipes/{recipe['id']}/comments", json={"content": "Superbe pousse !"}, headers=h(auth_b["token"]), timeout=30,
        ).json()
        notifs = _notif_types(auth_a["token"])
        match = [n for n in notifs if n["type"] == "new_comment" and n["actor_id"] == auth_b["user"]["user_id"] and n.get("data", {}).get("comment_id") == comment["id"]]
        assert match, notifs
        assert match[0]["data"]["recipe_id"] == recipe["id"]

        # A commenting on their own recipe never notifies themselves.
        requests.post(f"{API}/recipes/{recipe['id']}/comments", json={"content": "Merci !"}, headers=h(auth_a["token"]), timeout=30)
        self_notifs = [n for n in _notif_types(auth_a["token"]) if n["type"] == "new_comment" and n["actor_id"] == auth_a["user"]["user_id"]]
        assert not self_notifs

    def test_reply_notifies_root_comment_author(self, auth_a, auth_b, auth_c):
        recipe = requests.post(f"{API}/recipes", json=_recipe_payload("TEST_Activity_Reply_Recipe"), headers=h(auth_a["token"]), timeout=30).json()
        root = requests.post(
            f"{API}/recipes/{recipe['id']}/comments", json={"content": "Question sur la levée"}, headers=h(auth_b["token"]), timeout=30,
        ).json()
        requests.post(
            f"{API}/recipes/{recipe['id']}/comments",
            json={"content": "Voici la réponse", "parent_id": root["id"], "reply_to_user_id": auth_b["user"]["user_id"]},
            headers=h(auth_c["token"]), timeout=30,
        )
        notifs = _notif_types(auth_b["token"])
        match = [n for n in notifs if n["type"] == "new_comment_reply" and n["actor_id"] == auth_c["user"]["user_id"]]
        assert match, notifs


class TestLikeActivity:
    def test_likes_are_grouped_into_one_notification(self, auth_a, auth_b, auth_c):
        recipe = requests.post(f"{API}/recipes", json=_recipe_payload("TEST_Activity_Like_Recipe"), headers=h(auth_a["token"]), timeout=30).json()
        requests.post(f"{API}/recipes/{recipe['id']}/like", headers=h(auth_b["token"]), timeout=30)
        requests.post(f"{API}/recipes/{recipe['id']}/like", headers=h(auth_c["token"]), timeout=30)
        notifs = [n for n in _notif_types(auth_a["token"]) if n["type"] == "new_like" and n["target_id"] == recipe["id"]]
        assert len(notifs) == 1, notifs
        assert notifs[0]["count"] == 2, notifs[0]

    def test_self_like_never_notifies(self, auth_a):
        recipe = requests.post(f"{API}/recipes", json=_recipe_payload("TEST_Activity_SelfLike_Recipe"), headers=h(auth_a["token"]), timeout=30).json()
        requests.post(f"{API}/recipes/{recipe['id']}/like", headers=h(auth_a["token"]), timeout=30)
        notifs = [n for n in _notif_types(auth_a["token"]) if n["type"] == "new_like" and n["target_id"] == recipe["id"]]
        assert not notifs

    def test_creation_like_notifies_owner(self, auth_a, auth_b):
        img = requests.post(
            f"{API}/upload",
            files={"file": ("photo.jpg", _tiny_jpeg(), "image/jpeg")},
            headers=h(auth_a["token"]), timeout=30,
        ).json()["path"]
        creation = requests.post(
            f"{API}/creations", json={"title": "TEST_Activity_Creation", "category": "Pain", "photos": [img]},
            headers=h(auth_a["token"]), timeout=30,
        ).json()
        requests.post(f"{API}/creations/{creation['id']}/like", headers=h(auth_b["token"]), timeout=30)
        notifs = [n for n in _notif_types(auth_a["token"]) if n["type"] == "new_like" and n["target_id"] == creation["id"]]
        assert notifs, _notif_types(auth_a["token"])
        assert notifs[0]["data"]["content_kind"] == "creation"


def _tiny_jpeg():
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (20, 20), (200, 150, 100)).save(buf, format="JPEG")
    buf.seek(0)
    return buf
