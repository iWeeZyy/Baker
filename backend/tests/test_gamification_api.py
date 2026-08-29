"""Tests HTTP du système Niveaux + Badges. Le calcul lui-même (dédoublonnage,
plafonds, niveaux, badges) est couvert en détail par test_gamification_calc.py
(pur, sans serveur) — ces tests vérifient l'exposition HTTP : l'XP apparaît
au bon endroit dans les bonnes réponses, jamais chez le mauvais utilisateur,
jamais deux fois pour une action réversible, et aucune route ne permet à un
client de forger son propre niveau/badge.

Chaque test qui a besoin d'un total d'XP exact enregistre un compte neuf
(email à suffixe aléatoire, précédent déjà établi par test_cost_api.py) —
`-n 2 --dist loadscope` partage un état séquentiel par classe/module, donc un
compte partagé accumulerait de l'XP d'un test à l'autre et rendrait les
assertions exactes fragiles.
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"


def register():
    email = f"gamapi.{uuid.uuid4().hex[:10]}@bakers.app"
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": "TestGam2026!", "name": f"Testeur {email[:6]}"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return body["token"], body["user"]["user_id"]


def h(token):
    return {"Authorization": f"Bearer {token}"}


def make_recipe(token, title="Recette de test", ingredients=None):
    r = requests.post(
        f"{API}/recipes",
        json={
            "title": title, "category": "Pains", "difficulty": "Facile", "time_minutes": 30,
            "description": "desc", "ingredients": ingredients or ["300 g de farine", "200 g d'eau"],
            "steps": ["Une étape"],
        },
        headers=h(token), timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


class TestLevelStartsAtOne:
    def test_new_account_is_level_one_zero_xp(self):
        token, _ = register()
        r = requests.get(f"{API}/auth/me", headers=h(token), timeout=30)
        assert r.status_code == 200
        detail = r.json()["level_detail"]
        assert detail["level"] == 1 and detail["xp"] == 0 and detail["title"] == "Débutant"


class TestRecipePublishing:
    def test_publishing_awards_xp_in_the_same_response(self):
        token, _ = register()
        recipe = make_recipe(token)
        assert "gamification" in recipe
        assert recipe["gamification"]["leveled_up"] == {"level": 2, "title": "Apprenti"}
        assert recipe["gamification"]["badges_unlocked"][0]["id"] == "first_recipe"

    def test_xp_persists_and_is_visible_on_auth_me(self):
        token, _ = register()
        make_recipe(token)
        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me["level_detail"]["xp"] == 100


class TestLikeReceived:
    def test_liker_never_gets_xp_only_the_owner_does(self):
        owner_token, owner_id = register()
        liker_token, _ = register()
        recipe = make_recipe(owner_token)

        like_response = requests.post(f"{API}/recipes/{recipe['id']}/like", headers=h(liker_token), timeout=30)
        assert like_response.status_code == 200
        assert "gamification" not in like_response.json()

        liker_me = requests.get(f"{API}/auth/me", headers=h(liker_token), timeout=30).json()
        assert liker_me["level_detail"]["xp"] == 0

        owner_me = requests.get(f"{API}/auth/me", headers=h(owner_token), timeout=30).json()
        assert owner_me["level_detail"]["xp"] == 100 + 5  # publication + like reçu

    def test_unlike_then_relike_never_awards_twice(self):
        owner_token, _ = register()
        liker_token, _ = register()
        recipe = make_recipe(owner_token)
        rid = recipe["id"]

        requests.post(f"{API}/recipes/{rid}/like", headers=h(liker_token), timeout=30)  # like
        requests.post(f"{API}/recipes/{rid}/like", headers=h(liker_token), timeout=30)  # unlike
        requests.post(f"{API}/recipes/{rid}/like", headers=h(liker_token), timeout=30)  # relike

        owner_me = requests.get(f"{API}/auth/me", headers=h(owner_token), timeout=30).json()
        assert owner_me["level_detail"]["xp"] == 100 + 5

    def test_self_like_awards_nothing_extra_to_the_author(self):
        token, _ = register()
        recipe = make_recipe(token)
        requests.post(f"{API}/recipes/{recipe['id']}/like", headers=h(token), timeout=30)
        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me["level_detail"]["xp"] == 100  # pas de +5 pour son propre like


class TestCommentXp:
    def test_writer_and_owner_each_get_their_own_xp(self):
        owner_token, _ = register()
        commenter_token, _ = register()
        recipe = make_recipe(owner_token)

        r = requests.post(
            f"{API}/recipes/{recipe['id']}/comments", headers=h(commenter_token),
            json={"content": "Très bonne recette !"}, timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["gamification"]["leveled_up"] is None  # 3 XP ne suffit pas pour monter de niveau

        commenter_me = requests.get(f"{API}/auth/me", headers=h(commenter_token), timeout=30).json()
        assert commenter_me["level_detail"]["xp"] == 3

        owner_me = requests.get(f"{API}/auth/me", headers=h(owner_token), timeout=30).json()
        assert owner_me["level_detail"]["xp"] == 100 + 10  # publication + commentaire reçu

    def test_commenting_on_own_recipe_never_pays_out_the_received_side(self):
        token, _ = register()
        recipe = make_recipe(token)
        requests.post(f"{API}/recipes/{recipe['id']}/comments", headers=h(token), json={"content": "Note perso"}, timeout=30)
        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me["level_detail"]["xp"] == 100 + 3  # publication + écrit, jamais +10 reçu


class TestFollowXp:
    def test_new_follower_awards_the_followee_not_the_follower(self):
        followee_token, followee_id = register()
        follower_token, _ = register()
        r = requests.post(f"{API}/users/{followee_id}/follow", headers=h(follower_token), timeout=30)
        assert r.status_code == 200
        assert "gamification" not in r.json()

        followee_me = requests.get(f"{API}/auth/me", headers=h(followee_token), timeout=30).json()
        assert followee_me["level_detail"]["xp"] == 10

        follower_me = requests.get(f"{API}/auth/me", headers=h(follower_token), timeout=30).json()
        assert follower_me["level_detail"]["xp"] == 0

    def test_follow_unfollow_follow_never_reawards(self):
        followee_token, followee_id = register()
        follower_token, _ = register()
        requests.post(f"{API}/users/{followee_id}/follow", headers=h(follower_token), timeout=30)  # follow
        requests.post(f"{API}/users/{followee_id}/follow", headers=h(follower_token), timeout=30)  # unfollow
        requests.post(f"{API}/users/{followee_id}/follow", headers=h(follower_token), timeout=30)  # follow again
        followee_me = requests.get(f"{API}/auth/me", headers=h(followee_token), timeout=30).json()
        assert followee_me["level_detail"]["xp"] == 10


class TestFriendXp:
    def test_both_sides_get_xp_exactly_once(self):
        a_token, a_id = register()
        b_token, b_id = register()
        r = requests.post(f"{API}/friends/request", headers=h(a_token), json={"user_id": b_id}, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "pending_sent"

        requests_incoming = requests.get(f"{API}/friends/requests", headers=h(b_token), timeout=30).json()
        request_id = requests_incoming[0]["id"]
        respond = requests.post(
            f"{API}/friends/requests/{request_id}/respond", headers=h(b_token), json={"accept": True}, timeout=30,
        )
        assert respond.status_code == 200
        assert respond.json()["gamification"]["leveled_up"] is None

        a_me = requests.get(f"{API}/auth/me", headers=h(a_token), timeout=30).json()
        b_me = requests.get(f"{API}/auth/me", headers=h(b_token), timeout=30).json()
        assert a_me["level_detail"]["xp"] == 15
        assert b_me["level_detail"]["xp"] == 15


class TestCollectionXp:
    def test_creating_a_collection_awards_a_small_amount(self):
        token, _ = register()
        r = requests.post(f"{API}/collections", headers=h(token), json={"name": "Mes essais", "description": ""}, timeout=30)
        assert r.status_code == 200
        assert r.json()["gamification"]["leveled_up"] is None
        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me["level_detail"]["xp"] == 5

    def test_lifetime_cap_stops_after_ten_collections(self):
        token, _ = register()
        for i in range(15):
            requests.post(f"{API}/collections", headers=h(token), json={"name": f"Dossier {i}", "description": ""}, timeout=30)
        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me["level_detail"]["xp"] == 10 * 5  # plafonné à 10 collections


class TestDeletedCreationKeepsXp:
    def test_deleting_a_creation_does_not_claw_back_its_xp(self):
        token, _ = register()
        r = requests.post(
            f"{API}/creations", headers=h(token),
            json={"title": "Ma création", "description": "desc", "category": "Pain", "photos": ["x/y.jpg"]},
            timeout=30,
        )
        assert r.status_code == 200
        creation = r.json()
        me_before = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me_before["level_detail"]["xp"] == 50

        deleted = requests.delete(f"{API}/creations/{creation['id']}", headers=h(token), timeout=30)
        assert deleted.status_code == 200
        me_after = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me_after["level_detail"]["xp"] == 50  # jamais repris


class TestBadgesAndFavorite:
    def test_locked_badges_carry_progress_and_favorite_is_validated(self):
        token, user_id = register()
        make_recipe(token)

        page = requests.get(f"{API}/users/{user_id}/badges", headers=h(token), timeout=30)
        assert page.status_code == 200
        body = page.json()
        by_id = {b["id"]: b for b in body["badges"]}
        assert by_id["first_recipe"]["unlocked_at"] is not None
        assert by_id["recipes_10"]["unlocked_at"] is None
        assert by_id["recipes_10"]["progress"] == {"current": 1, "threshold": 10}

        # Un badge non obtenu ne peut pas devenir le favori.
        forbidden = requests.put(
            f"{API}/users/me/badges/favorite", headers=h(token), json={"badge_id": "recipes_100"}, timeout=30,
        )
        assert forbidden.status_code == 403

        ok = requests.put(
            f"{API}/users/me/badges/favorite", headers=h(token), json={"badge_id": "first_recipe"}, timeout=30,
        )
        assert ok.status_code == 200 and ok.json()["favorite_badge_id"] == "first_recipe"

    def test_unknown_badge_id_is_rejected(self):
        token, _ = register()
        r = requests.put(f"{API}/users/me/badges/favorite", headers=h(token), json={"badge_id": "not-a-badge"}, timeout=30)
        assert r.status_code == 404

    def test_clearing_the_favorite_with_null_is_allowed(self):
        token, _ = register()
        make_recipe(token)
        requests.put(f"{API}/users/me/badges/favorite", headers=h(token), json={"badge_id": "first_recipe"}, timeout=30)
        r = requests.put(f"{API}/users/me/badges/favorite", headers=h(token), json={"badge_id": None}, timeout=30)
        assert r.status_code == 200 and r.json()["favorite_badge_id"] is None


class TestNoClientTrust:
    def test_no_route_accepts_an_arbitrary_xp_or_level(self):
        # PUT /auth/me est le seul endpoint générique de mise à jour de profil
        # — il ignore silencieusement tout champ qu'il ne connaît pas
        # (xp/level ne font pas partie de UserProfileUpdate).
        token, _ = register()
        requests.put(f"{API}/auth/me", headers=h(token), json={"bio": "test", "xp": 999999, "level": 20}, timeout=30)
        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me["level_detail"]["xp"] == 0 and me["level_detail"]["level"] == 1

    def test_favorite_badge_requires_auth(self):
        r = requests.put(f"{API}/users/me/badges/favorite", json={"badge_id": None}, timeout=30)
        assert r.status_code == 401


class TestLevelSurfacedAcrossExistingSurfaces:
    def test_public_user_carries_level_in_search_results(self):
        token, _ = register()
        make_recipe(token)  # -> niveau 2
        other_token, _ = register()

        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        name = None
        # On récupère le nom via le profil public pour construire une requête de recherche fiable.
        prof = requests.get(f"{API}/users/{me['user_id']}/profile", headers=h(other_token), timeout=30).json()
        name = prof["user"]["name"]

        search = requests.get(f"{API}/users/search", params={"q": name}, headers=h(other_token), timeout=30).json()
        assert search and search[0]["level"] == {"level": 2, "title": "Apprenti"}

    def test_recipe_carries_author_level(self):
        token, _ = register()
        recipe = make_recipe(token)
        fetched = requests.get(f"{API}/recipes/{recipe['id']}", timeout=30).json()
        assert fetched["author_level"] == {"level": 2, "title": "Apprenti"}

    def test_comment_carries_author_level(self):
        owner_token, _ = register()
        commenter_token, _ = register()
        recipe = make_recipe(owner_token)
        requests.post(f"{API}/recipes/{recipe['id']}/comments", headers=h(commenter_token), json={"content": "Bravo"}, timeout=30)
        comments = requests.get(f"{API}/recipes/{recipe['id']}/comments", timeout=30).json()
        assert comments[0]["user_level"] == {"level": 1, "title": "Débutant"}

    def test_public_profile_exposes_level_detail_and_badges_preview(self):
        token, user_id = register()
        make_recipe(token)
        other_token, _ = register()
        profile = requests.get(f"{API}/users/{user_id}/profile", headers=h(other_token), timeout=30).json()
        assert profile["user"]["level"] == {"level": 2, "title": "Apprenti"}
        assert profile["level_detail"]["xp"] == 100
        assert profile["badges_preview"][0]["id"] == "first_recipe"


class TestBlockedContentNeverRewarded:
    def test_a_blocked_recipe_title_never_reaches_the_database_or_awards_xp(self):
        # TEXT_MODERATION_TEST_BAN_WORDS doit être défini côté serveur pour ce
        # test — comme test_recipe_moderation.py, on saute silencieusement
        # sinon plutôt que d'asserter sur la vraie liste de Lucas.
        test_word = os.environ.get("TEXT_MODERATION_TEST_BAN_WORD_FOR_TESTS")
        if not test_word:
            pytest.skip("TEXT_MODERATION_TEST_BAN_WORD_FOR_TESTS non défini dans cet environnement")
        token, _ = register()
        r = requests.post(
            f"{API}/recipes", headers=h(token),
            json={
                "title": test_word, "category": "Pains", "difficulty": "Facile", "time_minutes": 10,
                "description": "x", "ingredients": ["1 g de x"], "steps": ["x"],
            },
            timeout=30,
        )
        assert r.status_code == 422
        me = requests.get(f"{API}/auth/me", headers=h(token), timeout=30).json()
        assert me["level_detail"]["xp"] == 0
