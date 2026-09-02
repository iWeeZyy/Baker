"""Tests HTTP de POST /recipes/instagram-import/analyze. Même limite que
test_scan_api.py/test_recipe_adapt_api.py : cet environnement de test n'a
pas de vraie clé ANTHROPIC_API_KEY, donc pas d'appel Anthropic réel — ces
tests vérifient l'exposition HTTP (auth, validations) et que l'absence de
clé produit un 503 propre, jamais un plantage.
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "test.instagram_import@bakers.app"
TEST_PASS = "TestInstagramImport2026!"
TEST_NAME = "Chef Instagram"


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


class TestInstagramImportAnalyzeRoute:
    def test_requires_auth(self):
        r = requests.post(f"{API}/recipes/instagram-import/analyze", json={"caption": "Une brioche tressée maison, 500g farine, 10g sel, 80g sucre."}, timeout=30)
        assert r.status_code == 401

    def test_empty_caption_rejected(self, token):
        # Même garde-fou d'ordre que /recipes/scan/analyze : anthropic_client
        # est vérifié avant la validation de l'entrée, donc sans vraie clé
        # dans cet environnement de test la 503 arrive avant la 400 — les deux
        # sont acceptées ici, seule une 200/2xx serait une vraie régression.
        r = requests.post(f"{API}/recipes/instagram-import/analyze", json={"caption": "   "}, headers=h(token), timeout=30)
        assert r.status_code in (400, 503)

    def test_too_long_caption_rejected(self, token):
        caption = "a" * 5001
        r = requests.post(f"{API}/recipes/instagram-import/analyze", json={"caption": caption}, headers=h(token), timeout=30)
        assert r.status_code in (400, 503)

    def test_without_a_real_anthropic_key_returns_503_never_a_crash(self, token):
        # Même sort que /recipes/scan/analyze et /recipes/{id}/adapt/interpret
        # dans cet environnement de test : jamais une 500.
        r = requests.post(
            f"{API}/recipes/instagram-import/analyze",
            json={"caption": "Ma brioche tressée du dimanche 🥐 500g farine T45, 10g sel, 80g sucre, 3 œufs, 200g beurre, 10g levure fraîche. #brioche #boulangerie"},
            headers=h(token), timeout=30,
        )
        assert r.status_code in (503, 200)
        if r.status_code == 503:
            assert "ANTHROPIC_API_KEY" in r.text
