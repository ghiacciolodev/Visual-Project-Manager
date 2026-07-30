import { Task } from '../models/task.model';

/**
 * Pure date arithmetic for the schedule views.
 *
 * Free functions rather than methods on TaskService: the dashboard rows and
 * the Gantt chart need identical maths, and a pure function is testable
 * without standing up an HTTP client.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Parses yyyy-MM-dd as local midnight. Appending the time matters: a bare date
 * string is parsed as UTC, which shifts by a day in negative offsets.
 */
export function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** Formats a Date as yyyy-MM-dd in local time. */
export function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayIso(): string {
  return toIso(new Date());
}

/**
 * Shifts a date by whole days. Goes through Date.setDate rather than adding
 * milliseconds so that daylight-saving transitions do not lose or gain a day.
 */
export function addDays(iso: string, days: number): string {
  const date = parseDay(iso);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

/** Whole days from a to b. Same day = 0. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / MS_PER_DAY);
}

/** Inclusive duration: a task starting and ending today lasts one day. */
export function durationDays(task: Task): number {
  return daysBetween(task.startDate, task.endDate) + 1;
}

export interface Span {
  start: string;
  end: string;
  days: number;
}

/**
 * The window every timeline is drawn against: earliest start to latest end.
 * One shared span is what makes row previews comparable to each other and to
 * the full chart.
 */
export function projectSpan(tasks: Task[]): Span | null {
  if (tasks.length === 0) return null;

  let start = tasks[0].startDate;
  let end = tasks[0].endDate;

  for (const task of tasks) {
    if (task.startDate < start) start = task.startDate;   // ISO strings sort correctly
    if (task.endDate > end) end = task.endDate;
  }

  return { start, end, days: daysBetween(start, end) + 1 };
}

/** Widens a span so bars never touch the edge of the chart. */
export function padSpan(span: Span, before: number, after: number): Span {
  const start = addDays(span.start, -before);
  const end = addDays(span.end, after);
  return { start, end, days: daysBetween(start, end) + 1 };
}

/** Position of a date inside the span, as a 0–100 percentage. */
export function positionInSpan(span: Span, iso: string): number {
  return (daysBetween(span.start, iso) / span.days) * 100;
}

export function formatDay(iso: string): string {
  return parseDay(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/* --- chart scaffolding -------------------------------------------------- */

export interface DayCell {
  iso: string;
  dayOfMonth: number;
  weekday: number;      // 0 = Sunday
  isWeekend: boolean;
  isToday: boolean;
  isMonthStart: boolean;
  isWeekStart: boolean; // Monday
}

/** One entry per column of the chart. */
export function eachDay(span: Span): DayCell[] {
  const today = todayIso();
  const cells: DayCell[] = [];

  for (let i = 0; i < span.days; i++) {
    const iso = addDays(span.start, i);
    const date = parseDay(iso);
    const weekday = date.getDay();

    cells.push({
      iso,
      dayOfMonth: date.getDate(),
      weekday,
      isWeekend: weekday === 0 || weekday === 6,
      isToday: iso === today,
      isMonthStart: date.getDate() === 1,
      isWeekStart: weekday === 1,
    });
  }

  return cells;
}

export interface MonthBand {
  label: string;
  span: number;   // how many day columns this month covers
}

/**
 * Groups the day columns into month headers. The first and last bands are
 * usually partial, which is why the span is counted rather than assumed.
 */
export function monthBands(days: DayCell[]): MonthBand[] {
  const bands: MonthBand[] = [];

  for (const day of days) {
    const date = parseDay(day.iso);
    const label = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    const current = bands[bands.length - 1];
    if (current && current.label === label) {
      current.span++;
    } else {
      bands.push({ label, span: 1 });
    }
  }

  return bands;
}