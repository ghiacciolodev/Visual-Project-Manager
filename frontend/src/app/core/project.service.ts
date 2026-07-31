import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';
import { Project } from '../models/project.model';
import { ProblemDetail } from '../models/task.model';

/**
 * Which project everything else is about.
 *
 * Until now the backend answered that question from the caller's account, so
 * nothing in the client had to ask. Now the id travels in every URL, and this
 * is the one place that decides it — a component reading it from a route
 * parameter and another from a local field is how two views end up showing
 * different projects.
 */
@Injectable({ providedIn: 'root' })
export class ProjectService {

  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE_URL}/projects`;

  private readonly _projects = signal<Project[]>([]);
  private readonly _currentId = signal<number | null>(null);
  private readonly _loading = signal(false);

  readonly projects = this._projects.asReadonly();
  readonly loading = this._loading.asReadonly();

  readonly current = computed(() => {
    const id = this._currentId();
    return this._projects().find(p => p.id === id) ?? null;
  });

  /**
   * Whether the current member may change the plan.
   *
   * A courtesy, not a control: hiding a button a viewer cannot use is kinder
   * than letting them press it and read a 403. The rule is enforced by the
   * server, which is the only place it can be.
   */
  readonly canEdit = computed(() => {
    const role = this.current()?.myRole;
    return role === 'OWNER' || role === 'EDITOR';
  });

  readonly canAdminister = computed(() => this.current()?.myRole === 'OWNER');

  /** The id other services build their URLs from. */
  readonly currentId = this._currentId.asReadonly();

  /**
   * Loads the caller's projects and settles on one.
   *
   * The choice is remembered across reloads, but validated against what came
   * back: a remembered id could name a project the person has since been
   * removed from, and requesting it would produce a 404 on every screen.
   */
  async load(): Promise<void> {
    if (this._projects().length) return;

    this._loading.set(true);
    try {
      const projects = await firstValueFrom(this.http.get<Project[]>(this.url));
      this._projects.set(projects);

      const remembered = Number(localStorage.getItem('vpm.project'));
      const valid = projects.some(p => p.id === remembered);

      this._currentId.set(valid ? remembered : projects[0]?.id ?? null);
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Refetches the list, ignoring the guard in load().
   *
   * load() returns early once anything is cached, which is what stops every
   * view refetching on navigation. After a create, a rename or a delete the
   * cache is precisely what is wrong, so this is the way back.
   */
  async reload(): Promise<void> {
    const remembered = this._currentId();

    this._loading.set(true);
    try {
      const projects = await firstValueFrom(this.http.get<Project[]>(this.url));
      this._projects.set(projects);

      if (!projects.some(p => p.id === remembered)) {
        this.select(projects[0]?.id ?? null);
      }
    } finally {
      this._loading.set(false);
    }
  }

  select(id: number | null): void {
    this._currentId.set(id);

    if (id === null) {
      localStorage.removeItem('vpm.project');
    } else {
      localStorage.setItem('vpm.project', String(id));
    }
  }

  /* --- writes --------------------------------------------------------- */

  /**
   * Creates a project and switches to it.
   *
   * Server-first: the response carries the id, and the caller is made its
   * owner by the same transaction. Switching is not a separate decision —
   * somebody who just made a project wants to be looking at it.
   */
  async create(name: string, description: string | null): Promise<Project> {
    try {
      const created = await firstValueFrom(
        this.http.post<Project>(this.url, { name, description })
      );
      this._projects.update(projects => [...projects, created]);
      this.select(created.id);
      return created;
    } catch (err) {
      throw this.toError(err);
    }
  }

  async rename(id: number, name: string, description: string | null): Promise<Project> {
    try {
      const updated = await firstValueFrom(
        this.http.put<Project>(`${this.url}/${id}`, { name, description })
      );
      this._projects.update(projects =>
        projects.map(p => (p.id === id ? updated : p))
      );
      return updated;
    } catch (err) {
      throw this.toError(err);
    }
  }

  /**
   * Deletes a project and settles on another.
   *
   * Not optimistic. Everything on screen belongs to this project, and putting
   * it back after a failed request would mean restoring the task list and the
   * schedule analysis too — far more than the one signal an optimistic update
   * is worth. The confirmation this sits behind already makes it deliberate.
   */
  async remove(id: number): Promise<void> {
    try {
      await firstValueFrom(this.http.delete<void>(`${this.url}/${id}`));
    } catch (err) {
      throw this.toError(err);
    }

    const remaining = this._projects().filter(p => p.id !== id);
    this._projects.set(remaining);

    if (this._currentId() === id) {
      this.select(remaining[0]?.id ?? null);
    }
  }

  /** Called on sign-out: none of this belongs to the next person. */
  clear(): void {
    this._projects.set([]);
    this._currentId.set(null);
    localStorage.removeItem('vpm.project');
  }

  /* --- internals ------------------------------------------------------ */

  private toError(err: unknown): Error {
    if (err instanceof HttpErrorResponse) {
      const problem = err.error as ProblemDetail;

      if (err.status === 400 && problem?.errors) {
        return new Error(Object.values(problem.errors)[0] ?? 'Check the name');
      }
      if (err.status === 0) {
        return new Error(
          'Cannot reach the server. Check that the backend is running on port 8080.'
        );
      }
      // 403 and 404 both mean "not yours": the server answers 404 to a
      // stranger so an id cannot be used to probe for projects that exist.
      if (err.status === 403 || err.status === 404) {
        return new Error('That project is not yours to change.');
      }
      return new Error(problem?.detail ?? problem?.title ?? 'Something went wrong');
    }
    return new Error('Something went wrong');
  }
}