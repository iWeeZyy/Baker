/**
 * Relief de carte — un utilitaire de style ajouté aux styles `card`/`box`
 * déjà définis dans chaque écran (`...cardElevation(mode, colors)` dans le
 * même `StyleSheet.create()`), plutôt qu'un composant `<Card>` qui aurait
 * forcé à réécrire le JSX et les paddings déjà réglés de chaque écran pour
 * un problème qui n'est que du style, jamais du comportement.
 *
 * Le relief change de technique selon le thème plutôt que d'appliquer la
 * même partout : en clair, une ombre chaude et discrète (`#2A1F1A`, jamais
 * un noir neutre — même logique que la palette sombre elle-même, voir
 * theme.ts). En sombre, une ombre ne se lit tout simplement pas sur un fond
 * déjà sombre : une bordure fine (`colors.border`) sert de repère de
 * surface à la place.
 */
import type { ThemeMode } from '@/src/ThemeContext';
import type { ThemeColors } from '@/src/theme';

export function cardElevation(mode: ThemeMode, colors: ThemeColors) {
  if (mode === 'dark') {
    return { borderWidth: 1 as const, borderColor: colors.border };
  }
  return {
    shadowColor: '#2A1F1A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  };
}
