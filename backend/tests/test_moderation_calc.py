"""Unit tests for image-moderation classification.

Pure functions, no server and no network needed — the threshold logic and
the fallback-on-failure behaviour are the safety net for the rule the whole
feature depends on: a photo is never blocked just for being potentially
sexual, and an unanalyzed photo is never presented as safe.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import moderation  # noqa: E402


class TestClassify:
    def test_low_scores_are_normal(self):
        level, score = moderation.classify(0.0, 0.0)
        assert level == moderation.NORMAL
        assert score == 0.0

    def test_raw_below_sensitive_threshold_stays_normal(self):
        level, _ = moderation.classify(moderation.SENSITIVE_THRESHOLD - 0.01, 0.0)
        assert level == moderation.NORMAL

    def test_raw_at_sensitive_threshold_is_sensitive(self):
        level, _ = moderation.classify(moderation.SENSITIVE_THRESHOLD, 0.0)
        assert level == moderation.SENSITIVE

    def test_partial_alone_can_reach_sensitive(self):
        # Partial/suggestive nudity, even at a high score, must never reach
        # BLOCKED by itself — only `raw` (fully explicit) can. This is the
        # rule from the spec: potential nudity is never "manifestement interdit".
        level, _ = moderation.classify(0.0, 0.99)
        assert level == moderation.SENSITIVE

    def test_partial_alone_never_reaches_blocked(self):
        level, _ = moderation.classify(0.0, 1.0)
        assert level == moderation.SENSITIVE

    def test_raw_at_block_threshold_is_blocked(self):
        level, _ = moderation.classify(moderation.BLOCK_THRESHOLD, 0.0)
        assert level == moderation.BLOCKED

    def test_raw_just_below_block_threshold_is_only_sensitive(self):
        level, _ = moderation.classify(moderation.BLOCK_THRESHOLD - 0.01, 0.0)
        assert level == moderation.SENSITIVE

    def test_score_reports_the_driving_value(self):
        _, score = moderation.classify(0.95, 0.1)
        assert score == 0.95
        _, score = moderation.classify(0.1, 0.95)
        assert score == 0.95


class TestAnalyzeFallback:
    """`analyze()` must never raise, and must never silently call an
    unanalyzed photo "normal" — checked here by forcing the underlying
    provider call to fail, entirely in-process (no live server involved)."""

    def test_provider_off_falls_back_without_raising(self, monkeypatch):
        monkeypatch.setattr(moderation, "PROVIDER", "off")
        result = moderation.analyze(b"not a real image, never decoded on this path")
        assert result.status == "unavailable"
        assert result.level == moderation.FALLBACK_LEVEL

    def test_provider_error_falls_back_without_raising(self, monkeypatch):
        monkeypatch.setattr(moderation, "PROVIDER", "sightengine")

        def _boom(image_bytes):
            raise RuntimeError("simulated network failure")

        monkeypatch.setattr(moderation, "_sightengine_score", _boom)
        result = moderation.analyze(b"irrelevant")
        assert result.status == "unavailable"
        assert result.provider == "fallback"
        assert result.level == moderation.FALLBACK_LEVEL

    def test_fallback_level_defaults_to_sensitive_not_normal(self):
        # The default in .env.example / the module — an unanalyzed photo
        # must be cautious by default, never assumed safe.
        assert moderation.FALLBACK_LEVEL != moderation.NORMAL

    def test_default_fallback_env_value_is_honoured(self, monkeypatch):
        monkeypatch.setattr(moderation, "FALLBACK_LEVEL", moderation.BLOCKED)
        monkeypatch.setattr(moderation, "PROVIDER", "off")
        result = moderation.analyze(b"irrelevant")
        assert result.level == moderation.BLOCKED

    def test_successful_classification_is_not_marked_unavailable(self, monkeypatch):
        monkeypatch.setattr(moderation, "PROVIDER", "sightengine")
        monkeypatch.setattr(moderation, "_sightengine_score", lambda image_bytes: (0.0, 0.0))
        result = moderation.analyze(b"irrelevant")
        assert result.status == "checked"
        assert result.level == moderation.NORMAL
        assert result.provider == "sightengine"


class TestStubProvider:
    """The deterministic, network-free stand-in used by MODERATION_PROVIDER=stub
    (test suite / local dev only — see the module docstring)."""

    def _solid(self, r, g, b):
        import io
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (10, 10), (r, g, b)).save(buf, format="JPEG")
        return buf.getvalue()

    def test_red_swatch_classifies_as_raw_explicit(self, monkeypatch):
        monkeypatch.setattr(moderation, "PROVIDER", "stub")
        result = moderation.analyze(self._solid(255, 0, 0))
        assert result.level == moderation.BLOCKED
        assert result.status == "checked"

    def test_orange_swatch_classifies_as_partial(self, monkeypatch):
        monkeypatch.setattr(moderation, "PROVIDER", "stub")
        result = moderation.analyze(self._solid(255, 150, 0))
        assert result.level == moderation.SENSITIVE

    def test_blue_swatch_simulates_an_outage(self, monkeypatch):
        monkeypatch.setattr(moderation, "PROVIDER", "stub")
        result = moderation.analyze(self._solid(0, 0, 255))
        assert result.status == "unavailable"
        assert result.level == moderation.FALLBACK_LEVEL

    def test_neutral_swatch_is_normal(self, monkeypatch):
        monkeypatch.setattr(moderation, "PROVIDER", "stub")
        result = moderation.analyze(self._solid(180, 180, 180))
        assert result.level == moderation.NORMAL
