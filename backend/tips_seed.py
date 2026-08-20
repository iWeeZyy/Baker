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
    # Termes apparus avec la lecture de la section « Techniques de base »
    # (p. 32-123) : gestes nommés, vocabulaire du fournil, matières.
    # « clé » et « son » sont volontairement absents : la recherche compare des
    # sous-chaînes, et ils se cachent dans « couvercle », « boucle » et
    # « cuisson ». Les autres termes ne s'y attrapent que sous leurs propres
    # flexions (« bouler », « tresser », « palmiers »), ce qui est voulu.
    "frasage", "frasée", "bassinage", "division", "dégazage", "dégazer",
    "rafraîchi", "ressuage", "corne", "crochet", "cuve", "réseau de gluten",
    "épi", "chevron", "polka", "saucisson", "lame", "ciseaux", "incision",
    "tresse", "tresser", "brin", "couronne", "goutte", "anneau", "boule",
    "baguette", "ficelle", "bâtard", "cocotte", "étuve", "dorure", "dorer",
    "palmier", "chausson", "compote", "sablage", "torréfaction", "torréfier",
    "meule", "germe", "amande", "macération", "macérer", "raisins",
    "sirop", "béchamel", "congélateur", "film alimentaire", "filmer",
    "pâte levée feuilletée", "feuilletage inversé", "beurre manié",
    "levain chef", "levain tout point", "levain dur", "levain liquide",
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


def _resolved_source(tip: dict, from_book: bool) -> str:
    """La source d'une astuce, page comprise quand elle est connue.

    Une astuce rédigée avec sa propre citation (voir `NEW_FERRANDI_TIPS`) la
    garde telle quelle. Sinon la source vient du commit qui l'a importée, et
    `_PAGE_BACKFILL` y ajoute la page si la lecture de la section technique a
    permis de la retrouver — jamais autrement.
    """
    if tip.get("source"):
        return tip["source"]
    source = _source_for(tip["title"], from_book)
    page = _PAGE_BACKFILL.get(tip["title"])
    if page and source == SOURCE_FERRANDI:
        return f"{source}, {page}"
    return source


def _migrate(tip: dict, from_book: bool) -> dict:
    title = tip["title"]
    category = _CATEGORY_OVERRIDE.get(title) or _CATEGORY_MAP.get(tip["category"], tip["category"])
    out = {
        "title": title,
        "category": category,
        "content": tip["content"],
        "icon": tip.get("icon", "star"),
        "source": _resolved_source(tip, from_book),
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
# Deux passes de lecture, toutes deux faites page par page sur le scan — le PDF
# n'a aucune couche texte, et un OCR qui transforme un 8 en 3 n'annonce rien.
#
#   1. Le chapitre théorique « Les fondamentaux de la boulangerie et de la
#      viennoiserie » (p. 15 à 21) : de la prose sur les matières premières et
#      les étapes de fabrication. Dix-sept astuces.
#   2. Toute la section « LES TECHNIQUES DE BASE » (p. 32 à 123, quatre-vingt-
#      douze pages) : les fiches de geste — levains, autolyse, pétrissage,
#      rabat, boulage, façonnage, les six grignages, tourages, tresses, crèmes.
#      L'import des recettes n'en avait retenu que les encarts « Trucs et
#      astuces de chefs » ; les fiches elles-mêmes n'avaient jamais été lues.
#      Trente-neuf astuces, et surtout la page d'origine enfin rendue aux
#      vingt-trois astuces de BOOK_TIPS qui en venaient sans le dire
#      (`_PAGE_BACKFILL`).
#
# Les chapitres « Introduction » (p. 10-11, présentation de l'école) et
# « Matériel » (p. 24-31, glossaire photo légendé) ont été lus intégralement et
# ne portent aucun conseil : ils ne donnent aucune astuce, et rien n'a été
# inventé pour combler le vide.
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
        # La distinction pureté/force est énoncée p. 15, la table d'emploi p. 16.
        "source": SOURCE_FERRANDI + ", p. 15-16",
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

    # ---- Seconde passe : la section « LES TECHNIQUES DE BASE » (p. 32-123) ----
    # Chapitre Pain (p. 34-59)
    {
        "title": "Du levain chef au levain tout point : une semaine",
        "category": "Fermentation",
        "content": (
            "Un levain chef est prêt quand son odeur devient marquée, que de grosses bulles "
            "apparaissent et que sa texture rappelle une mousse au chocolat. Dès qu'il commence "
            "à mousser, il faut le rafraîchir cinq ou six fois — en levain dur ou en levain "
            "liquide selon ce que l'on veut — pour obtenir, au bout d'une semaine de "
            "fermentation, un levain tout point."
        ),
        "icon": "calendar",
        "source": SOURCE_FERRANDI + ", p. 37",
    },
    {
        "title": "Les températures d'un rafraîchi",
        "category": "Température",
        "content": (
            "Un levain dur se rafraîchit à l'eau à 35 °C et fermente idéalement à 28 °C ; un "
            "levain liquide se rafraîchit à l'eau à 45 °C et fermente idéalement à 35 °C. Sans "
            "cette chaleur la fermentation n'échoue pas, elle prend simplement plus de temps. "
            "Dans les deux cas : 5 heures à température ambiante, ou 3 heures puis une nuit au "
            "réfrigérateur, et plusieurs jours de conservation au froid."
        ),
        "icon": "thermometer",
        "source": SOURCE_FERRANDI + ", p. 38-41",
    },
    {
        "title": "Reconnaître une poolish prête",
        "category": "Fermentation",
        "content": (
            "Une poolish est prête à l'emploi quand elle a triplé de volume, qu'elle commence à "
            "s'aplatir et que quelques crevasses se forment sur le dessus. C'est l'affaissement "
            "qui signale le sommet."
        ),
        "icon": "eye",
        "source": SOURCE_FERRANDI + ", p. 43",
    },
    {
        "title": "L'autolyse se fait sans sel ni levure",
        "category": "Pétrissage",
        "content": (
            "Mélangez seulement l'eau et la farine, 3 à 5 minutes, jusqu'à une pâte homogène : à "
            "ce stade elle n'est ni souple ni élastique, et se déchire quand on tire dessus. "
            "Laissez-la reposer au minimum 30 minutes, idéalement plusieurs heures selon le "
            "pétrissage prévu ensuite, couverte d'un plastique ou d'un torchon humide sans "
            "contact direct. À la fin de l'autolyse, la pâte est plus lisse et plus extensible."
        ),
        "icon": "clock",
        "source": SOURCE_FERRANDI + ", p. 44",
    },
    {
        "title": "Sel et levure dans deux creux séparés",
        "category": "Pétrissage",
        "content": (
            "Après une autolyse, faites deux petits creux distincts dans la pâte : la levure "
            "émiettée dans l'un, le sel dans l'autre. Ramenez un peu de pâte par-dessus pour "
            "qu'ils commencent à fondre avant le pétrissage."
        ),
        "icon": "circle",
        "source": SOURCE_FERRANDI + ", p. 44",
    },
    {
        "title": "Savoir si la pâte est bien frasée",
        "category": "Pétrissage",
        "content": (
            "Touchez légèrement la pâte avec le dos de la main. Si elle colle, la farine n'a pas "
            "absorbé toute l'eau : il faut poursuivre le frasage. C'est ce test qui dit quand "
            "passer du frasage au pétrissage."
        ),
        "icon": "activity",
        "source": SOURCE_FERRANDI + ", p. 45",
    },
    {
        "title": "Le pétrissage à la machine se fait en deux temps",
        "category": "Pétrissage",
        "content": (
            "D'abord le frasage : au crochet, vitesse lente, environ 5 minutes, jusqu'à une pâte "
            "homogène qui ne colle plus. Ensuite le pétrissage : 5 à 8 minutes pour construire le "
            "réseau de gluten. La pâte ne doit pas dépasser 24 °C en fin de pétrissage. Vérifiez "
            "le réseau en étirant la pâte : elle doit être lisse et extensible sans se déchirer."
        ),
        "icon": "thermometer",
        "source": SOURCE_FERRANDI + ", p. 45",
    },
    {
        "title": "Pétrir à la main : étirer, puis ramener par en dessous",
        "category": "Pétrissage",
        "content": (
            "Délayez au fouet l'eau, le sel et la levure émiettée dans un saladier, ajoutez la "
            "farine et amalgamez aux doigts, en vous aidant d'une corne. Débarrassez sur un plan "
            "fariné : le pétrissage consiste à étirer la pâte vers l'extérieur, puis à la ramener "
            "par en dessous, jusqu'à ce qu'elle soit souple et élastique. Là aussi, ne dépassez "
            "pas 24 °C en fin de pétrissage."
        ),
        "icon": "activity",
        "source": SOURCE_FERRANDI + ", p. 46-47",
    },
    {
        "title": "Bouler une grosse pâte à deux mains",
        "category": "Façonnage",
        "content": (
            "Le boulage d'une grosse pièce reprend le geste d'une petite, mais à deux mains : les "
            "deux auriculaires passent légèrement sous la pâte à chaque rotation. Le pouce et "
            "l'auriculaire touchent la table et la font tourner pour finir de la lisser."
        ),
        "icon": "circle",
        "source": SOURCE_FERRANDI + ", p. 50",
    },
    {
        "title": "La soudure d'une baguette se fait sur le pouce",
        "category": "Façonnage",
        "content": (
            "Pour souder une baguette, pliez la pâte en deux en vous servant du pouce comme "
            "pivot : placez-le à l'extrémité gauche, au milieu de l'épaisseur, et de l'autre main "
            "repliez la pâte par-dessus en avançant, en appuyant légèrement sur la jointure pour "
            "que l'ensemble colle. Roulez ensuite légèrement pour affiner les extrémités en pointes."
        ),
        "icon": "minus",
        "source": SOURCE_FERRANDI + ", p. 52",
    },
    {
        "title": "Grigner un épi aux ciseaux, sans les retirer",
        "category": "Cuisson",
        "content": (
            "L'épi se fait aux ciseaux sur un pâton à la pousse légère : incisez profondément, aux "
            "trois quarts, par le dessus, à 45 degrés, tous les 4 à 6 cm, sans couper complètement. "
            "Décalez chaque « grain » au fur et à mesure, en alternant à droite puis à gauche — "
            "sans retirer les ciseaux entre deux incisions, sinon la pâte se recolle. À la sortie "
            "du four, cette forme est très fragile et se casse facilement."
        ),
        "icon": "scissors",
        "source": SOURCE_FERRANDI + ", p. 53",
    },
    {
        "title": "En cocotte, pas de buée",
        "category": "Cuisson",
        "content": (
            "Une cocotte fermée retient la vapeur du pain lui-même : on enfourne donc sans buée. "
            "Préchauffez la cocotte à vide à 260 °C, déposez-y le pâton grigné sur son papier "
            "cuisson, refermez le couvercle et comptez 30 minutes à 260 °C. Retirez le couvercle "
            "une fois le pain coloré pour finir la cuisson, puis débarrassez aussitôt sur grille "
            "pour le ressuage."
        ),
        "icon": "cloud",
        "source": SOURCE_FERRANDI + ", p. 59",
    },

    # Chapitre Viennoiserie (p. 60-109)
    {
        "title": "Quadriller une détrempe pour la détendre",
        "category": "Viennoiserie",
        "content": (
            "Une fois la détrempe boulée, incisez-la en quadrillage au couteau avant de la "
            "filmer : c'est ce qui la détend. Comptez ensuite 20 minutes au réfrigérateur au "
            "minimum avant de commencer le tourage."
        ),
        "icon": "grid",
        "source": SOURCE_FERRANDI + ", p. 67 et 71",
    },
    {
        "title": "Le feuilletage inversé enferme la détrempe dans le beurre",
        "category": "Viennoiserie",
        "content": (
            "C'est l'inverse du feuilletage classique : le beurre manié est abaissé en un "
            "rectangle deux fois plus grand que la détrempe, puis rabattu sur elle en soudant "
            "tous les côtés — la pâte se retrouve enfermée dans le beurre, et non le beurre dans "
            "la pâte. Entre deux tours, filmez le pâton au frais pour éviter le croûtage."
        ),
        "icon": "layers",
        "source": SOURCE_FERRANDI + ", p. 72-73",
    },
    {
        "title": "Une pâte levée feuilletée se pétrit plus froide",
        "category": "Température",
        "content": (
            "Contrairement à une pâte à pain, qu'on arrête à 24 °C, une pâte levée feuilletée doit "
            "sortir du pétrin autour de 21-23 °C : elle part ensuite au tourage, où toute chaleur "
            "ferait fondre le beurre. L'eau employée est d'ailleurs à 4 °C. Après un pointage court "
            "de 15 minutes à température ambiante, elle se conserve une nuit, filmée, avant d'être "
            "tourée."
        ),
        "icon": "thermometer",
        "source": SOURCE_FERRANDI + ", p. 74",
    },
    {
        "title": "La pâte levée feuilletée se raffermit au congélateur",
        "category": "Viennoiserie",
        "content": (
            "Là où un feuilletage classique passe au réfrigérateur, la pâte levée feuilletée va au "
            "congélateur : 30 minutes après l'abaisse de départ, puis 15 minutes entre les tours et "
            "30 minutes avant utilisation. Entre deux tours, le pâton s'incise au couteau de chaque "
            "côté, dans l'épaisseur."
        ),
        "icon": "wind",
        "source": SOURCE_FERRANDI + ", p. 75-76",
    },
    {
        "title": "Les viennoiseries poussent à 26 °C",
        "category": "Fermentation",
        "content": (
            "Croissants et pains au chocolat poussent 2 heures à 2 h 30 en étuve à 26 °C ; les "
            "pains aux raisins, les brioches à tête et les couronnes, 1 h 30 à 2 heures. Sans "
            "étuve, un four éteint dans lequel on place un récipient d'eau bouillante fait le même "
            "travail. La cuisson suit en four ventilé : 170 °C environ 15 minutes pour un croissant "
            "ou un pain au chocolat, 160 °C environ 20 minutes pour un pain aux raisins."
        ),
        "icon": "thermometer",
        "source": SOURCE_FERRANDI + ", p. 78",
    },
    {
        "title": "Faire macérer les raisins avant de les rouler",
        "category": "Hydratation",
        "content": (
            "Les raisins secs se macèrent une heure dans un peu d'eau tiède ou d'alcool — rhum, "
            "kirsch, fleur d'oranger — puis s'égouttent avant d'être répartis sur la crème "
            "pâtissière. Secs, ils pomperaient l'eau de la pâte."
        ),
        "icon": "droplet",
        "source": SOURCE_FERRANDI + ", p. 81",
    },
    {
        "title": "Un chausson cru se congèle",
        "category": "Conservation",
        "content": (
            "Les chaussons aux pommes se congèlent crus. Ils se cuisent alors encore congelés, en "
            "comptant 7 minutes de cuisson de plus."
        ),
        "icon": "wind",
        "source": SOURCE_FERRANDI + ", p. 86",
    },
    {
        "title": "Un chausson se juge par le dessous",
        "category": "Cuisson",
        "content": (
            "Comptez 30 minutes à 190 °C : le dessous du chausson doit être coloré et ferme comme "
            "les feuillets. C'est là que se lit la cuisson, pas sur le dessus doré. À la sortie du "
            "four, badigeonnez de sirop porté à ébullition puis refroidi."
        ),
        "icon": "eye",
        "source": SOURCE_FERRANDI + ", p. 86",
    },
    {
        "title": "Les palmiers se tournent au sucre",
        "category": "Viennoiserie",
        "content": (
            "Partez d'une pâte feuilletée à mi-tourage, après deux tours. Fleurez ensuite le plan "
            "de travail de sucre — et non de farine — pour donner un tour double puis un tour "
            "simple, en saupoudrant de sucre à chaque fois. C'est ce sucre pris dans les feuillets "
            "qui caramélise à la cuisson."
        ),
        "icon": "grid",
        "source": SOURCE_FERRANDI + ", p. 87",
    },
    {
        "title": "Un palmier se retourne en cours de cuisson",
        "category": "Cuisson",
        "content": (
            "Enfournez à 180 °C pendant 20 minutes, puis retournez les palmiers dès que la face du "
            "dessous est bien caramélisée et poursuivez 10 minutes pour dorer l'autre face. Sans ce "
            "retournement, une seule face caramélise."
        ),
        "icon": "rotate-ccw",
        "source": SOURCE_FERRANDI + ", p. 88",
    },
    {
        "title": "Le beurre entre en dernier dans une brioche",
        "category": "Pétrissage",
        "content": (
            "Frasez tous les ingrédients sauf le beurre, puis pétrissez 5 minutes en vitesse lente "
            "et 15 minutes en vitesse moyenne : la pâte commence à se décoller et doit devenir "
            "élastique. Cornez le fond de cuve pour que tout se mélange. C'est seulement là qu'on "
            "incorpore le beurre ramolli, avec 5 minutes de pétrissage de plus, jusqu'à ce que la "
            "pâte se détache des bords."
        ),
        "icon": "clock",
        "source": SOURCE_FERRANDI + ", p. 90",
    },
    {
        "title": "Rompre une pâte à brioche lui donne de la force",
        "category": "Façonnage",
        "content": (
            "Après un pointage de 30 minutes à température ambiante, rompez la pâte pour la dégazer "
            "au maximum : c'est ce qui lui apporte de la force. Stockez-la ensuite idéalement une "
            "nuit au réfrigérateur, au minimum 2 heures avant utilisation. Une pâte à brioche se "
            "garde 48 heures au froid, et se cuit de 170 à 220 °C selon le poids des pièces."
        ),
        "icon": "activity",
        "source": SOURCE_FERRANDI + ", p. 90-91",
    },
    {
        "title": "La tête d'une brioche se monte en goutte dans un anneau",
        "category": "Façonnage",
        "content": (
            "Détaillez deux pâtons par pièce — un gros, un petit — et boulez-les. Percez la grosse "
            "boule pour en faire un anneau, façonnez la petite en forme de goutte, puis enfoncez "
            "bien la goutte au centre de l'anneau. Beurrez soigneusement le moule au pinceau avant "
            "d'y déposer la brioche, et démoulez dès la sortie du four pour permettre le ressuage."
        ),
        "icon": "circle",
        "source": SOURCE_FERRANDI + ", p. 93-97",
    },
    {
        "title": "Une couronne se creuse, elle ne se roule pas",
        "category": "Façonnage",
        "content": (
            "Percez la boule, agrandissez doucement le trou sans déchirer la pâte, puis rabattez la "
            "bordure du trou vers l'extérieur. Faites rouler ce boudin sous la paume pour obtenir "
            "une forme régulière et bien arrondie, rabattez l'extérieur du disque sur le boudin, "
            "puis étirez et roulez jusqu'à la couronne. Si la pâte se déchire ou résiste, laissez-la "
            "se détendre quelques minutes avant de continuer."
        ),
        "icon": "circle",
        "source": SOURCE_FERRANDI + ", p. 98-99",
    },
    {
        "title": "La tresse à un brin se noue en huit",
        "category": "Façonnage",
        "content": (
            "Prenez un boudin de 40 cm et visualisez-y trois parties égales. Ramenez la pointe vers "
            "le tiers restant, en veillant à ce qu'elle repose sur le boudin. Faites passer le brin "
            "de gauche dans la boucle : par-dessus le premier brin, puis par-dessous le second. "
            "Tenez le haut et faites une rotation pour former un « 8 », insérez le bout de pâte "
            "restant dans la nouvelle petite boucle, puis pincez les extrémités."
        ),
        "icon": "repeat",
        "source": SOURCE_FERRANDI + ", p. 102-103",
    },
    {
        "title": "Tresser à deux brins, en croix",
        "category": "Façonnage",
        "content": (
            "Disposez deux brins de 50 à 60 cm en croix, le vertical posé sur l'horizontal. "
            "Rabattez le brin de droite vers la gauche en le plaçant au-dessous, puis celui de "
            "gauche vers la droite en le plaçant au-dessus. Ramenez ensuite le brin du bas vers le "
            "haut par la gauche, et celui du haut vers le bas par la droite. Répétez jusqu'au bout, "
            "puis pincez les extrémités."
        ),
        "icon": "repeat",
        "source": SOURCE_FERRANDI + ", p. 104-105",
    },
    {
        "title": "Tresser à trois brins",
        "category": "Façonnage",
        "content": (
            "Pincez ensemble une extrémité de trois brins aux bouts pointus. Face à vous, placez "
            "deux brins côte à côte à droite et le troisième plus loin à gauche. Ramenez le brin le "
            "plus à droite par-dessus le deuxième, vers le troisième. Prenez ensuite le brin "
            "complètement à gauche, passez-le par-dessus le deuxième et ramenez-le vers le "
            "troisième à droite. Répétez, en gardant la tresse bien à plat, puis pincez les "
            "extrémités."
        ),
        "icon": "repeat",
        "source": SOURCE_FERRANDI + ", p. 106-107",
    },
    {
        "title": "Ne serrez jamais une tresse",
        "category": "Façonnage",
        "content": (
            "On doit pouvoir voir le plan de travail entre chaque nœud d'une tresse. Ce jeu laisse "
            "la place à la pousse : une tresse serrée se déchire à la cuisson, faute de pouvoir "
            "gonfler."
        ),
        "icon": "alert-circle",
        "source": SOURCE_FERRANDI + ", p. 106",
    },

    # Chapitre Crèmes et autres garnitures (p. 110-123)
    {
        "title": "Parfumer une crème pâtissière",
        "category": "Général",
        "content": (
            "Le café s'ajoute sous forme de 15 à 20 g d'extrait, de 15 à 20 g de café lyophilisé "
            "dans le lait, ou de 70 g de café moulu infusé dans le lait tiède puis filtré. Les "
            "alcools comptent 2 à 3 % du poids de la crème et s'ajoutent dans la crème froide. Le "
            "chocolat, lui, se met dans la crème chaude : 40 à 50 g de cacao pure pâte 100 %, "
            "remplaçable par le chocolat de votre choix — en réduisant alors le sucre, sans quoi la "
            "crème serait trop sucrée."
        ),
        "icon": "droplet",
        "source": SOURCE_FERRANDI + ", p. 112",
    },
    {
        "title": "Refroidir vite une crème pâtissière",
        "category": "Conservation",
        "content": (
            "Ne laissez pas une crème pâtissière refroidir dans sa casserole : étalez-la sur une "
            "plaque recouverte de film alimentaire, puis filmez-la au contact. Elle perd sa chaleur "
            "en quelques minutes au lieu de plusieurs heures. Le beurre, lui, s'incorpore hors du "
            "feu, en morceaux, en fin de cuisson."
        ),
        "icon": "wind",
        "source": SOURCE_FERRANDI + ", p. 113",
    },
    {
        "title": "Filmer au contact, systématiquement",
        "category": "Conservation",
        "content": (
            "Crème pâtissière, compote, béchamel : toutes se conservent filmées au contact, pour "
            "qu'aucune peau ne se forme et qu'aucune eau ne se condense dessus. Comptez 24 heures "
            "au réfrigérateur pour une crème pâtissière, 48 heures pour une béchamel, 3 jours pour "
            "une compote de pommes."
        ),
        "icon": "layers",
        "source": SOURCE_FERRANDI + ", p. 113, 116 et 123",
    },
    {
        "title": "Une compote se sucre selon les pommes",
        "category": "Général",
        "content": (
            "Le sucre d'une compote n'est pas une constante : comptez environ 25 g pour 500 g de "
            "pommes, à ajuster selon leur acidité. Les pommes se détaillent en cubes de 1 cm et se "
            "cuisent dans du beurre fondu, 5 minutes jusqu'à ce qu'elles deviennent fondantes, puis "
            "3 minutes de plus après l'ajout du sucre. La compote est prête lorsque les morceaux "
            "ont caramélisé."
        ),
        "icon": "eye",
        "source": SOURCE_FERRANDI + ", p. 116-117",
    },
    {
        "title": "Le sablage torréfie les fruits secs en même temps que le sucre",
        "category": "Cuisson",
        "content": (
            "Cuisez le sucre à 117 °C, puis ajoutez les fruits secs non grillés : le sucre devient "
            "opaque et commence à sabler, ses cristaux se collent autour des fruits, et en "
            "poursuivant la cuisson il caramélise tout en les torréfiant. C'est pourquoi on part de "
            "fruits crus. Vérifiez la torréfaction en coupant un fruit en deux, jamais à la couleur "
            "du sucre."
        ),
        "icon": "thermometer",
        "source": SOURCE_FERRANDI + ", p. 118-119",
    },

    # Chapitre des fondamentaux, pages non lues lors de la première passe
    {
        "title": "Ce qu'une farine de meule a de plus",
        "category": "Farines",
        "content": (
            "L'appellation « farine de meule » est réservée aux farines obtenues par broyage des "
            "céréales entre deux meules de pierre, et non par des cylindres en métal. Cette méthode "
            "conserve le germe du grain et une partie du son, ce qui préserve la richesse "
            "nutritionnelle de la farine."
        ),
        "icon": "grid",
        "source": SOURCE_FERRANDI + ", p. 15",
    },
    {
        "title": "Les trois parties d'un grain de blé",
        "category": "Farines",
        "content": (
            "Un grain de blé se compose d'une enveloppe externe de cellulose — le son —, d'une "
            "amande qui contient l'amidon et le gluten, et d'un germe riche en huile. C'est la part "
            "de son conservée qui distingue une farine complète d'une farine blanche. Le blé tendre "
            "est la céréale la plus utilisée pour le pain car naturellement riche en gluten, donc "
            "aisément panifiable."
        ),
        "icon": "layers",
        "source": SOURCE_FERRANDI + ", p. 15",
    },
    {
        "title": "Pointage, détente, apprêt : les trois repos",
        "category": "Fermentation",
        "content": (
            "Le pointage est le premier temps de repos, juste après le pétrissage : c'est la "
            "première étape de la fermentation. La détente est la pause entre la division et le "
            "façonnage des pâtons. L'apprêt est le deuxième temps de repos, après le façonnage, et "
            "l'étape finale de la fermentation. Après la cuisson vient le ressuage : l'évaporation "
            "de l'eau du pain une fois défourné."
        ),
        "icon": "clock",
        "source": SOURCE_FERRANDI + ", p. 23",
    },
    {
        "title": "Le lexique du fournil",
        "category": "Général",
        "content": (
            "Frasage : mélange des ingrédients avant le pétrissage. Bassinage : ajout d'eau en "
            "cours de pétrissage. Division : découpe du pâton avant le façonnage. Dégazage : "
            "chasser les gaz de la pâte après une première levée, au boulage par exemple. "
            "Boulage : façonner le pain en boule. Clé : le point de soudure créé au façonnage, "
            "placé le plus souvent en dessous pour être invisible. Rafraîchi : nourrir le levain de "
            "farine et d'eau. Poolish : une pâte préfermentée à la levure."
        ),
        "icon": "book-open",
        "source": SOURCE_FERRANDI + ", p. 23",
    },
]

# ---------- Pages rendues aux astuces de BOOK_TIPS ----------
# Ces astuces ont été extraites des encarts « Trucs et astuces de chefs » lors
# de l'import des recettes, sans que la page soit notée. La lecture complète de
# la section technique a permis de retrouver leur origine exacte : la page est
# rendue ici plutôt que devinée. Une astuce dont la page n'a pas été retrouvée
# avec certitude n'y figure pas et garde sa source sans numéro.
_PAGE_BACKFILL = {
    "Reconnaître un levain à maturité": "p. 39 et 41",
    "Doser la levure d'une poolish": "p. 43",
    "Savoir quand arrêter les rabats": "p. 48",
    "Un rabat se donne dans les deux sens": "p. 48-49",
    "Sept ou huit plis pour bouler": "p. 50",
    "Le pli d'une baguette fait deux tiers de sa hauteur": "p. 51",
    "Un coup de lame par dix centimètres": "p. 54",
    "Grigner une baguette en biais, sur un tiers": "p. 54",
    "Ne jamais inciser deux fois au même endroit": "p. 55",
    "Choisir son grignage selon la pâte": "p. 56-58",
    "La profondeur de l'incision décide de la forme": "p. 57-58",
    "Un tiers du poids de la pâte en beurre de tourage": "p. 62-63",
    "Les trois tours et ce qu'ils plient": "p. 64-65",
    "Marquer les tours du doigt": "p. 65",
    "Le beurre doit avoir la fermeté de la détrempe": "p. 67 et 73",
    "Cinq tours pour un feuilletage": "p. 69",
    "Écraser la pointe du croissant": "p. 78",
    "Cinq minutes de froid avant la seconde dorure": "p. 78 et 80",
    # « La chaîne du froid décide du feuilletage » n'est PAS ici : l'encart de
    # la p. 86 dit la même chose, mais cette astuce-là vient de Josée Fiset et
    # garde donc sa source. Deux ouvrages peuvent énoncer la même règle.
    "Enfourner sur plaque brûlante pour faire ressortir la tête": "p. 94 et 97",
    "Moins de farine dans une crème pâtissière au chocolat": "p. 113",
    "La crème d'amande ne se cuit jamais seule": "p. 115",
    "Un praliné trop torréfié devient amer": "p. 119",
}
