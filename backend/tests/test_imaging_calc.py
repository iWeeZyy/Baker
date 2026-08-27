"""Unit tests for message-photo image processing.

Pure functions, no server needed. Covers the two properties the rest of the
feature depends on: the stored/displayed photo is capped in size (spec point
12, "optimise les photos avant upload"), and the blurred preview genuinely
discards detail rather than merely smearing it — it is generated from a tiny
source resolution, not a blur filter over the full-size photo.
"""
import io
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import imaging  # noqa: E402


def _jpeg_bytes(width, height, color=(200, 120, 40)):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="JPEG")
    return buf.getvalue()


class TestDisplaySize:
    def test_small_image_is_untouched(self):
        assert imaging.display_size(400, 300) == (400, 300)

    def test_large_landscape_is_capped_on_the_long_edge(self):
        w, h = imaging.display_size(4000, 2000)
        assert w == imaging.MAX_DISPLAY_DIM
        assert h == imaging.MAX_DISPLAY_DIM // 2

    def test_large_portrait_is_capped_on_the_long_edge(self):
        w, h = imaging.display_size(2000, 4000)
        assert h == imaging.MAX_DISPLAY_DIM
        assert w == imaging.MAX_DISPLAY_DIM // 2


class TestPrepareDisplay:
    def test_output_is_a_valid_smaller_jpeg(self):
        raw = _jpeg_bytes(3000, 2000)
        out = imaging.prepare_display(raw)
        assert len(out) < len(raw)
        with Image.open(io.BytesIO(out)) as im:
            assert im.format == "JPEG"
            assert max(im.size) <= imaging.MAX_DISPLAY_DIM

    def test_small_image_keeps_its_dimensions(self):
        raw = _jpeg_bytes(300, 200)
        out = imaging.prepare_display(raw)
        with Image.open(io.BytesIO(out)) as im:
            assert im.size == (300, 200)

    def test_invalid_bytes_raise(self):
        with pytest.raises(Exception):
            imaging.prepare_display(b"this is not an image")


class TestMakeBlurPreview:
    def test_output_matches_display_dimensions(self):
        raw = _jpeg_bytes(1200, 800)
        blurred = imaging.make_blur_preview(raw)
        with Image.open(io.BytesIO(blurred)) as im:
            assert im.size == imaging.display_size(1200, 800)

    def test_output_discards_fine_detail(self):
        # A checkerboard has high-frequency detail; if the blur genuinely
        # discards it (shrink-then-blur), the result's pixels barely vary.
        # A blur filter applied directly to the full image would leave
        # far more local contrast than this.
        size = 400
        im = Image.new("RGB", (size, size))
        px = im.load()
        for x in range(size):
            for y in range(size):
                px[x, y] = (255, 255, 255) if (x // 10 + y // 10) % 2 == 0 else (0, 0, 0)
        buf = io.BytesIO()
        im.save(buf, format="JPEG")
        blurred = imaging.make_blur_preview(buf.getvalue())
        with Image.open(io.BytesIO(blurred)) as out:
            values = out.convert("L").tobytes()
        spread = max(values) - min(values)
        assert spread < 80, f"blurred preview still varies by {spread}/255 — detail was not discarded"

    def test_invalid_bytes_raise(self):
        with pytest.raises(Exception):
            imaging.make_blur_preview(b"this is not an image")
