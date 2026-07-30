import { Routes } from '@angular/router';

import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'tasks', pathMatch: 'full' },

  {
    path: 'tasks',
    canActivate: [authGuard],
    // Lazy loading from the start: each view stays out of the other's bundle.
    loadComponent: () =>
      import('./features/tasks/task-dashboard/task-dashboard').then(m => m.TaskDashboard),
  },

  {
    path: 'gantt',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/gantt/gantt-chart/gantt-chart').then(m => m.GanttChart),
  },

  { path: '**', redirectTo: 'tasks' },
];