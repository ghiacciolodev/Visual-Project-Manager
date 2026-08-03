import { Task, TaskPriority, TaskStatus } from '../models/task.model';

/**
 * Narrowing and ordering a task list, as pure functions.
 *
 * Client-side on purpose. The list is already in memory and already the source
 * both views read from; asking the server to filter it would add a round trip,
 * a loading state and a second definition of what "matching" means. This
 * changes the moment the list is paginated, and at that point the filter has
 * to move to the server with it.
 */

export const ANY = 'ANY';
export type Any = typeof ANY;

export interface TaskFilter {
  status: TaskStatus | Any;
  priority: TaskPriority | Any;
  /** Inclusive bounds, either or both empty for open-ended. */
  from: string;
  to: string;
}

export const NO_FILTER: TaskFilter = { status: ANY, priority: ANY, from: '', to: '' };

export type SortKey = 'start' | 'end' | 'title' | 'priority' | 'status';

/** Most urgent first, which is the order somebody scanning for trouble wants. */
const PRIORITY_ORDER: Record<TaskPriority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** Unstarted first: the reading order of a plan, not of a report. */
const STATUS_ORDER: Record<TaskStatus, number> = { TODO: 0, DOING: 1, DONE: 2 };

export function isFiltering(filter: TaskFilter): boolean {
  return filter.status !== ANY || filter.priority !== ANY || !!filter.from || !!filter.to;
}

/**
 * Tasks matching every active clause.
 *
 * The date bounds select tasks that *overlap* the window rather than tasks
 * contained by it. A task running from before the window to after it is the
 * most relevant thing in that period, and a containment test would be the one
 * thing it excludes.
 */
export function filterTasks(tasks: Task[], filter: TaskFilter): Task[] {
  return tasks.filter(task => {
    if (filter.status !== ANY && task.status !== filter.status) return false;
    if (filter.priority !== ANY && task.priority !== filter.priority) return false;

    // ISO dates compare correctly as strings, which is most of why the API
    // speaks in them.
    if (filter.from && task.endDate < filter.from) return false;
    if (filter.to && task.startDate > filter.to) return false;

    return true;
  });
}

/**
 * Sorted, with a stable tie-break.
 *
 * Every key falls back to the start date and then to the id. Without it, two
 * tasks of equal priority would swap places on unrelated edits — the list
 * would reshuffle itself while somebody was reading it.
 */
export function sortTasks(tasks: Task[], key: SortKey): Task[] {
  const byStart = (a: Task, b: Task) =>
    a.startDate.localeCompare(b.startDate) || a.id - b.id;

  return [...tasks].sort((a, b) => {
    switch (key) {
      case 'start':
        return byStart(a, b);
      case 'end':
        return a.endDate.localeCompare(b.endDate) || byStart(a, b);
      case 'title':
        return a.title.localeCompare(b.title) || byStart(a, b);
      case 'priority':
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || byStart(a, b);
      case 'status':
        return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byStart(a, b);
    }
  });
}
