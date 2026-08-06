import { ExportRow, csvFilename, toCsv } from './export';
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

describe('csvFilename', () => {

  it('slugs the project name and dates the file', () => {
    expect(csvFilename('Storefront Relaunch', '2026-08-06'))
      .toBe('storefront-relaunch-2026-08-06.csv');
  });

  it('collapses punctuation rather than passing it to the filesystem', () => {
    expect(csvFilename('Q4 / 2026 — "clients"', '2026-08-06'))
      .toBe('q4-2026-clients-2026-08-06.csv');
  });

  it('falls back when the name survives as nothing', () => {
    // A project named entirely in a script this slug rule drops. Better a
    // generic name than a file called "-2026-08-06.csv".
    expect(csvFilename('日程', '2026-08-06')).toBe('plan-2026-08-06.csv');
  });
});
