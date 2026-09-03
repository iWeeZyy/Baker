/**
 * Moteur de recherche de recettes — pur, sans React ni réseau, testable
 * indépendamment de l'écran qui l'utilise (même famille que
 * `production.py`/`costCalc.ts` côté « logique pure »).
 *
 * Reprend l'algorithme déjà établi par `tips/tipsSearch.ts` (normalisation
 * accents/casse, découpage en mots, correspondance ET entre mots — un mot de
 * la requête doit se retrouver quelque part pour que la recette compte) et
 * l'étend d'un simple booléen à un score de pertinence par champ, plus une
 * tolérance aux fautes de frappe en dernier recours. Aucune donnée n'est
 * inventée : les champs interrogés sont exactement ceux que `GET /recipes`
 * renvoie déjà (voir `backend/server.py`, classe `Recipe`) — il n'existe pas
 * de champ `tags`, donc aucun n'est simulé ici.
 */
import { normalize } from '@/src/textNormalize';

export type RecipeSearchable = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  familyLabel?: string | null;
  ingredients?: string[] | null;
  technical?: Record<string, any> | null;
  author_name?: string | null;
  is_user_submitted?: boolean;
  like_count?: number;
};

type FieldHaystacks = {
  titleNorm: string;
  titleTokens: string[];
  descriptionNorm: string;
  categoryFamilyNorm: string;
  categoryFamilyTokens: string[];
  ingredientsNorm: string;
  ingredientTokens: string[];
  technicalNorm: string;
  authorNorm: string;
};

function tokensOf(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}

function haystackFieldsOf(recipe: RecipeSearchable): FieldHaystacks {
  const titleNorm = normalize(recipe.title || '');
  const categoryFamilyNorm = normalize([recipe.category || '', recipe.familyLabel || ''].join(' '));
  const ingredientsNorm = normalize((recipe.ingredients || []).join(' '));
  const technicalValues = recipe.technical
    ? Object.values(recipe.technical).filter(v => typeof v === 'string' || typeof v === 'number').map(String)
    : [];
  return {
    titleNorm,
    titleTokens: tokensOf(titleNorm),
    descriptionNorm: normalize(recipe.description || ''),
    categoryFamilyNorm,
    categoryFamilyTokens: tokensOf(categoryFamilyNorm),
    ingredientsNorm,
    ingredientTokens: tokensOf(ingredientsNorm),
    technicalNorm: normalize(technicalValues.join(' ')),
    authorNorm: recipe.is_user_submitted ? normalize(recipe.author_name || '') : '',
  };
}

/** Distance de Levenshtein classique (édition simple), pure, sans dépendance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Tolérance : un mot court accepte 1 faute, un mot de 5 lettres ou plus jusqu'à 2. */
function maxTypoDistance(word: string): number {
  return word.length <= 4 ? 1 : 2;
}

/** La plus petite distance de `word` à l'un des `tokens`, ou Infinity si aucun. */
function closestTokenDistance(word: string, tokens: string[]): number {
  let best = Infinity;
  for (const t of tokens) {
    const d = levenshtein(word, t);
    if (d < best) best = d;
  }
  return best;
}

// Barème de pertinence : une correspondance exacte prime toujours sur une
// correspondance approximative, dans l'ordre demandé par le cahier des
// charges (nom exact > nom fort > ingrédients > catégorie/famille >
// description/infos techniques > approximatif > auteur).
const SCORE_EXACT_TITLE = 1000;
const SCORE_TITLE_WORD = 200;
const SCORE_TITLE_SUBSTRING = 120;
const SCORE_INGREDIENT = 70;
const SCORE_CATEGORY_FAMILY = 50;
const SCORE_DESCRIPTION_TECHNICAL = 30;
const SCORE_AUTHOR = 20;
const SCORE_FUZZY = 15;

/**
 * Score d'un seul mot de requête sur une recette, ou 0 s'il n'y correspond
 * nulle part (auquel cas, en logique ET, la recette entière est exclue).
 * La tolérance aux fautes n'intervient qu'en dernier recours, quand aucune
 * correspondance exacte/partielle n'a été trouvée pour ce mot.
 */
function scoreWord(word: string, fields: FieldHaystacks): number {
  if (fields.titleTokens.includes(word)) return SCORE_TITLE_WORD;
  if (fields.titleNorm.includes(word)) return SCORE_TITLE_SUBSTRING;
  if (fields.ingredientsNorm.includes(word)) return SCORE_INGREDIENT;
  if (fields.categoryFamilyNorm.includes(word)) return SCORE_CATEGORY_FAMILY;
  if (fields.descriptionNorm.includes(word) || fields.technicalNorm.includes(word)) return SCORE_DESCRIPTION_TECHNICAL;
  if (fields.authorNorm && fields.authorNorm.includes(word)) return SCORE_AUTHOR;

  if (word.length >= 3) {
    const maxDist = maxTypoDistance(word);
    const candidateTokens = [...fields.titleTokens, ...fields.categoryFamilyTokens, ...fields.ingredientTokens];
    if (closestTokenDistance(word, candidateTokens) <= maxDist) return SCORE_FUZZY;
  }
  return 0;
}

export type ScoredRecipe<T extends RecipeSearchable> = { recipe: T; score: number };

/**
 * Recherche + classement. Chaque mot de la requête (normalisé, ≥2 lettres)
 * doit obtenir un score non nul quelque part pour que la recette soit
 * retenue (ET logique entre mots) ; le score total additionne le meilleur
 * score par mot, avec un gros bonus si le titre correspond exactement à la
 * requête entière — pour qu'une correspondance exacte batte toujours une
 * somme de correspondances partielles sur plusieurs mots.
 *
 * Le classement final trie par score décroissant, `like_count` en
 * départage — pas de notion de « popularité » inventée, c'est le champ déjà
 * calculé par `enrich_recipes` côté backend.
 */
export function searchRecipes<T extends RecipeSearchable>(recipes: T[], query: string): T[] {
  const q = normalize(query);
  if (!q) return [];
  const words = q.split(' ').filter(w => w.length >= 2);
  if (words.length === 0) return [];

  const scored: ScoredRecipe<T>[] = [];
  for (const recipe of recipes) {
    const fields = haystackFieldsOf(recipe);
    let total = 0;
    let matchedAll = true;
    for (const word of words) {
      const s = scoreWord(word, fields);
      if (s === 0) { matchedAll = false; break; }
      total += s;
    }
    if (!matchedAll) continue;
    if (fields.titleNorm === q) total += SCORE_EXACT_TITLE;
    scored.push({ recipe, score: total });
  }

  scored.sort((a, b) => b.score - a.score || (b.recipe.like_count ?? 0) - (a.recipe.like_count ?? 0));
  return scored.map(s => s.recipe);
}

/**
 * Suggestions « vouliez-vous dire… » / auto-complétion : les titres du
 * catalogue déjà chargé les plus proches du terme tapé, par distance de
 * Levenshtein — jamais une invention, uniquement des titres réels.
 */
export function suggestTerms<T extends RecipeSearchable>(query: string, recipes: T[], limit = 3): string[] {
  const q = normalize(query);
  if (!q || q.length < 3) return [];
  const maxDist = maxTypoDistance(q);
  const candidates = recipes
    .map(r => ({ title: r.title, dist: levenshtein(q, normalize(r.title)) }))
    .filter(c => c.dist > 0 && c.dist <= maxDist)
    .sort((a, b) => a.dist - b.dist);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (seen.has(c.title)) continue;
    seen.add(c.title);
    out.push(c.title);
    if (out.length >= limit) break;
  }
  return out;
}
