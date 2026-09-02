/**
 * Badge de confiance et étiquette de champ, partagés par les écrans
 * d'extraction assistée (scan.tsx, instagram-import.tsx). Rien pour "high"
 * (la valeur est fiable, pas besoin d'attirer l'œil), "⚠️ à vérifier" pour
 * "low" (lisible/présente mais incertaine), "non détecté" pour "absent" —
 * jamais une valeur inventée pour combler un champ absent.
 */
import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import type { Confidence } from './types';

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (confidence === 'high') return null;
  if (confidence === 'low') return <Text style={styles.badgeWarning}>⚠️ à vérifier</Text>;
  return <Text style={styles.badgeAbsent}>non détecté</Text>;
}

export function FieldLabel({ label, confidence }: { label: string; confidence: Confidence }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.fieldLabelRow}>
      <Text style={styles.label}>{label}</Text>
      <ConfidenceBadge confidence={confidence} />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  fieldLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, marginBottom: 6 },
  label: { fontSize: 13, color: colors.onSurfaceSecondary, fontWeight: '600' },
  badgeWarning: { fontSize: 11, color: colors.warning, fontWeight: '600' },
  badgeAbsent: { fontSize: 11, color: colors.error, fontWeight: '600' },
});
