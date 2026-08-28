"""Tests de la bio et de l'Instagram du profil : PUT /auth/me.

Suit le style de test_profile_picture_api.py / test_recipe_moderation.py :
les tests dont l'issue dépend d'un mot interdit réellement chargé sont
ignorés (skip) sinon, jamais un vrai mot interdit codé en dur ici.
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "test.bioprofile.a@bakers.app"
TEST_PASS = "TestBioProfileA2026!"
TEST_NAME = "Chef Bio A"

TEST_EMAIL_B = "test.bioprofile.b@bakers.app"
TEST_PASS_B = "TestBioProfileB2026!"
TEST_NAME_B = "Chef Bio B"

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


@pytest.fixture(scope="module")
def token_b():
    r = requests.post(f"{API}/auth/login", json={"email": TEST_EMAIL_B, "password": TEST_PASS_B}, timeout=30)
    if r.status_code == 200:
        return r.json()["token"]
    r = requests.post(f"{API}/auth/register", json={"email": TEST_EMAIL_B, "password": TEST_PASS_B, "name": TEST_NAME_B}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def h(token):
    return {"Authorization": f"Bearer {token}"}


class TestAuthGuard:
    def test_requires_auth(self):
        r = requests.put(f"{API}/auth/me", json={"bio": "Boulanger"}, timeout=30)
        assert r.status_code == 401


class TestBio:
    def test_create_bio(self, token):
        r = requests.put(f"{API}/auth/me", json={"bio": "Boulanger passionné 🥖"}, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["bio"] == "Boulanger passionné 🥖"
        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me["bio"] == "Boulanger passionné 🥖"

    def test_update_bio(self, token):
        requests.put(f"{API}/auth/me", json={"bio": "Ancienne bio"}, headers=h(token), timeout=30)
        r = requests.put(f"{API}/auth/me", json={"bio": "Nouvelle bio"}, headers=h(token), timeout=30)
        assert r.status_code == 200
        assert r.json()["bio"] == "Nouvelle bio"

    def test_delete_bio_with_empty_string(self, token):
        requests.put(f"{API}/auth/me", json={"bio": "Une bio"}, headers=h(token), timeout=30)
        r = requests.put(f"{API}/auth/me", json={"bio": ""}, headers=h(token), timeout=30)
        assert r.status_code == 200
        assert r.json()["bio"] is None
        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me["bio"] is None

    def test_bio_at_exactly_max_length_accepted(self, token):
        bio = "a" * 300
        r = requests.put(f"{API}/auth/me", json={"bio": bio}, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["bio"] == bio

    def test_bio_over_max_length_rejected(self, token):
        r = requests.put(f"{API}/auth/me", json={"bio": "a" * 301}, headers=h(token), timeout=30)
        assert r.status_code == 422

    def test_bio_accepts_emojis_and_newlines(self, token):
        bio = "Boulanger 🥖🍞\nPain au levain\nViennoiseries maison"
        r = requests.put(f"{API}/auth/me", json={"bio": bio}, headers=h(token), timeout=30)
        assert r.status_code == 200
        assert r.json()["bio"] == bio

    def test_omitting_bio_leaves_it_unchanged(self, token, token_b):
        requests.put(f"{API}/auth/me", json={"bio": "Bio de B"}, headers=h(token_b), timeout=30)
        r = requests.put(f"{API}/auth/me", json={"instagram_username": "chef_b"}, headers=h(token_b), timeout=30)
        assert r.status_code == 200
        assert r.json()["bio"] == "Bio de B"

    @requires_test_ban_word
    def test_bio_rejected_by_moderation(self, token):
        before = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()["bio"]
        r = requests.put(f"{API}/auth/me", json={"bio": f"Boulanger {TEST_BAN_WORD}"}, headers=h(token), timeout=30)
        assert r.status_code == 422
        assert TEST_BAN_WORD not in r.text
        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me["bio"] == before


class TestInstagram:
    def test_add_instagram_bare_username(self, token):
        r = requests.put(f"{API}/auth/me", json={"instagram_username": "lucas_boulanger"}, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["instagram_username"] == "lucas_boulanger"

    def test_add_instagram_with_at_prefix(self, token):
        r = requests.put(f"{API}/auth/me", json={"instagram_username": "@lucas_boulanger"}, headers=h(token), timeout=30)
        assert r.status_code == 200
        assert r.json()["instagram_username"] == "lucas_boulanger"

    def test_add_instagram_from_full_url(self, token):
        r = requests.put(
            f"{API}/auth/me",
            json={"instagram_username": "https://www.instagram.com/lucas_boulanger/"},
            headers=h(token), timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["instagram_username"] == "lucas_boulanger"

    def test_update_instagram(self, token):
        requests.put(f"{API}/auth/me", json={"instagram_username": "ancien_compte"}, headers=h(token), timeout=30)
        r = requests.put(f"{API}/auth/me", json={"instagram_username": "nouveau_compte"}, headers=h(token), timeout=30)
        assert r.status_code == 200
        assert r.json()["instagram_username"] == "nouveau_compte"

    def test_delete_instagram_with_empty_string(self, token):
        requests.put(f"{API}/auth/me", json={"instagram_username": "un_compte"}, headers=h(token), timeout=30)
        r = requests.put(f"{API}/auth/me", json={"instagram_username": ""}, headers=h(token), timeout=30)
        assert r.status_code == 200
        assert r.json()["instagram_username"] is None

    def test_other_domain_rejected(self, token):
        before = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()["instagram_username"]
        r = requests.put(f"{API}/auth/me", json={"instagram_username": "https://evil.example.com/lucas"}, headers=h(token), timeout=30)
        assert r.status_code == 422
        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me["instagram_username"] == before

    def test_invalid_characters_rejected(self, token):
        r = requests.put(f"{API}/auth/me", json={"instagram_username": "not a username!"}, headers=h(token), timeout=30)
        assert r.status_code == 422


class TestOwnershipAndVisibility:
    def test_cannot_affect_another_users_profile(self, token, token_b):
        requests.put(f"{API}/auth/me", json={"bio": "Bio de A", "instagram_username": "compte_a"}, headers=h(token), timeout=30)
        requests.put(f"{API}/auth/me", json={"bio": "Bio de B intacte", "instagram_username": "compte_b"}, headers=h(token_b), timeout=30)

        # Aucune route ne prend de user_id cible : PUT /auth/me agit toujours
        # sur le compte du JWT, jamais sur un autre.
        me_b = requests.get(f"{API}/auth/me", headers=h(token_b), timeout=30).json()
        assert me_b["bio"] == "Bio de B intacte"
        assert me_b["instagram_username"] == "compte_b"

    def test_appears_on_public_profile(self, token, token_b):
        me_a = requests.put(f"{API}/auth/me", json={"bio": "Visible publiquement", "instagram_username": "public_compte"}, headers=h(token), timeout=30).json()
        profile = requests.get(f"{API}/users/{me_a['user_id']}/profile", headers=h(token_b), timeout=30).json()
        assert profile["user"]["bio"] == "Visible publiquement"
        assert profile["user"]["instagram_username"] == "public_compte"

    def test_appears_in_search_results(self, token, token_b):
        requests.put(f"{API}/auth/me", json={"bio": "Trouvable", "instagram_username": "trouvable_compte"}, headers=h(token), timeout=30)
        results = requests.get(f"{API}/users/search", params={"q": TEST_NAME}, headers=h(token_b), timeout=30).json()
        found = next((u for u in results if u["name"] == TEST_NAME), None)
        assert found is not None
        assert found["instagram_username"] == "trouvable_compte"


class TestExistingProfilesUnaffected:
    def test_fresh_account_has_no_bio_or_instagram(self):
        email = "test.bioprofile.fresh@bakers.app"
        password = "TestBioProfileFresh2026!"
        r = requests.post(f"{API}/auth/register", json={"email": email, "password": password, "name": "Chef Frais"}, timeout=30)
        if r.status_code != 200:
            r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
        token_fresh = r.json()["token"]
        me = requests.get(f"{API}/auth/me", headers=h(token_fresh), timeout=30).json()
        assert me["bio"] is None
        assert me["instagram_username"] is None

        profile = requests.get(f"{API}/users/{me['user_id']}/profile", headers=h(token_fresh), timeout=30).json()
        assert profile["user"]["bio"] is None
        assert profile["user"]["instagram_username"] is None
