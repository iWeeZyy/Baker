/**
 * Types partagés par les écrans "extraction assistée par IA → vérification
 * → POST /recipes" : `scan.tsx` (photo d'une fiche papier) et
 * `instagram-import.tsx` (légende Instagram collée). Les deux backends
 * (`/recipes/scan/analyze`, `/recipes/instagram-import/analyze`) renvoient
 * la même forme — confiance "high"/"low"/"absent" par champ, jamais une
 * valeur inventée — donc un seul jeu de types côté client.
 */

export type Confidence = 'high' | 'low' | 'absent';
export type ConfidenceValue<T> = { value: T | null; confidence: Confidence };

export type ExtractedIngredient = {
  name: string;
  quantity: number | null;
  unit: string | null;
  confidence: 'high' | 'low';
};
export type ExtractedStep = { text: string; confidence: 'high' | 'low' };

export type RecipeExtraction = {
  title: ConfidenceValue<string>;
  category: ConfidenceValue<string>;
  yield_pieces: ConfidenceValue<number>;
  description: ConfidenceValue<string>;
  ingredients: ExtractedIngredient[];
  steps: ExtractedStep[];
  technical: Record<string, ConfidenceValue<string>>;
  bakers_percentages: Record<string, number> | null;
  hydration: number;
};

export type IngredientRow = { id: string; name: string; quantity: string; unit: string; confidence?: Confidence };
export type StepRow = { id: string; text: string; confidence?: Confidence };

// Les clés de fabrication qu'un écran de recette sait déjà afficher
// (TECHNICAL_ROWS dans app/recipe/[id].tsx) — doit rester synchronisée avec
// SCAN_TECHNICAL_KEYS côté backend (backend/server.py), un seul point de
// vérité de chaque côté.
export const TECHNICAL_FIELDS: [string, string][] = [
  ['dough_temp', 'Température de pâte'],
  ['room_temp', 'Température labo'],
  ['petrissage', 'Pétrissage'],
  ['pointage', 'Pointage'],
  ['appret', 'Apprêt'],
  ['fermentation', 'Fermentation'],
  ['cuisson', 'Cuisson'],
  ['oven', 'Four'],
  ['levure', 'Levure'],
  ['observations', 'Observations'],
  ['conseils', 'Conseils'],
];
