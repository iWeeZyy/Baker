/**
 * Miroir exact de `backend/instagram.py` — les deux doivent toujours changer
 * ensemble. Accepte un nom d'utilisateur nu, `@nom`, ou une URL Instagram
 * complète (avec/sans `www.`/`https://`/slash final/query string) ; rejette
 * tout autre domaine. Ne stocke jamais l'URL, seulement le nom d'utilisateur
 * — l'URL se reconstruit à l'affichage via `instagramProfileUrl()`.
 */
import { Linking } from 'react-native';

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
 * Ouvre le profil Instagram. Un seul lien https, jamais un schéma
 * personnalisé `instagram://` : Instagram a abandonné ce schéma il y a
 * plusieurs années (plus rien ne garantit son format), et le vérifier via
 * `Linking.canOpenURL` échoue silencieusement de toute façon tant que
 * `instagram` n'est pas déclaré dans `LSApplicationQueriesSchemes` côté iOS
 * — ce qui faisait rester l'utilisateur dans Bakers au lieu de basculer
 * vers Instagram. instagram.com gère les Universal Links (iOS) / App Links
 * (Android) : ouvrir ce lien https suffit à ce que le système bascule
 * lui-même vers l'app Instagram si elle est installée, sinon le navigateur
 * — aucun schéma ni permission supplémentaire à gérer.
 */
export async function openInstagram(username: string): Promise<void> {
  try {
    await Linking.openURL(instagramProfileUrl(username));
  } catch {
    // Silencieux : un lien externe qui échoue ne doit jamais faire planter l'app.
  }
}
