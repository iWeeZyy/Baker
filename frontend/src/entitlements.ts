/**
 * Le palier de l'utilisateur, chargé une fois et partagé par toute l'app —
 * même forme que `AdsContext.tsx` (`useAds`), auquel ce fichier emprunte
 * directement sa structure : un `Provider` monté une fois dans
 * `app/_layout.tsx`, un `use...()` qui le lit, un `refresh()` explicite.
 *
 * Avant ce fichier, `usePlan()` (src/plan.ts) refaisait sa propre requête
 * `/me/plan` à chaque écran qui l'appelait — inoffensif tant qu'un seul
 * écran le faisait, mais contraire à ce que ce chantier demande : « une
 * requête, rafraîchie après tout 403 et au retour au premier plan ». Ce
 * fichier fournit ce point unique ; `usePlan()` devient un fin ré-export du
 * même contexte, donc les trois écrans qui l'utilisaient déjà
 * (`app/pro.tsx`, `app/(tabs)/planning.tsx`, `app/production/new.tsx`)
 * profitent du partage sans qu'une ligne d'eux ait à changer.
 *
 * **La seule chose sur laquelle un écran a le droit de brancher est
 * `locked`** (jamais `allowed`, jamais un palier lu à la main) — `can()`
 * ci-dessous ne fait que lire ce champ, déjà replié côté serveur.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api, onPlanLimitError } from './api';
import { useAuth } from './auth';
import type { PlanState, PlanTier, QuotaState } from './plan';

export type { FeatureState, PlanState, PlanTier, QuotaState } from './plan';

type EntitlementsCtx = {
  plan: PlanState | null;
  /** True le temps du tout premier chargement — pas lors d'un refresh. */
  loading: boolean;
  refresh: () => Promise<void>;
  /**
   * `true` tant que la fonctionnalité n'est pas connue à être verrouillée —
   * fail-open délibéré : une clé absente de la charge utile (palier pas
   * encore chargé, ou clé inconnue de ce serveur) ne doit jamais bloquer un
   * écran, seul un `locked: true` explicite le fait. C'est le même principe
   * que `enforced` par défaut à faux côté serveur : on ne restreint jamais
   * sur une absence d'information.
   */
  can: (feature: string) => boolean;
  /** Le palier minimum requis pour `feature`, si elle est verrouillée. */
  minPlanFor: (feature: string) => PlanTier | null;
  quota: (key: string) => QuotaState | undefined;
};

const DEFAULT: EntitlementsCtx = {
  plan: null,
  loading: true,
  refresh: async () => {},
  can: () => true,
  minPlanFor: () => null,
  quota: () => undefined,
};

const Ctx = createContext<EntitlementsCtx>(DEFAULT);

export const useEntitlements = () => useContext(Ctx);

export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [loading, setLoading] = useState(true);
  // Distingue le tout premier chargement (où `loading` doit rester vrai) d'un
  // refresh ultérieur (où l'écran garde l'ancienne valeur affichée pendant la
  // requête plutôt que de clignoter vers un état de chargement).
  const loadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setPlan(null);
      loadedOnce.current = true;
      setLoading(false);
      return;
    }
    try {
      setPlan(await api('/me/plan'));
    } catch {
      // Hors-ligne, serveur en panne : on garde le dernier palier connu
      // plutôt que d'en effacer un valide sur un souci réseau transitoire.
      if (!loadedOnce.current) setPlan(null);
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }, [user]);

  // Chargement initial, et à chaque changement de compte (connexion,
  // déconnexion, changement de compte sur le même appareil).
  useEffect(() => {
    if (authLoading) return;
    setLoading(!loadedOnce.current);
    refresh();
  }, [authLoading, refresh]);

  // Retour au premier plan : un achat/une résiliation peut s'être produit
  // pendant que l'app était en arrière-plan (App Store/Play Store, ou un
  // webhook RevenueCat arrivé entre-temps).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // Tout 403 plan_limit_reached/plan_feature_locked ailleurs dans l'app :
  // l'écran qui vient d'essuyer le refus doit voir un palier à jour tout de
  // suite, pas seulement au prochain retour au premier plan.
  useEffect(() => onPlanLimitError(() => { refresh(); }), [refresh]);

  const can = useCallback((feature: string) => {
    const f = plan?.features?.[feature];
    return f ? !f.locked : true;
  }, [plan]);

  const minPlanFor = useCallback((feature: string): PlanTier | null => {
    const f = plan?.features?.[feature];
    return f?.locked ? f.min_plan : null;
  }, [plan]);

  const quota = useCallback((key: string) => plan?.quotas?.[key], [plan]);

  return React.createElement(Ctx.Provider, { value: { plan, loading, refresh, can, minPlanFor, quota } }, children);
}
