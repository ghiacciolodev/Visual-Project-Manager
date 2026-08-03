import {
  addDays,
  daysBetween,
  dragDates,
  durationDays,
  eachDay,
  monthBands,
  padSpan,
  parseDay,
  positionInSpan,
  projectSpan,
  toIso,
} from './schedule';
import { Task } from '../models/task.model';

function task(startDate: string, endDate: string): Task {
  return {
    id: 1, title: 't', description: null, status: 'TODO', priority: 'MEDIUM',
    startDate, endDate, color: '#3B82F6', dependsOn: [], blockedBy: [], assignee: null,
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
