import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';

import { TaskService, ValidationError } from '../../../core/task.service';
import { Task, TaskRequest, TaskStatus } from '../../../models/task.model';
import { formatDay, projectSpan } from '../../../core/schedule';
import { TaskCard } from '../task-card/task-card';
import { TaskForm } from '../task-form/task-form';

@Component({
  selector: 'app-task-dashboard',
  imports: [TaskCard, TaskForm],
  templateUrl: './task-dashboard.html',
  styleUrl: './task-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskDashboard implements OnInit {

  // Injected as a public field so the template reads its signals directly.
  // No local copy of the list: duplicating it here is how two views drift.
  readonly taskService = inject(TaskService);

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

  async onSave(request: TaskRequest): Promise<void> {
    this.submitting.set(true);
    try {
      const editing = this.editing();
      if (editing) {
        await this.taskService.update(editing.id, request);
      } else {
        await this.taskService.create(request);
      }
      this.closeForm();
    } catch (err) {
      // A validation failure keeps the form open with the messages attached to
      // the offending fields. Closing it would throw away the user's input.
      if (err instanceof ValidationError) {
        this.form()?.applyServerErrors(err.fieldErrors);
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