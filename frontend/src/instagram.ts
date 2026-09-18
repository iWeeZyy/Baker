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
 * Ouvre le profil Instagram. Un seul lien https, jamais un schéma
 * personnalisé `instagram://` : Instagram a abandonné ce schéma il y a
 * plusieurs années (plus rien ne garantit son format), et le vérifier via
 * `Linking.canOpenURL` échoue silencieusement de toute façon tant que
 * `instagram` n'est pas déclaré dans `LSApplicationQueriesSchemes` côté iOS
 * — ce qui faisait rester l'utilisateur dans Levanea au lieu de basculer
 * vers Instagram. instagram.com gère les Universal Links (iOS) / App Links
 * (Android) : ouvrir ce lien https suffit à ce que le système bascule
 * lui-même vers l'app Instagram si elle est installée, sinon le navigateur
 * — aucun schéma ni permission supplémentaire à gérer.
 *
 * **Sur le web, `target: '_self'` est explicite, jamais le `'_blank'` par
 * défaut de `Linking.openURL`.** `react-native-web`'s `Linking.openURL(url)`
 * (un seul argument) ouvre un nouvel onglet — précisément celui que l'OS,
 * sur mobile, intercepte pour basculer vers l'app Instagram (Universal
 * Links/App Links), l'interception ayant lieu avant que quoi que ce soit ne
 * s'y charge. Le nouvel onglet reste alors orphelin et blanc pendant que
 * l'app Instagram s'ouvre par-dessus — le bug remonté ("Instagram s'ouvre et
 * sur Levanea une page blanche s'affiche"). `_self` fait naviguer l'onglet
 * Levanea lui-même : quand l'app est installée, l'interception a toujours
 * lieu avant que la navigation ne charge réellement instagram.com, donc
 * Levanea n'est jamais vraiment déchargé ; sans l'app, l'onglet navigue vers
 * le site Instagram (retour possible avec le bouton précédent). Sur natif,
 * `Linking.openURL` ne prend qu'un seul paramètre (`Linking.d.ts` de
 * React Native) — le second argument y est donc lu par un typage élargi
 * plutôt que par la signature native, mais ne change rien à son
 * comportement : seul `react-native-web`'s implémentation en tient compte.
 */
export async function openInstagram(username: string): Promise<void> {
  const url = instagramProfileUrl(username);
  try {
    if (Platform.OS === 'web') {
      await (Linking.openURL as (url: string, target?: string) => Promise<void>)(url, '_self');
    } else {
      await Linking.openURL(url);
    }
  } catch {
    // Silencieux : un lien externe qui échoue ne doit jamais faire planter l'app.
  }
}
