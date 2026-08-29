"""Tests purs de recipe_adapt.py — aucun serveur, aucune base.

Le module ne réimplémente ni la grammaire d'ingrédient, ni les conversions
d'unité, ni l'arrondi d'affichage (production.py/scan.py restent l'unique
source) : ces tests couvrent uniquement ce que recipe_adapt.py ajoute —
le facteur d'échelle à partir d'un poids cible, et le pourcentage boulanger
en sens inverse (% -> grammes) — plus l'orchestration dans un ordre fixe.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import recipe_adapt as ra  # noqa: E402


def _recipe():
    return [
        "6750 g farine T65",
        "750 g farine de seigle",
        "5100 g eau",
        "150 g sel",
        "75 g levure",
    ]


class TestTotalWeight:
    def test_sums_every_parseable_line(self):
        assert ra.total_weight_g(_recipe()) == 12825.0

    def test_none_when_nothing_parses(self):
        assert ra.total_weight_g(["3 œufs", "une pincée de sel"]) is None

    def test_ml_counts_as_grams(self):
        assert ra.total_weight_g(["500 g farine", "300 ml eau"]) == 800.0


class TestScaleToWeight:
    def test_scales_every_line_by_the_same_factor(self):
        lines, err = ra.scale_to_weight(["500 g farine", "350 g eau"], 1700)
        assert err is None
        assert lines == ["1000 g farine", "700 g eau"]

    def test_rejects_non_positive_target(self):
        lines, err = ra.scale_to_weight(["500 g farine"], 0)
        assert lines is None
        assert "supérieur à 0" in err

    def test_rejects_recipe_with_no_parseable_weight(self):
        lines, err = ra.scale_to_weight(["3 œufs"], 1000)
        assert lines is None
        assert "Aucun poids total" in err

    def test_unparsed_lines_pass_through_untouched(self):
        lines, err = ra.scale_to_weight(["500 g farine", "3 œufs pour la dorure"], 1000)
        assert err is None
        assert lines == ["1000 g farine", "3 œufs pour la dorure"]

    def test_preserves_original_phrasing_when_unchanged(self):
        # Facteur 1 : aucune ligne ne doit être retouchée, même l'article "de".
        lines, err = ra.scale_to_weight(["500 g de farine T65"], 500)
        assert err is None
        assert lines == ["500 g de farine T65"]


class TestScaleToPiecesAndWeight:
    def test_derives_target_weight_from_pieces_times_piece_weight(self):
        lines, err = ra.scale_to_pieces_and_weight(["400 g farine"], 10, 40)
        assert err is None
        assert lines == ["400 g farine"]  # 10*40=400, facteur 1

    def test_rejects_non_positive_pieces_or_weight(self):
        assert ra.scale_to_pieces_and_weight(["400 g farine"], 0, 40)[0] is None
        assert ra.scale_to_pieces_and_weight(["400 g farine"], 10, 0)[0] is None


class TestSetHydration:
    def test_recomputes_water_only_others_untouched(self):
        lines, err = ra.set_hydration(_recipe(), 75)
        assert err is None
        assert lines[0] == "6750 g farine T65"  # farine inchangée
        assert lines[1] == "750 g farine de seigle"
        assert lines[3] == "150 g sel"
        assert lines[4] == "75 g levure"
        # eau = 75% * 7500 = 5625 g
        assert lines[2] == "5625 g eau"

    def test_no_op_when_already_at_target(self):
        lines, err = ra.set_hydration(_recipe(), 68)
        assert err is None
        assert lines == _recipe()

    def test_rejects_no_flour(self):
        lines, err = ra.set_hydration(["500 g eau"], 70)
        assert lines is None
        assert "farine" in err.lower()

    def test_rejects_no_water(self):
        lines, err = ra.set_hydration(["500 g farine"], 70)
        assert lines is None
        assert "eau" in err.lower()

    def test_distributes_across_multiple_water_lines_proportionally(self):
        lines, err = ra.set_hydration(["1000 g farine", "400 g eau", "200 g eau froide"], 90)
        assert err is None
        # eau totale actuelle 600g -> nouvelle cible 900g, répartie 400/600 et 200/600
        assert lines[1] == "600 g eau"
        assert lines[2] == "300 g eau froide"


class TestSetFlourMixPercentages:
    def test_redistributes_remainder_to_unmentioned_flour(self):
        lines, err = ra.set_flour_mix_percentages(_recipe(), {"farine de seigle": 20})
        assert err is None
        # flour_total=7500 inchangé ; seigle=20%*7500=1500 ; T65=80%*7500=6000
        assert lines[0] == "6000 g farine T65"
        assert lines[1] == "1500 g farine de seigle"
        # eau/sel/levure ne bougent pas à cette étape
        assert lines[2:] == _recipe()[2:]

    def test_rejects_single_flour(self):
        lines, err = ra.set_flour_mix_percentages(["1000 g farine T65", "650 g eau"], {"farine T65": 50})
        assert lines is None
        assert "une seule farine" in err

    def test_rejects_over_100_percent(self):
        lines, err = ra.set_flour_mix_percentages(_recipe(), {"farine T65": 60, "farine de seigle": 50})
        assert lines is None
        assert "dépassent 100" in err

    def test_rejects_unknown_flour_name(self):
        lines, err = ra.set_flour_mix_percentages(_recipe(), {"farine de sarrasin": 20})
        assert lines is None
        assert "introuvable" in err

    def test_no_op_with_empty_changes(self):
        lines, err = ra.set_flour_mix_percentages(_recipe(), {})
        assert err is None
        assert lines == _recipe()


class TestSetIngredientPercentages:
    def test_sets_non_flour_ingredient_relative_to_flour_total(self):
        lines, err = ra.set_ingredient_percentages(_recipe(), {"sel": 3})
        assert err is None
        assert lines[3] == "225 g sel"  # 3% * 7500
        # rien d'autre ne bouge
        assert lines[0] == _recipe()[0]
        assert lines[2] == _recipe()[2]

    def test_rejects_unknown_ingredient(self):
        lines, err = ra.set_ingredient_percentages(_recipe(), {"sucre": 5})
        assert lines is None
        assert "introuvable" in err

    def test_rejects_negative_percentage(self):
        lines, err = ra.set_ingredient_percentages(_recipe(), {"sel": -1})
        assert lines is None
        assert "négatif" in err


class TestSubstituteIngredients:
    def test_default_keeps_current_quantity(self):
        lines, err = ra.substitute_ingredients(_recipe(), [{"from_name": "levure", "to_name": "levain"}])
        assert err is None
        assert lines[4] == "75 g levain"

    def test_explicit_quantity_and_unit_applied(self):
        lines, err = ra.substitute_ingredients(
            _recipe(), [{"from_name": "levure", "to_name": "levain", "new_quantity": 200, "new_unit": "g"}],
        )
        assert err is None
        assert lines[4] == "200 g levain"

    def test_rejects_unknown_source_ingredient(self):
        lines, err = ra.substitute_ingredients(_recipe(), [{"from_name": "beurre", "to_name": "margarine"}])
        assert lines is None
        assert "introuvable" in err

    def test_no_op_with_empty_list(self):
        lines, err = ra.substitute_ingredients(_recipe(), [])
        assert err is None
        assert lines == _recipe()


class TestApplyAdaptationOrdering:
    def test_empty_request_returns_original_recomputed(self):
        result = ra.apply_adaptation(_recipe(), {}, original_yield_pieces=40)
        assert result["ok"] is True
        assert result["hydration"] == 68
        assert result["yield_pieces"] == 40
        assert [i["raw"] for i in result["ingredients"]] == _recipe()
        assert all(not i["changed"] for i in result["ingredients"])

    def test_worked_example_from_the_spec(self):
        # 40->80 pièces, 300->320g (poids par pièce), hydratation 68->72%,
        # seigle 10%->20% — l'exemple exact de la demande, chiffres attendus
        # calculés indépendamment ci-dessous.
        lines = _recipe()
        request = {
            "target_yield_pieces": 80,
            "target_piece_weight_g": 320,
            "flour_percentage_changes": {"farine de seigle": 20},
            "target_hydration_pct": 72,
        }
        result = ra.apply_adaptation(lines, request, original_yield_pieces=40)
        assert result["ok"] is True

        factor = (80 * 320) / 12825.0
        flour_total = 7500 * factor
        expected = {
            "farine T65": 0.80 * flour_total,
            "farine de seigle": 0.20 * flour_total,
            "eau": 0.72 * flour_total,
            "sel": 150 * factor,
            "levure": 75 * factor,
        }
        by_name = {i["name"]: i["quantity"] for i in result["ingredients"]}
        for name, expected_qty in expected.items():
            assert abs(by_name[name] - expected_qty) < 1, f"{name}: {by_name[name]} vs {expected_qty}"

        assert result["yield_pieces"] == 80
        # Le poids par pièce affiché reflète le poids total RÉEL après les
        # étapes suivantes (hydratation incluse) — la cible 320 g ne visait
        # que l'étape de mise à l'échelle ; changer l'hydratation ensuite
        # change légitimement le total, donc le poids par pièce final.
        expected_total = sum(expected.values())
        assert abs(result["piece_weight_g"] - expected_total / 80) < 1
        assert result["hydration"] == 72

        by_name_pct = {i["name"]: i["percentage"] for i in result["ingredients"]}
        assert by_name_pct["farine T65"] == 80.0
        assert by_name_pct["farine de seigle"] == 20.0

    def test_pipeline_stops_on_first_error_never_partial(self):
        result = ra.apply_adaptation(_recipe(), {"target_hydration_pct": 70, "flour_percentage_changes": {"farine de sarrasin": 20}}, 40)
        assert result["ok"] is False
        assert result["errors"]
        assert "ingredients" not in result

    def test_no_rounding_drift_across_multiple_chained_operations(self):
        # Le pipeline doit rester précis en interne (jamais un texte arrondi
        # ré-analysé par l'étape suivante) : comparer un enchaînement complet
        # à un calcul équivalent en une seule étape (même facteur composé).
        lines = _recipe()
        request = {
            "target_yield_pieces": 123,
            "target_piece_weight_g": 287,
            "target_hydration_pct": 73.5,
        }
        result = ra.apply_adaptation(lines, request, original_yield_pieces=40)
        assert result["ok"] is True
        factor = (123 * 287) / 12825.0
        flour_total = 7500 * factor
        by_name = {i["name"]: i["quantity"] for i in result["ingredients"]}
        assert abs(by_name["farine T65"] - 6750 * factor) < 1
        assert abs(by_name["eau"] - 0.735 * flour_total) < 1

    def test_substitution_uses_already_scaled_quantity_not_original(self):
        result = ra.apply_adaptation(
            _recipe(),
            {
                "target_yield_pieces": 80, "target_piece_weight_g": 320,
                "substitutions": [{"from_name": "levure", "to_name": "levain"}],
            },
            original_yield_pieces=40,
        )
        assert result["ok"] is True
        factor = (80 * 320) / 12825.0
        levain = next(i for i in result["ingredients"] if i["name"] == "levain")
        assert abs(levain["quantity"] - 75 * factor) < 1


class TestLineDetails:
    def test_flags_flour_and_water(self):
        details = ra.line_details(_recipe())
        assert details[0]["is_flour"] is True
        assert details[1]["is_flour"] is True
        assert details[2]["is_water"] is True
        assert details[3]["is_flour"] is False and details[3]["is_water"] is False

    def test_unparsed_line_kept_with_parsed_false(self):
        details = ra.line_details(["3 œufs"])
        assert details[0]["parsed"] is False
        assert details[0]["raw"] == "3 œufs"
