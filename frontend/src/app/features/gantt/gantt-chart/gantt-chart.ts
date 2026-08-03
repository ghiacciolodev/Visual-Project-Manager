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
import { ProjectService } from '../../../core/project.service';
import { Task } from '../../../models/task.model';
import {
  DayCell,
  DragMode,
  addDays,
  dragDates,
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

interface Drag {
  taskId: number;
  mode: DragMode;
  /** Where the pointer went down, to measure the offset from. */
  originX: number;
  /** The task's dates when the drag began, to compute against and to restore. */
  fromStart: string;
  fromEnd: string;
  /** The dates as they stand under the pointer right now. */
  startDate: string;
  endDate: string;
  /** False until the pointer has travelled far enough to mean it. */
  moved: boolean;
}

/**
 * How far the pointer must travel before a press becomes a drag.
 *
 * Without a threshold every click on a bar would be a zero-day move: a request
 * sent, a refresh triggered, and the form never opening because the code took
 * the drag branch.
 */
const DRAG_THRESHOLD_PX = 4;

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

  readonly projects = inject(ProjectService);

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

  /**
   * The drag in progress, or null.
   *
   * Held here rather than written through to TaskService: the task list is
   * what the window is measured from, so editing it mid-drag would move the
   * columns under the pointer while the pointer is trying to aim at them.
   * The chart stays still and only the bar moves.
   */
  readonly drag = signal<Drag | null>(null);

  readonly rows = computed<ChartRow[]>(() => {
    const span = this.span();
    if (!span) return [];

    const drag = this.drag();

    return this.taskService.tasks().map(task => {
      // The dragged bar is drawn where the pointer has it, not where the
      // server still thinks it is.
      const dragged = drag?.taskId === task.id;
      const startDate = dragged ? drag.startDate : task.startDate;
      const endDate = dragged ? drag.endDate : task.endDate;

      return {
        task,
        offset: daysBetween(span.start, startDate),
        length: daysBetween(startDate, endDate) + 1,
      };
    });
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

  /* --- dependency connectors ------------------------------------------- */

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

  /* --- critical path and slack ----------------------------------------- */

  isCritical(taskId: number): boolean {
    return this.schedule.criticalIds().has(taskId);
  }

  /** Total float as CPM defines it: earliest start versus latest start. */
  floatOf(taskId: number): number {
    return this.schedule.byTask().get(taskId)?.totalFloat ?? 0;
  }

  /**
   * How far this bar can move right from where it is drawn.
   *
   * Not the same as total float, and the difference is the whole reason this
   * exists. Total float measures slack from a task's *earliest* possible
   * start; the chart draws bars at their *planned* start, which is often
   * later. A task with 23 days of total float that is already planned seven
   * days late can only slip sixteen — and sixteen is the number a reader is
   * asking for when they look at the bar.
   */
  slipOf(row: ChartRow): number {
    const analysis = this.schedule.analysis();
    const entry = this.schedule.byTask().get(row.task.id);

    if (!analysis?.projectStart || !entry || entry.critical) return 0;

    // latestFinish counts days from the anchor, which is day zero, so the last
    // permissible day is anchor + latestFinish - 1.
    const latestEnd = addDays(analysis.projectStart, entry.latestFinish - 1);
    return Math.max(0, daysBetween(row.task.endDate, latestEnd));
  }

  /**
   * The tail in day columns, clamped to the drawn window.
   *
   * Without the clamp a long tail spans past the last column, CSS Grid invents
   * implicit ones to hold it, and the row stops lining up with everything else
   * — which is exactly what a 23-day tail on a 28-day chart did.
   */
  floatColumns(row: ChartRow): number {
    if (!this.showFloat()) return 0;

    const remaining = this.days().length - (row.offset + row.length);
    return Math.min(this.slipOf(row), Math.max(0, remaining));
  }

  toggleFloat(): void {
    this.showFloat.update(on => !on);
  }

  /* --- lifecycle and interaction --------------------------------------- */

  ngOnInit(): void {
    // load() resolves the project first, so one call covers both — and keeps
    // a deep link to /gantt working without the dashboard having run.
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
    // A viewer's click does nothing. The server would refuse the save anyway;
    // this is what stops the form opening only to fail on submit.
    if (!this.projects.canEdit()) return;
    this.editing.set(task);
  }

  /* --- dragging and resizing ------------------------------------------- */

  isDragging(taskId: number): boolean {
    const drag = this.drag();
    return drag?.taskId === taskId && drag.moved;
  }

  /**
   * Takes hold of a bar.
   *
   * The pointer is captured on the element that was pressed, so the gesture
   * survives leaving the bar — which it will immediately, since the bar is
   * moving out from under the cursor. Without capture the first fast drag
   * would drop the moment the pointer outran the element.
   */
  onBarPointerDown(row: ChartRow, mode: DragMode, event: PointerEvent): void {
    if (!this.projects.canEdit() || event.button !== 0) return;

    // Stops the grip from also starting a body drag, and stops the browser
    // from deciding this is a text selection or a scroll gesture.
    event.stopPropagation();
    event.preventDefault();

    (event.target as HTMLElement).setPointerCapture(event.pointerId);

    this.drag.set({
      taskId: row.task.id,
      mode,
      originX: event.clientX,
      fromStart: row.task.startDate,
      fromEnd: row.task.endDate,
      startDate: row.task.startDate,
      endDate: row.task.endDate,
      moved: false,
    });
  }

  onBarPointerMove(event: PointerEvent): void {
    const drag = this.drag();
    if (!drag) return;

    const travelled = event.clientX - drag.originX;
    const moved = drag.moved || Math.abs(travelled) >= DRAG_THRESHOLD_PX;
    if (!moved) return;

    // Whole days only. A schedule has no half-days, and snapping is also what
    // makes the bar land where the columns are.
    const days = Math.round(travelled / this.dayWidth());
    const { startDate, endDate } = dragDates(drag.mode, drag.fromStart, drag.fromEnd, days);

    this.drag.set({ ...drag, startDate, endDate, moved: true });
  }

  /**
   * Lets go.
   *
   * A press that never travelled is a click, and opens the form — the bar has
   * no separate click binding, because a click event fires after every
   * pointerup and would open the form at the end of each drag.
   */
  onBarPointerUp(row: ChartRow, event: PointerEvent): void {
    const drag = this.drag();
    if (!drag) return;

    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    this.drag.set(null);

    if (!drag.moved) {
      this.openEdit(row.task);
      return;
    }

    // Nothing changed after snapping — dragged and returned, or moved less
    // than half a column. Sending a request that sets the dates to what they
    // already are would cost a round trip and a refresh for nothing.
    if (drag.startDate === drag.fromStart && drag.endDate === drag.fromEnd) {
      return;
    }

    void this.taskService.reschedule(row.task, drag.startDate, drag.endDate);
  }

  /** Escape abandons the drag; the bar returns to where it was. */
  onBarKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.drag()) {
      this.drag.set(null);
    }
  }

  /**
   * The dates a dragged bar currently claims, for the tooltip.
   *
   * Read from the drag rather than the task, so the figures under the pointer
   * are the ones being proposed rather than the ones still on the server.
   */
  dragLabel(): string | null {
    const drag = this.drag();
    if (!drag?.moved) return null;

    const days = daysBetween(drag.startDate, drag.endDate) + 1;
    return `${formatDay(drag.startDate)} → ${formatDay(drag.endDate)} · ${days}d`;
  }

  closeForm(): void {
    this.editing.set(null);
  }

  async onSave({ request, dependencies }: TaskFormResult): Promise<void> {
    const task = this.editing();
    if (!task) return;

    this.submitting.set(true);
    try {
      await this.taskService.update(task.id, request);
      await this.taskService.syncDependencies(task.id, dependencies);
      this.closeForm();
    } catch (err) {
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
    const base = `${row.task.title} · ${formatDay(row.task.startDate)} → ${formatDay(row.task.endDate)} · ${row.length}d`;

    if (this.isCritical(row.task.id)) {
      return `${base} · on the critical path`;
    }

    // Both numbers, because they answer different questions and a reader who
    // knows CPM will want to reconcile them.
    const slip = this.slipOf(row);
    return slip > 0
      ? `${base} · can slip ${slip}d · ${this.floatOf(row.task.id)}d total float`
      : base;
  }

  rowNumber(index: number): string {
    return String(index + 1).padStart(2, '0');
  }

  /**
   * Grid position of the bar. Split into start and span rather than composed
   * into one "10 / span 16" string: a shorthand assembled at runtime is a
   * single opaque value to the style binding, and a mis-parse silently falls
   * back to auto-placement — which puts the element in the first free cell
   * instead of on its date.
   */
  barStart(row: ChartRow): number {
    return row.offset + 1;
  }

  tailStart(row: ChartRow): number {
    return row.offset + row.length + 1;
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