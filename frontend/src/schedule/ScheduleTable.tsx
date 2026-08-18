import { View, Text, StyleSheet } from 'react-native';
import { computeColumns, dayWidth } from './columns';
import { DAY_LABELS_LONG, DAYS, dayNumbers, formatHours, type Schedule } from './model';

/**
 * The schedule grid, used both for the exported page and the in-app preview.
 *
 * Every row reads the same integer column widths (see `columns.ts`), so the
 * vertical rules stay continuous from the header to the totals whatever the
 * names, the times or the rendering surface.
 *
 * Borders are drawn once and once only: the frame supplies the top and left
 * edges, each cell supplies its right and bottom. Nothing overlaps, so no rule
 * is ever doubled.
 */
export function ScheduleTable({ schedule, width, scale = 1 }: {
  schedule: Schedule;
  width: number;
  /** Multiplies type and row height; 1 suits a printed page. */
  scale?: number;
}) {
  const numbers = dayNumbers(schedule.week_start);
  const anyOvertime = schedule.employees.some(e => (e.overtime_minutes || 0) > 0);
  const cols = computeColumns(width, anyOvertime);

  const px = (n: number) => Math.round(n * scale);
  const rowH = px(38);
  const dayNameH = px(40);
  const subH = px(26);
  const headH = dayNameH + subH;
  const font = px(14);
  const smallFont = px(11);
  const subFont = px(10);

  const Cell = ({ w, text, style, textStyle, h = rowH, size = font }: any) => (
    <View style={[styles.cell, { width: w, height: h }, style]}>
      <Text
        style={[styles.text, { fontSize: size }, textStyle]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {text}
      </Text>
    </View>
  );

  return (
    <View style={[styles.frame, { width: cols.width }]}>
      {/*
        Header: the day name sits above its three sub-columns. This nesting is
        only safe because a day's width is defined as the sum of its three
        integer parts — no fractional division anywhere, so the rules line up.
      */}
      <View style={styles.row}>
        <Cell w={cols.name} text="Nom" h={headH} style={[styles.head, styles.nameCellAlign]} textStyle={styles.nameHeadText} />
        {DAY_LABELS_LONG.map((label, i) => (
          <View key={label} style={{ width: dayWidth(cols.days[i]) }}>
            <View style={[styles.cell, styles.head, { width: dayWidth(cols.days[i]), height: dayNameH }]}>
              <Text style={[styles.text, styles.headText, { fontSize: font }]} numberOfLines={1}>
                {label}
              </Text>
              <Text style={[styles.dayNum, { fontSize: smallFont }]}>{numbers[i]}</Text>
            </View>
            <View style={styles.row}>
              <Cell w={cols.days[i][0]} text="Début" h={subH} size={subFont} style={[styles.sub, styles.subCell]} textStyle={styles.subText} />
              <Cell w={cols.days[i][1]} text="Fin" h={subH} size={subFont} style={[styles.sub, styles.subCell]} textStyle={styles.subText} />
              <Cell w={cols.days[i][2]} text="Heures" h={subH} size={subFont} style={[styles.sub, styles.subCell]} textStyle={styles.subText} />
            </View>
          </View>
        ))}
        {anyOvertime && (
          <Cell w={cols.overtime} text="Supp." h={headH} style={styles.totalHead} textStyle={styles.totalHeadText} />
        )}
        <Cell w={cols.total} text="Total" h={headH} style={styles.totalHead} textStyle={styles.totalHeadText} />
      </View>

      {schedule.employees.map((e, ri) => (
        <View key={e.employee_id || `${e.name}-${ri}`} style={styles.row}>
          <Cell w={cols.name} text={e.name} style={styles.nameCell} textStyle={styles.nameText} />
          {cols.days.map((d, i) => {
            const day = e.days[i] || null;
            if (day?.off) {
              return (
                <View key={i} style={styles.row}>
                  <Cell w={d[0] + d[1]} text="" style={styles.off} />
                  <Cell w={d[2]} text="0:00" style={styles.offHours} textStyle={styles.mutedText} />
                </View>
              );
            }
            const worked = day?.minutes || 0;
            return (
              <View key={i} style={styles.row}>
                <Cell w={d[0]} text={day?.start || ''} textStyle={styles.timeText} />
                <Cell w={d[1]} text={day?.end || ''} textStyle={styles.timeText} />
                <Cell w={d[2]} text={worked ? formatHours(worked) : ''} textStyle={styles.hoursText} />
              </View>
            );
          })}
          {anyOvertime && (
            <Cell
              w={cols.overtime}
              text={e.overtime_minutes ? formatHours(e.overtime_minutes) : ''}
              style={styles.totalCell}
              textStyle={styles.totalText}
            />
          )}
          <Cell w={cols.total} text={formatHours(e.total_minutes ?? 0)} style={styles.totalCell} textStyle={styles.totalText} />
        </View>
      ))}

      <View style={styles.row}>
        <Cell w={cols.name} text="Total / jour" style={styles.footer} textStyle={styles.footerLabel} />
        {cols.days.map((d, i) => (
          <View key={i} style={styles.row}>
            <Cell w={d[0] + d[1]} text="" style={styles.footer} />
            <Cell w={d[2]} text={formatHours(schedule.day_totals[i] || 0)} style={styles.footer} textStyle={styles.footerText} />
          </View>
        ))}
        {anyOvertime && <Cell w={cols.overtime} text="" style={styles.footer} />}
        <Cell w={cols.total} text={formatHours(schedule.grand_total_minutes)} style={styles.grandTotal} textStyle={styles.grandTotalText} />
      </View>
    </View>
  );
}

export { DAYS };

// Baker's own palette, kept light enough to print cleanly in colour or grey.
const INK = '#2A1F1A';
const MUTED = '#8B7D72';
const LINE = '#D8CEC2';
const BAND = '#F3EFEA';
const SUBTLE = '#FAF8F5';
const ACCENT_BG = '#F0DAC6';
const ACCENT_INK = '#8B4527';

const styles = StyleSheet.create({
  // The frame draws the top and left edges; cells draw their right and bottom.
  // That way every rule is exactly one pixel and never doubles.
  frame: {
    borderTopWidth: 1, borderLeftWidth: 1, borderColor: LINE,
    borderRadius: 10, overflow: 'hidden', backgroundColor: '#FFFFFF',
  },
  row: { flexDirection: 'row' },
  cell: {
    alignItems: 'center', justifyContent: 'center',
    borderRightWidth: 1, borderBottomWidth: 1, borderColor: LINE,
    paddingHorizontal: 2, backgroundColor: '#FFFFFF',
  },
  text: { color: INK, textAlign: 'center' },
  head: { backgroundColor: BAND },
  headText: { fontWeight: '700', letterSpacing: 0.3 },
  nameHeadText: { fontWeight: '700', letterSpacing: 1, color: MUTED, textAlign: 'left' },
  dayNum: { color: MUTED, marginTop: 1 },
  sub: { backgroundColor: SUBTLE },
  // Tight padding: these labels sit in the narrowest columns of the grid.
  subCell: { paddingHorizontal: 1 },
  subText: { color: MUTED, fontWeight: '600' },
  nameCellAlign: { alignItems: 'flex-start', paddingLeft: 10 },
  nameCell: { alignItems: 'flex-start', paddingLeft: 10, backgroundColor: SUBTLE },
  nameText: { fontWeight: '700', textAlign: 'left' },
  timeText: { color: '#4A3D36' },
  hoursText: { fontWeight: '700' },
  mutedText: { color: MUTED },
  off: { backgroundColor: '#E3DCD2' },
  offHours: { backgroundColor: '#EDE7DF' },
  totalHead: { backgroundColor: ACCENT_BG },
  totalHeadText: { color: ACCENT_INK, fontWeight: '700' },
  totalCell: { backgroundColor: '#FBF4EC' },
  totalText: { color: ACCENT_INK, fontWeight: '700' },
  footer: { backgroundColor: BAND },
  footerLabel: { fontWeight: '700', textAlign: 'left' },
  footerText: { fontWeight: '700' },
  grandTotal: { backgroundColor: ACCENT_INK },
  grandTotalText: { color: '#FFFFFF', fontWeight: '700' },
});
