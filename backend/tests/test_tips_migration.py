"""Unit tests for the Astuces library migration (backend/tips_seed.py).

Pure functions, no server needed. Guards the migration invariants: no tip
lost, no content invented, categories match the requested taxonomy, every
keyword is textually present in its own tip.
"""
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from seed_data import BAKER_TIPS, TIPS_SEED  # noqa: E402
from seed_books import BOOK_TIPS  # noqa: E402
from tips_seed import NEW_FERRANDI_TIPS, TIP_CATEGORIES  # noqa: E402


def _normalize(text):
    n = unicodedata.normalize("NFD", (text or "").lower())
    return "".join(c for c in n if unicodedata.category(c) != "Mn")


class TestNoDataLost:
    def test_every_book_tip_survives_migration(self):
        migrated_titles = {t["title"] for t in TIPS_SEED}
        for t in BOOK_TIPS:
            assert t["title"] in migrated_titles

    def test_every_baker_tip_survives_migration(self):
        migrated_titles = {t["title"] for t in TIPS_SEED}
        for t in BAKER_TIPS:
            assert t["title"] in migrated_titles

    def test_total_count_matches_the_three_sources_with_no_duplication(self):
        # BAKER_TIPS / BOOK_TIPS / NEW_FERRANDI_TIPS titles never collide
        # (checked separately below), so the merge is a plain sum.
        assert len(TIPS_SEED) == len(BOOK_TIPS) + len(BAKER_TIPS) + len(NEW_FERRANDI_TIPS)

    def test_new_ferrandi_tips_are_present(self):
        migrated_titles = {t["title"] for t in TIPS_SEED}
        for t in NEW_FERRANDI_TIPS:
            assert t["title"] in migrated_titles

    def test_no_title_collision_with_new_ferrandi_tips(self):
        new_titles = {t["title"] for t in NEW_FERRANDI_TIPS}
        existing_titles = {t["title"] for t in BOOK_TIPS} | {t["title"] for t in BAKER_TIPS}
        assert not (new_titles & existing_titles)

    def test_no_title_collision_between_the_two_sources(self):
        book_titles = {t["title"] for t in BOOK_TIPS}
        baker_titles = {t["title"] for t in BAKER_TIPS}
        assert not (book_titles & baker_titles)

    def test_original_content_is_preserved_verbatim(self):
        by_title = {t["title"]: t for t in TIPS_SEED}
        for original in list(BOOK_TIPS) + list(BAKER_TIPS):
            assert by_title[original["title"]]["content"] == original["content"]

    def test_no_duplicate_titles_in_the_final_library(self):
        titles = [t["title"] for t in TIPS_SEED]
        assert len(titles) == len(set(titles))


class TestCategories:
    def test_every_tip_uses_a_category_from_the_requested_taxonomy(self):
        allowed = set(TIP_CATEGORIES)
        for t in TIPS_SEED:
            assert t["category"] in allowed, t["title"]

    def test_no_tip_keeps_a_retired_category_name(self):
        retired = {"Tourage", "Matériel", "Dépannage"}
        for t in TIPS_SEED:
            assert t["category"] not in retired

    def test_problem_solving_tips_land_in_problemes_et_solutions(self):
        for t in TIPS_SEED:
            if "problem" in t:
                assert t["category"] == "Problèmes & solutions"


class TestProblemSolutionStructure:
    def test_structured_tips_introduce_no_new_numbers(self):
        # A structured cause/solution is often reworded into an imperative
        # ("Un bol..." -> "Utiliser un bol..."), so word-for-word matching
        # against the original prose isn't meaningful — paraphrase is
        # expected. What must never happen is a *number* (a temperature, a
        # percentage, a duration) appearing in the structured text that isn't
        # already in the original: that would be a fabricated fact, not a
        # rewording.
        import re
        by_title = {t["title"]: t for t in list(BOOK_TIPS) + list(BAKER_TIPS)}
        for t in TIPS_SEED:
            if "problem" not in t:
                continue
            original_numbers = set(re.findall(r"\d+", by_title[t["title"]]["content"]))
            structured_text = " ".join([t["problem"], *t["causes"], *t["solutions"]])
            for n in re.findall(r"\d+", structured_text):
                assert n in original_numbers, (t["title"], n, structured_text)

    def test_causes_and_solutions_are_lists(self):
        for t in TIPS_SEED:
            if "problem" in t:
                assert isinstance(t["causes"], list)
                assert isinstance(t["solutions"], list)
                assert len(t["solutions"]) > 0


class TestKeywords:
    def test_every_tip_has_at_least_one_keyword(self):
        for t in TIPS_SEED:
            assert t["keywords"], t["title"]

    def test_every_keyword_actually_appears_in_the_tip_own_text(self):
        for t in TIPS_SEED:
            haystack = _normalize(" ".join([
                t["title"], t["content"],
                t.get("problem") or "", " ".join(t.get("causes") or []),
                " ".join(t.get("solutions") or []),
            ]))
            for kw in t["keywords"]:
                assert _normalize(kw) in haystack, (t["title"], kw)

    def test_no_duplicate_keywords_within_a_tip(self):
        for t in TIPS_SEED:
            assert len(t["keywords"]) == len(set(t["keywords"]))


class TestSources:
    def test_every_tip_has_a_source(self):
        for t in TIPS_SEED:
            assert t["source"]

    def test_fiset_and_ferrandi_and_app_are_the_only_sources(self):
        # New, page-cited FERRANDI tips carry their own "..., p. NN" suffix,
        # so they're checked by prefix rather than exact match.
        allowed_exact = {
            "Josée Fiset, « Comme à la boulangerie », Pratico Édition",
            "FERRANDI Paris, « Boulangerie Viennoiserie », Flammarion",
            "Contenu original de l'application",
        }
        for t in TIPS_SEED:
            assert t["source"] in allowed_exact or t["source"].startswith(
                "FERRANDI Paris, « Boulangerie Viennoiserie », Flammarion, p. "
            )

    def test_new_ferrandi_tips_carry_a_page_citation(self):
        for t in NEW_FERRANDI_TIPS:
            assert ", p. " in t["source"]

    def test_app_source_only_for_baker_tips(self):
        baker_titles = {t["title"] for t in BAKER_TIPS}
        for t in TIPS_SEED:
            if t["source"] == "Contenu original de l'application":
                assert t["title"] in baker_titles
