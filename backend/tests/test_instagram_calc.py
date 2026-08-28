"""Tests purs de instagram.py — pas de serveur, pas de réseau."""
import pytest

from instagram import parse_instagram_username, instagram_profile_url


class TestValidInputs:
    def test_bare_username(self):
        assert parse_instagram_username("lucas_boulanger") == "lucas_boulanger"

    def test_at_prefixed_username(self):
        assert parse_instagram_username("@lucas_boulanger") == "lucas_boulanger"

    def test_full_url(self):
        assert parse_instagram_username("https://www.instagram.com/lucas_boulanger/") == "lucas_boulanger"

    def test_full_url_without_www(self):
        assert parse_instagram_username("https://instagram.com/lucas_boulanger") == "lucas_boulanger"

    def test_url_without_scheme(self):
        assert parse_instagram_username("www.instagram.com/lucas_boulanger") == "lucas_boulanger"

    def test_url_without_scheme_or_www(self):
        assert parse_instagram_username("instagram.com/lucas_boulanger") == "lucas_boulanger"

    def test_url_with_query_string(self):
        assert parse_instagram_username("https://www.instagram.com/lucas_boulanger/?hl=fr") == "lucas_boulanger"

    def test_username_with_dots_and_digits(self):
        assert parse_instagram_username("lucas.boulanger_2026") == "lucas.boulanger_2026"

    def test_strips_surrounding_whitespace(self):
        assert parse_instagram_username("  lucas_boulanger  ") == "lucas_boulanger"


class TestInvalidInputs:
    def test_empty(self):
        with pytest.raises(ValueError):
            parse_instagram_username("")

    def test_whitespace_only(self):
        with pytest.raises(ValueError):
            parse_instagram_username("   ")

    def test_other_domain_rejected(self):
        with pytest.raises(ValueError):
            parse_instagram_username("https://evil.example.com/lucas_boulanger")

    def test_other_domain_that_merely_contains_instagram_rejected(self):
        with pytest.raises(ValueError):
            parse_instagram_username("https://instagram.com.evil.example/lucas")

    def test_url_with_no_path_rejected(self):
        with pytest.raises(ValueError):
            parse_instagram_username("https://www.instagram.com/")

    def test_illegal_characters_rejected(self):
        with pytest.raises(ValueError):
            parse_instagram_username("lucas boulanger!")

    def test_too_long_rejected(self):
        with pytest.raises(ValueError):
            parse_instagram_username("a" * 31)

    def test_at_sign_alone_rejected(self):
        with pytest.raises(ValueError):
            parse_instagram_username("@")


class TestProfileUrl:
    def test_builds_expected_url(self):
        assert instagram_profile_url("lucas_boulanger") == "https://www.instagram.com/lucas_boulanger/"
