import { DAYS } from './model';

/**
 * The single source of column widths for the schedule table.
 *
 * Every row — day header, sub-header, employees, daily totals — reads this one
 * array, which is what keeps the vertical rules continuous over the whole
 * height. Deriving widths per row from a fractional `grid / 7` was the original
 * defect: each cell was rounded on its own, so a day header of 255.28 px never
 * lined up with the three cells of 91.9 + 91.9 + 71.4 beneath it.
 */
export type Columns = {
  name: number;
  /** Seven days, each [start, end, hours], all whole pixels. */
  days: [number, number, number][];
  overtime: number;
  total: number;
  /** Exact sum of every column above. */
  width: number;
};

export const dayWidth = (d: [number, number, number]) => d[0] + d[1] + d[2];

/**
 * Lay the columns out inside `available` pixels.
 *
 * Widths are floored to whole pixels, then the remainder is handed back one
 * pixel at a time to the first days' "hours" columns. The parts therefore add
 * up to `available` exactly, and no sub-pixel drift can appear.
 */
export function computeColumns(available: number, withOvertime: boolean): Columns {
  const name = Math.round(available * 0.105);
  const total = Math.round(available * 0.063);
  const overtime = withOvertime ? total : 0;

  const grid = available - name - total - overtime;
  const perDay = Math.floor(grid / DAYS);
  const spare = grid - perDay * DAYS;

  // The hours column is the widest of the three: it carries the longest label
  // ("Heures") while Début and Fin only ever hold a short time like "8:00".
  const start = Math.floor(perDay * 0.33);
  const hours = perDay - start * 2;

  const days = Array.from({ length: DAYS }, (_, i) =>
    [start, start, hours + (i < spare ? 1 : 0)] as [number, number, number],
  );

  return {
    name,
    days,
    overtime,
    total,
    width: name + days.reduce((sum, d) => sum + dayWidth(d), 0) + overtime + total,
  };
}
