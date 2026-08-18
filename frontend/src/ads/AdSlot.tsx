import React from 'react';
import { useAds } from './AdsContext';
import { adProvider, type AdPlacement } from './provider';

/**
 * A crash inside an ad must not take a screen down with it.
 *
 * Third-party ad views are the classic source of render-time exceptions, and
 * losing the recipe list because a banner misbehaved would be the worst
 * possible trade. On error this renders nothing, permanently, and the rest of
 * the screen carries on.
 */
class AdBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[ads] slot failed, hidden for this screen:', error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The only way a screen displays an ad.
 *
 * Renders `null` — not an empty box — whenever ads are not allowed, so a Pro
 * user sees no gap where an ad would have been, and neither does a Free user
 * whose ad simply failed to load.
 */
export function AdSlot({ placement }: { placement: AdPlacement }) {
  const { canShowAds } = useAds();
  if (!canShowAds) return null;

  const ad = adProvider.render(placement);
  if (!ad) return null;

  return <AdBoundary>{ad}</AdBoundary>;
}
