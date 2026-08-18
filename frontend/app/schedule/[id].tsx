import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator,
  ScrollView, KeyboardAvoidingView, Platform, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { ExportLayout, EXPORT_WIDTH } from '@/src/schedule/ExportLayout';
import { ScheduleTable } from '@/src/schedule/ScheduleTable';
import { printSchedule, saveToPhotos, shareSchedule } from '@/src/schedule/export';
import {
  DAYS, DAY_LABELS, MAX_EMPLOYEES, addDays, dayNumbers, emptyWeek, formatHHMM,
  formatHours, maskHHMM, parseHHMM, sundayOf, weekTitle,
  type Schedule, type ScheduleDay, type ScheduleEmployee,
} from '@/src/schedule/model';

/** Shifts a baker actually uses, offered as one tap each. */
const PRESETS: [string, string][] = [
  ['4:00', '12:00'], ['6:00', '14:00'], ['8:00', '16:00'],
  ['10:00', '18:00'], ['12:00', '20:00'], ['14:00', '22:00'],
];

type Draft = { name: string; days: ScheduleDay[]; overtime: string; employee_id?: string };

function toDraft(e: ScheduleEmployee): Draft {
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = e.days[i];
    return d ? { off: !!d.off, start: d.start || '', end: d.end || '' } : { off: false, start: '', end: '' };
  });
  return {
    employee_id: e.employee_id,
    name: e.name,
    days,
    overtime: formatHHMM(e.overtime_minutes || 0),
  };
}

export default function ScheduleScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === 'new';

  const [weekStart, setWeekStart] = useState(sundayOf());
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Draft[]>([]);
  const [computed, setComputed] = useState<Schedule | null>(null);
  const [scheduleId, setScheduleId] = useState<string | null>(isNew ? null : String(id));

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ row: number; day: number } | null>(null);
  const [view, setView] = useState<'edit' | 'preview'>('edit');

  const exportRef = useRef<View>(null);

  const apply = useCallback((s: Schedule) => {
    setComputed(s);
    setScheduleId(s.id);
    setWeekStart(s.week_start);
    setNotes(s.notes || '');
    setRows(s.employees.map(toDraft));
  }, []);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        apply(await api(`/schedules/${id}`));
      } catch (e: any) {
        setError(e.message || 'Emploi du temps introuvable');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isNew, apply]);

  const payload = () => ({
    week_start: weekStart,
    notes: notes.trim(),
    employees: rows.map(r => ({
      employee_id: r.employee_id,
      name: r.name.trim(),
      days: r.days,
      overtime_minutes: parseHHMM(r.overtime),
    })),
  });

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const saved = scheduleId
        ? await api(`/schedules/${scheduleId}`, { method: 'PUT', body: JSON.stringify(payload()) })
        : await api('/schedules', { method: 'POST', body: JSON.stringify(payload()) });
      apply(saved);
      setFlash('Emploi du temps enregistré.');
    } catch (e: any) {
      // The draft is never cleared on failure: a lost connection must not cost
      // the manager the week they just typed in.
      setError(e.message || 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  const addRow = () => {
    if (rows.length >= MAX_EMPLOYEES) return;
    setRows(prev => [...prev, { name: '', days: emptyWeek(), overtime: '00:00' }]);
  };

  const patchDay = (row: number, day: number, patch: Partial<ScheduleDay>) =>
    setRows(prev => prev.map((r, i) => i !== row ? r : {
      ...r,
      days: r.days.map((d, j) => (j === day ? { ...d, ...patch } : d)),
    }));

  const removeRow = (row: number) => setRows(prev => prev.filter((_, i) => i !== row));

  const confirmDelete = () => {
    Alert.alert('Supprimer cet emploi du temps', 'Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive',
        onPress: async () => {
          try {
            await api(`/schedules/${scheduleId}`, { method: 'DELETE' });
            router.replace('/(tabs)/planning' as any);
          } catch (e: any) { setError(e.message || 'Suppression impossible'); }
        },
      },
    ]);
  };

  const duplicate = async () => {
    if (!scheduleId) return;
    try {
      const copy = await api(`/schedules/${scheduleId}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ week_start: addDays(weekStart, 7) }),
      });
      router.replace(`/schedule/${copy.id}` as any);
    } catch (e: any) { setError(e.message || 'Duplication impossible'); }
  };

  /**
   * Exports read the *saved* schedule, so an image can never show figures the
   * server has not computed. Unsaved edits are saved first rather than silently
   * exported from a stale copy.
   */
  const runExport = async (
    key: string,
    action: (s: Schedule) => Promise<{ ok: boolean; message: string; needsSettings?: boolean }>,
  ) => {
    setError(null);
    setFlash(null);
    if (!computed) {
      setError("Enregistrez l'emploi du temps avant de l'exporter.");
      return;
    }
    setBusy(key);
    try {
      const res = await action(computed);
      if (res.ok) {
        if (res.message) setFlash(res.message);
      } else if (res.needsSettings) {
        Alert.alert('Accès à Photos refusé', res.message, [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Ouvrir Réglages', onPress: () => Linking.openSettings() },
        ]);
      } else {
        setError(res.message);
      }
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.color.brand} /></View>;

  const numbers = dayNumbers(weekStart);
  const dirty = !computed || JSON.stringify(payload()) !== JSON.stringify({
    week_start: computed.week_start,
    notes: computed.notes,
    employees: computed.employees.map(e => ({
      employee_id: e.employee_id,
      name: e.name,
      days: toDraft(e).days,
      overtime_minutes: e.overtime_minutes,
    })),
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable testID="schedule-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{weekTitle(weekStart)}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.viewSwitch}>
        {([['edit', 'Saisie'], ['preview', 'Aperçu']] as ['edit' | 'preview', string][]).map(([key, label]) => (
          <Pressable
            key={key}
            testID={`view-${key}`}
            onPress={() => setView(key)}
            style={[styles.viewBtn, view === key && styles.viewBtnOn]}
          >
            <Text style={[styles.viewText, view === key && styles.viewTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {view === 'preview' ? (
        <ScrollView contentContainerStyle={styles.previewBody}>
          {computed ? (
            <>
              <Text style={styles.previewTitle}>{weekTitle(weekStart)}</Text>
              <Text style={styles.previewSub}>
                {computed.employees.length} personne{computed.employees.length > 1 ? 's' : ''}
                {'   ·   '}Total {formatHours(computed.grand_total_minutes)}
              </Text>
              {/*
                Horizontal scrolling rather than squeezed columns: a seven-day
                grid cannot shrink to a phone's width without becoming unreadable.
              */}
              <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingRight: 20 }}>
                <ScheduleTable schedule={computed} width={1180} scale={1} />
              </ScrollView>
              {computed.notes ? (
                <View style={styles.previewNote}>
                  <Text style={styles.previewNoteLabel}>NOTE</Text>
                  <Text style={styles.previewNoteText}>{computed.notes}</Text>
                </View>
              ) : null}
              {dirty && (
                <Text style={styles.dirtyHint}>
                  Modifications non enregistrées : l'aperçu montre la dernière version enregistrée.
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.hint}>Enregistrez l'emploi du temps pour voir l'aperçu.</Text>
          )}
        </ScrollView>
      ) : (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>SEMAINE (DIMANCHE)</Text>
          <View style={styles.weekRow}>
            <Pressable testID="week-prev" onPress={() => setWeekStart(w => addDays(w, -7))} style={styles.weekBtn}>
              <Feather name="chevron-left" size={18} color={theme.color.onSurface} />
            </Pressable>
            <TextInput
              testID="week-start" value={weekStart} onChangeText={setWeekStart}
              placeholder="AAAA-MM-JJ" placeholderTextColor={theme.color.muted} style={styles.weekInput}
            />
            <Pressable testID="week-next" onPress={() => setWeekStart(w => addDays(w, 7))} style={styles.weekBtn}>
              <Feather name="chevron-right" size={18} color={theme.color.onSurface} />
            </Pressable>
          </View>

          <Text style={[styles.label, { marginTop: 24 }]}>ÉQUIPE</Text>
          {rows.length === 0 && (
            <Text style={styles.hint}>Aucune personne. Ajoutez-en une ci-dessous.</Text>
          )}

          {rows.map((row, ri) => {
            const live = computed?.employees[ri];
            return (
              <View key={ri} style={styles.personCard} testID={`person-${ri}`}>
                <View style={styles.personTop}>
                  <TextInput
                    testID={`name-${ri}`}
                    value={row.name}
                    onChangeText={v => setRows(prev => prev.map((r, i) => (i === ri ? { ...r, name: v } : r)))}
                    placeholder="Nom" placeholderTextColor={theme.color.muted}
                    style={styles.nameInput}
                  />
                  <Pressable testID={`remove-${ri}`} onPress={() => removeRow(ri)} style={styles.removeBtn}>
                    <Feather name="x" size={18} color={theme.color.muted} />
                  </Pressable>
                </View>

                <View style={styles.daysRow}>
                  {row.days.map((d, di) => {
                    const filled = !!(d.start && d.end);
                    return (
                      <Pressable
                        key={di}
                        testID={`cell-${ri}-${di}`}
                        onPress={() => setPicker(p => (p?.row === ri && p?.day === di ? null : { row: ri, day: di }))}
                        onLongPress={() => patchDay(ri, di, { off: !d.off, start: '', end: '' })}
                        style={[styles.dayCell, d.off && styles.dayCellOff, filled && !d.off && styles.dayCellOn]}
                      >
                        <Text style={styles.dayLabel}>{DAY_LABELS[di]}</Text>
                        <Text style={styles.dayNum}>{numbers[di]}</Text>
                        <Text style={[styles.dayValue, d.off && styles.dayValueOff]} numberOfLines={1}>
                          {d.off ? '0:00' : filled ? d.start : '—'}
                        </Text>
                        {!d.off && filled && <Text style={styles.dayValue} numberOfLines={1}>{d.end}</Text>}
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.longPressHint}>Appui long sur un jour = repos</Text>

                {picker?.row === ri && (
                  <View style={styles.picker}>
                    <Text style={styles.pickerTitle}>
                      {DAY_LABELS[picker.day]} {numbers[picker.day]}
                    </Text>
                    <View style={styles.presetRow}>
                      {PRESETS.map(([s, e]) => (
                        <Pressable
                          key={`${s}-${e}`}
                          testID={`preset-${ri}-${picker.day}-${s}`}
                          onPress={() => { patchDay(ri, picker.day, { start: s, end: e, off: false }); setPicker(null); }}
                          style={styles.preset}
                        >
                          <Text style={styles.presetText}>{s.replace(':00', '')}-{e.replace(':00', '')}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={styles.customRow}>
                      <TextInput
                        testID={`start-${ri}-${picker.day}`}
                        value={row.days[picker.day].start}
                        onChangeText={v => patchDay(ri, picker.day, { start: v, off: false })}
                        placeholder="début" placeholderTextColor={theme.color.muted} style={styles.timeInput}
                      />
                      <Text style={styles.arrow}>→</Text>
                      <TextInput
                        testID={`end-${ri}-${picker.day}`}
                        value={row.days[picker.day].end}
                        onChangeText={v => patchDay(ri, picker.day, { end: v, off: false })}
                        placeholder="fin" placeholderTextColor={theme.color.muted} style={styles.timeInput}
                      />
                      <Pressable
                        testID={`clear-${ri}-${picker.day}`}
                        onPress={() => { patchDay(ri, picker.day, { start: '', end: '', off: false }); setPicker(null); }}
                        style={styles.clearBtn}
                      >
                        <Text style={styles.clearText}>Vider</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                <View style={styles.personFooter}>
                  <View style={styles.overtimeBox}>
                    <Text style={styles.overtimeLabel}>Heures supp.{'\n'}(h:min)</Text>
                    <TextInput
                      testID={`overtime-${ri}`}
                      value={row.overtime}
                      onChangeText={v => setRows(prev => prev.map((r, i) => (i === ri ? { ...r, overtime: maskHHMM(v) } : r)))}
                      keyboardType="numeric"
                      selectTextOnFocus
                      style={styles.overtimeInput}
                    />
                  </View>
                  <Text style={styles.personTotal}>
                    {live && !dirty ? formatHours(live.total_minutes ?? 0) : '—'}
                  </Text>
                </View>
              </View>
            );
          })}

          <Pressable
            testID="add-person" onPress={addRow} disabled={rows.length >= MAX_EMPLOYEES}
            style={[styles.addBtn, rows.length >= MAX_EMPLOYEES && { opacity: 0.4 }]}
          >
            <Feather name="plus" size={16} color={theme.color.brand} />
            <Text style={styles.addBtnText}>
              Ajouter une personne ({rows.length}/{MAX_EMPLOYEES})
            </Text>
          </Pressable>

          <Text style={[styles.label, { marginTop: 24 }]}>NOTE</Text>
          <TextInput
            testID="schedule-notes" value={notes} onChangeText={setNotes} multiline
            placeholder="Ex : Jeudi 5, Armand off, rattrapage heures supp."
            placeholderTextColor={theme.color.muted}
            style={[styles.notesInput, { minHeight: 64 }]}
          />

          {computed && !dirty && (
            <View style={styles.totalsCard} testID="totals">
              <Text style={styles.totalsLabel}>TOTAL DE LA SEMAINE</Text>
              <Text style={styles.totalsValue}>{formatHours(computed.grand_total_minutes)}</Text>
              <View style={styles.dayTotals}>
                {computed.day_totals.map((m, i) => (
                  <View key={i} style={styles.dayTotal}>
                    <Text style={styles.dayTotalLabel}>{DAY_LABELS[i]}</Text>
                    <Text style={styles.dayTotalValue}>{formatHours(m)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {error && <Text style={styles.error} testID="schedule-error">{error}</Text>}
          {flash && <Text style={styles.flash} testID="schedule-flash">{flash}</Text>}

          <Pressable
            testID="schedule-save" onPress={save} disabled={saving}
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Feather name="check" size={17} color="#fff" />
                <Text style={styles.saveText}>Enregistrer</Text>
              </>
            )}
          </Pressable>

          {scheduleId && (
            <>
              {dirty && (
                <Text style={styles.dirtyHint}>
                  Enregistrez pour mettre à jour les totaux et les exports.
                </Text>
              )}
              <View style={styles.exportRow}>
                {([
                  ['photos', 'image', 'Photos', (s: Schedule) => saveToPhotos(exportRef, s)],
                  ['print', 'printer', 'Imprimer', (s: Schedule) => printSchedule(s)],
                  ['share', 'share', 'Partager', (s: Schedule) => shareSchedule(exportRef, s)],
                ] as const).map(([key, icon, label, action]) => (
                  <Pressable
                    key={key}
                    testID={`export-${key}`}
                    onPress={() => runExport(key, action as any)}
                    disabled={busy !== null || dirty}
                    style={[styles.exportBtn, (busy !== null || dirty) && { opacity: 0.45 }]}
                  >
                    {busy === key
                      ? <ActivityIndicator size="small" color={theme.color.brand} />
                      : <Feather name={icon as any} size={18} color={theme.color.brand} />}
                    <Text style={styles.exportText}>{label}</Text>
                  </Pressable>
                ))}
              </View>

              <Pressable testID="schedule-duplicate" onPress={duplicate} style={styles.secondaryBtn}>
                <Feather name="copy" size={15} color={theme.color.onSurface} />
                <Text style={styles.secondaryText}>Dupliquer sur la semaine suivante</Text>
              </Pressable>

              <Pressable testID="schedule-delete" onPress={confirmDelete} style={styles.deleteBtn}>
                <Text style={styles.deleteText}>Supprimer cet emploi du temps</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      )}

      {/*
        The export layout, rendered off-screen at a fixed size. Positioned far
        outside the viewport rather than hidden: a view with no layout cannot be
        captured, and `collapsable={false}` keeps it a real native view.
      */}
      {computed && (
        <View style={styles.offscreen} pointerEvents="none">
          <View ref={exportRef} collapsable={false} style={{ width: EXPORT_WIDTH }}>
            <ExportLayout schedule={computed} />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: theme.serif, fontSize: 16, color: theme.color.onSurface },
  body: { padding: 20, paddingBottom: 60 },
  viewSwitch: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 12 },
  viewBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 999, backgroundColor: theme.color.surfaceSecondary },
  viewBtnOn: { backgroundColor: theme.color.brand },
  viewText: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '600' },
  viewTextOn: { color: '#fff' },
  previewBody: { padding: 20, paddingBottom: 60 },
  previewTitle: { fontFamily: theme.serif, fontSize: 22, color: theme.color.onSurface },
  previewSub: { fontSize: 12, color: theme.color.muted, marginTop: 4, marginBottom: 16 },
  previewNote: { marginTop: 16, borderWidth: 1, borderColor: theme.color.border, borderRadius: 8, padding: 14 },
  previewNoteLabel: { fontSize: 10, letterSpacing: 2, color: theme.color.muted, fontWeight: '700', marginBottom: 6 },
  previewNoteText: { fontSize: 14, color: theme.color.onSurface, lineHeight: 20 },
  label: { fontSize: 11, letterSpacing: 2, color: theme.color.muted, fontWeight: '600', marginBottom: 8 },
  hint: { fontSize: 13, color: theme.color.muted, fontStyle: 'italic' },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weekBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: theme.color.surfaceSecondary },
  weekInput: { flex: 1, fontSize: 16, color: theme.color.onSurface, textAlign: 'center', paddingVertical: 12, backgroundColor: theme.color.surfaceSecondary, borderRadius: 8 },
  personCard: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 10, padding: 12, marginBottom: 12 },
  personTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: { flex: 1, fontFamily: theme.serif, fontSize: 17, color: theme.color.onSurface, paddingVertical: 8 },
  removeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  daysRow: { flexDirection: 'row', gap: 4, marginTop: 8 },
  dayCell: { flex: 1, minHeight: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: theme.color.surface, paddingVertical: 5 },
  dayCellOn: { backgroundColor: theme.color.brandTertiary },
  dayCellOff: { backgroundColor: theme.color.surfaceTertiary },
  dayLabel: { fontSize: 9, letterSpacing: 0.5, color: theme.color.muted, fontWeight: '700' },
  dayNum: { fontSize: 9, color: theme.color.muted },
  dayValue: { fontSize: 10, color: theme.color.onSurface, fontWeight: '600' },
  dayValueOff: { color: theme.color.muted },
  longPressHint: { fontSize: 10, color: theme.color.muted, marginTop: 6 },
  picker: { marginTop: 10, backgroundColor: theme.color.surface, borderRadius: 8, padding: 10 },
  pickerTitle: { fontSize: 12, color: theme.color.muted, fontWeight: '700', marginBottom: 8 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  preset: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: theme.color.brandTertiary },
  presetText: { fontSize: 12, color: theme.color.onBrandTertiary, fontWeight: '700' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  timeInput: { flex: 1, fontSize: 15, color: theme.color.onSurface, backgroundColor: theme.color.surfaceSecondary, borderRadius: 6, paddingVertical: 10, textAlign: 'center' },
  arrow: { color: theme.color.muted },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 11, borderRadius: 6, borderWidth: 1, borderColor: theme.color.borderStrong },
  clearText: { fontSize: 12, color: theme.color.onSurface, fontWeight: '600' },
  personFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  overtimeBox: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  overtimeLabel: { fontSize: 11, color: theme.color.muted },
  overtimeInput: { width: 74, fontSize: 14, color: theme.color.onSurface, backgroundColor: theme.color.surface, borderRadius: 6, paddingVertical: 8, textAlign: 'center' },
  personTotal: { fontFamily: theme.serif, fontSize: 20, color: theme.color.brand },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.borderStrong },
  addBtnText: { fontSize: 14, color: theme.color.brand, fontWeight: '600' },
  notesInput: { fontSize: 15, color: theme.color.onSurface, backgroundColor: theme.color.surfaceSecondary, borderRadius: 8, padding: 12, textAlignVertical: 'top' },
  totalsCard: { marginTop: 24, backgroundColor: theme.color.surfaceInverse, borderRadius: 10, padding: 16 },
  totalsLabel: { fontSize: 10, letterSpacing: 2, color: theme.color.brandSecondary, fontWeight: '700' },
  totalsValue: { fontFamily: theme.serif, fontSize: 34, color: theme.color.onSurfaceInverse, marginTop: 2 },
  dayTotals: { flexDirection: 'row', marginTop: 12, gap: 4 },
  dayTotal: { flex: 1, alignItems: 'center' },
  dayTotalLabel: { fontSize: 9, color: theme.color.brandSecondary, fontWeight: '700' },
  dayTotalValue: { fontSize: 11, color: theme.color.onSurfaceInverse, marginTop: 2 },
  error: { color: theme.color.error, fontSize: 13, marginTop: 16, lineHeight: 18 },
  flash: { color: theme.color.success, fontSize: 13, marginTop: 16, lineHeight: 18, fontWeight: '600' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.color.brand, paddingVertical: 16, borderRadius: 8, marginTop: 22 },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  dirtyHint: { fontSize: 12, color: theme.color.muted, textAlign: 'center', marginTop: 14 },
  exportRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  exportBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.color.borderStrong },
  exportText: { fontSize: 12, color: theme.color.onSurface, fontWeight: '600' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 8, backgroundColor: theme.color.surfaceSecondary, marginTop: 10 },
  secondaryText: { fontSize: 14, color: theme.color.onSurface, fontWeight: '600' },
  deleteBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  deleteText: { color: theme.color.error, fontSize: 13, fontWeight: '600' },
  // Off-screen rather than transparent: html2canvas honours opacity, so an
  // opacity of 0 would capture a blank image.
  offscreen: { position: 'absolute', left: -20000, top: 0 },
});
