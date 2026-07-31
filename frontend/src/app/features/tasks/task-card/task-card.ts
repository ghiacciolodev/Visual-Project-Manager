import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { Task, TaskStatus } from '../../../models/task.model';
import {
  Span,
  durationDays,
  formatDay,
  positionInSpan,
  todayIso,
} from '../../../core/schedule';

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

  /** Shared project window. Every row measures against the same scale. */
  readonly span = input.required<Span | null>();

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
   * Geometry of the inline bar, as percentages of the project span.
   *
   * Percentages rather than pixels so the preview reflows with the column and
   * stays honest at any width — the same approach the full chart takes.
   */
  readonly bar = computed(() => {
    const span = this.span();
    if (!span) return null;

    const left = positionInSpan(span, this.task().startDate);
    const width = (this.duration() / span.days) * 100;

    return { left, width };
  });

  /** Position of the today cursor, or null when today falls outside the span. */
  readonly todayMark = computed(() => {
    const span = this.span();
    if (!span) return null;

    const today = todayIso();
    if (today < span.start || today > span.end) return null;

    return positionInSpan(span, today);
  });

  /**
   * Text on the coloured gutter. Relative luminance per WCAG rather than an
   * average of the channels: the eye weights green far above blue, so an
   * average puts unreadable white numerals on yellow.
   */
  readonly gutterText = computed(() => {
    const hex = this.task().color.replace('#', '');
    const toLinear = (c: number) =>
      c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

    const luminance =
      0.2126 * toLinear(parseInt(hex.slice(0, 2), 16) / 255) +
      0.7152 * toLinear(parseInt(hex.slice(2, 4), 16) / 255) +
      0.0722 * toLinear(parseInt(hex.slice(4, 6), 16) / 255);

    return luminance > 0.55 ? '#14202b' : '#f7f9fa';
  });

  onStatusChange(event: Event): void {
    const status = (event.target as HTMLSelectElement).value as TaskStatus;
    this.statusChange.emit({ task: this.task(), status });
  }
}