import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';
import { ProblemDetail, Task, TaskRequest, TaskStatus } from '../models/task.model';

/**
 * Thrown when the server rejects a payload. Carries the field-keyed map from
 * the Problem Details response so a form can attach each message to its input.
 */
export class ValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super('Validation failed');
  }
}

/**
 * Single source of truth for task state.
 *
 * State lives in signals held by the service, not inside a component. The
 * dashboard and the Gantt chart must show the same data at the same time
 * (requirement: editing in one view updates the other), and that is only
 * guaranteed when both read the same signal instead of fetching separately.
 */
@Injectable({ providedIn: 'root' })
export class TaskService {

  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE_URL}/tasks`;

  // Writable signals stay private; components get read-only views. Without
  // this, any component could call .set() and the single source of truth
  // quietly stops being single.
  private readonly _tasks = signal<Task[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly tasks = this._tasks.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly isEmpty = computed(() => !this._loading() && this._tasks().length === 0);

  readonly counts = computed(() => {
    const tasks = this._tasks();
    return {
      total: tasks.length,
      todo: tasks.filter(t => t.status === 'TODO').length,
      doing: tasks.filter(t => t.status === 'DOING').length,
      done: tasks.filter(t => t.status === 'DONE').length,
    };
  });

  async load(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const tasks = await firstValueFrom(this.http.get<Task[]>(this.url));
      this._tasks.set(tasks);
    } catch (err) {
      this._error.set(this.readMessage(err, 'Could not load tasks'));
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Server-first, not optimistic: the response carries the id assigned by the
   * database, and inventing a temporary one only to reconcile it later buys
   * nothing on an action the user expects to take a moment.
   */
  async create(request: TaskRequest): Promise<void> {
    try {
      const created = await firstValueFrom(this.http.post<Task>(this.url, request));
      this._tasks.update(tasks => this.sorted([...tasks, created]));
    } catch (err) {
      throw this.toError(err);
    }
  }

  async update(id: number, request: TaskRequest): Promise<void> {
    try {
      const updated = await firstValueFrom(
        this.http.put<Task>(`${this.url}/${id}`, request)
      );
      this._tasks.update(tasks =>
        this.sorted(tasks.map(t => (t.id === id ? updated : t)))
      );
    } catch (err) {
      throw this.toError(err);
    }
  }

  /**
   * Optimistic, with rollback.
   *
   * Changing a status is a one-click action; waiting for a round trip before
   * the badge moves makes the UI feel broken. The previous state is captured
   * first so a failed request can put it back exactly as it was.
   */
  async changeStatus(task: Task, status: TaskStatus): Promise<void> {
    const previous = this._tasks();

    this._tasks.update(tasks =>
      tasks.map(t => (t.id === task.id ? { ...t, status } : t))
    );

    try {
      await firstValueFrom(
        this.http.put<Task>(`${this.url}/${task.id}`, { ...this.toRequest(task), status })
      );
    } catch (err) {
      this._tasks.set(previous);
      this._error.set(this.readMessage(err, 'Could not update the task'));
    }
  }

  /** Optimistic as well: removal should feel instant. */
  async delete(id: number): Promise<void> {
    const previous = this._tasks();
    this._tasks.update(tasks => tasks.filter(t => t.id !== id));

    try {
      await firstValueFrom(this.http.delete<void>(`${this.url}/${id}`));
    } catch (err) {
      this._tasks.set(previous);
      this._error.set(this.readMessage(err, 'Could not delete the task'));
    }
  }

  clearError(): void {
    this._error.set(null);
  }

  /** Strips the id: the server assigns it and must never receive it back. */
  private toRequest(task: Task): TaskRequest {
    const { id, ...request } = task;
    return request;
  }

  // Same ordering the backend applies, so an item inserted locally lands where
  // a reload would put it. Without this the list jumps around on refresh.
  private sorted(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  private toError(err: unknown): Error {
    if (err instanceof HttpErrorResponse && err.status === 400) {
      const problem = err.error as ProblemDetail;
      if (problem?.errors) {
        return new ValidationError(problem.errors);
      }
    }
    return new Error(this.readMessage(err, 'Something went wrong'));
  }

  private readMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      // status 0 means the request never reached the server: backend down,
      // or CORS rejected it before the response was readable.
      if (err.status === 0) {
        return 'Cannot reach the server. Is the backend running?';
      }
      const problem = err.error as ProblemDetail;
      return problem?.detail ?? problem?.title ?? fallback;
    }
    return fallback;
  }
}