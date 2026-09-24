/**
 * Recherche locale pour la bibliothèque Hygiène (fiches HACCP).
 *
 * Même idiome que `tips/tipsSearch.ts` — normalisation accents/casse,
 * comparaison mot à mot sur une "haystack" construite à partir du titre, de
 * la description, de la catégorie et des mots-clés — appliqué ici à des
 * données 100 % locales (`hygiene/fiches.ts`) plutôt qu'à une réponse API :
 * pas de aller-retour réseau du tout, donc la recherche fonctionne aussi
 * hors-ligne, tout en filtrant à chaque frappe.
 */
import { normalize } from '@/src/textNormalize';
import { HYGIENE_CATEGORIES, type HygieneCategoryKey, type HygieneFiche } from '@/src/hygiene/fiches';

const CATEGORY_LABEL_BY_KEY: Record<HygieneCategoryKey, string> = Object.fromEntries(
  HYGIENE_CATEGORIES.map(c => [c.key, c.label])
) as Record<HygieneCategoryKey, string>;

function haystackOf(fiche: HygieneFiche): string {
  return normalize([
    fiche.title,
    fiche.description,
    CATEGORY_LABEL_BY_KEY[fiche.category],
    fiche.placement || '',
    ...fiche.keywords,
  ].join(' '));
}

/**
 * Une fiche correspond à une recherche si chaque mot de la requête (2
 * lettres ou plus) se retrouve quelque part dans son titre, sa description,
 * sa catégorie, son lieu d'affichage ou ses mots-clés — l'ordre des mots
 * n'importe pas, et un pluriel/singulier proche passe déjà par les
 * variantes déclarées dans `keywords` (ex. "frigo"/"frigos") plutôt que par
 * une racinisation générique, plus fragile sur un aussi petit corpus.
 */
export function ficheMatchesQuery(fiche: HygieneFiche, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const words = q.split(' ').filter(w => w.length >= 2);
  if (words.length === 0) return true;
  const haystack = haystackOf(fiche);
  return words.every(w => haystack.includes(w));
}

export function filterFiches(fiches: HygieneFiche[], query: string, category: HygieneCategoryKey | 'toutes'): HygieneFiche[] {
  return fiches.filter(f => (category === 'toutes' || f.category === category) && ficheMatchesQuery(f, query));
}
