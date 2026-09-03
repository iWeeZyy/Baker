/**
 * Recherches récentes de l'écran `recipe-search.tsx` — une préférence locale
 * pure, jamais envoyée au serveur (le cahier des charges le demande
 * explicitement). Même forme que `revealedPhotos.ts` : AsyncStorage, cache en
 * mémoire, écriture best-effort, liste plafonnée pour ne pas grossir
 * indéfiniment.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'levanea_recent_recipe_searches';
const MAX_ENTRIES = 8;

let cache: string[] | null = null;

async function load(): Promise<string[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? JSON.parse(raw) : [];
  } catch {
    cache = [];
  }
  return cache!;
}

async function persist(next: string[]): Promise<void> {
  cache = next;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Best-effort : au pire la liste ne survit pas au redémarrage suivant.
  }
}

export async function getRecentSearches(): Promise<string[]> {
  return load();
}

/** Ajoute en tête, sans doublon (insensible à la casse), plafonné à MAX_ENTRIES. */
export async function addRecentSearch(term: string): Promise<string[]> {
  const trimmed = term.trim();
  if (!trimmed) return load();
  const existing = await load();
  const next = [trimmed, ...existing.filter(t => t.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_ENTRIES);
  await persist(next);
  return next;
}

export async function removeRecentSearch(term: string): Promise<string[]> {
  const existing = await load();
  const next = existing.filter(t => t !== term);
  await persist(next);
  return next;
}
