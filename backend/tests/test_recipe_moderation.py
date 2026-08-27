"""Tests HTTP de la modération de texte sur les recettes et les
commentaires communautaires. Suit le style de test_messaging_photos.py :
un compte dédié, des vérifications indépendantes du fournisseur d'abord,
puis un groupe qui nécessite un mot interdit de test réellement chargé
côté serveur (voir TEXT_MODERATION_TEST_BAN_WORDS dans
backend/.env.example) — ignoré (skip) sinon, jamais un vrai mot interdit
codé en dur ici.
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "test.moderation@bakers.app"
TEST_PASS = "TestModeration2026!"
TEST_NAME = "Chef Moderation"

# Le mot que TEXT_MODERATION_TEST_BAN_WORDS doit contenir pour que le
# groupe TestBlockedAndReview s'exécute — voir backend/.env.example.
TEST_BAN_WORD = os.environ.get("TEXT_MODERATION_TEST_BAN_WORD_FOR_TESTS", "").strip()
requires_test_ban_word = pytest.mark.skipif(
    not TEST_BAN_WORD,
    reason="nécessite TEXT_MODERATION_TEST_BAN_WORD_FOR_TESTS (doit correspondre à une entrée de TEXT_MODERATION_TEST_BAN_WORDS côté serveur)",
)


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


def _recipe_payload(title, description="", ingredients=None, steps=None):
    return {
        "title": title,
        "category": "Pains",
        "difficulty": "facile",
        "time_minutes": 60,
        "description": description or "Une recette de test.",
        "ingredients": ingredients or ["farine", "eau", "sel", "levure"],
        "steps": steps or ["Pétrir la pâte.", "Laisser reposer.", "Cuire au four."],
    }


@pytest.fixture(scope="module")
def existing_recipe_id():
    r = requests.get(f"{API}/recipes", timeout=30)
    assert r.status_code == 200
    return r.json()[0]["id"]


# --- Contenu sûr : publication normale, aucun impact de la modération ---
class TestSafeContentPublishesNormally:
    def test_ordinary_recipe_is_created(self, token):
        payload = _recipe_payload("TEST_modclac Pain de campagne")
        r = requests.post(f"{API}/recipes", json=payload, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["title"] == payload["title"]

    def test_ordinary_comment_is_created(self, token, existing_recipe_id):
        payload = {"content": "TEST_modclac Superbe recette, merci !"}
        r = requests.post(f"{API}/recipes/{existing_recipe_id}/comments", json=payload, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["content"] == payload["content"]


# --- Termes de la whitelist officielle : jamais bloqués, avec ou sans contexte ---
class TestOfficialWhitelistNeverBlocks:
    def test_batard_recipe_with_context_is_created(self, token):
        payload = _recipe_payload(
            "TEST_modclac Bâtard de campagne",
            steps=["Façonner en bâtard.", "Laisser pousser.", "Cuire au four bien chaud."],
        )
        r = requests.post(f"{API}/recipes", json=payload, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text

    def test_bare_batard_comment_is_never_rejected(self, token, existing_recipe_id):
        # Ambigu (whitelist sans marqueur de contexte) -> REVIEW, jamais
        # bloqué : le commentaire doit être publié quand même.
        payload = {"content": "TEST_modclac Bâtard"}
        r = requests.post(f"{API}/recipes/{existing_recipe_id}/comments", json=payload, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text

    def test_fougasse_comment_is_created(self, token, existing_recipe_id):
        payload = {"content": "TEST_modclac J'adore la fougasse aux olives"}
        r = requests.post(f"{API}/recipes/{existing_recipe_id}/comments", json=payload, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text


# --- BLOCKED et REVIEW réels (nécessite un mot interdit de test côté serveur) ---
class TestBlockedAndReview:
    @requires_test_ban_word
    def test_blocked_recipe_is_rejected_and_nothing_is_stored(self, token):
        title = f"TEST_modclac Recette {TEST_BAN_WORD}"
        payload = _recipe_payload(title)
        r = requests.post(f"{API}/recipes", json=payload, headers=h(token), timeout=30)
        assert r.status_code == 422, r.text
        listed = requests.get(f"{API}/recipes", params={"category": "Pains"}, timeout=30).json()
        assert not any(x["title"] == title for x in listed)

    @requires_test_ban_word
    def test_blocked_comment_is_rejected_and_nothing_is_stored(self, token, existing_recipe_id):
        content = f"TEST_modclac commentaire {TEST_BAN_WORD}"
        r = requests.post(f"{API}/recipes/{existing_recipe_id}/comments", json={"content": content}, headers=h(token), timeout=30)
        assert r.status_code == 422, r.text
        comments = requests.get(f"{API}/recipes/{existing_recipe_id}/comments", timeout=30).json()
        assert not any(c["content"] == content for c in comments)

    @requires_test_ban_word
    def test_blocked_response_never_reveals_the_matched_term(self, token, existing_recipe_id):
        content = f"TEST_modclac commentaire {TEST_BAN_WORD}"
        r = requests.post(f"{API}/recipes/{existing_recipe_id}/comments", json={"content": content}, headers=h(token), timeout=30)
        assert r.status_code == 422
        assert TEST_BAN_WORD not in r.text


# --- Régression : la messagerie n'est pas concernée par ce module ---
class TestOutOfScope:
    def test_recipe_creation_still_requires_auth(self):
        r = requests.post(f"{API}/recipes", json=_recipe_payload("TEST_modclac sans auth"), timeout=30)
        assert r.status_code in (401, 403)
