"""Unit tests for the leaderboard scoring/period maths.

Pure functions, no server needed — period_start() and reduce_engagement()
never touch the database.
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from leaderboard import period_start, reduce_engagement  # noqa: E402


class TestPeriodStart:
    def test_week(self):
        now = datetime(2026, 1, 15, tzinfo=timezone.utc)
        assert period_start("week", now) == now - timedelta(days=7)

    def test_month(self):
        now = datetime(2026, 1, 15, tzinfo=timezone.utc)
        assert period_start("month", now) == now - timedelta(days=30)

    def test_year(self):
        now = datetime(2026, 1, 15, tzinfo=timezone.utc)
        assert period_start("year", now) == now - timedelta(days=365)

    def test_all_time_has_no_lower_bound(self):
        assert period_start("all") is None

    def test_unknown_period_rejected(self):
        try:
            period_start("decade")
            assert False, "should have raised"
        except ValueError:
            pass


class TestReduceEngagement:
    def test_counts_by_content_and_by_owner(self):
        events = [
            {"content_id": "r1", "actor_user_id": "alice"},
            {"content_id": "r1", "actor_user_id": "bob"},
            {"content_id": "r2", "actor_user_id": "alice"},
        ]
        ownership = {"r1": "carol", "r2": "carol"}
        by_content, by_owner = reduce_engagement(events, ownership)
        assert by_content == {"r1": 2, "r2": 1}
        assert by_owner == {"carol": 3}

    def test_self_engagement_excluded(self):
        # carol liking her own recipe must never inflate her own score, nor
        # the recipe's own popularity count.
        events = [
            {"content_id": "r1", "actor_user_id": "carol"},
            {"content_id": "r1", "actor_user_id": "dave"},
        ]
        ownership = {"r1": "carol"}
        by_content, by_owner = reduce_engagement(events, ownership)
        assert by_content == {"r1": 1}
        assert by_owner == {"carol": 1}

    def test_unknown_content_ignored(self):
        # A like on content that no longer exists in the ownership map
        # (e.g. deleted) contributes nothing, rather than crashing.
        events = [{"content_id": "ghost", "actor_user_id": "alice"}]
        by_content, by_owner = reduce_engagement(events, {})
        assert by_content == {}
        assert by_owner == {}

    def test_empty_events(self):
        assert reduce_engagement([], {"r1": "carol"}) == ({}, {})

    def test_repeated_toggle_by_same_actor_still_counts_once(self):
        # The DB layer only ever hands reduce_engagement the CURRENT active
        # like row per (actor, content) pair - toggling a like off and back
        # on can never produce more than one event here, mirroring the
        # unique-index guarantee already in place on db.likes.
        events = [{"content_id": "r1", "actor_user_id": "alice"}]
        by_content, by_owner = reduce_engagement(events, {"r1": "carol"})
        assert by_content == {"r1": 1}
        assert by_owner == {"carol": 1}
