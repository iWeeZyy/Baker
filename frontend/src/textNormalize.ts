/**
 * Normalisation de texte pour une recherche insensible aux accents/casse.
 *
 * Extrait de `tips/tipsSearch.ts` (l'astuce, un seul utilisateur jusqu'ici)
 * quand `recipeSearch.ts` en a eu besoin à son tour — même principe
 * d'extraction déjà appliqué dans ce projet à `Chip`/`ActionSheet`/
 * `EmptyState` : rien de spécifique aux astuces ici, donc un module neutre
 * partagé plutôt qu'une deuxième copie de la même fonction.
 */
export function normalize(text: string): string {
  return (text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}
