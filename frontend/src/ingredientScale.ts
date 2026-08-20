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

// ---------- Le rendement ----------
// Une ligne « Rendement » est, elle aussi, du texte libre recopié du livre :
// « 8 mauricettes de 105 g », « 1 couronne, pour 6 personnes », « 500 g de
// béchamel », « de 8 à 10 portions ». Elle doit suivre le multiplicateur,
// sans quoi la fiche se contredit — les ingrédients triplent et le rendement
// annonce toujours huit pièces.
//
// La règle reste celle des ingrédients : on ne met à l'échelle que ce qu'on
// sait lire. Le nombre de pièces se multiplie ; le poids d'**une** pièce, un
// diamètre, une plage de poids à la pièce ne bougent pas. C'est aussi pour ça
// que seul le rendement est mis à l'échelle dans la fiche technique : un
// pointage de 15 minutes reste 15 minutes qu'on fasse huit pièces ou
// vingt-quatre, et un four reste à 250 °C.

// Ce qui clôt le groupe nominal de tête : au-delà, on décrit un poids, des
// portions ou une remarque, qui ne s'accordent pas avec le nombre de pièces.
const HEAD_END = /\s+de\s|\s+pour\s|\s+ou\s|,|\(/;

/** Accorde au pluriel « grosse brioche » -> « grosses brioches ». */
function pluralizeHead(rest: string): string {
  const cut = rest.search(HEAD_END);
  const head = cut === -1 ? rest : rest.slice(0, cut);
  const tail = cut === -1 ? '' : rest.slice(cut);
  const plural = head
    .split(/(\s+)/)
    .map((w) => (/\s/.test(w) || /[sxz]$/i.test(w) || !w ? w : `${w}s`))
    .join('');
  return plural + tail;
}

/** Ramène au singulier quand la mise à l'échelle retombe sur une seule pièce. */
function singularizeHead(rest: string): string {
  const cut = rest.search(HEAD_END);
  const head = cut === -1 ? rest : rest.slice(0, cut);
  const tail = cut === -1 ? '' : rest.slice(cut);
  return head.replace(/([sx])(?=\s|$)/g, '') + tail;
}

/** « pour 1 personnes » -> « pour 1 personne ». */
function agreeSingular(text: string): string {
  return text.replace(/\b1(\s+)(personne|portion)s\b/gi, '1$1$2');
}

function scaleAll(text: string, pattern: RegExp, factor: number): string {
  return text.replace(pattern, (whole) =>
    whole.replace(new RegExp(NUM, 'g'), (n) =>
      formatScaledNumber(parseFloat(n.replace(',', '.')) * factor)),
  );
}

/**
 * Ce qui, dans la queue d'un rendement, décrit le total et suit donc le
 * multiplicateur : « ou 8 muffins rectangulaires », « , pour 6 à 8 personnes »,
 * « (de 8 à 10 portions) ».
 *
 * Volontairement absent : « de 8 portions chacun », que « chacun » désigne
 * comme un compte par pièce, et « de 280 g » / « de 25 à 30 cm », qui sont un
 * poids et un diamètre à la pièce.
 */
const TAIL_TOTALS = [
  new RegExp(`\\bou\\s+${NUM}\\b`, 'gi'),
  new RegExp(`,\\s*pour\\s+${NUM}(?:\\s*à\\s*${NUM})?\\s+personnes?`, 'gi'),
  new RegExp(`\\((?:de\\s+)?${NUM}\\s*à\\s*${NUM}\\s+(?:portions?|personnes?)\\)`, 'gi'),
];

/**
 * Multiplie le rendement d'une fiche technique par `factor`.
 *
 * Renvoie le libellé inchangé quand il n'entre dans aucune forme connue :
 * comme partout ailleurs, on préfère ne rien toucher plutôt qu'annoncer un
 * rendement qu'on aurait deviné.
 */
export function scaleYieldLabel(label: string, factor: number): string {
  if (!label || factor === 1) return label;
  const text = label.trim();

  // « 500 g de béchamel », « 190 g de levain » : ici la masse *est* le
  // rendement, elle se multiplie. (Ailleurs, un « de 105 g » est le poids
  // d'une pièce et ne bouge pas.)
  // `(?!\p{L})` et non `\b` : `\b` ne connaît que l'ASCII, et « 2 gâteaux »
  // se lisait alors comme « 2 g » suivi de « âteaux ».
  const mass = text.match(new RegExp(`^(${NUM})(\\s*)(g|kg|ml|cl|l)(?!\\p{L})(.*)$`, 'iu'));
  if (mass) {
    const [, n, ws, unit, rest] = mass;
    return `${formatScaledNumber(parseFloat(n.replace(',', '.')) * factor)}${ws}${unit}${rest}`;
  }

  // « de 8 à 10 portions », « Pour 6 personnes » : pas de pièces, seulement
  // un nombre de parts, qui suit le multiplicateur.
  if (/^(de\s+\d|pour\s+\d)/i.test(text)) {
    return agreeSingular(scaleAll(text, new RegExp(`${NUM}(?:\\s*à\\s*${NUM})?`, 'g'), factor));
  }

  // « 8 mauricettes de 105 g », « environ 20 gressins », « Un pâton de 600 g ».
  const counted = text.match(new RegExp(`^(environ\\s+|)(${NUM}|Une?)\\s+(\\S.*)$`, 'i'));
  if (!counted) return label;
  const [, prefix, rawCount, body] = counted;
  const count = /^une?$/i.test(rawCount) ? 1 : parseFloat(rawCount.replace(',', '.'));
  const scaled = count * factor;
  let rest = body;
  if (scaled > 1 && count <= 1) rest = pluralizeHead(rest);
  if (scaled === 1 && count > 1) rest = singularizeHead(rest);
  for (const pattern of TAIL_TOTALS) rest = scaleAll(rest, pattern, factor);
  return agreeSingular(`${prefix}${formatScaledNumber(scaled)} ${rest}`);
}

// ---------- Les étapes ----------
// Une étape est de la prose, et l'immense majorité de ses nombres ne doit
// surtout pas bouger : « fraser 3 min », « sans dépasser 24 °C », « abaisser à
// 4 mm », « donner 4 tours ». Sur les 1946 étapes du catalogue, un seul nombre
// suit vraiment le multiplicateur : **le nombre de pièces qu'on tire de la
// pâte**. Un mauvais nombre dans une étape est la faute la plus grave possible
// pour un outil de fournil — bien pire qu'un nombre resté en place.
//
// La règle ne multiplie donc qu'un compte de pièces gouverné par un verbe de
// division, et quatre garde-fous l'entourent. Aucun n'est théorique : chacun
// vient d'une étape réelle du catalogue qu'une règle plus large aurait faussée.

const DIVISION_VERB = /\b(?:divis|s[ée]par|d[ée]taill|dress|fa[çc]onn|coup|partag|pes)[a-zéèê]*\b/i;
const PIECE_NOUN = String.raw`p[âa]tons?|boules?|disques?|tron[çc]ons?|bandes?|cercles?|carr[ée]s?|rectangles?|galettes?|demi-baguettes?|b[âa]tards?|boudins?|parts?|pi[èe]ces?`;
// Les unités qu'un nombre peut porter. Elles servent au garde-fou des nombres
// coordonnés : « et 3 mm d'épaisseur » est une cote, pas un second compte.
const UNIT = String.raw`g|kg|mg|mm|cm|m|ml|cl|l|min|h|s|°C|%|jours?|heures?|semaines?|tours?|fois`;

const PIECE_COUNT = new RegExp(`(${NUM})(\\s+)(${PIECE_NOUN})\\b`, 'gi');
/** Une cote de la pâte entière : « un rectangle de 60 × 18 cm ». */
const WHOLE_DOUGH_SIZE = /\d\s*[×x]\s*\d/;
/**
 * Un nombre coordonné au compte qui n'est ni une pièce ni une mesure :
 * « 6 pâtons de 30 g **et 6 de 15 g** », « 4 pâtons **: deux** resteront nature ».
 */
const COORDINATED_NUMBER = new RegExp(
  `(?:\\bet\\b|:)\\s+(?:une?|deux|trois|quatre|${NUM})\\s+`
  + `(?!(?:${PIECE_NOUN})\\b)(?!(?:${UNIT})\\b)`, 'i');

/** Découpe une étape en phrases, en gardant la position de chacune. */
function sentences(step: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  const re = /[^.;]+[.;]?/g;
  for (let m = re.exec(step); m; m = re.exec(step)) out.push({ text: m[0], at: m.index });
  return out;
}

/**
 * Multiplie le nombre de pièces d'une étape, et lui seul.
 *
 * Renvoie l'étape inchangée dans les quatre cas où le compte ne se multiplie
 * pas — chacun tiré d'une étape du catalogue :
 *
 *   1. « chaque » : le compte est **par pièce**. « Détailler 3 bandes … dans
 *      chaque rectangle » (cruffin) reste 3, sans quoi le cruffin en aurait neuf.
 *   2. Un nombre coordonné sans unité ni nom de pièce : « 6 pâtons de 30 g
 *      **et 6** de 15 g » (petite brioche à tête), « 4 pâtons **: deux**
 *      resteront nature » (écrin feuilleté). Multiplier le premier en laissant
 *      le second casserait l'accord de l'étape avec elle-même.
 *   3. Le verbe de division doit **précéder** le compte, dans la même phrase.
 *      « Rassembler les 5 boules en couronne, façonner… » (grosse brioche à
 *      tête) rappelle l'étape précédente : le verbe y suit le compte au lieu de
 *      le gouverner.
 *   4. Une cote de la pâte entière énoncée **avant** le compte : « un rectangle
 *      de 42 × 30 cm. … couper en 4 rectangles » (croissants). Le compte y
 *      découle de la cote, et on ne sait pas de combien la cote grandit —
 *      tripler les rectangles sans toucher à l'abaisse donnerait une étape
 *      irréalisable. Après le compte, la cote est celle d'une pièce et ne gêne
 *      pas : « 9 pâtons de 100 g … rectangles de 10 × 4 cm » se multiplie bien.
 *
 * La portée des deux dernières règles diffère volontairement : le verbe se
 * cherche dans **la phrase** (sinon un verbe placé plus loin gouvernerait un
 * rappel), la cote dans **l'étape entière** (sinon une abaisse énoncée à la
 * phrase précédente serait ignorée).
 */
export function scaleStepLine(step: string, factor: number): string {
  if (!step || factor === 1) return step;
  if (/\bchaque\b/i.test(step)) return step;
  if (COORDINATED_NUMBER.test(step)) return step;

  const sizeAt = step.search(WHOLE_DOUGH_SIZE);
  const out: string[] = [];
  let cursor = 0;

  for (const { text, at } of sentences(step)) {
    const verb = text.match(DIVISION_VERB);
    if (!verb || verb.index === undefined) continue;
    const verbEnd = verb.index + verb[0].length;

    PIECE_COUNT.lastIndex = 0;
    for (let m = PIECE_COUNT.exec(text); m; m = PIECE_COUNT.exec(text)) {
      const start = at + m.index;
      if (m.index < verbEnd) continue;
      if (sizeAt !== -1 && sizeAt < start) continue;
      out.push(step.slice(cursor, start));
      const count = parseFloat(m[1].replace(',', '.')) * factor;
      out.push(`${formatScaledNumber(count)}${m[2]}${m[3]}`);
      cursor = start + m[0].length;
    }
  }
  out.push(step.slice(cursor));
  return out.join('');
}
