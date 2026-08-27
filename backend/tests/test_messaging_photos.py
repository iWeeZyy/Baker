"""Tests de l'API de messagerie photo : envoi, modération, service privé,
révélation, signalement. Réutilise les comptes amis fixes de
test_messaging.py pour que toute la suite de messagerie (texte + photo)
reste idempotente sur une base persistante, et réutilise les mêmes points
d'entrée tout du long — rien ici ne duplique le flux de messages texte
existant, déjà couvert par test_messaging.py et que ce fichier ne touche
pas.

Les niveaux sont produits avec des JPEG en aplat de couleur, selon les
règles de `moderation._stub_score` (voir backend/moderation.py) : rouge ->
bloqué, orange -> sensible, gris -> normal, bleu -> panne du fournisseur
simulée. Cette correspondance n'est exercée que par un serveur réel démarré
avec MODERATION_PROVIDER=stub dans son environnement — voir
backend/CLAUDE.md. Les tests dont l'issue dépend du niveau exact sont
ignorés (skip) quand le serveur testé n'est pas configuré ainsi ; tous les
autres tests de ce fichier (authentification, autorisation, persistance,
service privé, limites de taille, gestion des envois corrompus,
signalement) sont indépendants du fournisseur et tournent toujours.
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
    reason="nécessite que le serveur testé tourne avec MODERATION_PROVIDER=stub",
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


# --- Envoi : authentification, amitié, entrée malformée (indépendant du fournisseur) ---
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


# --- Envoi d'une photo normale de bout en bout (vérifications de forme, indépendantes du fournisseur) ---
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
        # Un message parvenu au destinataire n'est jamais lui-même
        # « bloqué » — les photos bloquées sont refusées avant tout stockage.
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


# --- Contrôle d'accès privé (point 9 du cahier des charges — indépendant du fournisseur) ---
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
        # L'inconnu ne peut pas s'envoyer un message à lui-même (pas ami
        # avec les comptes utiles ici) ; à la place : il tente d'accéder à
        # un identifiant de message réel qui n'est pas le sien — deviner un
        # identifiant valide doit quand même donner 403, jamais de fuite.
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        r = requests.get(f"{API}/messages/photos/{doc['id']}", headers=auth_headers(users["stranger"]["token"]), timeout=30)
        assert r.status_code in (403, 404)
        assert "image" not in r.headers.get("content-type", "")

    def test_unknown_message_id_404s(self, friends_ab):
        r = requests.get(f"{API}/messages/photos/does-not-exist", headers=auth_headers(friends_ab["a"]["token"]), timeout=30)
        assert r.status_code == 404

    def test_blur_variant_404s_when_photo_has_no_blur(self, friends_ab):
        # Une photo de niveau normal (aplat gris sous le vrai fournisseur,
        # ou tout fournisseur qui ne la signale pas) n'a aucun aperçu
        # flouté stocké.
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        if doc["moderation"]["level"] != "normal":
            pytest.skip("le fournisseur de cette exécution n'a pas classé l'aplat gris comme normal")
        r = requests.get(f"{API}/messages/photos/{doc['id']}", params={"variant": "blur"}, headers=auth_headers(friends_ab["a"]["token"]), timeout=30)
        assert r.status_code == 404

    def test_photo_not_reachable_through_the_public_files_route(self, friends_ab):
        # Même avec le chemin de stockage exact, la route publique
        # /files/{path} est ancrée sur un autre répertoire et ne doit pas
        # pouvoir le résoudre.
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], GREY())
        doc = sent.json()
        pair = "-".join(sorted([friends_ab["a"]["user_id"], friends_ab["b"]["user_id"]]))
        guessed_path = f"bakers-app/messages/{pair}/{doc['id']}.jpg"
        r = requests.get(f"{API}/files/{guessed_path}", timeout=30)
        assert r.status_code == 404


# --- Classification graduée (nécessite MODERATION_PROVIDER=stub) ---
class TestGraduatedLevels:
    @requires_stub
    def test_red_swatch_is_blocked_outright(self, friends_ab):
        r = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], RED())
        assert r.status_code == 422
        # Rien ne doit être stocké/livré pour une photo bloquée.
        history = requests.get(f"{API}/messages/{friends_ab['b']['user_id']}", headers=auth_headers(friends_ab["a"]["token"]), timeout=30).json()
        assert not any(m.get("moderation", {}).get("level") == "blocked" for m in history["messages"])

    @requires_stub
    def test_orange_swatch_is_sensitive_and_blurred_by_default(self, friends_ab):
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], ORANGE())
        assert sent.status_code == 200, sent.text
        doc = sent.json()
        assert doc["moderation"]["level"] == "sensitive"
        assert doc["photo_blur_path"]
        # Le destinataire peut récupérer l'aperçu flouté sans rien révéler.
        blurred = requests.get(f"{API}/messages/photos/{doc['id']}", params={"variant": "blur"}, headers=auth_headers(friends_ab["b"]["token"]), timeout=30)
        assert blurred.status_code == 200

    @requires_stub
    def test_sensitive_photo_is_still_sent_not_blocked(self, friends_ab):
        # La règle centrale : « sensible » ne bloque jamais l'envoi.
        sent = _send_photo(friends_ab["a"]["token"], friends_ab["b"]["user_id"], ORANGE())
        assert sent.status_code == 200
        doc = sent.json()
        history = requests.get(f"{API}/messages/{friends_ab['a']['user_id']}", headers=auth_headers(friends_ab["b"]["token"]), timeout=30).json()
        assert any(m["id"] == doc["id"] for m in history["messages"])

    @requires_stub
    def test_recipient_can_still_fetch_full_photo_after_choosing_to_reveal(self, friends_ab):
        # « Révéler » est un choix côté client sur la variante à afficher ;
        # le serveur autorise toujours la récupération de l'une ou l'autre
        # variante, une fois l'autorisation vérifiée.
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


# --- Signalement ---
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


# --- Régression : les messages texte ne sont pas affectés ---
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
