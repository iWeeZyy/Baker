import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTimer } from '@/src/TimerContext';
import { useEntitlements } from '@/src/entitlements';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme, type ThemeMode } from '@/src/ThemeContext';
import { cardElevation } from '@/src/elevation';
import { EmptyState } from '@/src/EmptyState';
import { LockedFeatureNotice } from '@/src/PlanChip';
import { useProductionSteps, type Step } from '@/src/useProductionSteps';

const NEXT_STATUS: Record<Step['status'], Step['status']> = {
  todo: 'doing',
  doing: 'done',
  done: 'todo',
};

function formatDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function clock(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatMinutes(m: number) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`;
}

/**
 * Écran plein écran du Déroulé d'une production, pensé pour être lu de loin
 * dans un fournil (gros caractères, contraste fort) — mêmes actions que
 * l'onglet Déroulé de production/[id].tsx (cocher une étape, lancer un
 * minuteur), jamais un second chemin de code : voir useProductionSteps.ts.
 * Pas d'enchaînement automatique des minuteurs dans cette première version.
 */
export default function FournilMode() {
  const { colors, mode: themeMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, themeMode), [colors, themeMode]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { start } = useTimer();
  const { can } = useEntitlements();
  const locked = !can('fournil_mode');

  const { data, loading, error, busyStep, patchStep, orderedSteps } = useProductionSteps(id);

  const startTimer = (step: Step) => {
    if (step.duration_minutes == null) return;
    start(`${step.recipe_title} — étape ${step.order + 1}`, step.duration_minutes * 60);
    if (step.status === 'todo') patchStep(step.step_id, { status: 'doing' });
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;
  }

  if (!data) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <EmptyState
          icon="alert-circle"
          title="Production introuvable"
          subtitle={error || undefined}
          ctaLabel="Retour"
          onCta={() => router.back()}
          testID="fournil-back"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="fournil-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="arrow-left" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{formatDate(data.date)}</Text>
        <View style={styles.iconBtn} />
      </View>

      {error && <Text style={styles.error} testID="fournil-error">{error}</Text>}

      {locked ? (
        <View style={styles.body}>
          <LockedFeatureNotice
            minPlan="pro_plus"
            label="Mode Fournil est réservé à l'offre Pro+"
            onPress={() => router.push('/pro?feature=fournil_mode' as any)}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {orderedSteps.length === 0 ? (
            <EmptyState icon="list" title="Aucune étape à dérouler" />
          ) : (
            orderedSteps.map(step => (
              <View
                key={step.step_id}
                style={[styles.stepCard, step.status === 'done' && styles.stepCardDone]}
                testID={`fournil-step-${step.step_id}`}
              >
                <View style={styles.stepTop}>
                  <Pressable
                    testID={`fournil-status-${step.step_id}`}
                    onPress={() => patchStep(step.step_id, { status: NEXT_STATUS[step.status] })}
                    disabled={busyStep === step.step_id}
                    style={[
                      styles.statusBtn,
                      step.status === 'doing' && styles.statusBtnDoing,
                      step.status === 'done' && styles.statusBtnDone,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={
                      step.status === 'todo' ? 'Démarrer cette étape'
                      : step.status === 'doing' ? 'Marquer cette étape terminée'
                      : 'Remettre cette étape à faire'
                    }
                  >
                    {busyStep === step.step_id ? (
                      <ActivityIndicator size="small" color={colors.brand} />
                    ) : (
                      <Feather
                        name={step.status === 'done' ? 'check' : step.status === 'doing' ? 'loader' : 'circle'}
                        size={26}
                        color={step.status === 'todo' ? colors.muted : colors.onBrandPrimary}
                      />
                    )}
                  </Pressable>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.stepRecipe}>{step.recipe_title}</Text>
                    <Text style={[styles.stepText, step.status === 'done' && styles.stepTextDone]}>
                      {step.text}
                    </Text>
                  </View>
                </View>

                <View style={styles.stepMetaRow}>
                  {step.start_at ? (
                    <View style={styles.timePill}>
                      <Feather name="clock" size={16} color={colors.onBrandTertiary} />
                      <Text style={styles.timePillText}>
                        {clock(step.start_at)}{step.end_at ? ` → ${clock(step.end_at)}` : ''}
                      </Text>
                    </View>
                  ) : null}
                  {step.duration_minutes != null && (
                    <Text style={styles.stepDuration}>{formatMinutes(step.duration_minutes)}</Text>
                  )}
                </View>

                {step.duration_minutes != null && step.status !== 'done' && (
                  <Pressable
                    testID={`fournil-timer-${step.step_id}`}
                    onPress={() => startTimer(step)}
                    style={styles.timerChip}
                  >
                    <Feather name="clock" size={18} color={colors.onBrandTertiary} />
                    <Text style={styles.timerChipText}>
                      Lancer le minuteur ({formatMinutes(step.duration_minutes)})
                    </Text>
                  </Pressable>
                )}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors, mode: ThemeMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1, textAlign: 'center', fontFamily: theme.serif, fontSize: theme.fontSize.xxl,
    color: colors.onSurface, textTransform: 'capitalize',
  },
  body: { padding: theme.spacing.xl, paddingBottom: 80 },
  error: { color: colors.error, fontSize: theme.fontSize.base, paddingHorizontal: 24, paddingTop: 12, lineHeight: 22 },
  stepCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.xl, padding: 22, marginBottom: 18,
    ...cardElevation(mode, colors),
  },
  stepCardDone: { opacity: 0.55 },
  stepTop: { flexDirection: 'row', gap: 18 },
  statusBtn: {
    width: 64, height: 64, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface,
  },
  statusBtnDoing: { backgroundColor: colors.warning, borderColor: colors.warning },
  statusBtnDone: { backgroundColor: colors.success, borderColor: colors.success },
  stepRecipe: {
    fontSize: theme.fontSize.base, letterSpacing: 1, color: colors.muted, fontWeight: '600', textTransform: 'uppercase',
  },
  stepText: { fontSize: theme.fontSize.xxl, color: colors.onSurface, lineHeight: 32, marginTop: 6 },
  stepTextDone: { textDecorationLine: 'line-through', color: colors.muted },
  stepMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16, marginLeft: 82 },
  timePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandTertiary,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill,
  },
  timePillText: { fontSize: theme.fontSize.lg, color: colors.onBrandTertiary, fontWeight: '700' },
  stepDuration: { fontSize: theme.fontSize.lg, color: colors.muted },
  timerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginLeft: 82, alignSelf: 'flex-start',
    backgroundColor: colors.brandTertiary, paddingHorizontal: 18, paddingVertical: 14, borderRadius: theme.radius.pill,
  },
  timerChipText: { fontSize: theme.fontSize.lg, color: colors.onBrandTertiary, fontWeight: '600' },
});
