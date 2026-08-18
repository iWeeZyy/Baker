import { View, Text, StyleSheet } from 'react-native';
import { DAY_LABELS_LONG, DAYS, dayNumbers, formatHours, weekTitle, type Schedule } from './model';

/** Fixed pixel width: the capture must not depend on the phone's screen size. */
export const EXPORT_WIDTH = 1800;

const NAME_W = 150;
const TOTAL_W = 86;
const BORDER = '#000';

/**
 * The schedule as a standalone image, laid out like the printed sheet:
 * three columns per day (start, end, hours) rather than a packed range.
 *
 * Rendered off-screen at a fixed width and captured with `react-native-view-shot`,
 * so what lands in Photos is the grid alone — no navigation, no buttons, no
 * scroll position — and identical on every device.
 */
export function ExportLayout({ schedule }: { schedule: Schedule }) {
  const numbers = dayNumbers(schedule.week_start);
  const anyOvertime = schedule.employees.some(e => (e.overtime_minutes || 0) > 0);

  const grid = EXPORT_WIDTH - 32 - NAME_W - TOTAL_W * (anyOvertime ? 2 : 1);
  const dayW = grid / DAYS;
  const timeW = dayW * 0.36;
  const hoursW = dayW - timeW * 2;

  const Cell = ({ text, w, style, bold = true }: any) => (
    <View style={[styles.cell, { width: w }, style]}>
      <Text style={[styles.cellText, bold && styles.bold]} numberOfLines={1}>{text}</Text>
    </View>
  );

  return (
    <View style={styles.page}>
      <Text style={styles.title}>{weekTitle(schedule.week_start)}</Text>

      {/* Header: day name and number, then the three sub-columns. */}
      <View style={styles.row}>
        <View style={[styles.cell, styles.nameCell, { width: NAME_W, height: 76 }]}>
          <Text style={[styles.cellText, styles.bold]}>Nom</Text>
        </View>
        {DAY_LABELS_LONG.map((label, i) => (
          <View key={label} style={{ width: dayW }}>
            <View style={[styles.cell, { width: dayW, height: 46, marginBottom: 0 }]}>
              <Text style={[styles.cellText, styles.bold]}>{label}</Text>
              <Text style={styles.dayNum}>{numbers[i]}</Text>
            </View>
            <View style={styles.row}>
              <Cell text="Début" w={timeW} style={{ height: 30 }} bold={false} />
              <Cell text="Fin" w={timeW} style={{ height: 30 }} bold={false} />
              <Cell text="Heures" w={hoursW} style={{ height: 30 }} bold={false} />
            </View>
          </View>
        ))}
        {anyOvertime && <Cell text="Supp." w={TOTAL_W} style={{ height: 76 }} />}
        <Cell text="Total" w={TOTAL_W} style={{ height: 76 }} />
      </View>

      {schedule.employees.map((e) => (
        <View key={e.employee_id || e.name} style={styles.row}>
          <View style={[styles.cell, styles.nameCell, { width: NAME_W }]}>
            <Text style={[styles.cellText, styles.bold]} numberOfLines={1}>{e.name}</Text>
          </View>
          {Array.from({ length: DAYS }, (_, i) => {
            const day = e.days[i] || null;
            if (day?.off) {
              return (
                <View key={i} style={styles.row}>
                  <Cell text="" w={timeW * 2} style={styles.off} />
                  <Cell text="0:00" w={hoursW} style={styles.offHours} />
                </View>
              );
            }
            const worked = day?.minutes || 0;
            return (
              <View key={i} style={styles.row}>
                <Cell text={day?.start || ''} w={timeW} bold={false} />
                <Cell text={day?.end || ''} w={timeW} bold={false} />
                <Cell text={worked ? formatHours(worked) : ''} w={hoursW} />
              </View>
            );
          })}
          {anyOvertime && <Cell text={e.overtime_minutes ? formatHours(e.overtime_minutes) : ''} w={TOTAL_W} />}
          <Cell text={formatHours(e.total_minutes ?? 0)} w={TOTAL_W} />
        </View>
      ))}

      <View style={styles.row}>
        <View style={[styles.cell, styles.nameCell, { width: NAME_W }]}>
          <Text style={[styles.cellText, styles.bold]}>Total / jour</Text>
        </View>
        {schedule.day_totals.map((m, i) => (
          <View key={i} style={styles.row}>
            <Cell text="" w={timeW * 2} bold={false} />
            <Cell text={formatHours(m)} w={hoursW} />
          </View>
        ))}
        {anyOvertime && <Cell text="" w={TOTAL_W} />}
        <Cell text={formatHours(schedule.grand_total_minutes)} w={TOTAL_W} />
      </View>

      <View style={styles.noteHead}><Text style={[styles.cellText, styles.bold]}>NOTE</Text></View>
      <View style={styles.noteBody}>
        <Text style={styles.noteText}>{schedule.notes?.trim() || ''}</Text>
      </View>
    </View>
  );
}

// Deliberately not driven by src/theme.ts: an exported image is printed and
// shared, so it stays high-contrast black on white rather than following the
// app's warm palette.
const styles = StyleSheet.create({
  page: { width: EXPORT_WIDTH, backgroundColor: '#FFFFFF', padding: 16 },
  title: { fontSize: 26, fontWeight: '700', color: '#000', marginBottom: 12, textAlign: 'center' },
  row: { flexDirection: 'row' },
  cell: {
    height: 42, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: BORDER, marginRight: -1, marginBottom: -1,
    paddingHorizontal: 2, backgroundColor: '#FFFFFF',
  },
  nameCell: { alignItems: 'flex-start', paddingLeft: 8 },
  off: { backgroundColor: '#B8B8B8' },
  offHours: { backgroundColor: '#D8D8D8' },
  cellText: { fontSize: 15, color: '#000' },
  bold: { fontWeight: '700' },
  dayNum: { fontSize: 12, color: '#000' },
  noteHead: { borderWidth: 1, borderColor: BORDER, alignItems: 'center', paddingVertical: 6, marginTop: 14 },
  noteBody: { borderWidth: 1, borderColor: BORDER, borderTopWidth: 0, minHeight: 90, padding: 12, alignItems: 'center' },
  noteText: { fontSize: 16, color: '#000', lineHeight: 22 },
});
