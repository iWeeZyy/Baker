import { useCallback, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, RefreshControl } from 'react-native';
import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { confirmAsync } from '@/src/confirm';
import { usePlan } from '@/src/plan';
import { formatHours, weekTitle, type ScheduleRow } from '@/src/schedule/model';
import { SwipeableRow } from '@/src/SwipeableRow';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme, type ThemeMode } from '@/src/ThemeContext';
import { cardElevation } from '@/src/elevation';
import { SegmentedControl } from '@/src/SegmentedControl';
import { EmptyState } from '@/src/EmptyState';
import { endBakeActivity } from '@/modules/levanea-live-activity';
import { syncWidgetData } from '@/src/widgetData';

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
  const { colors, mode: themeMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, themeMode), [colors, themeMode]);
  const router = useRouter();
  const { user } = useAuth();
  const { plan, reload: reloadPlan } = usePlan();
  const [mode, setMode] = useState<Mode>('production');
  const [productions, setProductions] = useState<ProductionRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); reloadPlan(); }, [load, reloadPlan]));

  const today = todayISO();
  const upcoming = productions.filter(p => p.date >= today);
  const past = productions.filter(p => p.date < today);

  /**
   * Le swipe est une deuxième porte d'entrée vers les mêmes actions Modifier/
   * Supprimer que l'écran de détail (bouton crayon, "Supprimer cette
   * production"/"cet emploi du temps") — jamais une deuxième logique. Une
   * seule ligne ouverte à la fois : ouvrir une ligne referme la précédente ;
   * taper sur une ligne pendant qu'une autre est ouverte la referme sans
   * naviguer (comme Mail), le tap normal (fermé) navigue exactement comme
   * avant.
   */
  const swipeRefs = useRef<Map<string, React.RefObject<SwipeableMethods | null>>>(new Map());
  const openRowId = useRef<string | null>(null);

  const getSwipeRef = (id: string): React.RefObject<SwipeableMethods | null> => {
    let ref = swipeRefs.current.get(id);
    if (!ref) {
      ref = { current: null };
      swipeRefs.current.set(id, ref);
    }
    return ref;
  };

  const closeOpenRow = () => {
    if (!openRowId.current) return;
    swipeRefs.current.get(openRowId.current)?.current?.close();
    openRowId.current = null;
  };

  const handleRowPress = (navigate: () => void) => {
    if (openRowId.current) {
      closeOpenRow();
      return;
    }
    navigate();
  };

  const deleteProduction = async (id: string) => {
    const ok = await confirmAsync('Supprimer cette production', 'Cette action est définitive.', 'Supprimer', true);
    if (!ok) return;
    try {
      await api(`/productions/${id}`, { method: 'DELETE' });
      endBakeActivity();
      if (user) syncWidgetData(user.user_id);
      await load();
    } catch (e: any) {
      setError(e.message || 'Suppression impossible');
    }
  };

  const deleteSchedule = async (id: string) => {
    const ok = await confirmAsync('Supprimer cet emploi du temps', 'Cette action est définitive.', 'Supprimer', true);
    if (!ok) return;
    try {
      await api(`/schedules/${id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e.message || 'Suppression impossible');
    }
  };

  const Card = ({ p }: { p: ProductionRow }) => {
    const progress = p.steps_total ? Math.round((p.steps_done / p.steps_total) * 100) : 0;
    return (
      <SwipeableRow
        ref={getSwipeRef(p.id)}
        onSwipeableWillOpen={() => {
          if (openRowId.current && openRowId.current !== p.id) getSwipeRef(openRowId.current).current?.close();
          openRowId.current = p.id;
        }}
        onSwipeableClose={() => { if (openRowId.current === p.id) openRowId.current = null; }}
        onEdit={() => router.push({ pathname: '/production/new', params: { id: p.id } } as any)}
        onDelete={() => deleteProduction(p.id)}
      >
        <Pressable
          testID={`production-${p.id}`}
          onPress={() => handleRowPress(() => router.push(`/production/${p.id}` as any))}
          style={styles.card}
        >
          <View style={styles.cardTop}>
            <Text style={styles.cardDate}>{formatDate(p.date)}</Text>
            {p.target_time ? (
              <View style={styles.timePill}>
                <Feather name="clock" size={11} color={colors.onBrandTertiary} />
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
              <Text style={[styles.cardMeta, progress === 100 && { color: colors.success }]}>
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
      </SwipeableRow>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); reloadPlan(); }} tintColor={colors.brand} />}
      >
        <View style={styles.header}>
          <Text style={styles.brandLabel}>LE FOURNIL</Text>
          <Text style={styles.title}>Planning</Text>
        </View>

        <SegmentedControl
          testID="mode"
          options={[{ key: 'production' as Mode, label: 'Production' }, { key: 'staff' as Mode, label: 'Personnel' }]}
          value={mode}
          onChange={setMode}
        />

        {mode === 'production' && plan && plan.productions_limit != null && (
          <Pressable
            testID="quota-banner"
            onPress={() => router.push('/pro' as any)}
            style={styles.quotaBanner}
          >
            <Feather name="info" size={14} color={colors.onSurfaceSecondary} />
            <Text style={styles.quotaText}>
              {plan.productions_remaining} production{(plan.productions_remaining ?? 0) > 1 ? 's' : ''} gratuite
              {(plan.productions_remaining ?? 0) > 1 ? 's' : ''} restante
              {(plan.productions_remaining ?? 0) > 1 ? 's' : ''} ce mois-ci
            </Text>
            <Text style={styles.quotaLink}>Baker Pro</Text>
          </Pressable>
        )}

        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
        ) : error ? (
          <EmptyState
            icon="wifi-off"
            title="Impossible de charger le planning"
            subtitle={error}
            ctaLabel="Réessayer"
            onCta={load}
            testID="planning-retry"
          />
        ) : mode === 'staff' ? (
          schedules.length === 0 ? (
            <EmptyState
              icon="users"
              title="Aucun emploi du temps"
              subtitle={'Planifiez la semaine de votre équipe :\nLevanea calcule les heures de chacun et le total.'}
            />
          ) : (
            <View style={styles.section}>
              {schedules.map(s => (
                <SwipeableRow
                  key={s.id}
                  ref={getSwipeRef(s.id)}
                  onSwipeableWillOpen={() => {
                    if (openRowId.current && openRowId.current !== s.id) getSwipeRef(openRowId.current).current?.close();
                    openRowId.current = s.id;
                  }}
                  onSwipeableClose={() => { if (openRowId.current === s.id) openRowId.current = null; }}
                  onEdit={() => router.push(`/schedule/${s.id}` as any)}
                  onDelete={() => deleteSchedule(s.id)}
                >
                  <Pressable
                    testID={`schedule-${s.id}`}
                    onPress={() => handleRowPress(() => router.push(`/schedule/${s.id}` as any))}
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
                </SwipeableRow>
              ))}
            </View>
          )
        ) : productions.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="Aucune production planifiée"
            subtitle={'Préparez votre journée : choisissez vos recettes et vos quantités,\nLevanea calcule les ingrédients et les horaires.'}
          />
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
        accessibilityRole="button"
        accessibilityLabel={mode === 'staff' ? 'Nouvel emploi du temps' : 'Nouvelle production'}
      >
        <Feather name="plus" size={20} color={colors.onBrandPrimary} />
        <Text style={styles.fabText}>{mode === 'staff' ? 'Nouvel emploi du temps' : 'Nouvelle production'}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors, mode: ThemeMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  brandLabel: { fontSize: 11, letterSpacing: 4, color: colors.muted, fontWeight: '600' },
  title: { fontFamily: theme.serif, fontSize: 32, color: colors.onSurface, marginTop: 4 },
  quotaBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 24, marginTop: 8,
    paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg,
    ...cardElevation(mode, colors),
  },
  quotaText: { flex: 1, fontSize: 12, color: colors.onSurfaceSecondary },
  quotaLink: { fontSize: 12, color: colors.brand, fontWeight: '700' },
  section: { paddingHorizontal: 24, marginTop: 24 },
  sectionTitle: { fontFamily: theme.serif, fontSize: 22, color: colors.onSurface, marginBottom: 12 },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg, padding: 16,
    ...cardElevation(mode, colors),
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardDate: { flex: 1, fontFamily: theme.serif, fontSize: 18, color: colors.onSurface, textTransform: 'capitalize' },
  timePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandTertiary, paddingHorizontal: 9, paddingVertical: 4, borderRadius: theme.radius.pill },
  timePillText: { fontSize: 11, color: colors.onBrandTertiary, fontWeight: '700' },
  cardRecipes: { fontSize: 14, color: colors.onSurfaceSecondary, marginTop: 6, lineHeight: 19 },
  cardMetaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  cardMeta: { fontSize: 12, color: colors.muted },
  progressTrack: { height: 4, backgroundColor: colors.surfaceTertiary, borderRadius: theme.radius.pill, marginTop: 10, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: colors.brand, borderRadius: theme.radius.pill },
  fab: { position: 'absolute', left: 24, right: 24, bottom: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.brand, paddingVertical: 16, borderRadius: theme.radius.pill },
  fabText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
});
