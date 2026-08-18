"""Staff schedule calculations.

Pure functions, no DB or network, so the arithmetic a manager relies on can be
tested directly rather than through HTTP. Everything is counted in minutes and
only formatted at the edges, which keeps the totals exact.
"""
import re
from typing import List, Optional

DAYS = 7  # Sunday through Saturday, matching the printed layout.
MAX_EMPLOYEES = 15

_TIME = re.compile(r"^\s*(\d{1,2})\s*[:hH]\s*(\d{1,2})?\s*$")


def parse_time(value: str) -> Optional[int]:
    """"8:00" or "8h30" -> minutes since midnight. None when unreadable.

    Accepts a missing minutes part ("8h" is 8:00) because that is how a hurried
    thumb types it, but refuses out-of-range values rather than wrapping them.
    """
    if not value:
        return None
    m = _TIME.match(str(value))
    if not m:
        return None
    hours = int(m.group(1))
    minutes = int(m.group(2) or 0)
    if hours > 24 or minutes > 59:
        return None
    if hours == 24 and minutes:
        return None
    return hours * 60 + minutes


def format_hours(total_minutes: int) -> str:
    """Minutes -> "32:00". Hours are not capped at 24: a week total exceeds it."""
    total_minutes = max(0, int(total_minutes))
    return f"{total_minutes // 60}:{total_minutes % 60:02d}"


def shift_minutes(start: str, end: str) -> Optional[int]:
    """Length of one shift, or None if either end is unreadable.

    A shift ending earlier than it starts has run past midnight (22:00 → 06:00
    is eight hours, not minus sixteen), so a day is added. Equal times mean a
    zero-length shift rather than a full 24 hours — nobody schedules that, and
    reading it as a whole day would silently inflate the week.
    """
    a, b = parse_time(start), parse_time(end)
    if a is None or b is None:
        return None
    if b < a:
        b += 24 * 60
    return b - a


def normalize_day(day: Optional[dict]) -> dict:
    """One cell of the grid, resolved to a shift length.

    A day off, an empty cell and an unreadable time are three different things
    and stay distinguishable: `off` is deliberate, `invalid` needs the manager's
    attention, and neither is silently counted as zero worked hours.
    """
    if not day or not isinstance(day, dict):
        return {"off": False, "start": "", "end": "", "minutes": 0, "invalid": False}
    if day.get("off"):
        return {"off": True, "start": "", "end": "", "minutes": 0, "invalid": False}

    start = (day.get("start") or "").strip()
    end = (day.get("end") or "").strip()
    if not start and not end:
        return {"off": False, "start": "", "end": "", "minutes": 0, "invalid": False}

    minutes = shift_minutes(start, end)
    return {
        "off": False,
        "start": start,
        "end": end,
        "minutes": minutes or 0,
        "invalid": minutes is None,
    }


def normalize_employee(employee: dict) -> dict:
    """Resolve one row: seven days, plus any manually entered overtime.

    Overtime is entered by hand rather than derived from a threshold — Baker is
    not told what a normal week is, and guessing one would produce figures a
    manager could not justify to their staff.
    """
    days = list(employee.get("days") or [])
    days = (days + [None] * DAYS)[:DAYS]
    resolved = [normalize_day(d) for d in days]

    worked = sum(d["minutes"] for d in resolved)
    overtime = max(0, int(employee.get("overtime_minutes") or 0))

    return {
        "employee_id": employee.get("employee_id"),
        "name": (employee.get("name") or "").strip(),
        "days": resolved,
        "worked_minutes": worked,
        "overtime_minutes": overtime,
        "total_minutes": worked + overtime,
        "has_invalid": any(d["invalid"] for d in resolved),
    }


def summarize(employees: List[dict]) -> dict:
    """Everything the grid, the export and the print layout need."""
    rows = [normalize_employee(e) for e in (employees or [])]

    day_totals = [
        sum(r["days"][i]["minutes"] for r in rows)
        for i in range(DAYS)
    ]
    # The grand total counts overtime too, so it matches the right-hand column.
    grand_total = sum(r["total_minutes"] for r in rows)

    return {
        "employees": rows,
        "day_totals": day_totals,
        "grand_total_minutes": grand_total,
        "has_invalid": any(r["has_invalid"] for r in rows),
    }
