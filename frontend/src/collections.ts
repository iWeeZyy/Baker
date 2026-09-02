/**
 * ID du pseudo-dossier "Toutes les recettes enregistrées" (favoris
 * existants, db.favorites), toujours épinglé en premier dans la liste des
 * collections — jamais un vrai document modifiable. Constante partagée par
 * `collections/index.tsx`, `collections/[id].tsx` et `AddToCollectionModal.tsx`,
 * qui redéfinissaient chacun la même chaîne littérale.
 */
export const FAVORITES_COLLECTION_ID = '__favorites__';
