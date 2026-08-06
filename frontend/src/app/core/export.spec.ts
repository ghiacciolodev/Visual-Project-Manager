import { ExportRow, exportFilename, icsStamp, toCsv, toIcs } from './export';
import { Task } from '../models/task.model';

function task(over: Partial<Task> & { id: number }): Task {
  return {
    title: `Task ${over.id}`,
    description: null,
    status: 'TODO',
    priority: 'MEDIUM',
    startDate: '2026-03-02',
    endDate: '2026-03-06',
    color: '#3B82F6',
    dependsOn: [],
    blockedBy: [],
    assignee: null,
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function row(over: Partial<Task> & { id: number }, extra: Partial<ExportRow> = {}): ExportRow {
  return { task: task(over), critical: false, slip: 0, ...extra };
}

/** The data lines, without the header and without the byte-order mark. */
function bodyOf(csv: string): string[] {
  return csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n').slice(1);
}

describe('toCsv', () => {

  it('writes a header and one line per task', () => {
    const csv = toCsv([row({ id: 1 }), row({ id: 2 })]);
    const lines = csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n');

    expect(lines[0]).toBe(
      '#,Task,Status,Priority,Assignee,Start,End,Days,Waits for,Critical path,Can slip (days),Notes'
    );
    expect(lines).toHaveLength(3);
  });

  it('numbers the rows as the table does, from the order it is given', () => {
    // Not by task id. The export follows the sort on screen, so the numbers
    // have to be positions rather than identities.
    const [first, second] = bodyOf(toCsv([row({ id: 9 }), row({ id: 4 })]));

    expect(first.startsWith('1,')).toBe(true);
    expect(second.startsWith('2,')).toBe(true);
  });

  it('opens with a byte-order mark and separates with CRLF', () => {
    // The mark is what makes Excel on Windows read the file as UTF-8 rather
    // than as the system code page, which mangles every accented name.
    const csv = toCsv([row({ id: 1 })]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('\r\n');
  });

  it('carries the dates as ISO, the duration inclusive, and the analysis', () => {
    const line = bodyOf(toCsv([
      row(
        {
          id: 1,
          title: 'Cutover rehearsal',
          status: 'DOING',
          priority: 'HIGH',
          startDate: '2026-09-28',
          endDate: '2026-10-01',
          assignee: { id: 3, displayName: 'Harriet Vance' },
        },
        { critical: true, slip: 0 }
      ),
    ]))[0];

    expect(line).toBe(
      '1,Cutover rehearsal,DOING,HIGH,Harriet Vance,2026-09-28,2026-10-01,4,,yes,0,'
    );
  });

  describe('escaping', () => {

    it('quotes a field containing a comma', () => {
      const line = bodyOf(toCsv([row({ id: 1, title: 'Design, then build' })]))[0];
      expect(line).toContain('"Design, then build"');
    });

    it('doubles an embedded quote', () => {
      const line = bodyOf(toCsv([row({ id: 1, title: 'The "final" cut' })]))[0];
      expect(line).toContain('"The ""final"" cut"');
    });

    it('keeps a line break inside its quoted field', () => {
      // A description is a textarea, so newlines are ordinary content. Quoted,
      // they stay part of one field; unquoted they would end the record and
      // shift every column after it by one.
      const csv = toCsv([row({ id: 1, description: 'First line\nSecond line' })]);
      expect(csv).toContain('"First line\nSecond line"');
      // Header, the one record, and nothing after it.
      expect(csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n')).toHaveLength(2);
    });

    it('leaves an ordinary field alone', () => {
      expect(bodyOf(toCsv([row({ id: 1, title: 'Go live' })]))[0]).toContain(',Go live,');
    });
  });

  describe('formula injection', () => {

    // A cell beginning with any of these is executable in Excel, Sheets and
    // LibreOffice. The titles come from one project member and the file is
    // opened by another, so this is a route between two people's machines.
    it.each(['=', '+', '-', '@'])('neutralises a title starting with %s', prefix => {
      const line = bodyOf(toCsv([row({ id: 1, title: `${prefix}HYPERLINK("http://x")` })]))[0];

      // Quoted because of the embedded comma; what matters is the apostrophe
      // in front of the operator.
      expect(line).toContain(`"'${prefix}HYPERLINK(""http://x"")"`);
    });

    it('guards the description too', () => {
      const line = bodyOf(toCsv([row({ id: 1, description: '=1+1' })]))[0];
      expect(line.endsWith(",'=1+1")).toBe(true);
    });

    it('does not touch a number that happens to be negative', () => {
      // Slip is written by String(), never through the guard, so a future
      // negative figure stays a number to the spreadsheet.
      const line = bodyOf(toCsv([row({ id: 1 }, { slip: -3 })]))[0];
      expect(line).toContain(',-3,');
    });
  });

  it('joins predecessors with semicolons', () => {
    const line = bodyOf(toCsv([
      row({
        id: 1,
        dependsOn: [
          { id: 2, title: 'Content migration', status: 'TODO' },
          { id: 3, title: 'Accessibility pass', status: 'TODO' },
        ],
      }),
    ]))[0];

    expect(line).toContain('Content migration; Accessibility pass');
  });

  it('writes an empty cell for nobody and for no notes', () => {
    // Not "Unassigned" or "None": a spreadsheet filters and counts blanks, and
    // a word in the cell makes it a value like any other.
    const line = bodyOf(toCsv([row({ id: 1 })]))[0];
    expect(line).toBe('1,Task 1,TODO,MEDIUM,,2026-03-02,2026-03-06,5,,no,0,');
  });

  it('produces a header and nothing else for an empty plan', () => {
    expect(bodyOf(toCsv([]))).toEqual([]);
  });
});

describe('toIcs', () => {

  const STAMP = '20260806T124500Z';

  /** Unfolded, so a test can look for a value without knowing where it wrapped. */
  function linesOf(ics: string): string[] {
    return ics.replace(/\r\n /g, '').trimEnd().split('\r\n');
  }

  it('wraps the events in a calendar the specification will accept', () => {
    const lines = linesOf(toIcs([row({ id: 1 })], 'Storefront Relaunch', STAMP));

    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('PRODID:-//Visual Project Manager//EN');
    expect(lines).toContain('X-WR-CALNAME:Storefront Relaunch');
    expect(lines[lines.length - 1]).toBe('END:VCALENDAR');
  });

  it('ends the event the day after the task, because DTEND is exclusive', () => {
    // The single most misread line in the format. A task drawn through the
    // 17th is an event that ends on the 18th; writing the 17th here makes
    // every task in the calendar a day shorter than the plan says.
    const lines = linesOf(toIcs(
      [row({ id: 1, startDate: '2026-07-06', endDate: '2026-07-17' })],
      'Plan', STAMP
    ));

    expect(lines).toContain('DTSTART;VALUE=DATE:20260706');
    expect(lines).toContain('DTEND;VALUE=DATE:20260718');
  });

  it('gives a one-day task a one-day event', () => {
    const lines = linesOf(toIcs(
      [row({ id: 1, startDate: '2026-10-02', endDate: '2026-10-02' })],
      'Plan', STAMP
    ));

    expect(lines).toContain('DTSTART;VALUE=DATE:20261002');
    expect(lines).toContain('DTEND;VALUE=DATE:20261003');
  });

  it('crosses a month end without inventing a day', () => {
    const lines = linesOf(toIcs(
      [row({ id: 1, startDate: '2026-01-30', endDate: '2026-01-31' })],
      'Plan', STAMP
    ));

    expect(lines).toContain('DTEND;VALUE=DATE:20260201');
  });

  it('keys each event by the task, so a second import updates rather than doubles', () => {
    const lines = linesOf(toIcs([row({ id: 29 })], 'Plan', STAMP));
    expect(lines).toContain('UID:vpm-task-29@visual-project-manager');
  });

  it('marks the time free', () => {
    // Without this a three-week task is three weeks of being unavailable, and
    // the calendar declines every meeting sent during the project.
    expect(linesOf(toIcs([row({ id: 1 })], 'Plan', STAMP))).toContain('TRANSP:TRANSPARENT');
  });

  it('carries the status, the priority and what the task waits for', () => {
    const ics = toIcs([
      row(
        {
          id: 1,
          status: 'DOING',
          priority: 'HIGH',
          assignee: { id: 2, displayName: 'Marcus Bell' },
          dependsOn: [{ id: 3, title: 'Checkout API contract', status: 'DONE' }],
        },
        { critical: true }
      ),
    ], 'Plan', STAMP);

    const lines = linesOf(ics);

    expect(lines).toContain('CATEGORIES:DOING,HIGH');
    expect(lines).toContain('PRIORITY:1');
    expect(lines.join('\n')).toContain('Assigned to Marcus Bell');
    expect(lines.join('\n')).toContain('Waits for Checkout API contract');
    expect(lines.join('\n')).toContain('On the critical path');
  });

  it('reports the slack for a task that has some', () => {
    const text = linesOf(toIcs([row({ id: 1 }, { slip: 1 })], 'Plan', STAMP)).join('\n');
    expect(text).toContain('Can slip 1 day');
    expect(text).not.toContain('1 days');
  });

  describe('escaping', () => {

    it('escapes the four characters that mean something to the format', () => {
      // Backslash first, or the escapes escape each other.
      const lines = linesOf(toIcs(
        [row({ id: 1, title: 'Ship; test, then C:\\deploy' })],
        'Plan', STAMP
      ));

      expect(lines).toContain('SUMMARY:Ship\\; test\\, then C:\\\\deploy');
    });

    it('turns a line break in the notes into the escape, not a new line', () => {
      // An unescaped newline would end the property and leave the rest of the
      // description being read as a content line of its own, which is how an
      // import fails with a message about an unknown property.
      const ics = toIcs([row({ id: 1, description: 'First\nSecond' })], 'Plan', STAMP);

      expect(ics.replace(/\r\n /g, '')).toContain('First\\nSecond');
    });
  });

  describe('folding', () => {

    it('leaves a short line alone', () => {
      const ics = toIcs([row({ id: 1, title: 'Go live' })], 'Plan', STAMP);
      expect(ics).toContain('SUMMARY:Go live\r\n');
    });

    it('breaks a long line and marks the continuation with a space', () => {
      const title = 'A'.repeat(200);
      const ics = toIcs([row({ id: 1, title })], 'Plan', STAMP);

      // Every physical line is inside the limit...
      for (const line of ics.split('\r\n')) {
        expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      }
      // ...and unfolding puts the value back together unchanged.
      expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${title}`);
    });

    it('counts octets rather than characters, and never splits one', () => {
      // The limit is 75 octets. A character that is four bytes in UTF-8 would
      // be corrupted by a fold placed between its bytes, and a line measured
      // by character count would be legal to look at and too long to parse.
      const title = '😀'.repeat(40);
      const ics = toIcs([row({ id: 1, title })], 'Plan', STAMP);

      for (const line of ics.split('\r\n')) {
        expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      }
      expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${title}`);
    });
  });

  it('produces an empty but valid calendar for an empty plan', () => {
    const lines = linesOf(toIcs([], 'Plan', STAMP));

    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).not.toContain('BEGIN:VEVENT');
  });
});

describe('icsStamp', () => {

  it('writes UTC in basic format, which is the only form DTSTAMP takes', () => {
    expect(icsStamp(new Date('2026-08-06T12:45:00.000Z'))).toBe('20260806T124500Z');
  });
});

describe('exportFilename', () => {

  it('slugs the project name and dates the file', () => {
    expect(exportFilename('Storefront Relaunch', '2026-08-06', 'csv'))
      .toBe('storefront-relaunch-2026-08-06.csv');
  });

  it('takes the extension it is given', () => {
    expect(exportFilename('Storefront Relaunch', '2026-08-06', 'ics'))
      .toBe('storefront-relaunch-2026-08-06.ics');
  });

  it('collapses punctuation rather than passing it to the filesystem', () => {
    expect(exportFilename('Q4 / 2026: "clients"', '2026-08-06', 'csv'))
      .toBe('q4-2026-clients-2026-08-06.csv');
  });

  it('falls back when the name survives as nothing', () => {
    // A project named entirely in a script this slug rule drops. Better a
    // generic name than a file called "-2026-08-06.csv".
    expect(exportFilename('日程', '2026-08-06', 'csv')).toBe('plan-2026-08-06.csv');
  });
});
