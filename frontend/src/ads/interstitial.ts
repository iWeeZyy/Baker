/**
 * Interstitial ads — architecture prepared, deliberately not called from any
 * screen yet (per the brief: interstitials need great moderation, and no
 * "natural moment" has been decided on — see the final report for candidate
 * moments, offered as suggestions, not decisions made here).
 *
 * This file is the web/default fallback: `showInterstitialIfDue()` always
 * resolves `false`, since there is no native ad SDK on web. The real
 * implementation lives in `interstitial.native.ts`, kept in a separate file
 * for the same Metro platform-resolution reason documented in `provider.ts`
 * — an unconditional top-level import of `react-native-google-mobile-ads`
 * breaks `expo export --platform web` regardless of any runtime check.
 */
export { isInterstitialDue, markInterstitialShown, MIN_INTERSTITIAL_INTERVAL_MS } from './interstitialCooldown';

export async function showInterstitialIfDue(): Promise<boolean> {
  return false;
}
