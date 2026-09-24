/**
 * Le badge de palier ("PRO+", "ÉQUIPE"…) et le petit encart "Verrouillé" qui
 * l'accompagne — la convention unique qu'un écran doit utiliser pour
 * signaler une fonctionnalité réservée à une offre supérieure, plutôt que
 * chaque écran inventant son propre libellé.
 *
 * Le texte "Verrouillé" reprend celui d'`app/badges.tsx` (même mot, même
 * poids visuel qu'un badge non obtenu) ; le `PlanChip` est neuf — aucun
 * écran n'affichait encore le nom d'un palier autrement qu'en toutes
 * lettres dans une phrase. Les trois couleurs utilisées sont les trois
 * teintes de marque déjà existantes (`colors.brand`/`brandSecondary`/
 * `brandTertiary`), le même trio que le podium du Classement — aucune
 * couleur inventée pour l'occasion. Free n'a pas de chip : rien n'est
 * jamais verrouillé pour l'offre la plus basse.
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { theme, type ThemeColors } from './theme';
import { useTheme } from './ThemeContext';
import type { PlanTier } from './plan';

const TIER_LABELS: Partial<Record<PlanTier, string>> = {
  pro: 'PRO',
  pro_plus: 'PRO+',
  team: 'ÉQUIPE',
};

const TIER_COLORS: Partial<Record<PlanTier, { bg: keyof ThemeColors; fg: keyof ThemeColors }>> = {
  pro: { bg: 'brandTertiary', fg: 'onBrandTertiary' },
  pro_plus: { bg: 'brandSecondary', fg: 'onBrandSecondary' },
  team: { bg: 'brand', fg: 'onBrandPrimary' },
};

export function PlanChip({ tier, style }: { tier: PlanTier; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const tones = TIER_COLORS[tier];
  const label = TIER_LABELS[tier];
  if (!tones || !label) return null; // Free : pas de chip.
  return (
    <View style={[{ backgroundColor: colors[tones.bg] as string }, styles.chip, style]}>
      <Text style={[{ color: colors[tones.fg] as string }, styles.chipText]}>{label}</Text>
    </View>
  );
}

/**
 * L'encart complet pour un point d'entrée verrouillé : icône, texte
 * "Verrouillé", le chip du palier requis, jamais masqué — toujours visible
 * pour que la fonctionnalité reste découvrable, `onPress` menant vers
 * `/pro` plutôt qu'essayer l'action et attendre un 403.
 */
export function LockedFeatureNotice({
  minPlan, label, onPress, style,
}: { minPlan: PlanTier; label?: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable testID="locked-feature-notice" onPress={onPress} style={[styles.notice, style]}>
      <Feather name="lock" size={15} color={colors.onSurfaceSecondary} />
      <Text style={styles.noticeText}>{label ?? 'Verrouillé'}</Text>
      <PlanChip tier={minPlan} />
      <Feather name="chevron-right" size={16} color={colors.muted} />
    </Pressable>
  );
}

/**
 * Le pendant de `LockedFeatureNotice` pour un cas différent : la
 * fonctionnalité EST accessible à ce palier, l'essai gratuit est
 * simplement épuisé (`plan_limit_reached`, pas `plan_feature_locked`).
 * Même langage visuel (icône, chip, chevron) que `LockedFeatureNotice` —
 * seule l'icône change (une alerte plutôt qu'un cadenas, puisque rien
 * n'est verrouillé) — pour que les deux se lisent comme une seule famille
 * plutôt que deux composants sans rapport. `label` est obligatoire ici,
 * contrairement à `LockedFeatureNotice` : le texte doit dire CE quota
 * précis ("vos 3 scans gratuits"), un mot générique comme "Verrouillé"
 * n'aurait aucun sens pour une fonctionnalité qu'on a le droit d'utiliser.
 */
export function LimitReachedNotice({
  minPlan, label, onPress, style,
}: { minPlan: PlanTier; label: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable testID="limit-reached-notice" onPress={onPress} style={[styles.notice, style]}>
      <Feather name="alert-circle" size={15} color={colors.onSurfaceSecondary} />
      <Text style={styles.noticeText}>{label}</Text>
      <PlanChip tier={minPlan} />
      <Feather name="chevron-right" size={16} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  chipText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
});

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: theme.radius.lg, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  noticeText: { flex: 1, fontSize: 13, color: colors.onSurfaceSecondary },
});
