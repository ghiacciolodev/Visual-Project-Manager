import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { ProjectService } from '../../../core/project.service';
import { Project } from '../../../models/project.model';

@Component({
  selector: 'app-project-panel',
  imports: [ReactiveFormsModule],
  templateUrl: './project-panel.html',
  styleUrl: './project-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectPanel {

  /** null = creating, a project = renaming. One component serves both. */
  readonly project = input<Project | null>(null);

  readonly close = output<void>();

  /** Emitted after a delete, so the shell can settle on what is left. */
  readonly deleted = output<void>();

  private readonly projects = inject(ProjectService);
  private readonly fb = inject(FormBuilder);

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  /**
   * Whether the delete section is showing.
   *
   * Folded away by default. Deleting is not a thing you should be able to
   * reach by mistyping into the panel you opened to fix a spelling.
   */
  readonly removing = signal(false);
  readonly deleting = signal(false);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    description: ['', [Validators.maxLength(2000)]],
  });

  /**
   * What the person has typed to confirm the deletion.
   *
   * The project's own name, not "DELETE" or an OK button. Deleting takes every
   * task and every dependency with it by database cascade, and there is no
   * undo — so the confirmation is worth making impossible to give absent-
   * mindedly, and typing the name means having read which project this is.
   */
  readonly confirmation = signal('');

  readonly confirmed = computed(() => {
    const name = this.project()?.name.trim();
    return !!name && this.confirmation().trim() === name;
  });

  constructor() {
    effect(() => {
      const project = this.project();

      this.form.reset({
        name: project?.name ?? '',
        description: project?.description ?? '',
      });

      this.confirmation.set('');
      this.removing.set(false);
      this.error.set(null);
    });
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    const { name, description } = this.form.getRawValue();
    const trimmed = description.trim() || null;
    const project = this.project();

    try {
      if (project) {
        await this.projects.rename(project.id, name.trim(), trimmed);
      } else {
        await this.projects.create(name.trim(), trimmed);
      }
      this.close.emit();
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  async onDelete(): Promise<void> {
    const project = this.project();
    if (!project || !this.confirmed()) return;

    this.deleting.set(true);
    this.error.set(null);

    try {
      await this.projects.remove(project.id);
      this.deleted.emit();
    } catch (err) {
      this.error.set((err as Error).message);
      this.deleting.set(false);
    }
  }

  onConfirmationInput(event: Event): void {
    this.confirmation.set((event.target as HTMLInputElement).value);
  }

  toggleRemoving(): void {
    this.removing.update(open => !open);
    this.confirmation.set('');
  }

  hasError(field: string, error: string): boolean {
    const control = this.form.get(field);
    return !!control && control.touched && control.hasError(error);
  }
}
