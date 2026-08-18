/** Shared shapes and formatting for the staff schedule, mirroring backend/staff.py. */

export const DAYS = 7;
export const MAX_EMPLOYEES = 15;

/** Sunday first, matching the printed grid. */
export const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

/** Spelled out for the printed sheet, where there is room for them. */
export const DAY_LABELS_LONG = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

export type ScheduleDay = {
  off: boolean;
  start: string;
  end: string;
  /** Present on server responses only. */
  minutes?: number;
  invalid?: boolean;
};

export type ScheduleEmployee = {
  employee_id?: string;
  name: string;
  days: (ScheduleDay | null)[];
  overtime_minutes: number;
  worked_minutes?: number;
  total_minutes?: number;
  has_invalid?: boolean;
};

export type Schedule = {
  id: string;
  week_start: string;
  notes: string;
  employees: ScheduleEmployee[];
  day_totals: number[];
  grand_total_minutes: number;
  has_invalid: boolean;
};

export type ScheduleRow = {
  id: string;
  week_start: string;
  notes: string;
  employee_count: number;
  grand_total_minutes: number;
};

export const emptyDay = (): ScheduleDay => ({ off: false, start: '', end: '' });

export const emptyWeek = (): ScheduleDay[] => Array.from({ length: DAYS }, emptyDay);

/** Minutes → "32:00". Hours are not wrapped: a week total goes well past 24. */
export function formatHours(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** The Sunday opening the week containing `date` (today by default). */
export function sundayOf(date = new Date()): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The day-of-month shown under each column header. */
export function dayNumbers(weekStart: string): string[] {
  return Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(`${addDays(weekStart, i)}T00:00:00`);
    return String(d.getDate());
  });
}

/** "Semaine du 22 Décembre au 28 Décembre" */
export function weekTitle(weekStart: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `Semaine du ${fmt(weekStart)} au ${fmt(addDays(weekStart, 6))}`;
}

/** What a cell shows: a range, "0:00" for a day off, or nothing. */
export function cellText(day: ScheduleDay | null): string {
  if (!day) return '';
  if (day.off) return '0:00';
  if (!day.start && !day.end) return '';
  return `${day.start} ${day.end}`.trim();
}

/** Minutes → "01:30", the shape the overtime field always keeps. */
export function formatHHMM(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes || 0));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Keep an overtime field in `HH:MM` while it is being typed.
 *
 * The colon is never lost and never doubled: digits are read right to left,
 * the two rightmost being the minutes. Typing "130" gives "01:30", so the
 * hours sit left of the colon and the minutes right of it, as the field shows.
 */
export function maskHHMM(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '').slice(-4).padStart(4, '0');
  const hours = digits.slice(0, 2);
  const minutes = Math.min(59, parseInt(digits.slice(2), 10) || 0);
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

/** "01:30" → 90 minutes. */
export function parseHHMM(value: string): number {
  const m = (value || '').match(/^(\d{1,3}):(\d{1,2})$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + Math.min(59, parseInt(m[2], 10));
}
