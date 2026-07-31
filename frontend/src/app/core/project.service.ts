import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';
import { Project } from '../models/project.model';

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

  select(id: number): void {
    this._currentId.set(id);
    localStorage.setItem('vpm.project', String(id));
  }

  /** Called on sign-out: none of this belongs to the next person. */
  clear(): void {
    this._projects.set([]);
    this._currentId.set(null);
    localStorage.removeItem('vpm.project');
  }
}