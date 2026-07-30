import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { ConflictError, TaskService, ValidationError } from '../../../core/task.service';
import { ScheduleAnalysisService } from '../../../core/schedule-analysis.service';
import { Task } from '../../../models/task.model';
import {
  DayCell,
  daysBetween,
  durationDays,
  eachDay,
  formatDay,
  monthBands,
  padSpan,
  projectSpan,
  todayIso,
} from '../../../core/schedule';
import { TaskForm, TaskFormResult } from '../../tasks/task-form/task-form';

type Zoom = 'days' | 'weeks' | 'months';

/** Column width in pixels at each zoom level. */
const DAY_WIDTH: Record<Zoom, number> = {
  days: 38,
  weeks: 15,
  months: 6,
};

/**
 * Row height in pixels. Declared here and pushed into CSS as a custom property
 * rather than duplicated in the stylesheet: the connector geometry is computed
 * from it, and a value that disagreed with the rendered rows would draw every
 * arrow at the wrong height.
 */
const ROW_HEIGHT = 34;

interface ChartRow {
  task: Task;
  /** Zero-based index of the first day column the bar occupies. */
  offset: number;
  /** How many day columns the bar spans. */
  length: number;
}

@Component({
  selector: 'app-gantt-chart',
  imports: [TaskForm, RouterLink],
  templateUrl: './gantt-chart.html',
  styleUrl: './gantt-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GanttChart implements OnInit, AfterViewInit {

  // The same store the dashboard reads. Neither view fetches on its own, which
  // is what makes an edit in one appear in the other with no wiring at all.
  readonly taskService = inject(TaskService);

  /** Derived schedule: critical path and float. Never written to, only recomputed. */
  readonly schedule = inject(ScheduleAnalysisService);

  readonly zoom = signal<Zoom>('days');
  readonly dayWidth = computed(() => DAY_WIDTH[this.zoom()]);
  readonly rowHeight = ROW_HEIGHT;

  /** Float tails are informative on a busy chart and noise on a simple one. */
  readonly showFloat = signal(true);

  readonly editing = signal<Task | null>(null);
  readonly submitting = signal(false);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly form = viewChild(TaskForm);

  constructor() {
    // Recomputes the analysis whenever the task list changes, from either
    // view. The critical path is a property of the whole graph, so any edit
    // anywhere can move it — reloading only after edits made *here* would
    // leave the chart confidently wrong.
    effect(() => {
      this.taskService.tasks();      // the dependency being tracked
      void this.schedule.reload();
    });
  }

  /* --- window and columns --------------------------------------------- */

  /**
   * The drawn window: the project span plus a few days of margin so no bar
   * ever sits flush against the edge of the chart.
   */
  readonly span = computed(() => {
    const base = projectSpan(this.taskService.tasks());
    if (!base) return null;
    return padSpan(base, 3, 3);
  });

  readonly days = computed<DayCell[]>(() => {
    const span = this.span();
    return span ? eachDay(span) : [];
  });

  readonly months = computed(() => monthBands(this.days()));

  readonly rows = computed<ChartRow[]>(() => {
    const span = this.span();
    if (!span) return [];

    return this.taskService.tasks().map(task => ({
      task,
      offset: daysBetween(span.start, task.startDate),
      length: durationDays(task),
    }));
  });

  readonly bodyHeight = computed(() => this.rows().length * ROW_HEIGHT);

  /** Column index of today, or null when today falls outside the window. */
  readonly todayIndex = computed(() => {
    const span = this.span();
    if (!span) return null;

    const today = todayIso();
    if (today < span.start || today > span.end) return null;

    return daysBetween(span.start, today);
  });

  /**
   * Day numbers are only legible at the widest zoom. At week zoom the labels
   * thin out to Mondays; at month zoom the band above carries the dates on its
   * own. Printing every number at 6px per column would be noise, not data.
   */
  readonly showsDayNumbers = computed(() => this.zoom() !== 'months');
  readonly labelsEveryDay = computed(() => this.zoom() === 'days');

/**
   * Orthogonal connectors between dependent bars.
   *
   * Two routes, because a successor is not always scheduled after its
   * predecessor finishes — an overlap is an ordinary state of a plan that has
   * slipped, and a straight line backwards would cut through the bars in
   * between.
   *
   * The return route travels in the margin beside the predecessor's bar, not
   * along the boundary between rows: a line drawn on the row divider is a line
   * nobody can see.
   */
  readonly connectors = computed(() => {
    const rows = this.rows();
    const dayWidth = this.dayWidth();

    // Tighter geometry at small zooms, where a fixed 8px stub would be wider
    // than the days it is drawn across.
    const stub = dayWidth < 12 ? 4 : 8;       // clearance before the first turn
    const approach = dayWidth < 12 ? 6 : 10;  // straight run into the arrowhead
    const margin = 13;                        // half a bar, plus breathing room

    const positionOf = new Map<number, { row: ChartRow; index: number }>();
    rows.forEach((row, index) => positionOf.set(row.task.id, { row, index }));

    const paths: string[] = [];

    rows.forEach((row, index) => {
      for (const predecessor of row.task.dependsOn) {
        const from = positionOf.get(predecessor.id);
        if (!from || from.index === index) continue;

        const x1 = (from.row.offset + from.row.length) * dayWidth;
        const y1 = from.index * ROW_HEIGHT + ROW_HEIGHT / 2;
        const x2 = row.offset * dayWidth;
        const y2 = index * ROW_HEIGHT + ROW_HEIGHT / 2;

        // Stop short of the bar so the arrowhead sits beside it, not on it.
        const tip = x2 - 4;
        const towards = y2 > y1 ? 1 : -1;

        if (tip - x1 > stub + approach) {
          // Room to cross directly: out, one turn, in.
          paths.push(`M ${x1} ${y1} H ${x1 + stub} V ${y2} H ${tip}`);
        } else {
          // No room: drop into the clear strip beside the predecessor's bar,
          // travel back along it, then down into the successor.
          const lane = y1 + towards * margin;
          const turn = x2 - approach;
          paths.push(
            `M ${x1} ${y1} H ${x1 + stub} V ${lane} H ${turn} V ${y2} H ${tip}`
          );
        }
      }
    });

    return paths;
  });

  /* --- critical path --------------------------------------------------- */

  isCritical(taskId: number): boolean {
    return this.schedule.criticalIds().has(taskId);
  }

  floatOf(taskId: number): number {
    return this.schedule.byTask().get(taskId)?.totalFloat ?? 0;
  }

  /**
   * Length of the float tail in day columns.
   *
   * Drawn from the planned end rather than from the computed latest finish:
   * the chart is a picture of the plan, and "this bar can move N days to the
   * right" is the question a reader is actually asking of it.
   */
  floatColumns(taskId: number): number {
    return this.showFloat() ? this.floatOf(taskId) : 0;
  }

  toggleFloat(): void {
    this.showFloat.update(on => !on);
  }

  /* --- lifecycle and interaction --------------------------------------- */

  ngOnInit(): void {
    // The store may already be populated from the dashboard; calling load()
    // anyway is what keeps a deep link to /gantt working.
    void this.taskService.load();
  }

  ngAfterViewInit(): void {
    // Scrolls today into view rather than starting at the far left. On a long
    // project the interesting part is almost never the beginning.
    queueMicrotask(() => this.scrollToToday());
  }

  scrollToToday(): void {
    const index = this.todayIndex();
    const element = this.scroller()?.nativeElement;
    if (index === null || !element) return;

    const target = index * this.dayWidth() - element.clientWidth / 3;
    element.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }

  setZoom(zoom: Zoom): void {
    this.zoom.set(zoom);
  }

  openEdit(task: Task): void {
    this.editing.set(task);
  }

  closeForm(): void {
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
    const task = this.editing();
    if (!task) return;

    this.submitting.set(true);
    try {
      await this.taskService.update(task.id, request);
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

  /* --- presentation helpers -------------------------------------------- */

  /** Tooltip text on a bar. */
  barTitle(row: ChartRow): string {
    const slack = this.floatOf(row.task.id);
    const base = `${row.task.title} · ${formatDay(row.task.startDate)} → ${formatDay(row.task.endDate)} · ${row.length}d`;

    if (this.isCritical(row.task.id)) {
      return `${base} · on the critical path`;
    }
    return slack > 0 ? `${base} · can slip ${slack}d` : base;
  }

  rowNumber(index: number): string {
    return String(index + 1).padStart(2, '0');
  }

  /**
   * Black or white on the bar, by relative luminance per WCAG. An average of
   * the channels would put white text on yellow, which is unreadable.
   */
  barText(color: string): string {
    const hex = color.replace('#', '');
    const toLinear = (c: number) =>
      c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

    const luminance =
      0.2126 * toLinear(parseInt(hex.slice(0, 2), 16) / 255) +
      0.7152 * toLinear(parseInt(hex.slice(2, 4), 16) / 255) +
      0.0722 * toLinear(parseInt(hex.slice(4, 6), 16) / 255);

    return luminance > 0.55 ? '#14202b' : '#f7f9fa';
  }
}