import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';
import { ProjectService } from './project.service';
import { AuditEntry } from '../models/audit.model';
import { ProblemDetail } from '../models/task.model';

/**
 * The project's history.
 *
 * Read-only all the way down: there is no write method here because there is
 * no endpoint behind one. Entries are written by the server as a side effect
 * of the changes themselves, which is the only way a log can be trusted —
 * a client that could add to it could also lie to it.
 */
@Injectable({ providedIn: 'root' })
export class AuditService {

  private readonly http = inject(HttpClient);
  private readonly projects = inject(ProjectService);

  private readonly _entries = signal<AuditEntry[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly entries = this._entries.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  private url(): string {
    const projectId = this.projects.currentId();
    if (projectId === null) {
      throw new Error('No project selected');
    }
    return `${API_BASE_URL}/projects/${projectId}/audit`;
  }

  /**
   * Always refetches.
   *
   * No caching guard, unlike the project list: history is the one thing here
   * that is expected to have moved since last time, and showing a stale copy
   * of a change log is worse than showing none.
   */
  async load(): Promise<void> {
    await this.projects.load();
    if (this.projects.currentId() === null) {
      this._entries.set([]);
      return;
    }

    this._loading.set(true);
    this._error.set(null);
    try {
      this._entries.set(await firstValueFrom(this.http.get<AuditEntry[]>(this.url())));
    } catch (err) {
      this._error.set(this.readMessage(err));
    } finally {
      this._loading.set(false);
    }
  }

  clear(): void {
    this._entries.set([]);
    this._error.set(null);
  }

  private readMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return 'Cannot reach the server. Check that the backend is running on port 8080.';
      }
      const problem = err.error as ProblemDetail;
      return problem?.detail ?? problem?.title ?? 'Could not load the history';
    }
    return 'Could not load the history';
  }
}
