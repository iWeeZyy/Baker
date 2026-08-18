import { useCallback, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { useTimer } from '@/src/TimerContext';
import { theme } from '@/src/theme';

type Line = {
  line_id: string;
  recipe_id: string;
  recipe_title: string;
  mode: 'pieces' | 'batches';
  quantity: number;
  yield_pieces: number | null;
  batches: number;
};

type Step = {
  step_id: string;
  line_id: string;
  recipe_title: string;
  order: number;
  text: string;
  duration_minutes: number | null;
  duration_source: 'recipe' | 'manual' | null;
  status: 'todo' | 'doing' | 'done';
  start_at: string | null;
  end_at: string | null;
};

type Detail = {
  id: string;
  date: string;
  target_time: string | null;
  notes: string;
  lines: Line[];
  steps: Step[];
  ingredients: {
    items: { name: string; quantity: number; unit: string }[];
    unparsed: string[];
  };
  missing_durations: string[];
  scheduled: boolean;
  total_pieces: number | null;
};

type Tab = 'summary' | 'ingredients' | 'schedule';

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

/**
 * A schedule back-planned from 06:00 routinely starts the previous evening, so
 * a bare clock time would be dangerously ambiguous. Anything not on the
 * production day is labelled explicitly.
 */
function dayLabel(iso: string, productionDate: string): string | null {
  const day = iso.slice(0, 10);
  if (day === productionDate) return null;
  return day < productionDate ? 'la veille' : 'le lendemain';
}

/** French decimals use a comma: 6.667 reads as "6,667". */
const fr = (n: number) => String(n).replace('.', ',');

/** A batch multiplier, at most two decimals: 13.3333 reads as "13,33". */
function formatDecimal(n: number) {
  return fr(Number(n.toFixed(2)));
}

function formatMinutes(m: number) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`;
}

const NEXT_STATUS: Record<Step['status'], Step['status']> = {
  todo: 'doing',
  doing: 'done',
  done: 'todo',
};

export default function ProductionDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { start } = useTimer();

  const [data, setData] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [durationDrafts, setDurationDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setData(await api(`/productions/${id}`));
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Production introuvable');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const patchStep = async (stepId: string, body: Record<string, unknown>) => {
    setBusyStep(stepId);
    setError(null);
    try {
      // The server returns the whole production: one round-trip also refreshes
      // the schedule, which a new duration may have unblocked upstream.
      setData(await api(`/productions/${id}/steps/${stepId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }));
    } catch (e: any) {
      setError(e.message || 'Mise à jour impossible');
    } finally {
      setBusyStep(null);
    }
  };

  /**
   * Arming the timer *is* the act of starting the step, so the status follows
   * rather than asking the baker to declare it a second time.
   */
  const startTimer = (step: Step) => {
    if (step.duration_minutes == null) return;
    start(`${step.recipe_title} — étape ${step.order + 1}`, step.duration_minutes * 60);
    if (step.status === 'todo') patchStep(step.step_id, { status: 'doing' });
  };

  const submitDuration = (stepId: string) => {
    const raw = (durationDrafts[stepId] || '').replace(',', '.').trim();
    const minutes = Math.round(parseFloat(raw));
    if (!raw || isNaN(minutes) || minutes <= 0) {
      setError('Indiquez une durée en minutes (par exemple 90).');
      return;
    }
    setDurationDrafts(prev => ({ ...prev, [stepId]: '' }));
    patchStep(stepId, { duration_minutes: minutes });
  };

  const confirmDelete = () => {
    Alert.alert('Supprimer cette production', 'Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/productions/${id}`, { method: 'DELETE' });
            router.replace('/(tabs)/planning' as any);
          } catch (e: any) {
            setError(e.message || 'Suppression impossible');
          }
        },
      },
    ]);
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>;
  }

  if (!data) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Feather name="alert-circle" size={34} color={theme.color.muted} />
          <Text style={styles.emptyText}>{error || 'Production introuvable'}</Text>
          <Pressable testID="detail-back" onPress={() => router.back()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retour</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const doneCount = data.steps.filter(s => s.status === 'done').length;
  const missing = new Set(data.missing_durations);

  /**
   * Chronological order, with undated steps kept where they belong.
   *
   * A step with no duration leaves everything before it in its recipe undated
   * too. Sorting on the timestamp alone would dump that whole run at the
   * bottom — putting the autolyse *after* the bake. Undated steps therefore
   * borrow their recipe's earliest known time, and the recipe's own order
   * breaks the tie, which is chronological by construction.
   */
  const anchors = new Map<string, string>();
  for (const s of data.steps) {
    const t = s.start_at || s.end_at;
    if (!t) continue;
    const current = anchors.get(s.line_id);
    if (!current || t < current) anchors.set(s.line_id, t);
  }

  const orderedSteps = [...data.steps].sort((a, b) => {
    const ta = a.start_at || a.end_at || anchors.get(a.line_id) || '';
    const tb = b.start_at || b.end_at || anchors.get(b.line_id) || '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    if (a.line_id !== b.line_id) return a.line_id < b.line_id ? -1 : 1;
    return a.order - b.order;
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="detail-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{formatDate(data.date)}</Text>
        <Pressable
          testID="detail-edit"
          onPress={() => router.push({ pathname: '/production/new', params: { id: data.id } } as any)}
          style={styles.iconBtn}
        >
          <Feather name="edit-2" size={18} color={theme.color.onSurface} />
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {([['summary', 'Résumé'], ['ingredients', 'Ingrédients'], ['schedule', 'Déroulé']] as [Tab, string][])
          .map(([key, label]) => (
            <Pressable
              key={key}
              testID={`tab-${key}`}
              onPress={() => setTab(key)}
              style={[styles.tab, tab === key && styles.tabOn]}
            >
              <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
      </View>

      {error && <Text style={styles.error} testID="detail-error">{error}</Text>}

      <ScrollView contentContainerStyle={styles.body}>
        {tab === 'summary' && (
          <>
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{data.target_time || '—'}</Text>
                <Text style={styles.statLabel}>PRÊT À</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>
                  {data.total_pieces != null ? data.total_pieces : '—'}
                </Text>
                <Text style={styles.statLabel}>PIÈCES</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{doneCount}/{data.steps.length}</Text>
                <Text style={styles.statLabel}>ÉTAPES</Text>
              </View>
            </View>

            {data.lines.length === 0 ? (
              <View style={styles.emptyBox}>
                <Feather name="book-open" size={32} color={theme.color.muted} />
                <Text style={styles.emptyText}>
                  Aucune recette dans cette production.{'\n'}Modifiez-la pour en ajouter.
                </Text>
              </View>
            ) : (
              data.lines.map(l => (
                <View key={l.line_id} style={styles.lineCard} testID={`sum-${l.line_id}`}>
                  <Text style={styles.lineTitle}>{l.recipe_title}</Text>
                  <Text style={styles.lineMeta}>
                    {l.mode === 'pieces'
                      ? `${l.quantity} pièces · ${formatDecimal(l.batches)} fournée${l.batches > 1 ? 's' : ''}`
                      : `${l.quantity} fournée${l.quantity > 1 ? 's' : ''}${l.yield_pieces ? ` · ${Math.round(l.batches * l.yield_pieces)} pièces` : ''}`}
                  </Text>
                </View>
              ))
            )}

            {!data.target_time && (
              <Text style={styles.notice}>
                Aucune heure cible : les étapes ne sont pas datées. Ajoutez-en une en modifiant la production.
              </Text>
            )}

            {data.notes ? (
              <>
                <Text style={styles.sectionLabel}>NOTES</Text>
                <Text style={styles.notes}>{data.notes}</Text>
              </>
            ) : null}

            <Pressable testID="detail-delete" onPress={confirmDelete} style={styles.deleteBtn}>
              <Text style={styles.deleteText}>Supprimer cette production</Text>
            </Pressable>
          </>
        )}

        {tab === 'ingredients' && (
          <>
            {data.ingredients.items.length === 0 && data.ingredients.unparsed.length === 0 ? (
              <View style={styles.emptyBox}>
                <Feather name="shopping-bag" size={32} color={theme.color.muted} />
                <Text style={styles.emptyText}>
                  Aucun ingrédient à totaliser.{'\n'}Les recettes de cette production n'en listent pas.
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.sectionLabel}>TOTAUX</Text>
                {data.ingredients.items.map(item => (
                  <View key={`${item.name}-${item.unit}`} style={styles.ingRow} testID={`ing-${item.name}`}>
                    <Text style={styles.ingName}>{item.name}</Text>
                    <Text style={styles.ingQty}>{fr(item.quantity)} {item.unit}</Text>
                  </View>
                ))}

                {data.ingredients.unparsed.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { marginTop: 28 }]}>À VÉRIFIER</Text>
                    <Text style={styles.hint}>
                      Ces lignes n'indiquent pas de quantité mesurable : elles ne sont pas multipliées.
                    </Text>
                    {data.ingredients.unparsed.map((raw, i) => (
                      <View key={`${raw}-${i}`} style={styles.ingRow}>
                        <Text style={[styles.ingName, { color: theme.color.muted }]}>{raw}</Text>
                      </View>
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}

        {tab === 'schedule' && (
          <>
            {orderedSteps.length === 0 ? (
              <View style={styles.emptyBox}>
                <Feather name="list" size={32} color={theme.color.muted} />
                <Text style={styles.emptyText}>Aucune étape à dérouler.</Text>
              </View>
            ) : (
              orderedSteps.map(step => {
                const needsDuration = missing.has(step.step_id);
                const day = step.start_at ? dayLabel(step.start_at, data.date) : null;
                return (
                  <View
                    key={step.step_id}
                    style={[styles.stepCard, step.status === 'done' && styles.stepCardDone]}
                    testID={`step-${step.step_id}`}
                  >
                    <View style={styles.stepTop}>
                      <Pressable
                        testID={`status-${step.step_id}`}
                        onPress={() => patchStep(step.step_id, { status: NEXT_STATUS[step.status] })}
                        disabled={busyStep === step.step_id}
                        style={[
                          styles.statusBtn,
                          step.status === 'doing' && styles.statusBtnDoing,
                          step.status === 'done' && styles.statusBtnDone,
                        ]}
                      >
                        {busyStep === step.step_id ? (
                          <ActivityIndicator size="small" color={theme.color.brand} />
                        ) : (
                          <Feather
                            name={step.status === 'done' ? 'check' : step.status === 'doing' ? 'loader' : 'circle'}
                            size={16}
                            color={step.status === 'todo' ? theme.color.muted : '#fff'}
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
                          <Feather name="clock" size={11} color={theme.color.onBrandTertiary} />
                          <Text style={styles.timePillText}>
                            {day ? `${day} ` : ''}{clock(step.start_at)}
                            {step.end_at ? ` → ${clock(step.end_at)}` : ''}
                          </Text>
                        </View>
                      ) : null}
                      {step.duration_minutes != null && (
                        <Text style={styles.stepDuration}>
                          {formatMinutes(step.duration_minutes)}
                          {step.duration_source === 'manual' ? ' (saisie)' : ''}
                        </Text>
                      )}
                    </View>

                    {/* A hand-entered duration arms a timer just like one read
                        from the recipe: only the label distinguishes them. */}
                    {step.duration_minutes != null && step.status !== 'done' && (
                      <Pressable
                        testID={`timer-${step.step_id}`}
                        onPress={() => startTimer(step)}
                        style={styles.timerChip}
                      >
                        <Feather name="clock" size={13} color={theme.color.onBrandTertiary} />
                        <Text style={styles.timerChipText}>
                          Lancer le minuteur ({formatMinutes(step.duration_minutes)})
                        </Text>
                      </Pressable>
                    )}

                    {needsDuration && (
                      <View style={styles.durationBox}>
                        <Text style={styles.durationHint}>
                          Durée inconnue : les étapes précédentes ne peuvent pas être datées.
                        </Text>
                        <View style={styles.durationRow}>
                          <TextInput
                            testID={`duration-${step.step_id}`}
                            value={durationDrafts[step.step_id] || ''}
                            onChangeText={v => setDurationDrafts(prev => ({ ...prev, [step.step_id]: v }))}
                            keyboardType="numeric"
                            placeholder="minutes"
                            placeholderTextColor={theme.color.muted}
                            style={styles.durationInput}
                          />
                          <Pressable
                            testID={`duration-save-${step.step_id}`}
                            onPress={() => submitDuration(step.step_id)}
                            style={styles.durationBtn}
                          >
                            <Text style={styles.durationBtnText}>Valider</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: theme.serif, fontSize: 18, color: theme.color.onSurface, textTransform: 'capitalize' },
  tabs: { flexDirection: 'row', gap: 6, paddingHorizontal: 24, paddingTop: 14 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 999, backgroundColor: theme.color.surfaceSecondary },
  tabOn: { backgroundColor: theme.color.brand },
  tabText: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '600' },
  tabTextOn: { color: '#fff' },
  body: { padding: 24, paddingBottom: 60 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  stat: { flex: 1, alignItems: 'center', backgroundColor: theme.color.surfaceSecondary, borderRadius: 8, paddingVertical: 16 },
  statValue: { fontFamily: theme.serif, fontSize: 22, color: theme.color.onSurface },
  statLabel: { fontSize: 10, letterSpacing: 1.6, color: theme.color.muted, fontWeight: '600', marginTop: 4 },
  sectionLabel: { fontSize: 11, letterSpacing: 2, color: theme.color.muted, fontWeight: '600', marginTop: 18, marginBottom: 10 },
  lineCard: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 8, padding: 14, marginBottom: 10 },
  lineTitle: { fontFamily: theme.serif, fontSize: 17, color: theme.color.onSurface },
  lineMeta: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 4 },
  notice: { fontSize: 12, color: theme.color.muted, lineHeight: 17, marginTop: 14 },
  notes: { fontSize: 14, color: theme.color.onSurfaceSecondary, lineHeight: 21 },
  ingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  ingName: { flex: 1, fontSize: 15, color: theme.color.onSurface },
  ingQty: { fontFamily: theme.serif, fontSize: 17, color: theme.color.brand },
  hint: { fontSize: 12, color: theme.color.muted, lineHeight: 17, marginBottom: 6 },
  stepCard: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 8, padding: 14, marginBottom: 10 },
  stepCardDone: { opacity: 0.6 },
  stepTop: { flexDirection: 'row', gap: 12 },
  statusBtn: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.color.borderStrong, backgroundColor: theme.color.surface },
  statusBtnDoing: { backgroundColor: theme.color.warning, borderColor: theme.color.warning },
  statusBtnDone: { backgroundColor: theme.color.success, borderColor: theme.color.success },
  stepRecipe: { fontSize: 11, letterSpacing: 1, color: theme.color.muted, fontWeight: '600', textTransform: 'uppercase' },
  stepText: { fontSize: 14, color: theme.color.onSurface, lineHeight: 20, marginTop: 3 },
  stepTextDone: { textDecorationLine: 'line-through', color: theme.color.muted },
  stepMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, marginLeft: 56 },
  timePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.color.brandTertiary, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  timePillText: { fontSize: 11, color: theme.color.onBrandTertiary, fontWeight: '700' },
  stepDuration: { fontSize: 11, color: theme.color.muted },
  timerChip: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginLeft: 56, alignSelf: 'flex-start', backgroundColor: theme.color.brandTertiary, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999 },
  timerChipText: { fontSize: 12, color: theme.color.onBrandTertiary, fontWeight: '600' },
  durationBox: { marginTop: 12, marginLeft: 56 },
  durationHint: { fontSize: 11, color: theme.color.muted, lineHeight: 16 },
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  durationInput: { flex: 1, fontSize: 15, color: theme.color.onSurface, backgroundColor: theme.color.surface, borderRadius: 6, paddingVertical: 11, paddingHorizontal: 12 },
  durationBtn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 6, backgroundColor: theme.color.brand },
  durationBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  emptyBox: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 30, marginTop: 50 },
  emptyText: { fontSize: 14, color: theme.color.muted, textAlign: 'center', lineHeight: 20 },
  retryBtn: { marginTop: 6, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 999, borderWidth: 1, borderColor: theme.color.borderStrong },
  retryText: { fontSize: 14, color: theme.color.onSurface, fontWeight: '600' },
  error: { color: theme.color.error, fontSize: 13, paddingHorizontal: 24, paddingTop: 12, lineHeight: 18 },
  deleteBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 20 },
  deleteText: { color: theme.color.error, fontSize: 13, fontWeight: '600' },
});
