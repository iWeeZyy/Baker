import { Platform } from 'react-native';
import { isInterstitialDue, markInterstitialShown } from './interstitialCooldown';

export { isInterstitialDue, markInterstitialShown, MIN_INTERSTITIAL_INTERVAL_MS } from './interstitialCooldown';

function unitId(TestIds: typeof import('react-native-google-mobile-ads').TestIds): string {
  const fromEnv = Platform.select({
    ios: process.env.EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_UNIT_ID,
    android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_UNIT_ID,
  });
  return fromEnv || TestIds.INTERSTITIAL;
}

/**
 * Loads and shows an interstitial if the cooldown (`interstitialCooldown.ts`)
 * has elapsed. Resolves `true` only if an ad was actually shown and closed —
 * callers use that to decide whether to log an `interstitial_shown` event
 * (see `events.ts`).
 *
 * Not called from any screen yet — the brief is explicit that interstitials
 * need great moderation (never at launch, mid-recipe, mid-calculation, mid
 * production-step, or right after every action), and no specific "natural
 * moment" has been decided. This function exists so that decision, once
 * made, is a one-line call site rather than a new ad-loading implementation.
 */
export async function showInterstitialIfDue(): Promise<boolean> {
  if (!(await isInterstitialDue())) return false;
  try {
    const { InterstitialAd, AdEventType, TestIds } =
      require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');
    const ad = InterstitialAd.createForAdRequest(unitId(TestIds));

    const shown = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        unsubLoaded();
        unsubError();
        unsubClosed();
        resolve(result);
      };
      const unsubLoaded = ad.addAdEventListener(AdEventType.LOADED, () => {
        try { ad.show(); } catch { finish(false); }
      });
      const unsubError = ad.addAdEventListener(AdEventType.ERROR, () => finish(false));
      const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => finish(true));
      ad.load();
    });

    if (shown) await markInterstitialShown();
    return shown;
  } catch {
    return false;
  }
}
