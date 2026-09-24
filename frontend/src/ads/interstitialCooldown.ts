/**
 * Frequency cap for interstitial ads — a plain local preference, same shape
 * as `revealedPhotos.ts`/the theme preference: AsyncStorage-backed, one key,
 * best-effort (a storage failure never blocks or crashes anything).
 *
 * Platform-agnostic on purpose (unlike `interstitial.native.ts`, which is the
 * only file here that touches the native ad SDK) so both `interstitial.ts`
 * (web) and `interstitial.native.ts` (iOS/Android) can import it without
 * re-triggering the Metro web-bundling problem documented in `provider.ts`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'levanea_interstitial_last_shown_at';

/**
 * Generous placeholder floor between two interstitials. Nothing in the app
 * calls `showInterstitialIfDue()` yet (see `interstitial.native.ts`), so this
 * number has never been tuned against real usage — treat it as a starting
 * point, not a considered product decision.
 */
export const MIN_INTERSTITIAL_INTERVAL_MS = 5 * 60 * 1000;

export async function isInterstitialDue(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return true;
    const last = Number(raw);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last >= MIN_INTERSTITIAL_INTERVAL_MS;
  } catch {
    return true;
  }
}

export async function markInterstitialShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Best-effort: at worst the cooldown resets earlier than intended.
  }
}
