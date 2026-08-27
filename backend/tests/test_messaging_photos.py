"""Photo-messaging API tests: upload, moderation, private serving, reveal,
reporting. Shares the fixed friend accounts from test_messaging.py so the
whole messaging suite (text + photo) is idempotent against a persistent
database, and reuses the same photo-message endpoints throughout — nothing
here duplicates the existing text-message flow, which test_messaging.py
already covers and which this file does not touch.

Levels are produced with solid-colour JPEGs against `moderation._stub_score`'s
rules (see backend/moderation.py): red -> blocked, orange -> sensitive, grey
-> normal, blue -> simulated provider outage. That mapping is only exercised
by a real server started with MODERATION_PROVIDER=stub in its environment —
see backend/CLAUDE.md. Tests whose outcome depends on the exact level are
skipped when the running server isn't configured that way; every other test
here (auth, authorization, persistence, private serving, size limits,
corrupt-upload handling, reporting) is provider-independent and always runs.
"""
import io
import os

import pytest
import requests
from PIL import Image

from test_messaging import ACCOUNTS, API, _login_or_register, auth_headers  # noqa: E402

STUB_ACTIVE = os.environ.get("MODERATION_PROVIDER", "").strip().lower() == "stub"
requires_stub = pytest.mark.skipif(
    not STUB_ACTIVE,
    reason="requires the server under test to run with MODERATION_PROVIDER=stub",
)


def _solid_jpeg(color, size=(40, 40)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    buf.seek(0)
    return buf


def GREY(): return _solid_jpeg((150, 150, 150))
def RED(): return _solid_jpeg((255, 0, 0))
def ORANGE(): return _solid_jpeg((255, 150, 0))
def BLUE(): return _solid_jpeg((0, 0, 255))


@pytest.fixture(scope="module")
def users():
    out = {}
    for key, (email, password, name) in ACCOUNTS.items():
        data = _login_or_register(email, password, name)
        out[key] = {"token": data["token"], "user_id": data["user"]["user_id"], "name": data["user"]["name"]}
    return out


@pytest.fixture(scope="module")
def friends_ab(users):
    h_a = auth_headers(users["a"]["token"])
    r = requests.post(f"{API}/friends/request", json={"user_id": users["b"]["user_id"]}, headers=h_a, timeout=30)
    assert r.status_code == 200, r.text
    if r.json()["status"] != "friends":
        h_b = auth_headers(users["b"]["token"])
        reqs = requests.get(f"{API}/friends/requests", headers=h_b, timeout=30).json()
        pending = next(x for x in reqs if x["from_user"]["user_id"] == users["a"]["user_id"])
        requests.post(f"{API}/friends/requests/{pending['id']}/respond", json={"accept": True}, headers=h_b, timeout=30)
    return users


def _send_photo(token, friend_id, fileobj, filename="photo.jpg"):
    return requests.post(
        f"{API}/messages/{friend_id}/photo",
        files={"file": (filename, fileobj, "image/jpeg")},
        headers=auth_headers(token),
        timeout=30,
    )


# --- Sending: auth, friendship, malformed input (provider-independent) ---
class TestSendPhotoGuards:
    def test_send_requires_auth(self, friends_ab):
        r = requests.post(f"{API}/messages/{friends_ab['b']['user_id']}/photo", files={"file": ("p.jpg", GREY(), "image/jpeg")}, timeout=30)
        assert r.status_code == 401

    def test_cannot_send_photo_to_non_friend(self, friends_ab, users):
        r = _send_photo(users["stranger"]["token"], friends_ab["a"]["user_id"], GREY())
        assert r.status_code == 403

    def test_empty_file_rejected(self, friends_ab):
        r = requests.post(
            f"{API}/messages/{friends_ab['b']['user_id']}/photo",
            files={"file": ("empty.jpg", io.BytesIO(b""), "image/jpeg")},
            headers=auth_headers(friends_ab["a"]["token"]),
            timeout=30,
        )
        assert r.status_code == 400

    def test_non_image_upload_rejected_cleanly(self, friends_ab):
        r = requests.post(
            f"{API}/messages/{friends_ab['b']['user_id']}/photo",
            files={"file": ("notes.txt", io.BytesIO(b"this is not an image, just text"), "text/plain")},
            headers=auth_headers(friends_ab["a"]["token"]),
            timeout=30,
        )
        assert r.status_code == 400

    def test_oversized_upload_rejected(self, friends_ab):
        big = io.BytesIO(b"0" * (13 * 1024 * 1024))
        r = requests.post(
            f"{API}/messages/{friends_ab['b']['user_id']}/photo",
            files={"file": ("big.jpg", big, "image/jpeg")},
            headers=auth_headers(friends_ab["a"]["token"]),
            timeout=30,
        )
        assert r.status_code == 413


# --- Sending a normal photo end to end (provider-independent shape checks) ---
class TestSendAndReceivePhoto:
    def test_send_creates_a_photo_message(self, friends_ab):
        r = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["type"] == "photo"
        assert doc["from_user_id"] == friends_ab["a"]["user_id"]
        assert doc["to_user_id"] == friends_ab["b"]["user_id"]
        assert doc["moderation"]["level"] in ("normal", "sensitive", "blocked")
        assert doc["moderation"]["status"] in ("checked", "unavailable")
        # A message that reached the recipient is never itself "blocked" —
        # blocked photos are refused before anything is stored.
        assert doc["moderation"]["level"] != "blocked"

    def test_recipient_sees_the_photo_message_in_history(self, friends_ab):
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        got = requests.get(f"{API}/messages/{friends_ab['a']['user_id']}", headers=auth_headers(friends_ab["b"]["token"]), timeout=30)
        assert any(m["id"] == doc["id"] and m["type"] == "photo" for m in got.json()["messages"])

    def test_sender_can_fetch_their_own_photo_immediately(self, friends_ab):
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        got = requests.get(f"{API}/messages/photos/{doc['id']}", params={"variant": "display"}, headers=auth_headers(friends_ab["a"]["token"]), timeout=30)
        assert got.status_code == 200
        assert got.headers["content-type"].startswith("image/")

    def test_recipient_can_fetch_the_display_photo(self, friends_ab):
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        got = requests.get(f"{API}/messages/photos/{doc['id']}", params={"variant": "display"}, headers=auth_headers(friends_ab["b"]["token"]), timeout=30)
        assert got.status_code == 200
        assert got.headers["content-type"].startswith("image/")


# --- Private access control (spec point 9 — provider-independent) ---
class TestPhotoPrivacy:
    def test_fetching_photo_requires_auth(self, friends_ab):
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        r = requests.get(f"{API}/messages/photos/{doc['id']}", timeout=30)
        assert r.status_code == 401

    def test_stranger_cannot_fetch_someone_elses_photo(self, friends_ab, users):
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        r = requests.get(f"{API}/messages/photos/{doc['id']}", headers=auth_headers(users["stranger"]["token"]), timeout=30)
        assert r.status_code == 403

    def test_tampering_with_message_id_never_reaches_another_conversation(self, friends_ab, users):
        # Stranger sends themself... they can't (not friends with anyone
        # relevant here), so instead: stranger tries every message id it can
        # observe is not theirs — guessing a real id must still 403, not leak.
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        r = requests.get(f"{API}/messages/photos/{doc['id']}", headers=auth_headers(users["stranger"]["token"]), timeout=30)
        assert r.status_code in (403, 404)
        assert "image" not in r.headers.get("content-type", "")

    def test_unknown_message_id_404s(self, friends_ab):
        r = requests.get(f"{API}/messages/photos/does-not-exist", headers=auth_headers(friends_ab["a"]["token"]), timeout=30)
        assert r.status_code == 404

    def test_blur_variant_404s_when_photo_has_no_blur(self, friends_ab):
        # A normal-level photo (grey swatch under the real provider, or any
        # provider that doesn't flag it) has no blur preview stored at all.
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        if doc["moderation"]["level"] != "normal":
            pytest.skip("this run's provider did not classify the grey swatch as normal")
        r = requests.get(f"{API}/messages/photos/{doc['id']}", params={"variant": "blur"}, headers=auth_headers(friends_ab["a"]["token"]), timeout=30)
        assert r.status_code == 404

    def test_photo_not_reachable_through_the_public_files_route(self, friends_ab):
        # Even with the exact storage path, the public /files/{path} route
        # is rooted at a different directory and must not resolve it.
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        pair = "-".join(sorted([friends_ab["a"]["user_id"], friends_ab["b"]["user_id"]]))
        guessed_path = f"bakers-app/messages/{pair}/{doc['id']}.jpg"
        r = requests.get(f"{API}/files/{guessed_path}", timeout=30)
        assert r.status_code == 404


# --- Graduated classification (requires MODERATION_PROVIDER=stub) ---
class TestGraduatedLevels:
    @requires_stub
    def test_red_swatch_is_blocked_outright(self, friends_ab):
        r = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], RED())
        assert r.status_code == 422
        # Nothing must be stored/delivered for a blocked photo.
        history = requests.get(f"{API}/messages/{friends_ab['b']['user_id']}", headers=auth_headers(friends_ab["a"]["token"]), timeout=30).json()
        assert not any(m.get("moderation", {}).get("level") == "blocked" for m in history["messages"])

    @requires_stub
    def test_orange_swatch_is_sensitive_and_blurred_by_default(self, friends_ab):
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], ORANGE())
        assert sent.status_code == 200, sent.text
        doc = sent.json()
        assert doc["moderation"]["level"] == "sensitive"
        assert doc["photo_blur_path"]
        # The recipient can fetch the blurred stand-in without revealing anything.
        blurred = requests.get(f"{API}/messages/photos/{doc['id']}", params={"variant": "blur"}, headers=auth_headers(friends_ab["b"]["token"]), timeout=30)
        assert blurred.status_code == 200

    @requires_stub
    def test_sensitive_photo_is_still_sent_not_blocked(self, friends_ab):
        # The core rule: "sensitive" never blocks the send.
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], ORANGE())
        assert sent.status_code == 200
        doc = sent.json()
        history = requests.get(f"{API}/messages/{friends_ab['a']['user_id']}", headers=auth_headers(friends_ab["b"]["token"]), timeout=30).json()
        assert any(m["id"] == doc["id"] for m in history["messages"])

    @requires_stub
    def test_recipient_can_still_fetch_full_photo_after_choosing_to_reveal(self, friends_ab):
        # "Revealing" is a client-side choice about which variant to render;
        # the server always allows fetching either variant once authorized.
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], ORANGE())
        doc = sent.json()
        full = requests.get(f"{API}/messages/photos/{doc['id']}", params={"variant": "display"}, headers=auth_headers(friends_ab["b"]["token"]), timeout=30)
        assert full.status_code == 200

    @requires_stub
    def test_provider_outage_falls_back_to_sensitive_and_still_sends(self, friends_ab):
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], BLUE())
        assert sent.status_code == 200, sent.text
        doc = sent.json()
        assert doc["moderation"]["status"] == "unavailable"
        assert doc["moderation"]["level"] != "normal"


# --- Reporting ---
class TestReportMessage:
    def test_report_requires_auth(self, friends_ab):
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        r = requests.post(f"{API}/messages/{doc['id']}/report", json={"reason": "sexual"}, timeout=30)
        assert r.status_code == 401

    def test_uninvolved_user_cannot_report(self, friends_ab, users):
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        r = requests.post(f"{API}/messages/{doc['id']}/report", json={"reason": "sexual"}, headers=auth_headers(users["stranger"]["token"]), timeout=30)
        assert r.status_code == 403

    def test_invalid_reason_rejected(self, friends_ab):
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        r = requests.post(f"{API}/messages/{doc['id']}/report", json={"reason": "not-a-real-reason"}, headers=auth_headers(friends_ab["b"]["token"]), timeout=30)
        assert r.status_code == 400

    def test_recipient_can_report_a_photo(self, friends_ab):
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        r = requests.post(f"{API}/messages/{doc['id']}/report", json={"reason": "sexual", "note": "test"}, headers=auth_headers(friends_ab["b"]["token"]), timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "reported"

    def test_unknown_message_report_404s(self, friends_ab):
        r = requests.post(f"{API}/messages/does-not-exist/report", json={"reason": "spam"}, headers=auth_headers(friends_ab["a"]["token"]), timeout=30)
        assert r.status_code == 404


# --- Regression: text messages are unaffected ---
class TestTextMessagesStillWork:
    def test_text_message_send_and_receive_unaffected(self, friends_ab):
        content = "Toujours du texte, comme avant."
        sent = requests.post(f"{API}/messages/{friends_ab['b']['user_id']}", json={"content": content}, headers=auth_headers(friends_ab["a"]["token"]), timeout=30)
        assert sent.status_code == 200
        doc = sent.json()
        assert doc["content"] == content
        assert doc.get("type", "text") == "text"
        got = requests.get(f"{API}/messages/{friends_ab['a']['user_id']}", headers=auth_headers(friends_ab["b"]["token"]), timeout=30)
        assert any(m["id"] == doc["id"] for m in got.json()["messages"])

    def test_mixed_history_keeps_text_and_photo_messages_in_order(self, friends_ab):
        requests.post(f"{API}/messages/{friends_ab['b']['user_id']}", json={"content": "avant la photo"}, headers=auth_headers(friends_ab["a"]["token"]), timeout=30)
        _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        requests.post(f"{API}/messages/{friends_ab['b']['user_id']}", json={"content": "apres la photo"}, headers=auth_headers(friends_ab["a"]["token"]), timeout=30)
        msgs = requests.get(f"{API}/messages/{friends_ab['b']['user_id']}", headers=auth_headers(friends_ab["a"]["token"]), timeout=30).json()["messages"]
        timestamps = [m["created_at"] for m in msgs]
        assert timestamps == sorted(timestamps)
