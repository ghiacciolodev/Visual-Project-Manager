import { Task } from '../models/task.model';
import { durationDays } from './schedule';

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

/**
 * A filename somebody can find again a week later.
 *
 * The date is in the name because the export is a snapshot of a plan that
 * moves, and two downloads a fortnight apart should not be
 * `storefront-relaunch(1).csv`.
 */
export function csvFilename(projectName: string, today: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${slug || 'plan'}-${today}.csv`;
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
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}
