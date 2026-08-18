"""Seed data for the Bakers app: classic French bakery recipes and tips.

Two sources are joined at the bottom of this file: the demonstration recipes
written for the app, and the sheets imported from professional works
(`seed_books.py`). A book sheet that carries the same title as a demonstration
one **replaces** it: the startup sync upserts on the title, so the recipe keeps
its id — and with it its likes, comments and favourites.
"""
from families import FAMILY_BY_TITLE, family_of
from seed_books import BOOK_RECIPES, BOOK_TIPS

BAKER_RECIPES = [
    {
        "title": "Baguette Tradition",
        "category": "Pains",
        "difficulty": "Intermédiaire",
        "time_minutes": 240,
        "hydration": 68,
        # "Diviser en 3 pâtons" — écrit dans les étapes ci-dessous.
        "yield_pieces": 3,
        "image_url": "https://images.unsplash.com/photo-1599819055803-717bba43890f?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "La baguette parisienne classique, à la mie alvéolée et croûte dorée.",
        "ingredients": [
            "500 g de farine T65",
            "340 g d'eau tiède",
            "10 g de sel",
            "3 g de levure fraîche"
        ],
        "steps": [
            "Autolyse : mélanger farine et eau, laisser reposer 30 min.",
            "Ajouter la levure puis le sel. Pétrir 8 minutes.",
            "Pointage : 2 h à température ambiante avec 2 rabats.",
            "Diviser en 3 pâtons de 280 g, préformer en boules.",
            "Détente 20 minutes, puis façonner en baguettes.",
            "Apprêt 1 h 30 sur couche farinée.",
            "Grigner et enfourner à 250°C avec buée pendant 22 minutes."
        ]
    },
    {
        "title": "Croissant au beurre",
        "category": "Viennoiseries",
        "difficulty": "Avancé",
        "time_minutes": 720,
        "hydration": 50,
        "image_url": "https://images.unsplash.com/photo-1555507036-ab1f4038808a?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Feuilleté doré, croustillant à l'extérieur et moelleux au cœur.",
        "ingredients": [
            "500 g farine T45",
            "250 g beurre de tourage",
            "60 g sucre", "10 g sel",
            "10 g levure fraîche",
            "250 g lait entier",
            "1 œuf pour dorure"
        ],
        "steps": [
            "Pétrir la détrempe et laisser reposer 1 h au froid.",
            "Aplatir le beurre en carré.",
            "Envelopper le beurre dans la détrempe.",
            "Réaliser un tour double, repos 1 h au froid.",
            "Réaliser un tour simple, repos 1 h.",
            "Étaler à 3 mm, découper des triangles, façonner.",
            "Pousse 2 h à 26°C, dorer et cuire à 200°C 16 minutes."
        ]
    },
    {
        "title": "Pain au chocolat",
        "category": "Viennoiseries",
        "difficulty": "Avancé",
        "time_minutes": 720,
        "hydration": 50,
        # 24 barres de chocolat, 2 par rectangle : 12 pièces.
        "yield_pieces": 12,
        "image_url": "https://images.unsplash.com/photo-1631129023315-7ef0e76faaed?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Deux barres de chocolat enveloppées dans une pâte feuilletée levée.",
        "ingredients": [
            "Même pâte que le croissant (500 g farine)",
            "24 barres de chocolat noir 55%",
            "1 œuf pour dorure"
        ],
        "steps": [
            "Préparer la pâte feuilletée levée (voir croissant).",
            "Découper des rectangles de 8x14 cm.",
            "Poser 2 barres de chocolat par rectangle.",
            "Rouler serré et déposer soudure en dessous.",
            "Pousse 2 h à 26°C.",
            "Dorer à l'œuf, cuire à 200°C 15 minutes."
        ]
    },
    {
        "title": "Brioche Nanterre",
        "category": "Viennoiseries",
        "difficulty": "Intermédiaire",
        "time_minutes": 360,
        "hydration": 55,
        "image_url": "https://images.unsplash.com/photo-1620921568790-c1cf8984624c?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Brioche moulée, moelleuse et beurrée, idéale pour le petit-déjeuner.",
        "ingredients": [
            "500 g farine T45",
            "10 g sel",
            "60 g sucre",
            "20 g levure fraîche",
            "300 g œufs",
            "250 g beurre pommade"
        ],
        "steps": [
            "Pétrir farine, sel, sucre, levure et œufs 10 min.",
            "Incorporer le beurre pommade en 3 fois.",
            "Pétrir jusqu'à décollement des parois.",
            "Pointage 1 h puis rabat, réserver 12 h au froid.",
            "Diviser en pâtons de 60 g, bouler.",
            "Disposer 8 boules par moule à cake.",
            "Apprêt 2 h, dorer et cuire à 170°C 30 minutes."
        ]
    },
    {
        "title": "Pain de campagne au levain",
        "category": "Pains",
        "difficulty": "Intermédiaire",
        "time_minutes": 1440,
        "hydration": 75,
        "image_url": "https://images.unsplash.com/photo-1509440159596-0249088772ff?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Pain rustique au levain naturel, à la mie souple et goût prononcé.",
        "ingredients": [
            "400 g farine T80",
            "100 g farine de seigle",
            "375 g eau",
            "150 g levain actif",
            "10 g sel"
        ],
        "steps": [
            "Autolyse farines + eau 1 h.",
            "Ajouter le levain, mélanger.",
            "Incorporer le sel, pétrir doucement.",
            "Pointage 4 h avec 3 rabats espacés de 45 min.",
            "Bouler, mise en banneton fariné.",
            "Apprêt 12 h au froid (4°C).",
            "Cuire en cocotte à 240°C 25 min couvert, 20 min découvert."
        ]
    },
    {
        "title": "Fougasse aux olives",
        "category": "Pains",
        "difficulty": "Facile",
        "time_minutes": 180,
        "hydration": 65,
        "image_url": "https://images.unsplash.com/photo-1601579112934-0c1e0dda3a5c?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Pain plat provençal en forme d'épi, parfumé aux olives et herbes.",
        "ingredients": [
            "500 g farine T65",
            "325 g eau",
            "10 g sel",
            "5 g levure fraîche",
            "150 g olives noires dénoyautées",
            "Huile d'olive, herbes de Provence"
        ],
        "steps": [
            "Pétrir tous les ingrédients sauf olives.",
            "Ajouter les olives en fin de pétrissage.",
            "Pointage 1 h 30 avec 2 rabats.",
            "Étaler en rectangle sur plaque huilée.",
            "Inciser en forme d'épi, laisser pousser 45 min.",
            "Badigeonner d'huile et herbes, cuire à 230°C 20 min."
        ]
    },
    {
        "title": "Pain de mie",
        "category": "Pains",
        "difficulty": "Facile",
        "time_minutes": 180,
        "hydration": 60,
        # Un seul moule à cake par fournée.
        "yield_pieces": 1,
        "image_url": "https://images.unsplash.com/photo-1608198093002-ad4e005484ec?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Pain moelleux à la mie serrée, parfait pour toasts et sandwiches.",
        "ingredients": [
            "500 g farine T55",
            "300 g lait tiède",
            "10 g sel",
            "40 g sucre",
            "50 g beurre",
            "10 g levure fraîche"
        ],
        "steps": [
            "Pétrir tous les ingrédients 10 min.",
            "Pointage 1 h.",
            "Façonner en boudin dans un moule à cake beurré.",
            "Apprêt 1 h.",
            "Cuire à 180°C 35 minutes, démouler tiède."
        ]
    },
    {
        "title": "Chausson aux pommes",
        "category": "Viennoiseries",
        "difficulty": "Intermédiaire",
        "time_minutes": 90,
        "hydration": 0,
        "image_url": "https://images.unsplash.com/photo-1621939514649-280e2ee25f60?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Pâte feuilletée croustillante garnie de compote de pommes maison.",
        "ingredients": [
            "500 g pâte feuilletée",
            "4 pommes",
            "50 g sucre",
            "1 gousse de vanille",
            "1 œuf pour dorure"
        ],
        "steps": [
            "Préparer la compote : pommes en dés + sucre + vanille, 15 min.",
            "Étaler la pâte feuilletée à 3 mm.",
            "Découper des ovales de 15 cm.",
            "Garnir de compote, souder à l'œuf.",
            "Rayer le dessus, dorer.",
            "Cuire à 200°C 25 minutes."
        ]
    },
    {
        "title": "Éclair au chocolat",
        "category": "Pâtisseries",
        "difficulty": "Intermédiaire",
        "time_minutes": 120,
        "hydration": 0,
        "image_url": "https://images.unsplash.com/photo-1568051243858-533a607809a5?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Pâte à choux allongée garnie de crème pâtissière au chocolat, glaçage fondant.",
        "ingredients": [
            "250 g eau",
            "100 g beurre",
            "150 g farine",
            "4 œufs",
            "5 g sel",
            "500 g crème pât. chocolat",
            "Fondant chocolat"
        ],
        "steps": [
            "Réaliser la pâte à choux : chauffer eau, beurre, sel.",
            "Hors du feu ajouter la farine, dessécher 2 min.",
            "Incorporer les œufs un à un.",
            "Pocher des éclairs de 12 cm.",
            "Cuire à 200°C 35 min sans ouvrir le four.",
            "Garnir de crème pâtissière chocolat.",
            "Glacer avec fondant chocolat."
        ]
    },
    {
        "title": "Tarte aux fraises",
        "category": "Pâtisseries",
        "difficulty": "Facile",
        "time_minutes": 90,
        "hydration": 0,
        "image_url": "https://images.unsplash.com/photo-1464195244916-405fa0a82545?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Fond sablé, crème pâtissière vanillée et fraises fraîches.",
        "ingredients": [
            "250 g pâte sablée",
            "500 g crème pâtissière",
            "500 g fraises",
            "Nappage neutre"
        ],
        "steps": [
            "Foncer un cercle avec la pâte sablée.",
            "Cuire à blanc à 170°C 20 min.",
            "Garnir de crème pâtissière refroidie.",
            "Disposer les fraises coupées.",
            "Napper avec nappage neutre."
        ]
    },
    {
        "title": "Kouign-amann",
        "category": "Viennoiseries",
        "difficulty": "Avancé",
        "time_minutes": 300,
        "hydration": 55,
        "image_url": "https://images.unsplash.com/photo-1509365465985-25d11c17e812?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Gâteau breton feuilleté au beurre salé et sucre caramélisé.",
        "ingredients": [
            "400 g farine T45",
            "250 g eau",
            "10 g sel",
            "10 g levure",
            "300 g beurre demi-sel",
            "300 g sucre"
        ],
        "steps": [
            "Pétrir farine, eau, sel, levure. Pointage 1 h.",
            "Étaler, incorporer le beurre.",
            "Faire 2 tours simples avec sucre entre les tours.",
            "Découper en carrés, replier vers le centre.",
            "Placer dans moules individuels beurrés-sucrés.",
            "Pousse 1 h, cuire à 200°C 30 min."
        ]
    },
    {
        "title": "Pain aux céréales",
        "category": "Pains",
        "difficulty": "Facile",
        "time_minutes": 180,
        "hydration": 70,
        "image_url": "https://images.unsplash.com/photo-1586444248902-2f64eddc13df?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Pain rustique enrichi de graines de lin, tournesol et sésame.",
        "ingredients": [
            "400 g farine T80",
            "100 g farine complète",
            "350 g eau",
            "10 g sel",
            "5 g levure",
            "80 g mélange de graines"
        ],
        "steps": [
            "Torréfier légèrement les graines.",
            "Pétrir tous les ingrédients.",
            "Pointage 1 h 30 avec 2 rabats.",
            "Façonner en bâtard, banneton 1 h.",
            "Grigner, cuire à 240°C 30 min avec buée."
        ]
    },
    {
        "title": "Financier aux amandes",
        "category": "Pâtisseries",
        "difficulty": "Facile",
        "time_minutes": 40,
        "hydration": 0,
        "image_url": "https://images.unsplash.com/photo-1587736908084-45c30ea3d5db?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Petit gâteau moelleux à base de beurre noisette et poudre d'amandes.",
        "ingredients": [
            "150 g blancs d'œufs",
            "150 g sucre glace",
            "100 g poudre d'amandes",
            "50 g farine",
            "120 g beurre noisette"
        ],
        "steps": [
            "Réaliser un beurre noisette, refroidir.",
            "Mélanger sucre, amandes, farine.",
            "Ajouter les blancs sans monter.",
            "Incorporer le beurre noisette.",
            "Repos 1 h au froid.",
            "Cuire dans moules à financiers à 200°C 12 min."
        ]
    },
    {
        "title": "Pain viennois",
        "category": "Pains",
        "difficulty": "Intermédiaire",
        "time_minutes": 180,
        "hydration": 60,
        "image_url": "https://images.unsplash.com/photo-1509440159596-0249088772ff?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Pain moelleux au lait et sucre, croûte fine et dorée.",
        "ingredients": [
            "500 g farine T55",
            "250 g lait",
            "50 g beurre",
            "40 g sucre",
            "10 g sel",
            "15 g levure",
            "1 œuf pour dorure"
        ],
        "steps": [
            "Pétrir tous les ingrédients 10 min.",
            "Pointage 1 h.",
            "Façonner en petits pains ou navettes.",
            "Apprêt 1 h à 26°C.",
            "Dorer, grigner, cuire à 200°C 15 min."
        ]
    },
    {
        "title": "Madeleine à la vanille",
        "category": "Pâtisseries",
        "difficulty": "Facile",
        "time_minutes": 60,
        "hydration": 0,
        "image_url": "https://images.unsplash.com/photo-1596263576925-d24e05fef4c7?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Petit gâteau en forme de coquille, à la bosse caractéristique.",
        "ingredients": [
            "3 œufs",
            "130 g sucre",
            "150 g farine",
            "5 g levure chimique",
            "150 g beurre fondu",
            "1 gousse de vanille"
        ],
        "steps": [
            "Blanchir œufs et sucre.",
            "Ajouter farine et levure.",
            "Incorporer le beurre fondu et vanille.",
            "Repos 2 h au froid (choc thermique).",
            "Beurrer les moules, remplir aux 2/3.",
            "Cuire à 220°C 4 min puis 180°C 6 min."
        ]
    },
    {
        "title": "Cannelé bordelais",
        "category": "Pâtisseries",
        "difficulty": "Intermédiaire",
        "time_minutes": 120,
        "hydration": 0,
        "image_url": "https://images.unsplash.com/photo-1587202372775-e229f172b9d7?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Petit gâteau à la croûte caramélisée, cœur moelleux au rhum.",
        "ingredients": [
            "500 g lait",
            "50 g beurre",
            "1 gousse vanille",
            "250 g sucre",
            "100 g farine",
            "2 œufs + 2 jaunes",
            "50 g rhum"
        ],
        "steps": [
            "Faire bouillir lait, beurre, vanille.",
            "Mélanger sucre, farine, œufs.",
            "Verser le lait tiède sur le mélange.",
            "Ajouter le rhum, filtrer.",
            "Repos 24 h au frigo.",
            "Verser dans moules cirés à l'abeille.",
            "Cuire à 240°C 15 min puis 180°C 45 min."
        ]
    },
    {
        "title": "Ciabatta",
        "category": "Pains",
        "difficulty": "Intermédiaire",
        "time_minutes": 300,
        "hydration": 80,
        # "découper 2 pâtons" — écrit dans les étapes ci-dessous.
        "yield_pieces": 2,
        "image_url": "https://images.unsplash.com/photo-1586444248902-2f64eddc13df?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Pain italien à mie très alvéolée et croûte fine.",
        "ingredients": [
            "500 g farine T65",
            "400 g eau",
            "10 g sel",
            "3 g levure",
            "20 g huile d'olive"
        ],
        "steps": [
            "Mélanger sans pétrir (autolyse) 30 min.",
            "Ajouter levure, sel, huile.",
            "3 séries de rabats espacés de 30 min.",
            "Pointage total 3 h.",
            "Verser sur plan très fariné, découper 2 pâtons.",
            "Cuire à 250°C 20 min avec buée."
        ]
    },
    {
        "title": "Palmier",
        "category": "Viennoiseries",
        "difficulty": "Facile",
        "time_minutes": 45,
        "hydration": 0,
        "image_url": "https://images.unsplash.com/photo-1626804475297-41608ea09aeb?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Petit biscuit feuilleté et sucré en forme de cœur.",
        "ingredients": [
            "500 g pâte feuilletée",
            "150 g sucre cristal"
        ],
        "steps": [
            "Étaler la pâte en rectangle, saupoudrer généreusement.",
            "Plier les 2 côtés vers le centre.",
            "Replier une seconde fois puis refermer.",
            "Réserver 30 min au froid.",
            "Découper des tranches de 1 cm.",
            "Cuire à 200°C 10 min de chaque côté."
        ]
    },
    {
        "title": "Pain suédois",
        "category": "Pains",
        "difficulty": "Facile",
        "time_minutes": 120,
        "hydration": 60,
        "image_url": "https://images.unsplash.com/photo-1508737027454-e6454ef45afd?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Pain long et moelleux, parfait pour buffets et petits-fours.",
        "ingredients": [
            "500 g farine T55",
            "300 g lait",
            "50 g beurre",
            "10 g sel",
            "20 g sucre",
            "15 g levure"
        ],
        "steps": [
            "Pétrir tous les ingrédients 8 min.",
            "Pointage 45 min.",
            "Façonner en long boudin, aplatir.",
            "Apprêt 45 min.",
            "Cuire à 200°C 15 min sans dorer.",
            "Trancher finement pour buffet."
        ]
    },
    {
        "title": "Pretzel",
        "category": "Pains",
        "difficulty": "Intermédiaire",
        "time_minutes": 120,
        "hydration": 55,
        "image_url": "https://images.unsplash.com/photo-1579762593175-20226054cad0?crop=entropy&cs=srgb&fm=jpg&w=1200&q=85",
        "description": "Pain alsacien tressé, croûte brune caractéristique au bicarbonate.",
        "ingredients": [
            "500 g farine T55",
            "275 g eau",
            "10 g sel",
            "10 g levure",
            "30 g beurre",
            "Bain de bicarbonate",
            "Gros sel"
        ],
        "steps": [
            "Pétrir 8 min, pointage 1 h.",
            "Détailler en pâtons de 80 g, façonner en cordons.",
            "Former des bretzels, repos 20 min au froid.",
            "Plonger 30 sec dans eau + bicarbonate bouillante.",
            "Entailler, parsemer de gros sel.",
            "Cuire à 210°C 15 min."
        ]
    }
]

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


# The book's version wins on a title collision, and its sheet is the richer of
# the two: quantities, temperatures, timings and a source. Nothing is lost —
# the id is what carries the community data, and the id follows the title.
_FROM_BOOKS = {r["title"] for r in BOOK_RECIPES}
_JOINED = [r for r in BAKER_RECIPES if r["title"] not in _FROM_BOOKS] + BOOK_RECIPES

# La famille est apposée ici plutôt que recopiée dans chaque fiche : elle vient
# d'une table unique (`families.py`), et une recette du catalogue qui n'y
# figurerait pas retomberait dans un fourre-tout sans qu'on s'en aperçoive. On
# préfère refuser de démarrer.
_UNASSIGNED = sorted({r["title"] for r in _JOINED} - set(FAMILY_BY_TITLE))
if _UNASSIGNED:
    raise RuntimeError(
        "recettes sans famille dans families.py : " + ", ".join(_UNASSIGNED)
    )

RECIPES_SEED = [{**r, "family": family_of(r["title"], r["category"])} for r in _JOINED]

_BOOK_TIP_TITLES = {t["title"] for t in BOOK_TIPS}
TIPS_SEED = [t for t in BAKER_TIPS if t["title"] not in _BOOK_TIP_TITLES] + BOOK_TIPS


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
