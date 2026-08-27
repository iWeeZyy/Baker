"""Tests unitaires pour les pourcentages boulangers et l'hydratation
calculés à partir d'ingrédients scannés (backend/scan.py).

Fonctions pures, sans serveur ni réseau. La règle testée ici est la même
que le reste du projet : ne jamais deviner — un pourcentage ou une
hydratation absents restent absents plutôt que d'être approximés.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import scan  # noqa: E402


class TestBakersPercentages:
    def test_single_flour_is_the_100_percent_reference(self):
        lines = ["1000 g de farine T65", "650 g d'eau", "20 g de sel", "10 g de levure"]
        pct = scan.bakers_percentages(lines)
        assert pct["farine T65"] == 100.0
        assert pct["eau"] == 65.0
        assert pct["sel"] == 2.0
        assert pct["levure"] == 1.0

    def test_multiple_flours_are_summed_as_the_reference(self):
        lines = ["500 g de farine T65", "500 g de farine T45", "650 g eau froide"]
        pct = scan.bakers_percentages(lines)
        # Chaque farine reste distincte (jamais fusionnées), mais la
        # référence 100% est bien leur somme (1000 g).
        assert pct["farine T65"] == 50.0
        assert pct["farine T45"] == 50.0
        assert pct["eau froide"] == 65.0

    def test_no_flour_returns_none(self):
        lines = ["3 œufs", "500 g de sucre", "200 g de beurre"]
        assert scan.bakers_percentages(lines) is None

    def test_empty_input_returns_none(self):
        assert scan.bakers_percentages([]) is None

    def test_unparseable_lines_are_ignored_not_guessed(self):
        lines = ["1000 g de farine T65", "un peu de sel"]
        pct = scan.bakers_percentages(lines)
        assert "un peu de sel" not in pct
        assert pct["farine T65"] == 100.0


class TestComputeHydration:
    def test_water_and_flour_give_the_expected_ratio(self):
        lines = ["10000 g de farine T65", "6500 g d'eau"]
        assert scan.compute_hydration(lines) == 65

    def test_water_in_ml_counts_as_grams(self):
        # Convention standard en boulangerie : densité de l'eau ~1.
        lines = ["1000 g de farine", "650 ml d'eau"]
        assert scan.compute_hydration(lines) == 65

    def test_other_liquid_is_not_counted_as_water(self):
        # "eau de fleur d'oranger" n'est pas de l'eau de coulage — ne doit
        # jamais gonfler artificiellement l'hydratation.
        lines = ["500 g de farine", "100 ml d'eau de fleur d'oranger"]
        assert scan.compute_hydration(lines) == 0

    def test_milk_is_not_counted_as_water(self):
        lines = ["500 g de farine", "300 ml de lait"]
        assert scan.compute_hydration(lines) == 0

    def test_no_flour_returns_zero(self):
        lines = ["650 g d'eau", "20 g de sel"]
        assert scan.compute_hydration(lines) == 0

    def test_no_water_returns_zero(self):
        lines = ["1000 g de farine T65", "20 g de sel"]
        assert scan.compute_hydration(lines) == 0

    def test_empty_input_returns_zero(self):
        assert scan.compute_hydration([]) == 0

    def test_multiple_flours_sum_as_the_hydration_base(self):
        lines = ["500 g de farine T65", "500 g de farine de seigle", "650 g d'eau"]
        assert scan.compute_hydration(lines) == 65
