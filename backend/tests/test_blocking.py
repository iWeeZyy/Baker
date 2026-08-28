"""Tests du blocage : POST /users/{id}/block (toggle), effet sur la
messagerie, sur les demandes d'amis, sur les invitations Team, et sur un
abonnement existant. Aucun historique de message n'est jamais supprimé par
un blocage — seul l'accès (envoi/lecture) est refusé, exactement comme la
désamitié le fait déjà pour la messagerie.

Comme test_follows_api.py, toute mutation d'un même état partagé reste
dans une seule classe séquentielle sous `-n 2 --dist loadscope` — deux
comptes de module (A, B), jamais partagés avec un autre fichier.
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL_A = "test.block.a@bakers.app"
TEST_PASS_A = "TestBlockA2026!"
TEST_NAME_A = "Chef Block A"

TEST_EMAIL_B = "test.block.b@bakers.app"
TEST_PASS_B = "TestBlockB2026!"
TEST_NAME_B = "Chef Block B"


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


class TestBlockingFlow:
    def test_cannot_block_self(self, auth_a):
        r = requests.post(f"{API}/users/{auth_a['user']['user_id']}/block", headers=h(auth_a["token"]), timeout=30)
        assert r.status_code == 400

    def test_setup_b_follows_a_then_they_can_message(self, auth_a, auth_b):
        # /follow is a toggle: re-running this suite against a persistent
        # server could flip an already-following B to unfollowed — check
        # the actual resulting state rather than assuming the call always
        # lands on "following".
        follow = requests.post(f"{API}/users/{auth_a['user']['user_id']}/follow", headers=h(auth_b["token"]), timeout=30)
        assert follow.status_code == 200
        if not follow.json()["following"]:
            follow = requests.post(f"{API}/users/{auth_a['user']['user_id']}/follow", headers=h(auth_b["token"]), timeout=30)
        assert follow.json()["following"] is True
        sent = requests.post(f"{API}/messages/{auth_a['user']['user_id']}", json={"content": "avant blocage"}, headers=h(auth_b["token"]), timeout=30)
        assert sent.status_code == 200, sent.text

    def test_block_toggle_is_idempotent(self, auth_a, auth_b):
        first = requests.post(f"{API}/users/{auth_b['user']['user_id']}/block", headers=h(auth_a["token"]), timeout=30)
        assert first.status_code == 200 and first.json()["blocked"] is True
        # Calling again toggles off, not an error and not a duplicate row.
        second = requests.post(f"{API}/users/{auth_b['user']['user_id']}/block", headers=h(auth_a["token"]), timeout=30)
        assert second.json()["blocked"] is False
        # Re-block for the rest of this class.
        third = requests.post(f"{API}/users/{auth_b['user']['user_id']}/block", headers=h(auth_a["token"]), timeout=30)
        assert third.json()["blocked"] is True

    def test_block_prevents_sending_both_directions(self, auth_a, auth_b):
        a_to_b = requests.post(f"{API}/messages/{auth_b['user']['user_id']}", json={"content": "x"}, headers=h(auth_a["token"]), timeout=30)
        assert a_to_b.status_code == 403
        b_to_a = requests.post(f"{API}/messages/{auth_a['user']['user_id']}", json={"content": "y"}, headers=h(auth_b["token"]), timeout=30)
        assert b_to_a.status_code == 403

    def test_block_does_not_delete_existing_history(self, auth_a, auth_b):
        # Blocking earlier removed B's follow of A, so unblocking alone
        # doesn't restore eligibility to READ (by design, reading is gated
        # the same way as sending) — re-establish it, then confirm the
        # message from before the block is still there: the block only
        # ever gated access, it never deleted anything.
        unblock = requests.post(f"{API}/users/{auth_b['user']['user_id']}/block", headers=h(auth_a["token"]), timeout=30)
        assert unblock.json()["blocked"] is False
        requests.post(f"{API}/users/{auth_a['user']['user_id']}/follow", headers=h(auth_b["token"]), timeout=30)
        history = requests.get(f"{API}/messages/{auth_b['user']['user_id']}", headers=h(auth_a["token"]), timeout=30)
        assert history.status_code == 200
        assert any(m["content"] == "avant blocage" for m in history.json()["messages"])
        # Re-block so the remaining tests in this class see a blocked state
        # (this also removes the follow just recreated above, as expected).
        requests.post(f"{API}/users/{auth_b['user']['user_id']}/block", headers=h(auth_a["token"]), timeout=30)

    def test_blocked_user_cannot_send_friend_request(self, auth_a, auth_b):
        r = requests.post(f"{API}/friends/request", json={"user_id": auth_a["user"]["user_id"]}, headers=h(auth_b["token"]), timeout=30)
        assert r.status_code == 403

    def test_blocked_user_cannot_send_team_invite(self, auth_a, auth_b):
        r = requests.post(f"{API}/team/invite", json={"user_id": auth_a["user"]["user_id"]}, headers=h(auth_b["token"]), timeout=30)
        assert r.status_code == 403

    def test_block_removed_existing_follow_relationship(self, auth_a, auth_b):
        followers = requests.get(f"{API}/users/{auth_a['user']['user_id']}/followers", headers=h(auth_a["token"]), timeout=30).json()
        assert not any(u["user_id"] == auth_b["user"]["user_id"] for u in followers["users"])

    def test_blocked_user_cannot_follow_again(self, auth_a, auth_b):
        r = requests.post(f"{API}/users/{auth_a['user']['user_id']}/follow", headers=h(auth_b["token"]), timeout=30)
        assert r.status_code == 403

    def test_unblock_restores_messaging_if_still_eligible(self, auth_a, auth_b):
        requests.post(f"{API}/users/{auth_b['user']['user_id']}/block", headers=h(auth_a["token"]), timeout=30)  # -> unblocked
        # No follow/friendship remains (block removed it), so default
        # friends_and_followers privacy denies messaging again until a new
        # relationship is created — confirms unblock alone doesn't
        # resurrect a relationship it already deleted.
        r = requests.post(f"{API}/messages/{auth_a['user']['user_id']}", json={"content": "z"}, headers=h(auth_b["token"]), timeout=30)
        assert r.status_code == 403
        # Following again now succeeds (no longer blocked) and restores messaging.
        follow = requests.post(f"{API}/users/{auth_a['user']['user_id']}/follow", headers=h(auth_b["token"]), timeout=30)
        assert follow.status_code == 200 and follow.json()["following"] is True
        r2 = requests.post(f"{API}/messages/{auth_a['user']['user_id']}", json={"content": "de nouveau"}, headers=h(auth_b["token"]), timeout=30)
        assert r2.status_code == 200, r2.text


class TestNonRegression:
    def test_block_requires_auth(self):
        r = requests.post(f"{API}/users/user_doesnotexist/block", timeout=30)
        assert r.status_code == 401

    def test_block_unknown_user_404s(self, auth_a):
        r = requests.post(f"{API}/users/user_doesnotexist/block", headers=h(auth_a["token"]), timeout=30)
        assert r.status_code == 404
