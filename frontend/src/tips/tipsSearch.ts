/**
 * Recherche et tirage aléatoire pour la bibliothèque « Astuces ».
 *
 * La bibliothèque tient en quelques dizaines d'astuces (voir `/api/tips`,
 * chargé une fois) : comme pour les familles de recettes, un seul aller-retour
 * réseau puis un filtrage entièrement local — jamais un appel serveur par
 * frappe.
 */

export type Tip = {
  id: string;
  title: string;
  category: string;
  content: string;
  icon: string;
  source: string;
  keywords: string[];
  problem?: string;
  causes?: string[];
  solutions?: string[];
};

export function normalize(text: string): string {
  return (text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function haystackOf(tip: Tip): string {
  return normalize([
    tip.title, tip.category, tip.content,
    tip.problem || '', ...(tip.causes || []), ...(tip.solutions || []),
    ...(tip.keywords || []),
  ].join(' '));
}

/**
 * Une astuce correspond à une recherche si chaque mot de la requête (2
 * lettres ou plus) se retrouve quelque part dans son titre, son contenu, sa
 * catégorie, ses mots-clés ou — pour les astuces de dépannage — son
 * problème/ses causes/ses solutions. L'ordre des mots n'importe pas : « pâte
 * collante » retrouve aussi bien « une pâte trop collante » que l'inverse.
 */
export function tipMatchesQuery(tip: Tip, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const words = q.split(' ').filter(w => w.length >= 2);
  if (words.length === 0) return true;
  const haystack = haystackOf(tip);
  return words.every(w => haystack.includes(w));
}

export function filterTips(tips: Tip[], query: string, category: string): Tip[] {
  return tips.filter(t => (category === 'Toutes' || t.category === category) && tipMatchesQuery(t, query));
}

/** Un résumé court pour la carte : la première phrase, sinon une troncature propre. */
export function summarize(content: string, maxLen = 110): string {
  const text = (content || '').trim();
  const firstSentence = text.match(/^.+?[.!?](?:\s|$)/);
  const candidate = firstSentence ? firstSentence[0].trim() : text;
  if (candidate.length <= maxLen) return candidate;
  const cut = text.slice(0, maxLen);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

/**
 * Une astuce au hasard, en évitant autant que possible de retomber sur la
 * dernière montrée — impossible seulement quand la bibliothèque n'a qu'une
 * astuce.
 */
export function pickRandomTip(tips: Tip[], excludeId?: string | null): Tip | null {
  if (tips.length === 0) return null;
  const pool = tips.length > 1 && excludeId ? tips.filter(t => t.id !== excludeId) : tips;
  return pool[Math.floor(Math.random() * pool.length)];
}
