"""Staff schedule API: CRUD, validation, ownership isolation, duplication.

Each class registers its own account so one test's schedules never appear in
another's listing. The server must be running (see CLAUDE.md).
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"

SUNDAY = "2026-08-23"       # a real Sunday
NEXT_SUNDAY = "2026-08-30"
MONDAY = "2026-08-24"


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def register():
    email = f"staff.{uuid.uuid4().hex[:10]}@bakers.app"
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": "TestStaff2026!", "name": "Gérant"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def day(start="", end="", off=False):
    return {"start": start, "end": end, "off": off}


def week(*days):
    return list(days) + [None] * (7 - len(days))


def employee(name, *days, overtime=0):
    return {"name": name, "days": week(*days), "overtime_minutes": overtime}


@pytest.fixture(scope="class")
def token():
    return register()


class TestScheduleCrud:
    def test_create_and_read_back(self, token):
        h = auth_headers(token)
        body = {
            "week_start": SUNDAY,
            "notes": "Armand off jeudi",
            "employees": [
                employee("ARMAND", None, day("4:00", "12:00"), day("8:00", "16:00")),
                employee("JEANNE", day("4:00", "12:00"), day(off=True)),
            ],
        }
        r = requests.post(f"{API}/schedules", json=body, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        created = r.json()

        assert created["week_start"] == SUNDAY
        assert created["notes"] == "Armand off jeudi"
        assert len(created["employees"]) == 2
        # 8 h + 8 h for Armand, 8 h for Jeanne
        assert created["grand_total_minutes"] == 24 * 60
        assert created["employees"][0]["total_minutes"] == 16 * 60
        assert created["employees"][1]["days"][1]["off"] is True

        got = requests.get(f"{API}/schedules/{created['id']}", headers=h, timeout=30)
        assert got.status_code == 200
        assert got.json()["grand_total_minutes"] == 24 * 60

    def test_day_totals_are_returned(self, token):
        h = auth_headers(token)
        body = {"week_start": SUNDAY, "employees": [
            employee("A", day("8:00", "12:00")),
            employee("B", day("8:00", "10:00")),
        ]}
        r = requests.post(f"{API}/schedules", json=body, headers=h, timeout=30)
        assert r.json()["day_totals"][0] == 6 * 60

    def test_update_recomputes(self, token):
        h = auth_headers(token)
        created = requests.post(f"{API}/schedules", json={
            "week_start": SUNDAY, "employees": [employee("A", day("8:00", "12:00"))],
        }, headers=h, timeout=30).json()

        updated = requests.put(f"{API}/schedules/{created['id']}", json={
            "week_start": SUNDAY, "notes": "modifié",
            "employees": [employee("A", day("8:00", "18:00"))],
        }, headers=h, timeout=30)
        assert updated.status_code == 200, updated.text
        assert updated.json()["grand_total_minutes"] == 10 * 60
        assert updated.json()["notes"] == "modifié"

    def test_listing_and_delete(self, token):
        h = auth_headers(token)
        created = requests.post(f"{API}/schedules", json={
            "week_start": NEXT_SUNDAY, "employees": [employee("Z", day("8:00", "9:00"))],
        }, headers=h, timeout=30).json()

        listed = requests.get(f"{API}/schedules", headers=h, timeout=30).json()
        assert any(s["id"] == created["id"] for s in listed)
        row = next(s for s in listed if s["id"] == created["id"])
        assert row["employee_count"] == 1 and row["grand_total_minutes"] == 60

        assert requests.delete(f"{API}/schedules/{created['id']}", headers=h, timeout=30).status_code == 200
        assert requests.get(f"{API}/schedules/{created['id']}", headers=h, timeout=30).status_code == 404

    def test_overtime_is_added_to_the_total(self, token):
        h = auth_headers(token)
        r = requests.post(f"{API}/schedules", json={
            "week_start": SUNDAY,
            "employees": [employee("SUPP", day("8:00", "16:00"), overtime=120)],
        }, headers=h, timeout=30)
        assert r.json()["grand_total_minutes"] == 10 * 60

    def test_night_shift_crossing_midnight(self, token):
        h = auth_headers(token)
        r = requests.post(f"{API}/schedules", json={
            "week_start": SUNDAY, "employees": [employee("NUIT", day("22:00", "6:00"))],
        }, headers=h, timeout=30)
        assert r.json()["grand_total_minutes"] == 8 * 60


class TestValidation:
    def test_week_must_start_on_a_sunday(self, token):
        r = requests.post(f"{API}/schedules", json={"week_start": MONDAY, "employees": []},
                          headers=auth_headers(token), timeout=30)
        assert r.status_code == 422
        assert "dimanche" in r.text.lower()

    def test_malformed_date(self, token):
        r = requests.post(f"{API}/schedules", json={"week_start": "23/08/2026", "employees": []},
                          headers=auth_headers(token), timeout=30)
        assert r.status_code == 422

    def test_nameless_employee_is_refused(self, token):
        r = requests.post(f"{API}/schedules", json={
            "week_start": SUNDAY, "employees": [employee("   ", day("8:00", "9:00"))],
        }, headers=auth_headers(token), timeout=30)
        assert r.status_code == 422
        assert "nom" in r.text.lower()

    def test_invalid_hours_are_refused_with_the_name(self, token):
        r = requests.post(f"{API}/schedules", json={
            "week_start": SUNDAY, "employees": [employee("LUCAS", day("8:00", "midi"))],
        }, headers=auth_headers(token), timeout=30)
        assert r.status_code == 422
        assert "LUCAS" in r.text

    def test_sixteen_employees_are_refused(self, token):
        r = requests.post(f"{API}/schedules", json={
            "week_start": SUNDAY,
            "employees": [employee(f"E{i}", day("8:00", "9:00")) for i in range(16)],
        }, headers=auth_headers(token), timeout=30)
        assert r.status_code == 422

    def test_fifteen_employees_are_accepted(self, token):
        r = requests.post(f"{API}/schedules", json={
            "week_start": NEXT_SUNDAY,
            "employees": [employee(f"E{i}", *[day("8:00", "16:00")] * 5) for i in range(15)],
        }, headers=auth_headers(token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["grand_total_minutes"] == 15 * 40 * 60

    def test_negative_overtime_is_refused(self, token):
        r = requests.post(f"{API}/schedules", json={
            "week_start": SUNDAY, "employees": [employee("A", day("8:00", "9:00"), overtime=-60)],
        }, headers=auth_headers(token), timeout=30)
        assert r.status_code == 422

    def test_empty_schedule_is_allowed_as_a_draft(self, token):
        r = requests.post(f"{API}/schedules", json={"week_start": SUNDAY, "employees": []},
                          headers=auth_headers(token), timeout=30)
        assert r.status_code == 200
        assert r.json()["grand_total_minutes"] == 0


class TestPermissions:
    def test_another_users_schedule_is_not_found(self):
        mine = register()
        theirs = register()
        created = requests.post(f"{API}/schedules", json={
            "week_start": SUNDAY, "employees": [employee("SECRET", day("8:00", "9:00"))],
        }, headers=auth_headers(mine), timeout=30).json()

        # 404 rather than 403: the id's existence is not revealed either.
        for call in (
            requests.get(f"{API}/schedules/{created['id']}", headers=auth_headers(theirs), timeout=30),
            requests.delete(f"{API}/schedules/{created['id']}", headers=auth_headers(theirs), timeout=30),
        ):
            assert call.status_code == 404

        assert all(s["id"] != created["id"]
                   for s in requests.get(f"{API}/schedules", headers=auth_headers(theirs), timeout=30).json())

    def test_authentication_is_required(self):
        assert requests.get(f"{API}/schedules", timeout=30).status_code in (401, 403)


class TestDuplicate:
    def test_duplicating_copies_the_week(self, token):
        h = auth_headers(token)
        source = requests.post(f"{API}/schedules", json={
            "week_start": SUNDAY, "notes": "note de la semaine",
            "employees": [employee("ARMAND", day("4:00", "12:00"), day(off=True), overtime=60)],
        }, headers=h, timeout=30).json()

        copy = requests.post(f"{API}/schedules/{source['id']}/duplicate",
                             json={"week_start": NEXT_SUNDAY}, headers=h, timeout=30)
        assert copy.status_code == 200, copy.text
        body = copy.json()

        assert body["id"] != source["id"]
        assert body["week_start"] == NEXT_SUNDAY
        assert body["employees"][0]["name"] == "ARMAND"
        assert body["employees"][0]["days"][1]["off"] is True
        assert body["grand_total_minutes"] == source["grand_total_minutes"]
        # The note belongs to its own week and is deliberately not carried over.
        assert body["notes"] == ""

    def test_duplicate_rejects_a_non_sunday(self, token):
        h = auth_headers(token)
        source = requests.post(f"{API}/schedules", json={"week_start": SUNDAY, "employees": []},
                               headers=h, timeout=30).json()
        r = requests.post(f"{API}/schedules/{source['id']}/duplicate",
                          json={"week_start": MONDAY}, headers=h, timeout=30)
        assert r.status_code == 422

    def test_duplicating_someone_elses_schedule_is_not_found(self):
        mine, theirs = register(), register()
        source = requests.post(f"{API}/schedules", json={"week_start": SUNDAY, "employees": []},
                               headers=auth_headers(mine), timeout=30).json()
        r = requests.post(f"{API}/schedules/{source['id']}/duplicate",
                          json={"week_start": NEXT_SUNDAY}, headers=auth_headers(theirs), timeout=30)
        assert r.status_code == 404
