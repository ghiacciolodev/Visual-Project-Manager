import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'tasks', pathMatch: 'full' },

  {
    path: 'tasks',
    // Lazy loading from the start. With one route it changes nothing; with the
    // Gantt chart added it keeps each view out of the other's bundle.
    loadComponent: () =>
      import('./features/tasks/task-dashboard/task-dashboard').then(m => m.TaskDashboard),
  },

  // { path: 'gantt', ... }  ← phase 2

  { path: '**', redirectTo: 'tasks' },
];