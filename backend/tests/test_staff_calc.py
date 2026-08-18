"""Staff schedule arithmetic — pure unit tests, no server needed."""
import pytest

from staff import (
    DAYS, format_hours, normalize_day, normalize_employee, parse_time,
    shift_minutes, summarize,
)


def day(start="", end="", off=False):
    return {"start": start, "end": end, "off": off}


def week(*days):
    """Pad a partial week out to seven days."""
    return list(days) + [None] * (DAYS - len(days))


class TestParseTime:
    @pytest.mark.parametrize("text,expected", [
        ("8:00", 480), ("08:00", 480), ("8h30", 510), ("8 h 30", 510),
        ("0:00", 0), ("12:00", 720), ("23:59", 1439), ("24:00", 1440), ("8h", 480),
    ])
    def test_readable(self, text, expected):
        assert parse_time(text) == expected

    @pytest.mark.parametrize("text", ["", None, "midi", "25:00", "8:75", "24:30", "abc", "-1:00"])
    def test_unreadable(self, text):
        assert parse_time(text) is None


class TestShift:
    def test_ordinary_day(self):
        assert shift_minutes("8:00", "16:00") == 8 * 60

    def test_crossing_midnight(self):
        """A baker starting at 22:00 and finishing at 06:00 works eight hours."""
        assert shift_minutes("22:00", "6:00") == 8 * 60

    def test_early_morning(self):
        assert shift_minutes("4:00", "12:00") == 8 * 60

    def test_equal_times_is_zero_not_a_full_day(self):
        assert shift_minutes("8:00", "8:00") == 0

    def test_unreadable_end_is_none(self):
        assert shift_minutes("8:00", "plus tard") is None


class TestFormat:
    @pytest.mark.parametrize("minutes,text", [
        (0, "0:00"), (480, "8:00"), (1920, "32:00"), (2340, "39:00"),
        (90, "1:30"), (13740, "229:00"),
    ])
    def test_format(self, minutes, text):
        assert format_hours(minutes) == text

    def test_never_negative(self):
        assert format_hours(-60) == "0:00"


class TestDay:
    def test_day_off_counts_zero(self):
        d = normalize_day(day(off=True))
        assert d["off"] is True and d["minutes"] == 0 and d["invalid"] is False

    def test_empty_cell_is_not_a_day_off(self):
        d = normalize_day(None)
        assert d["off"] is False and d["minutes"] == 0

    def test_invalid_is_flagged_rather_than_counted_as_zero(self):
        d = normalize_day(day("8:00", "n'importe quoi"))
        assert d["invalid"] is True and d["minutes"] == 0

    def test_day_off_wins_over_any_times(self):
        assert normalize_day({"start": "8:00", "end": "16:00", "off": True})["minutes"] == 0


class TestEmployee:
    def test_totals_across_the_week(self):
        e = normalize_employee({
            "name": "ARMAND",
            "days": week(None, day("4:00", "12:00"), day("8:00", "16:00"), day(off=True)),
        })
        assert e["worked_minutes"] == 16 * 60
        assert e["total_minutes"] == 16 * 60
        assert e["overtime_minutes"] == 0

    def test_manual_overtime_is_added(self):
        e = normalize_employee({
            "name": "GUILLAUME",
            "days": week(day("8:00", "16:00")),
            "overtime_minutes": 120,
        })
        assert e["worked_minutes"] == 8 * 60
        assert e["total_minutes"] == 10 * 60

    def test_negative_overtime_is_floored(self):
        e = normalize_employee({"name": "X", "days": week(), "overtime_minutes": -300})
        assert e["overtime_minutes"] == 0

    def test_week_is_always_seven_days(self):
        assert len(normalize_employee({"name": "X", "days": []})["days"]) == DAYS

    def test_extra_days_are_dropped(self):
        e = normalize_employee({"name": "X", "days": [day("8:00", "9:00")] * 10})
        assert len(e["days"]) == DAYS
        assert e["worked_minutes"] == DAYS * 60

    def test_invalid_day_surfaces_on_the_employee(self):
        e = normalize_employee({"name": "X", "days": week(day("8:00", "?"))})
        assert e["has_invalid"] is True


class TestSummary:
    def test_empty_schedule(self):
        s = summarize([])
        assert s["grand_total_minutes"] == 0
        assert s["day_totals"] == [0] * DAYS
        assert s["employees"] == []

    def test_single_employee(self):
        s = summarize([{"name": "SEUL", "days": week(day("6:00", "14:00"))}])
        assert s["grand_total_minutes"] == 8 * 60
        assert s["day_totals"][0] == 8 * 60

    def test_day_totals_sum_each_column(self):
        s = summarize([
            {"name": "A", "days": week(day("8:00", "12:00"), day("8:00", "16:00"))},
            {"name": "B", "days": week(day("8:00", "10:00"), day(off=True))},
        ])
        assert s["day_totals"][0] == 6 * 60   # 4 h + 2 h
        assert s["day_totals"][1] == 8 * 60   # 8 h + jour de repos
        assert s["grand_total_minutes"] == 14 * 60

    def test_grand_total_includes_overtime(self):
        s = summarize([{"name": "A", "days": week(day("8:00", "16:00")), "overtime_minutes": 60}])
        assert s["grand_total_minutes"] == 9 * 60

    def test_fifteen_employees(self):
        s = summarize([
            {"name": f"E{i}", "days": week(*[day("8:00", "16:00")] * 5)}
            for i in range(15)
        ])
        assert len(s["employees"]) == 15
        assert s["grand_total_minutes"] == 15 * 40 * 60

    def test_a_night_shift_does_not_break_the_totals(self):
        s = summarize([{"name": "NUIT", "days": week(day("22:00", "6:00"))}])
        assert s["grand_total_minutes"] == 8 * 60

    def test_invalid_bubbles_up(self):
        assert summarize([{"name": "A", "days": week(day("8:00", "zz"))}])["has_invalid"] is True
