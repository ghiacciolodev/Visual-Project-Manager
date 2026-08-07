import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { apiBaseUrl } from './api.config';
import { ProjectService } from './project.service';
import { Member, ProjectRole } from '../models/project.model';
import { ProblemDetail } from '../models/task.model';

/**
 * Thrown when the server refuses a membership change that was well formed —
 * in practice, the last owner trying to step down or be removed.
 *
 * A separate type rather than a message on the error signal because the panel
 * shows it against the row that caused it, not at the top of the screen.
 */
export class MembershipConflict extends Error {}

/**
 * Who is in the current project, and what they may do.
 *
 * Deliberately not folded into ProjectService. That one answers "which project
 * am I looking at", which every view needs on every screen; this one is only
 * read by the panel, and loading a member list on every route change to
 * support one screen would be work nobody asked for.
 */
@Injectable({ providedIn: 'root' })
export class MemberService {

  private readonly http = inject(HttpClient);
  private readonly projects = inject(ProjectService);

  private readonly _members = signal<Member[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly members = this._members.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Built per call: switching project must not leave a stale path behind. */
  private url(): string {
    const projectId = this.projects.currentId();
    if (projectId === null) {
      throw new Error('No project selected');
    }
    return `${apiBaseUrl()}/projects/${projectId}/members`;
  }

  async load(): Promise<void> {
    await this.projects.load();
    if (this.projects.currentId() === null) {
      this._members.set([]);
      return;
    }

    this._loading.set(true);
    this._error.set(null);
    try {
      // Sorted on the way in as well as after every edit. The server orders by
      // role, but not within one, so applying the full comparison here is what
      // makes the list stable rather than dependent on the order rows happened
      // to come back in.
      this._members.set(this.sorted(await firstValueFrom(this.http.get<Member[]>(this.url()))));
    } catch (err) {
      this._error.set(this.readMessage(err, 'Could not load the members'));
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Adds somebody by email, whether or not they have an account.
   *
   * Server-first, like creating a task: the response carries the user id the
   * database assigned and the signedUp flag, neither of which the client can
   * work out on its own — the same address may already belong to a member who
   * has signed in, or to nobody at all.
   */
  async invite(email: string, role: ProjectRole): Promise<Member> {
    try {
      const created = await firstValueFrom(
        this.http.post<Member>(this.url(), { email, role })
      );
      this._members.update(members => this.sorted([...members, created]));
      return created;
    } catch (err) {
      throw this.toError(err);
    }
  }

  /**
   * Optimistic, with rollback — the same shape as changeStatus on a task.
   *
   * A role change is a one-click action on a select, and waiting for a round
   * trip before the control settles makes it feel broken. The refusal that
   * matters here is a normal outcome rather than an outage: demoting the only
   * owner would leave a project nobody can administer, so the server says no
   * and the previous value goes back.
   */
  async changeRole(userId: number, role: ProjectRole): Promise<void> {
    const previous = this._members();

    this._members.update(members =>
      this.sorted(members.map(m => (m.userId === userId ? { ...m, role } : m)))
    );

    try {
      await firstValueFrom(
        this.http.patch<Member>(`${this.url()}/${userId}`, { role })
      );
    } catch (err) {
      this._members.set(previous);
      throw this.toError(err);
    }
  }

  async remove(userId: number): Promise<void> {
    const previous = this._members();
    this._members.update(members => members.filter(m => m.userId !== userId));

    try {
      await firstValueFrom(this.http.delete<void>(`${this.url()}/${userId}`));
    } catch (err) {
      this._members.set(previous);
      throw this.toError(err);
    }
  }

  /**
   * Removes the caller from a project.
   *
   * Separate from remove(userId) even though the endpoint is the same, because
   * the outcome is not: this one ends the caller's access, so the roster it
   * would update is one they can no longer read. Nothing is patched locally —
   * the shell refetches the project list instead.
   */
  async leave(projectId: number, userId: number): Promise<void> {
    try {
      await firstValueFrom(
        this.http.delete<void>(`${apiBaseUrl()}/projects/${projectId}/members/${userId}`)
      );
    } catch (err) {
      throw this.toError(err);
    }
  }

  clearError(): void {
    this._error.set(null);
  }

  /** Called when the person switches project: this list belongs to the old one. */
  clear(): void {
    this._members.set([]);
    this._error.set(null);
  }

  /* --- internals ------------------------------------------------------ */

  /** Owners first, then editors, then viewers — the order the server sends. */
  private sorted(members: Member[]): Member[] {
    const rank: Record<ProjectRole, number> = { OWNER: 0, EDITOR: 1, VIEWER: 2 };
    return [...members].sort(
      (a, b) => rank[a.role] - rank[b.role] || a.displayName.localeCompare(b.displayName)
    );
  }

  private toError(err: unknown): Error {
    if (err instanceof HttpErrorResponse) {
      const problem = err.error as ProblemDetail;

      if (err.status === 409) {
        return new MembershipConflict(
          problem?.detail ?? 'That change conflicts with the current membership'
        );
      }
      if (err.status === 400 && problem?.errors) {
        // One field on this form, so the field-keyed map collapses to its
        // message without losing anything.
        return new Error(Object.values(problem.errors)[0] ?? 'Check the address');
      }
    }
    return new Error(this.readMessage(err, 'Something went wrong'));
  }

  private readMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return 'Cannot reach the server. Check that the backend is running on port 8080.';
      }
      if (err.status === 403) {
        return 'Only an owner can change who is in this project.';
      }
      const problem = err.error as ProblemDetail;
      return problem?.detail ?? problem?.title ?? fallback;
    }
    return fallback;
  }
}
