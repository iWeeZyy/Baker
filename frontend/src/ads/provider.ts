import type { ReactElement } from 'react';

/**
 * The ad network behind Baker, reduced to the three things the app needs.
 *
 * Nothing outside this file knows which network is in use. Swapping one in
 * means writing a new object of this shape and exporting it as `adProvider`
 * below — no screen changes, no new checks scattered around the app.
 *
 * ---------------------------------------------------------------------------
 * PLUGGING IN GOOGLE ADMOB (the chosen network, not yet wired)
 * ---------------------------------------------------------------------------
 * AdMob is a *native* module: it cannot run in the web export Baker currently
 * ships on Render, so it stays unwired until there is a native iOS build.
 *
 *   1. `npx expo install react-native-google-mobile-ads`
 *   2. app.json → plugins: ["react-native-google-mobile-ads", {
 *        "androidAppId": "ca-app-pub-…~…", "iosAppId": "ca-app-pub-…~…" }]
 *      and ios.infoPlist.NSUserTrackingUsageDescription (ATT prompt text).
 *   3. `npx expo install expo-tracking-transparency` for the iOS ATT prompt.
 *   4. Implement `requestConsent` with Google's UMP SDK
 *      (`AdsConsent.requestInfoUpdate` → `loadAndShowConsentFormIfRequired`),
 *      then the ATT prompt, and return 'granted' only once both have resolved.
 *      This is mandatory: Baker's users are in the EEA, and AdMob suspends
 *      accounts that request ads before a certified consent form has run.
 *   5. Implement `render` with `<BannerAd />` or `<NativeAd />`, and hand back
 *      `null` on any load error so the screen simply shows nothing.
 *
 * Until all five are done, `noopProvider` keeps every surface empty.
 */

export type AdPlacement = 'home' | 'recipe_list';

export type ConsentStatus =
  /** The user agreed and personalised ads may be requested. */
  | 'granted'
  /** The user refused; only non-personalised ads would be permitted. */
  | 'denied'
  /** No consent flow has run yet, or none is available. */
  | 'unknown';

export type AdProvider = {
  readonly name: string;

  /**
   * Run the consent flow (CMP, then ATT on iOS) and report the outcome.
   * Must resolve rather than throw — a network failure here is not an error
   * the baker should ever see.
   */
  requestConsent(): Promise<ConsentStatus>;

  /** Initialise the SDK. Called once, and only after consent is resolved. */
  initialize(): Promise<void>;

  /**
   * The ad to display at a placement, or `null` when there is nothing to show.
   * Returning `null` must be cheap: it is called on every render.
   */
  render(placement: AdPlacement): ReactElement | null;
};

/**
 * The provider in force today: no network, no requests, nothing rendered.
 *
 * It reports consent as 'unknown', which the ads context treats as a refusal
 * to show anything. So even if `ADS_ENABLED` were switched on server-side by
 * mistake, no ad could appear until a real provider is wired in.
 */
export const noopProvider: AdProvider = {
  name: 'none',
  async requestConsent() { return 'unknown'; },
  async initialize() { /* nothing to start */ },
  render() { return null; },
};

export const adProvider: AdProvider = noopProvider;
