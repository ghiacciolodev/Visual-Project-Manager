import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';

import { ConflictError, TaskService, ValidationError } from '../../../core/task.service';
import { ProjectService } from '../../../core/project.service';
import { Task, TaskStatus } from '../../../models/task.model';
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
export class TaskDashboard implements OnInit {

  // Injected as public fields so the template reads their signals directly.
  // No local copy of the list: duplicating it here is how two views drift.
  readonly taskService = inject(TaskService);
  readonly project = inject(ProjectService);

  readonly formOpen = signal(false);
  readonly editing = signal<Task | null>(null);
  readonly submitting = signal(false);

  /** Shared window for every row's timeline. Recomputes whenever tasks change. */
  readonly span = computed(() => projectSpan(this.taskService.tasks()));

  readonly spanLabel = computed(() => {
    const span = this.span();
    if (!span) return null;
    return `${formatDay(span.start)} – ${formatDay(span.end)} · ${span.days} days`;
  });

  private readonly form = viewChild(TaskForm);

  ngOnInit(): void {
    void this.taskService.load();
    void this.project.load();
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

  onDelete(task: Task): void {
    if (confirm(`Delete "${task.title}"? This cannot be undone.`)) {
      void this.taskService.delete(task.id);
    }
  }
}