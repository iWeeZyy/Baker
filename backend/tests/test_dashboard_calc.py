"""Unit tests for the manager dashboard's pure aggregation (phase 7d).

Pure functions, no server needed — same family as test_production_calc.py/
test_staff_calc.py.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dashboard import (  # noqa: E402
    PERIOD_DAYS,
    _date_floor,
    period_start,
    summarize_cost,
    summarize_production,
    summarize_staff,
    summarize_tasks,
)


class TestPeriodStart:
    def test_week_month_year(self):
        now = datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc)
        assert period_start("week", now) == datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc)
        assert period_start("month", now) == datetime(2026, 8, 18, 12, 0, tzinfo=timezone.utc)
        assert period_start("year", now) == datetime(2025, 9, 17, 12, 0, tzinfo=timezone.utc)

    def test_all_has_no_lower_bound(self):
        assert period_start("all") is None

    def test_unknown_period_raises(self):
        try:
            period_start("decade")
            assert False, "aurait dû lever"
        except ValueError:
            pass

    def test_every_declared_period_is_handled(self):
        for period in PERIOD_DAYS:
            period_start(period)  # ne lève pas


class TestDateFloor:
    def test_formats_as_iso_date(self):
        now = datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc)
        assert _date_floor("week", now) == "2026-09-10"

    def test_all_has_no_floor(self):
        assert _date_floor("all") is None


class TestSummarizeProduction:
    def test_empty(self):
        result = summarize_production([])
        assert result["production_count"] == 0
        assert result["ingredients"]["items"] == []

    def test_aggregates_across_several_productions(self):
        docs = [
            {"lines": [{"mode": "batches", "quantity": 2, "ingredients": ["500 g de farine T65"]}]},
            {"lines": [{"mode": "batches", "quantity": 1, "ingredients": ["500 g de farine T65"]}]},
        ]
        result = summarize_production(docs)
        assert result["production_count"] == 2
        item = result["ingredients"]["items"][0]
        assert item["name"] == "farine T65"
        # 2 fournées + 1 fournée = 1500 g -> 1.5 kg
        assert item["quantity"] == 1.5
        assert item["unit"] == "kg"

    def test_pieces_mode_needs_a_yield(self):
        docs = [{"lines": [{
            "mode": "pieces", "quantity": 20, "yield_pieces": 10,
            "ingredients": ["100 g de sucre"],
        }]}]
        result = summarize_production(docs)
        # 20 pièces / 10 par fournée = 2 fournées -> 200 g de sucre
        item = result["ingredients"]["items"][0]
        assert item["quantity"] == 200
        assert item["unit"] == "g"


class TestSummarizeStaff:
    def test_empty(self):
        result = summarize_staff([])
        assert result == {
            "schedule_count": 0, "worked_minutes": 0, "overtime_minutes": 0, "total_minutes": 0,
        }

    def test_sums_across_schedules(self):
        docs = [
            {"employees": [{"name": "Armand", "days": [{"start": "8:00", "end": "12:00"}], "overtime_minutes": 30}]},
            {"employees": [{"name": "Julie", "days": [{"start": "6:00", "end": "14:00"}]}]},
        ]
        result = summarize_staff(docs)
        assert result["schedule_count"] == 2
        assert result["worked_minutes"] == 240 + 480
        assert result["overtime_minutes"] == 30
        assert result["total_minutes"] == 240 + 480 + 30


class TestSummarizeCost:
    def test_empty(self):
        result = summarize_cost([])
        assert result["calculation_count"] == 0
        assert result["total_cost"] is None
        assert result["total_margin"] is None

    def test_a_calculation_without_a_price_does_not_count_as_zero(self):
        docs = [{"result": {"total_cost": None}, "sale": {"margin_total": None}}]
        result = summarize_cost(docs)
        assert result["calculation_count"] == 1
        assert result["priced_count"] == 0
        assert result["total_cost"] is None
        assert result["margin_count"] == 0
        assert result["total_margin"] is None

    def test_sums_priced_and_margined_calculations_separately(self):
        docs = [
            {"result": {"total_cost": 10.0}, "sale": {"margin_total": None}},
            {"result": {"total_cost": 5.5}, "sale": {"margin_total": 12.25}},
        ]
        result = summarize_cost(docs)
        assert result["calculation_count"] == 2
        assert result["priced_count"] == 2
        assert result["total_cost"] == 15.5
        # Un seul des deux calculs a une marge : l'autre n'y contribue pas.
        assert result["margin_count"] == 1
        assert result["total_margin"] == 12.25


class TestSummarizeTasks:
    def test_a_member_with_nothing_assigned_still_appears_at_zero(self):
        result = summarize_tasks([], roster_user_ids=["u1", "u2"])
        assert result["by_member"] == {
            "u1": {"todo": 0, "doing": 0, "done": 0},
            "u2": {"todo": 0, "doing": 0, "done": 0},
        }
        assert result["unassigned_steps"] == 0

    def test_counts_by_status_and_member(self):
        docs = [{"steps": [
            {"assignee_user_id": "u1", "status": "done"},
            {"assignee_user_id": "u1", "status": "doing"},
            {"assignee_user_id": "u2", "status": "todo"},
            {"assignee_user_id": None, "status": "todo"},
        ]}]
        result = summarize_tasks(docs, roster_user_ids=["u1", "u2"])
        assert result["by_member"]["u1"] == {"todo": 0, "doing": 1, "done": 1}
        assert result["by_member"]["u2"] == {"todo": 1, "doing": 0, "done": 0}
        assert result["unassigned_steps"] == 1

    def test_a_former_member_with_historical_steps_still_appears(self):
        """Un compte qui n'est plus dans le roster actif (retiré de
        l'organisation depuis) ne doit jamais faire disparaître silencieusement
        les étapes qu'il a déjà faites."""
        docs = [{"steps": [{"assignee_user_id": "gone", "status": "done"}]}]
        result = summarize_tasks(docs, roster_user_ids=["u1"])
        assert result["by_member"]["gone"] == {"todo": 0, "doing": 0, "done": 1}
        assert result["by_member"]["u1"] == {"todo": 0, "doing": 0, "done": 0}
