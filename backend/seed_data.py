"""Seed data for the Bakers app: recipes and tips shipped with the application.

Every recipe comes from `seed_books.py` — sheets taken from professional works,
each carrying the page it was read from. The twenty demonstration recipes the
app was scaffolded with are gone: they were written by a language model, not by
a baker, and a baking app that cannot say where a quantity comes from is worth
less than one with fewer recipes.

`BAKER_TIPS` below are the eight original tips, marked as the app's own
content rather than a book's. `TIPS_SEED` merges them with the tips already
extracted from both books during the recipe import, reclassified and
structured for the Astuces library by `tips_seed.build_tips_library`.

Removing a recipe from this file removes it from the database on the next boot
(see the startup handler in `server.py`) — the seed is authoritative, so
retiring content is a deploy and not a manual cleanup.
"""
from families import FAMILY_BY_TITLE, family_of
from products import product_of
from recipe_photos import credit_of, photo_of
from seed_books import BOOK_RECIPES
from tips_seed import build_tips_library

BAKER_TIPS = [
    {
        "title": "L'hydratation, clé de la mie alvéolée",
        "category": "Hydratation",
        "content": "Plus la pâte est hydratée (70-80%), plus la mie sera alvéolée et légère. Attention, les farines faibles ne supportent pas des taux élevés. Commencez à 65% puis augmentez progressivement.",
        "icon": "droplet"
    },
    {
        "title": "Le rabat, essentiel du levain",
        "category": "Façonnage",
        "content": "Faites 2 à 3 rabats espacés de 45 minutes pendant le pointage. Ils renforcent le réseau glutineux sans surchauffer la pâte comme un pétrissage prolongé.",
        "icon": "layers"
    },
    {
        "title": "La buée, secret de la croûte",
        "category": "Cuisson",
        "content": "Injectez de la vapeur dans le four pendant les 10 premières minutes de cuisson. La croûte reste souple, permettant à la pâte de se développer, puis caramélise magnifiquement.",
        "icon": "cloud"
    },
    {
        "title": "Ma pâte ne lève pas, que faire ?",
        "category": "Dépannage",
        "content": "Vérifiez : levure trop vieille, eau trop chaude (>40°C tue les levures), sel en contact direct avec la levure, ou température ambiante trop basse (<20°C).",
        "icon": "alert-circle"
    },
    {
        "title": "Température de base",
        "category": "Fermentation",
        "content": "Pour une pâte à 24°C, appliquez : Température base (60°C) - Temp. farine - Temp. ambiante = Temp. eau. Ajustez pour maîtriser votre fermentation.",
        "icon": "thermometer"
    },
    {
        "title": "L'apprêt à froid",
        "category": "Fermentation",
        "content": "Un apprêt de 12 à 24h au frigo (4°C) développe des arômes complexes et facilite l'organisation. Le résultat : une croûte plus foncée et un pain plus savoureux.",
        "icon": "moon"
    },
    {
        "title": "Le grignage, geste précis",
        "category": "Façonnage",
        "content": "Utilisez une lame propre, inclinée à 45°. Grignez rapidement d'un seul geste. Le grignage n'est pas décoratif : il guide le développement du pain au four.",
        "icon": "edit-3"
    },
    {
        "title": "Beurre de tourage pour viennoiseries",
        "category": "Cuisson",
        "content": "Utilisez un beurre AOP à 84% minimum de matière grasse (beurre de tourage). Il reste plastique au froid et ne casse pas pendant l'étalage.",
        "icon": "star"
    }
]


# La famille est apposée ici plutôt que recopiée dans chaque fiche : elle vient
# d'une table unique (`families.py`), et une recette du catalogue qui n'y
# figurerait pas retomberait dans un fourre-tout sans qu'on s'en aperçoive. On
# préfère refuser de démarrer.
_UNASSIGNED = sorted({r["title"] for r in BOOK_RECIPES} - set(FAMILY_BY_TITLE))
if _UNASSIGNED:
    raise RuntimeError(
        "recettes sans famille dans families.py : " + ", ".join(_UNASSIGNED)
    )

# L'archétype visuel est apposé de la même manière, mais sans contrôle
# d'exhaustivité : contrairement à la famille, il a le droit d'être absent
# (`products.py` explique pourquoi). Une fiche sans archétype garde l'absence
# d'image, que l'écran gère déjà.
def _with_photo(recipe: dict) -> dict:
    """Appose la photo et son crédit, ou laisse la fiche sans image.

    `image_url` reste la chaîne vide quand aucune photo ne montre le bon
    produit : la fiche affiche alors son dessin d'archétype. On n'invente pas
    d'URL, et on ne recopie pas une photo approchante.
    """
    photo = photo_of(recipe["title"])
    if not photo:
        return {"image_url": "", "image_credit": None}
    return {"image_url": photo["url"], "image_credit": credit_of(recipe["title"])}


RECIPES_SEED = [
    {
        **r,
        "family": family_of(r["title"], r["category"]),
        "product": product_of(r["title"]),
        **_with_photo(r),
    }
    for r in BOOK_RECIPES
]

TIPS_SEED = build_tips_library(BAKER_TIPS)


# Demo baker accounts. They accept friend requests instantly and reply to
# messages on their own, so the social features can be exercised with a single
# real account. Nobody can log in as them (see _seed_demo_bots in server.py).
DEMO_BOTS = [
    {
        "user_id": "user_bot_camille",
        "email": "camille.levain@bakers.demo",
        "name": "Camille Levain",
        "persona": (
            "Tu es Camille Levain, boulangère passionnée de levain naturel et de pains "
            "de campagne. Tu es chaleureuse, tutoies ton interlocuteur, et tu parles "
            "volontiers de fermentation longue et d'hydratation."
        ),
    },
    {
        "user_id": "user_bot_hugo",
        "email": "hugo.tourage@bakers.demo",
        "name": "Hugo Tourage",
        "persona": (
            "Tu es Hugo Tourage, artisan viennoisier. Tu adores le feuilletage, le beurre "
            "AOP et les croissants bien alvéolés. Tu es direct, un peu taquin, et tu donnes "
            "toujours une astuce concrète."
        ),
    },
    {
        "user_id": "user_bot_sofia",
        "email": "sofia.praline@bakers.demo",
        "name": "Sofia Praline",
        "persona": (
            "Tu es Sofia Praline, pâtissière. Tu parles entremets, ganaches et cuissons "
            "précises. Tu es douce, encourageante, et tu poses souvent une question en retour."
        ),
    },
]
