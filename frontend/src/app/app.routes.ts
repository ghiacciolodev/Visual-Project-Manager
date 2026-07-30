import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'tasks', pathMatch: 'full' },

  {
    path: 'tasks',
    // Lazy loading from the start: each view stays out of the other's bundle.
    loadComponent: () =>
      import('./features/tasks/task-dashboard/task-dashboard').then(m => m.TaskDashboard),
  },

  {
    path: 'gantt',
    loadComponent: () =>
      import('./features/gantt/gantt-chart/gantt-chart').then(m => m.GanttChart),
  },

  { path: '**', redirectTo: 'tasks' },
];