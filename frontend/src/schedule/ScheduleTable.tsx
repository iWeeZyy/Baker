import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { computeColumns, dayWidth } from './columns';
import { DAY_LABELS_LONG, DAYS, dayNumbers, formatHours, type Schedule } from './model';
import { useTheme } from '../ThemeContext';
import type { ThemeColors } from '../theme';

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
export function ScheduleTable({ schedule, width, scale = 1, themed = false }: {
  schedule: Schedule;
  width: number;
  /** Multiplies type and row height; 1 suits a printed page. */
  scale?: number;
  /** True only for the in-app preview: follows the current theme instead of the fixed print palette used by the export (photo/PDF), which must never depend on the device's theme. */
  themed?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(themed ? colors : null), [themed, colors]);

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

// The export (photo/PDF) is always rendered with this fixed palette, whatever
// the device's current theme — kept light enough to print cleanly in colour
// or grey. The in-app preview (themed=true) swaps these for theme tokens.
const PRINT = {
  ink: '#2A1F1A', muted: '#8B7D72', line: '#D8CEC2', band: '#F3EFEA', subtle: '#FAF8F5',
  accentBg: '#F0DAC6', accentInk: '#8B4527', frameBg: '#FFFFFF', timeText: '#4A3D36',
  off: '#E3DCD2', offHours: '#EDE7DF', totalCell: '#FBF4EC', grandTotalText: '#FFFFFF',
};

const makeStyles = (colors: ThemeColors | null) => {
  const p = colors ? {
    ink: colors.onSurface, muted: colors.muted, line: colors.border, band: colors.surfaceSecondary,
    subtle: colors.surface, accentBg: colors.brandTertiary, accentInk: colors.onBrandTertiary,
    frameBg: colors.surface, timeText: colors.onSurfaceSecondary, off: colors.surfaceTertiary,
    offHours: colors.surfaceSecondary, totalCell: colors.brandTertiary, grandTotalText: colors.onBrandPrimary,
  } : PRINT;

  return StyleSheet.create({
    // The frame draws the top and left edges; cells draw their right and bottom.
    // That way every rule is exactly one pixel and never doubles.
    frame: {
      borderTopWidth: 1, borderLeftWidth: 1, borderColor: p.line,
      borderRadius: 10, overflow: 'hidden', backgroundColor: p.frameBg,
    },
    row: { flexDirection: 'row' },
    cell: {
      alignItems: 'center', justifyContent: 'center',
      borderRightWidth: 1, borderBottomWidth: 1, borderColor: p.line,
      paddingHorizontal: 2, backgroundColor: p.frameBg,
    },
    text: { color: p.ink, textAlign: 'center' },
    head: { backgroundColor: p.band },
    headText: { fontWeight: '700', letterSpacing: 0.3 },
    nameHeadText: { fontWeight: '700', letterSpacing: 1, color: p.muted, textAlign: 'left' },
    dayNum: { color: p.muted, marginTop: 1 },
    sub: { backgroundColor: p.subtle },
    // Tight padding: these labels sit in the narrowest columns of the grid.
    subCell: { paddingHorizontal: 1 },
    subText: { color: p.muted, fontWeight: '600' },
    nameCellAlign: { alignItems: 'flex-start', paddingLeft: 10 },
    nameCell: { alignItems: 'flex-start', paddingLeft: 10, backgroundColor: p.subtle },
    nameText: { fontWeight: '700', textAlign: 'left' },
    timeText: { color: p.timeText },
    hoursText: { fontWeight: '700' },
    mutedText: { color: p.muted },
    off: { backgroundColor: p.off },
    offHours: { backgroundColor: p.offHours },
    totalHead: { backgroundColor: p.accentBg },
    totalHeadText: { color: p.accentInk, fontWeight: '700' },
    totalCell: { backgroundColor: p.totalCell },
    totalText: { color: p.accentInk, fontWeight: '700' },
    footer: { backgroundColor: p.band },
    footerLabel: { fontWeight: '700', textAlign: 'left' },
    footerText: { fontWeight: '700' },
    grandTotal: { backgroundColor: p.accentInk },
    grandTotalText: { color: p.grandTotalText, fontWeight: '700' },
  });
};
