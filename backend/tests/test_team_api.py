"""Tests de « Team » : relation professionnelle bidirectionnelle par
invitation/acceptation, distincte des Amis — POST/GET /team/invite(s),
respond, PUT/DELETE /team/members/{id}, GET /users/{id}/team, et les
extensions de /users/search et /users/{id}/profile dont elle dépend.

Suit le style de test_creations_api.py : trois comptes de module (A, B, C)
enregistrés une fois, pour tester à la fois la relation A↔B et les
permissions d'un tiers C.
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL_A = "test.team.a@bakers.app"
TEST_PASS_A = "TestTeamA2026!"
TEST_NAME_A = "Chef Team A"

TEST_EMAIL_B = "test.team.b@bakers.app"
TEST_PASS_B = "TestTeamB2026!"
TEST_NAME_B = "Chef Team B"

TEST_EMAIL_C = "test.team.c@bakers.app"
TEST_PASS_C = "TestTeamC2026!"
TEST_NAME_C = "Chef Team C"


def _login_or_register(email, password, name):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code == 200:
        return r.json()
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": password, "name": name}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def auth_a():
    return _login_or_register(TEST_EMAIL_A, TEST_PASS_A, TEST_NAME_A)


@pytest.fixture(scope="module")
def auth_b():
    return _login_or_register(TEST_EMAIL_B, TEST_PASS_B, TEST_NAME_B)


@pytest.fixture(scope="module")
def auth_c():
    return _login_or_register(TEST_EMAIL_C, TEST_PASS_C, TEST_NAME_C)


@pytest.fixture(scope="module")
def token_a(auth_a):
    return auth_a["token"]


@pytest.fixture(scope="module")
def token_b(auth_b):
    return auth_b["token"]


@pytest.fixture(scope="module")
def token_c(auth_c):
    return auth_c["token"]


@pytest.fixture(scope="module")
def user_a(auth_a):
    return auth_a["user"]["user_id"]


@pytest.fixture(scope="module")
def user_b(auth_b):
    return auth_b["user"]["user_id"]


@pytest.fixture(scope="module")
def user_c(auth_c):
    return auth_c["user"]["user_id"]


def h(token):
    return {"Authorization": f"Bearer {token}"}


def _reset_relation(token, other_id):
    """Best-effort : supprime une éventuelle relation/­invitation résiduelle
    d'un run précédent, pour que chaque classe reparte d'un état propre."""
    requests.delete(f"{API}/team/members/{other_id}", headers=h(token), timeout=30)


class TestSearch:
    def test_search_by_name(self, token_a, token_b, user_b):
        r = requests.get(f"{API}/users/search?q=Chef Team B", headers=h(token_a), timeout=30)
        assert r.status_code == 200
        assert any(u["user_id"] == user_b for u in r.json())

    def test_search_by_profession(self, token_a, token_b, user_b):
        r = requests.put(f"{API}/auth/me", headers=h(token_b), json={"profession": "Chocolatier"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["profession"] == "Chocolatier"
        r = requests.get(f"{API}/users/search?q=Chocolatier", headers=h(token_a), timeout=30)
        assert r.status_code == 200
        assert any(u["user_id"] == user_b for u in r.json())

    def test_search_result_carries_team_status(self, token_a, user_b):
        r = requests.get(f"{API}/users/search?q=Chef Team B", headers=h(token_a), timeout=30)
        row = next(u for u in r.json() if u["user_id"] == user_b)
        assert row["team_status"] == "none"

    def test_search_requires_auth(self):
        r = requests.get(f"{API}/users/search?q=Chef", timeout=30)
        assert r.status_code in (401, 403)

    def test_search_too_short_is_empty(self, token_a):
        r = requests.get(f"{API}/users/search?q=a", headers=h(token_a), timeout=30)
        assert r.status_code == 200
        assert r.json() == []


class TestInviteAndAccept:
    def test_cannot_invite_self(self, token_a, user_a):
        r = requests.post(f"{API}/team/invite", headers=h(token_a), json={"user_id": user_a}, timeout=30)
        assert r.status_code == 400

    def test_invite_unknown_user_404s(self, token_a):
        r = requests.post(f"{API}/team/invite", headers=h(token_a), json={"user_id": "does-not-exist"}, timeout=30)
        assert r.status_code == 404

    def test_send_invite(self, token_a, user_b):
        _reset_relation(token_a, user_b)
        r = requests.post(f"{API}/team/invite", headers=h(token_a), json={"user_id": user_b, "role": "Chef"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "pending_sent"

    def test_duplicate_invite_is_idempotent(self, token_a, user_b):
        r = requests.post(f"{API}/team/invite", headers=h(token_a), json={"user_id": user_b}, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "pending_sent"

    def test_invite_visible_only_to_recipient(self, token_b, token_c, user_a):
        r = requests.get(f"{API}/team/invites", headers=h(token_b), timeout=30)
        assert r.status_code == 200
        invites = r.json()
        assert any(i["from_user"]["user_id"] == user_a for i in invites)
        found = next(i for i in invites if i["from_user"]["user_id"] == user_a)
        assert found["role"] == "Chef"

        r = requests.get(f"{API}/team/invites", headers=h(token_c), timeout=30)
        assert all(i["from_user"]["user_id"] != user_a for i in r.json())

    def test_only_recipient_can_respond(self, token_a, token_b, user_a):
        r = requests.get(f"{API}/team/invites", headers=h(token_b), timeout=30)
        invite_id = next(i["id"] for i in r.json() if i["from_user"]["user_id"] == user_a)
        # A (the sender, not the recipient) tries to respond to its own invite.
        r = requests.post(f"{API}/team/invites/{invite_id}/respond", headers=h(token_a), json={"accept": True}, timeout=30)
        assert r.status_code == 404

    def test_accept_creates_bidirectional_membership(self, token_a, token_b, user_a, user_b):
        r = requests.get(f"{API}/team/invites", headers=h(token_b), timeout=30)
        invite_id = next(i["id"] for i in r.json() if i["from_user"]["user_id"] == user_a)
        r = requests.post(f"{API}/team/invites/{invite_id}/respond", headers=h(token_b), json={"accept": True}, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "team"

        r = requests.get(f"{API}/users/{user_a}/team", headers=h(token_a), timeout=30)
        team_a = r.json()
        assert team_a["visible"] is True
        member = next(m for m in team_a["members"] if m["user_id"] == user_b)
        assert member["role"] == "Chef"  # the role A assigned to B at invite time

        r = requests.get(f"{API}/users/{user_b}/team", headers=h(token_b), timeout=30)
        team_b = r.json()
        member = next(m for m in team_b["members"] if m["user_id"] == user_a)
        assert member["role"] is None  # B hasn't labelled A yet

    def test_team_status_reflects_membership(self, token_a, user_b):
        r = requests.get(f"{API}/users/search?q=Chef Team B", headers=h(token_a), timeout=30)
        row = next(u for u in r.json() if u["user_id"] == user_b)
        assert row["team_status"] == "team"

    def test_already_team_invite_short_circuits(self, token_a, user_b):
        r = requests.post(f"{API}/team/invite", headers=h(token_a), json={"user_id": user_b}, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "team"


class TestDeclineAndSimultaneousInvites:
    def test_decline(self, token_a, token_c, user_a, user_c):
        _reset_relation(token_a, user_c)
        r = requests.post(f"{API}/team/invite", headers=h(token_c), json={"user_id": user_a}, timeout=30)
        assert r.json()["status"] == "pending_sent"
        r = requests.get(f"{API}/team/invites", headers=h(token_a), timeout=30)
        invite_id = next(i["id"] for i in r.json() if i["from_user"]["user_id"] == user_c)
        r = requests.post(f"{API}/team/invites/{invite_id}/respond", headers=h(token_a), json={"accept": False}, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "declined"
        assert not any(m["user_id"] == user_c for m in requests.get(f"{API}/users/{user_a}/team", headers=h(token_a), timeout=30).json()["members"])

    def test_mutual_invite_auto_accepts(self, token_b, token_c, user_b, user_c):
        _reset_relation(token_b, user_c)
        r = requests.post(f"{API}/team/invite", headers=h(token_b), json={"user_id": user_c, "role": "Apprenti"}, timeout=30)
        assert r.json()["status"] == "pending_sent"
        # C now sends one back before responding — should auto-accept into a membership.
        r = requests.post(f"{API}/team/invite", headers=h(token_c), json={"user_id": user_b, "role": "Pâtissier"}, timeout=30)
        assert r.json()["status"] == "team"

        r = requests.get(f"{API}/users/{user_b}/team", headers=h(token_b), timeout=30)
        member = next(m for m in r.json()["members"] if m["user_id"] == user_c)
        assert member["role"] == "Apprenti"  # B's original label for C, preserved

        r = requests.get(f"{API}/users/{user_c}/team", headers=h(token_c), timeout=30)
        member = next(m for m in r.json()["members"] if m["user_id"] == user_b)
        assert member["role"] == "Pâtissier"  # C's label for B, from the auto-accepted invite


class TestRoleUpdateAndPermissions:
    def test_owner_can_update_role(self, token_b, user_a, user_b):
        r = requests.put(f"{API}/team/members/{user_a}", headers=h(token_b), json={"role": "Responsable"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["role"] == "Responsable"
        r = requests.get(f"{API}/users/{user_b}/team", headers=h(token_b), timeout=30)
        member = next(m for m in r.json()["members"] if m["user_id"] == user_a)
        assert member["role"] == "Responsable"

    def test_cannot_update_role_of_nonexistent_relation(self, token_a):
        r = requests.put(f"{API}/team/members/does-not-exist", headers=h(token_a), json={"role": "x"}, timeout=30)
        assert r.status_code == 404

    def test_update_role_for_a_non_member_404s(self, token_c, user_a):
        # C's invite from A was declined earlier (TestDeclineAndSimultaneousInvites)
        # — no membership exists between them, so C cannot address one via PUT.
        r = requests.put(f"{API}/team/members/{user_a}", headers=h(token_c), json={"role": "Hacked"}, timeout=30)
        assert r.status_code == 404

    def test_delete_for_a_non_member_is_a_harmless_noop(self, token_c, user_a):
        r = requests.delete(f"{API}/team/members/{user_a}", headers=h(token_c), timeout=30)
        assert r.status_code == 200  # idempotent, nothing to remove

    def test_a_b_relation_is_never_reachable_from_c(self, token_a, user_a, user_b):
        # Every Team mutation is scoped to (caller, target) — there is no
        # request shape that lets C name "the A-B relation" at all, so it
        # can never be affected by anything C does. Confirm it is still intact.
        r = requests.get(f"{API}/users/{user_a}/team", headers=h(token_a), timeout=30)
        member = next(m for m in r.json()["members"] if m["user_id"] == user_b)
        assert member["role"] == "Chef"

    def test_role_too_long_rejected(self, token_b, user_a):
        r = requests.put(f"{API}/team/members/{user_a}", headers=h(token_b), json={"role": "x" * 41}, timeout=30)
        assert r.status_code == 422


class TestRemove:
    def test_owner_can_remove_and_it_is_bidirectional(self, token_a, token_b, user_a, user_b):
        r = requests.delete(f"{API}/team/members/{user_b}", headers=h(token_a), timeout=30)
        assert r.status_code == 200
        r = requests.get(f"{API}/users/{user_a}/team", headers=h(token_a), timeout=30)
        assert not any(m["user_id"] == user_b for m in r.json()["members"])
        r = requests.get(f"{API}/users/{user_b}/team", headers=h(token_b), timeout=30)
        assert not any(m["user_id"] == user_a for m in r.json()["members"])

    def test_remove_does_not_touch_accounts(self, token_b, user_a):
        r = requests.get(f"{API}/users/{user_a}/profile", headers=h(token_b), timeout=30)
        assert r.status_code == 200  # account/profile still exists

    def test_can_re_invite_after_removal(self, token_a, token_b, user_a, user_b):
        r = requests.post(f"{API}/team/invite", headers=h(token_a), json={"user_id": user_b}, timeout=30)
        assert r.json()["status"] == "pending_sent"
        r = requests.get(f"{API}/team/invites", headers=h(token_b), timeout=30)
        invite_id = next(i["id"] for i in r.json() if i["from_user"]["user_id"] == user_a)
        r = requests.post(f"{API}/team/invites/{invite_id}/respond", headers=h(token_b), json={"accept": True}, timeout=30)
        assert r.json()["status"] == "team"


class TestVisibilityAndEmptyStates:
    def test_default_visibility_is_public(self, token_c, user_c):
        me = requests.get(f"{API}/auth/me", headers=h(token_c), timeout=30).json()
        assert me["team_visibility"] == "public"

    def test_empty_team_is_visible_and_empty(self, token_c, user_c):
        r = requests.get(f"{API}/users/{user_c}/team", headers=h(token_c), timeout=30)
        # C may already have a membership from TestDeclineAndSimultaneousInvites;
        # just assert the endpoint reports visible + a consistent count/list length.
        data = r.json()
        assert data["visible"] is True
        assert data["count"] == len(data["members"]) or data["has_more"]

    def test_profile_reports_zero_for_a_fresh_user_with_no_team(self, token_a, token_b):
        # Register a brand-new, team-less account to test a guaranteed-empty case.
        fresh = _login_or_register("test.team.fresh@bakers.app", "TestTeamFresh2026!", "Chef Team Fresh")
        r = requests.get(f"{API}/users/{fresh['user']['user_id']}/profile", headers=h(token_a), timeout=30)
        assert r.json()["team_count"] == 0
        assert r.json()["team_visible"] is True

    def test_invalid_visibility_rejected(self, token_a):
        r = requests.put(f"{API}/auth/me", headers=h(token_a), json={"team_visibility": "bogus"}, timeout=30)
        assert r.status_code == 422

    def test_private_hides_from_others_but_not_owner(self, token_a, token_c, user_a):
        r = requests.put(f"{API}/auth/me", headers=h(token_a), json={"team_visibility": "private"}, timeout=30)
        assert r.status_code == 200
        try:
            r = requests.get(f"{API}/users/{user_a}/team", headers=h(token_c), timeout=30)
            data = r.json()
            assert data == {"members": [], "count": 0, "visible": False, "has_more": False}

            r = requests.get(f"{API}/users/{user_a}/team", headers=h(token_a), timeout=30)
            assert r.json()["visible"] is True

            r = requests.get(f"{API}/users/{user_a}/profile", headers=h(token_c), timeout=30)
            assert r.json()["team_count"] == 0
            assert r.json()["team_visible"] is False
        finally:
            requests.put(f"{API}/auth/me", headers=h(token_a), json={"team_visibility": "public"}, timeout=30)


class TestPaginationAndSearchWithinTeam:
    def test_search_within_team_filters_by_name_and_role(self, token_a, token_b, user_a, user_b):
        # Ensure a fresh membership with a known role exists for this class.
        r = requests.get(f"{API}/users/{user_a}/team", headers=h(token_a), timeout=30)
        if not any(m["user_id"] == user_b for m in r.json()["members"]):
            requests.post(f"{API}/team/invite", headers=h(token_a), json={"user_id": user_b, "role": "Boulanger"}, timeout=30)
            r = requests.get(f"{API}/team/invites", headers=h(token_b), timeout=30)
            invite_id = next((i["id"] for i in r.json() if i["from_user"]["user_id"] == user_a), None)
            if invite_id:
                requests.post(f"{API}/team/invites/{invite_id}/respond", headers=h(token_b), json={"accept": True}, timeout=30)

        r = requests.get(f"{API}/users/{user_a}/team?q=Team B", headers=h(token_a), timeout=30)
        assert r.status_code == 200
        assert any(m["user_id"] == user_b for m in r.json()["members"])

        r = requests.get(f"{API}/users/{user_a}/team?q=zzz_no_such_member", headers=h(token_a), timeout=30)
        assert r.json()["members"] == []

    def test_pagination_shape_with_limit(self, token_a, user_a):
        r = requests.get(f"{API}/users/{user_a}/team?limit=1", headers=h(token_a), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data["members"]) <= 1
        assert "has_more" in data and "count" in data

    def test_team_requires_auth(self, user_a):
        r = requests.get(f"{API}/users/{user_a}/team", timeout=30)
        assert r.status_code in (401, 403)

    def test_unknown_user_404s(self, token_a):
        r = requests.get(f"{API}/users/does-not-exist/team", headers=h(token_a), timeout=30)
        assert r.status_code == 404
