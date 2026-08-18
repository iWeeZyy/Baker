import { View, Text, StyleSheet } from 'react-native';
import { DAY_LABELS, DAYS, cellText, dayNumbers, formatHours, weekTitle, type Schedule } from './model';

/** Fixed pixel width: the capture must not depend on the phone's screen size. */
export const EXPORT_WIDTH = 1400;

const NAME_W = 210;
const TOTAL_W = 120;

/**
 * The schedule as a standalone image.
 *
 * Rendered off-screen at a fixed width and captured with `react-native-view-shot`,
 * so what lands in Photos is the grid alone — no navigation, no buttons, no
 * scroll position — and identical on every device.
 */
export function ExportLayout({ schedule }: { schedule: Schedule }) {
  const numbers = dayNumbers(schedule.week_start);
  const anyOvertime = schedule.employees.some(e => (e.overtime_minutes || 0) > 0);
  const dayW = (EXPORT_WIDTH - NAME_W - TOTAL_W * (anyOvertime ? 2 : 1) - 48) / DAYS;

  const Cell = ({ text, w, off, bold, head }: { text: string; w: number; off?: boolean; bold?: boolean; head?: boolean }) => (
    <View style={[styles.cell, { width: w }, head && styles.headCell, off && styles.offCell]}>
      <Text style={[styles.cellText, bold && styles.bold]} numberOfLines={1}>{text}</Text>
    </View>
  );

  return (
    <View style={styles.page}>
      <Text style={styles.title}>{weekTitle(schedule.week_start)}</Text>
      <Text style={styles.subtitle}>
        Emploi du temps du personnel — {schedule.employees.length} personne
        {schedule.employees.length > 1 ? 's' : ''} · total {formatHours(schedule.grand_total_minutes)}
      </Text>

      <View style={styles.row}>
        <View style={[styles.cell, styles.headCell, styles.nameCell, { width: NAME_W }]}>
          <Text style={[styles.cellText, styles.bold]}>Nom</Text>
        </View>
        {DAY_LABELS.map((label, i) => (
          <View key={label} style={[styles.cell, styles.headCell, { width: dayW }]}>
            <Text style={[styles.cellText, styles.bold]}>{label}</Text>
            <Text style={styles.dayNum}>{numbers[i]}</Text>
          </View>
        ))}
        {anyOvertime && <Cell text="Supp." w={TOTAL_W} head bold />}
        <Cell text="Total" w={TOTAL_W} head bold />
      </View>

      {schedule.employees.map((e) => (
        <View key={e.employee_id || e.name} style={styles.row}>
          <View style={[styles.cell, styles.nameCell, { width: NAME_W }]}>
            <Text style={[styles.cellText, styles.bold]} numberOfLines={1}>{e.name}</Text>
          </View>
          {Array.from({ length: DAYS }, (_, i) => {
            const day = e.days[i] || null;
            return <Cell key={i} text={cellText(day)} w={dayW} off={!!day?.off} />;
          })}
          {anyOvertime && (
            <Cell text={e.overtime_minutes ? formatHours(e.overtime_minutes) : ''} w={TOTAL_W} bold />
          )}
          <Cell text={formatHours(e.total_minutes ?? 0)} w={TOTAL_W} bold />
        </View>
      ))}

      <View style={[styles.row, styles.totalsRow]}>
        <View style={[styles.cell, styles.nameCell, { width: NAME_W }]}>
          <Text style={[styles.cellText, styles.bold]}>Total / jour</Text>
        </View>
        {schedule.day_totals.map((m, i) => (
          <Cell key={i} text={formatHours(m)} w={dayW} bold />
        ))}
        {anyOvertime && <Cell text="" w={TOTAL_W} />}
        <Cell text={formatHours(schedule.grand_total_minutes)} w={TOTAL_W} bold />
      </View>

      <View style={styles.note}>
        <Text style={styles.noteLabel}>NOTE</Text>
        <Text style={styles.noteText}>{schedule.notes?.trim() || '—'}</Text>
      </View>
    </View>
  );
}

// Deliberately not driven by src/theme.ts: an exported image is printed and
// shared, so it stays high-contrast black on white rather than following the
// app's warm palette.
const styles = StyleSheet.create({
  page: { width: EXPORT_WIDTH, backgroundColor: '#FFFFFF', padding: 24 },
  title: { fontSize: 30, fontWeight: '700', color: '#111', marginBottom: 4 },
  subtitle: { fontSize: 15, color: '#666', marginBottom: 18 },
  row: { flexDirection: 'row' },
  cell: {
    minHeight: 46, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#999', marginRight: -1, marginBottom: -1,
    paddingHorizontal: 4, backgroundColor: '#FFFFFF',
  },
  nameCell: { alignItems: 'flex-start', paddingLeft: 10 },
  headCell: { backgroundColor: '#ECECEC' },
  offCell: { backgroundColor: '#D6D6D6' },
  totalsRow: { marginTop: 0 },
  cellText: { fontSize: 16, color: '#111' },
  bold: { fontWeight: '700' },
  dayNum: { fontSize: 12, color: '#555' },
  note: { marginTop: 20, borderWidth: 1, borderColor: '#999', padding: 12, minHeight: 70 },
  noteLabel: { fontSize: 11, letterSpacing: 2, color: '#666', marginBottom: 6 },
  noteText: { fontSize: 15, color: '#111', lineHeight: 21 },
});
