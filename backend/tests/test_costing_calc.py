"""Unit tests for the cost calculator maths (backend/costing.py).

Pure functions, no server needed. Every worked example from the feature spec
is reproduced here so a regression in the formulas is caught immediately.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from production import normalize_name  # noqa: E402
from costing import (  # noqa: E402
    compute_recipe_cost,
    compute_sale_metrics,
    cost_line,
    derive_unit_prices,
    price_lookup,
)


def material(name, **kwargs):
    return {
        "id": f"m-{name}",
        "normalized_name": normalize_name(name),
        "price_per_kg": None,
        "price_per_l": None,
        "price_per_piece": None,
        **kwargs,
    }


MATERIALS = [
    material("Farine T65", price_per_kg=0.85),
    material("Beurre", price_per_kg=7.5),
    material("Sucre", price_per_kg=1.4),
    material("Lait entier", price_per_l=1.2),
    material("Œufs", price_per_piece=0.3),
]


class TestDeriveUnitPrices:
    def test_weight_purchase(self):
        assert derive_unit_prices(21.25, 25, "kg")["price_per_kg"] == 0.85
        assert derive_unit_prices(1.4, 500, "g")["price_per_kg"] == 2.8

    def test_volume_purchase(self):
        assert derive_unit_prices(3.0, 1, "l")["price_per_l"] == 3.0
        assert derive_unit_prices(1.2, 100, "cl")["price_per_l"] == 1.2

    def test_piece_purchase(self):
        assert abs(derive_unit_prices(2.4, 6, "piece")["price_per_piece"] - 0.4) < 1e-9

    def test_only_the_matching_basis_is_set(self):
        r = derive_unit_prices(21.25, 25, "kg")
        assert r["price_per_l"] is None and r["price_per_piece"] is None

    def test_rejects_zero_or_negative_quantity(self):
        import pytest
        with pytest.raises(ValueError):
            derive_unit_prices(10, 0, "kg")
        with pytest.raises(ValueError):
            derive_unit_prices(10, -5, "kg")

    def test_rejects_negative_price(self):
        import pytest
        with pytest.raises(ValueError):
            derive_unit_prices(-1, 10, "kg")

    def test_rejects_unknown_unit(self):
        import pytest
        with pytest.raises(ValueError):
            derive_unit_prices(10, 5, "bag")


class TestCostLine:
    def test_weight_g_priced_per_kg(self):
        # 500 g de farine à 0,85 €/kg -> 0,425 €, full precision kept internally
        line = cost_line("500 g de farine T65", price_lookup(MATERIALS))
        assert line["status"] == "ok"
        assert abs(line["cost"] - 0.425) < 1e-9

    def test_weight_kg_direct(self):
        line = cost_line("2 kg de beurre", price_lookup(MATERIALS))
        assert abs(line["cost"] - 15.0) < 1e-9

    def test_volume_ml_priced_per_litre(self):
        line = cost_line("250 ml de lait entier", price_lookup(MATERIALS))
        assert abs(line["cost"] - 0.3) < 1e-9

    def test_volume_cl_priced_per_litre(self):
        line = cost_line("50 cl de lait entier", price_lookup(MATERIALS))
        assert abs(line["cost"] - 0.6) < 1e-9

    def test_bare_piece_count(self):
        line = cost_line("3 œufs", price_lookup(MATERIALS))
        assert line["status"] == "ok"
        assert abs(line["cost"] - 0.9) < 1e-9

    def test_missing_price_is_never_zero(self):
        line = cost_line("10 g de levure fraîche", price_lookup(MATERIALS))
        assert line["status"] == "price_missing"
        assert "cost" not in line

    def test_unparseable_line_is_excluded_not_zeroed(self):
        line = cost_line("Sel, poivre du moulin", price_lookup(MATERIALS))
        assert line["status"] == "unparsed"

    def test_section_header_is_unparsed(self):
        line = cost_line("Pour la garniture :", price_lookup(MATERIALS))
        assert line["status"] == "unparsed"

    def test_unit_mismatch_is_missing_not_wrong(self):
        # "farine" only has a price_per_kg; asking for it by the piece must not
        # silently reuse the weight price.
        line = cost_line("2 farine T65", price_lookup(MATERIALS))
        assert line["status"] == "price_missing"

    def test_override_takes_priority_over_stored_price(self):
        overrides = {normalize_name("Farine T65"): 1.05}
        line = cost_line("1 kg de farine T65", price_lookup(MATERIALS), overrides)
        assert abs(line["cost"] - 1.05) < 1e-9

    def test_override_works_even_with_no_stored_material(self):
        overrides = {normalize_name("Levure fraîche"): 6.0}
        line = cost_line("10 g de levure fraîche", price_lookup([]), overrides)
        assert line["status"] == "ok"
        assert abs(line["cost"] - 0.06) < 1e-9


class TestComputeRecipeCost:
    SPEC_LINES = ["10 kg de farine T65", "2 kg de beurre", "500 g de sucre"]

    def test_raw_materials_subtotal_matches_spec_example(self):
        result = compute_recipe_cost(self.SPEC_LINES, MATERIALS, [], [], None)
        assert abs(result["raw_materials_cost"] - 24.20) < 1e-9

    def test_full_worked_example(self):
        # Matières premières 24,20 + emballage 2,40 + autres 1,50 = 28,10 € ; /100 pièces = 0,281 €
        result = compute_recipe_cost(
            self.SPEC_LINES, MATERIALS,
            [{"label": "emballage", "cost": 2.40}],
            [{"label": "déco", "cost": 1.50}],
            100,
        )
        assert abs(result["total_cost"] - 28.10) < 1e-9
        assert abs(result["cost_per_piece"] - 0.281) < 1e-9

    def test_one_missing_price_voids_the_whole_total(self):
        result = compute_recipe_cost(self.SPEC_LINES + ["10 g de levure"], MATERIALS, [], [], 100)
        assert result["has_missing_prices"] is True
        assert result["total_cost"] is None
        assert result["cost_per_piece"] is None

    def test_no_pieces_means_no_cost_per_piece_not_a_guess(self):
        result = compute_recipe_cost(self.SPEC_LINES, MATERIALS, [], [], None)
        assert result["cost_per_piece"] is None

    def test_zero_pieces_means_no_cost_per_piece(self):
        result = compute_recipe_cost(self.SPEC_LINES, MATERIALS, [], [], 0)
        assert result["cost_per_piece"] is None

    def test_empty_recipe_costs_only_packaging_and_other(self):
        result = compute_recipe_cost([], MATERIALS, [{"label": "sachet", "cost": 0.08}], [], 10)
        assert result["raw_materials_cost"] == 0
        assert abs(result["total_cost"] - 0.08) < 1e-9

    def test_unparsed_lines_are_reported_but_dont_block_the_total(self):
        result = compute_recipe_cost(self.SPEC_LINES + ["Pour la garniture :"], MATERIALS, [], [], 100)
        assert result["unparsed_count"] == 1
        assert result["total_cost"] is not None

    def test_simulation_override_changes_total_without_a_stored_price_change(self):
        overrides = {normalize_name("Farine T65"): 1.05}
        result = compute_recipe_cost(self.SPEC_LINES, MATERIALS, [], [], None, overrides)
        expected = 10 * 1.05 + 15.0 + 0.7
        assert abs(result["raw_materials_cost"] - expected) < 1e-9
        # the shared MATERIALS list itself must be untouched
        assert MATERIALS[0]["price_per_kg"] == 0.85


class TestComputeSaleMetrics:
    COST_PER_PIECE = 0.281

    def test_margin_and_rates_match_spec_example(self):
        sale = compute_sale_metrics(self.COST_PER_PIECE, 100, 1.30, None)
        assert abs(sale["margin_per_piece"] - 1.019) < 1e-9
        assert abs(sale["margin_total"] - 101.9) < 1e-6
        # Taux de marge = (PV - coût) / coût x 100 ; taux de marque = (PV - coût) / PV x 100
        expected_marge = (1.30 - self.COST_PER_PIECE) / self.COST_PER_PIECE * 100
        expected_marque = (1.30 - self.COST_PER_PIECE) / 1.30 * 100
        assert abs(sale["margin_rate_pct"] - expected_marge) < 1e-6
        assert abs(sale["markup_rate_pct"] - expected_marque) < 1e-6
        assert expected_marge != expected_marque  # the two must never be conflated

    def test_no_vat_rate_means_no_ttc_assumed(self):
        sale = compute_sale_metrics(self.COST_PER_PIECE, 100, 1.30, None)
        assert sale["sale_price_ttc"] is None

    def test_vat_rate_applied_when_given(self):
        sale = compute_sale_metrics(self.COST_PER_PIECE, 100, 1.30, 5.5)
        assert abs(sale["sale_price_ttc"] - 1.30 * 1.055) < 1e-9

    def test_missing_cost_means_no_metrics_not_zero(self):
        sale = compute_sale_metrics(None, 100, 1.30, None)
        assert sale["margin_per_piece"] is None
        assert sale["margin_rate_pct"] is None

    def test_missing_sale_price_means_no_metrics(self):
        sale = compute_sale_metrics(self.COST_PER_PIECE, 100, None, None)
        assert sale["margin_per_piece"] is None

    def test_zero_cost_avoids_division_by_zero(self):
        sale = compute_sale_metrics(0, 10, 1.0, None)
        assert sale["margin_rate_pct"] is None  # would be an undefined ratio
        assert sale["markup_rate_pct"] == 100.0  # (1-0)/1 is well defined

    def test_zero_sale_price_avoids_division_by_zero(self):
        sale = compute_sale_metrics(0.5, 10, 0, None)
        assert sale["markup_rate_pct"] is None
        assert sale["margin_rate_pct"] == -100.0

    def test_negative_margin_is_reported_honestly(self):
        sale = compute_sale_metrics(1.0, 10, 0.5, None)
        assert sale["margin_per_piece"] == -0.5
        assert sale["margin_rate_pct"] == -50.0
