// Mirrors the backend DTOs. Keeping the shapes in one file means a change to
// the API breaks compilation in one obvious place rather than in five.

export type TaskStatus = 'TODO' | 'DOING' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

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
 * `errors` is the field-keyed map added for validation failures.
 */
export interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  errors?: Record<string, string>;
}

export const TASK_STATUSES: TaskStatus[] = ['TODO', 'DOING', 'DONE'];
export const TASK_PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH'];