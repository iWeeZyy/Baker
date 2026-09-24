import React, { useState } from 'react';
import { Platform } from 'react-native';
import { type AdPlacement, type AdProvider } from './adProviderTypes';

/**
 * Google AdMob — the real provider, iOS/Android only.
 *
 * This file exists separately from `provider.ts` (see that file's own
 * comment) purely so Metro never has to resolve `react-native-google-mobile-ads`
 * for the web build. Everything below only ever runs on a native platform.
 *
 * Consent: Google UMP (`AdsConsent.gatherConsent()`) covers the GDPR/EEA
 * consent-form requirement, then iOS ATT is requested separately — ATT
 * governs IDFA access for *personalised* ads specifically, AdMob can still
 * serve contextual ads without it, so a decline there does not revoke ad
 * eligibility, only personalisation.
 *
 * Interstitial/rewarded architecture exists (`interstitial.ts`, `rewarded.ts`)
 * but is not called from here or from any screen yet.
 */

// The banner unit shown at every placement today — Baker has one banner
// design, not one per screen. `TestIds.BANNER` is Google's public test unit
// (always fills, carries no real revenue); a real ID is supplied only via
// env var, never hardcoded, matching app.config.js's App ID handling.
function bannerUnitId(TestIds: typeof import('react-native-google-mobile-ads').TestIds): string {
  const fromEnv = Platform.select({
    ios: process.env.EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID,
    android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID,
  });
  return fromEnv || TestIds.BANNER;
}

/**
 * Wraps `<BannerAd>` and hides itself permanently for this mount on a load
 * failure — offline, no fill, a misconfigured unit ID — rather than leaving
 * a broken placeholder. `AdSlot`'s own error boundary covers a thrown
 * exception; this covers the SDK's own "I have nothing to show" callback,
 * which is not an exception.
 */
function SafeBanner() {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const { BannerAd, BannerAdSize, TestIds } =
    require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');

  return React.createElement(BannerAd, {
    unitId: bannerUnitId(TestIds),
    size: BannerAdSize.ANCHORED_ADAPTIVE_BANNER,
    onAdFailedToLoad: () => setHidden(true),
  });
}

const admobProvider: AdProvider = {
  name: 'admob',

  async requestConsent() {
    try {
      const { AdsConsent } =
        require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');
      // One call: requests consent info and shows Google's own consent form
      // if the UMP SDK determines this user (EEA/UK) needs one.
      const info = await AdsConsent.gatherConsent();
      if (!info.canRequestAds) return 'denied';

      if (Platform.OS === 'ios') {
        const { requestTrackingPermissionsAsync } = await import('expo-tracking-transparency');
        await requestTrackingPermissionsAsync();
      }
      return 'granted';
    } catch {
      // A failed consent flow is a refusal, never an excuse to proceed.
      return 'unknown';
    }
  },

  async initialize() {
    try {
      const { default: mobileAds } =
        require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');
      await mobileAds().initialize();
    } catch {
      // Offline, dev environment, misconfigured App ID — AdSlot/SafeBanner
      // still fail gracefully on the next render regardless.
    }
  },

  render(_placement: AdPlacement) {
    return React.createElement(SafeBanner);
  },
};

export const adProvider: AdProvider = admobProvider;
export { noopProvider } from './adProviderTypes';
export type { AdPlacement, AdProvider, ConsentStatus } from './adProviderTypes';
