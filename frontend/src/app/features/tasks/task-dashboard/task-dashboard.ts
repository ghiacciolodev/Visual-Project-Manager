import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';

import { ConflictError, TaskService, ValidationError } from '../../../core/task.service';
import { ProjectService } from '../../../core/project.service';
import {
  Task,
  TaskPriority,
  TaskStatus,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../../../models/task.model';
import {
  ANY,
  NO_FILTER,
  SortKey,
  TaskFilter,
  filterTasks,
  isFiltering,
  sortTasks,
} from '../../../core/task-filter';
import { formatDay, projectSpan } from '../../../core/schedule';
import { TaskCard } from '../task-card/task-card';
import { TaskForm, TaskFormResult } from '../task-form/task-form';

@Component({
  selector: 'app-task-dashboard',
  imports: [TaskCard, TaskForm],
  templateUrl: './task-dashboard.html',
  styleUrl: './task-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskDashboard implements OnInit, OnDestroy {

  // Injected as public fields so the template reads their signals directly.
  // No local copy of the list: duplicating it here is how two views drift.
  readonly taskService = inject(TaskService);
  readonly projects = inject(ProjectService);

  readonly formOpen = signal(false);
  readonly editing = signal<Task | null>(null);
  readonly submitting = signal(false);

  /* --- filtering and sorting ------------------------------------------- */

  readonly statuses = TASK_STATUSES;
  readonly priorities = TASK_PRIORITIES;
  readonly any = ANY;

  readonly filter = signal<TaskFilter>(NO_FILTER);
  readonly sortKey = signal<SortKey>('start');

  readonly filtering = computed(() => isFiltering(this.filter()));

  /**
   * What the ledger actually renders.
   *
   * A computed over the same signal both views read, so filtering costs no
   * request and cannot disagree with the chart about what exists — it only
   * disagrees about what is worth looking at right now.
   */
  readonly visible = computed(() =>
    sortTasks(filterTasks(this.taskService.tasks(), this.filter()), this.sortKey())
  );

  readonly hiddenCount = computed(
    () => this.taskService.tasks().length - this.visible().length
  );

  /**
   * Shared window for every row's timeline.
   *
   * Measured against every task, not the visible ones. If the scale followed
   * the filter, the same task would draw a different bar depending on what
   * else was on screen, and two readings could not be compared.
   */
  readonly span = computed(() => projectSpan(this.taskService.tasks()));

  readonly spanLabel = computed(() => {
    const span = this.span();
    if (!span) return null;
    return `${formatDay(span.start)} – ${formatDay(span.end)} · ${span.days} days`;
  });

  private readonly form = viewChild(TaskForm);

  ngOnInit(): void {
    // load() resolves the project first, so one call covers both.
    void this.taskService.load();
    // Somebody else's changes arrive on their own while this is on screen.
    this.taskService.startPolling();
  }

  ngOnDestroy(): void {
    this.taskService.stopPolling();
  }

  openCreate(): void {
    this.editing.set(null);
    this.formOpen.set(true);
  }

  openEdit(task: Task): void {
    this.editing.set(task);
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editing.set(null);
  }

  /**
   * Saves the fields first, then reconciles the dependencies.
   *
   * That order matters: a status change to DONE is rejected while prerequisites
   * are unfinished, so the task update has to be judged against the graph as it
   * stood, not against edges added moments earlier in the same save.
   */
  async onSave({ request, dependencies }: TaskFormResult): Promise<void> {
    this.submitting.set(true);
    try {
      const editing = this.editing();
      const task = editing
        ? await this.taskService.update(editing.id, request)
        : await this.taskService.create(request);

      await this.taskService.syncDependencies(task.id, dependencies);
      this.closeForm();
    } catch (err) {
      // The panel stays open on failure: closing it would throw away the
      // user's input for a problem they can still fix.
      if (err instanceof ValidationError) {
        this.form()?.applyServerErrors(err.fieldErrors);
      } else if (err instanceof ConflictError) {
        this.form()?.applyConflict(err.message, err.offenders);
      } else {
        this.form()?.applyServerErrors({ title: (err as Error).message });
      }
    } finally {
      this.submitting.set(false);
    }
  }

  onStatusChange({ task, status }: { task: Task; status: TaskStatus }): void {
    void this.taskService.changeStatus(task, status);
  }

  /* --- filter controls -------------------------------------------------- */

  onStatusFilter(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as TaskStatus | typeof ANY;
    this.filter.update(f => ({ ...f, status: value }));
  }

  onPriorityFilter(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as TaskPriority | typeof ANY;
    this.filter.update(f => ({ ...f, priority: value }));
  }

  onFrom(event: Event): void {
    this.filter.update(f => ({ ...f, from: (event.target as HTMLInputElement).value }));
  }

  onTo(event: Event): void {
    this.filter.update(f => ({ ...f, to: (event.target as HTMLInputElement).value }));
  }

  onSort(event: Event): void {
    this.sortKey.set((event.target as HTMLSelectElement).value as SortKey);
  }

  clearFilter(): void {
    this.filter.set(NO_FILTER);
  }

  onDelete(task: Task): void {
    if (confirm(`Delete "${task.title}"? This cannot be undone.`)) {
      void this.taskService.delete(task.id);
    }
  }
}