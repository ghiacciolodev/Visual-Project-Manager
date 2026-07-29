import { Task } from '../models/task.model';

/**
 * Pure date arithmetic for the schedule views.
 *
 * Kept as free functions rather than methods on TaskService because the Gantt
 * chart needs exactly the same maths, and a pure function is testable without
 * standing up an HTTP client.
 */

const MS_PER_DAY = 86_400_000;

/** Parses yyyy-MM-dd as local midnight. Appending the time matters: a bare
 *  date string is parsed as UTC and shifts by a day in negative offsets. */
export function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** Whole days from a to b. Same day = 0. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / MS_PER_DAY);
}

/** Inclusive duration: a task starting and ending today lasts one day. */
export function durationDays(task: Task): number {
  return daysBetween(task.startDate, task.endDate) + 1;
}

export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export interface Span {
  start: string;
  end: string;
  days: number;
}

/**
 * The window every timeline in the app is drawn against: from the earliest
 * start to the latest end across all tasks. One shared span is what makes the
 * row previews comparable to each other and to the full chart.
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

/** Position of a date inside the span, as a 0–100 percentage. */
export function positionInSpan(span: Span, iso: string): number {
  return (daysBetween(span.start, iso) / span.days) * 100;
}

export function formatDay(iso: string): string {
  return parseDay(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}