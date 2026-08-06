import { Routes } from '@angular/router';

import { authGuard } from './core/auth.guard';

/**
 * Two paths, one view.
 *
 * The schedule and the chart were separate components drawing the same dates
 * two different ways, and neither could answer a question that needed both
 * halves. They are now one screen — a table beside a timeline — and what the
 * two paths still carry is where the divider between them starts.
 *
 * Kept as two rather than collapsed into one because they are how the work is
 * already talked about here, and because a link to either still lands somebody
 * where they meant to go.
 */
export const routes: Routes = [
  { path: '', redirectTo: 'tasks', pathMatch: 'full' },

  {
    path: 'tasks',
    canActivate: [authGuard],
    data: { title: 'Schedule', pane: 'table' },
    // Still lazy: the plan is the heaviest thing in the app, and the sign-in
    // screen has no use for it.
    loadComponent: () =>
      import('./features/gantt/gantt-chart/gantt-chart').then(m => m.GanttChart),
  },

  {
    path: 'gantt',
    canActivate: [authGuard],
    data: { title: 'Chart', pane: 'timeline' },
    loadComponent: () =>
      import('./features/gantt/gantt-chart/gantt-chart').then(m => m.GanttChart),
  },

  // Membership is deliberately not a route. It is a panel over whichever view
  // you were reading, the same as the task form: routing to it would swap the
  // plan out for a blank sheet and slide the panel over nothing.

  { path: '**', redirectTo: 'tasks' },
];
