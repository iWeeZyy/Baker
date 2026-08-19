"""La bibliothèque « Astuces » : migration et enrichissement des astuces existantes.

Aucune astuce n'est réécrite au fond ici — ce module reclasse, structure et
indexe ce qui existe déjà, sans jamais inventer de contenu :

  - `BAKER_TIPS` (`seed_data.py`) : les huit astuces d'origine de l'application,
    sans source déclarée.
  - `BOOK_TIPS` (`seed_books.py`) : cinquante-neuf astuces déjà extraites des
    deux ouvrages lors de l'import des recettes — dix-huit de Josée Fiset,
    quarante et une de FERRANDI Paris (vérifié par `git log`, le titre exact
    de chaque astuce important dans le premier commit appartenant à Fiset).

Trois transformations, chacune fondée sur le texte déjà présent :
  1. Reclassement dans la taxonomie de la bibliothèque (douze catégories) —
     « Tourage » devient « Viennoiserie », « Dépannage » devient
     « Problèmes & solutions », « Matériel » rejoint « Général ».
  2. Structuration problème/causes/solutions pour les astuces de dépannage :
     leur contenu énumère déjà des causes et des vérifications, on ne fait que
     lui donner la forme attendue par la fiche détaillée.
  3. Mots-clés calculés, jamais choisis à la main : un terme du vocabulaire
     boulanger n'est retenu que s'il apparaît réellement dans le titre ou le
     texte de l'astuce (`_KEYWORD_VOCAB`), pour ne jamais indexer un mot sans
     rapport avec le contenu.
"""
import re
import unicodedata

from seed_books import BOOK_TIPS

# La taxonomie de la bibliothèque : chaque astuce migrée tombe dans une de ces
# catégories (voir `_CATEGORY_MAP`/`_CATEGORY_OVERRIDE` plus bas). Vit ici et
# nulle part ailleurs — `server.py` et les tests de qualité l'importent tous
# deux d'ici, pour ne jamais pouvoir diverger.
TIP_CATEGORIES = [
    "Pétrissage", "Farines", "Hydratation", "Température", "Fermentation",
    "Façonnage", "Cuisson", "Viennoiserie", "Conservation",
    "Problèmes & solutions", "Général",
]

# ---------- Provenance ----------
# Les dix-huit titres importés dans le tout premier commit de seed_books.py
# (« Importer 102 fiches et 18 astuces d'un ouvrage professionnel », dont le
# corps explique qu'il s'agit de « Comme à la boulangerie » de Josée Fiset).
# Tout le reste de BOOK_TIPS vient des commits suivants, qui importent
# FERRANDI Paris.
_FISET_TITLES = {
    "Peser, ne pas mesurer",
    "150 ml d'eau pèsent 150 g",
    "Un enduit pour moules qui ne laisse pas de trace",
    "Chemiser en laissant dépasser le papier",
    "Tempérer le chocolat, méthode rapide",
    "La chaîne du froid décide du feuilletage",
    "Les températures du tourage",
    "Deux minutes de rouleau, pas plus",
    "Une pâte qui résiste veut du repos",
    "Souder la clé sous la boule",
    "Une pâte ne doit jamais sécher",
    "L'eau à 37 °C sort du robinet",
    "Une levure ouverte depuis plus d'un an ne lève plus",
    "Les biscuits cuisent encore hors du four",
    "Un sablé se cuit à cœur",
    "La bosse de la madeleine tient au four statique",
    "Séparer les œufs avec trois bols",
    "Une pâte brisée friable se joue au froid",
}
SOURCE_FISET = "Josée Fiset, « Comme à la boulangerie », Pratico Édition"
SOURCE_FERRANDI = "FERRANDI Paris, « Boulangerie Viennoiserie », Flammarion"
SOURCE_APP = "Contenu original de l'application"

# ---------- Reclassement ----------
# Ancienne catégorie -> nouvelle, pour toute astuce sans règle plus précise
# ci-dessous. Ce que la nouvelle bibliothèque ne distingue pas de "Général"
# (par ex. le matériel) y tombe plutôt que de garder une catégorie absente de
# la taxonomie demandée.
_CATEGORY_MAP = {
    "Tourage": "Viennoiserie",
    "Matériel": "Général",
    "Dépannage": "Problèmes & solutions",
    # inchangées, listées pour que la table soit complète et se relise d'un
    # coup d'œil :
    "Hydratation": "Hydratation",
    "Façonnage": "Façonnage",
    "Cuisson": "Cuisson",
    "Fermentation": "Fermentation",
}

# Titre -> nouvelle catégorie, pour les astuces dont le sujet réel déborde de
# la catégorie où elles avaient été rangées au moment de l'import.
_CATEGORY_OVERRIDE = {
    "Beurre de tourage pour viennoiseries": "Viennoiserie",  # était "Cuisson"
    "Température de base": "Température",  # était "Fermentation"
}

# ---------- Problème / causes / solutions ----------
# Une seule règle : ne rien écrire ici qui ne soit pas déjà dans le `content`
# original — cette table met en forme, elle n'ajoute pas de fait. Le contenu
# original reste par ailleurs intact dans le champ `content` de l'astuce.
_PROBLEM_SOLUTIONS = {
    "Ma pâte ne lève pas, que faire ?": {
        "problem": "La pâte ne gonfle pas pendant la fermentation.",
        "causes": [
            "Levure trop vieille ou inactive",
            "Eau trop chaude (au-delà de 40 °C, elle tue la levure)",
            "Sel en contact direct avec la levure",
            "Température ambiante trop basse (moins de 20 °C)",
        ],
        "solutions": [
            "Vérifier la date et l'activité de la levure avant de l'utiliser",
            "Contrôler la température de l'eau au thermomètre",
            "Ne jamais mettre le sel en contact direct avec la levure",
            "Faire pousser la pâte dans un endroit plus chaud (20 °C ou plus)",
        ],
    },
    "Séparer les œufs avec trois bols": {
        "problem": "Une trace de jaune tombée dans les blancs les empêche de monter.",
        "causes": [],
        "solutions": [
            "Utiliser un bol pour les jaunes, un deuxième au-dessus duquel casser chaque œuf, "
            "un troisième pour les blancs déjà séparés",
            "Une trace de jaune ne gâche ainsi qu'un seul blanc au lieu de tous les blancs déjà séparés",
        ],
    },
    "Un pain noir se tranche le lendemain": {
        "problem": "Un pain de seigle frais a la mie collante et se tranche mal.",
        "causes": ["C'est une caractéristique du seigle, pas un défaut de cuisson"],
        "solutions": ["Attendre le lendemain : la texture collante disparaît en vieillissant"],
    },
    "Un levain trop acide se corrige au sucre": {
        "problem": "Le levain destiné aux crumpets est trop acide (il doit rester doux, presque comme un yaourt).",
        "causes": ["Un levain fatigué qui ne pousse plus assez"],
        "solutions": [
            "Augmenter la dose de levure pour compenser la pousse",
            "Augmenter la dose de sucre pour corriger l'acidité",
            "Éviter de jeter le levain : le corriger plutôt que le remplacer",
        ],
    },
    "Un pan bagnat se garnit sur un pain rassis": {
        "problem": "La garniture détrempe le pain au lieu de le nourrir.",
        "causes": ["Le pain est encore frais au moment du montage"],
        "solutions": [
            "Laisser le pain rassir une journée entière avant de le garnir",
            "Ce sont l'huile, les tomates et le thon qui doivent réhydrater un pain sec",
        ],
    },
    "Moins de farine dans une crème pâtissière au chocolat": {
        "problem": "La crème pâtissière au chocolat devient trop compacte.",
        "causes": ["Le cacao épaissit autant que l'amidon : la recette classique contient alors trop d'épaississant"],
        "solutions": [
            "Réduire la farine de 10 à 20 % par rapport à une crème pâtissière nature",
            "Compter 40 à 50 g de cacao pure pâte ajoutés à la crème chaude",
        ],
    },
    "Le pain surprise se cuit la veille": {
        "problem": "Un pain surprise fait le jour même se déchire à l'évidage et sa mie s'écrase à la découpe.",
        "causes": ["La mie d'un pain trop frais n'est pas assez ferme pour être tranchée finement"],
        "solutions": [
            "Faire le pain la veille",
            "Passer la mie une trentaine de minutes au congélateur avant de la trancher à 0,5 cm",
            "Elle se coupe alors net, sans s'effriter",
        ],
    },
}

# ---------- Mots-clés ----------
# Vocabulaire boulanger réellement employé dans les astuces. Un mot n'entre
# dans les mots-clés d'une astuce que s'il apparaît dans son propre texte —
# la liste ne fait qu'énumérer les termes qu'on autorise à devenir un
# mot-clé, elle ne décide jamais qu'une astuce en porte un qu'elle ne
# contient pas.
_KEYWORD_VOCAB = [
    "farine", "eau", "levure", "levain", "sel", "beurre", "sucre", "œuf", "œufs",
    "jaune", "blanc d'œuf", "lait", "chocolat", "vanille", "crème", "praliné",
    "caramel", "cacao", "amidon", "psyllium", "tangzhong", "graines", "noisette",
    "pâte", "pétrissage", "pétrir", "façonnage", "boulage", "rabat", "fermentation",
    "pointage", "apprêt", "repos", "détente", "levée", "pousse", "cuisson", "four",
    "température", "hydratation", "tourage", "feuilletage", "détrempe", "tour",
    "buée", "vapeur", "grigne", "grignage", "croûte", "mie", "poolish", "autolyse",
    "viennoiserie", "croissant", "brioche", "danoise", "panettone", "pain", "seigle",
    "épeautre", "gluten", "sans gluten", "congélation", "réfrigération", "conservation",
    "moule", "papier cuisson", "balance", "thermomètre", "bicarbonate", "vinaigre",
    "madeleine", "biscuit", "sablé", "meringue", "gressin", "bagel", "bretzel", "pita",
    "chocolat noir", "chocolat au lait", "chocolat blanc", "acide", "acidité",
]


def _normalize(text: str) -> str:
    n = unicodedata.normalize("NFD", (text or "").lower())
    return "".join(c for c in n if unicodedata.category(c) != "Mn")


def _keywords_for(*texts: str) -> list:
    haystack = _normalize(" ".join(t for t in texts if t))
    return [w for w in _KEYWORD_VOCAB if _normalize(w) in haystack]


def _source_for(title: str, from_book: bool) -> str:
    if not from_book:
        return SOURCE_APP
    return SOURCE_FISET if title in _FISET_TITLES else SOURCE_FERRANDI


def _migrate(tip: dict, from_book: bool) -> dict:
    title = tip["title"]
    category = _CATEGORY_OVERRIDE.get(title) or _CATEGORY_MAP.get(tip["category"], tip["category"])
    out = {
        "title": title,
        "category": category,
        "content": tip["content"],
        "icon": tip.get("icon", "star"),
        # A tip freshly authored with its own page citation (see
        # NEW_FERRANDI_TIPS) keeps it; everything else gets the source
        # inferred from which commit first imported it.
        "source": tip.get("source") or _source_for(title, from_book),
    }
    ps = _PROBLEM_SOLUTIONS.get(title)
    if ps:
        out["problem"] = ps["problem"]
        out["causes"] = ps["causes"]
        out["solutions"] = ps["solutions"]
    out["keywords"] = _keywords_for(
        title, tip["content"], ps["problem"] if ps else "",
        " ".join((ps or {}).get("causes", [])), " ".join((ps or {}).get("solutions", [])),
    )
    return out


def build_tips_library(baker_tips: list) -> list:
    """Toutes les astuces migrées, dans un ordre stable (livres puis app puis
    les astuces lues directement dans le chapitre théorique de FERRANDI)."""
    seen = {t["title"] for t in BOOK_TIPS}
    migrated_book = [_migrate(t, from_book=True) for t in BOOK_TIPS]
    migrated_app = [_migrate(t, from_book=False) for t in baker_tips if t["title"] not in seen]
    migrated_new = [_migrate(t, from_book=True) for t in NEW_FERRANDI_TIPS]
    return migrated_book + migrated_app + migrated_new


# ---------- Astuces supplémentaires, lues directement dans FERRANDI Paris ----------
# Le chapitre théorique du livre (« Les fondamentaux de la boulangerie et de la
# viennoiserie », p. 15 à 21) n'avait pas été exploité lors de l'import des
# recettes — seuls les encarts « Trucs et astuces de chefs », déjà repris dans
# BOOK_TIPS, l'avaient été. Ce chapitre est de la prose théorique (matières
# premières, étapes de fabrication), pas des fiches produit : rien n'y
# recoupe une astuce déjà migrée. Chaque astuce ci-dessous a été lue
# directement sur la page citée, jamais devinée depuis l'OCR d'un scan.
NEW_FERRANDI_TIPS = [
    {
        "title": "Le T d'une farine mesure sa pureté, pas sa force",
        "category": "Farines",
        "content": (
            "Le « T » d'une farine (T45 à T150) indique sa teneur en minéraux pour 100 g, "
            "donc la part de son qu'elle contient : de 0,45 % pour une T45 (la plus blanche) "
            "à 1,5 % pour une T150 (complète). En France : T45 pour les viennoiseries, la "
            "pâtisserie et les pizzas ; T55 pour la panification courante et le feuilletage ; "
            "T65 pour la panification courante ; T80 (farine bise) pour le pain de campagne, "
            "le pain bis et la tourte de meule ; T110 (semi-complète) pour la tourte ; T150 "
            "(complète) pour le pain complet."
        ),
        "icon": "grid",
        "source": SOURCE_FERRANDI + ", p. 16",
    },
    {
        "title": "Toutes les farines ne se panifient pas seules",
        "category": "Farines",
        "content": (
            "La farine de sarrasin (« blé noir ») n'est pas du blé et ne contient pas de "
            "gluten : elle n'est pas panifiable seule, d'où son usage en mélange dans les "
            "galettes bretonnes. La farine de seigle, pauvre en gluten, lève difficilement "
            "seule aussi — on la mélange à parts égales avec de la farine de blé, un mélange "
            "appelé « farine de méteil ». Le petit épeautre et l'épeautre, pauvres en gluten "
            "mais panifiables, donnent un pain plus dense. Sarrasin, riz, maïs et châtaigne "
            "sont sans gluten."
        ),
        "icon": "grid",
        "source": SOURCE_FERRANDI + ", p. 16",
    },
    {
        "title": "Le taux de protéines d'une farine décide de son usage",
        "category": "Farines",
        "content": (
            "Le gluten se forme quand les protéines de la farine rencontrent l'eau au "
            "pétrissage : plus il y en a, plus la farine est dite « forte ». Repères : "
            "8 à 10 % de protéines pour les pâtisseries, pâtes feuilletées, sauces et "
            "crêpes ; 10 à 12 % pour les pains ; 12 à 15 % pour les viennoiseries. En "
            "général, plus une farine est blanche, plus sa force est élevée par rapport "
            "aux farines complètes, riches en son et en fibres."
        ),
        "icon": "percent",
        "source": SOURCE_FERRANDI + ", p. 17",
    },
    {
        "title": "Levain dur ou levain liquide, deux résultats différents",
        "category": "Fermentation",
        "content": (
            "Un levain dur, hydraté à 50 %, donne un pain rustique au caractère marqué, à "
            "la croûte épaisse et aux arômes acétiques. Un levain liquide, hydraté à "
            "100 %, est plus doux au goût, aux arômes lactiques. Les deux viennent du même "
            "« levain tout point », rafraîchi cinq à six fois de suite jusqu'à être au "
            "maximum de son activité — c'est la quantité d'eau ajoutée au rafraîchi qui "
            "détermine lequel on obtient."
        ),
        "icon": "droplet",
        "source": SOURCE_FERRANDI + ", p. 17",
    },
    {
        "title": "Un levain ne meurt jamais, sauf oublié trop longtemps",
        "category": "Fermentation",
        "content": (
            "Un levain tout point se perpétue de génération en génération de boulangers, "
            "tant qu'il est rafraîchi au bon moment : dès qu'il commence à mousser. "
            "Attendre trop longtemps pour le nourrir nuit au développement des arômes des "
            "fournées suivantes — mais le levain lui-même ne meurt pas pour autant."
        ),
        "icon": "repeat",
        "source": SOURCE_FERRANDI + ", p. 17",
    },
    {
        "title": "Pâte fermentée, poolish ou levain-levure : trois préfermentations",
        "category": "Fermentation",
        "content": (
            "La pâte fermentée est un reste de pâte d'une fournée précédente (jusqu'à "
            "trois jours au réfrigérateur), utilisé comme améliorant naturel — ou préparée "
            "exprès la veille (farine, eau, un peu de levure et de sel). La poolish, "
            "liquide (autant d'eau que de farine), fermente lentement pour développer "
            "arômes et acidité subtile ; elle convient bien aux croissants et à la "
            "baguette. Le levain-levure, de consistance ferme, va plutôt aux boules et "
            "aux brioches."
        ),
        "icon": "layers",
        "source": SOURCE_FERRANDI + ", p. 18",
    },
    {
        "title": "Une eau filtrée ou reposée fait une meilleure pâte",
        "category": "Hydratation",
        "content": (
            "L'eau relie tous les ingrédients et permet à la fois au gluten et à la "
            "fermentation de se développer. Mieux vaut utiliser une eau filtrée, ou bien "
            "laisser le chlore s'éliminer en laissant l'eau reposer 12 heures avant de "
            "s'en servir. Sa température reste le paramètre le plus important à maîtriser "
            "pour la fermentation."
        ),
        "icon": "droplet",
        "source": SOURCE_FERRANDI + ", p. 18",
    },
    {
        "title": "Le sel fait bien plus que saler la pâte",
        "category": "Fermentation",
        "content": (
            "Au-delà du goût, le sel renforce la résistance du gluten en favorisant les "
            "liaisons entre les protéines, raffermit la pâte, allonge le temps de "
            "fermentation (et donc développe davantage les saveurs), aide à obtenir une "
            "mie plus régulière et une croûte fine et colorée, et favorise la "
            "conservation. Il inhibe en revanche le développement des micro-organismes : "
            "ne jamais le mettre en contact direct avec le levain ou la levure."
        ),
        "icon": "alert-circle",
        "source": SOURCE_FERRANDI + ", p. 18",
    },
    {
        "title": "Le beurre AOP Charentes-Poitou, à défaut de beurre de tourage",
        "category": "Viennoiserie",
        "content": (
            "Un beurre standard est composé à 82 % de matières grasses et 16 % d'eau. Les "
            "professionnels préfèrent un beurre de tourage, plus riche en matières "
            "grasses et contenant moins d'eau, qui fond moins facilement pendant le "
            "façonnage. À défaut, un beurre AOP, en particulier un beurre "
            "Charentes-Poitou, permet aussi d'obtenir un excellent résultat."
        ),
        "icon": "award",
        "source": SOURCE_FERRANDI + ", p. 18",
    },
    {
        "title": "Calibrer ses œufs pour la viennoiserie",
        "category": "Viennoiserie",
        "content": (
            "« Œuf » sans autre précision désigne toujours l'œuf de poule, utilisé frais "
            "(moins de 28 jours après la ponte). Plus un œuf est frais, plus son jaune est "
            "bombé et son blanc gélatineux et épais. Privilégier les œufs de type 0 "
            "(biologique) ou 1 (plein air), de calibre moyen, entre 53 et 63 g."
        ),
        "icon": "circle",
        "source": SOURCE_FERRANDI + ", p. 18",
    },
    {
        "title": "Le frasage précède le pétrissage",
        "category": "Pétrissage",
        "content": (
            "Le pétrissage commence par le frasage, un mélange effectué à vitesse lente "
            "pendant 3 à 5 minutes qui hydrate la farine et amorce le développement du "
            "gluten, avant la phase plus rapide de découpage, étirage et soufflage qui "
            "structure vraiment la pâte."
        ),
        "icon": "layers",
        "source": SOURCE_FERRANDI + ", p. 20",
    },
    {
        "title": "L'autolyse réduit le temps de pétrissage",
        "category": "Pétrissage",
        "content": (
            "Facultative, l'autolyse consiste à laisser reposer 30 minutes à 1 heure le "
            "mélange d'eau et de farine, avant d'y ajouter le reste des ingrédients. Elle "
            "hydrate la farine, assouplit le gluten et réduit le temps de pétrissage — "
            "particulièrement intéressant pour les pains à longue fermentation."
        ),
        "icon": "clock",
        "source": SOURCE_FERRANDI + ", p. 20",
    },
    {
        "title": "Pâte douce, bâtarde ou ferme : trois consistances, trois mies",
        "category": "Pétrissage",
        "content": (
            "Selon la consistance obtenue au pétrissage, ajustable par bassinage (ajout "
            "d'eau) ou contre-frasage (ajout de farine), on obtient une pâte douce (mie "
            "très alvéolée, qui demande deux temps de fermentation), une pâte bâtarde "
            "(plus de corps, alvéoles de tailles différentes) ou une pâte ferme (mie "
            "serrée)."
        ),
        "icon": "layers",
        "source": SOURCE_FERRANDI + ", p. 20",
    },
    {
        "title": "La température de base dépend du type de pétrissage",
        "category": "Température",
        "content": (
            "La température de base n'est pas fixe : elle se calcule selon le matériel "
            "utilisé. Pour un fournil à 24-26 °C, elle vaut 64 °C en pétrissage vitesse "
            "lente, 54 °C en pétrissage amélioré, 52 °C en pétrissage intensifié (66/56/54 "
            "à 21-23 °C ; 68/58/56 à 18-20 °C). La température de l'eau à ajouter est "
            "alors : température de base moins (température de l'air + température de la "
            "farine)."
        ),
        "icon": "thermometer",
        "source": SOURCE_FERRANDI + ", p. 20",
    },
    {
        "title": "La buée maison, avec des gants",
        "category": "Cuisson",
        "content": (
            "Pour obtenir de la buée dans un four domestique, placez une lèchefrite sous "
            "la grille au moment d'enfourner, puis versez-y immédiatement un bol d'eau "
            "chaude et refermez aussitôt la porte — la production de vapeur est immédiate, "
            "portez des gants et protégez-vous. Plus la plaque ou la pierre de cuisson est "
            "épaisse, meilleure sera la cuisson : elle emmagasine plus de chaleur. Pour "
            "certains pains, ouvrir la porte du four en fin de cuisson (en baissant la "
            "température de 50 °C) évacue l'humidité et développe une croûte plus épaisse "
            "et croquante, sans la colorer davantage."
        ),
        "icon": "cloud",
        "source": SOURCE_FERRANDI + ", p. 21",
    },
    {
        "title": "Le bon emballage dépend de la texture recherchée",
        "category": "Conservation",
        "content": (
            "Pour conserver le moelleux d'un pain de mie, de buns ou de pitas, mieux vaut "
            "les envelopper dans du plastique (sac, film étirable). Pour préserver le "
            "croustillant d'une croûte, le torchon propre est une meilleure solution. Pour "
            "les produits secs, privilégier une boîte hermétique, en métal de préférence."
        ),
        "icon": "package",
        "source": SOURCE_FERRANDI + ", p. 21",
    },
    {
        "title": "Congeler un pain avant sa cuisson complète, une viennoiserie après",
        "category": "Conservation",
        "content": (
            "Pour le pain, la précuisson est recommandée : défournez-le dès les premiers "
            "signes de coloration, laissez-le totalement refroidir sur une grille, "
            "entourez-le hermétiquement de film alimentaire puis congelez-le. Pour le "
            "consommer, finissez la cuisson dans un four préchauffé à la température de la "
            "recette, avec un peu de vapeur. À l'inverse, les viennoiseries se congèlent "
            "après cuisson complète : filmez-les soigneusement sans les écraser (pour ne "
            "pas abîmer le feuilletage), décongelez-les sur une grille, puis réchauffez-les "
            "4 minutes dans un four préchauffé à 150 °C."
        ),
        "icon": "box",
        "source": SOURCE_FERRANDI + ", p. 21",
    },
]
