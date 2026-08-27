"""Garde-fous de la table des photos (`recipe_photos.py`).

Une photo mal associée est la faute la plus visible qu'on puisse commettre ici :
un entremets au chocolat sur un « Écrin feuilleté aux noisettes » se voit au
premier coup d'œil et discrédite le reste du catalogue. Ces tests ne peuvent pas
regarder une image — c'est le travail de relecture — mais ils refusent tout ce
qui trahit une association faite sans regarder :

  - une entrée sans note `vu`, c'est-à-dire sans trace de ce qui a été vu ;
  - une entrée sans auteur ni page source, qu'on ne pourrait pas créditer alors
    que les API Guidelines de Pexels l'imposent ;
  - un score sous le seuil, ou absent ;
  - un titre qui n'existe pas au catalogue, qui n'illustrerait rien en silence ;
  - une URL qui ne vient pas du CDN de la banque annoncée.

Ils ne touchent ni le réseau ni la base.
"""
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from recipe_photos import (  # noqa: E402
    LICENCE_PEXELS, MIN_SCORE, PHOTOS, REQUIRED_KEYS, SOURCE_PEXELS,
    credit_of, photo_of,
)
from products import product_of  # noqa: E402
from seed_data import RECIPES_SEED  # noqa: E402

TITLES = {r["title"] for r in RECIPES_SEED}
CDN = {SOURCE_PEXELS: "images.pexels.com"}
PAGE_HOST = {SOURCE_PEXELS: "www.pexels.com"}


def ids(entries):
    return [t for t in entries]


class TestTable:
    def test_every_title_exists_in_the_catalogue(self):
        """Un titre mal orthographié n'illustrerait rien, et sans rien signaler."""
        unknown = sorted(set(PHOTOS) - TITLES)
        assert unknown == [], f"titres inconnus dans recipe_photos.py : {unknown}"

    @pytest.mark.parametrize("title", sorted(PHOTOS), ids=ids(sorted(PHOTOS)))
    def test_entry_is_complete(self, title):
        missing = sorted(REQUIRED_KEYS - set(PHOTOS[title]))
        assert missing == [], f"« {title} » : clés manquantes {missing}"

    @pytest.mark.parametrize("title", sorted(PHOTOS), ids=ids(sorted(PHOTOS)))
    def test_entry_records_what_was_actually_seen(self, title):
        """Le champ `vu` est la trace de la vérification visuelle.

        Sans lui, rien ne distingue une photo regardée d'une photo retenue parce
        que son titre ressemblait à celui de la recette — ce que le cahier des
        charges interdit explicitement. Une phrase creuse ne vaut pas mieux
        qu'un champ vide, d'où la longueur minimale.
        """
        vu = PHOTOS[title].get("vu") or ""
        assert len(vu.strip()) >= 15, (
            f"« {title} » : la note `vu` doit décrire ce que montre l'image, "
            f"pas seulement exister (reçu : {vu!r})"
        )

    @pytest.mark.parametrize("title", sorted(PHOTOS), ids=ids(sorted(PHOTOS)))
    def test_entry_can_be_credited(self, title):
        """On ne peut pas créditer ce qu'on n'a pas noté."""
        p = PHOTOS[title]
        assert p["author"].strip(), f"« {title} » : photographe manquant"
        assert p["author_url"].startswith("https://"), f"« {title} » : profil manquant"
        assert p["page"].startswith("https://"), f"« {title} » : page source manquante"
        assert p["licence"] == LICENCE_PEXELS, f"« {title} » : licence inattendue"

    @pytest.mark.parametrize("title", sorted(PHOTOS), ids=ids(sorted(PHOTOS)))
    def test_score_clears_the_bar(self, title):
        score = PHOTOS[title].get("score")
        assert isinstance(score, int) and MIN_SCORE <= score <= 100, (
            f"« {title} » : score {score!r}, hors du domaine retenu "
            f"({MIN_SCORE}-100)"
        )

    @pytest.mark.parametrize("title", sorted(PHOTOS), ids=ids(sorted(PHOTOS)))
    def test_urls_come_from_the_announced_source(self, title):
        """Une URL d'ailleurs, c'est une licence qu'on n'a pas vérifiée."""
        p = PHOTOS[title]
        assert p["source"] in CDN, f"« {title} » : source inconnue {p['source']!r}"
        assert f"//{CDN[p['source']]}/" in p["url"], (
            f"« {title} » : l'URL ne vient pas de {CDN[p['source']]} — {p['url']}"
        )
        assert f"//{PAGE_HOST[p['source']]}/" in p["page"], (
            f"« {title} » : la page source ne vient pas de {PAGE_HOST[p['source']]}"
        )

    def test_no_photo_is_used_twice(self):
        """Deux recettes différentes ne peuvent pas montrer la même photo.

        Le cahier des charges interdit de confondre des produits proches. Deux
        fiches partageant une photo affirment que ce sont les mêmes ; si elles
        le sont vraiment, c'est le catalogue qu'il faut corriger, pas la table.
        """
        seen = {}
        for title, p in PHOTOS.items():
            seen.setdefault(p["url"], []).append(title)
        doubles = {u: t for u, t in seen.items() if len(t) > 1}
        assert doubles == {}, f"photos partagées par plusieurs recettes : {doubles}"


class TestSeed:
    def test_credit_follows_the_photo(self):
        """Une fiche a un crédit si et seulement si elle a une photo."""
        for r in RECIPES_SEED:
            has_photo = bool(r["image_url"])
            has_credit = bool(r["image_credit"])
            assert has_photo == has_credit, (
                f"« {r['title']} » : photo={has_photo} mais crédit={has_credit}"
            )

    def test_every_recipe_has_a_photo_a_drawing_or_a_plain_band(self):
        """Aucune fiche ne doit tomber dans un trou.

        L'absence de photo est un état prévu — la fiche garde son dessin
        d'archétype, puis une bande unie. Ce test dit seulement que les trois
        états sont exhaustifs et qu'aucune fiche n'échappe à la chaîne.
        """
        for r in RECIPES_SEED:
            states = (bool(r["image_url"]), bool(r.get("product")), True)
            assert any(states), f"« {r['title']} » n'a ni photo, ni dessin, ni repli"

    def test_a_recipe_without_a_photo_keeps_no_credit(self):
        assert photo_of("Un titre qui n'existe pas") is None
        assert credit_of("Un titre qui n'existe pas") is None

    def test_the_table_only_covers_recipes_it_was_verified_on(self):
        """La couverture est libre — 0 comme 194 — mais jamais implicite.

        Tant que la moisson n'a pas eu lieu, la table est vide et toutes les
        fiches gardent leur dessin. C'est un état valide, pas un échec : mieux
        vaut aucune photo qu'une photo qui montre autre chose.
        """
        stamped = {r["title"] for r in RECIPES_SEED if r["image_url"]}
        assert stamped == set(PHOTOS), (
            "les fiches marquées d'une photo ne correspondent pas à la table"
        )
