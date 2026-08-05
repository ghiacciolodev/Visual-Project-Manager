import {
  addDays,
  connectorPoints,
  daysBetween,
  dragDates,
  durationDays,
  eachDay,
  monthBands,
  padSpan,
  parseDay,
  positionInSpan,
  projectSpan,
  roundedPath,
  toIso,
} from './schedule';
import { Task } from '../models/task.model';

function task(startDate: string, endDate: string): Task {
  return {
    id: 1, title: 't', description: null, status: 'TODO', priority: 'MEDIUM',
    startDate, endDate, color: '#3B82F6', dependsOn: [], blockedBy: [], assignee: null,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('schedule', () => {

  describe('date arithmetic', () => {

    it('reads a date as local midnight rather than UTC', () => {
      const day = parseDay('2026-03-15');

      // A bare yyyy-MM-dd is parsed as UTC, which lands on the 14th anywhere
      // west of Greenwich. Every bar would be drawn a day out.
      expect(day.getFullYear()).toBe(2026);
      expect(day.getMonth()).toBe(2);
      expect(day.getDate()).toBe(15);
    });

    it('counts a task that starts and ends today as one day', () => {
      // Inclusive duration: the difference is zero, the duration is one. Off by
      // one here and every bar is a day short.
      expect(durationDays(task('2026-03-15', '2026-03-15'))).toBe(1);
      expect(durationDays(task('2026-03-15', '2026-03-19'))).toBe(5);
    });

    it('crosses a daylight-saving boundary without losing a day', () => {
      // European clocks go forward on 29 March 2026. Adding milliseconds
      // instead of going through setDate would make this 23 hours and land on
      // the wrong date.
      expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
      expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    });

    it('round-trips a date through its ISO form', () => {
      expect(toIso(parseDay('2026-12-31'))).toBe('2026-12-31');
    });
  });

  describe('project span', () => {

    it('runs from the earliest start to the latest end', () => {
      const span = projectSpan([
        task('2026-03-10', '2026-03-12'),
        task('2026-03-05', '2026-03-06'),
        task('2026-03-08', '2026-03-20'),
      ])!;

      // Not the first or last task in the list: the earliest start and the
      // latest end can belong to different rows, and often do.
      expect(span.start).toBe('2026-03-05');
      expect(span.end).toBe('2026-03-20');
      expect(span.days).toBe(16);
    });

    it('has no span at all when there is nothing to plot', () => {
      expect(projectSpan([])).toBeNull();
    });

    it('pads without changing the dates it was given', () => {
      const base = projectSpan([task('2026-03-10', '2026-03-12')])!;
      const padded = padSpan(base, 3, 3);

      expect(padded.start).toBe('2026-03-07');
      expect(padded.end).toBe('2026-03-15');
      expect(padded.days).toBe(9);
      expect(base.start).toBe('2026-03-10');
    });

    it('places a date as a percentage of the window', () => {
      const span = projectSpan([task('2026-03-01', '2026-03-10')])!;

      expect(positionInSpan(span, '2026-03-01')).toBe(0);
      expect(positionInSpan(span, '2026-03-06')).toBeCloseTo(50, 5);
    });
  });

  describe('columns', () => {

    it('emits one cell per day and marks the weekends', () => {
      // 2026-03-07 is a Saturday.
      const cells = eachDay({ start: '2026-03-06', end: '2026-03-09', days: 4 });

      expect(cells.map(c => c.iso))
        .toEqual(['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09']);
      expect(cells.map(c => c.isWeekend)).toEqual([false, true, true, false]);
      // Monday starts the week, and only Monday.
      expect(cells.map(c => c.isWeekStart)).toEqual([false, false, false, true]);
    });

    it('counts how many columns each month band covers', () => {
      const bands = monthBands(eachDay({ start: '2026-03-30', end: '2026-04-02', days: 4 }));

      // The first and last bands are usually partial, which is why the span is
      // counted rather than assumed from the length of the month.
      expect(bands).toHaveLength(2);
      expect(bands[0].span).toBe(2);
      expect(bands[1].span).toBe(2);
    });
  });

  describe('connector geometry', () => {

    const options = { stub: 8, approach: 10, radius: 6, lane: 40 };

    it('crosses directly when there is room, turning once', () => {
      const points = connectorPoints({ x: 100, y: 10 }, { x: 300, y: 44 }, options);

      // Out along the row, down just before the successor, in to the tip. The
      // descent is near the target rather than near the source: the column to
      // the left of a bar is usually empty, the one to its right is where the
      // next task starts.
      expect(points).toEqual([
        { x: 100, y: 10 },
        { x: 286, y: 10 },
        { x: 286, y: 44 },
        { x: 296, y: 44 },
      ]);
    });

    it('takes the long way round when the bars overlap', () => {
      // The successor starts before the predecessor ends, which is what a
      // slipped plan looks like. A straight line backwards would cut through
      // everything in between.
      const points = connectorPoints({ x: 300, y: 10 }, { x: 200, y: 44 }, options);

      expect(points).toHaveLength(6);
      expect(points[1]).toEqual({ x: 308, y: 10 });   // clear of the bar first
      expect(points[2].y).toBe(40);                    // into the lane
      expect(points[3].y).toBe(40);                    // back along it
      expect(points.at(-1)).toEqual({ x: 196, y: 44 });
    });

    it('stops short of the successor so the arrowhead sits beside it', () => {
      const points = connectorPoints({ x: 100, y: 10 }, { x: 300, y: 44 }, options);
      expect(points.at(-1)!.x).toBe(296);
    });

    it('rounds every corner of a polyline', () => {
      const path = roundedPath(
        [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], 6
      );

      // One curve per interior vertex, and the corner itself becomes the
      // control point rather than a drawn position.
      expect(path.match(/Q/g)).toHaveLength(1);
      expect(path).toContain('Q 50 0');
      expect(path.startsWith('M 0 0')).toBe(true);
    });

    it('never cuts more than half a segment, however large the radius', () => {
      // A 10px run between two turns with a 50px radius: without the cap both
      // curves would reach past each other and the line would double back.
      const path = roundedPath(
        [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }], 50
      );

      expect(path).not.toContain('NaN');
      // The straight piece between the two curves has collapsed to the
      // midpoint rather than overshooting it.
      expect(path).toContain('L 5 0');
    });

    it('draws a straight line rather than nothing when there is no corner', () => {
      expect(roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 6)).toBe('M 0 0 L 10 0');
      expect(roundedPath([{ x: 0, y: 0 }], 6)).toBe('');
    });

    it('survives a repeated point without emitting NaN', () => {
      // Two bars of the same length on adjacent rows can produce a zero-length
      // segment, and dividing by that length is how the whole path disappears.
      const path = roundedPath(
        [{ x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }], 6
      );
      expect(path).not.toContain('NaN');
    });
  });

  describe('dragging a bar', () => {

    it('carries both ends along when the body is moved', () => {
      expect(dragDates('move', '2026-03-10', '2026-03-14', 3))
        .toEqual({ startDate: '2026-03-13', endDate: '2026-03-17' });
    });

    it('moves backwards as readily as forwards', () => {
      expect(dragDates('move', '2026-03-10', '2026-03-14', -4))
        .toEqual({ startDate: '2026-03-06', endDate: '2026-03-10' });
    });

    it('leaves the far end alone when an edge is dragged', () => {
      expect(dragDates('start', '2026-03-10', '2026-03-14', 2))
        .toEqual({ startDate: '2026-03-12', endDate: '2026-03-14' });

      expect(dragDates('end', '2026-03-10', '2026-03-14', 2))
        .toEqual({ startDate: '2026-03-10', endDate: '2026-03-16' });
    });

    it('lets the ends meet but never cross', () => {
      // Dragging the start far past the end: the shortest thing anyone can
      // plan is one day, so it stops on the end rather than inverting.
      expect(dragDates('start', '2026-03-10', '2026-03-14', 99))
        .toEqual({ startDate: '2026-03-14', endDate: '2026-03-14' });

      expect(dragDates('end', '2026-03-10', '2026-03-14', -99))
        .toEqual({ startDate: '2026-03-10', endDate: '2026-03-10' });
    });

    it('grows a bar without limit in the safe direction', () => {
      expect(dragDates('start', '2026-03-10', '2026-03-14', -10).startDate)
        .toBe('2026-02-28');
      expect(dragDates('end', '2026-03-10', '2026-03-14', 10).endDate)
        .toBe('2026-03-24');
    });

    it('changes nothing when the pointer has not crossed a column', () => {
      const from = dragDates('move', '2026-03-10', '2026-03-14', 0);
      expect(from).toEqual({ startDate: '2026-03-10', endDate: '2026-03-14' });
    });
  });
});
