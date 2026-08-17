import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { adProvider, type ConsentStatus } from './provider';

/** Server-decided ad settings, mirroring `ads_config` in backend/plans.py. */
export type AdsConfig = {
  /** Baker serves ads at all — independent of this user's plan. */
  available: boolean;
  enabled: boolean;
  network: string;
  home_slot: boolean;
  list_first_slot: number;
  list_interval: number;
};

/**
 * The safe default, used before the plan is known and whenever anything goes
 * wrong. Every failure path lands here, so the app fails towards "no ads"
 * rather than towards showing one to someone who paid not to see them.
 */
const OFF: AdsConfig = {
  available: false,
  enabled: false,
  network: 'none',
  home_slot: false,
  list_first_slot: 6,
  list_interval: 10,
};

type AdsCtx = {
  config: AdsConfig;
  /** True once the plan has been resolved — false means "we don't know yet". */
  ready: boolean;
  /** The single question every screen asks. */
  canShowAds: boolean;
  /** Re-read the plan; call this after a purchase changes it. */
  refresh: () => Promise<void>;
};

const Ctx = createContext<AdsCtx>({
  config: OFF,
  ready: false,
  canShowAds: false,
  refresh: async () => {},
});

export const useAds = () => useContext(Ctx);

export function AdsProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [config, setConfig] = useState<AdsConfig>(OFF);
  const [ready, setReady] = useState(false);
  const [consent, setConsent] = useState<ConsentStatus>('unknown');

  const refresh = useCallback(async () => {
    // Signed out: no request at all. `/me/plan` needs a token, and a logged-out
    // visitor has no plan to speak of.
    if (!user) {
      setConfig(OFF);
      setReady(true);
      return;
    }
    try {
      const plan = await api('/me/plan');
      setConfig(plan?.ads ?? OFF);
    } catch {
      // Offline, server down, malformed payload — all mean "show nothing".
      setConfig(OFF);
    } finally {
      setReady(true);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    setReady(false);
    refresh();
  }, [authLoading, refresh]);

  // Consent is asked for only once the server has said ads apply to this user:
  // a Pro account is never prompted about advertising it will not see.
  useEffect(() => {
    let cancelled = false;
    if (!ready || !config.enabled) return;
    (async () => {
      try {
        const status = await adProvider.requestConsent();
        if (cancelled) return;
        setConsent(status);
        if (status === 'granted') await adProvider.initialize();
      } catch {
        // A failed consent flow is a refusal, never an excuse to proceed.
        if (!cancelled) setConsent('unknown');
      }
    })();
    return () => { cancelled = true; };
  }, [ready, config.enabled]);

  // Every condition must hold. `ready` is what stops an ad flashing up during
  // the moment before we know the user is Pro.
  const canShowAds = ready && config.enabled && consent === 'granted';

  return (
    <Ctx.Provider value={{ config, ready, canShowAds, refresh }}>
      {children}
    </Ctx.Provider>
  );
}
