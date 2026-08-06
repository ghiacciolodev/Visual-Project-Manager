import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import { GanttChart } from './gantt-chart';
import { ProjectService } from '../../../core/project.service';
import { ScheduleAnalysisService } from '../../../core/schedule-analysis.service';
import { TaskService } from '../../../core/task.service';
import { Task } from '../../../models/task.model';

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

/**
 * The store, faked.
 *
 * TaskService is exercised against a real HTTP mock in its own spec; repeating
 * that here would test the wiring twice and the view not at all. What the view
 * needs from it is a list of tasks and somewhere for its lifecycle calls to go.
 */
function setup(
  options: { tasks?: Task[]; critical?: number[]; timeline?: boolean } = {}
) {
  const tasks = signal<Task[]>(options.tasks ?? []);

  const taskService = {
    tasks: tasks.asReadonly(),
    load: () => Promise.resolve(),
    startPolling: () => {},
    stopPolling: () => {},
    pausePolling: () => {},
    resumePolling: () => {},
  };

  const schedule = {
    analysis: () => null,
    byTask: () => new Map<number, { totalFloat: number }>(),
    criticalIds: () => new Set(options.critical ?? []),
    reload: () => Promise.resolve(),
  };

  const projects = { canEdit: () => true };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: TaskService, useValue: taskService },
      { provide: ScheduleAnalysisService, useValue: schedule },
      { provide: ProjectService, useValue: projects },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            data: {
              title: 'Chart',
              // Most of what there is to test only exists beside a timeline.
              timeline: options.timeline ?? true,
              pane: 'timeline',
            },
          },
        },
      },
    ],
  });

  // Constructed rather than rendered: every question below is about what the
  // component computes, and rendering would drag in the template, the row
  // component and a lifecycle that starts polling.
  const view = TestBed.runInInjectionContext(() => new GanttChart());
  return { view, tasks };
}

describe('GanttChart', () => {

  describe('filtering', () => {

    it('thins the rows without moving the window', () => {
      // The window is measured from every task, not from the visible ones, so
      // filtering compares like with like: a bar that survives the filter stays
      // exactly where it was drawn. Rescaling would make the filter useless for
      // the one thing it is for.
      const { view } = setup({
        tasks: [
          task({ id: 1, startDate: '2026-03-02', endDate: '2026-03-06' }),
          task({ id: 2, status: 'DONE', startDate: '2026-06-01', endDate: '2026-06-05' }),
        ],
      });

      const before = view.span();
      expect(view.rows().length).toBe(2);

      view.filter.update(f => ({ ...f, status: 'DONE' }));

      expect(view.rows().length).toBe(1);
      expect(view.rows()[0].task.id).toBe(2);
      expect(view.span()).toEqual(before);
    });

    it('draws no connector to a task the filter has hidden', () => {
      // A dependency needs both ends. Half an arrow pointing off the chart says
      // something false — that the work waits on nothing.
      const { view } = setup({
        tasks: [
          task({ id: 1, status: 'DONE' }),
          task({
            id: 2,
            startDate: '2026-03-09',
            endDate: '2026-03-13',
            dependsOn: [{ id: 1, title: 'Task 1', status: 'DONE' }],
          }),
        ],
      });

      expect(view.connectors().length).toBe(1);

      // Hides the predecessor and leaves the successor visible.
      view.filter.update(f => ({ ...f, status: 'TODO' }));

      expect(view.rows().length).toBe(1);
      expect(view.connectors()).toEqual([]);
    });
  });

  describe('the divider', () => {

    it('sheds the columns the pane has no room for', () => {
      const { view } = setup();

      view.tableWidth.set(900);
      expect(view.tier()).toBe('wide');
      expect(view.columns()).toContain('112px');   // the dates column

      // Dates go first: the bar beside them is drawn from exactly those two
      // numbers, so the timeline is already saying it.
      view.tableWidth.set(600);
      expect(view.tier()).toBe('mid');
      expect(view.columns()).not.toContain('112px');

      view.tableWidth.set(300);
      expect(view.tier()).toBe('narrow');
      expect(view.columns()).toBe('3px 28px minmax(0, 1fr)');
    });

    it('never lets either pane close completely', () => {
      const { view } = setup();

      view.onDividerDown({ button: 0, pointerId: 1, preventDefault: () => {},
        target: { setPointerCapture: () => {} } } as unknown as PointerEvent);

      view.onDividerMove({ clientX: -500 } as PointerEvent);
      expect(view.tableWidth()).toBe(168);

      view.onDividerMove({ clientX: 5000 } as PointerEvent);
      expect(view.tableWidth()).toBe(960);
    });

    it('ignores a drag that never started', () => {
      // pointermove fires on the handle whenever the cursor crosses it, held
      // or not. Without the guard the panes would resize on a passing mouse.
      const { view } = setup();
      const before = view.tableWidth();

      view.onDividerMove({ clientX: 400 } as PointerEvent);

      expect(view.tableWidth()).toBe(before);
    });
  });

  describe('printing', () => {

    it('gives the controls column back to the plan', () => {
      const { view } = setup();
      view.tableWidth.set(900);

      expect(view.columns().endsWith(' 160px')).toBe(true);

      view.printing.set(true);

      // The track held a status picker, Edit and Delete, none of which a sheet
      // of paper can be asked. The columns that carry information stay.
      expect(view.columns().endsWith(' 160px')).toBe(false);
      expect(view.columns()).toContain('112px');
    });

    it('fits the whole plan across the page instead of slicing it', () => {
      // Seven months at 38px a day is about four pages of chart, and the
      // frozen task column is only on the first of them.
      const { view } = setup({
        tasks: [
          task({ id: 1, startDate: '2026-03-02', endDate: '2026-03-20' }),
          task({ id: 2, startDate: '2026-09-01', endDate: '2026-09-30' }),
        ],
      });

      const onScreen = view.dayWidth();
      view.printing.set(true);

      expect(view.dayWidth()).toBeLessThan(onScreen);
      expect(view.days().length * view.dayWidth())
        .toBeLessThanOrEqual(1040 - view.tableWidth());
    });

    it('never stretches a short plan to fill the paper', () => {
      // Only ever narrower. A fortnight spread across a metre of page would be
      // the same defect in the other direction.
      const { view } = setup({
        tasks: [task({ id: 1, startDate: '2026-03-02', endDate: '2026-03-06' })],
      });

      const onScreen = view.dayWidth();
      view.printing.set(true);

      expect(view.dayWidth()).toBe(onScreen);
    });

    it('stops narrowing where a bar stops being a bar', () => {
      const { view } = setup({
        tasks: [
          task({ id: 1, startDate: '2026-01-01', endDate: '2026-01-05' }),
          task({ id: 2, startDate: '2029-12-01', endDate: '2029-12-31' }),
        ],
      });

      view.printing.set(true);

      expect(view.dayWidth()).toBe(2);
    });

    it('says which filters were applied, since paper cannot be asked', () => {
      // A sheet showing six tasks out of fifteen with nothing to say the rest
      // were filtered out is not a shorter document, it is a wrong one.
      const { view } = setup();

      expect(view.filterSummary()).toBe('');

      view.filter.update(f => ({ ...f, status: 'DONE', priority: 'HIGH' }));

      expect(view.filterSummary()).toBe('status DONE · priority HIGH');
    });
  });

  describe('the two routes', () => {

    it('opens the chart with the table cut back to a name', () => {
      expect(setup({ timeline: true }).view.tier()).toBe('narrow');
    });

    it('gives the schedule the whole width and none of the chart controls', () => {
      // Without a timeline the divider decides nothing, so the width the
      // columns answer to is the window's — which is why paneWidth exists
      // rather than the tier reading tableWidth directly.
      const { view } = setup({ timeline: false });

      expect(view.showTimeline).toBe(false);
      expect(view.paneWidth()).not.toBe(view.tableWidth());
      expect(view.tier()).toBe('wide');
    });
  });
});
