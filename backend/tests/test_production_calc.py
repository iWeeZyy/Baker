"""Unit tests for the production planning maths.

Pure functions, no server needed — these run in milliseconds and are the safety
net for the numbers a baker actually relies on.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from production import (  # noqa: E402
    aggregate_ingredients,
    build_steps,
    compute_batches,
    compute_schedule,
    format_quantity,
    normalize_line,
    normalize_name,
    parse_duration,
    parse_ingredient,
    scale_ingredients,
    summarize,
    total_pieces,
)


class TestParseDuration:
    def test_minutes(self):
        assert parse_duration("Pétrir 8 minutes.") == 8
        assert parse_duration("laisser reposer 30 min.") == 30

    def test_hours(self):
        assert parse_duration("Pointage : 2 h à température ambiante avec 2 rabats.") == 120
        assert parse_duration("Repos de 2 heures") == 120

    def test_hours_and_minutes(self):
        # Regression: the previous implementation read "1 h 30" as 60 minutes
        # because it only looked for the literal word "min".
        assert parse_duration("Apprêt 1 h 30 sur couche farinée.") == 90
        assert parse_duration("Repos 1h30") == 90
        assert parse_duration("Pointage 2 heures 15 min") == 135

    def test_temperature_is_not_a_duration(self):
        assert parse_duration("Enfourner à 250°C avec buée pendant 22 minutes.") == 22
        assert parse_duration("Préchauffer le four à 240°C") is None

    def test_absent(self):
        assert parse_duration("Diviser en 3 pâtons de 280 g, préformer en boules.") is None
        assert parse_duration("") is None
        assert parse_duration(None) is None


class TestParseIngredient:
    def test_common_forms(self):
        assert parse_ingredient("500 g de farine T65") == {"quantity": 500.0, "unit": "g", "name": "farine T65"}
        assert parse_ingredient("500 g farine T45") == {"quantity": 500.0, "unit": "g", "name": "farine T45"}
        assert parse_ingredient("340 g d'eau tiède") == {"quantity": 340.0, "unit": "g", "name": "eau tiède"}

    def test_decimal_and_units(self):
        assert parse_ingredient("1,5 kg de farine")["quantity"] == 1.5
        assert parse_ingredient("25 cl de lait")["unit"] == "cl"

    def test_unparseable_returns_none(self):
        # Real lines from the seeded recipes — these must not be guessed at.
        assert parse_ingredient("1 œuf pour dorure") is None
        assert parse_ingredient("Huile d'olive, herbes de Provence") is None
        assert parse_ingredient("24 barres de chocolat noir 55%") is None
        assert parse_ingredient("") is None


class TestNormalizeName:
    def test_case_accents_and_spacing_ignored(self):
        assert normalize_name("Farine  T65") == normalize_name("farine t65")
        assert normalize_name("Eau tiède") == normalize_name("eau tiede")

    def test_different_flours_stay_distinct(self):
        assert normalize_name("farine T65") != normalize_name("farine T45")


class TestScaleAndAggregate:
    def test_scaling_multiplies_quantities(self):
        out = scale_ingredients(["500 g de farine T65"], 2)
        assert out[0]["base_quantity"] == 1000.0

    def test_same_ingredient_across_recipes_is_summed_once(self):
        # The headline requirement: 2 kg + 3 kg must show as one 5 kg line.
        scaled = scale_ingredients(["2 kg de farine"], 1) + scale_ingredients(["3 kg de farine"], 1)
        result = aggregate_ingredients(scaled)
        flour = [i for i in result["items"] if normalize_name(i["name"]) == "farine"]
        assert len(flour) == 1, "flour must be grouped into a single line"
        assert flour[0]["quantity"] == 5
        assert flour[0]["unit"] == "kg"

    def test_mixed_units_add_up(self):
        scaled = scale_ingredients(["1 kg de farine"], 1) + scale_ingredients(["500 g de farine"], 1)
        result = aggregate_ingredients(scaled)
        assert result["items"][0]["quantity"] == 1.5
        assert result["items"][0]["unit"] == "kg"

    def test_different_flours_are_not_merged(self):
        scaled = scale_ingredients(["1 kg de farine T65"], 1) + scale_ingredients(["1 kg de farine T45"], 1)
        result = aggregate_ingredients(scaled)
        assert len(result["items"]) == 2, "T65 and T45 are different products"

    def test_unparseable_lines_are_reported_not_dropped(self):
        scaled = scale_ingredients(["500 g de farine", "1 œuf pour dorure"], 2)
        result = aggregate_ingredients(scaled)
        assert result["unparsed"] == ["1 œuf pour dorure"]
        assert len(result["items"]) == 1

    def test_empty_recipe_does_not_crash(self):
        assert aggregate_ingredients(scale_ingredients([], 3)) == {"items": [], "unparsed": []}


class TestFormatQuantity:
    def test_switches_to_kilos_past_a_kilo(self):
        assert format_quantity(1500, "g") == {"quantity": 1.5, "unit": "kg"}
        assert format_quantity(250, "g") == {"quantity": 250, "unit": "g"}
        assert format_quantity(2000, "ml") == {"quantity": 2, "unit": "l"}


class TestBatches:
    def test_pieces_are_converted_with_the_recipe_yield(self):
        assert compute_batches(40, "pieces", 4) == 10.0

    def test_batches_mode_is_the_multiplier_itself(self):
        assert compute_batches(3, "batches", None) == 3.0

    def test_pieces_without_a_yield_falls_back_to_batches(self):
        line = normalize_line({"quantity": 40, "mode": "pieces", "yield_pieces": None})
        assert line["mode"] == "batches", "no yield means no honest piece conversion"
        assert line["batches"] == 40.0

    def test_zero_quantity_is_harmless(self):
        assert normalize_line({"quantity": 0, "mode": "pieces", "yield_pieces": 4})["batches"] == 0.0

    def test_total_pieces_unknown_when_a_line_cannot_express_them(self):
        assert total_pieces([{"mode": "pieces", "quantity": 40}]) == 40
        assert total_pieces([{"mode": "batches", "quantity": 2, "yield_pieces": None, "batches": 2}]) is None


class TestSchedule:
    def _steps(self):
        return build_steps("L1", "Baguette", [
            "Autolyse : mélanger farine et eau, laisser reposer 30 min.",
            "Pétrir 8 minutes.",
            "Enfourner à 250°C pendant 22 minutes.",
        ])

    def test_durations_are_read_from_the_recipe(self):
        assert [s["duration_minutes"] for s in self._steps()] == [30, 8, 22]

    def test_backward_pass_from_the_target_time(self):
        result = compute_schedule(self._steps(), "2026-08-20", "06:00")
        steps = result["steps"]
        assert result["scheduled"] is True
        assert result["missing_durations"] == []
        # Last step ends exactly at the target, earlier ones chain backwards.
        assert steps[2]["end_at"] == "2026-08-20T06:00:00"
        assert steps[2]["start_at"] == "2026-08-20T05:38:00"
        assert steps[1]["end_at"] == "2026-08-20T05:38:00"
        assert steps[0]["start_at"] == "2026-08-20T05:00:00"

    def test_schedule_can_cross_midnight(self):
        steps = build_steps("L1", "Pain", ["Pointage 8 h", "Cuisson 30 min"])
        result = compute_schedule(steps, "2026-08-20", "06:00")
        # Starting the previous evening is normal in a bakery; a bare "21:30"
        # would be ambiguous, so full timestamps are returned.
        assert result["steps"][0]["start_at"] == "2026-08-19T21:30:00"

    def test_missing_duration_blocks_only_the_upstream_chain(self):
        steps = build_steps("L1", "Baguette", [
            "Pétrir 10 min.",
            "Diviser en 3 pâtons.",   # no duration anywhere in this text
            "Cuisson 20 min.",
        ])
        result = compute_schedule(steps, "2026-08-20", "06:00")
        assert len(result["missing_durations"]) == 1
        assert result["steps"][2]["start_at"] is not None      # downstream still known
        assert result["steps"][1]["end_at"] is not None        # its deadline is known
        assert result["steps"][1]["start_at"] is None          # its start is not
        assert result["steps"][0]["start_at"] is None          # nor anything before it
        assert result["steps"][0]["end_at"] is None

    def test_no_target_time_means_no_schedule(self):
        result = compute_schedule(self._steps(), "2026-08-20", None)
        assert result["scheduled"] is False
        assert all(s["start_at"] is None for s in result["steps"])

    def test_each_recipe_is_planned_to_finish_at_the_target(self):
        steps = build_steps("L1", "A", ["Cuisson 20 min"]) + build_steps("L2", "B", ["Cuisson 45 min"])
        result = compute_schedule(steps, "2026-08-20", "06:00")
        ends = {s["recipe_title"]: s["end_at"] for s in result["steps"]}
        assert ends["A"] == ends["B"] == "2026-08-20T06:00:00"


class TestSummarize:
    def test_end_to_end_shape(self):
        lines = [{
            "line_id": "L1", "recipe_title": "Baguette", "mode": "pieces",
            "quantity": 40, "yield_pieces": 4,
            "ingredients": ["500 g de farine T65", "340 g d'eau"],
        }]
        steps = build_steps("L1", "Baguette", ["Pétrir 10 min.", "Cuisson 20 min."])
        out = summarize(lines, steps, "2026-08-20", "06:00")
        assert out["lines"][0]["batches"] == 10.0
        flour = [i for i in out["ingredients"]["items"] if "farine" in i["name"].lower()][0]
        assert (flour["quantity"], flour["unit"]) == (5, "kg")   # 500 g x 10
        assert out["total_pieces"] == 40
        assert out["scheduled"] is True

    def test_production_without_recipes_is_valid(self):
        out = summarize([], [], "2026-08-20", "06:00")
        assert out["ingredients"] == {"items": [], "unparsed": []}
        assert out["total_pieces"] == 0
        assert out["steps"] == []
