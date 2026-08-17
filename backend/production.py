"""Production planning maths.

Pure functions: no database, no network, no framework. Everything here is
deterministic and unit-testable, which matters because these calculations are
what a baker actually relies on at 3am.

Two rules run through the whole module:
  - Never invent data. A duration that is not in the recipe stays missing until
    a human supplies it; an ingredient line we cannot parse is carried through
    verbatim rather than guessed at.
  - Never silently merge things a baker would keep apart (T65 and T45 flour are
    different products; adding them together would produce a wrong shopping
    list).
"""
import re
import unicodedata
import uuid
from datetime import datetime, timedelta
from typing import List, Optional

# ---------- Durations ----------
# Longest alternative first: "heures" must win over "h" so that "2 heures 30"
# is not read as 2 hours followed by the stray letters "eures".
_H_AND_M = re.compile(r"(\d+)\s*(?:heures?|h)\s*(\d+)\s*(?:min\w*)?", re.I)
_H_ONLY = re.compile(r"(\d+)\s*(?:heures?|h)\b", re.I)
_M_ONLY = re.compile(r"(\d+)\s*(?:min\w*)\b", re.I)


def parse_duration(text: str) -> Optional[int]:
    """Minutes found in a free-text step, or None.

    Handles "45 min", "2 h", "1 h 30", "1h30", "2 heures 30 min".
    Returns None rather than a guess when nothing is stated.

    Temperatures are safe: "250°C" has no time unit after the digits, and the
    `\\s*` between value and unit refuses to jump over intervening words, so
    "2 h à température ambiante avec 2 rabats" reads as 2 h and not 2 h 2 min.
    """
    if not text:
        return None
    m = _H_AND_M.search(text)
    if m:
        hours, minutes = int(m.group(1)), int(m.group(2))
        # A "minutes" part of 60+ means we latched onto an unrelated number.
        if minutes < 60:
            return hours * 60 + minutes
    m = _H_ONLY.search(text)
    if m:
        return int(m.group(1)) * 60
    m = _M_ONLY.search(text)
    if m:
        return int(m.group(1))
    return None


# ---------- Ingredients ----------
# Quantity + unit + name. The name is required, so "3 œufs" (no unit) is left
# unparsed on purpose rather than being invented a unit for.
_INGREDIENT = re.compile(
    r"^\s*([\d]+(?:[.,]\d+)?)\s*(kg|g|cl|ml|l)\b\s*(?:de\s+|d[''’]\s*)?(.+?)\s*$",
    re.I,
)

# Everything is summed in a base unit so 1 kg + 500 g adds up correctly.
_UNIT_BASE = {
    "g": ("g", 1.0),
    "kg": ("g", 1000.0),
    "ml": ("ml", 1.0),
    "cl": ("ml", 10.0),
    "l": ("ml", 1000.0),
}


def normalize_name(name: str) -> str:
    """Grouping key for an ingredient name.

    Case, accents and spacing are ignored ("Farine T65" == "farine  t65"), but
    nothing else is: "farine T65" and "farine T45" stay distinct because they
    are distinct products.
    """
    n = unicodedata.normalize("NFD", (name or "").strip().lower())
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    n = re.sub(r"\s+", " ", n)
    return n.strip(" .,;:")


def parse_ingredient(line: str) -> Optional[dict]:
    """`"500 g de farine T65"` -> quantity/unit/name, or None if not parseable."""
    if not line:
        return None
    m = _INGREDIENT.match(line)
    if not m:
        return None
    raw_qty, unit, name = m.group(1), m.group(2).lower(), m.group(3)
    if unit not in _UNIT_BASE:
        return None
    try:
        qty = float(raw_qty.replace(",", "."))
    except ValueError:
        return None
    return {"quantity": qty, "unit": unit, "name": name.strip()}


def format_quantity(base_qty: float, base_unit: str) -> dict:
    """Pick the unit a baker would write: 1500 g -> 1.5 kg, 250 g -> 250 g."""
    if base_unit == "g":
        big, small = "kg", "g"
    else:
        big, small = "l", "ml"
    if base_qty >= 1000:
        value = round(base_qty / 1000, 3)
        unit = big
    else:
        value = round(base_qty, 1)
        unit = small
    # Drop a pointless trailing .0 so the UI shows "5 kg", not "5.0 kg".
    if value == int(value):
        value = int(value)
    return {"quantity": value, "unit": unit}


def scale_ingredients(ingredient_lines: List[str], factor: float) -> List[dict]:
    """Multiply each ingredient line by `factor`.

    Unparseable lines are kept in place with `parsed: False` and no quantity —
    the baker still sees "1 œuf pour dorure", flagged as needing their judgement.
    """
    out = []
    for line in ingredient_lines or []:
        parsed = parse_ingredient(line)
        if not parsed:
            out.append({"raw": line, "parsed": False})
            continue
        base_unit, mult = _UNIT_BASE[parsed["unit"]]
        out.append({
            "raw": line,
            "parsed": True,
            "name": parsed["name"],
            "base_quantity": parsed["quantity"] * mult * factor,
            "base_unit": base_unit,
        })
    return out


def aggregate_ingredients(scaled_lines: List[dict]) -> dict:
    """Sum scaled ingredients across every recipe of a production.

    Returns `{"items": [...], "unparsed": [...]}`. Items are sorted heaviest
    first, which is the order a baker weighs them in.
    """
    totals: dict = {}
    unparsed: List[str] = []
    for line in scaled_lines:
        if not line.get("parsed"):
            if line.get("raw"):
                unparsed.append(line["raw"])
            continue
        key = (normalize_name(line["name"]), line["base_unit"])
        entry = totals.setdefault(key, {"name": line["name"], "base_quantity": 0.0, "base_unit": line["base_unit"]})
        entry["base_quantity"] += line["base_quantity"]

    items = []
    for entry in totals.values():
        display = format_quantity(entry["base_quantity"], entry["base_unit"])
        items.append({
            "name": entry["name"],
            "quantity": display["quantity"],
            "unit": display["unit"],
            "base_quantity": round(entry["base_quantity"], 3),
            "base_unit": entry["base_unit"],
        })
    items.sort(key=lambda i: (-i["base_quantity"], i["name"]))
    # De-duplicate the free-text lines too, keeping first-seen order.
    seen = set()
    unique_unparsed = [u for u in unparsed if not (u in seen or seen.add(u))]
    return {"items": items, "unparsed": unique_unparsed}


# ---------- Quantities ----------
def compute_batches(quantity: float, mode: str, yield_pieces: Optional[int]) -> float:
    """How many times a recipe must be made.

    In "pieces" mode this needs the recipe's yield; without it there is no
    honest conversion, so the caller is expected to have fallen back to
    "batches" mode (see `normalize_line`).
    """
    qty = float(quantity or 0)
    if mode == "pieces":
        if not yield_pieces or yield_pieces <= 0:
            return 0.0
        return qty / float(yield_pieces)
    return qty


def normalize_line(line: dict) -> dict:
    """Resolve one production line into a usable batch multiplier.

    A line asking for pieces on a recipe with no declared yield is downgraded
    to batches rather than rejected — the baker keeps working, and the UI can
    explain why the unit changed.
    """
    mode = line.get("mode") or "batches"
    yield_pieces = line.get("yield_pieces")
    if mode == "pieces" and (not yield_pieces or yield_pieces <= 0):
        mode = "batches"
    return {**line, "mode": mode, "batches": compute_batches(line.get("quantity", 0), mode, yield_pieces)}


def total_pieces(lines: List[dict]) -> Optional[int]:
    """Total piece count, or None when at least one line cannot express pieces."""
    if not lines:
        return 0
    total = 0
    for line in lines:
        if line.get("mode") == "pieces":
            total += int(round(float(line.get("quantity") or 0)))
        else:
            y = line.get("yield_pieces")
            if not y or y <= 0:
                return None
            total += int(round(float(line.get("batches") or 0) * y))
    return total


# ---------- Steps and schedule ----------
def build_steps(line_id: str, recipe_title: str, step_texts: List[str]) -> List[dict]:
    """Turn a recipe's free-text steps into trackable production steps."""
    steps = []
    for order, text in enumerate(step_texts or []):
        duration = parse_duration(text)
        steps.append({
            "step_id": str(uuid.uuid4()),
            "line_id": line_id,
            "recipe_title": recipe_title,
            "order": order,
            "text": text,
            "duration_minutes": duration,
            "duration_source": "recipe" if duration is not None else None,
            "status": "todo",
            "start_at": None,
            "end_at": None,
        })
    return steps


def compute_schedule(steps: List[dict], date: str, target_time: Optional[str]) -> dict:
    """Back-plan every recipe from the target time.

    Each recipe is scheduled independently so that all of them come out of the
    oven at the target time. Walking backwards from the end, a step with no
    duration can still be given an end time, but neither its own start nor
    anything before it can be placed — those stay null and are reported in
    `missing_durations` rather than filled with a guess.

    Times are full timestamps, not clock times: a bake finishing at 06:00 very
    often starts the previous evening, and "22:00" alone would be ambiguous.
    """
    for step in steps:
        step["start_at"] = None
        step["end_at"] = None

    missing = [s["step_id"] for s in steps if s.get("duration_minutes") is None]
    if not target_time or not date:
        return {"steps": steps, "missing_durations": missing, "scheduled": False}

    try:
        target = datetime.fromisoformat(f"{date}T{target_time}")
    except ValueError:
        return {"steps": steps, "missing_durations": missing, "scheduled": False}

    by_line: dict = {}
    for step in steps:
        by_line.setdefault(step.get("line_id"), []).append(step)

    for line_steps in by_line.values():
        line_steps.sort(key=lambda s: s.get("order", 0))
        cursor: Optional[datetime] = target
        for step in reversed(line_steps):
            if cursor is None:
                continue
            step["end_at"] = cursor.isoformat()
            duration = step.get("duration_minutes")
            if duration is None:
                # Unknown length: we know when it must finish, not when to start,
                # so the chain upstream of it cannot be dated either.
                cursor = None
            else:
                cursor = cursor - timedelta(minutes=int(duration))
                step["start_at"] = cursor.isoformat()

    return {"steps": steps, "missing_durations": missing, "scheduled": True}


def summarize(lines: List[dict], steps: List[dict], date: str, target_time: Optional[str]) -> dict:
    """Everything the planning screens need, derived from stored data."""
    normalized = [normalize_line(l) for l in (lines or [])]
    scaled: List[dict] = []
    for line in normalized:
        scaled.extend(scale_ingredients(line.get("ingredients") or [], line.get("batches") or 0))
    schedule = compute_schedule(steps or [], date, target_time)
    return {
        "lines": normalized,
        "ingredients": aggregate_ingredients(scaled),
        "steps": schedule["steps"],
        "missing_durations": schedule["missing_durations"],
        "scheduled": schedule["scheduled"],
        "total_pieces": total_pieces(normalized),
    }
