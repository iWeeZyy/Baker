import { useEntitlements } from './entitlements';

/** Les quatre offres, dans l'ordre. Miroir d'`entitlements.TIER_ORDER`. */
export type PlanTier = 'free' | 'pro' | 'pro_plus' | 'team';

/** Une fonctionnalité telle que le serveur la décrit. */
export type FeatureState = {
  /** La vérité de l'offre — sert l'argumentaire de l'écran d'abonnement. */
  allowed: boolean;
  /**
   * Ce que l'application doit réellement respecter. Le serveur y a déjà
   * replié l'interrupteur global, donc c'est **le seul champ sur lequel un
   * écran a le droit de brancher** : jamais `allowed`, jamais une
   * combinaison des deux.
   */
  locked: boolean;
  min_plan: PlanTier;
};

export type QuotaState = {
  limit: number | null;
  period: 'total' | 'month';
  used?: number;
  remaining?: number | null;
};

export type PlanState = {
  plan: PlanTier;
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
  /** Les droits sont-ils appliqués, ou seulement déclarés ? */
  enforced?: boolean;
  features?: Record<string, FeatureState>;
  quotas?: Record<string, QuotaState>;
  plans?: {
    plan: PlanTier;
    label: string;
    price_eur: number;
    features: string[];
    quotas: Record<string, number | null>;
  }[];
};

/**
 * True when an API error is the server refusing on plan grounds.
 *
 * Deux formes, un seul traitement : un quota épuisé (`plan_limit_reached`,
 * le contrat historique) et une fonctionnalité réservée à une offre
 * supérieure (`plan_feature_locked`) mènent tous deux à l'écran d'abonnement.
 */
export function isPlanLimitError(e: any): boolean {
  const kind = e?.detail?.error;
  return e?.status === 403 && (kind === 'plan_limit_reached' || kind === 'plan_feature_locked');
}

/**
 * The user's plan and quota. Display only — the limit itself is enforced
 * server-side, so this never decides whether an action is allowed.
 *
 * A thin re-export of `useEntitlements()` (src/entitlements.ts): the actual
 * `/me/plan` request is shared across the whole app through
 * `EntitlementsProvider`, mounted once in `app/_layout.tsx`, rather than
 * refetched by every screen that calls this hook. `reload` keeps its
 * original name here for the two existing call sites
 * (`app/(tabs)/planning.tsx`, `app/production/new.tsx`) that still ask for
 * it under that name; new code should prefer `useEntitlements()` directly,
 * which also exposes `can()`/`minPlanFor()`/`quota()`.
 */
export function usePlan() {
  const { plan, loading, refresh } = useEntitlements();
  return { plan, loading, reload: refresh };
}
