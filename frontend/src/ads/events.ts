import { api } from '../api';

/** Mirrors `AD_EVENT_TYPES`/`AD_PLACEMENTS` in backend/routers/ads.py. */
export type AdEventType =
  | 'impression'
  | 'click'
  | 'interstitial_shown'
  | 'rewarded_completed'
  | 'rewarded_skipped';

export type AdEventPlacement = 'home' | 'recipe_list' | 'interstitial' | 'rewarded';

/**
 * Fire-and-forget: logs what happened after an ad was already shown, for
 * later reach/frequency/Free→Pro-conversion analysis (see `backend/routers/ads.py`).
 * Never awaited by a caller, never throws — a failed log must not affect
 * anything the user sees.
 */
export function logAdEvent(eventType: AdEventType, placement: AdEventPlacement): void {
  api('/ads/event', {
    method: 'POST',
    body: JSON.stringify({ event_type: eventType, placement }),
  }).catch(() => {});
}
