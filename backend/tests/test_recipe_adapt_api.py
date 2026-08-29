"""Tests HTTP des routes d'adaptation de recette : POST /recipes/{id}/adapt/preview
et POST /recipes/{id}/adapt/interpret. Le calcul lui-même est couvert en
détail par test_recipe_adapt_calc.py (pur, sans serveur) — ces tests
vérifient l'exposition HTTP : auth, permissions de lecture, 404, et que
/interpret suit exactement le même sort que /chat dans cet environnement
sans clé Anthropic réelle (503, jamais un plantage).
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "test.adapt.a@bakers.app"
TEST_PASS = "TestAdaptA2026!"
TEST_NAME = "Chef Adapt A"

TEST_EMAIL_B = "test.adapt.b@bakers.app"
TEST_PASS_B = "TestAdaptB2026!"
TEST_NAME_B = "Chef Adapt B"


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


@pytest.fixture(scope="module")
def recipe(token):
    r = requests.post(
        f"{API}/recipes",
        json={
            "title": "TEST_Adapt recette", "category": "Pains", "difficulty": "Facile", "time_minutes": 60,
            "hydration": 68, "yield_pieces": 40, "description": "Recette de test pour l'adaptation",
            "ingredients": ["6750 g farine T65", "750 g farine de seigle", "5100 g eau", "150 g sel", "75 g levure"],
            "steps": ["Etape 1"],
        },
        headers=h(token), timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


class TestPreviewAuthAndLookup:
    def test_requires_auth(self, recipe):
        r = requests.post(f"{API}/recipes/{recipe['id']}/adapt/preview", json={}, timeout=30)
        assert r.status_code == 401

    def test_unknown_recipe_404s(self, token):
        r = requests.post(f"{API}/recipes/does-not-exist/adapt/preview", json={}, headers=h(token), timeout=30)
        assert r.status_code == 404

    def test_any_authenticated_user_can_preview_a_recipe_they_do_not_own(self, token_b, recipe):
        # Une recette (catalogue ou communauté) est déjà lisible par tout
        # utilisateur authentifié — l'aperçu d'adaptation ne fait que lire.
        r = requests.post(f"{API}/recipes/{recipe['id']}/adapt/preview", json={}, headers=h(token_b), timeout=30)
        assert r.status_code == 200


class TestPreviewComputation:
    def test_empty_request_returns_original_recomputed(self, token, recipe):
        r = requests.post(f"{API}/recipes/{recipe['id']}/adapt/preview", json={}, headers=h(token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert data["hydration"] == 68
        assert data["yield_pieces"] == 40
        assert all(not i["changed"] for i in data["ingredients"])

    def test_quantity_change_scales_every_ingredient(self, token, recipe):
        r = requests.post(
            f"{API}/recipes/{recipe['id']}/adapt/preview",
            json={"target_yield_pieces": 80, "target_piece_weight_g": 320.625},
            headers=h(token), timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert data["yield_pieces"] == 80
        by_name = {i["name"]: i["quantity"] for i in data["ingredients"]}
        # Facteur 2 exactement (40*320.625*2 / (40*320.625) = 2)
        assert abs(by_name["farine T65"] - 13500) < 1
        assert abs(by_name["eau"] - 10200) < 1

    def test_hydration_change_touches_only_water(self, token, recipe):
        r = requests.post(
            f"{API}/recipes/{recipe['id']}/adapt/preview",
            json={"target_hydration_pct": 75}, headers=h(token), timeout=30,
        )
        data = r.json()
        assert data["ok"] is True
        by_name = {i["name"]: i["quantity"] for i in data["ingredients"]}
        assert by_name["farine T65"] == 6750
        assert by_name["farine de seigle"] == 750
        assert by_name["eau"] == 5625  # 75% * 7500
        assert data["hydration"] == 75

    def test_flour_percentage_change(self, token, recipe):
        r = requests.post(
            f"{API}/recipes/{recipe['id']}/adapt/preview",
            json={"flour_percentage_changes": {"farine de seigle": 20}}, headers=h(token), timeout=30,
        )
        data = r.json()
        assert data["ok"] is True
        by_pct = {i["name"]: i["percentage"] for i in data["ingredients"]}
        assert by_pct["farine de seigle"] == 20.0
        assert by_pct["farine T65"] == 80.0

    def test_ingredient_substitution(self, token, recipe):
        r = requests.post(
            f"{API}/recipes/{recipe['id']}/adapt/preview",
            json={"substitutions": [{"from_name": "levure", "to_name": "levain naturel"}]},
            headers=h(token), timeout=30,
        )
        data = r.json()
        assert data["ok"] is True
        names = [i["name"] for i in data["ingredients"]]
        assert "levain naturel" in names
        assert "levure" not in names

    def test_combined_request_matches_spec_example(self, token, recipe):
        r = requests.post(
            f"{API}/recipes/{recipe['id']}/adapt/preview",
            json={
                "target_yield_pieces": 80, "target_piece_weight_g": 320,
                "flour_percentage_changes": {"farine de seigle": 20},
                "target_hydration_pct": 72,
            },
            headers=h(token), timeout=30,
        )
        data = r.json()
        assert data["ok"] is True
        assert data["yield_pieces"] == 80
        assert data["hydration"] == 72
        by_pct = {i["name"]: i["percentage"] for i in data["ingredients"]}
        assert by_pct["farine de seigle"] == 20.0
        assert by_pct["farine T65"] == 80.0


class TestPreviewValidation:
    def test_flour_percentages_over_100_is_a_clear_error_not_a_crash(self, token, recipe):
        r = requests.post(
            f"{API}/recipes/{recipe['id']}/adapt/preview",
            json={"flour_percentage_changes": {"farine T65": 90, "farine de seigle": 50}},
            headers=h(token), timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is False
        assert any("100" in e for e in data["errors"])

    def test_unknown_ingredient_substitution_is_a_clear_error(self, token, recipe):
        r = requests.post(
            f"{API}/recipes/{recipe['id']}/adapt/preview",
            json={"substitutions": [{"from_name": "beurre", "to_name": "margarine"}]},
            headers=h(token), timeout=30,
        )
        data = r.json()
        assert data["ok"] is False
        assert any("introuvable" in e for e in data["errors"])

    def test_original_recipe_never_mutated_by_preview(self, token, recipe):
        requests.post(
            f"{API}/recipes/{recipe['id']}/adapt/preview",
            json={"target_yield_pieces": 200, "target_piece_weight_g": 500, "target_hydration_pct": 90},
            headers=h(token), timeout=30,
        )
        still = requests.get(f"{API}/recipes/{recipe['id']}", headers=h(token), timeout=30).json()
        assert still["ingredients"] == ["6750 g farine T65", "750 g farine de seigle", "5100 g eau", "150 g sel", "75 g levure"]
        assert still["yield_pieces"] == 40
        assert still["hydration"] == 68


class TestInterpretRoute:
    def test_requires_auth(self, recipe):
        r = requests.post(f"{API}/recipes/{recipe['id']}/adapt/interpret", json={"text": "120 baguettes"}, timeout=30)
        assert r.status_code == 401

    def test_unknown_recipe_404s(self, token):
        r = requests.post(f"{API}/recipes/does-not-exist/adapt/interpret", json={"text": "x"}, headers=h(token), timeout=30)
        assert r.status_code == 404

    def test_without_a_real_anthropic_key_returns_503_never_a_crash(self, token, recipe):
        # Cet environnement de test n'a pas de vraie clé ANTHROPIC_API_KEY —
        # même sort que /chat (TestChat::test_chat_ai) et /recipes/scan/analyze,
        # jamais une 500.
        r = requests.post(
            f"{API}/recipes/{recipe['id']}/adapt/interpret",
            json={"text": "120 baguettes de 250 g avec 15% de seigle"},
            headers=h(token), timeout=30,
        )
        assert r.status_code in (503, 200)
        if r.status_code == 503:
            assert "ANTHROPIC_API_KEY" in r.text
