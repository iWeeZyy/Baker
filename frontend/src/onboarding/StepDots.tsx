import { View, StyleSheet } from 'react-native';
import { useMemo } from 'react';
import { type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

/**
 * Points de progression — la puce active est plus large et de la couleur de
 * marque, les autres restent de simples ronds neutres. Même minimalisme à
 * deux tons que ProgressBar.tsx, réutilisé ici pour la découverte ET
 * l'inscription par étapes (un seul composant, deux écrans).
 */
export function StepDots({ count, activeIndex }: { count: number; activeIndex: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row} testID="step-dots">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
      ))}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.surfaceTertiary },
  dotActive: { width: 20, backgroundColor: colors.brand },
});
