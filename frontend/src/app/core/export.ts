import { Task } from '../models/task.model';
import { addDays, durationDays } from './schedule';

/**
 * The plan as a spreadsheet.
 *
 * Built in the browser rather than fetched from an endpoint, and that is a
 * decision rather than a shortcut. What somebody means by "export" is almost
 * always "give me what I am looking at" — this filter, this order — and the
 * filters here are computed client-side over a list the server has already
 * sent in full (see task-filter.ts for why). An endpoint could only ever
 * export the whole project, in the server's order, which is the wrong answer
 * to the question the button is asking.
 *
 * It also means no second definition of a task's shape: the CSV is written
 * from the same objects the table draws.
 *
 * If the task list is ever paginated, this moves to the server along with the
 * filtering, and for the same reason.
 */

/**
 * A task plus the two things the schedule analysis knows about it.
 *
 * Critical and slip are not properties of a Task — they are properties of the
 * whole graph, recomputed whenever anything moves. They are passed in rather
 * than looked up so this file stays a pure function of its arguments.
 */
export interface ExportRow {
  task: Task;
  critical: boolean;
  /** Days this task can slip from where it is planned before something else moves. */
  slip: number;
}

const HEADERS = [
  '#',
  'Task',
  'Status',
  'Priority',
  'Assignee',
  'Start',
  'End',
  'Days',
  'Waits for',
  'Critical path',
  'Can slip (days)',
  'Notes',
] as const;

/**
 * RFC 4180, with one deliberate departure.
 *
 * The standard says a field needs quoting when it contains a comma, a quote or
 * a line break, and that an embedded quote is written twice. That part is
 * followed exactly.
 *
 * The departure is the leading apostrophe. A cell whose text begins with =, +,
 * - or @ is a formula to Excel, Google Sheets and LibreOffice alike, so a task
 * titled `=HYPERLINK(...)` becomes executable content the moment somebody
 * opens the file — a real injection route, from data one project member can
 * type and another downloads. Prefixing with an apostrophe is the standard
 * mitigation: those applications read it as "the rest is text" and do not
 * display it.
 *
 * It does mean the exported text is not byte-for-byte the stored text for
 * those few cells. That is the trade, and it is the right way round: a title
 * that reads `'=total` in a spreadsheet is a curiosity, and one that runs is a
 * vulnerability. Numbers never go through here, so a negative figure is not
 * affected.
 */
function escapeCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

/** Numbers are written bare: quoting them would make some readers treat them as text. */
function cells(row: ExportRow, index: number): string[] {
  const task = row.task;

  return [
    String(index + 1),
    escapeCell(task.title),
    task.status,
    task.priority,
    escapeCell(task.assignee?.displayName ?? ''),
    // ISO throughout, which every spreadsheet recognises as a date and no
    // locale can reinterpret. `03/08/2026` is two different days depending on
    // who opens it.
    task.startDate,
    task.endDate,
    String(durationDays(task)),
    // Semicolons rather than commas: both are quoted correctly either way, but
    // a cell full of quoted commas is unreadable in the raw file.
    escapeCell(task.dependsOn.map(d => d.title).join('; ')),
    row.critical ? 'yes' : 'no',
    String(row.slip),
    escapeCell(task.description ?? ''),
  ];
}

/**
 * CRLF line endings, per the specification, and a byte-order mark in front.
 *
 * The mark is what makes Excel on Windows read the file as UTF-8 instead of
 * the system code page. Without it every name with an accent in it arrives
 * mangled, which is the single most common complaint about CSV exports.
 */
export function toCsv(rows: ExportRow[]): string {
  const lines = [
    HEADERS.join(','),
    ...rows.map((row, index) => cells(row, index).join(',')),
  ];

  // Written as an escape, not as the character itself: a literal BOM in the
  // source is invisible in every editor and survives exactly until somebody
  // reformats the file.
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/* --- the calendar ------------------------------------------------------- */

/**
 * The plan as calendar events, per RFC 5545.
 *
 * Worth having for the reason a spreadsheet is not: a schedule that lives only
 * in this application is a schedule people have to remember to come and look
 * at. Subscribed to a calendar, the work turns up beside everything else that
 * is happening that week.
 *
 * Every task is an all-day event rather than a timed one, because that is what
 * the data actually says. A task has a start date and an end date and no hours
 * at all, and inventing 09:00 would be inventing.
 */

/** Escapes a TEXT value: backslash first, or it would escape its own escapes. */
function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** `2026-07-06` to `20260706`, which is what a DATE value looks like. */
function icsDate(iso: string): string {
  return iso.replace(/-/g, '');
}

/**
 * Folds a content line to 75 octets, per RFC 5545 section 3.1.
 *
 * Octets and not characters, which is the part that is easy to get wrong: a
 * name with an accent in it is two bytes in UTF-8, and folding by character
 * count produces lines that are legal to look at and too long to parse. Worse,
 * splitting between the two bytes of one character corrupts it, so the loop
 * measures as it goes rather than slicing at a fixed index.
 *
 * A continuation is a CRLF followed by one space, and the space is not part of
 * the value.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = '';
  let octets = 0;
  // The first line may use 75; every continuation spends one on its leading
  // space.
  let budget = 75;

  // Iterating the string rather than its code units keeps surrogate pairs
  // whole: an emoji in a task title is one character and four octets.
  for (const character of line) {
    const size = encoder.encode(character).length;

    if (octets + size > budget) {
      out.push(current);
      current = '';
      octets = 0;
      budget = 74;
    }

    current += character;
    octets += size;
  }

  out.push(current);
  return out.join('\r\n ');
}

/** Nine levels in the specification, three here. */
const ICS_PRIORITY = { HIGH: 1, MEDIUM: 5, LOW: 9 } as const;

function event(row: ExportRow, stamp: string): string[] {
  const task = row.task;

  const notes = [
    task.description?.trim(),
    task.assignee ? `Assigned to ${task.assignee.displayName}` : null,
    task.dependsOn.length
      ? `Waits for ${task.dependsOn.map(d => d.title).join('; ')}`
      : null,
    row.critical
      ? 'On the critical path: any slip here moves the finish date'
      : `Can slip ${row.slip} day${row.slip === 1 ? '' : 's'}`,
  ].filter(Boolean).join('\n');

  return [
    'BEGIN:VEVENT',

    // Stable, and derived from the task id so that re-importing a plan updates
    // the fifteen events already there instead of adding fifteen more. Task
    // ids are unique across every project in one database, so the project need
    // not appear here. Two separate deployments could collide, which matters
    // only to somebody subscribing to both; a real product would use the
    // instance's own hostname.
    `UID:vpm-task-${task.id}@visual-project-manager`,

    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDate(task.startDate)}`,

    // Exclusive, and this is the single most misread line in the format. A
    // task ending on the 17th is drawn through the 17th, so the event ends on
    // the 18th. Writing the end date here is the classic bug that makes every
    // task in the calendar a day shorter than the plan says.
    `DTEND;VALUE=DATE:${icsDate(addDays(task.endDate, 1))}`,

    `SUMMARY:${icsText(task.title)}`,
    notes ? `DESCRIPTION:${icsText(notes)}` : null,
    `CATEGORIES:${task.status},${task.priority}`,
    `PRIORITY:${ICS_PRIORITY[task.priority]}`,

    // Free, not busy. A three-week task is three weeks of work in progress,
    // not three weeks of being unavailable, and without this a calendar shows
    // the whole project as a solid wall and refuses every meeting invitation
    // sent during it.
    'TRANSP:TRANSPARENT',

    'END:VEVENT',
  ].filter((line): line is string => line !== null);
}

/**
 * @param stamp DTSTAMP, as UTC in basic format: `20260806T124500Z`. Passed in
 *              rather than read from the clock so this stays a pure function
 *              of its arguments and can be tested for what it writes.
 */
export function toIcs(rows: ExportRow[], projectName: string, stamp: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    // The identifier of whatever produced the file, which the specification
    // requires and which is the first thing anybody debugging an import looks
    // at.
    'PRODID:-//Visual Project Manager//EN',
    'CALSCALE:GREGORIAN',
    // Published for reading, not an invitation anybody is expected to answer.
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(projectName)}`,
    ...rows.flatMap(row => event(row, stamp)),
    'END:VCALENDAR',
  ];

  return lines.map(fold).join('\r\n') + '\r\n';
}

/** DTSTAMP for a given moment: UTC, basic format, no punctuation. */
export function icsStamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/* --- naming the file ---------------------------------------------------- */

/**
 * A filename somebody can find again a week later.
 *
 * The date is in the name because every one of these is a snapshot of a plan
 * that moves, and two downloads a fortnight apart should not be
 * `storefront-relaunch(1).csv`.
 */
export function exportFilename(
  projectName: string,
  today: string,
  extension: 'csv' | 'ics'
): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${slug || 'plan'}-${today}.${extension}`;
}

/**
 * Hands the browser a file to save.
 *
 * An object URL rather than a data: URL, which has a length limit that a plan
 * of any size would reach. Revoked on the next turn of the event loop: the
 * download is started by the click, but revoking in the same tick has a long
 * history of racing it in one browser or another.
 */
export function downloadText(filename: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;

  // In the document, clicked, and taken out again. A detached anchor works in
  // Chromium and has a long history of doing nothing at all in Firefox, which
  // is the kind of defect that never shows up in the browser it was written
  // in. Two lines to not have to care.
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}
