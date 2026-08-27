/**
 * Retient quelles photos sensibles un utilisateur a choisi de révéler, pour
 * qu'il n'ait pas à confirmer à nouveau à chaque réouverture d'une
 * conversation (cahier des charges des photos de message, « mémoriser le
 * choix »). Une simple préférence locale suffit ici — pas d'aller-retour
 * serveur, pas de changement au modèle de message : le choix ne change que
 * la façon dont cet appareil affiche une photo qu'il peut déjà récupérer.
 *
 * Plafonné à MAX_ENTRIES pour que la liste stockée ne grossisse pas
 * indéfiniment sur plusieurs années d'usage ; les révélations les plus
 * anciennes sont retirées en premier, ce qui signifie au pire qu'une très
 * vieille photo sensible redemandera confirmation — compromis acceptable
 * pour un espace de stockage borné.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'bakers_revealed_photo_ids';
const MAX_ENTRIES = 500;

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

export async function isPhotoRevealed(messageId: string): Promise<boolean> {
  const ids = await load();
  return ids.includes(messageId);
}

export async function markPhotoRevealed(messageId: string): Promise<void> {
  const ids = await load();
  if (ids.includes(messageId)) return;
  const next = [...ids, messageId].slice(-MAX_ENTRIES);
  cache = next;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Best-effort : au pire l'utilisateur reconfirme la prochaine fois qu'il ouvre cette photo.
  }
}
