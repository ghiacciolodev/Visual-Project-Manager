import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';
import { ProjectService } from './project.service';
import { ProblemDetail, Task, TaskRef, TaskRequest, TaskStatus } from '../models/task.model';

/** Thrown when the server rejects a payload field by field (400). */
export class ValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super('Validation failed');
  }
}

/**
 * Thrown when the request is well formed but the graph forbids it (409):
 * a cycle, or finishing a task whose prerequisites are unfinished.
 */
export class ConflictError extends Error {
  constructor(message: string, public readonly offenders: TaskRef[] = []) {
    super(message);
  }
}

/**
 * Single source of truth for task state.
 *
 * State lives in signals held by the service, not inside a component. The
 * dashboard and the Gantt chart must show the same data at the same time, and
 * that is only guaranteed when both read the same signal.
 */
@Injectable({ providedIn: 'root' })
export class TaskService {

  private readonly http = inject(HttpClient);
  private readonly projects = inject(ProjectService);

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
      blocked: tasks.filter(t => t.blockedBy.length > 0).length,
    };
  });

  /**
   * Base URL for the current project's tasks.
   *
   * Built per call rather than stored, so switching project cannot leave a
   * stale path behind — the kind of bug that writes into the wrong project and
   * is only noticed later.
   */
  private url(): string {
    const projectId = this.projects.currentId();
    if (projectId === null) {
      throw new Error('No project selected');
    }
    return `${API_BASE_URL}/projects/${projectId}/tasks`;
  }

  async load(): Promise<void> {
    // Projects first: without an id there is no URL to call.
    await this.projects.load();
    if (this.projects.currentId() === null) {
      this._tasks.set([]);
      return;
    }

    this._loading.set(true);
    this._error.set(null);
    try {
      this._tasks.set(await firstValueFrom(this.http.get<Task[]>(this.url())));
    } catch (err) {
      this._error.set(this.readMessage(err, 'Could not load tasks'));
    } finally {
      this._loading.set(false);
    }
  }

  /** Clears and reloads. Called when the person switches project. */
  async reloadFor(): Promise<void> {
    this._tasks.set([]);
    this._error.set(null);
    await this.load();
  }

  /**
   * Re-fetches without showing the loading state.
   *
   * Blocking is a property of the whole graph, not of one row: finishing a
   * task unblocks all of its successors, and none of those rows were touched
   * by the request. Patching one task locally would leave every other row's
   * status stale, so after any graph-affecting change the list is reconciled
   * with the server — quietly, so the chart does not blink on every click.
   */
  private async refresh(): Promise<void> {
    try {
      this._tasks.set(await firstValueFrom(this.http.get<Task[]>(this.url())));
    } catch {
      // A failed background refresh is not worth interrupting anyone over:
      // the visible row is already correct, only derived state may lag.
    }
  }

  /**
   * Server-first, not optimistic: the response carries the id assigned by the
   * database, and inventing a temporary one only to reconcile it later buys
   * nothing on an action the user expects to take a moment.
   */
  async create(request: TaskRequest): Promise<Task> {
    try {
      const created = await firstValueFrom(this.http.post<Task>(this.url(), request));
      this._tasks.update(tasks => this.sorted([...tasks, created]));
      return created;
    } catch (err) {
      throw this.toError(err);
    }
  }

  async update(id: number, request: TaskRequest): Promise<Task> {
    try {
      const updated = await firstValueFrom(
        this.http.put<Task>(`${this.url()}/${id}`, request)
      );
      this._tasks.update(tasks =>
        this.sorted(tasks.map(t => (t.id === id ? updated : t)))
      );
      void this.refresh();
      return updated;
    } catch (err) {
      throw this.toError(err);
    }
  }

  /**
   * Optimistic, with rollback.
   *
   * Changing a status is a one-click action; waiting for a round trip before
   * the marker moves makes the UI feel broken. The previous state is captured
   * first so a failed request can put it back exactly as it was — and a
   * rejected DONE is a normal outcome here, not an exception.
   */
  async changeStatus(task: Task, status: TaskStatus): Promise<void> {
    const previous = this._tasks();

    this._tasks.update(tasks =>
      tasks.map(t => (t.id === task.id ? { ...t, status } : t))
    );

    try {
      await firstValueFrom(
        this.http.put<Task>(`${this.url()}/${task.id}`, { ...this.toRequest(task), status })
      );
      void this.refresh();
    } catch (err) {
      this._tasks.set(previous);
      this._error.set(this.readMessage(err, 'Could not update the task'));
    }
  }

  /**
   * Moves a task in time, optimistically.
   *
   * Same shape as changeStatus, and for a stronger reason: this is called on
   * the release of a drag, and the bar is already where the pointer left it.
   * Snapping back to the old dates for the length of a round trip, then
   * forward again, would read as the chart fighting the hand.
   *
   * Nothing else about the task travels differently — the payload is the whole
   * record, so the assignee and the dependencies ride along untouched.
   */
  async reschedule(task: Task, startDate: string, endDate: string): Promise<void> {
    const previous = this._tasks();

    this._tasks.update(tasks =>
      this.sorted(tasks.map(t => (t.id === task.id ? { ...t, startDate, endDate } : t)))
    );

    try {
      await firstValueFrom(
        this.http.put<Task>(`${this.url()}/${task.id}`, {
          ...this.toRequest(task), startDate, endDate,
        })
      );
      // Moving a task changes no edges, but it moves the critical path and
      // every float figure derived from it, so the list is reconciled.
      void this.refresh();
    } catch (err) {
      this._tasks.set(previous);
      this._error.set(this.readMessage(err, 'Could not move the task'));
    }
  }

  async delete(id: number): Promise<void> {
    const previous = this._tasks();
    this._tasks.update(tasks => tasks.filter(t => t.id !== id));

    try {
      await firstValueFrom(this.http.delete<void>(`${this.url()}/${id}`));
      // Deleting a task drops its edges, so other rows may stop being blocked.
      void this.refresh();
    } catch (err) {
      this._tasks.set(previous);
      this._error.set(this.readMessage(err, 'Could not delete the task'));
    }
  }

  /* --- dependencies --------------------------------------------------- */

  async addDependency(taskId: number, predecessorId: number): Promise<void> {
    try {
      const updated = await firstValueFrom(
        this.http.post<Task>(`${this.url()}/${taskId}/dependencies`, { predecessorId })
      );
      this._tasks.update(tasks => tasks.map(t => (t.id === taskId ? updated : t)));
    } catch (err) {
      throw this.toError(err);
    }
  }

  async removeDependency(taskId: number, predecessorId: number): Promise<void> {
    try {
      const updated = await firstValueFrom(
        this.http.delete<Task>(`${this.url()}/${taskId}/dependencies/${predecessorId}`)
      );
      this._tasks.update(tasks => tasks.map(t => (t.id === taskId ? updated : t)));
    } catch (err) {
      throw this.toError(err);
    }
  }

  /**
   * Applies a whole set of predecessors at once, as a diff against what the
   * task already has.
   *
   * The form collects edges without touching the server, so Save is the single
   * moment anything changes — including Cancel meaning nothing changed.
   * Removals run before additions: freeing an edge first can be what makes a
   * new one legal instead of a cycle.
   */
  async syncDependencies(taskId: number, wanted: number[]): Promise<void> {
    const current = this._tasks().find(t => t.id === taskId)?.dependsOn ?? [];
    const currentIds = current.map(ref => ref.id);

    for (const id of currentIds.filter(id => !wanted.includes(id))) {
      await this.removeDependency(taskId, id);
    }
    for (const id of wanted.filter(id => !currentIds.includes(id))) {
      await this.addDependency(taskId, id);
    }

    await this.refresh();
  }

  clearError(): void {
    this._error.set(null);
  }

  /* --- internals ------------------------------------------------------ */

  /**
   * Strips server-owned fields: the API must never receive them back.
   *
   * assigneeId has to be here even though nothing on this path edits it. The
   * request replaces every mutable field, so a value left out is a value set
   * to null — and changeStatus, which builds its payload from this, would
   * quietly unassign whoever was doing the work every time somebody moved a
   * task to Doing.
   */
  private toRequest(task: Task): TaskRequest {
    return {
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      startDate: task.startDate,
      endDate: task.endDate,
      color: task.color,
      assigneeId: task.assignee?.id ?? null,
    };
  }

  // Same ordering the backend applies, so a locally inserted item lands where
  // a reload would put it. Without this the list jumps around on refresh.
  private sorted(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  private toError(err: unknown): Error {
    if (err instanceof HttpErrorResponse) {
      const problem = err.error as ProblemDetail;

      if (err.status === 400 && problem?.errors) {
        return new ValidationError(problem.errors);
      }
      if (err.status === 409) {
        return new ConflictError(
          problem?.detail ?? 'That change conflicts with the current schedule',
          problem?.offenders ?? []
        );
      }
    }
    return new Error(this.readMessage(err, 'Something went wrong'));
  }

  private readMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      // status 0 means the request never reached the server: backend down, or
      // CORS rejected it before the response was readable.
      if (err.status === 0) {
        return 'Cannot reach the server. Check that the backend is running on port 8080.';
      }
      // 403 is a role problem, not an outage. Saying so plainly is more use
      // than a generic failure the person cannot act on.
      if (err.status === 403) {
        return 'Your role in this project does not allow that.';
      }
      const problem = err.error as ProblemDetail;
      return problem?.detail ?? problem?.title ?? fallback;
    }
    return fallback;
  }
}