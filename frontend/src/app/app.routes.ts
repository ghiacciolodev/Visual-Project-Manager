import { Routes } from '@angular/router';

import { authGuard } from './core/auth.guard';

/**
 * Two screens, one component.
 *
 * The schedule and the chart were separate components drawing the same dates
 * two different ways, which is duplication nobody benefits from. They share a
 * component now — the same rows, the same filters, the same store — and what
 * the two paths carry is whether the timeline is drawn beside the table.
 *
 * For a while both drew it, on the argument that one screen answering
 * questions about dates and people at once beats two answering half each. On a
 * wide monitor that held. On a laptop the table's own columns left the
 * timeline about ten days wide, and a sliver of chart reads as a mistake
 * rather than as a choice — so the schedule is a table and the chart is a
 * chart, and the code they have in common is still in one place.
 */
export const routes: Routes = [
  { path: '', redirectTo: 'tasks', pathMatch: 'full' },

  {
    path: 'tasks',
    canActivate: [authGuard],
    data: { title: 'Schedule', timeline: false },
    // Still lazy: the plan is the heaviest thing in the app, and the sign-in
    // screen has no use for it.
    loadComponent: () =>
      import('./features/gantt/gantt-chart/gantt-chart').then(m => m.GanttChart),
  },

  {
    path: 'gantt',
    canActivate: [authGuard],
    data: { title: 'Chart', timeline: true, pane: 'timeline' },
    loadComponent: () =>
      import('./features/gantt/gantt-chart/gantt-chart').then(m => m.GanttChart),
  },

  // Membership is deliberately not a route. It is a panel over whichever view
  // you were reading, the same as the task form: routing to it would swap the
  // plan out for a blank sheet and slide the panel over nothing.

  { path: '**', redirectTo: 'tasks' },
];
