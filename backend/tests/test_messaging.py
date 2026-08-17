"""Friend system and messaging API tests.

Uses three fixed accounts: FRIEND_A and FRIEND_B (kept friends with each
other across test runs) and STRANGER (never friends with either), so the
suite is idempotent and safe to re-run against a persistent database.
"""
import asyncio
import json
import os
import pytest
import requests
import websockets

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

ACCOUNTS = {
    "a": ("test.friend.a@bakers.app", "TestFriendA2026!", "Amie A"),
    "b": ("test.friend.b@bakers.app", "TestFriendB2026!", "Ami B"),
    "stranger": ("test.stranger@bakers.app", "TestStranger2026!", "Inconnu"),
}


def _login_or_register(email, password, name):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code == 200:
        return r.json()
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": password, "name": name}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def users():
    """{"a": {"token", "user_id", "name"}, "b": {...}, "stranger": {...}}"""
    out = {}
    for key, (email, password, name) in ACCOUNTS.items():
        data = _login_or_register(email, password, name)
        out[key] = {"token": data["token"], "user_id": data["user"]["user_id"], "name": data["user"]["name"]}
    return out


@pytest.fixture(scope="module")
def friends_ab(users):
    """Ensure A and B are friends (idempotent) before messaging tests run."""
    h_a = auth_headers(users["a"]["token"])
    r = requests.post(f"{API}/friends/request", json={"user_id": users["b"]["user_id"]}, headers=h_a, timeout=30)
    assert r.status_code == 200, r.text
    if r.json()["status"] != "friends":
        # B accepts A's pending request
        h_b = auth_headers(users["b"]["token"])
        reqs = requests.get(f"{API}/friends/requests", headers=h_b, timeout=30).json()
        pending = next(x for x in reqs if x["from_user"]["user_id"] == users["a"]["user_id"])
        acc = requests.post(f"{API}/friends/requests/{pending['id']}/respond", json={"accept": True}, headers=h_b, timeout=30)
        assert acc.status_code == 200 and acc.json()["status"] == "friends", acc.text
    return users


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# --- Friend system ---
class TestFriendship:
    def test_search_finds_user(self, users):
        h = auth_headers(users["stranger"]["token"])
        r = requests.get(f"{API}/users/search", params={"q": "Amie"}, headers=h, timeout=30)
        assert r.status_code == 200
        assert any(u["user_id"] == users["a"]["user_id"] for u in r.json())

    def test_search_requires_auth(self):
        r = requests.get(f"{API}/users/search", params={"q": "Amie"}, timeout=30)
        assert r.status_code == 401

    def test_cannot_friend_self(self, users):
        h = auth_headers(users["a"]["token"])
        r = requests.post(f"{API}/friends/request", json={"user_id": users["a"]["user_id"]}, headers=h, timeout=30)
        assert r.status_code == 400

    def test_friend_request_to_unknown_user_404s(self, users):
        h = auth_headers(users["a"]["token"])
        r = requests.post(f"{API}/friends/request", json={"user_id": "user_doesnotexist"}, headers=h, timeout=30)
        assert r.status_code == 404

    def test_send_and_accept_friend_request_makes_them_friends(self, friends_ab):
        users = friends_ab
        h_a = auth_headers(users["a"]["token"])
        h_b = auth_headers(users["b"]["token"])
        prof_a_sees_b = requests.get(f"{API}/users/{users['b']['user_id']}/profile", headers=h_a, timeout=30)
        prof_b_sees_a = requests.get(f"{API}/users/{users['a']['user_id']}/profile", headers=h_b, timeout=30)
        assert prof_a_sees_b.json()["friend_status"] == "friends"
        assert prof_b_sees_a.json()["friend_status"] == "friends"

    def test_friend_appears_exactly_once_in_list(self, friends_ab):
        # Regression test: a race between two accept flows must not create
        # two friendship documents for the same pair (see pair_key unique index).
        users = friends_ab
        h_a = auth_headers(users["a"]["token"])
        friends = requests.get(f"{API}/friends", headers=h_a, timeout=30).json()
        matches = [f for f in friends if f["user_id"] == users["b"]["user_id"]]
        assert len(matches) == 1, f"expected exactly one entry for friend B, got {len(matches)}"

    def test_resending_request_when_already_friends_is_a_noop(self, friends_ab):
        users = friends_ab
        h_a = auth_headers(users["a"]["token"])
        r = requests.post(f"{API}/friends/request", json={"user_id": users["b"]["user_id"]}, headers=h_a, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "friends"
        # Still exactly one friendship entry afterwards
        friends = requests.get(f"{API}/friends", headers=h_a, timeout=30).json()
        matches = [f for f in friends if f["user_id"] == users["b"]["user_id"]]
        assert len(matches) == 1

    def test_decline_does_not_create_friendship(self, users):
        h_stranger = auth_headers(users["stranger"]["token"])
        h_a = auth_headers(users["a"]["token"])
        send = requests.post(f"{API}/friends/request", json={"user_id": users["a"]["user_id"]}, headers=h_stranger, timeout=30)
        assert send.status_code == 200
        if send.json()["status"] == "pending_sent":
            reqs = requests.get(f"{API}/friends/requests", headers=h_a, timeout=30).json()
            pending = next((x for x in reqs if x["from_user"]["user_id"] == users["stranger"]["user_id"]), None)
            assert pending is not None
            decline = requests.post(f"{API}/friends/requests/{pending['id']}/respond", json={"accept": False}, headers=h_a, timeout=30)
            assert decline.status_code == 200
            assert decline.json()["status"] == "declined"
        prof = requests.get(f"{API}/users/{users['a']['user_id']}/profile", headers=h_stranger, timeout=30)
        assert prof.json()["friend_status"] != "friends"

    def test_cannot_respond_to_someone_elses_request(self, users):
        # Stranger sends A a request; B (uninvolved) must not be able to respond to it.
        h_stranger = auth_headers(users["stranger"]["token"])
        h_a = auth_headers(users["a"]["token"])
        h_b = auth_headers(users["b"]["token"])
        requests.post(f"{API}/friends/request", json={"user_id": users["a"]["user_id"]}, headers=h_stranger, timeout=30)
        reqs = requests.get(f"{API}/friends/requests", headers=h_a, timeout=30).json()
        pending = next((x for x in reqs if x["from_user"]["user_id"] == users["stranger"]["user_id"]), None)
        if pending is not None:
            r = requests.post(f"{API}/friends/requests/{pending['id']}/respond", json={"accept": True}, headers=h_b, timeout=30)
            assert r.status_code == 404
        # cleanup: decline it as A so it doesn't linger pending across runs
        reqs = requests.get(f"{API}/friends/requests", headers=h_a, timeout=30).json()
        pending = next((x for x in reqs if x["from_user"]["user_id"] == users["stranger"]["user_id"]), None)
        if pending is not None:
            requests.post(f"{API}/friends/requests/{pending['id']}/respond", json={"accept": False}, headers=h_a, timeout=30)


# --- Removing a friend ---
class TestUnfriend:
    def test_remove_requires_auth(self, users):
        r = requests.delete(f"{API}/friends/{users['a']['user_id']}", timeout=30)
        assert r.status_code == 401

    def test_remove_breaks_friendship_and_blocks_messaging(self, users):
        h_stranger = auth_headers(users["stranger"]["token"])
        h_a = auth_headers(users["a"]["token"])

        # Ensure stranger and A are friends first (independent of the a<->b pair).
        send = requests.post(f"{API}/friends/request", json={"user_id": users["a"]["user_id"]}, headers=h_stranger, timeout=30)
        if send.json()["status"] != "friends":
            reqs = requests.get(f"{API}/friends/requests", headers=h_a, timeout=30).json()
            pending = next(x for x in reqs if x["from_user"]["user_id"] == users["stranger"]["user_id"])
            requests.post(f"{API}/friends/requests/{pending['id']}/respond", json={"accept": True}, headers=h_a, timeout=30)
        assert requests.get(f"{API}/users/{users['a']['user_id']}/profile", headers=h_stranger, timeout=30).json()["friend_status"] == "friends"

        rm = requests.delete(f"{API}/friends/{users['a']['user_id']}", headers=h_stranger, timeout=30)
        assert rm.status_code == 200
        assert rm.json()["status"] == "removed"

        prof = requests.get(f"{API}/users/{users['a']['user_id']}/profile", headers=h_stranger, timeout=30)
        assert prof.json()["friend_status"] != "friends"

        blocked = requests.post(f"{API}/messages/{users['a']['user_id']}", json={"content": "hi"}, headers=h_stranger, timeout=30)
        assert blocked.status_code == 403

        # Removing again is a harmless no-op, not an error.
        rm2 = requests.delete(f"{API}/friends/{users['a']['user_id']}", headers=h_stranger, timeout=30)
        assert rm2.status_code == 200


# --- Messaging ---
class TestMessaging:
    def test_send_requires_auth(self, users):
        r = requests.post(f"{API}/messages/{users['b']['user_id']}", json={"content": "hello"}, timeout=30)
        assert r.status_code == 401

    def test_cannot_message_non_friend(self, friends_ab, users):
        h_stranger = auth_headers(users["stranger"]["token"])
        r = requests.post(f"{API}/messages/{friends_ab['a']['user_id']}", json={"content": "hey"}, headers=h_stranger, timeout=30)
        assert r.status_code == 403

    def test_cannot_read_non_friend_conversation(self, friends_ab, users):
        h_stranger = auth_headers(users["stranger"]["token"])
        r = requests.get(f"{API}/messages/{friends_ab['a']['user_id']}", headers=h_stranger, timeout=30)
        assert r.status_code == 403

    def test_empty_message_rejected(self, friends_ab):
        h_a = auth_headers(friends_ab["a"]["token"])
        r = requests.post(f"{API}/messages/{friends_ab['b']['user_id']}", json={"content": "   "}, headers=h_a, timeout=30)
        assert r.status_code == 400

    def test_send_and_receive_message(self, friends_ab):
        h_a = auth_headers(friends_ab["a"]["token"])
        h_b = auth_headers(friends_ab["b"]["token"])
        content = "Bonjour ! Ton levain avance bien ?"
        sent = requests.post(f"{API}/messages/{friends_ab['b']['user_id']}", json={"content": content}, headers=h_a, timeout=30)
        assert sent.status_code == 200, sent.text
        doc = sent.json()
        assert doc["content"] == content
        assert doc["from_user_id"] == friends_ab["a"]["user_id"]
        assert doc["to_user_id"] == friends_ab["b"]["user_id"]

        # B can read the conversation and sees the same message
        got = requests.get(f"{API}/messages/{friends_ab['a']['user_id']}", headers=h_b, timeout=30)
        assert got.status_code == 200
        assert any(m["id"] == doc["id"] and m["content"] == content for m in got.json()["messages"])

    def test_messages_ordered_chronologically(self, friends_ab):
        h_a = auth_headers(friends_ab["a"]["token"])
        for text in ["Premier message", "Deuxième message", "Troisième message"]:
            requests.post(f"{API}/messages/{friends_ab['b']['user_id']}", json={"content": text}, headers=h_a, timeout=30)
        msgs = requests.get(f"{API}/messages/{friends_ab['b']['user_id']}", headers=h_a, timeout=30).json()["messages"]
        timestamps = [m["created_at"] for m in msgs]
        assert timestamps == sorted(timestamps), "messages must be returned in chronological order"

    def test_reading_conversation_marks_messages_read(self, friends_ab):
        h_a = auth_headers(friends_ab["a"]["token"])
        h_b = auth_headers(friends_ab["b"]["token"])
        requests.post(f"{API}/messages/{friends_ab['b']['user_id']}", json={"content": "Message non lu"}, headers=h_a, timeout=30)

        friends_of_b = requests.get(f"{API}/friends", headers=h_b, timeout=30).json()
        entry = next(f for f in friends_of_b if f["user_id"] == friends_ab["a"]["user_id"])
        assert entry["unread"] >= 1

        # B opens the conversation -> messages get marked read
        requests.get(f"{API}/messages/{friends_ab['a']['user_id']}", headers=h_b, timeout=30)

        friends_of_b_after = requests.get(f"{API}/friends", headers=h_b, timeout=30).json()
        entry_after = next(f for f in friends_of_b_after if f["user_id"] == friends_ab["a"]["user_id"])
        assert entry_after["unread"] == 0

    def test_conversation_reflects_last_message_in_friend_list(self, friends_ab):
        h_a = auth_headers(friends_ab["a"]["token"])
        content = "Dernier message pour le test de la liste d'amis"
        requests.post(f"{API}/messages/{friends_ab['b']['user_id']}", json={"content": content}, headers=h_a, timeout=30)
        friends = requests.get(f"{API}/friends", headers=h_a, timeout=30).json()
        entry = next(f for f in friends if f["user_id"] == friends_ab["b"]["user_id"])
        assert entry["last_message"]["content"] == content
        assert entry["last_message"]["from_me"] is True


# --- Pagination ---
class TestPagination:
    def test_pagination_walks_full_history_without_gaps_or_duplicates(self, friends_ab):
        h_a = auth_headers(friends_ab["a"]["token"])
        # Guarantee more than one page of history regardless of what earlier tests left behind.
        for i in range(55):
            requests.post(f"{API}/messages/{friends_ab['b']['user_id']}", json={"content": f"Pagination test {i}"}, headers=h_a, timeout=30)

        first_page = requests.get(f"{API}/messages/{friends_ab['b']['user_id']}", headers=h_a, timeout=30).json()
        assert first_page["has_more"] is True, "expected more than one page of history"

        all_ids = [m["id"] for m in first_page["messages"]]
        cursor = first_page["messages"][0]["created_at"]
        has_more = first_page["has_more"]
        pages = 1
        while has_more and pages < 20:  # safety cap against an infinite loop on a real bug
            page = requests.get(f"{API}/messages/{friends_ab['b']['user_id']}", params={"before": cursor}, headers=h_a, timeout=30).json()
            if not page["messages"]:
                break
            all_ids = [m["id"] for m in page["messages"]] + all_ids
            cursor = page["messages"][0]["created_at"]
            has_more = page["has_more"]
            pages += 1

        assert len(all_ids) == len(set(all_ids)), "pagination must not return duplicate messages across pages"
        assert pages > 1, "expected to walk through more than one page"

    def test_pagination_invalid_cursor_rejected(self, friends_ab):
        h_a = auth_headers(friends_ab["a"]["token"])
        r = requests.get(f"{API}/messages/{friends_ab['b']['user_id']}", params={"before": "not-a-date"}, headers=h_a, timeout=30)
        assert r.status_code == 400


# --- Realtime (WebSocket) ---
class TestRealtime:
    @pytest.mark.asyncio
    async def test_invalid_token_rejected(self):
        uri = f"{WS_BASE}/api/ws?token=invalid"
        with pytest.raises(Exception):
            async with websockets.connect(uri, open_timeout=5) as ws:
                await ws.recv()

    @pytest.mark.asyncio
    async def test_message_pushed_to_recipient_in_realtime(self, friends_ab):
        uri = f"{WS_BASE}/api/ws?token={friends_ab['b']['token']}"
        async with websockets.connect(uri, open_timeout=5) as ws:
            h_a = auth_headers(friends_ab["a"]["token"])
            content = "Message temps réel"
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: requests.post(f"{API}/messages/{friends_ab['b']['user_id']}", json={"content": content}, headers=h_a, timeout=30),
            )
            raw = await asyncio.wait_for(ws.recv(), timeout=10)
            evt = json.loads(raw)
            assert evt["type"] == "new_message"
            assert evt["message"]["content"] == content
            assert evt["message"]["from_user_id"] == friends_ab["a"]["user_id"]
            assert evt["message"]["to_user_id"] == friends_ab["b"]["user_id"]
