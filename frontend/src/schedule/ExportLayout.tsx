import { View, Text, StyleSheet } from 'react-native';
import { ScheduleTable } from './ScheduleTable';
import { formatHours, weekTitle, type Schedule } from './model';

/**
 * A fixed A4-landscape page, not a strip.
 *
 * The capture must not depend on the phone's screen, and the result is looked
 * at in Photos, WhatsApp or Mail — where a very wide, very short image shrinks
 * to an unreadable band. Page proportions (√2 : 1, landscape) keep the grid
 * legible in a thumbnail and print straight onto A4.
 */
export const EXPORT_WIDTH = 2245;
export const EXPORT_HEIGHT = Math.round(EXPORT_WIDTH / Math.SQRT2); // 1587

const PAGE_PADDING = 44;

export function ExportLayout({ schedule }: { schedule: Schedule }) {
  const inner = EXPORT_WIDTH - PAGE_PADDING * 2;

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.brand}>BAKER · LE FOURNIL</Text>
        <Text style={styles.title}>{weekTitle(schedule.week_start)}</Text>
        <Text style={styles.subtitle}>
          {schedule.employees.length} personne{schedule.employees.length > 1 ? 's' : ''}
          {'   ·   '}Total de la semaine {formatHours(schedule.grand_total_minutes)}
        </Text>
      </View>

      <ScheduleTable schedule={schedule} width={inner} scale={1.55} />

      <View style={styles.note}>
        <Text style={styles.noteLabel}>NOTE</Text>
        <Text style={styles.noteText}>{schedule.notes?.trim() || ''}</Text>
      </View>
    </View>
  );
}

const INK = '#2A1F1A';
const MUTED = '#8B7D72';
const LINE = '#D8CEC2';

const styles = StyleSheet.create({
  // minHeight, not height: the page always fills an A4 landscape sheet, and
  // still grows rather than clipping if a fifteenth row would not fit.
  page: {
    width: EXPORT_WIDTH, minHeight: EXPORT_HEIGHT,
    backgroundColor: '#FFFFFF', padding: PAGE_PADDING,
  },
  header: { marginBottom: 26 },
  brand: { fontSize: 17, letterSpacing: 6, color: MUTED, fontWeight: '600' },
  title: { fontSize: 46, color: INK, fontWeight: '700', marginTop: 6 },
  subtitle: { fontSize: 20, color: MUTED, marginTop: 8 },
  // The note is a separate card, plainly detached from the grid above it.
  note: { marginTop: 30, borderWidth: 1, borderColor: LINE, borderRadius: 10, padding: 22, minHeight: 150 },
  noteLabel: { fontSize: 14, letterSpacing: 3, color: MUTED, fontWeight: '700', marginBottom: 10 },
  noteText: { fontSize: 22, color: INK, lineHeight: 30 },
});
