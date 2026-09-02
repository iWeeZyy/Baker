/**
 * Puce (filtre, sélection unique/multiple) — remplace les variantes
 * légèrement divergentes recréées à la main dans une douzaine d'écrans
 * (`borderRadius: 999` en dur au lieu de `theme.radius.pill`, bordures
 * incohérentes...). Deux tons déjà établis et volontairement distincts,
 * jamais fusionnés en un seul : `inverse` (fond `colors.surfaceInverse`,
 * la puce de filtre déjà utilisée par recipes.tsx/tips.tsx/classement.tsx/
 * collections/scan.tsx/share.tsx/creation — 7 écrans) est le ton par
 * défaut ; `brand` (fond `colors.brand`, déjà utilisé par signup.tsx pour
 * un sélecteur de métier/spécialités) reste un choix explicite à la carte.
 */
import { useMemo } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

export function Chip({ label, active, onPress, tone = 'inverse', testID }: { label: string; active: boolean; onPress: () => void; tone?: 'inverse' | 'brand'; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.chip, active && (tone === 'brand' ? styles.chipActiveBrand : styles.chipActiveInverse)]}>
      <Text style={[styles.chipText, active && (tone === 'brand' ? styles.chipTextActiveBrand : styles.chipTextActiveInverse)]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: colors.borderStrong, alignSelf: 'flex-start' },
  chipActiveInverse: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  chipActiveBrand: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 13, color: colors.onSurfaceSecondary, fontWeight: '500' },
  chipTextActiveInverse: { color: colors.onSurfaceInverse },
  chipTextActiveBrand: { color: colors.onBrandPrimary },
});
