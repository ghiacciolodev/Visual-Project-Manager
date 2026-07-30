// Mirrors the backend DTOs. Keeping the shapes in one file means a change to
// the API breaks compilation in one obvious place rather than in five.

export type TaskStatus = 'TODO' | 'DOING' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

/** A task referred to from elsewhere: a predecessor, or a blocker in an error. */
export interface TaskRef {
  id: number;
  title: string;
  status: TaskStatus;
}

/** Matches TaskResponse. Dates arrive as ISO strings (yyyy-MM-dd). */
export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string;
  endDate: string;
  color: string;

  /** Every predecessor, whatever its status. */
  dependsOn: TaskRef[];

  /**
   * Predecessors that are not DONE yet. Derived by the server, not here: the
   * rule that defines "blocked" is enforced server-side, so the server is also
   * the one that says when it applies. Recomputing it in the client would give
   * two implementations of one rule, free to drift.
   */
  blockedBy: TaskRef[];
}

/** Matches TaskRequest. No id: the server assigns it. */
export interface TaskRequest {
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string;
  endDate: string;
  color: string;
}

/**
 * RFC 9457 Problem Details, as produced by GlobalExceptionHandler.
 * `errors` carries field-keyed validation messages; `offenders` carries the
 * tasks responsible for a conflict.
 */
export interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  errors?: Record<string, string>;
  offenders?: TaskRef[];
}

export const TASK_STATUSES: TaskStatus[] = ['TODO', 'DOING', 'DONE'];
export const TASK_PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH'];