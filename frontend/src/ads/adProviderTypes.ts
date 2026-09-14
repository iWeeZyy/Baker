import type { ReactElement } from 'react';

/**
 * The ad network behind Baker, reduced to the three things the app needs.
 *
 * Nothing outside this file knows which network is in use. Swapping one in
 * means writing a new object of this shape and exporting it as `adProvider`
 * from `provider.ts`/`provider.native.ts` — no screen changes, no new checks
 * scattered around the app.
 *
 * Split out of `provider.ts` on its own, with no platform-specific import in
 * it, so both the web variant (`provider.ts`) and the native variant
 * (`provider.native.ts`) can share one definition without either importing
 * the other — see the comment in `provider.ts` for why that split exists.
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
 * No network, no requests, nothing rendered.
 *
 * It reports consent as 'unknown', which the ads context treats as a refusal
 * to show anything. So even if `ADS_ENABLED` were switched on server-side by
 * mistake, no ad could appear until a real, consenting provider is in force.
 */
export const noopProvider: AdProvider = {
  name: 'none',
  async requestConsent() { return 'unknown'; },
  async initialize() { /* nothing to start */ },
  render() { return null; },
};
