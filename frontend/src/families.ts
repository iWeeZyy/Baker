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
 * `scripts/build-family-tiles.mjs`.
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
  | 'autres-viennoiseries'
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
  'pains-classiques': require('../assets/images/families/pains-classiques.png'),
  'pains-speciaux': require('../assets/images/families/pains-speciaux.png'),
  'levains': require('../assets/images/families/levains.png'),
  'snacking': require('../assets/images/families/snacking.png'),
  'feuilletees': require('../assets/images/families/feuilletees.png'),
  'brioches': require('../assets/images/families/brioches.png'),
  'pates-tourees': require('../assets/images/families/pates-tourees.png'),
  'tartes': require('../assets/images/families/tartes.png'),
  'pates-a-tarte': require('../assets/images/families/pates-a-tarte.png'),
  'gateaux': require('../assets/images/families/gateaux.png'),
  'cakes': require('../assets/images/families/cakes.png'),
  'biscuits': require('../assets/images/families/biscuits.png'),
  'carres': require('../assets/images/families/carres.png'),
  'petites-patisseries': require('../assets/images/families/petites-patisseries.png'),
  'muffins-scones': require('../assets/images/families/muffins-scones.png'),
  'garnitures': require('../assets/images/families/garnitures.png'),
  // Les trois fourre-tout partagent l'épi de blé : ils n'ont pas de forme
  // propre, puisqu'ils recueillent ce qui n'a pas de famille.
  'autres-pains': AUTRES,
  'autres-viennoiseries': AUTRES,
  'autres-patisseries': AUTRES,
};

/** La vignette d'une famille, l'épi neutre pour une clé qu'on ne connaît pas. */
export function familyTile(key: string): ImageSourcePropType {
  return FAMILY_TILES[key as FamilyKey] ?? AUTRES;
}
