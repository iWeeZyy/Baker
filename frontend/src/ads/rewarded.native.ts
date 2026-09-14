import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useRewardedAd, TestIds } from 'react-native-google-mobile-ads';
import { logAdEvent } from './events';
import type { RewardedUnlockState } from './rewarded';

export type { RewardedUnlockState } from './rewarded';

function unitId(): string {
  const fromEnv = Platform.select({
    ios: process.env.EXPO_PUBLIC_ADMOB_IOS_REWARDED_UNIT_ID,
    android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_UNIT_ID,
  });
  return fromEnv || TestIds.REWARDED;
}

/**
 * Generic "watch an ad to unlock `featureKey`" hook — not wired to any real
 * feature yet (see `rewarded.ts`'s own header comment for why). Loads a
 * rewarded ad eagerly on mount so it is ready by the time a future caller's
 * "watch an ad" button is pressed; logs `rewarded_completed`/`rewarded_skipped`
 * once the ad closes, for later analysis of rewarded-ad usage.
 */
export function useRewardedUnlock(featureKey: string): RewardedUnlockState {
  const { load, show, isLoaded, isClosed, isEarnedReward, isShowing, error } = useRewardedAd(unitId());

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isClosed) return;
    logAdEvent(isEarnedReward ? 'rewarded_completed' : 'rewarded_skipped', 'rewarded');
  }, [isClosed, isEarnedReward, featureKey]);

  return {
    isReady: isLoaded,
    isEarned: !!isEarnedReward,
    isShowing,
    error,
    show: () => show(),
  };
}
