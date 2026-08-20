"""La photo d'une recette : le produit lui-même, vérifié à l'œil.

Les 194 fiches importées n'ont pas de photographie : celles des ouvrages ne sont
pas reproduites — les données d'une recette se citent, une photographie se
reproduit. Restait à en trouver ailleurs.

Wikimedia Commons a été essayé, et écarté : c'est une archive documentaire, dont
la qualité culinaire n'est pas au niveau du reste de l'application. **Pexels**
est une banque de photographies, et l'objection n'y tient plus.

Trois règles, dans cet ordre :

  - **Le produit d'abord.** Une photo n'est jamais retenue parce que son titre
    ressemble à celui de la recette. Elle est *regardée*. Cette table est le
    produit d'une relecture visuelle, pas d'une correspondance de mots-clés :
    une recherche « croissant » rend un oranais, une recherche « bretzel » un
    sandwich de chaîne sur un plateau. Aucun filtre textuel n'attrape ces
    deux-là. Le champ `vu` consigne, en français, ce qui a réellement été vu sur
    l'image ; sans lui, l'entrée est refusée par `tests/test_recipe_photos.py`.

  - **Rien plutôt qu'à peu près.** Une recette dont le produit n'a pas de photo
    juste n'en reçoit aucune et garde son dessin d'archétype (`products.py`),
    puis la bande unie. C'est pourquoi cette table ne couvre pas tout le
    catalogue, et c'est délibéré. Une photo d'entremets au chocolat sur un
    « Écrin feuilleté aux noisettes » serait pire que pas de photo du tout.

  - **La table est la seule source.** Comme `families.py` et `products.py`, elle
    vit ici et nulle part ailleurs. `seed_data.py` l'appose au démarrage, et le
    seed étant autoritaire, retirer une entrée retire la photo de la base au
    déploiement suivant.

Licence et crédit
-----------------
Toutes les photos viennent de Pexels, sous **Pexels License** : usage commercial
autorisé, sans redevance. Les *API Guidelines* de Pexels vont plus loin que la
licence et demandent, dès lors qu'on passe par l'API, de créditer le photographe
avec un lien vers son profil et de renvoyer vers Pexels. C'est ce que rend
`image_credit` sur la fiche recette. Une entrée sans auteur ni page source est
donc refusée par les tests : on ne peut pas créditer ce qu'on n'a pas noté.

Hébergement
-----------
`url` pointe sur le CDN Pexels, qui autorise le lien direct. Rien n'est recopié
dans le dépôt — 194 photos y ajouteraient une trentaine de mégaoctets pour rien —
et `expo-image`, déjà utilisé partout, met en cache côté appareil. La recherche
n'a lieu qu'une fois, à la moisson : l'application ne parle jamais à Pexels.
"""
from typing import Optional

SOURCE_PEXELS = "pexels"
LICENCE_PEXELS = "Pexels License"

# Le score en dessous duquel une association n'est pas retenue. Il n'est pas
# décoratif : le tableau de notation donne 40 points, tout ou rien, au seul fait
# que la photo montre le bon produit. Un mauvais produit met donc le total à 0,
# et aucune qualité photographique ne peut le remonter au-dessus du seuil.
MIN_SCORE = 75

# Les clés qu'une entrée doit porter. `vu` est la plus importante : c'est la
# trace de la vérification visuelle, et sa présence est ce qui distingue cette
# table d'une liste de mots-clés.
REQUIRED_KEYS = {"url", "page", "author", "author_url", "source", "licence", "score", "vu"}

# ---------------------------------------------------------------------------
# La table. Une entrée par recette, clé = le titre exact du catalogue.
#
# Elle est **vide tant que la moisson n'a pas eu lieu** : les hôtes de Pexels
# (api.pexels.com, images.pexels.com) sont refusés par la politique réseau de
# cet environnement, et aucune clé d'API n'est disponible. Écrire ici des URL de
# mémoire produirait exactement ce que le projet a déjà refusé une fois — des
# liens morts, qui valent moins que l'image de repli. Les recettes gardent donc
# leur dessin d'archétype jusqu'à la moisson.
#
# Format d'une entrée :
#
#     "Croissants": {
#         "url": "https://images.pexels.com/photos/…?auto=compress&w=1200",
#         "page": "https://www.pexels.com/photo/…",
#         "author": "Prénom Nom",
#         "author_url": "https://www.pexels.com/@…",
#         "source": SOURCE_PEXELS,
#         "licence": LICENCE_PEXELS,
#         "score": 95,
#         "vu": "croissant feuilleté entier, fond sobre, lumière franche",
#     },
# ---------------------------------------------------------------------------
PHOTOS: dict = {}


def photo_of(title: str) -> Optional[dict]:
    """La photo d'une recette, ou None quand aucune ne montre le bon produit.

    None n'est pas un oubli : c'est le cas d'un produit qu'aucune photo de la
    banque ne rend honnêtement — une création propre à un ouvrage, une
    spécialité peu photographiée, ou deux produits voisins qu'une photo ne
    sépare pas. La fiche garde alors son dessin d'archétype, ce que l'écran
    gère déjà.
    """
    return PHOTOS.get(title)


def credit_of(title: str) -> Optional[dict]:
    """Le crédit à afficher sous la photo, ou None s'il n'y a pas de photo.

    Réduit à ce que la fiche rend : le nom du photographe, son profil, la page
    de la photo et le nom de la licence. Le score et la note de relecture
    restent dans la table — ils servent à la maintenir, pas à l'afficher.
    """
    p = PHOTOS.get(title)
    if not p:
        return None
    return {
        "author": p["author"],
        "author_url": p["author_url"],
        "page": p["page"],
        "source": p["source"],
        "licence": p["licence"],
    }
