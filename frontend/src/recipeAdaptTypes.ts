/**
 * Types partagés par l'écran d'adaptation — même forme que les modèles
 * Pydantic de backend/server.py (RecipeAdaptRequest, apply_adaptation()).
 */
export type AdaptSubstitution = {
  from_name: string;
  to_name: string;
  new_quantity?: number | null;
  new_unit?: string | null;
};

export type AdaptationRequest = {
  target_yield_pieces?: number | null;
  target_piece_weight_g?: number | null;
  target_total_weight_g?: number | null;
  target_hydration_pct?: number | null;
  flour_percentage_changes: Record<string, number>;
  ingredient_percentage_changes: Record<string, number>;
  substitutions: AdaptSubstitution[];
};

export type AdaptedIngredient = {
  index: number;
  raw: string;
  parsed: boolean;
  name?: string;
  quantity?: number;
  unit?: string;
  percentage?: number | null;
  is_flour?: boolean;
  is_water?: boolean;
  changed: boolean;
};

export type AdaptationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  ingredients?: AdaptedIngredient[];
  yield_pieces?: number | null;
  piece_weight_g?: number | null;
  total_weight_g?: number | null;
  hydration?: number;
};

export type FermentationSuggestion = {
  mentioned: boolean;
  requested_description?: string | null;
  suggested_technical?: Record<string, string | null>;
};

export function emptyAdaptationRequest(): AdaptationRequest {
  return {
    target_yield_pieces: null,
    target_piece_weight_g: null,
    target_total_weight_g: null,
    target_hydration_pct: null,
    flour_percentage_changes: {},
    ingredient_percentage_changes: {},
    substitutions: [],
  };
}

/** Une requête est "vide" quand aucun champ n'a été rempli — sert à savoir
 * si le bandeau "Modifications demandées" doit s'afficher. */
export function isAdaptationRequestEmpty(request: AdaptationRequest): boolean {
  return (
    !request.target_yield_pieces &&
    !request.target_piece_weight_g &&
    !request.target_total_weight_g &&
    request.target_hydration_pct == null &&
    Object.keys(request.flour_percentage_changes).length === 0 &&
    Object.keys(request.ingredient_percentage_changes).length === 0 &&
    request.substitutions.length === 0
  );
}
