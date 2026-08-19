"""Contrôle qualité du contenu embarqué.

Ces tests ne touchent ni le réseau ni la base : ils lisent `seed_data.py` et
vérifient que ce qui part au fournil se tient. Ils existent parce que la
majorité des fiches vient d'une extraction de PDF, et qu'une extraction rate
toujours quelque chose — une ligne coupée en deux, une parenthèse ouverte
jamais refermée, une température lue de travers. Chaque contrôle correspond à
une faute réellement rencontrée pendant l'import.

Rien ici ne vérifie le *goût* d'une recette : seulement qu'elle est complète,
cohérente avec elle-même et lisible.
"""
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from seed_data import RECIPES_SEED, TIPS_SEED  # noqa: E402
from production import parse_ingredient  # noqa: E402
from families import CATEGORIES as FAMILY_CATEGORIES, FAMILIES, FAMILY_KEYS  # noqa: E402

# Les catégories sont celles que portent les familles : les lister une
# seconde fois ici reviendrait à pouvoir en oublier une.
CATEGORIES = set(FAMILY_CATEGORIES)
DIFFICULTIES = {"Facile", "Intermédiaire", "Avancé"}
TIP_CATEGORIES = {
    "Fermentation", "Hydratation", "Cuisson", "Façonnage",
    "Dépannage", "Tourage", "Matériel",
}
# Les clés que la fiche technique sait afficher. Une clé inconnue serait
# silencieusement invisible à l'écran, ce qui est pire qu'une donnée absente.
TECHNICAL_KEYS = {
    "yield_label", "prep", "trempage", "petrissage", "autolyse", "tourage",
    "fermentation", "pointage", "detente", "appret", "repos", "refrigeration",
    "congelation", "maceration", "cuisson", "oven", "dough_temp",
    "conservation", "accompagnement", "equipment",
}

TEMPERATURE = re.compile(r"(\d+)\s*°\s*C")


def ids(recipes):
    return [r["title"] for r in recipes]


class TestRecipesComplete:
    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_champs_obligatoires(self, r):
        assert r["title"].strip()
        assert r["description"].strip()
        assert r["ingredients"], "aucun ingrédient"
        assert r["steps"], "aucune étape"

    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_vocabulaire(self, r):
        assert r["category"] in CATEGORIES
        assert r["difficulty"] in DIFFICULTIES

    def test_pas_de_doublon_de_titre(self):
        titles = [r["title"] for r in RECIPES_SEED]
        assert len(titles) == len(set(titles)), \
            sorted(t for t in set(titles) if titles.count(t) > 1)


class TestRecipesCoherent:
    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_temps_total_positif(self, r):
        assert r["time_minutes"] > 0

    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_hydratation_plausible(self, r):
        # 0 vaut « non renseigné ». Renseignée, elle reste dans la fourchette
        # d'une pâte : en dessous de 35 % on ne pétrit plus, au-dessus de 100 %
        # on verse.
        h = r.get("hydration", 0)
        assert h == 0 or 35 <= h <= 100, h

    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_temperatures_plausibles(self, r):
        # Un four de boulangerie va de la meringue séchée à 90 °C à la baguette
        # enfournée à 270 °C ; une pâte se travaille au-dessus de 0. Au-delà de
        # 300 °C, plus rien ne cuit dans un fournil : c'est une erreur de
        # lecture, pas une recette.
        for text in r["steps"] + list((r.get("technical") or {}).values()):
            if not isinstance(text, str):
                continue
            for value in TEMPERATURE.findall(text):
                assert 0 < int(value) <= 300, f"{value} °C dans « {text[:60]} »"

    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_rendement_coherent(self, r):
        # Quand les deux sont donnés, le nombre de pièces doit être celui
        # qu'annonce le libellé : « 16 croissants » et yield_pieces = 12 est
        # une contradiction que le planning de production propagerait.
        label = (r.get("technical") or {}).get("yield_label")
        pieces = r.get("yield_pieces")
        if not label or pieces is None:
            return
        first = re.match(r"\s*(?:environ\s+)?(\d+)", label)
        if first:
            assert int(first.group(1)) == pieces, f"{label!r} vs {pieces}"


class TestNoScanArtifacts:
    """Les fautes que laisse une extraction de PDF, une par contrôle."""

    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_parentheses_equilibrees(self, r):
        for text in r["ingredients"] + r["steps"] + [r["description"]]:
            assert text.count("(") == text.count(")"), text

    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_pas_de_bribe_de_prose(self, r):
        # Un ingrédient peut n'avoir aucune quantité — « Gros sel », « Sucre à
        # glacer au goût ». Ce qui trahit la bribe de prose, c'est la forme :
        # elle commence en minuscule ou se termine par une ponctuation de fin
        # de phrase, ce qu'une ligne d'ingrédient ne fait jamais.
        for line in r["ingredients"]:
            assert not line[:1].islower(), line
            assert not line.rstrip().endswith((".", "!", "?")), line

    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_pas_de_mesure_imperiale(self, r):
        # Baker est un outil de fournil français : le livre source double
        # chaque mesure en tasses et en pouces, elles ne doivent pas passer.
        for text in r["ingredients"] + r["steps"]:
            assert not re.search(r"\btasses?\b|\bc\.\s*à\s*(?:soupe|thé)\b|°\s*F\b", text, re.I), text

    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_pas_de_renvoi_au_livre(self, r):
        # « photo B », « voir p. 61 » : des renvois qui n'ont plus de sens une
        # fois la fiche sortie de l'ouvrage.
        for text in r["ingredients"] + r["steps"]:
            assert not re.search(r"\bphotos?\s+[A-Z]\b|\bvoir\s+p\.|\bcode QR\b", text), text

    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_ponctuation(self, r):
        for text in r["ingredients"] + r["steps"] + [r["description"]]:
            assert "  " not in text, text
            assert "’" not in text, "une seule forme d'apostrophe : " + text
            assert not re.search(r"\s[,.]", text), text
            # L'astérisque de renvoi aux notes de l'ouvrage n'a pas de sens ici.
            assert "*" not in text, text


class TestUnits:
    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_quantites_lisibles_par_le_planning(self, r):
        # Le planning de production met les ingrédients à l'échelle : une ligne
        # qui commence par un nombre et une unité doit être lue correctement,
        # sinon la mise à l'échelle la laisse de côté en silence.
        for line in r["ingredients"]:
            if not re.match(r"\s*\d+(?:[.,]\d+)?\s*(kg|g|cl|ml|l)\b", line, re.I):
                continue
            parsed = parse_ingredient(line)
            assert parsed is not None and parsed.get("name"), line


class TestTechnicalSheet:
    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_cles_connues(self, r):
        technical = r.get("technical")
        if not technical:
            return
        assert set(technical) <= TECHNICAL_KEYS, set(technical) - TECHNICAL_KEYS
        for key, value in technical.items():
            if key == "equipment":
                assert isinstance(value, list) and all(v.strip() for v in value)
            else:
                assert isinstance(value, str) and value.strip(), key

    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_source_citee_avec_la_page(self, r):
        # Toute fiche embarquée porte son ouvrage et sa page : c'est ce qui rend
        # la donnée vérifiable, et ce qui sépare une reprise d'une copie. Les
        # recettes de démonstration écrites par un modèle, elles, ne pouvaient
        # rien citer — c'est pourquoi elles ne sont plus là.
        assert re.search(r",\s*p\.\s*\d+$", r.get("source") or ""), r.get("source")


class TestFamilies:
    """La famille est ce qui rend une recette atteignable : sans elle, aucune
    vignette ne l'ouvre. Les contrôles portent donc sur l'atteignabilité, pas
    sur le classement lui-même."""

    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_famille_connue(self, r):
        assert r.get("family") in FAMILY_KEYS, r.get("family")

    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_famille_dans_sa_categorie(self, r):
        family = next(f for f in FAMILIES if f["key"] == r["family"])
        assert family["category"] == r["category"], f"{family['key']} vs {r['category']}"

    @pytest.mark.parametrize("r", RECIPES_SEED, ids=ids(RECIPES_SEED))
    def test_pas_de_fourre_tout_dans_le_catalogue(self, r):
        # Le fourre-tout n'existe que pour les recettes de la communauté. Une
        # fiche du catalogue qui y tombe est une affectation oubliée.
        family = next(f for f in FAMILIES if f["key"] == r["family"])
        assert not family.get("catch_all"), r["family"]

    def test_toute_famille_utilisee_est_declaree(self):
        # L'inverse — une famille déclarée sans recette — est permis : « Pains »
        # attend son premier pain, et l'API n'affiche pas les familles vides,
        # donc aucune vignette n'ouvre sur rien.
        used = {r["family"] for r in RECIPES_SEED}
        declared = {f["key"] for f in FAMILIES}
        assert used <= declared, used - declared

    def test_chaque_famille_a_sa_vignette(self):
        # Le seul défaut que ni pytest ni tsc ne verraient chacun de son côté :
        # une clé déclarée ici sans image en face.
        tiles = (Path(__file__).resolve().parents[2]
                 / "frontend" / "src" / "families.ts").read_text(encoding="utf-8")
        for f in FAMILIES:
            assert f"'{f['key']}':" in tiles, f["key"]


class TestTips:
    @pytest.mark.parametrize("t", TIPS_SEED, ids=[t["title"] for t in TIPS_SEED])
    def test_astuce_complete(self, t):
        assert t["title"].strip()
        assert len(t["content"].strip()) > 40
        assert t["category"] in TIP_CATEGORIES
        assert t["icon"].strip()

    def test_pas_de_doublon(self):
        titles = [t["title"] for t in TIPS_SEED]
        assert len(titles) == len(set(titles))
