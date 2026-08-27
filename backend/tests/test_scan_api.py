"""Tests HTTP de POST /recipes/scan/analyze.

Ne couvre que ce qui est vérifiable sans appeler la vraie API Anthropic
(payante) : authentification, validations qui rejettent avant tout appel
au fournisseur (nombre de pages, image invalide). Le chemin d'extraction
complet (image -> Claude Vision -> JSON structuré) a été vérifié pendant
le développement via un client de test avec l'appel Anthropic simulé
(mongomock + FastAPI TestClient, même technique que le reste de la
suite) plutôt que d'appeler le vrai service ici — même principe que
MODERATION_PROVIDER=stub pour la modération d'image : ne jamais dépenser
sur un appel IA réel dans la suite automatisée.
"""
import io
import os

import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "test.scan@bakers.app"
TEST_PASS = "TestScan2026!"
TEST_NAME = "Chef Scan"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASS}, timeout=30)
    if r.status_code == 200:
        return r.json()["token"]
    r = requests.post(f"{API}/auth/register", json={"email": TEST_EMAIL, "password": TEST_PASS, "name": TEST_NAME}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def h(token):
    return {"Authorization": f"Bearer {token}"}


def _jpeg_bytes(w=200, h_=260):
    buf = io.BytesIO()
    Image.new("RGB", (w, h_), (230, 230, 230)).save(buf, format="JPEG")
    buf.seek(0)
    return buf


class TestAnalyzeGuards:
    def test_requires_auth(self):
        r = requests.post(
            f"{API}/recipes/scan/analyze",
            files={"files": ("p.jpg", _jpeg_bytes(), "image/jpeg")},
            timeout=30,
        )
        assert r.status_code == 401

    def test_too_many_pages_rejected_before_any_ai_call(self, token):
        files = [("files", (f"p{i}.jpg", _jpeg_bytes(), "image/jpeg")) for i in range(7)]
        r = requests.post(f"{API}/recipes/scan/analyze", headers=h(token), files=files, timeout=30)
        assert r.status_code == 400

    def test_invalid_image_rejected_before_any_ai_call(self, token):
        r = requests.post(
            f"{API}/recipes/scan/analyze",
            headers=h(token),
            files={"files": ("bad.jpg", io.BytesIO(b"not an image"), "image/jpeg")},
            timeout=30,
        )
        assert r.status_code == 400

    def test_no_files_rejected(self, token):
        r = requests.post(f"{API}/recipes/scan/analyze", headers=h(token), files={}, timeout=30)
        assert r.status_code in (400, 422)
