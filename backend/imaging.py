"""Transformations d'image pures pour les photos de message : redimensionner
et compresser avant stockage, et produire un aperçu fortement flouté pour les
photos classées « sensibles ».

Ni base de données ni réseau — des octets en entrée, des octets en sortie —
donc directement testable, comme production.py / staff.py / costing.py.

L'aperçu flouté est produit en réduisant d'abord la photo à une toute petite
résolution source, puis en la floutant, avant de la remettre à l'échelle. Un
simple filtre de flou étale les pixels en pleine résolution et peut être
inversé avec des outils de netteté ; réduire d'abord fait réellement
disparaître le détail, il n'y a donc plus rien à récupérer. C'est ce qui rend
cet aperçu sûr à envoyer au destinataire avant qu'il ne choisisse d'afficher
la photo (point 12/13 du cahier des charges) — le client n'a jamais besoin de
télécharger la photo complète pour afficher ce à quoi elle ressemble avant
d'être floutée.
"""
import io
from typing import Tuple

from PIL import Image, ImageFilter

MAX_DISPLAY_DIM = 1600   # px, le plus grand côté de la photo stockée/affichée
JPEG_QUALITY = 82
BLUR_SOURCE_DIM = 24     # px, le plus grand côté de la source utilisée pour le flou
BLUR_RADIUS = 12
BLUR_JPEG_QUALITY = 60   # un aperçu flouté se compresse davantage sans perte visible


def _load_rgb(image_bytes: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(image_bytes))
    im.load()  # échoue tout de suite ici sur des octets corrompus/non-image, pas plus tard au .save()
    return im.convert("RGB")


def _encode_jpeg(im: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def display_size(width: int, height: int) -> Tuple[int, int]:
    """La taille à laquelle une photo est affichée/stockée — pure, pour que
    l'aperçu flouté puisse être redimensionné exactement pareil sans
    redériver cette logique ailleurs."""
    if width <= MAX_DISPLAY_DIM and height <= MAX_DISPLAY_DIM:
        return width, height
    ratio = min(MAX_DISPLAY_DIM / width, MAX_DISPLAY_DIM / height)
    return max(1, round(width * ratio)), max(1, round(height * ratio))


def prepare_display(image_bytes: bytes) -> bytes:
    """Redimensionne/compresse la photo réellement stockée et affichée — la
    photo brute envoyée par l'appareil n'est jamais conservée telle quelle."""
    im = _load_rgb(image_bytes)
    im.thumbnail(display_size(*im.size), Image.LANCZOS)
    return _encode_jpeg(im, JPEG_QUALITY)


def make_blur_preview(image_bytes: bytes) -> bytes:
    """Un aperçu petit et fortement flouté, montré avant que le destinataire
    ne révèle une photo « sensible », mis à la même taille que celle que
    produirait prepare_display() pour que la bulle de discussion ne change
    pas de taille au moment de la révélation."""
    im = _load_rgb(image_bytes)
    target_w, target_h = display_size(*im.size)
    small = im.copy()
    small.thumbnail((BLUR_SOURCE_DIM, BLUR_SOURCE_DIM), Image.LANCZOS)
    small = small.filter(ImageFilter.GaussianBlur(radius=BLUR_RADIUS))
    preview = small.resize((target_w, target_h), Image.LANCZOS)
    return _encode_jpeg(preview, BLUR_JPEG_QUALITY)
