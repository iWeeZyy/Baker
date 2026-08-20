"""L'archétype visuel d'une recette : la forme, pas le produit.

La fiche recette n'a pas de photo. Les photographies de l'ouvrage ne sont pas
reprises — les données d'une recette se citent, une photographie se reproduit —
et Wikimedia Commons est une archive documentaire dont la qualité culinaire
n'est pas au niveau du reste de l'application.

Reste le dessin, qui est déjà la réponse du projet : les vignettes de famille
sont dessinées et non photographiées. Une illustration se lit comme un
**emblème**, pas comme une photo de cette pièce précise — c'est exactement ce
qui rend la répétition acceptable là où une photo mentirait. Dix-neuf tartes
partageant le même dessin de tarte disent « une tarte » ; dix-neuf fois la même
photo diraient « voici cette tarte-là », ce qui serait faux.

Deux règles :

  - **Aucun archétype approximatif.** Une recette dont la forme n'a pas de
    dessin juste n'en reçoit aucun et garde l'absence d'image actuelle, que
    l'écran gère déjà proprement. Un pain de mie illustré par une boule serait
    pire que rien. C'est pourquoi cette table ne couvre pas tout le catalogue,
    et c'est délibéré.

  - **La table est la seule source.** Comme `families.py`, elle vit ici et
    nulle part ailleurs, et `tests/test_products.py` refuse un titre qui n'est
    pas au catalogue — un titre mal orthographié n'ajouterait rien, en silence.
"""
from typing import Optional

# Les archétypes. `frontend/src/products.ts` associe chaque clé à une image :
# seize réutilisent une vignette de famille déjà dessinée — l'épi, la baguette,
# le croissant, la brioche à tête existaient déjà et sont justes — et six ont
# été dessinées pour les produits (`frontend/assets/images/products/`).
#
# La liste est courte parce qu'elle ne contient que les formes qui se lisent.
# Les dessins qui ne se lisaient pas — un escargot dont la spirale débordait,
# une tresse qui ressemblait à une chaîne de billes — ont été jetés plutôt que
# livrés, et les recettes concernées gardent l'absence d'image.
PRODUCTS = [
    {"key": "baguette", "label": "Baguette"},
    {"key": "boule", "label": "Pain rond"},
    {"key": "bretzel", "label": "Bretzel"},
    {"key": "couronne", "label": "Couronne"},
    {"key": "pain-plat", "label": "Pain plat"},
    {"key": "pain-moule", "label": "Pain de mie"},
    {"key": "croissant", "label": "Croissant"},
    {"key": "chausson", "label": "Chausson"},
    {"key": "beignet", "label": "Beignet"},
    {"key": "brioche-tete", "label": "Brioche à tête"},
    {"key": "tarte", "label": "Tarte"},
    {"key": "cake", "label": "Cake"},
    {"key": "gateau", "label": "Gâteau"},
    {"key": "carre", "label": "Carré"},
    {"key": "biscuit", "label": "Biscuit"},
    {"key": "petit-four", "label": "Petite pâtisserie"},
    {"key": "muffin", "label": "Muffin"},
    {"key": "levain", "label": "Levain"},
    {"key": "creme", "label": "Crème et garniture"},
    {"key": "pate-a-tarte", "label": "Pâte à tarte"},
    {"key": "pate-feuilletee", "label": "Pâte tourée"},
    {"key": "sandwich", "label": "Sandwich"},
]

PRODUCT_KEYS = {p["key"] for p in PRODUCTS}

_ASSIGNMENTS = {
    "baguette": [
        "Baguette aux graines",
        "Baguette de tradition sur poolish",
        "Baguette rustique au levain T80",
        "Baguette viennoise",
        "Gressins",
    ],
    "boule": [
        "Benoîton aux noisettes",
        "Pain au cacao",
        "Pain au curcuma",
        "Pain au grand épeautre",
        "Pain au levain de riz et sarrasin (sans gluten)",
        "Pain au petit épeautre",
        "Pain au sarrasin",
        "Pain aux figues",
        "Pain aux lardons",
        "Pain aux noix",
        "Pain aux olives",
        "Pain blanc sur levain liquide",
        "Pain de campagne",
        "Pain de seigle",
        "Pain noir",
        "Pain nutrition au levain",
        "Pain nutrition aux graines",
        "Pain surprise",
        "Pain à la bière",
        "Pain à la châtaigne (sans gluten)",
        "Pavé aux fruits",
        "Petits pains feuilletés",
        "Tourte de meule",
    ],
    "bretzel": ["Bretzel"],
    "couronne": ["Couronne"],
    "pain-plat": ["Focaccia"],
    "pain-moule": [
        "Pain de mie",
        "Pain de mie au tangzhong",
        "Pain de mie bicolore",
    ],
    "croissant": [
        "Croissant au jambon",
        "Croissant aux amandes",
        "Croissant bicolore au chocolat",
        "Croissants",
    ],
    "chausson": ["Chaussons aux pommes", "Strudel aux pommes"],
    "beignet": ["Beignet", "Donuts"],
    "brioche-tete": [
        "Brioche individuelle",
        "Grosse brioche à tête",
        "Petite brioche à tête",
        "Pâte à brioche",
        "Pâte à brioche à tête",
    ],
    "tarte": [
        "Tarte Tatin",
        "Tarte amandine",
        "Tarte au citron meringuée",
        "Tarte au sirop d'érable",
        "Tarte au sucre",
        "Tarte aux abricots",
        "Tarte aux pacanes",
        "Tarte aux pommes",
        "Tarte aux pommes et sa compote",
        "Tarte caramel et noix",
        "Tarte chocolat et figues",
        "Tarte façon gâteau au fromage",
        "Tarte fine à la poire",
        "Tarte poires-bleuets et son crumble",
        "Tarte pommes, figues et noisettes",
        "Tarte rhubarbe et fraises",
        "Tarte à la farlouche",
        "Tarte-brioche aux fruits",
        "Tartelette-biscuit aux fruits",
    ],
    "cake": [
        "Cake au chocolat",
        "Cake aux amandes choco-vanille",
        "Cake façon cupcake",
        "Cake marbré",
        "Cake orange et huile d'olive",
        "Cake renversé aux pacanes",
        "Cake à la vanille",
        "Pain aux bananes",
        "Quatre-quarts",
        "Weekend à l'orange",
    ],
    "gateau": [
        "Bread pudding",
        "Flan aux raisins",
        "Gâteau Reine-Élisabeth",
        "Gâteau aux carottes",
        "Gâteau aux courgettes",
        "Gâteau aux dattes et sa sauce au sucre à la crème",
        "Gâteau aux fruits de Noël",
        "Gâteau pacanes-cannelle",
        "Gâteau éponge à l'italienne",
        "Gâteau étagé choco-ganache",
        "Moelleux au chocolat",
        "Torta aux pistaches",
    ],
    "carre": [
        "Brownie",
        "Carré au citron",
        "Carré au fromage sur brownie",
        "Carré aux dattes",
        "Carré aux noix",
        "Carré choco-caramel",
        "Carré croustillant aux fraises",
    ],
    "biscuit": [
        "Biscuit avoine, dattes et pacanes",
        "Biscuit choco-pacanes",
        "Biscuit craquelé fondant",
        "Biscuit spéculoos",
        "Diamant sablé",
        "Galette bretonne au beurre",
        "Galette à la mélasse",
    ],
    "petit-four": [
        "Financier aux amandes",
        "Macaron rustique choco-noisettes",
        "Macaron à la noix de coco",
        "Madeleine à la vanille",
        "Meringue",
    ],
    "muffin": ["Muffin", "Scone"],
    "levain": ["Levain chef", "Levain dur", "Levain liquide", "Poolish"],
    "creme": [
        "Béchamel",
        "Caramel au beurre salé",
        "Compote de mangue",
        "Compote de pommes",
        "Compote de pêches",
        "Compotée de canneberges",
        "Compotée de rhubarbe",
        "Coulis de fraises ou de framboises",
        "Crème anglaise",
        "Crème chantilly",
        "Crème d'amande",
        "Crème pâtissière",
        "Ganache au chocolat",
        "Garniture au fromage",
        "Garniture aux fruits",
        "Garniture choco-noisettes",
        "Praliné par sablage",
        "Pâte à tartiner au chocolat",
        "Sauce au chocolat",
        "Sauce au sucre à la crème",
    ],
    "pate-a-tarte": ["Pâte brisée", "Pâte sucrée"],
    "pate-feuilletee": [
        "Pâte feuilletée classique",
        "Pâte feuilletée inversée",
        "Pâte feuilletée rapide",
        "Pâte levée feuilletée",
    ],
    "sandwich": [
        "Bagel au pastrami",
        "Black burger végétarien",
        "Croque-monsieur revisité",
        "Gua bao au poulet",
        "Hot-dog",
        "Pain polaire au saumon",
        "Pan bagnat",
        "Panini tomate, mozzarella et pesto",
        "Parisien revisité",
        "Pita aux falafels",
        "Wrap au fromage et légumes",
    ],
}

PRODUCT_BY_TITLE = {
    title: key for key, titles in _ASSIGNMENTS.items() for title in titles
}


def product_of(title: str) -> Optional[str]:
    """L'archétype d'une recette, ou None quand aucun dessin ne lui convient.

    None n'est pas un oubli : c'est le cas d'une forme qu'aucun dessin de la
    bibliothèque ne rend honnêtement — un kouglof, une tresse, un palmier. La
    fiche garde alors l'absence d'image, plutôt qu'un emblème qui montrerait
    autre chose.
    """
    return PRODUCT_BY_TITLE.get(title)
