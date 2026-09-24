import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api } from '@/src/api';

export type OrgMember = { user_id: string; name: string; picture?: string | null; role: string };

/**
 * Le roster de l'organisation active du compte, ou une liste vide hors
 * organisation — même "jamais d'erreur, jamais un contexte ambigu" que
 * `organisations.get_org_context()` côté serveur : un compte qui n'a jamais
 * entendu parler d'une organisation obtient simplement `members: []`,
 * jamais une exception à gérer par chaque écran qui l'utilise
 * (`production/[id].tsx`, `app/fournil/[id].tsx` — l'attribution de tâches
 * n'a de sens que partagée avec des collègues).
 */
export function useOrgMembers() {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const mine = await api('/organisations/me');
      if (mine.active_org_id) {
        setMembers(await api('/organisations/members'));
      } else {
        setMembers([]);
      }
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return { members, loading };
}
