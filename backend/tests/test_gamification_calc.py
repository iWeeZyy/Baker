"""Niveaux/Badges — logique pure et orchestration DB testées directement.

`level_for_xp` est pure (aucune DB). `award_xp`/`check_badges_after_event`
touchent une base simulée (mongomock) mais ne passent jamais par le serveur
HTTP — même discipline que `test_retire_seed.py` : les coroutines sont
lancées par `asyncio.run`, pas par un greffon pytest (pytest-asyncio n'est
pas une dépendance de ce projet).
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import gamification  # noqa: E402
import badges  # noqa: E402


def fresh_db():
    return AsyncMongoMockClient()["gamification_test"]


async def _index(db):
    await db.user_xp_events.create_index("event_key", unique=True)
    await db.user_badges.create_index([("user_id", 1), ("badge_id", 1)], unique=True)


class TestLevelForXp:
    def test_level_1_at_zero_xp(self):
        d = gamification.level_for_xp(0)
        assert d["level"] == 1 and d["title"] == "Débutant"
        assert d["xp_into_level"] == 0 and d["xp_remaining"] == 80

    def test_just_below_threshold_stays_at_current_level(self):
        d = gamification.level_for_xp(79)
        assert d["level"] == 1
        assert d["xp_remaining"] == 1

    def test_exact_threshold_reaches_next_level(self):
        d = gamification.level_for_xp(80)
        assert d["level"] == 2 and d["title"] == "Apprenti"
        assert d["xp_into_level"] == 0

    def test_max_level_caps_and_has_no_next(self):
        d = gamification.level_for_xp(gamification.LEVELS[-1]["xp_required"])
        assert d["level"] == gamification.MAX_LEVEL
        assert d["xp_for_next_level"] is None
        assert d["xp_remaining"] is None
        assert d["next_level_title"] is None

    def test_xp_far_beyond_max_still_caps_at_max_level(self):
        d = gamification.level_for_xp(10_000_000)
        assert d["level"] == gamification.MAX_LEVEL

    def test_negative_xp_never_goes_below_zero(self):
        d = gamification.level_for_xp(-500)
        assert d["level"] == 1 and d["xp"] == 0

    def test_twenty_levels_minimum_and_strictly_increasing(self):
        assert len(gamification.LEVELS) >= 20
        thresholds = [row["xp_required"] for row in gamification.LEVELS]
        assert thresholds == sorted(thresholds)
        assert len(set(thresholds)) == len(thresholds)


class TestAwardXpDedup:
    def test_unknown_kind_is_a_safe_noop(self):
        async def run():
            db = fresh_db()
            await _index(db)
            r = await gamification.award_xp(db, "u1", "not_a_real_kind", "x")
            assert r == {"awarded": False, "leveled_up": None}
        asyncio.run(run())

    def test_same_event_key_never_awards_twice(self):
        async def run():
            db = fresh_db()
            await _index(db)
            r1 = await gamification.award_xp(db, "u1", "recipe_published", "r1")
            r2 = await gamification.award_xp(db, "u1", "recipe_published", "r1")
            assert r1["awarded"] is True
            assert r2["awarded"] is False
            detail = await gamification.get_level_detail(db, "u1")
            assert detail["xp"] == gamification.XP_RULES["recipe_published"]["points"]
        asyncio.run(run())

    def test_different_kinds_never_collide_on_the_same_raw_id(self):
        """La clé complète inclut `kind` — un `recipe_id` et un `creation_id`
        identiques par accident ne doivent jamais se marcher dessus."""
        async def run():
            db = fresh_db()
            await _index(db)
            r1 = await gamification.award_xp(db, "u1", "recipe_published", "same-id")
            r2 = await gamification.award_xp(db, "u1", "creation_published", "same-id")
            assert r1["awarded"] is True and r2["awarded"] is True
        asyncio.run(run())

    def test_leveled_up_reported_only_on_the_crossing_event(self):
        async def run():
            db = fresh_db()
            await _index(db)
            results = []
            for i in range(1, 6):
                r = await gamification.award_xp(db, "u1", "recipe_published", f"r{i}")
                results.append(r["leveled_up"])
            # 100 XP par recette : r1 -> 100 (niveau 2), r2 -> 200 (niveau 3),
            # r4 -> 400 (niveau 4). Chaque franchissement, jamais plus.
            crossed = [r for r in results if r is not None]
            assert len(crossed) >= 2
        asyncio.run(run())


class TestDailyAndLifetimeCaps:
    def test_daily_cap_blocks_further_awards_same_day(self):
        async def run():
            db = fresh_db()
            await _index(db)
            cap = gamification.XP_RULES["recipe_published"]["daily_cap"]
            awarded = 0
            for i in range(cap + 5):
                r = await gamification.award_xp(db, "u1", "recipe_published", f"r{i}")
                if r["awarded"]:
                    awarded += 1
            assert awarded == cap
        asyncio.run(run())

    def test_lifetime_cap_blocks_forever_not_just_per_day(self):
        async def run():
            db = fresh_db()
            await _index(db)
            cap = gamification.XP_RULES["collection_created"]["lifetime_cap"]
            awarded = 0
            for i in range(cap + 3):
                r = await gamification.award_xp(db, "u1", "collection_created", f"c{i}")
                if r["awarded"]:
                    awarded += 1
            assert awarded == cap
        asyncio.run(run())

    def test_no_cap_actions_are_never_blocked_by_dedup_alone(self):
        async def run():
            db = fresh_db()
            await _index(db)
            # new_follower n'a pas de plafond journalier — seule la clé
            # (déjà unique par relation) le protège.
            for i in range(50):
                r = await gamification.award_xp(db, "u1", "new_follower", f"follower{i}:u1")
                assert r["awarded"] is True
        asyncio.run(run())


class TestBadgeUnlocking:
    def test_first_recipe_badge_unlocks_immediately(self):
        async def run():
            db = fresh_db()
            await _index(db)
            await db.recipes.insert_one({"id": "r1", "author_id": "u1", "is_user_submitted": True, "ingredients": ["farine"]})
            await gamification.award_xp(db, "u1", "recipe_published", "r1")
            unlocked = await badges.check_badges_after_event(db, "u1", "recipe_published")
            assert [b["id"] for b in unlocked] == ["first_recipe"]
        asyncio.run(run())

    def test_badge_never_unlocked_twice(self):
        async def run():
            db = fresh_db()
            await _index(db)
            await db.recipes.insert_one({"id": "r1", "author_id": "u1", "is_user_submitted": True, "ingredients": []})
            await gamification.award_xp(db, "u1", "recipe_published", "r1")
            first = await badges.check_badges_after_event(db, "u1", "recipe_published")
            second = await badges.check_badges_after_event(db, "u1", "recipe_published")
            assert len(first) == 1 and second == []
        asyncio.run(run())

    def test_recipe_count_badge_progress_ignores_the_xp_daily_cap(self):
        """Publier 10 recettes réelles débloque "Collectionneur" même si le
        plafond journalier d'XP (5/jour) a empêché certaines d'entre elles de
        rapporter de l'XP ce jour-là — le compteur vient de db.recipes, pas
        du registre XP, précisément pour cette raison."""
        async def run():
            db = fresh_db()
            await _index(db)
            for i in range(1, 11):
                await db.recipes.insert_one({"id": f"r{i}", "author_id": "u1", "is_user_submitted": True, "ingredients": []})
                await gamification.award_xp(db, "u1", "recipe_published", f"r{i}")
            unlocked = await badges.check_badges_after_event(db, "u1", "recipe_published")
            ids = [b["id"] for b in unlocked]
            assert "recipes_10" in ids
        asyncio.run(run())

    def test_levain_badge_counts_only_recipes_mentioning_levain(self):
        async def run():
            db = fresh_db()
            await _index(db)
            for i in range(1, 11):
                await db.recipes.insert_one({
                    "id": f"r{i}", "author_id": "u1", "is_user_submitted": True,
                    "ingredients": ["300 g de levain liquide"],
                })
                await gamification.award_xp(db, "u1", "recipe_published", f"r{i}")
            unlocked = await badges.check_badges_after_event(db, "u1", "recipe_published")
            assert "levain_10" in [b["id"] for b in unlocked]
        asyncio.run(run())

    def test_hidden_badge_masked_before_unlock_and_revealed_after(self):
        badge = badges._BY_ID["night_owl"]
        masked = badges.public_badge(badge, unlocked=False)
        assert masked["name"] == "???" and masked["description"] is None
        revealed = badges.public_badge(badge, unlocked=True)
        assert revealed["name"] == "Nocturne" and revealed["description"]

    def test_hidden_badge_unlocks_only_inside_its_time_window(self):
        async def run():
            db = fresh_db()
            await _index(db)
            await gamification.award_xp(db, "u1", "recipe_published", "r1")
            outside = await badges.check_badges_after_event(db, "u1", "recipe_published", context={"hour_utc": 14})
            assert "night_owl" not in [b["id"] for b in outside]
            await gamification.award_xp(db, "u1", "recipe_published", "r2")
            inside = await badges.check_badges_after_event(db, "u1", "recipe_published", context={"hour_utc": 2})
            assert "night_owl" in [b["id"] for b in inside]
        asyncio.run(run())

    def test_leaderboard_rank_badges_grant_every_threshold_qualified(self):
        async def run():
            db = fresh_db()
            await _index(db)
            unlocked = await badges.check_leaderboard_badges(db, "u1", 7)
            ids = [b["id"] for b in unlocked]
            assert set(ids) == {"top_100", "top_50", "top_10"}
            # Rejouer le même rang ne doit rien réattribuer.
            again = await badges.check_leaderboard_badges(db, "u1", 7)
            assert again == []
        asyncio.run(run())

    def test_no_rank_means_no_leaderboard_badge(self):
        async def run():
            db = fresh_db()
            await _index(db)
            unlocked = await badges.check_leaderboard_badges(db, "u1", None)
            assert unlocked == []
        asyncio.run(run())


class TestStreak:
    def test_first_action_starts_streak_at_one(self):
        async def run():
            db = fresh_db()
            await _index(db)
            await gamification.award_xp(db, "u1", "recipe_published", "r1")
            row = await db.user_levels.find_one({"user_id": "u1"}, {"_id": 0})
            assert row["current_streak"] == 1
        asyncio.run(run())

    def test_same_day_twice_does_not_double_count(self):
        async def run():
            db = fresh_db()
            await _index(db)
            await gamification.award_xp(db, "u1", "recipe_published", "r1")
            await gamification.award_xp(db, "u1", "comment_written", "c1")
            row = await db.user_levels.find_one({"user_id": "u1"}, {"_id": 0})
            assert row["current_streak"] == 1
        asyncio.run(run())

    def test_consecutive_day_increments_streak(self):
        async def run():
            db = fresh_db()
            await _index(db)
            yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
            await db.user_levels.update_one(
                {"user_id": "u1"}, {"$set": {"current_streak": 4, "last_active_date": yesterday}}, upsert=True,
            )
            await gamification.award_xp(db, "u1", "recipe_published", "r1")
            row = await db.user_levels.find_one({"user_id": "u1"}, {"_id": 0})
            assert row["current_streak"] == 5
        asyncio.run(run())

    def test_gap_of_more_than_a_day_resets_streak(self):
        async def run():
            db = fresh_db()
            await _index(db)
            long_ago = (datetime.now(timezone.utc) - timedelta(days=5)).strftime("%Y-%m-%d")
            await db.user_levels.update_one(
                {"user_id": "u1"}, {"$set": {"current_streak": 10, "last_active_date": long_ago}}, upsert=True,
            )
            await gamification.award_xp(db, "u1", "recipe_published", "r1")
            row = await db.user_levels.find_one({"user_id": "u1"}, {"_id": 0})
            assert row["current_streak"] == 1
        asyncio.run(run())

    def test_streak_badges_unlock_at_their_threshold(self):
        async def run():
            db = fresh_db()
            await _index(db)
            await db.user_levels.update_one({"user_id": "u1"}, {"$set": {"current_streak": 3}}, upsert=True)
            unlocked = await badges.check_badges_after_event(db, "u1", "recipe_published")
            assert "streak_3" in [b["id"] for b in unlocked]
        asyncio.run(run())


class TestBadgeCatalogIntegrity:
    def test_every_badge_has_a_unique_id(self):
        ids = [b["id"] for b in badges.BADGES]
        assert len(ids) == len(set(ids))

    def test_every_badge_covers_one_of_the_six_categories(self):
        allowed = {"boulanger", "createur", "communaute", "social", "classement", "regularite"}
        assert all(b["category"] in allowed for b in badges.BADGES)

    def test_at_least_one_badge_is_hidden(self):
        assert any(b.get("hidden") for b in badges.BADGES)

    def test_public_badge_never_leaks_the_raw_requirement(self):
        for b in badges.BADGES:
            assert "requirement" not in badges.public_badge(b, unlocked=True)
            assert "requirement" not in badges.public_badge(b, unlocked=False)
