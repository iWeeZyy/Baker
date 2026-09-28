"""Garde-fous de sécurité vérifiés de bout en bout sur l'application FastAPI
réelle, avec une base MongoDB simulée (même technique que
test_retire_seed.py) et un faux client Anthropic : aucun serveur, aucun
réseau, aucune clé — donc exécutable partout, contrairement à la suite HTTP.
"""
import os
from types import SimpleNamespace

import pytest
from mongomock_motor import AsyncMongoMockClient

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "bakers_security_test")
os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-for-security-api-0123456789abcdef")
import motor.motor_asyncio  # noqa: E402

motor.motor_asyncio.AsyncIOMotorClient = lambda *a, **kw: AsyncMongoMockClient()

import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


class _FakeAnthropic:
    """Compte les appels ; répond un texte fixe."""

    def __init__(self):
        self.calls = 0
        self.messages = self

    async def create(self, **kwargs):
        self.calls += 1
        return SimpleNamespace(content=[SimpleNamespace(type="text", text="Réponse.")])


@pytest.fixture()
def client(monkeypatch):
    fake = _FakeAnthropic()
    monkeypatch.setattr(server, "anthropic_client", fake)
    monkeypatch.setattr(server, "login_throttle", server.security.LoginThrottle())

    async def _no_seed():
        # Base simulée partagée par tout le module (core.db) : on repart de
        # zéro à chaque test.
        for name in ("users", "chat_messages", "ai_usage", "ai_safety_caps", "creations"):
            await server.db[name].drop()
        await server.db.ai_safety_caps.create_index([("key", 1), ("day", 1)], unique=True)
    # Le démarrage complet (seed de 194 recettes) n'apporte rien ici.
    monkeypatch.setattr(server.app.router, "on_startup", [_no_seed])
    with TestClient(server.app) as c:
        c.fake = fake
        yield c


def _register(c, email, password="MotDePasse2026!"):
    r = c.post("/api/auth/register", json={"email": email, "password": password, "name": "Test"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


class TestInscription:
    def test_mot_de_passe_trop_court_refuse(self, client):
        r = client.post("/api/auth/register", json={"email": "a@test.fr", "password": "court", "name": "A"})
        assert r.status_code == 422

    def test_mot_de_passe_trop_long_refuse_sans_erreur_500(self, client):
        r = client.post("/api/auth/register", json={"email": "b@test.fr", "password": "é" * 50, "name": "B"})
        assert r.status_code == 422


class TestBruteForce:
    def test_email_verrouille_apres_dix_echecs(self, client):
        _register(client, "cible@test.fr")
        for _ in range(10):
            r = client.post("/api/auth/login", json={"email": "cible@test.fr", "password": "mauvais-mdp"})
            assert r.status_code == 401
        r = client.post("/api/auth/login", json={"email": "cible@test.fr", "password": "MotDePasse2026!"})
        assert r.status_code == 429  # même le BON mot de passe est refusé pendant le verrou

    def test_une_connexion_reussie_remet_le_compteur_a_zero(self, client):
        _register(client, "ok@test.fr")
        for _ in range(9):
            client.post("/api/auth/login", json={"email": "ok@test.fr", "password": "mauvais-mdp"})
        assert client.post("/api/auth/login", json={"email": "ok@test.fr", "password": "MotDePasse2026!"}).status_code == 200
        r = client.post("/api/auth/login", json={"email": "ok@test.fr", "password": "mauvais-mdp"})
        assert r.status_code == 401


class TestPlafondIA:
    """Plafond de sécurité TOUJOURS actif, même quotas commerciaux éteints
    (ENTITLEMENTS_ENFORCED faux par défaut)."""

    def test_plafond_par_utilisateur(self, client, monkeypatch):
        monkeypatch.setenv("AI_DAILY_LIMIT_FREE", "3")
        h = _register(client, "chat@test.fr")
        for _ in range(3):
            assert client.post("/api/chat", json={"message": "Bonjour"}, headers=h).status_code == 200
        r = client.post("/api/chat", json={"message": "Encore"}, headers=h)
        assert r.status_code == 429
        assert client.fake.calls == 3  # l'appel refusé n'a rien coûté

    def test_plafond_global_tient_face_a_plusieurs_comptes(self, client, monkeypatch):
        monkeypatch.setenv("AI_GLOBAL_DAILY_LIMIT", "2")
        h1, h2 = _register(client, "g1@test.fr"), _register(client, "g2@test.fr")
        assert client.post("/api/chat", json={"message": "a"}, headers=h1).status_code == 200
        assert client.post("/api/chat", json={"message": "b"}, headers=h2).status_code == 200
        assert client.post("/api/chat", json={"message": "c"}, headers=h2).status_code == 429
        assert client.fake.calls == 2

    def test_message_geant_refuse_avant_tout_appel(self, client):
        h = _register(client, "long@test.fr")
        r = client.post("/api/chat", json={"message": "x" * 10_000}, headers=h)
        assert r.status_code == 400
        assert client.fake.calls == 0


class TestFichiersDAutrui:
    def test_une_creation_ne_peut_pas_referencer_la_photo_d_un_autre(self, client):
        victime = _register(client, "victime@test.fr")
        victime_id = client.get("/api/auth/me", headers=victime).json()["user_id"]
        attaquant = _register(client, "attaquant@test.fr")
        chemin = f"bakers-app/uploads/{victime_id}/" + "a" * 32 + ".jpg"
        r = client.post("/api/creations", json={"title": "X", "category": "Pain", "photos": [chemin]},
                        headers=attaquant)
        assert r.status_code in (403, 422)

    def test_fichier_meta_jamais_servi(self, client):
        assert client.get("/api/files/bakers-app/uploads/u/x.jpg.meta").status_code == 404
