"""Garde-fous de la table des archétypes visuels (`products.py`).

Elle décide quelle illustration porte une fiche recette qui n'a pas de photo.
Deux fautes sont possibles et aucune ne se voit à l'œil dans un diff : un titre
mal orthographié, qui n'assignerait rien en silence, et une clé d'archétype
sans dessin en face, qui laisserait une case vide à l'écran. Ces tests ne
touchent ni le réseau ni la base.

L'absence d'archétype, elle, n'est pas une faute : c'est le cas prévu d'une
forme qu'aucun dessin ne rend honnêtement. On vérifie donc qu'elle reste
possible, pas qu'elle disparaisse.
"""
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from products import PRODUCTS, PRODUCT_BY_TITLE, PRODUCT_KEYS, _ASSIGNMENTS, product_of  # noqa: E402
from seed_data import RECIPES_SEED  # noqa: E402

TITLES = {r["title"] for r in RECIPES_SEED}
FRONTEND = ROOT.parent / "frontend"


def test_every_assigned_title_exists_in_the_catalogue():
    """Un titre absent du catalogue n'illustrerait rien, sans rien signaler."""
    unknown = sorted(set(PRODUCT_BY_TITLE) - TITLES)
    assert unknown == [], f"titres inconnus dans products.py : {unknown}"


def test_every_assignment_key_is_a_declared_archetype():
    unknown = sorted(set(_ASSIGNMENTS) - PRODUCT_KEYS)
    assert unknown == [], f"archétypes non déclarés dans PRODUCTS : {unknown}"


def test_no_title_is_assigned_twice():
    seen = [t for titles in _ASSIGNMENTS.values() for t in titles]
    doubles = sorted({t for t in seen if seen.count(t) > 1})
    assert doubles == [], f"titres assignés deux fois : {doubles}"


def test_archetype_keys_are_unique_and_slug_shaped():
    keys = [p["key"] for p in PRODUCTS]
    assert len(keys) == len(set(keys)), "clé d'archétype en double"
    for key in keys:
        assert re.fullmatch(r"[a-z][a-z-]*[a-z]", key), key
        assert PRODUCTS[keys.index(key)]["label"].strip(), f"{key} sans libellé"


def test_every_archetype_is_actually_used():
    """Un archétype déclaré mais assigné à rien est un dessin embarqué pour rien."""
    unused = sorted(PRODUCT_KEYS - set(_ASSIGNMENTS))
    assert unused == [], f"archétypes sans aucune recette : {unused}"


def test_seeded_recipes_carry_their_archetype_or_none():
    for r in RECIPES_SEED:
        assert r["product"] == product_of(r["title"])
        assert r["product"] is None or r["product"] in PRODUCT_KEYS


def test_a_recipe_without_an_archetype_stays_without_one():
    """L'absence est un état prévu, pas un trou à combler par un dessin proche.

    Un kouglof illustré par une brioche à tête montrerait autre chose que la
    recette. La fiche garde alors son bandeau nu, que l'écran gère déjà.
    """
    assert product_of("Kouglof") is None
    assert product_of("Palmiers") is None
    assert product_of("Un titre qui n'existe pas") is None
    assert any(r["product"] is None for r in RECIPES_SEED)


@pytest.mark.parametrize("key", sorted(PRODUCT_KEYS))
def test_every_archetype_has_a_rendered_tile(key):
    """Le `Record` typé de `products.ts` fait déjà échouer `tsc` s'il manque une
    entrée ; ici on vérifie que le PNG derrière le `require` existe vraiment,
    ce que TypeScript ne peut pas voir."""
    src = (FRONTEND / "src" / "products.ts").read_text(encoding="utf-8")
    m = re.search(rf"'{re.escape(key)}':\s*require\('\.\./([^']+)'\)", src)
    assert m, f"{key} n'a pas d'image dans frontend/src/products.ts"
    png = FRONTEND / m.group(1)
    assert png.is_file(), f"{key} pointe sur un fichier absent : {png}"
    assert png.stat().st_size > 0
    svg = png.with_suffix(".svg")
    assert svg.is_file(), f"{png.name} n'a pas de source SVG — un binaire sans source ne se corrige pas"
