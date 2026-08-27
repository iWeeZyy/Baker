"""Tests unitaires pour le traitement d'image des photos de message.

Fonctions pures, sans serveur. Couvre les deux propriétés dont dépend le
reste de la fonctionnalité : la photo stockée/affichée est plafonnée en
taille (point 12 du cahier des charges, « optimise les photos avant
upload »), et l'aperçu flouté fait réellement disparaître le détail plutôt
que de simplement l'étaler — il est produit à partir d'une résolution
source minuscule, pas d'un filtre de flou appliqué à la photo pleine taille.
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
            imaging.prepare_display(b"ceci n'est pas une image")


class TestMakeBlurPreview:
    def test_output_matches_display_dimensions(self):
        raw = _jpeg_bytes(1200, 800)
        blurred = imaging.make_blur_preview(raw)
        with Image.open(io.BytesIO(blurred)) as im:
            assert im.size == imaging.display_size(1200, 800)

    def test_output_discards_fine_detail(self):
        # Un damier a un détail à haute fréquence ; si le flou le fait
        # vraiment disparaître (réduction puis flou), les pixels du
        # résultat varient à peine. Un filtre de flou appliqué directement
        # à l'image pleine taille laisserait bien plus de contraste local.
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
        assert spread < 80, f"l'aperçu flouté varie encore de {spread}/255 — le détail n'a pas disparu"

    def test_invalid_bytes_raise(self):
        with pytest.raises(Exception):
            imaging.make_blur_preview(b"ceci n'est pas une image")


class TestPrepareAvatar:
    def test_rectangular_image_becomes_square(self):
        raw = _jpeg_bytes(1200, 800)
        out = imaging.prepare_avatar(raw)
        with Image.open(io.BytesIO(out)) as im:
            assert im.width == im.height

    def test_crop_is_centered_not_stretched(self):
        # Une bande verticale centrée d'une couleur distincte : le
        # recadrage carré centré doit la conserver entière, une mise à
        # l'échelle non centrée la couperait ou la déformerait.
        w, h = 300, 100
        im = Image.new("RGB", (w, h), (255, 255, 255))
        px = im.load()
        for x in range(w // 2 - 20, w // 2 + 20):
            for y in range(h):
                px[x, y] = (255, 0, 0)
        buf = io.BytesIO()
        im.save(buf, format="JPEG")
        out = imaging.prepare_avatar(buf.getvalue())
        with Image.open(io.BytesIO(out)) as result:
            cx, cy = result.width // 2, result.height // 2
            r, g, b = result.convert("RGB").getpixel((cx, cy))
        assert r > 200 and g < 60 and b < 60

    def test_large_image_is_capped_to_avatar_max_dim(self):
        raw = _jpeg_bytes(3000, 3000)
        out = imaging.prepare_avatar(raw)
        with Image.open(io.BytesIO(out)) as im:
            assert im.width == imaging.AVATAR_MAX_DIM
            assert im.height == imaging.AVATAR_MAX_DIM

    def test_small_image_is_not_upscaled(self):
        raw = _jpeg_bytes(100, 100)
        out = imaging.prepare_avatar(raw)
        with Image.open(io.BytesIO(out)) as im:
            assert im.size == (100, 100)

    def test_invalid_bytes_raise(self):
        with pytest.raises(Exception):
            imaging.prepare_avatar(b"ceci n'est pas une image")
