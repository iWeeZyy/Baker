import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { usePlan } from '@/src/plan';
import { formatHours, weekTitle, type ScheduleRow } from '@/src/schedule/model';
import { theme } from '@/src/theme';

type ProductionRow = {
  id: string;
  date: string;
  target_time: string | null;
  notes: string;
  recipe_titles: string[];
  line_count: number;
  steps_total: number;
  steps_done: number;
  total_pieces: number | null;
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

type Mode = 'production' | 'staff';

export default function Planning() {
  const router = useRouter();
  const { plan, reload: reloadPlan } = usePlan();
  const [mode, setMode] = useState<Mode>('production');
  const [productions, setProductions] = useState<ProductionRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [prod, sched] = await Promise.all([api('/productions'), api('/schedules')]);
      setProductions(prod);
      setSchedules(sched);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Impossible de charger le planning');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); reloadPlan(); }, [load, reloadPlan]));

  const today = todayISO();
  const upcoming = productions.filter(p => p.date >= today);
  const past = productions.filter(p => p.date < today);

  const Card = ({ p }: { p: ProductionRow }) => {
    const progress = p.steps_total ? Math.round((p.steps_done / p.steps_total) * 100) : 0;
    return (
      <Pressable
        testID={`production-${p.id}`}
        onPress={() => router.push(`/production/${p.id}` as any)}
        style={styles.card}
      >
        <View style={styles.cardTop}>
          <Text style={styles.cardDate}>{formatDate(p.date)}</Text>
          {p.target_time ? (
            <View style={styles.timePill}>
              <Feather name="clock" size={11} color={theme.color.onBrandTertiary} />
              <Text style={styles.timePillText}>{p.target_time}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.cardRecipes} numberOfLines={2}>
          {p.recipe_titles.length ? p.recipe_titles.join(' · ') : 'Aucune recette'}
        </Text>

        <View style={styles.cardMetaRow}>
          <Text style={styles.cardMeta}>
            {p.line_count} recette{p.line_count > 1 ? 's' : ''}
            {p.total_pieces != null ? ` · ${p.total_pieces} pièces` : ''}
          </Text>
          {p.steps_total > 0 && (
            <Text style={[styles.cardMeta, progress === 100 && { color: theme.color.success }]}>
              {p.steps_done}/{p.steps_total} étapes
            </Text>
          )}
        </View>

        {p.steps_total > 0 && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={styles.header}>
          <Text style={styles.brandLabel}>LE FOURNIL</Text>
          <Text style={styles.title}>Planning</Text>
        </View>

        <View style={styles.segment}>
          {([['production', 'Production'], ['staff', 'Personnel']] as [Mode, string][]).map(([key, label]) => (
            <Pressable
              key={key}
              testID={`mode-${key}`}
              onPress={() => setMode(key)}
              style={[styles.segBtn, mode === key && styles.segBtnOn]}
            >
              <Text style={[styles.segText, mode === key && styles.segTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {mode === 'production' && plan && plan.productions_limit != null && (
          <Pressable
            testID="quota-banner"
            onPress={() => router.push('/pro' as any)}
            style={styles.quotaBanner}
          >
            <Feather name="info" size={14} color={theme.color.onSurfaceSecondary} />
            <Text style={styles.quotaText}>
              {plan.productions_remaining} production{(plan.productions_remaining ?? 0) > 1 ? 's' : ''} gratuite
              {(plan.productions_remaining ?? 0) > 1 ? 's' : ''} restante
              {(plan.productions_remaining ?? 0) > 1 ? 's' : ''} ce mois-ci
            </Text>
            <Text style={styles.quotaLink}>Baker Pro</Text>
          </Pressable>
        )}

        {loading ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={styles.emptyBox}>
            <Feather name="wifi-off" size={34} color={theme.color.muted} />
            <Text style={styles.emptyText}>{error}</Text>
            <Pressable testID="planning-retry" onPress={load} style={styles.retryBtn}>
              <Text style={styles.retryText}>Réessayer</Text>
            </Pressable>
          </View>
        ) : mode === 'staff' ? (
          schedules.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="users" size={38} color={theme.color.muted} />
              <Text style={styles.emptyTitle}>Aucun emploi du temps</Text>
              <Text style={styles.emptyText}>
                Planifiez la semaine de votre équipe :{'\n'}
                Bakers calcule les heures de chacun et le total.
              </Text>
            </View>
          ) : (
            <View style={styles.section}>
              {schedules.map(s => (
                <Pressable
                  key={s.id}
                  testID={`schedule-${s.id}`}
                  onPress={() => router.push(`/schedule/${s.id}` as any)}
                  style={styles.card}
                >
                  <Text style={styles.cardDate}>{weekTitle(s.week_start)}</Text>
                  <View style={styles.cardMetaRow}>
                    <Text style={styles.cardMeta}>
                      {s.employee_count} personne{s.employee_count > 1 ? 's' : ''}
                    </Text>
                    <Text style={styles.cardMeta}>{formatHours(s.grand_total_minutes)} au total</Text>
                  </View>
                  {s.notes ? (
                    <Text style={styles.cardMeta} numberOfLines={1}>{s.notes}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )
        ) : productions.length === 0 ? (
          <View style={styles.emptyBox}>
            <Feather name="calendar" size={38} color={theme.color.muted} />
            <Text style={styles.emptyTitle}>Aucune production planifiée</Text>
            <Text style={styles.emptyText}>
              Préparez votre journée : choisissez vos recettes et vos quantités,{'\n'}
              Bakers calcule les ingrédients et les horaires.
            </Text>
          </View>
        ) : (
          <>
            {upcoming.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>À venir</Text>
                {upcoming.map(p => <Card key={p.id} p={p} />)}
              </View>
            )}
            {past.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Passées</Text>
                {past.map(p => <Card key={p.id} p={p} />)}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Pressable
        testID={mode === 'staff' ? 'new-schedule' : 'new-production'}
        onPress={() => router.push((mode === 'staff' ? '/schedule/new' : '/production/new') as any)}
        style={styles.fab}
      >
        <Feather name="plus" size={20} color="#fff" />
        <Text style={styles.fabText}>{mode === 'staff' ? 'Nouvel emploi du temps' : 'Nouvelle production'}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  brandLabel: { fontSize: 11, letterSpacing: 4, color: theme.color.muted, fontWeight: '600' },
  title: { fontFamily: theme.serif, fontSize: 32, color: theme.color.onSurface, marginTop: 4 },
  quotaBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 24, marginTop: 8, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: theme.color.surfaceSecondary, borderRadius: 8 },
  quotaText: { flex: 1, fontSize: 12, color: theme.color.onSurfaceSecondary },
  quotaLink: { fontSize: 12, color: theme.color.brand, fontWeight: '700' },
  segment: { flexDirection: 'row', gap: 8, marginHorizontal: 24, marginTop: 12 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 999, backgroundColor: theme.color.surfaceSecondary },
  segBtnOn: { backgroundColor: theme.color.brand },
  segText: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '600' },
  segTextOn: { color: '#fff' },
  section: { paddingHorizontal: 24, marginTop: 24 },
  sectionTitle: { fontFamily: theme.serif, fontSize: 22, color: theme.color.onSurface, marginBottom: 12 },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 8, padding: 16, marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardDate: { flex: 1, fontFamily: theme.serif, fontSize: 18, color: theme.color.onSurface, textTransform: 'capitalize' },
  timePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.color.brandTertiary, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  timePillText: { fontSize: 11, color: theme.color.onBrandTertiary, fontWeight: '700' },
  cardRecipes: { fontSize: 14, color: theme.color.onSurfaceSecondary, marginTop: 6, lineHeight: 19 },
  cardMetaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  cardMeta: { fontSize: 12, color: theme.color.muted },
  progressTrack: { height: 4, backgroundColor: theme.color.surfaceTertiary, borderRadius: 999, marginTop: 10, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: theme.color.brand, borderRadius: 999 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40, marginTop: 70 },
  emptyTitle: { fontFamily: theme.serif, fontSize: 20, color: theme.color.onSurface, textAlign: 'center' },
  emptyText: { fontSize: 14, color: theme.color.muted, textAlign: 'center', lineHeight: 20 },
  retryBtn: { marginTop: 6, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 999, borderWidth: 1, borderColor: theme.color.borderStrong },
  retryText: { fontSize: 14, color: theme.color.onSurface, fontWeight: '600' },
  fab: { position: 'absolute', left: 24, right: 24, bottom: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.color.brand, paddingVertical: 16, borderRadius: 999 },
  fabText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
