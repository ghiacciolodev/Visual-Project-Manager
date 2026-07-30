import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';

export interface Project {
  id: number;
  name: string;
  description: string | null;
}

/**
 * The project both views are showing.
 *
 * Fetched once and shared, so the schedule and the chart cannot disagree about
 * which project is on screen — and so the name stops being a string typed into
 * two templates.
 */
@Injectable({ providedIn: 'root' })
export class ProjectService {

  private readonly http = inject(HttpClient);
  private readonly _current = signal<Project | null>(null);

  readonly current = this._current.asReadonly();

  async load(): Promise<void> {
    if (this._current()) return;   // one fetch per session is enough

    try {
      this._current.set(
        await firstValueFrom(this.http.get<Project>(`${API_BASE_URL}/project`))
      );
    } catch {
      // The views fall back to a neutral heading. A missing project name is
      // not worth an error banner over a page that otherwise works.
    }
  }

  clear(): void {
    this._current.set(null);
  }
}