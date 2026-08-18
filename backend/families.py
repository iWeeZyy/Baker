"""Les familles de recettes : le niveau qui manquait entre la catégorie et la fiche.

Trois catégories pour 117 recettes ne se parcourent pas — 80 fiches tombaient
sous « Pâtisseries ». La famille est le rang intermédiaire qu'un boulanger
emploie déjà : on ne cherche pas « une pâtisserie », on cherche « un biscuit ».

Module pur, sans base ni réseau, comme `plans.py` et `staff.py`.

L'affectation vit ici et nulle part ailleurs. La disperser dans `seed_data.py`
et dans `seed_books.py` — qui est généré — reviendrait à ne plus pouvoir la
relire d'un coup d'œil, et c'est exactement le genre de table qui se relit.
"""
from typing import Optional

# Ordre d'affichage. Une famille appartient à une seule catégorie : une famille
# à cheval rendrait le filtre par catégorie incohérent, c'est pourquoi les pâtes
# de base sont séparées en pâtes tourées (viennoiseries) et pâtes à tarte
# (pâtisseries) plutôt que réunies.
FAMILIES = [
    {"key": "pains-classiques", "label": "Pains classiques", "category": "Pains"},
    {"key": "pains-speciaux", "label": "Pains spéciaux", "category": "Pains"},
    {"key": "levains", "label": "Levains et préfermentations", "category": "Pains"},
    {"key": "feuilletees", "label": "Viennoiseries feuilletées", "category": "Viennoiseries"},
    {"key": "brioches", "label": "Brioches et babkas", "category": "Viennoiseries"},
    {"key": "pates-tourees", "label": "Pâtes tourées et levées", "category": "Viennoiseries"},
    {"key": "tartes", "label": "Tartes", "category": "Pâtisseries"},
    {"key": "pates-a-tarte", "label": "Pâtes à tarte", "category": "Pâtisseries"},
    {"key": "gateaux", "label": "Gâteaux", "category": "Pâtisseries"},
    {"key": "cakes", "label": "Cakes et gâteaux de voyage", "category": "Pâtisseries"},
    {"key": "biscuits", "label": "Biscuits et sablés", "category": "Pâtisseries"},
    {"key": "carres", "label": "Carrés et brownies", "category": "Pâtisseries"},
    {"key": "petites-patisseries", "label": "Petites pâtisseries", "category": "Pâtisseries"},
    {"key": "muffins-scones", "label": "Muffins et scones", "category": "Pâtisseries"},
    {"key": "garnitures", "label": "Garnitures, crèmes et sauces", "category": "Pâtisseries"},
    # Fourre-tout, un par catégorie. Ils n'existent que pour les recettes de la
    # communauté : une fiche partagée avant cette version n'a pas de famille, et
    # une recette qu'aucune vignette n'ouvre est une recette perdue. Ils ne sont
    # renvoyés par l'API que lorsqu'ils contiennent quelque chose.
    {"key": "autres-pains", "label": "Autres pains", "category": "Pains", "catch_all": True},
    {"key": "autres-viennoiseries", "label": "Autres viennoiseries", "category": "Viennoiseries", "catch_all": True},
    {"key": "autres-patisseries", "label": "Autres pâtisseries", "category": "Pâtisseries", "catch_all": True},
]

FAMILY_KEYS = {f["key"] for f in FAMILIES}
LABELS = {f["key"]: f["label"] for f in FAMILIES}

CATCH_ALL = {
    "Pains": "autres-pains",
    "Viennoiseries": "autres-viennoiseries",
    "Pâtisseries": "autres-patisseries",
}

_ASSIGNMENTS = {
    "pains-classiques": [
        "Baguette aux graines",
        "Baguette de tradition sur poolish",
        "Baguette rustique au levain T80",
        "Baguette viennoise",
        "Pain blanc sur levain liquide",
        "Pain de campagne",
        "Pain de mie",
        "Pain de seigle",
    ],
    "pains-speciaux": [
        "Benoîton aux noisettes",
        "Bretzel",
        "Ciabatta",
        "Crumpet",
        "Fougasse",
        "Gressins",
        "Injera (sans gluten)",
        "Naans",
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
        "Pain de mie au tangzhong",
        "Pain de mie bicolore",
        "Pain de méteil feuilleté",
        "Pain noir",
        "Pain nutrition au levain",
        "Pain nutrition aux graines",
        "Pain à la bière",
        "Pain à la châtaigne (sans gluten)",
        "Pavé aux fruits",
        "Petits pains feuilletés",
        "Tourte de meule",
        "Étoile de pain d'épice",
    ],
    "levains": [
        "Levain chef",
        "Levain dur",
        "Levain liquide",
        "Poolish",
    ],
    "feuilletees": [
        "Brioche feuilletée",
        "Chaussons aux pommes",
        "Croissant aux amandes",
        "Croissant bicolore au chocolat",
        "Croissants",
        "Cruffin",
        "Danoise fraises-fromage",
        "Danoise torsadée aux fruits",
        "Galette des rois",
        "Kouign amann",
        "New York rolls",
        "Nœud choco-noisettes",
        "Pains au chocolat",
        "Pains aux raisins",
        "Palmiers",
        "Roulé pistache et chocolat",
        "Strudel aux pommes",
        "Torsade feuilletée",
        "Trottoir aux framboises",
        "Écrin feuilleté aux noisettes",
    ],
    "brioches": [
        "Babka",
        "Beignet",
        "Brioche au chocolat",
        "Brioche canneberges et crumble",
        "Brioche des rois",
        "Brioche fleur aux fraises",
        "Brioche individuelle",
        "Brioche tressée",
        "Brioche vegan",
        "Brioche vendéenne",
        "Brioche à la cardamome",
        "Briochettes aux pralines roses",
        "Bugnes",
        "Cinnamon roll",
        "Couronne",
        "Donuts",
        "Grosse brioche à tête",
        "Gâche",
        "Kouglof",
        "Navettes",
        "Panettone",
        "Petite brioche à tête",
        "Pompe à huile",
        "Serpentin aux fruits",
        "Tarte au sucre",
        "Tarte-brioche aux fruits",
        "Viennoise aux pépites de chocolat",
    ],
    "pates-tourees": [
        "Pâte feuilletée classique",
        "Pâte feuilletée inversée",
        "Pâte feuilletée rapide",
        "Pâte levée feuilletée",
        "Pâte à brioche",
        "Pâte à brioche à tête",
    ],
    "tartes": [
        "Tarte Tatin",
        "Tarte amandine",
        "Tarte au citron meringuée",
        "Tarte au sirop d'érable",
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
        "Tartelette-biscuit aux fruits",
    ],
    "pates-a-tarte": [
        "Pâte brisée",
        "Pâte sucrée",
    ],
    "gateaux": [
        "Bread pudding",
        "Flan aux raisins",
        "Gâteau aux carottes",
        "Gâteau aux courgettes",
        "Gâteau aux dattes et sa sauce au sucre à la crème",
        "Gâteau aux fruits de Noël",
        "Gâteau pacanes-cannelle",
        "Gâteau Reine-Élisabeth",
        "Gâteau éponge à l'italienne",
        "Gâteau étagé choco-ganache",
        "Moelleux au chocolat",
        "Pain perdu, sauce Suzette",
        "Torta aux pistaches",
    ],
    "cakes": [
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
    "biscuits": [
        "Biscuit avoine, dattes et pacanes",
        "Biscuit choco-pacanes",
        "Biscuit craquelé fondant",
        "Biscuit spéculoos",
        "Diamant sablé",
        "Galette bretonne au beurre",
        "Galette à la mélasse",
    ],
    "carres": [
        "Brownie",
        "Carré au citron",
        "Carré au fromage sur brownie",
        "Carré aux dattes",
        "Carré aux noix",
        "Carré choco-caramel",
        "Carré croustillant aux fraises",
    ],
    "petites-patisseries": [
        "Financier aux amandes",
        "Macaron rustique choco-noisettes",
        "Macaron à la noix de coco",
        "Madeleine à la vanille",
        "Meringue",
    ],
    "muffins-scones": [
        "Muffin",
        "Scone",
    ],
    "garnitures": [
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
}

FAMILY_BY_TITLE = {
    title: key for key, titles in _ASSIGNMENTS.items() for title in titles
}


def family_of(title: str, category: str) -> Optional[str]:
    """La famille d'une recette, jamais None pour une catégorie connue.

    Une fiche du catalogue est dans la table. Une recette de la communauté n'y
    est pas : elle tombe dans le fourre-tout de sa catégorie plutôt que nulle
    part, faute de quoi aucune vignette ne l'ouvrirait.
    """
    key = FAMILY_BY_TITLE.get(title)
    if key:
        return key
    return CATCH_ALL.get(category)
