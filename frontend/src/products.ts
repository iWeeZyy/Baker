import type { ImageSourcePropType } from 'react-native';

/**
 * L'illustration d'une recette : la forme, pas le produit.
 *
 * Les fiches importées n'ont pas de photo, et il n'y en aura pas : les
 * photographies des ouvrages ne sont pas reprises, et les banques d'images
 * libres de droits n'ont pas la qualité du reste de l'application. On dessine
 * donc, comme les vignettes de famille l'étaient déjà.
 *
 * Un dessin se lit comme un **emblème** et non comme la photo de cette pièce
 * précise, ce qui rend la répétition acceptable là où une photo mentirait :
 * dix-neuf tartes partageant le même dessin disent « une tarte » ; dix-neuf
 * fois la même photo diraient « voici cette tarte-là ».
 *
 * Les clés viennent de `backend/products.py`, seule source de la table. Le
 * `Record` typé sur l'union fait échouer `tsc` si un archétype arrive sans
 * image — mieux vaut un build rouge qu'une case vide à l'écran.
 *
 * Seize archétypes réutilisent une vignette de famille déjà dessinée et juste,
 * six ont été dessinées pour les produits. Il n'y en a pas plus parce qu'un
 * dessin qui ne se lit pas a été jeté plutôt que livré ; les recettes
 * concernées gardent l'absence d'image, que la fiche gère déjà.
 */
export type ProductKey =
  | 'baguette'
  | 'boule'
  | 'bretzel'
  | 'couronne'
  | 'pain-plat'
  | 'pain-moule'
  | 'croissant'
  | 'chausson'
  | 'beignet'
  | 'brioche-tete'
  | 'tarte'
  | 'cake'
  | 'gateau'
  | 'carre'
  | 'biscuit'
  | 'petit-four'
  | 'muffin'
  | 'levain'
  | 'creme'
  | 'pate-a-tarte'
  | 'pate-feuilletee'
  | 'sandwich';

export const PRODUCT_TILES: Record<ProductKey, ImageSourcePropType> = {
  // Dessinées pour les produits.
  'bretzel': require('../assets/images/products/bretzel.png'),
  'couronne': require('../assets/images/products/couronne.png'),
  'pain-plat': require('../assets/images/products/pain-plat.png'),
  'pain-moule': require('../assets/images/products/pain-moule.png'),
  'chausson': require('../assets/images/products/chausson.png'),
  'beignet': require('../assets/images/products/beignet.png'),
  // Reprises des familles : la vignette y montre déjà exactement cette forme,
  // et la redessiner donnerait deux dessins du même objet à maintenir.
  'baguette': require('../assets/images/families/pains-classiques.png'),
  'boule': require('../assets/images/families/pains-speciaux.png'),
  'croissant': require('../assets/images/families/feuilletees.png'),
  'brioche-tete': require('../assets/images/families/brioches.png'),
  'tarte': require('../assets/images/families/tartes.png'),
  'cake': require('../assets/images/families/cakes.png'),
  'gateau': require('../assets/images/families/gateaux.png'),
  'carre': require('../assets/images/families/carres.png'),
  'biscuit': require('../assets/images/families/biscuits.png'),
  'petit-four': require('../assets/images/families/petites-patisseries.png'),
  'muffin': require('../assets/images/families/muffins-scones.png'),
  'levain': require('../assets/images/families/levains.png'),
  'creme': require('../assets/images/families/garnitures.png'),
  'pate-a-tarte': require('../assets/images/families/pates-a-tarte.png'),
  'pate-feuilletee': require('../assets/images/families/pates-tourees.png'),
  'sandwich': require('../assets/images/families/snacking.png'),
};

/**
 * L'illustration d'une recette, ou `null` quand elle n'en a pas.
 *
 * `null` n'est pas un oubli : c'est une forme qu'aucun dessin de la
 * bibliothèque ne rend honnêtement — un kouglof, une tresse, un palmier. La
 * fiche reste alors sans image, plutôt que de montrer autre chose. Une clé
 * inconnue tombe dans le même cas : mieux vaut rien qu'un dessin au hasard.
 */
export function productTile(key?: string | null): ImageSourcePropType | null {
  if (!key) return null;
  return PRODUCT_TILES[key as ProductKey] ?? null;
}
