/**
 * Contrôle segmenté (2-3 options, une sélection) — reprend le pattern
 * `segment`/`segBtn`/`segBtnOn` redéfini quasi à l'identique dans
 * classement.tsx, tips.tsx et planning.tsx.
 */
import { useMemo } from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.segment} testID={testID}>
      {options.map((opt) => (
        <Pressable
          key={opt.key}
          testID={testID ? `${testID}-${opt.key}` : undefined}
          onPress={() => onChange(opt.key)}
          style={[styles.segBtn, value === opt.key && styles.segBtnOn]}
        >
          <Text style={[styles.segText, value === opt.key && styles.segTextOn]}>{opt.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  segment: { flexDirection: 'row', gap: 8, marginHorizontal: 24, marginBottom: 16 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: theme.radius.pill, backgroundColor: colors.surfaceSecondary },
  segBtnOn: { backgroundColor: colors.brand },
  segText: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  segTextOn: { color: colors.onBrandPrimary },
});
