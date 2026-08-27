/**
 * Remembers which sensitive message photos a user has chosen to reveal, so
 * they don't have to confirm again every time they reopen a conversation
 * (message-photo spec, "mémoriser le choix"). A plain local preference is
 * enough here — no server round trip, no change to the message model: the
 * choice only affects how this device renders a photo it can already fetch.
 *
 * Capped at MAX_ENTRIES so the stored list can't grow forever over years of
 * use; the oldest reveals are dropped first, which just means a very old
 * sensitive photo might ask for confirmation again — cheap trade for a
 * bounded footprint.
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
    // Best-effort: worst case the user re-confirms next time they open this photo.
  }
}
