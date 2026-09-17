"""Unit tests for pro orders' pure maths (phase 7b).

Pure functions, no server needed — same family as test_production_calc.py.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from orders import (  # noqa: E402
    ORDER_STATUSES,
    aggregate_orders,
    balance_due,
    is_active,
    scaled_lines_for_order,
)


class TestIsActive:
    def test_every_status_but_cancelled_is_active(self):
        for status in ORDER_STATUSES:
            assert is_active(status) == (status != "cancelled")


class TestBalanceDue:
    def test_no_price_stays_none(self):
        """Jamais 0 : une commande sans prix n'est pas soldée, elle n'a
        simplement pas de prix — même règle que costing.py."""
        assert balance_due(None, None) is None
        assert balance_due(None, 10) is None

    def test_no_deposit_is_the_full_price(self):
        assert balance_due(100.0, None) == 100.0

    def test_partial_deposit(self):
        assert balance_due(100.0, 30.0) == 70.0

    def test_fully_paid(self):
        assert balance_due(100.0, 100.0) == 0.0


class TestScaledLinesForOrder:
    def test_scales_by_quantity(self):
        items = [{"mode": "batches", "quantity": 2, "ingredients": ["500 g de farine T65"]}]
        scaled = scaled_lines_for_order(items)
        assert len(scaled) == 1
        assert scaled[0]["parsed"] is True
        assert scaled[0]["base_quantity"] == 1000.0  # 500 g * 2

    def test_pieces_mode_needs_a_yield(self):
        items = [{"mode": "pieces", "quantity": 20, "yield_pieces": 10, "ingredients": ["100 g de sucre"]}]
        scaled = scaled_lines_for_order(items)
        # 20 pièces / 10 par fournée = 2 fournées -> 200 g
        assert scaled[0]["base_quantity"] == 200.0

    def test_empty_items(self):
        assert scaled_lines_for_order([]) == []
        assert scaled_lines_for_order(None) == []


class TestAggregateOrders:
    def test_a_cancelled_order_never_contributes(self):
        orders_list = [
            {"status": "cancelled", "items": [{"mode": "batches", "quantity": 5, "ingredients": ["1 kg de farine T65"]}]},
            {"status": "pending", "items": [{"mode": "batches", "quantity": 1, "ingredients": ["1 kg de farine T65"]}]},
        ]
        result = aggregate_orders(orders_list)
        assert len(result["items"]) == 1
        # Seule la commande active (1 kg) doit compter, pas les 5 kg annulés.
        assert result["items"][0]["quantity"] == 1
        assert result["items"][0]["unit"] == "kg"

    def test_active_orders_sum_across_each_other(self):
        orders_list = [
            {"status": "pending", "items": [{"mode": "batches", "quantity": 1, "ingredients": ["500 g de farine T65"]}]},
            {"status": "confirmed", "items": [{"mode": "batches", "quantity": 1, "ingredients": ["500 g de farine T65"]}]},
        ]
        result = aggregate_orders(orders_list)
        assert result["items"][0]["quantity"] == 1
        assert result["items"][0]["unit"] == "kg"  # 500 g + 500 g = 1000 g -> 1 kg

    def test_no_orders(self):
        assert aggregate_orders([]) == {"items": [], "unparsed": []}

    def test_default_status_is_pending_when_absent(self):
        """Un document sans champ status (ne devrait pas arriver en
        pratique, mais aggregate_orders ne doit jamais planter dessus) est
        traité comme actif plutôt que rejeté silencieusement."""
        orders_list = [{"items": [{"mode": "batches", "quantity": 1, "ingredients": ["500 g de farine T65"]}]}]
        result = aggregate_orders(orders_list)
        assert len(result["items"]) == 1
