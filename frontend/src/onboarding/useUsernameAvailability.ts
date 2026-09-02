import { useEffect, useState } from 'react';
import { api } from '@/src/api';

export type UsernameAvailability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'same';

/**
 * Vérification en direct de la disponibilité d'un nom d'utilisateur — même
 * débounce (250 ms, `setTimeout`/`clearTimeout` dans un `useEffect`) que
 * `frontend/src/adapt/AdaptScreen.tsx` pour `/adapt/preview`. Réutilisé par
 * l'assistant d'inscription (`app/signup.tsx`) ET le formulaire d'édition du
 * profil (`app/(tabs)/profile.tsx`) plutôt que dupliqué.
 *
 * `currentUsername` (optionnel) : si le champ tapé correspond déjà au nom
 * d'utilisateur actuel du compte (édition de profil, insensible à la casse),
 * inutile d'appeler le serveur — ce n'est pas un conflit avec soi-même.
 */
export function useUsernameAvailability(raw: string, currentUsername?: string | null): UsernameAvailability {
  const [status, setStatus] = useState<UsernameAvailability>('idle');

  useEffect(() => {
    const value = raw.trim();
    if (!value) {
      setStatus('idle');
      return;
    }
    if (currentUsername && value.toLowerCase() === currentUsername.toLowerCase()) {
      setStatus('same');
      return;
    }
    setStatus('checking');
    const t = setTimeout(() => {
      api(`/auth/username-available?username=${encodeURIComponent(value)}`)
        .then((res) => setStatus(res.available ? 'available' : (res.reason === 'format' ? 'invalid' : 'taken')))
        .catch(() => setStatus('idle'));
    }, 250);
    return () => clearTimeout(t);
  }, [raw, currentUsername]);

  return status;
}
