import { View, StyleSheet } from 'react-native';
import { useMemo } from 'react';
import { type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

/**
 * Barre de progression générique — deux `View` imbriquées, largeur en %.
 * Réutilisée pour la progression de niveau (XP dans le palier courant) et la
 * progression d'un badge à seuil (N/threshold) : aucune des deux ne justifie
 * une bibliothèque de graphiques pour un simple rectangle.
 */
export function ProgressBar({ ratio, height = 8 }: { ratio: number; height?: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <View style={[styles.fill, { width: `${pct}%`, borderRadius: height / 2 }]} />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  track: { width: '100%', backgroundColor: colors.surfaceTertiary, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.brand },
});
