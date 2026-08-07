import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { MemberService } from '../../../core/member.service';

import {
  Task,
  TaskPriority,
  TaskRef,
  TaskRequest,
  TaskStatus,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../../../models/task.model';

/** What the form hands back: the fields, plus the predecessors it wants. */
export interface TaskFormResult {
  request: TaskRequest;
  dependencies: number[];
}

@Component({
  selector: 'app-task-form',
  imports: [ReactiveFormsModule],
  templateUrl: './task-form.html',
  styleUrl: './task-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskForm implements OnInit {

  /**
   * The project's members, for the assignee picker.
   *
   * Loaded here rather than passed in, because the form is the only place
   * that needs them and the panel is opened rarely. Reading the roster needs
   * no more than membership — administering it is what needs an owner — so an
   * editor gets the list they need to hand work to somebody.
   */
  readonly members = inject(MemberService);

  /** null = creating, a task = editing. One component serves both. */
  readonly task = input<Task | null>(null);
  readonly submitting = input(false);

  /** Everything in the project, so predecessors can be offered. */
  readonly allTasks = input<Task[]>([]);

  readonly save = output<TaskFormResult>();
  readonly cancel = output<void>();

  readonly statuses = TASK_STATUSES;
  readonly priorities = TASK_PRIORITIES;

  /** Field errors from a 400. */
  readonly serverErrors = signal<Record<string, string>>({});

  /** Message and culprits from a 409. Shown at the top: a cycle is about the
   *  whole graph, not about one input. */
  readonly conflict = signal<{ message: string; offenders: TaskRef[] } | null>(null);

  /**
   * Predecessors chosen but not yet sent. Nothing reaches the server until
   * Save, so Cancel genuinely cancels — including the dependency edits.
   */
  readonly picked = signal<TaskRef[]>([]);

  /**
   * Tasks that may still be chosen: not this one, and not already picked.
   *
   * Tasks that would close a cycle are *not* filtered out here. Working that
   * out client-side would mean shipping a second copy of the reachability
   * logic and keeping it in step with the recursive query; the server refuses
   * with a message that names both tasks, which is more useful than an option
   * that silently is not there.
   */
  readonly available = computed(() => {
    const current = this.task();
    const pickedIds = new Set(this.picked().map(ref => ref.id));

    return this.allTasks().filter(
      candidate => candidate.id !== current?.id && !pickedIds.has(candidate.id)
    );
  });

  private readonly fb = inject(FormBuilder);

  // Validators deliberately mirror the backend's. This is duplication, and it
  // is the right kind: the client copy exists for fast feedback, the server
  // copy is the one that enforces anything.
  //
  // "as TaskStatus" rather than "as const": the latter would pin the control
  // to the literal 'TODO' and reject every other value on patchValue.
  readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    description: ['', [Validators.maxLength(2000)]],
    status: ['TODO' as TaskStatus, [Validators.required]],
    priority: ['MEDIUM' as TaskPriority, [Validators.required]],
    startDate: [this.today(), [Validators.required]],
    endDate: [this.today(), [Validators.required]],
    color: ['#3B82F6', [Validators.required, Validators.pattern(/^#[0-9A-Fa-f]{6}$/)]],
    // A string because that is what a <select> holds; '' means nobody.
    assigneeId: [''],
  });

  ngOnInit(): void {
    void this.members.load();
  }

  constructor() {
    // Fills the form when a task is passed in. An effect rather than
    // ngOnChanges because the input is a signal.
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
          assigneeId: task.assignee ? String(task.assignee.id) : '',
        });
        this.picked.set([...task.dependsOn]);
      } else {
        this.form.reset({
          title: '',
          description: '',
          status: 'TODO',
          priority: 'MEDIUM',
          startDate: this.today(),
          endDate: this.today(),
          color: '#3B82F6',
          assigneeId: '',
        });
        this.picked.set([]);
      }

      this.serverErrors.set({});
      this.conflict.set(null);
    });
  }

  addDependency(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const id = Number(select.value);
    select.value = '';   // return the control to its prompt
    if (!id) return;

    const task = this.allTasks().find(t => t.id === id);
    if (task) {
      this.picked.update(refs => [
        ...refs,
        { id: task.id, title: task.title, status: task.status },
      ]);
    }
  }

  removeDependency(id: number): void {
    this.picked.update(refs => refs.filter(ref => ref.id !== id));
  }

  onSubmit(): void {
    if (this.form.invalid) {
      // Angular only shows errors on touched controls, so an untouched form
      // submitted with Enter would silently do nothing.
      this.form.markAllAsTouched();
      return;
    }

    const { assigneeId, description, ...rest } = this.form.getRawValue();

    this.save.emit({
      request: {
        ...rest,
        description: description.trim() || null,
        // '' is the picker's way of saying nobody; the API wants null.
        assigneeId: assigneeId ? Number(assigneeId) : null,
        // The version the form was filled in against. Null when creating,
        // where there is nothing yet to be stale against.
        expectedVersion: this.task()?.version ?? null,
      },
      dependencies: this.picked().map(ref => ref.id),
    });
  }

  applyServerErrors(errors: Record<string, string>): void {
    this.serverErrors.set(errors);
  }

  applyConflict(message: string, offenders: TaskRef[]): void {
    this.conflict.set({ message, offenders });
  }

  hasError(field: string, error: string): boolean {
    const control = this.form.get(field);
    return !!control && control.touched && control.hasError(error);
  }

  private today(): string {
    // yyyy-MM-dd, what <input type="date"> and the backend both expect.
    return new Date().toISOString().slice(0, 10);
  }
}