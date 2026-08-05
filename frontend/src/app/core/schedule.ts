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

/* --- dragging ----------------------------------------------------------- */

/** Which part of a bar the pointer took hold of. */
export type DragMode = 'move' | 'start' | 'end';

/**
 * Where a bar lands after being dragged by a whole number of days.
 *
 * A free function rather than a branch inside the pointer handler: this is the
 * only real arithmetic in the gesture, and buried in an event listener the
 * only way to check it would be to mount the chart and synthesise pointer
 * events. The clamping in particular is worth being able to state plainly.
 */
export function dragDates(
  mode: DragMode,
  fromStart: string,
  fromEnd: string,
  days: number
): { startDate: string; endDate: string } {

  if (mode === 'move') {
    return { startDate: addDays(fromStart, days), endDate: addDays(fromEnd, days) };
  }

  // How far either end may travel before the task would invert. The shortest
  // thing anyone can plan is one day, so the ends may meet but not cross.
  const room = daysBetween(fromStart, fromEnd);

  if (mode === 'start') {
    return { startDate: addDays(fromStart, Math.min(days, room)), endDate: fromEnd };
  }
  return { startDate: fromStart, endDate: addDays(fromEnd, Math.max(days, -room)) };
}

/* --- connector geometry ------------------------------------------------- */

export interface Point {
  x: number;
  y: number;
}

/**
 * An orthogonal polyline as an SVG path, with the corners rounded off.
 *
 * Each interior vertex is cut back along both of its segments and replaced by
 * a quadratic through the original corner. The cut is capped at half the
 * shorter neighbour, so a short segment between two turns cannot be consumed
 * from both ends and leave the curves crossing each other — which is what a
 * fixed radius does the first time two bars are close together.
 */
export function roundedPath(points: Point[], radius: number): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const parts = [`M ${points[0].x} ${points[0].y}`];

  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];

    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const cut = Math.min(radius, inLength / 2, outLength / 2);

    // A zero-length segment means two identical points; stepping through the
    // corner with no curve is the only sane answer, and dividing by the
    // length would otherwise produce NaN and drop the whole path.
    const before = inLength === 0 ? corner : {
      x: corner.x - ((corner.x - previous.x) / inLength) * cut,
      y: corner.y - ((corner.y - previous.y) / inLength) * cut,
    };
    const after = outLength === 0 ? corner : {
      x: corner.x + ((next.x - corner.x) / outLength) * cut,
      y: corner.y + ((next.y - corner.y) / outLength) * cut,
    };

    parts.push(`L ${round(before.x)} ${round(before.y)}`);
    parts.push(`Q ${round(corner.x)} ${round(corner.y)} ${round(after.x)} ${round(after.y)}`);
  }

  const last = points[points.length - 1];
  parts.push(`L ${round(last.x)} ${round(last.y)}`);

  return parts.join(' ');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface ConnectorOptions {
  /** Clearance before the first turn, so the line leaves the bar cleanly. */
  stub: number;
  /** Straight run into the arrowhead, so it points along the row. */
  approach: number;
  /** Corner radius. */
  radius: number;
  /** Where the return lane sits when the line has to travel backwards. */
  lane: number;
}

/**
 * The route from the end of one bar to the start of another.
 *
 * Two shapes, because a successor is not always scheduled after its
 * predecessor finishes — an overlap is an ordinary state of a plan that has
 * slipped, and a straight line backwards would cut through everything between.
 *
 * When there is room, the descent happens just before the successor rather
 * than just after the predecessor. Both are legal elbows; this one is tidier
 * in practice, because the column immediately to the left of a bar is far
 * more often empty than the column immediately to its right — that is where
 * the next task is about to start.
 */
export function connectorPoints(
  from: Point,
  to: Point,
  options: ConnectorOptions
): Point[] {
  const tip = { x: to.x - 4, y: to.y };
  const turn = tip.x - options.approach;
  const out = from.x + options.stub;

  if (turn > out) {
    return [from, { x: turn, y: from.y }, { x: turn, y: to.y }, tip];
  }

  // No room to cross directly: out of the predecessor, into a lane running
  // back beneath or above it, then down into the successor.
  return [
    from,
    { x: out, y: from.y },
    { x: out, y: options.lane },
    { x: turn, y: options.lane },
    { x: turn, y: to.y },
    tip,
  ];
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