import type { ImageSourcePropType } from 'react-native';

/**
 * Les vignettes de famille.
 *
 * Les clés sont celles de `backend/families.py`, qui reste la source de vérité :
 * l'API renvoie la liste, ses libellés et ses comptes ; ce fichier ne fournit
 * que l'image. Le `Record` typé sur l'union fait échouer `tsc` si une famille
 * arrive sans vignette — mieux vaut un build rouge qu'une case vide à l'écran.
 *
 * Les images sont des PNG et non des SVG : `react-native-svg` n'est pas dans le
 * projet, et `require` doit être statique pour que Metro embarque le fichier.
 * Les sources SVG vivent à côté des PNG, régénérables par
 * `scripts/build-tiles.mjs`.
 */
export type FamilyKey =
  | 'pains-classiques'
  | 'pains-speciaux'
  | 'levains'
  | 'snacking'
  | 'feuilletees'
  | 'brioches'
  | 'pates-tourees'
  | 'tartes'
  | 'pates-a-tarte'
  | 'gateaux'
  | 'cakes'
  | 'biscuits'
  | 'carres'
  | 'petites-patisseries'
  | 'muffins-scones'
  | 'garnitures'
  | 'autres-pains'
  | 'autres-levains'
  | 'autres-snacking'
  | 'autres-viennoiseries'
  | 'autres-brioches'
  | 'autres-patisseries';

export type Family = {
  key: FamilyKey;
  label: string;
  category: string;
  count: number;
  /** Vrai pour les trois familles fourre-tout : on ne les propose pas au choix. */
  catch_all?: boolean;
};

const AUTRES = require('../assets/images/families/autres.png');

export const FAMILY_TILES: Record<FamilyKey, ImageSourcePropType> = {
  // Exceptions assumées : ces familles sont illustrées par une vraie photo
  // plutôt qu'un dessin, à la demande explicite de Lucas — voir la note
  // dans CLAUDE.md (section « Recipe families »). Les .svg/.png d'origine
  // restent en place, inutilisés, comme filet de secours.
  'pains-classiques': require('../assets/images/families/pains-classiques-photo.jpg'),
  'pains-speciaux': require('../assets/images/families/pains-speciaux-photo.jpg'),
  'levains': require('../assets/images/families/levains-photo.jpg'),
  'snacking': require('../assets/images/families/snacking-photo.jpg'),
  'feuilletees': require('../assets/images/families/feuilletees-photo.jpg'),
  'brioches': require('../assets/images/families/brioches-photo.jpg'),
  'pates-tourees': require('../assets/images/families/pates-tourees-photo.jpg'),
  'tartes': require('../assets/images/families/tartes-photo.jpg'),
  'pates-a-tarte': require('../assets/images/families/pates-a-tarte-photo.jpg'),
  'gateaux': require('../assets/images/families/gateaux.png'),
  'cakes': require('../assets/images/families/cakes.png'),
  'biscuits': require('../assets/images/families/biscuits.png'),
  'carres': require('../assets/images/families/carres.png'),
  'petites-patisseries': require('../assets/images/families/petites-patisseries.png'),
  'muffins-scones': require('../assets/images/families/muffins-scones.png'),
  'garnitures': require('../assets/images/families/garnitures.png'),
  // Les fourre-tout partagent l'épi de blé : ils n'ont pas de forme propre,
  // puisqu'ils recueillent ce qui n'a pas de famille. Il y en a un par
  // catégorie, donc six.
  'autres-pains': AUTRES,
  'autres-levains': AUTRES,
  'autres-snacking': AUTRES,
  'autres-viennoiseries': AUTRES,
  'autres-brioches': AUTRES,
  'autres-patisseries': AUTRES,
};

/** La vignette d'une famille, l'épi neutre pour une clé qu'on ne connaît pas. */
export function familyTile(key: string): ImageSourcePropType {
  return FAMILY_TILES[key as FamilyKey] ?? AUTRES;
}
