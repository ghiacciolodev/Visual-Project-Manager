import { ANY, NO_FILTER, filterTasks, isFiltering, sortTasks } from './task-filter';
import { Task, TaskPriority, TaskStatus } from '../models/task.model';

function task(over: Partial<Task> & { id: number }): Task {
  return {
    title: `Task ${over.id}`,
    description: null,
    status: 'TODO' as TaskStatus,
    priority: 'MEDIUM' as TaskPriority,
    startDate: '2026-03-10',
    endDate: '2026-03-14',
    color: '#3B82F6',
    dependsOn: [],
    blockedBy: [],
    assignee: null,
    ...over,
  };
}

const ids = (tasks: Task[]) => tasks.map(t => t.id);

describe('task filter', () => {

  describe('filtering', () => {

    it('keeps everything when nothing is chosen', () => {
      const tasks = [task({ id: 1 }), task({ id: 2, status: 'DONE' })];
      expect(ids(filterTasks(tasks, NO_FILTER))).toEqual([1, 2]);
      expect(isFiltering(NO_FILTER)).toBe(false);
    });

    it('narrows by status and by priority together', () => {
      const tasks = [
        task({ id: 1, status: 'TODO', priority: 'HIGH' }),
        task({ id: 2, status: 'TODO', priority: 'LOW' }),
        task({ id: 3, status: 'DONE', priority: 'HIGH' }),
      ];

      const matched = filterTasks(tasks, { ...NO_FILTER, status: 'TODO', priority: 'HIGH' });
      expect(ids(matched)).toEqual([1]);
    });

    it('selects tasks that overlap the window rather than tasks inside it', () => {
      const tasks = [
        task({ id: 1, startDate: '2026-03-01', endDate: '2026-03-05' }),  // before
        task({ id: 2, startDate: '2026-03-08', endDate: '2026-03-12' }),  // straddles the start
        task({ id: 3, startDate: '2026-03-11', endDate: '2026-03-13' }),  // inside
        task({ id: 4, startDate: '2026-03-14', endDate: '2026-03-20' }),  // straddles the end
        task({ id: 5, startDate: '2026-03-25', endDate: '2026-03-28' }),  // after
      ];

      // A task running from before the window to after it is the most relevant
      // thing in that period, and a containment test is the one thing that
      // would exclude it.
      const matched = filterTasks(tasks, { ...NO_FILTER, from: '2026-03-10', to: '2026-03-15' });
      expect(ids(matched)).toEqual([2, 3, 4]);
    });

    it('treats each bound as open-ended on its own', () => {
      const tasks = [
        task({ id: 1, startDate: '2026-03-01', endDate: '2026-03-05' }),
        task({ id: 2, startDate: '2026-03-20', endDate: '2026-03-25' }),
      ];

      expect(ids(filterTasks(tasks, { ...NO_FILTER, from: '2026-03-10' }))).toEqual([2]);
      expect(ids(filterTasks(tasks, { ...NO_FILTER, to: '2026-03-10' }))).toEqual([1]);
    });

    it('includes a task that touches the bound exactly', () => {
      const tasks = [task({ id: 1, startDate: '2026-03-10', endDate: '2026-03-14' })];

      // Inclusive at both ends: a task ending on the first day of the window
      // was active during it.
      expect(ids(filterTasks(tasks, { ...NO_FILTER, from: '2026-03-14' }))).toEqual([1]);
      expect(ids(filterTasks(tasks, { ...NO_FILTER, to: '2026-03-10' }))).toEqual([1]);
    });

    it('knows when a filter is doing anything', () => {
      expect(isFiltering({ ...NO_FILTER, status: 'DONE' })).toBe(true);
      expect(isFiltering({ ...NO_FILTER, from: '2026-03-01' })).toBe(true);
      expect(isFiltering({ status: ANY, priority: ANY, from: '', to: '' })).toBe(false);
    });
  });

  describe('sorting', () => {

    it('puts the most urgent first, not the alphabetically first', () => {
      const tasks = [
        task({ id: 1, priority: 'LOW' }),
        task({ id: 2, priority: 'HIGH' }),
        task({ id: 3, priority: 'MEDIUM' }),
      ];
      expect(ids(sortTasks(tasks, 'priority'))).toEqual([2, 3, 1]);
    });

    it('reads a plan in the order work moves through it', () => {
      const tasks = [
        task({ id: 1, status: 'DONE' }),
        task({ id: 2, status: 'TODO' }),
        task({ id: 3, status: 'DOING' }),
      ];
      expect(ids(sortTasks(tasks, 'status'))).toEqual([2, 3, 1]);
    });

    it('breaks ties by start date and then by id', () => {
      const tasks = [
        task({ id: 9, priority: 'HIGH', startDate: '2026-03-12' }),
        task({ id: 3, priority: 'HIGH', startDate: '2026-03-10' }),
        task({ id: 7, priority: 'HIGH', startDate: '2026-03-10' }),
      ];

      // Without a stable tie-break, equal-priority rows would swap places on
      // unrelated edits and the list would reshuffle while being read.
      expect(ids(sortTasks(tasks, 'priority'))).toEqual([3, 7, 9]);
    });

    it('leaves the given array alone', () => {
      const tasks = [task({ id: 2 }), task({ id: 1 })];
      sortTasks(tasks, 'title');
      expect(ids(tasks)).toEqual([2, 1]);
    });

    it('sorts by each remaining key', () => {
      const tasks = [
        task({ id: 1, title: 'Zebra', startDate: '2026-03-12', endDate: '2026-03-20' }),
        task({ id: 2, title: 'Alpha', startDate: '2026-03-14', endDate: '2026-03-15' }),
      ];

      expect(ids(sortTasks(tasks, 'start'))).toEqual([1, 2]);
      expect(ids(sortTasks(tasks, 'end'))).toEqual([2, 1]);
      expect(ids(sortTasks(tasks, 'title'))).toEqual([2, 1]);
    });
  });
});
