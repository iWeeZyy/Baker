/**
 * Mise en forme des durées de recette.
 *
 * L'import des ouvrages a fait entrer des totaux longs — un diamant sablé
 * cumule 12 heures de froid — et « 905 min » ne se lit pas. Au-delà de l'heure
 * on passe donc en heures et minutes, comme le ferait une fiche de fournil.
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  // « 2 h » plutôt que « 2 h 00 » : la minute nulle n'apporte rien.
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}
