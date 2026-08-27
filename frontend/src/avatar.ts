/**
 * Source unique de la conversion « chemin de stockage » -> URL affichable
 * pour une photo de profil, même principe que `recipeImage()` dans
 * `products.ts` pour `image_path` : `picture` est un chemin brut renvoyé
 * par l'API (jamais une URL absolue prête à l'emploi), donc chaque écran
 * qui affiche un avatar doit passer par ici plutôt que faire
 * `{ uri: user.picture }` directement — sinon un changement de convention
 * de stockage devrait être répété partout où un avatar est affiché.
 */
export function avatarUrl(picture: string | null | undefined, apiBase: string): string | undefined {
  if (!picture) return undefined;
  return `${apiBase}/files/${picture}`;
}
