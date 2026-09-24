/**
 * Rewarded ads — architecture prepared, not wired to any real feature.
 *
 * Per the brief: rewarded ads may exist so a future "watch an ad to unlock
 * X" flow can be added, but no essential Free feature may ever be gated
 * behind one, and no such flow is wired up now.
 *
 * This is the web/default fallback — `useRewardedUnlock()` always reports
 * "not ready" and its `show()` is a no-op. The real implementation lives in
 * `rewarded.native.ts`, split out for the same Metro platform-resolution
 * reason documented in `provider.ts`.
 */
export type RewardedUnlockState = {
  isReady: boolean;
  isEarned: boolean;
  isShowing: boolean;
  error?: Error;
  /** Call once the user opts in ("regarder une pub pour débloquer X"). */
  show: () => void;
};

export function useRewardedUnlock(_featureKey: string): RewardedUnlockState {
  return {
    isReady: false,
    isEarned: false,
    isShowing: false,
    show: () => {},
  };
}
