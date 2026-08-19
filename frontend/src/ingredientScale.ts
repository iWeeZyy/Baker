/**
 * Le multiplicateur de quantité d'une fiche technique.
 *
 * Une ligne d'ingrédient est un texte libre écrit par un boulanger ou tiré
 * d'un livre : "500 g de farine T65", "45 à 50 g d'œuf", "3 œufs",
 * "Pour la garniture :", "Sel, poivre du moulin". Il n'y a pas de champ
 * quantité/unité séparé à multiplier — seulement ce texte.
 *
 * La règle est donc volontairement étroite, dans le même esprit que
 * `parse_ingredient` côté serveur (backend/production.py) : ne mettre à
 * l'échelle que le ou les nombres qui ouvrent la ligne, jamais un nombre
 * rencontré plus loin (l'appoint de 100 g d'un « 1 tablette de chocolat de
 * 100 g » reste 100 g quand on double le nombre de tablettes). Une ligne sans
 * nombre en tête — un intitulé de section, une garniture au jugé — n'est
 * jamais touchée : mieux vaut la recopier telle quelle que d'inventer une
 * quantité qu'elle ne porte pas.
 */

// Un nombre : entier ou décimal, virgule ou point (le seed écrit "1,25").
const NUM = String.raw`\d+(?:[.,]\d+)?`;
// La quantité en tête de ligne, éventuellement une plage ("45 à 50",
// "1 ou 2") : chaque nombre de la plage est mis à l'échelle, le connecteur
// reste intact.
const LEADING_QUANTITY = new RegExp(`^(\\s*)(${NUM}(?:\\s*(?:à|ou)\\s*${NUM})*)`, 'i');

function formatScaledNumber(n: number): string {
  // Trois décimales suffisent à ne jamais perdre 2,5 g × 0,5 = 1,25 g, et
  // absorbent le bruit de virgule flottante (0.1 × 3 ne doit pas devenir
  // "0,30000000000000004").
  const rounded = Math.round(n * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  const trimmed = rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return trimmed.replace('.', ',');
}

/** Multiplie la ou les quantités en tête d'une ligne d'ingrédient par `factor`. */
export function scaleIngredientLine(line: string, factor: number): string {
  if (!line) return line;
  const m = line.match(LEADING_QUANTITY);
  if (!m) return line; // pas de quantité en tête : on ne devine jamais.
  const [, leadingWs, run] = m;
  const scaledRun = run.replace(new RegExp(NUM, 'g'), (numStr) => {
    const value = parseFloat(numStr.replace(',', '.'));
    return formatScaledNumber(value * factor);
  });
  const rest = line.slice(m[0].length);
  return `${leadingWs}${scaledRun}${rest}`;
}

// ---------- L'état du sélecteur ----------
// Les boutons ne connaissent que les entiers de cette plage ; 0,5 n'existe
// que pour qui le tape.
export const QUANTITY_MIN = 1;
export const QUANTITY_MAX = 1000;
export const QUANTITY_HALF = 0.5;

/** Le pas "+" : toujours vers l'entier suivant, jamais vers 0,5. */
export function stepUp(current: number): number {
  return Math.min(QUANTITY_MAX, Math.floor(current) + 1);
}

/** Le pas "−" : toujours vers l'entier précédent, jamais vers 0,5. */
export function stepDown(current: number): number {
  return Math.max(QUANTITY_MIN, Math.ceil(current) - 1);
}

/**
 * Résout ce que l'utilisateur a tapé en une valeur valide.
 *
 * Toute valeur ≥ 1 est acceptée telle quelle (bornée à 1000) : rien
 * n'interdit un multiplicateur décimal au-dessus de 1. En dessous de 1, seule
 * 0,5 existe — une saisie intermédiaire (0,2 ; 0,8…) est ramenée au plus
 * proche des deux seules valeurs permises, jamais laissée telle quelle.
 * Une saisie illisible retombe sur 1, la recette d'origine.
 */
export function resolveManualQuantity(raw: string): number {
  const cleaned = (raw || '').trim().replace(',', '.');
  if (!cleaned) return QUANTITY_MIN;
  const value = parseFloat(cleaned);
  if (!Number.isFinite(value)) return QUANTITY_MIN;
  if (value >= QUANTITY_MIN) return Math.min(QUANTITY_MAX, value);
  if (value === QUANTITY_HALF) return QUANTITY_HALF;
  // Entre 0 (inclus, saisie négative comprise) et 1 : au plus proche de 0,5
  // ou 1, jamais une valeur intermédiaire non prévue.
  const clamped = Math.max(0, value);
  return clamped < 0.75 ? QUANTITY_HALF : QUANTITY_MIN;
}

/** Le texte affiché dans le champ pour une valeur résolue. */
export function formatMultiplierForInput(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
}
