/**
 * État vide (icône + titre + sous-titre + CTA optionnel) — remplace les
 * trois implémentations divergentes constatées (messagerie.tsx,
 * baker/[id].tsx, classement.tsx, et une demi-douzaine d'autres écrans),
 * chacune avec ses propres tailles/marges. Icône dans un cercle
 * `surfaceSecondary`, même esprit que les cercles de l'onboarding.
 */
import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { Button } from '@/src/Button';

export function EmptyState({
  icon,
  title,
  subtitle,
  ctaLabel,
  onCta,
  testID,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onCta?: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.container} testID={ctaLabel && onCta ? undefined : testID}>
      <View style={styles.iconCircle}>
        <Feather name={icon} size={28} color={colors.muted} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {ctaLabel && onCta ? (
        <Button testID={testID} label={ctaLabel} onPress={onCta} variant="secondary" fullWidth={false} style={styles.cta} />
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 10 },
  iconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { fontFamily: theme.serif, fontSize: 20, color: colors.onSurface, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  cta: { marginTop: 12 },
});
