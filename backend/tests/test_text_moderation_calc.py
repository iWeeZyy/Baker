"""Tests unitaires pour la modération de texte contextuelle.

Fonctions pures, sans serveur ni réseau. Le cœur de la fonctionnalité est
la priorité de la whitelist professionnelle sur la liste des mots
interdits : c'est ce qui empêche « bâtard » (une forme de pain) d'être
traité comme une insulte dans une application de boulangerie.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import text_moderation as tm  # noqa: E402


class TestWhitelistPriority:
    """Les exemples donnés dans la demande : la whitelist doit gagner dès
    qu'un marqueur de contexte boulangerie est présent ailleurs dans le
    même texte, quel que soit BAN_WORDS."""

    def setup_method(self):
        tm.BAN_WORDS = {"batard"}

    def teardown_method(self):
        tm.BAN_WORDS = set()

    def test_pain_batard_au_levain_is_safe(self):
        result = tm.classify_text("Pain bâtard au levain")
        assert result.level == tm.SAFE
        assert result.matches == []

    def test_faconner_un_batard_is_safe(self):
        result = tm.classify_text("Façonner un bâtard")
        assert result.level == tm.SAFE

    def test_bare_batard_with_no_context_is_review_not_blocked(self):
        # Ambigu : le terme est dans la whitelist mais aucun marqueur de
        # contexte n'est trouvé ailleurs dans le texte. Jamais bloqué
        # d'office sur la seule ambiguïté.
        result = tm.classify_text("Bâtard")
        assert result.level == tm.REVIEW
        assert result.matches[0].term == "batard"
        assert result.matches[0].tier == tm.REVIEW

    def test_unaccented_batard_matches_accented_whitelist_entry(self):
        # « batard » (sans accent) doit être reconnu exactement comme
        # « bâtard » — l'utilisateur ne tape pas toujours les accents.
        result = tm.classify_text("Un beau batard de campagne, avec de la farine T65")
        assert result.level == tm.SAFE

    def test_context_marker_anywhere_in_text_counts(self):
        # Le marqueur peut se trouver n'importe où dans le texte soumis,
        # pas seulement à proximité immédiate du terme.
        result = tm.classify_text("Bâtard — recette transmise par mon grand-père. Le four doit être bien chaud.")
        assert result.level == tm.SAFE


class TestWhitelistTermsAlwaysSafe:
    """Les termes marqués None dans WHITELIST_TERMS (aucun sens injurieux
    réel) restent toujours SAFE, avec ou sans contexte."""

    def test_fougasse_alone_is_safe(self):
        tm.BAN_WORDS = {"fougasse"}
        try:
            result = tm.classify_text("Fougasse")
            assert result.level == tm.SAFE
        finally:
            tm.BAN_WORDS = set()

    def test_miche_alone_is_safe(self):
        tm.BAN_WORDS = {"miche"}
        try:
            result = tm.classify_text("Une belle miche")
            assert result.level == tm.SAFE
        finally:
            tm.BAN_WORDS = set()


class TestNonWhitelistedBanWords:
    """Un mot interdit sans aucune entrée dans WHITELIST_TERMS est bloqué
    directement — pas de sens professionnel connu pour le sauver."""

    def setup_method(self):
        tm.BAN_WORDS = {"connard"}

    def teardown_method(self):
        tm.BAN_WORDS = set()

    def test_ban_word_without_whitelist_entry_is_blocked(self):
        result = tm.classify_text("Ce commentaire contient connard")
        assert result.level == tm.BLOCKED
        assert result.matches[0].term == "connard"
        assert result.matches[0].tier == tm.BLOCKED

    def test_case_insensitive(self):
        result = tm.classify_text("CONNARD en majuscules")
        assert result.level == tm.BLOCKED

    def test_word_boundary_does_not_match_substring(self):
        # "connard" ne doit pas matcher à l'intérieur d'un autre mot.
        result = tm.classify_text("Reconnardable n'est pas un mot")
        assert result.level == tm.SAFE


class TestCombinedTerms:
    def test_blocked_takes_priority_over_review(self):
        tm.BAN_WORDS = {"batard", "connard"}
        try:
            # "Bâtard" seul -> review ; "connard" -> blocked. Le résultat
            # global doit être BLOCKED (un seul BLOCKED suffit).
            result = tm.classify_text("Bâtard, espèce de connard")
            assert result.level == tm.BLOCKED
            tiers = {m.term: m.tier for m in result.matches}
            assert tiers["connard"] == tm.BLOCKED
            assert tiers["batard"] == tm.REVIEW
        finally:
            tm.BAN_WORDS = set()

    def test_review_alone_without_blocked(self):
        tm.BAN_WORDS = {"batard", "boule"}
        try:
            result = tm.classify_text("Bâtard et boule, sans aucun contexte")
            assert result.level == tm.REVIEW
        finally:
            tm.BAN_WORDS = set()


class TestEmptyBanWordsIsAlwaysSafe:
    """Tant que BAN_WORDS est vide (placeholder livré par défaut), rien
    n'est jamais bloqué ni mis en revue — le module ne doit rien inventer."""

    def test_empty_ban_words_never_flags_anything(self):
        assert tm.BAN_WORDS == set()
        result = tm.classify_text("N'importe quel texte, même injurieux comme connard")
        assert result.level == tm.SAFE
        assert result.matches == []


class TestRecipeAndCommentWrappers:
    def setup_method(self):
        tm.BAN_WORDS = {"batard"}

    def teardown_method(self):
        tm.BAN_WORDS = set()

    def test_recipe_context_can_come_from_another_field(self):
        # Le titre seul est ambigu, mais une étape mentionne "façonner" :
        # le contexte est cherché sur l'ensemble des champs de la recette.
        result = tm.classify_recipe(
            title="Bâtard de campagne",
            description="",
            ingredients=["farine", "eau", "sel", "levain"],
            steps=["Pétrir la pâte.", "Façonner en bâtard.", "Cuire au four."],
        )
        assert result.level == tm.SAFE

    def test_recipe_with_no_context_anywhere_is_review(self):
        result = tm.classify_recipe(
            title="Bâtard",
            description="",
            ingredients=[],
            steps=[],
        )
        assert result.level == tm.REVIEW

    def test_comment_wrapper_delegates_to_classify_text(self):
        result = tm.classify_comment("Façonner un bâtard bien serré")
        assert result.level == tm.SAFE


class TestEmptyOrNoneInput:
    def test_empty_string_is_safe(self):
        assert tm.classify_text("").level == tm.SAFE

    def test_none_is_safe(self):
        assert tm.classify_text(None).level == tm.SAFE
