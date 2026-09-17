/**
 * Le compteur d'usage générique — généralise la bannière "N productions
 * gratuites restantes ce mois-ci" qu'`app/(tabs)/planning.tsx` affichait
 * déjà en dur pour `productions_per_month`, au seul quota déjà réel avant
 * ce chantier. Même forme visuelle exactement (icône, texte, lien) pour
 * que chaque nouvel emplacement se lise comme une variation du même
 * composant plutôt que comme une nouvelle idée.
 *
 * Ne s'affiche que si le quota a un plafond fini pour le palier de
 * l'appelant (`quota(key)` renvoie `undefined`/`limit: null` sinon — voir
 * `_quotas_with_usage` côté serveur, qui ne peuple `used`/`remaining` que
 * dans ce cas) : un compte payant sans plafond ne voit simplement rien,
 * jamais une bannière à "illimité".
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { theme, type ThemeColors } from './theme';
import { useTheme, type ThemeMode } from './ThemeContext';
import { cardElevation } from './elevation';
import { useEntitlements } from './entitlements';

export function QuotaBanner({
  quotaKey, label, feature, style, testID,
}: {
  quotaKey: string;
  /** Le texte affiché, construit à partir des chiffres réels du serveur. */
  label: (state: { used: number; limit: number; remaining: number }) => string;
  /** La fonctionnalité associée, pour le lien `?feature=` vers `/pro`
   * (fait défiler l'écran d'offres jusqu'à la bonne carte) — optionnel,
   * `/pro` seul sinon. */
  feature?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors, mode } = useTheme();
  const router = useRouter();
  const { quota } = useEntitlements();
  const styles = useMemo(() => makeStyles(colors, mode), [colors, mode]);
  const q = quota(quotaKey);
  if (!q || q.limit == null || q.used == null || q.remaining == null) return null;
  return (
    <Pressable
      testID={testID ?? `quota-banner-${quotaKey}`}
      onPress={() => router.push((feature ? `/pro?feature=${feature}` : '/pro') as any)}
      style={[styles.quotaBanner, style]}
    >
      <Feather name="info" size={14} color={colors.onSurfaceSecondary} />
      <Text style={styles.quotaText}>{label({ used: q.used, limit: q.limit, remaining: q.remaining })}</Text>
      <Text style={styles.quotaLink}>Levanea Pro</Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors, mode: ThemeMode) => StyleSheet.create({
  quotaBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg,
    ...cardElevation(mode, colors),
  },
  quotaText: { flex: 1, fontSize: 12, color: colors.onSurfaceSecondary },
  quotaLink: { fontSize: 12, color: colors.brand, fontWeight: '700' },
});
