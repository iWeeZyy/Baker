"""Tests du nouveau parcours d'inscription par étapes : nom d'utilisateur
(@handle), spécialités, et l'inscription enrichie (bio/Instagram/profession/
spécialités envoyés en une fois à la finalisation).

Suit le style de test_user_profile_api.py : les tests dont l'issue dépend
d'un mot interdit réellement chargé sont ignorés (skip) sinon.
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TEST_BAN_WORD = os.environ.get("TEXT_MODERATION_TEST_BAN_WORD_FOR_TESTS", "").strip()
requires_test_ban_word = pytest.mark.skipif(
    not TEST_BAN_WORD,
    reason="nécessite TEXT_MODERATION_TEST_BAN_WORD_FOR_TESTS",
)


def h(token):
    return {"Authorization": f"Bearer {token}"}


def fresh_email():
    return f"test.onboarding.{uuid.uuid4().hex[:10]}@bakers.app"


def fresh_username():
    return f"baker_{uuid.uuid4().hex[:10]}"


def register(email=None, username=None, name="Chef Onboarding", password="TestOnboarding2026!", **extra):
    body = {"email": email or fresh_email(), "password": password, "name": name}
    if username is not None:
        body["username"] = username
    body.update(extra)
    return requests.post(f"{API}/auth/register", json=body, timeout=30)


class TestUsernameAvailability:
    def test_available_username(self):
        r = requests.get(f"{API}/auth/username-available", params={"username": fresh_username()}, timeout=30)
        assert r.status_code == 200
        assert r.json()["available"] is True

    def test_bad_format_username(self):
        # "MAJUSCULE"/"Has-Dash" ne sont PAS ici : la casse est normalisée
        # (couvert par test_username_is_case_insensitive) et un tiret est un
        # caractère interdit distinct testé séparément ci-dessous.
        for bad in ["ab", "a" * 21, "with space", "é_accent", "trait-union"]:
            r = requests.get(f"{API}/auth/username-available", params={"username": bad}, timeout=30)
            assert r.status_code == 200, bad
            assert r.json()["available"] is False, bad
            assert r.json()["reason"] == "format", bad

    def test_taken_username_after_registration(self):
        username = fresh_username()
        r = register(username=username)
        assert r.status_code == 200, r.text
        r2 = requests.get(f"{API}/auth/username-available", params={"username": username}, timeout=30)
        assert r2.json() == {"available": False, "reason": "taken", "username": username}

    def test_username_is_case_insensitive(self):
        username = fresh_username()
        register(username=username)
        r = requests.get(f"{API}/auth/username-available", params={"username": username.upper()}, timeout=30)
        assert r.json()["available"] is False


class TestEmailAvailability:
    def test_available_email(self):
        r = requests.get(f"{API}/auth/email-available", params={"email": fresh_email()}, timeout=30)
        assert r.status_code == 200
        assert r.json() == {"available": True}

    def test_taken_email(self):
        email = fresh_email()
        register(email=email)
        r = requests.get(f"{API}/auth/email-available", params={"email": email}, timeout=30)
        assert r.json() == {"available": False}
        r2 = requests.get(f"{API}/auth/email-available", params={"email": email.upper()}, timeout=30)
        assert r2.json() == {"available": False}


class TestRegisterWithUsername:
    def test_register_requires_valid_username_format(self):
        r = register(username="a")
        assert r.status_code == 422

    def test_register_rejects_duplicate_username(self):
        username = fresh_username()
        r1 = register(username=username)
        assert r1.status_code == 200
        r2 = register(username=username)
        assert r2.status_code == 400

    def test_register_without_username_auto_assigns_one(self):
        r = register(username=None)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["username"]

    def test_username_surfaced_in_register_login_me(self):
        email, username, password = fresh_email(), fresh_username(), "TestOnboarding2026!"
        r = register(email=email, username=username, password=password)
        assert r.json()["user"]["username"] == username
        token = r.json()["token"]

        r_login = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
        assert r_login.json()["user"]["username"] == username

        r_me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30)
        assert r_me.json()["username"] == username


class TestRegisterOptionalFields:
    def test_register_with_bio_instagram_profession_specialties(self):
        r = register(
            bio="Boulanger passionné par le levain.",
            instagram_username="@lucas_boulanger",
            profession="Boulanger",
            specialties=["pain", "levain"],
        )
        assert r.status_code == 200, r.text
        user = r.json()["user"]
        assert user["bio"] == "Boulanger passionné par le levain."
        assert user["instagram_username"] == "lucas_boulanger"
        assert user["profession"] == "Boulanger"
        assert sorted(user["specialties"]) == ["levain", "pain"]

    def test_register_rejects_invalid_instagram(self):
        r = register(instagram_username="https://example.com/notinstagram")
        assert r.status_code == 422

    def test_register_rejects_unknown_specialty(self):
        r = register(specialties=["patisserie", "chimie"])
        assert r.status_code == 422

    def test_register_bio_too_long_rejected(self):
        r = register(bio="x" * 301)
        assert r.status_code == 422

    @requires_test_ban_word
    def test_register_bio_blocked_content_rejected(self):
        r = register(bio=f"Une bio avec {TEST_BAN_WORD} dedans.")
        assert r.status_code == 422
        # Le compte ne doit jamais avoir été créé si la bio est bloquée.
        assert requests.get(f"{API}/auth/username-available", params={"username": fresh_username()}, timeout=30).status_code == 200

    def test_register_without_optional_fields_still_works(self):
        r = register()
        assert r.status_code == 200
        user = r.json()["user"]
        assert user["bio"] is None
        assert user["instagram_username"] is None
        assert user["profession"] is None
        assert user["specialties"] == []


class TestPublicUserSurfacesUsername:
    def test_search_result_carries_username(self):
        # /users/search exclut toujours l'appelant de ses propres résultats
        # (user_id != caller) — il faut donc chercher DEPUIS un second compte.
        username = fresh_username()
        name = f"Chercheur {uuid.uuid4().hex[:8]}"
        register(name=name, username=username)
        searcher_token = register().json()["token"]
        results = requests.get(f"{API}/users/search", params={"q": name}, headers=h(searcher_token), timeout=30).json()
        row = next((u for u in results if u["username"] == username), None)
        assert row is not None


class TestUpdateUsernameAndSpecialties:
    def test_can_change_username(self):
        r = register()
        token = r.json()["token"]
        new_username = fresh_username()
        r2 = requests.put(f"{API}/auth/me", json={"username": new_username}, headers=h(token), timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json()["username"] == new_username

    def test_cannot_take_someone_elses_username(self):
        username_a = fresh_username()
        register(username=username_a)
        r_b = register()
        token_b = r_b.json()["token"]
        r2 = requests.put(f"{API}/auth/me", json={"username": username_a}, headers=h(token_b), timeout=30)
        assert r2.status_code == 422

    def test_keeping_own_username_is_not_a_conflict(self):
        username = fresh_username()
        r = register(username=username)
        token = r.json()["token"]
        r2 = requests.put(f"{API}/auth/me", json={"username": username}, headers=h(token), timeout=30)
        assert r2.status_code == 200

    def test_specialties_replace_and_clear(self):
        r = register()
        token = r.json()["token"]
        r2 = requests.put(f"{API}/auth/me", json={"specialties": ["pain", "autre"]}, headers=h(token), timeout=30)
        assert r2.status_code == 200
        assert sorted(r2.json()["specialties"]) == ["autre", "pain"]
        r3 = requests.put(f"{API}/auth/me", json={"specialties": []}, headers=h(token), timeout=30)
        assert r3.json()["specialties"] == []

    def test_specialties_rejects_unknown_value(self):
        r = register()
        token = r.json()["token"]
        r2 = requests.put(f"{API}/auth/me", json={"specialties": ["patisserie", "nope"]}, headers=h(token), timeout=30)
        assert r2.status_code == 422


class TestAuthGuard:
    def test_username_available_requires_no_auth(self):
        r = requests.get(f"{API}/auth/username-available", params={"username": fresh_username()}, timeout=30)
        assert r.status_code == 200

    def test_email_available_requires_no_auth(self):
        r = requests.get(f"{API}/auth/email-available", params={"email": fresh_email()}, timeout=30)
        assert r.status_code == 200
