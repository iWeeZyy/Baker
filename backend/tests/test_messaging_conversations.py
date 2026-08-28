"""Tests de la Messagerie : éligibilité élargie (ami OU abonné, réglage
`message_privacy`), GET /conversations (liste dédiée, distincte de
GET /friends), masquage non destructif d'une conversation, et le compteur
combiné GET /messagerie/badge-count.

Comme test_follows_api.py/test_notifications_api.py, toute mutation d'un
même état partagé (suivre/écrire/masquer) reste dans une seule classe
séquentielle sous `-n 2 --dist loadscope` — trois comptes de module
(A, B, C) enregistrés une fois, jamais partagés avec un autre fichier.
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL_A = "test.msgconv.a@bakers.app"
TEST_PASS_A = "TestMsgConvA2026!"
TEST_NAME_A = "Chef MsgConv A"

TEST_EMAIL_B = "test.msgconv.b@bakers.app"
TEST_PASS_B = "TestMsgConvB2026!"
TEST_NAME_B = "Chef MsgConv B"

TEST_EMAIL_C = "test.msgconv.c@bakers.app"
TEST_PASS_C = "TestMsgConvC2026!"
TEST_NAME_C = "Chef MsgConv C"


def _login_or_register(email, password, name):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code == 200:
        return r.json()
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": password, "name": name}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def auth_a():
    return _login_or_register(TEST_EMAIL_A, TEST_PASS_A, TEST_NAME_A)


@pytest.fixture(scope="module")
def auth_b():
    return _login_or_register(TEST_EMAIL_B, TEST_PASS_B, TEST_NAME_B)


@pytest.fixture(scope="module")
def auth_c():
    return _login_or_register(TEST_EMAIL_C, TEST_PASS_C, TEST_NAME_C)


class TestConversationsFlow:
    """Séquentiel : B suit A, A et B échangent, C reste étranger."""

    def test_default_message_privacy_on_register_and_me(self, auth_a):
        assert auth_a["user"]["message_privacy"] == "friends_and_followers"
        me = requests.get(f"{API}/auth/me", headers=h(auth_a["token"]), timeout=30).json()
        assert me["message_privacy"] == "friends_and_followers"

    def test_message_privacy_round_trips_through_update(self, auth_a):
        upd = requests.put(f"{API}/auth/me", json={"message_privacy": "friends_only"}, headers=h(auth_a["token"]), timeout=30)
        assert upd.status_code == 200, upd.text
        assert upd.json()["message_privacy"] == "friends_only"
        me = requests.get(f"{API}/auth/me", headers=h(auth_a["token"]), timeout=30).json()
        assert me["message_privacy"] == "friends_only"
        # login also echoes it
        login = requests.post(f"{API}/auth/login", json={"email": TEST_EMAIL_A, "password": TEST_PASS_A}, timeout=30).json()
        assert login["user"]["message_privacy"] == "friends_only"
        # Reset to the default the rest of this class relies on.
        reset = requests.put(f"{API}/auth/me", json={"message_privacy": "friends_and_followers"}, headers=h(auth_a["token"]), timeout=30)
        assert reset.json()["message_privacy"] == "friends_and_followers"

    def test_invalid_message_privacy_rejected(self, auth_a):
        r = requests.put(f"{API}/auth/me", json={"message_privacy": "nope"}, headers=h(auth_a["token"]), timeout=30)
        assert r.status_code == 422

    def test_stranger_cannot_message_stranger(self, auth_a, auth_c):
        r = requests.post(f"{API}/messages/{auth_a['user']['user_id']}", json={"content": "salut"}, headers=h(auth_c["token"]), timeout=30)
        assert r.status_code == 403
        r2 = requests.get(f"{API}/messages/{auth_a['user']['user_id']}", headers=h(auth_c["token"]), timeout=30)
        assert r2.status_code == 403

    def test_follower_can_message_followee_without_friendship(self, auth_a, auth_b):
        # /follow is a toggle: rerunning this suite against a persistent
        # server could flip an already-following B to unfollowed — check
        # the actual resulting state rather than assuming the call always
        # lands on "following".
        follow = requests.post(f"{API}/users/{auth_a['user']['user_id']}/follow", headers=h(auth_b["token"]), timeout=30)
        assert follow.status_code == 200
        if not follow.json()["following"]:
            follow = requests.post(f"{API}/users/{auth_a['user']['user_id']}/follow", headers=h(auth_b["token"]), timeout=30)
        assert follow.json()["following"] is True
        sent = requests.post(f"{API}/messages/{auth_a['user']['user_id']}", json={"content": "Ton pain a l'air top !"}, headers=h(auth_b["token"]), timeout=30)
        assert sent.status_code == 200, sent.text

    def test_conversation_appears_only_after_a_message_exists(self, auth_a, auth_c):
        # C has never messaged nor been messaged by A -> no conversation row.
        convos = requests.get(f"{API}/conversations", headers=h(auth_a["token"]), timeout=30).json()["conversations"]
        assert not any(c["peer"]["user_id"] == auth_c["user"]["user_id"] for c in convos)

    def test_conversations_list_shows_peer_last_message_and_unread(self, auth_a, auth_b):
        convos = requests.get(f"{API}/conversations", headers=h(auth_a["token"]), timeout=30).json()["conversations"]
        row = next((c for c in convos if c["peer"]["user_id"] == auth_b["user"]["user_id"]), None)
        assert row is not None, convos
        assert row["last_message"]["from_me"] is False
        assert row["unread"] >= 1

    def test_badge_count_reflects_unread_conversations_and_activity(self, auth_a):
        # Must run before any GET /messages/{b} call (which marks messages
        # read as a side effect) — otherwise the unread this test checks
        # for would already have been consumed by an earlier read.
        bc = requests.get(f"{API}/messagerie/badge-count", headers=h(auth_a["token"]), timeout=30)
        assert bc.status_code == 200
        body = bc.json()
        assert "conversations_unread" in body and "activity_unread" in body
        assert body["conversations_unread"] >= 1

    def test_followee_cannot_reply_without_following_back(self, auth_a, auth_b):
        # A is not a friend of B and does not follow B back -> cannot send,
        # but CAN read the conversation (reverse eligibility already holds).
        # Reading here also marks the pending message read as a side effect
        # (existing GET /messages/{id} behavior) — later tests account for it.
        blocked = requests.post(f"{API}/messages/{auth_b['user']['user_id']}", json={"content": "merci !"}, headers=h(auth_a["token"]), timeout=30)
        assert blocked.status_code == 403
        read = requests.get(f"{API}/messages/{auth_b['user']['user_id']}", headers=h(auth_a["token"]), timeout=30)
        assert read.status_code == 200
        assert len(read.json()["messages"]) >= 1

    def test_reading_marks_conversation_read_and_badge_drops(self, auth_a, auth_b):
        # A fresh unread message is needed here since the previous test
        # already consumed the earlier one via its own read side effect.
        requests.post(f"{API}/messages/{auth_a['user']['user_id']}", json={"content": "une autre !"}, headers=h(auth_b["token"]), timeout=30)
        before = requests.get(f"{API}/messagerie/badge-count", headers=h(auth_a["token"]), timeout=30).json()
        assert before["conversations_unread"] >= 1
        requests.get(f"{API}/messages/{auth_b['user']['user_id']}", headers=h(auth_a["token"]), timeout=30)
        after = requests.get(f"{API}/messagerie/badge-count", headers=h(auth_a["token"]), timeout=30).json()
        assert after["conversations_unread"] < before["conversations_unread"]
        convos = requests.get(f"{API}/conversations", headers=h(auth_a["token"]), timeout=30).json()["conversations"]
        row = next(c for c in convos if c["peer"]["user_id"] == auth_b["user"]["user_id"])
        assert row["unread"] == 0

    def test_hide_then_reappear_after_new_message(self, auth_a, auth_b):
        hide = requests.post(f"{API}/conversations/{auth_b['user']['user_id']}/hide", headers=h(auth_a["token"]), timeout=30)
        assert hide.status_code == 200
        convos = requests.get(f"{API}/conversations", headers=h(auth_a["token"]), timeout=30).json()["conversations"]
        assert not any(c["peer"]["user_id"] == auth_b["user"]["user_id"] for c in convos)

        # A new message from B un-hides it again.
        requests.post(f"{API}/messages/{auth_a['user']['user_id']}", json={"content": "encore la !"}, headers=h(auth_b["token"]), timeout=30)
        convos = requests.get(f"{API}/conversations", headers=h(auth_a["token"]), timeout=30).json()["conversations"]
        assert any(c["peer"]["user_id"] == auth_b["user"]["user_id"] for c in convos)

    def test_conversations_pagination_cursor(self, auth_a, auth_b):
        first_page = requests.get(f"{API}/conversations", params={"limit": 1}, headers=h(auth_a["token"]), timeout=30).json()
        assert len(first_page["conversations"]) <= 1

    def test_can_message_field_on_public_profile(self, auth_a, auth_b, auth_c):
        # B can message A (follows A) -> can_message true from B's viewpoint.
        prof = requests.get(f"{API}/users/{auth_a['user']['user_id']}/profile", headers=h(auth_b["token"]), timeout=30).json()
        assert prof["can_message"] is True
        # C is a stranger to A -> false.
        prof_c = requests.get(f"{API}/users/{auth_a['user']['user_id']}/profile", headers=h(auth_c["token"]), timeout=30).json()
        assert prof_c["can_message"] is False


class TestNonRegression:
    """N'a besoin d'aucune mutation partagée — peut s'exécuter en parallèle
    de TestConversationsFlow sur un autre worker."""

    def test_message_send_requires_auth(self):
        r = requests.post(f"{API}/messages/user_doesnotexist", json={"content": "hi"}, timeout=30)
        assert r.status_code == 401

    def test_conversations_requires_auth(self):
        r = requests.get(f"{API}/conversations", timeout=30)
        assert r.status_code == 401

    def test_badge_count_requires_auth(self):
        r = requests.get(f"{API}/messagerie/badge-count", timeout=30)
        assert r.status_code == 401
