import { Platform } from 'react-native';
import { API_BASE, getToken } from '@/src/api';

/**
 * Upload multipart de la photo de profil — extrait de l'ancien
 * `confirmUpload()` de `app/(tabs)/profile.tsx` pour être réutilisé tel quel
 * par l'écran d'inscription (étape "photo"), sans dupliquer la logique
 * FormData/fetch. Passe par un `fetch` brut (pas le helper `api()`, qui ne
 * gère pas le multipart) — même raison que l'implémentation d'origine.
 * Ne rafraîchit pas `user` lui-même : l'appelant décide quand appeler
 * `refreshUser()`, puisque le contexte diffère (profil déjà connecté vs.
 * juste après la création du compte).
 */
export async function uploadAvatar(uri: string, name?: string): Promise<void> {
  const fileName = name || `avatar.${(uri.split('.').pop() || 'jpg').toLowerCase()}`;
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('file', blob, fileName);
  } else {
    form.append('file', { uri, name: fileName, type: `image/${fileName.split('.').pop()}` } as any);
  }
  const token = await getToken();
  const res = await fetch(`${API_BASE}/auth/me/picture`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.detail || 'Impossible d’envoyer votre photo. Vérifiez votre connexion et réessayez.');
}
