import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { Task, TaskPriority, TaskStatus } from '../../../models/task.model';
import { durationDays, formatDay } from '../../../core/schedule';

const STATUS_WORDS: Record<TaskStatus, string> = {
  TODO: 'To do',
  DOING: 'Doing',
  DONE: 'Done',
};

const PRIORITY_WORDS: Record<TaskPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

@Component({
  selector: 'app-task-row',
  templateUrl: './task-card.html',
  styleUrl: './task-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskCard {

  readonly task = input.required<Task>();

  /** Row number, shown in the colour gutter. Position in the sheet, not an id. */
  readonly index = input.required<number>();

  /**
   * How many columns the pane has room for.
   *
   * The row does not decide this — the pane it sits in does, from where the
   * divider is standing — so it arrives as an input rather than a media query.
   * A media query would ask the window how wide it is, and the window is not
   * what changed.
   */
  readonly tier = input<'narrow' | 'mid' | 'wide'>('wide');

  /** On the critical path, per the schedule analysis the chart already holds. */
  readonly critical = input(false);

  /** Days this task could slip before the plan's end date moves. */
  readonly slip = input(0);

  /** True for viewers: the row shows everything and offers no controls. */
  readonly readonly = input(false);

  readonly edit = output<Task>();
  readonly remove = output<Task>();
  readonly statusChange = output<{ task: Task; status: TaskStatus }>();

  readonly duration = computed(() => durationDays(this.task()));

  readonly startLabel = computed(() => formatDay(this.task().startDate));
  readonly endLabel = computed(() => formatDay(this.task().endDate));

  /** Two-digit row number, so the gutter column never reflows. */
  readonly rowNumber = computed(() => String(this.index() + 1).padStart(2, '0'));

  /** Blocker names as a sentence: "A", "A and B", "A, B and C". */
  readonly blockerNames = computed(() => {
    const names = this.task().blockedBy.map(ref => ref.title);
    if (names.length <= 1) return names[0] ?? '';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  });

  /**
   * Status and priority in prose rather than as the enum constant.
   *
   * The API speaks in TODO, DOING and HIGH; a reader should not have to. The
   * mapping lives here rather than in the template so the badge and the select
   * cannot end up wording the same state differently.
   */
  readonly statusLabel = computed(() => STATUS_WORDS[this.task().status]);
  readonly priorityLabel = computed(() => PRIORITY_WORDS[this.task().priority]);

  /**
   * Initials for the assignee chip.
   *
   * Falls back to the first two characters when there is nothing to split on,
   * which is the ordinary case for somebody invited by email and not yet
   * signed in: their display name is their address until Keycloak supplies a
   * real one.
   */
  initialsOf(displayName: string): string {
    const parts = displayName.trim().split(/[\s@._-]+/).filter(Boolean);

    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return displayName.trim().slice(0, 2).toUpperCase();
  }

  onStatusChange(event: Event): void {
    const status = (event.target as HTMLSelectElement).value as TaskStatus;
    this.statusChange.emit({ task: this.task(), status });
  }
}