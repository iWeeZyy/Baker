/**
 * Miroir exact de `backend/instagram.py` — les deux doivent toujours changer
 * ensemble. Accepte un nom d'utilisateur nu, `@nom`, ou une URL Instagram
 * complète (avec/sans `www.`/`https://`/slash final/query string) ; rejette
 * tout autre domaine. Ne stocke jamais l'URL, seulement le nom d'utilisateur
 * — l'URL se reconstruit à l'affichage via `instagramProfileUrl()`.
 */
import { Linking, Platform } from 'react-native';

const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com']);

/** Renvoie le nom d'utilisateur validé, ou `null` si l'entrée n'est ni un
 * nom d'utilisateur plausible ni une URL Instagram valide. */
export function parseInstagramUsername(raw: string): string | null {
  const text = (raw || '').trim();
  if (!text) return null;

  let candidate = text;
  const lower = text.toLowerCase();
  const looksLikeUrl = text.includes('://') || lower.startsWith('instagram.com') || lower.startsWith('www.instagram.com');

  if (looksLikeUrl) {
    const url = text.includes('://') ? text : `https://${text}`;
    let hostname: string;
    let pathname: string;
    try {
      const parsed = new URL(url);
      hostname = parsed.hostname.toLowerCase();
      pathname = parsed.pathname;
    } catch {
      return null;
    }
    if (!INSTAGRAM_HOSTS.has(hostname)) return null;
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    candidate = segments[0];
  } else if (candidate.startsWith('@')) {
    candidate = candidate.slice(1);
  }

  return USERNAME_RE.test(candidate) ? candidate : null;
}

/** Construite uniquement à l'affichage — jamais stockée. */
export function instagramProfileUrl(username: string): string {
  return `https://www.instagram.com/${username}/`;
}

/**
 * Ouvre le profil dans l'app Instagram si elle est installée (schéma
 * documenté `instagram://user?username=...`), sinon dans le navigateur.
 * Aucun précédent de ce genre n'existait dans l'app avant cette fonction —
 * borné ici, jamais un mécanisme de repli générique inventé ailleurs.
 */
export async function openInstagram(username: string): Promise<void> {
  const appUrl = `instagram://user?username=${encodeURIComponent(username)}`;
  const webUrl = instagramProfileUrl(username);
  try {
    if (Platform.OS !== 'web') {
      const canOpenApp = await Linking.canOpenURL(appUrl);
      if (canOpenApp) {
        await Linking.openURL(appUrl);
        return;
      }
    }
    await Linking.openURL(webUrl);
  } catch {
    // Silencieux : un lien externe qui échoue ne doit jamais faire planter l'app.
  }
}
