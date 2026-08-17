import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export type PlanState = {
  plan: 'free' | 'pro';
  limits: {
    productions_per_month: number | null;
    multi_day: boolean;
    recurring: boolean;
    sharing: boolean;
    full_history: boolean;
  };
  productions_used: number;
  productions_limit: number | null;
  productions_remaining: number | null;
};

/** True when an API error is the server refusing on plan grounds. */
export function isPlanLimitError(e: any): boolean {
  return e?.status === 403 && e?.detail?.error === 'plan_limit_reached';
}

/**
 * The user's plan and quota. Display only — the limit itself is enforced
 * server-side, so this never decides whether an action is allowed.
 */
export function usePlan() {
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setPlan(await api('/me/plan'));
    } catch {
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { plan, loading, reload };
}
