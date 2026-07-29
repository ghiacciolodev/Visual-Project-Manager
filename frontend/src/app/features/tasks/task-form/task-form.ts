import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import {
  Task,
  TaskPriority,
  TaskRequest,
  TaskStatus,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../../../models/task.model';

@Component({
  selector: 'app-task-form',
  imports: [ReactiveFormsModule],
  templateUrl: './task-form.html',
  styleUrl: './task-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskForm {

  /** null = creating, a task = editing. One component serves both. */
  readonly task = input<Task | null>(null);
  readonly submitting = input(false);

  readonly save = output<TaskRequest>();
  readonly cancel = output<void>();

  readonly statuses = TASK_STATUSES;
  readonly priorities = TASK_PRIORITIES;

  /** Field errors returned by the server, merged into the template's messages. */
  readonly serverErrors = signal<Record<string, string>>({});

  private readonly fb = inject(FormBuilder);

  // Validators deliberately mirror the backend's. This is duplication, and it
  // is the right kind: the client copy exists for fast feedback, the server
  // copy is the one that actually enforces anything. The server is never
  // trusted to the client, and the client is never trusted by the server.
  //
  // Note "as TaskStatus" rather than "as const": the latter would pin the
  // control's type to the literal 'TODO' and reject every other value on
  // patchValue. The cast widens it to the full union, which is what a select
  // bound to this control actually produces.
  readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    description: ['', [Validators.maxLength(2000)]],
    status: ['TODO' as TaskStatus, [Validators.required]],
    priority: ['MEDIUM' as TaskPriority, [Validators.required]],
    startDate: [this.today(), [Validators.required]],
    endDate: [this.today(), [Validators.required]],
    color: ['#3B82F6', [Validators.required, Validators.pattern(/^#[0-9A-Fa-f]{6}$/)]],
  });

  constructor() {
    // Fills the form when a task is passed in for editing. An effect rather
    // than ngOnChanges because the input is a signal.
    effect(() => {
      const task = this.task();
      if (task) {
        this.form.patchValue({
          title: task.title,
          description: task.description ?? '',
          status: task.status,
          priority: task.priority,
          startDate: task.startDate,
          endDate: task.endDate,
          color: task.color,
        });
      } else {
        this.form.reset({
          title: '',
          description: '',
          status: 'TODO',
          priority: 'MEDIUM',
          startDate: this.today(),
          endDate: this.today(),
          color: '#3B82F6',
        });
      }
      this.serverErrors.set({});
    });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      // Angular only shows errors on touched controls, so an untouched form
      // submitted by pressing Enter would silently do nothing.
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.save.emit({
      ...value,
      description: value.description.trim() || null,
    });
  }

  /** Called by the parent when the API rejects the payload. */
  applyServerErrors(errors: Record<string, string>): void {
    this.serverErrors.set(errors);
  }

  hasError(field: string, error: string): boolean {
    const control = this.form.get(field);
    return !!control && control.touched && control.hasError(error);
  }

  private today(): string {
    // yyyy-MM-dd, the format <input type="date"> and the backend both expect.
    return new Date().toISOString().slice(0, 10);
  }
}