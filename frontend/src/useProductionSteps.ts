import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { syncWidgetData } from '@/src/widgetData';
import { startBakeActivity, updateBakeActivity, endBakeActivity } from '@/modules/levanea-live-activity';

export type Line = {
  line_id: string;
  recipe_id: string;
  recipe_title: string;
  mode: 'pieces' | 'batches';
  quantity: number;
  yield_pieces: number | null;
  batches: number;
};

export type Step = {
  step_id: string;
  line_id: string;
  recipe_title: string;
  order: number;
  text: string;
  duration_minutes: number | null;
  duration_source: 'recipe' | 'manual' | null;
  status: 'todo' | 'doing' | 'done';
  start_at: string | null;
  end_at: string | null;
  assignee_user_id: string | null;
};

export type ProductionDetail = {
  id: string;
  date: string;
  target_time: string | null;
  notes: string;
  lines: Line[];
  steps: Step[];
  ingredients: {
    items: { name: string; quantity: number; unit: string }[];
    unparsed: string[];
  };
  missing_durations: string[];
  scheduled: boolean;
  total_pieces: number | null;
  // Commandes pro actives dues ce même jour, déjà fondues dans
  // `ingredients` ci-dessus (voir backend/routers/production.py::_production_detail,
  // phase 7b) — jamais une seconde liste, juste ce compte pour que l'écran
  // puisse dire que l'agrégat inclut des commandes sans les détailler.
  orders_count: number;
};

/**
 * Ordre chronologique, étapes non datées conservées à leur place.
 *
 * Une étape sans durée laisse tout ce qui la précède dans sa recette non
 * daté aussi. Trier sur le seul horodatage rejetterait ce groupe en bas —
 * plaçant l'autolyse *après* la cuisson. Les étapes non datées empruntent
 * donc l'heure la plus ancienne connue de leur recette, et l'ordre propre à
 * la recette départage, ce qui reste chronologique par construction.
 */
export function orderSteps(steps: Step[]): Step[] {
  const anchors = new Map<string, string>();
  for (const s of steps) {
    const t = s.start_at || s.end_at;
    if (!t) continue;
    const current = anchors.get(s.line_id);
    if (!current || t < current) anchors.set(s.line_id, t);
  }
  return [...steps].sort((a, b) => {
    const ta = a.start_at || a.end_at || anchors.get(a.line_id) || '';
    const tb = b.start_at || b.end_at || anchors.get(b.line_id) || '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    if (a.line_id !== b.line_id) return a.line_id < b.line_id ? -1 : 1;
    return a.order - b.order;
  });
}

/**
 * Choix unique de lecture/écriture d'une production et de ses étapes,
 * partagé entre l'écran de planification (`app/production/[id].tsx`) et
 * Mode Fournil (`app/fournil/[id].tsx`) — la Live Activity "cuisson en
 * cours" et la synchronisation du widget iOS ne doivent jamais avoir deux
 * chemins de code qui pourraient diverger (voir CLAUDE.md, section widget).
 */
export function useProductionSteps(id: string | undefined) {
  const { user } = useAuth();
  const [data, setData] = useState<ProductionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyStep, setBusyStep] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api(`/productions/${id}`));
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Production introuvable');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const patchStep = async (stepId: string, body: Record<string, unknown>) => {
    setBusyStep(stepId);
    setError(null);
    const before = data?.steps.find(s => s.step_id === stepId) || null;
    try {
      // Le serveur renvoie toute la production : un seul aller-retour
      // rafraîchit aussi le planning, qu'une nouvelle durée peut avoir
      // débloqué en amont.
      const updated: ProductionDetail = await api(`/productions/${id}/steps/${stepId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setData(updated);

      // Live Activity "cuisson en cours" : démarre/actualise/termine sur le
      // même choix de statut que l'utilisateur vient de faire, jamais un
      // second geste à part. L'échéance vient de la durée connue de
      // l'étape — jamais devinée — décomptée à partir de maintenant.
      const after = updated.steps.find(s => s.step_id === stepId) || null;
      if (after?.status === 'doing') {
        const endAtIso = after.duration_minutes != null
          ? new Date(Date.now() + after.duration_minutes * 60000).toISOString()
          : null;
        if (before?.status === 'doing') updateBakeActivity(after.text, endAtIso);
        else startBakeActivity(after.recipe_title, after.text, endAtIso);
      } else if (before?.status === 'doing') {
        endBakeActivity();
      }

      if (user) syncWidgetData(user.user_id);
    } catch (e: any) {
      setError(e.message || 'Mise à jour impossible');
    } finally {
      setBusyStep(null);
    }
  };

  const orderedSteps = data ? orderSteps(data.steps) : [];
  const missing = new Set(data?.missing_durations || []);

  return { data, loading, error, setError, busyStep, load, patchStep, orderedSteps, missing };
}
