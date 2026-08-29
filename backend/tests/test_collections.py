"""Tests des Collections : dossiers personnels de recettes enregistrées.

Une collection ne référence jamais qu'un `recipe_id` — jamais une copie des
données de la recette — donc la plupart des garanties intéressantes portent
sur la synchronisation (une recette reste visible ailleurs après retrait
d'une collection, une collection supprimée n'emporte jamais les recettes)
plutôt que sur un calcul. Suit le style de test_creations_api.py : comptes
dédiés namés par fichier, toggles vérifiés avant d'être basculés pour rester
rejouable contre une base persistante (voir `_set_favorite`).
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "test.collections.a@bakers.app"
TEST_PASS = "TestCollectionsA2026!"
TEST_NAME = "Chef Collections A"

TEST_EMAIL_B = "test.collections.b@bakers.app"
TEST_PASS_B = "TestCollectionsB2026!"
TEST_NAME_B = "Chef Collections B"


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


@pytest.fixture(scope="module")
def recipe_ids():
    r = requests.get(f"{API}/recipes", timeout=30)
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert len(ids) >= 30, "le catalogue doit avoir assez de recettes pour les tests de pagination"
    return ids


def h(token):
    return {"Authorization": f"Bearer {token}"}


def _set_favorite(token, recipe_id, want: bool):
    current = requests.get(f"{API}/recipes/{recipe_id}/favorite", headers=h(token), timeout=30).json()["favorited"]
    if current != want:
        requests.post(f"{API}/recipes/{recipe_id}/favorite", headers=h(token), timeout=30)


class TestCRUD:
    def test_requires_auth_on_all_routes(self, recipe_ids):
        assert requests.post(f"{API}/collections", json={"name": "X"}, timeout=30).status_code == 401
        assert requests.get(f"{API}/collections", timeout=30).status_code == 401
        assert requests.get(f"{API}/collections/whatever", timeout=30).status_code == 401
        assert requests.put(f"{API}/collections/whatever", json={"name": "X"}, timeout=30).status_code == 401
        assert requests.delete(f"{API}/collections/whatever", timeout=30).status_code == 401
        assert requests.post(f"{API}/collections/whatever/recipes/{recipe_ids[0]}", timeout=30).status_code == 401
        assert requests.delete(f"{API}/collections/whatever/recipes/{recipe_ids[0]}", timeout=30).status_code == 401
        assert requests.get(f"{API}/collections/whatever/recipes", timeout=30).status_code == 401

    def test_create_minimal(self, token):
        r = requests.post(f"{API}/collections", json={"name": "TEST À tester"}, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["name"] == "TEST À tester"
        assert c["description"] == ""
        assert c["visibility"] == "private"
        assert c["recipe_count"] == 0

    def test_create_with_description(self, token):
        r = requests.post(f"{API}/collections", json={"name": "TEST Noël", "description": "Recettes de fêtes"}, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["description"] == "Recettes de fêtes"

    def test_missing_name_rejected(self, token):
        r = requests.post(f"{API}/collections", json={"name": "   "}, headers=h(token), timeout=30)
        assert r.status_code == 422

    def test_name_over_max_length_rejected(self, token):
        r = requests.post(f"{API}/collections", json={"name": "a" * 81}, headers=h(token), timeout=30)
        assert r.status_code == 422

    def test_description_over_max_length_rejected(self, token):
        r = requests.post(f"{API}/collections", json={"name": "X", "description": "a" * 301}, headers=h(token), timeout=30)
        assert r.status_code == 422

    def test_update_name_and_description(self, token):
        c = requests.post(f"{API}/collections", json={"name": "Avant"}, headers=h(token), timeout=30).json()
        r = requests.put(f"{API}/collections/{c['id']}", json={"name": "Après", "description": "desc"}, headers=h(token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "Après"
        assert r.json()["description"] == "desc"

    def test_delete_collection(self, token):
        c = requests.post(f"{API}/collections", json={"name": "TEST delete"}, headers=h(token), timeout=30).json()
        r = requests.delete(f"{API}/collections/{c['id']}", headers=h(token), timeout=30)
        assert r.status_code == 200
        assert requests.get(f"{API}/collections/{c['id']}", headers=h(token), timeout=30).status_code == 404

    def test_unknown_collection_404s(self, token):
        assert requests.get(f"{API}/collections/does-not-exist", headers=h(token), timeout=30).status_code == 404
        assert requests.put(f"{API}/collections/does-not-exist", json={"name": "X"}, headers=h(token), timeout=30).status_code == 404
        assert requests.delete(f"{API}/collections/does-not-exist", headers=h(token), timeout=30).status_code == 404

    def test_favorites_pseudo_id_rejected_for_mutations(self, token):
        # __favorites__ est une lecture seule dérivée de db.favorites — jamais
        # un vrai document db.collections.
        assert requests.put(f"{API}/collections/__favorites__", json={"name": "X"}, headers=h(token), timeout=30).status_code == 404
        assert requests.delete(f"{API}/collections/__favorites__", headers=h(token), timeout=30).status_code == 404


class TestPermissions:
    def test_other_user_cannot_read_write_delete(self, token, token_b):
        c = requests.post(f"{API}/collections", json={"name": "TEST perms"}, headers=h(token), timeout=30).json()
        assert requests.get(f"{API}/collections/{c['id']}", headers=h(token_b), timeout=30).status_code == 403
        assert requests.put(f"{API}/collections/{c['id']}", json={"name": "Hack"}, headers=h(token_b), timeout=30).status_code == 403
        assert requests.delete(f"{API}/collections/{c['id']}", headers=h(token_b), timeout=30).status_code == 403
        assert requests.get(f"{API}/collections/{c['id']}/recipes", headers=h(token_b), timeout=30).status_code == 403

    def test_other_user_cannot_add_or_remove_recipes(self, token, token_b, recipe_ids):
        c = requests.post(f"{API}/collections", json={"name": "TEST perms2"}, headers=h(token), timeout=30).json()
        rid = recipe_ids[0]
        assert requests.post(f"{API}/collections/{c['id']}/recipes/{rid}", headers=h(token_b), timeout=30).status_code == 403
        assert requests.delete(f"{API}/collections/{c['id']}/recipes/{rid}", headers=h(token_b), timeout=30).status_code == 403

    def test_list_only_shows_own_collections(self, token, token_b):
        c = requests.post(f"{API}/collections", json={"name": "TEST liste privée"}, headers=h(token), timeout=30).json()
        listed_b = requests.get(f"{API}/collections", headers=h(token_b), timeout=30).json()
        assert not any(x["id"] == c["id"] for x in listed_b)


class TestMembership:
    def test_add_and_appears_in_detail(self, token, recipe_ids):
        c = requests.post(f"{API}/collections", json={"name": "TEST membership"}, headers=h(token), timeout=30).json()
        rid = recipe_ids[10]
        r = requests.post(f"{API}/collections/{c['id']}/recipes/{rid}", headers=h(token), timeout=30)
        assert r.status_code == 200
        assert r.json() == {"in_collection": True}
        detail = requests.get(f"{API}/collections/{c['id']}/recipes", headers=h(token), timeout=30).json()
        assert any(item["id"] == rid for item in detail["items"])
        got = requests.get(f"{API}/collections/{c['id']}", headers=h(token), timeout=30).json()
        assert got["recipe_count"] == 1

    def test_add_twice_is_idempotent(self, token, recipe_ids):
        c = requests.post(f"{API}/collections", json={"name": "TEST idempotent add"}, headers=h(token), timeout=30).json()
        rid = recipe_ids[11]
        requests.post(f"{API}/collections/{c['id']}/recipes/{rid}", headers=h(token), timeout=30)
        requests.post(f"{API}/collections/{c['id']}/recipes/{rid}", headers=h(token), timeout=30)
        got = requests.get(f"{API}/collections/{c['id']}", headers=h(token), timeout=30).json()
        assert got["recipe_count"] == 1

    def test_remove_absent_is_idempotent(self, token, recipe_ids):
        c = requests.post(f"{API}/collections", json={"name": "TEST remove absent"}, headers=h(token), timeout=30).json()
        r = requests.delete(f"{API}/collections/{c['id']}/recipes/{recipe_ids[12]}", headers=h(token), timeout=30)
        assert r.status_code == 200
        assert r.json() == {"in_collection": False}

    def test_add_unknown_recipe_404s(self, token):
        c = requests.post(f"{API}/collections", json={"name": "TEST bad recipe"}, headers=h(token), timeout=30).json()
        r = requests.post(f"{API}/collections/{c['id']}/recipes/does-not-exist", headers=h(token), timeout=30)
        assert r.status_code == 404

    def test_add_to_unknown_collection_404s(self, token, recipe_ids):
        r = requests.post(f"{API}/collections/does-not-exist/recipes/{recipe_ids[13]}", headers=h(token), timeout=30)
        assert r.status_code == 404

    def test_recipe_can_belong_to_multiple_collections(self, token, recipe_ids):
        rid = recipe_ids[14]
        c1 = requests.post(f"{API}/collections", json={"name": "TEST multi 1"}, headers=h(token), timeout=30).json()
        c2 = requests.post(f"{API}/collections", json={"name": "TEST multi 2"}, headers=h(token), timeout=30).json()
        requests.post(f"{API}/collections/{c1['id']}/recipes/{rid}", headers=h(token), timeout=30)
        requests.post(f"{API}/collections/{c2['id']}/recipes/{rid}", headers=h(token), timeout=30)
        d1 = requests.get(f"{API}/collections/{c1['id']}/recipes", headers=h(token), timeout=30).json()
        d2 = requests.get(f"{API}/collections/{c2['id']}/recipes", headers=h(token), timeout=30).json()
        assert any(i["id"] == rid for i in d1["items"])
        assert any(i["id"] == rid for i in d2["items"])

    def test_remove_from_one_keeps_in_other_and_in_favorites(self, token, recipe_ids):
        rid = recipe_ids[15]
        _set_favorite(token, rid, True)
        c1 = requests.post(f"{API}/collections", json={"name": "TEST remove one 1"}, headers=h(token), timeout=30).json()
        c2 = requests.post(f"{API}/collections", json={"name": "TEST remove one 2"}, headers=h(token), timeout=30).json()
        requests.post(f"{API}/collections/{c1['id']}/recipes/{rid}", headers=h(token), timeout=30)
        requests.post(f"{API}/collections/{c2['id']}/recipes/{rid}", headers=h(token), timeout=30)

        r = requests.delete(f"{API}/collections/{c1['id']}/recipes/{rid}", headers=h(token), timeout=30)
        assert r.status_code == 200
        assert r.json() == {"in_collection": False}

        d1 = requests.get(f"{API}/collections/{c1['id']}/recipes", headers=h(token), timeout=30).json()
        d2 = requests.get(f"{API}/collections/{c2['id']}/recipes", headers=h(token), timeout=30).json()
        assert not any(i["id"] == rid for i in d1["items"])
        assert any(i["id"] == rid for i in d2["items"])
        assert requests.get(f"{API}/recipes/{rid}/favorite", headers=h(token), timeout=30).json()["favorited"] is True

    def test_delete_collection_never_deletes_recipes_or_favorites(self, token, recipe_ids):
        rid = recipe_ids[16]
        _set_favorite(token, rid, True)
        c = requests.post(f"{API}/collections", json={"name": "TEST delete keeps recipes"}, headers=h(token), timeout=30).json()
        requests.post(f"{API}/collections/{c['id']}/recipes/{rid}", headers=h(token), timeout=30)

        r = requests.delete(f"{API}/collections/{c['id']}", headers=h(token), timeout=30)
        assert r.status_code == 200

        assert requests.get(f"{API}/recipes/{rid}", headers=h(token), timeout=30).status_code == 200
        assert requests.get(f"{API}/recipes/{rid}/favorite", headers=h(token), timeout=30).json()["favorited"] is True

    def test_collection_recipe_reflects_live_recipe_data(self, token, recipe_ids):
        # Aucune route d'édition de recette n'existe dans cette app (voir
        # CLAUDE.md) : impossible de simuler un changement de titre. Ce qui
        # est vérifiable, c'est que l'item renvoyé est bien résolu depuis
        # db.recipes à la lecture (même titre, même like_count enrichi) et
        # non une copie stockée sur collection_recipes — cohérent avec le
        # schéma, qui ne stocke jamais qu'un recipe_id (jamais de champs
        # recette dupliqués à modifier).
        rid = recipe_ids[17]
        live = requests.get(f"{API}/recipes/{rid}", headers=h(token), timeout=30).json()
        c = requests.post(f"{API}/collections", json={"name": "TEST live reflect"}, headers=h(token), timeout=30).json()
        requests.post(f"{API}/collections/{c['id']}/recipes/{rid}", headers=h(token), timeout=30)
        detail = requests.get(f"{API}/collections/{c['id']}/recipes", headers=h(token), timeout=30).json()
        item = next(i for i in detail["items"] if i["id"] == rid)
        assert item["title"] == live["title"]
        assert item["description"] == live["description"]


class TestFavoritesVirtualEntry:
    def test_appears_first_in_list(self, token):
        listed = requests.get(f"{API}/collections", headers=h(token), timeout=30).json()
        assert listed[0]["id"] == "__favorites__"
        assert listed[0]["name"] == "Toutes les recettes enregistrées"

    def test_reflects_favorites_toggle(self, token, recipe_ids):
        rid = recipe_ids[18]
        _set_favorite(token, rid, True)
        detail = requests.get(f"{API}/collections/__favorites__/recipes", headers=h(token), timeout=30).json()
        assert any(i["id"] == rid for i in detail["items"])

        _set_favorite(token, rid, False)
        detail2 = requests.get(f"{API}/collections/__favorites__/recipes", headers=h(token), timeout=30).json()
        assert not any(i["id"] == rid for i in detail2["items"])

    def test_count_matches_recipes_favorites_route(self, token, recipe_ids):
        rid = recipe_ids[19]
        _set_favorite(token, rid, True)
        fav_list = requests.get(f"{API}/recipes/favorites", headers=h(token), timeout=30).json()
        got = requests.get(f"{API}/collections/__favorites__", headers=h(token), timeout=30).json()
        assert got["recipe_count"] == len(fav_list)

    def test_other_user_never_sees_my_favorites(self, token, token_b, recipe_ids):
        rid = recipe_ids[20]
        _set_favorite(token, rid, True)
        detail_b = requests.get(f"{API}/collections/__favorites__/recipes", headers=h(token_b), timeout=30).json()
        assert not any(i["id"] == rid for i in detail_b["items"])


class TestSortSearchPagination:
    def test_default_sort_is_most_recently_added_first(self, token, recipe_ids):
        c = requests.post(f"{API}/collections", json={"name": "TEST tri défaut"}, headers=h(token), timeout=30).json()
        first, second = recipe_ids[21], recipe_ids[22]
        requests.post(f"{API}/collections/{c['id']}/recipes/{first}", headers=h(token), timeout=30)
        requests.post(f"{API}/collections/{c['id']}/recipes/{second}", headers=h(token), timeout=30)
        detail = requests.get(f"{API}/collections/{c['id']}/recipes", headers=h(token), timeout=30).json()
        ids_in_order = [i["id"] for i in detail["items"]]
        assert ids_in_order.index(second) < ids_in_order.index(first)

    def test_oldest_sort_reverses_order(self, token, recipe_ids):
        c = requests.post(f"{API}/collections", json={"name": "TEST tri ancien"}, headers=h(token), timeout=30).json()
        first, second = recipe_ids[21], recipe_ids[22]
        requests.post(f"{API}/collections/{c['id']}/recipes/{first}", headers=h(token), timeout=30)
        requests.post(f"{API}/collections/{c['id']}/recipes/{second}", headers=h(token), timeout=30)
        detail = requests.get(f"{API}/collections/{c['id']}/recipes?sort=oldest", headers=h(token), timeout=30).json()
        ids_in_order = [i["id"] for i in detail["items"]]
        assert ids_in_order.index(first) < ids_in_order.index(second)

    def test_search_only_within_this_collection(self, token, recipe_ids):
        c1 = requests.post(f"{API}/collections", json={"name": "TEST recherche 1"}, headers=h(token), timeout=30).json()
        c2 = requests.post(f"{API}/collections", json={"name": "TEST recherche 2"}, headers=h(token), timeout=30).json()
        rid = recipe_ids[23]
        title = requests.get(f"{API}/recipes/{rid}", headers=h(token), timeout=30).json()["title"]
        requests.post(f"{API}/collections/{c1['id']}/recipes/{rid}", headers=h(token), timeout=30)
        needle = title[:5]

        found_in_1 = requests.get(f"{API}/collections/{c1['id']}/recipes?q={needle}", headers=h(token), timeout=30).json()
        found_in_2 = requests.get(f"{API}/collections/{c2['id']}/recipes?q={needle}", headers=h(token), timeout=30).json()
        assert any(i["id"] == rid for i in found_in_1["items"])
        assert not any(i["id"] == rid for i in found_in_2["items"])

    def test_pagination_cursor(self, token, recipe_ids):
        c = requests.post(f"{API}/collections", json={"name": "TEST pagination"}, headers=h(token), timeout=30).json()
        chosen = recipe_ids[:25]
        for rid in chosen:
            requests.post(f"{API}/collections/{c['id']}/recipes/{rid}", headers=h(token), timeout=30)

        page1 = requests.get(f"{API}/collections/{c['id']}/recipes", headers=h(token), timeout=30).json()
        assert len(page1["items"]) == 20
        assert page1["has_more"] is True

        cursor = page1["items"][-1]["added_at"]
        page2 = requests.get(f"{API}/collections/{c['id']}/recipes?before={cursor}", headers=h(token), timeout=30).json()
        assert len(page2["items"]) == 5
        assert page2["has_more"] is False

        ids_page1 = {i["id"] for i in page1["items"]}
        ids_page2 = {i["id"] for i in page2["items"]}
        assert not (ids_page1 & ids_page2), "aucune recette ne doit apparaître sur les deux pages"
        assert ids_page1 | ids_page2 == set(chosen)

    def test_invalid_sort_rejected(self, token):
        c = requests.post(f"{API}/collections", json={"name": "TEST tri invalide"}, headers=h(token), timeout=30).json()
        r = requests.get(f"{API}/collections/{c['id']}/recipes?sort=n_importe_quoi", headers=h(token), timeout=30)
        assert r.status_code == 422


class TestListMosaicAndMembershipFlag:
    def test_list_never_returns_full_recipe_documents(self, token, recipe_ids):
        c = requests.post(f"{API}/collections", json={"name": "TEST mosaïque"}, headers=h(token), timeout=30).json()
        requests.post(f"{API}/collections/{c['id']}/recipes/{recipe_ids[24]}", headers=h(token), timeout=30)
        listed = requests.get(f"{API}/collections", headers=h(token), timeout=30).json()
        entry = next(x for x in listed if x["id"] == c["id"])
        assert entry["recipe_count"] == 1
        assert len(entry["preview_recipes"]) == 1
        # Juste assez pour recipeImageSource() : jamais le titre/ingrédients.
        assert "title" not in entry["preview_recipes"][0]
        assert "id" in entry["preview_recipes"][0]

    def test_in_collection_flag_via_recipe_id_param(self, token, recipe_ids):
        rid = recipe_ids[25]
        c_in = requests.post(f"{API}/collections", json={"name": "TEST flag in"}, headers=h(token), timeout=30).json()
        c_out = requests.post(f"{API}/collections", json={"name": "TEST flag out"}, headers=h(token), timeout=30).json()
        requests.post(f"{API}/collections/{c_in['id']}/recipes/{rid}", headers=h(token), timeout=30)

        listed = requests.get(f"{API}/collections?recipe_id={rid}", headers=h(token), timeout=30).json()
        by_id = {x["id"]: x for x in listed}
        assert by_id[c_in["id"]]["in_collection"] is True
        assert by_id[c_out["id"]]["in_collection"] is False

    def test_no_recipe_id_param_omits_flag(self, token):
        listed = requests.get(f"{API}/collections", headers=h(token), timeout=30).json()
        real_entries = [x for x in listed if x["id"] != "__favorites__"]
        assert real_entries and all("in_collection" not in x for x in real_entries)
