import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';
import { CriticalPath, TaskSchedule } from '../models/schedule.model';

/**
 * The computed schedule, kept separate from TaskService.
 *
 * Tasks are what the user edits; this is what the server derives from them.
 * Mixing the two would make it unclear which parts of the state a mutation is
 * allowed to touch — and this one is never written to, only recomputed.
 */
@Injectable({ providedIn: 'root' })
export class ScheduleAnalysisService {

  private readonly http = inject(HttpClient);

  private readonly _analysis = signal<CriticalPath | null>(null);
  readonly analysis = this._analysis.asReadonly();

  /** Lookup by task id, so a row can find its own numbers in constant time. */
  readonly byTask = computed(() => {
    const map = new Map<number, TaskSchedule>();
    for (const schedule of this._analysis()?.tasks ?? []) {
      map.set(schedule.taskId, schedule);
    }
    return map;
  });

  readonly criticalIds = computed(
    () => new Set(this._analysis()?.criticalPath ?? [])
  );

  async reload(): Promise<void> {
    try {
      this._analysis.set(
        await firstValueFrom(
          this.http.get<CriticalPath>(`${API_BASE_URL}/schedule/critical-path`)
        )
      );
    } catch {
      // The analysis is an overlay on a chart that is already drawn. Losing it
      // should dim the extra information, not replace the chart with an error.
      this._analysis.set(null);
    }
  }
}