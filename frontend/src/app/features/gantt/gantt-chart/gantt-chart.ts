import {
  AfterViewInit,
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { ConflictError, TaskService, ValidationError } from '../../../core/task.service';
import { ScheduleAnalysisService } from '../../../core/schedule-analysis.service';
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
import { TaskCard } from '../../tasks/task-card/task-card';
import {
  DayCell,
  DragMode,
  addDays,
  connectorPoints,
  dragDates,
  daysBetween,
  durationDays,
  eachDay,
  formatDay,
  monthBands,
  padSpan,
  projectSpan,
  roundedPath,
  todayIso,
} from '../../../core/schedule';
import { TaskForm, TaskFormResult } from '../../tasks/task-form/task-form';
import { csvFilename, downloadText, toCsv } from '../../../core/export';

type Zoom = 'days' | 'weeks' | 'months';

/** Column width in pixels at each zoom level. */
const DAY_WIDTH: Record<Zoom, number> = {
  days: 38,
  weeks: 15,
  months: 6,
};

/**
 * Usable width of a landscape A4 at 96dpi, less the margins @page sets.
 *
 * Approximate by nature — the paper size is the operating system's decision
 * and Letter is 17mm narrower — which is why it is only ever used to shrink a
 * day column and never to widen one. Overshooting by a few millimetres costs a
 * hairline of the last day; undershooting costs nothing at all.
 */
const PRINT_WIDTH_PX = 1040;

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
  imports: [TaskForm, TaskCard],
  templateUrl: './gantt-chart.html',
  styleUrl: './gantt-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GanttChart implements OnInit, AfterViewInit, OnDestroy {

  // The same store the dashboard reads. Neither view fetches on its own, which
  // is what makes an edit in one appear in the other with no wiring at all.
  readonly taskService = inject(TaskService);

  /** Derived schedule: critical path and float. Never written to, only recomputed. */
  readonly schedule = inject(ScheduleAnalysisService);

  readonly projects = inject(ProjectService);

  // Only for the synchronous flush that printing needs. Nothing else in this
  // component reaches for the application reference, and nothing else should.
  private readonly appRef = inject(ApplicationRef);

  readonly zoom = signal<Zoom>('days');
  readonly rowHeight = ROW_HEIGHT;

  /**
   * True only for the moment the browser spends laying the page out for paper.
   *
   * Set from the beforeprint event rather than from the button, so it is also
   * true when somebody prints with Ctrl+P or from the browser's own menu —
   * which is how most people who want a PDF will do it.
   */
  readonly printing = signal(false);

  /**
   * How wide a day is, in pixels.
   *
   * On screen this is only the zoom. On paper it is whatever makes the whole
   * plan fit the width of one sheet, which is a different question with a
   * different answer: a chart is a horizontally scrolling thing, and paper
   * does not scroll. Printed at day zoom, a three-month plan runs to about
   * four pages, and the frozen task column is only on the first of them —
   * pages two to four are bars with nothing to say which row they belong to.
   *
   * Only ever narrower, never wider. Stretching six-pixel columns to fill a
   * page would put a two-week plan across a metre of paper.
   */
  readonly dayWidth = computed(() => {
    const onScreen = DAY_WIDTH[this.zoom()];
    if (!this.printing()) return onScreen;

    const days = this.days().length;
    if (!days) return onScreen;

    const fitted = Math.floor((PRINT_WIDTH_PX - this.tableWidth()) / days);
    // Two pixels is where a bar stops being a bar, and below it the reader is
    // better served by the table beside it than by a fitted smear.
    return Math.min(onScreen, Math.max(fitted, 2));
  });

  /** Float tails are informative on a busy chart and noise on a simple one. */
  readonly showFloat = signal(true);

  readonly formOpen = signal(false);
  readonly editing = signal<Task | null>(null);
  readonly submitting = signal(false);

  /* --- the split ------------------------------------------------------- */

  private readonly route = inject(ActivatedRoute).snapshot.data;

  readonly viewTitle: string = this.route['title'] ?? 'Plan';

  /**
   * Whether this route draws the timeline beside the table.
   *
   * It did on both for a while, on the argument that one screen answering
   * questions about dates and people at once beats two screens answering half
   * each. The argument holds on a wide monitor and falls over on a laptop,
   * where the table's own columns leave the timeline about ten days wide — a
   * sliver of chart that reads as a mistake rather than as a choice.
   *
   * So the schedule is a table and nothing else. What it gains is not just the
   * width: it stops being a chart with a table stapled to it and goes back to
   * being a list you can read straight down.
   */
  readonly showTimeline: boolean = this.route['timeline'] !== false;

  /**
   * Width of the table pane, in pixels. Only meaningful beside a timeline —
   * without one the table has the whole view and there is nothing to divide.
   */
  readonly tableWidth = signal(
    // Clamped to the window as well as to the preset: 820px of table on a
    // phone leaves nothing for the thing the table is describing.
    Math.min(
      this.route['pane'] === 'timeline' ? 232 : 820,
      Math.max(window.innerWidth - 300, 168)
    )
  );

  /**
   * How wide the table actually is.
   *
   * Two different questions depending on the route, and the honest answer to
   * each is a different measurement. Beside a timeline the divider decides, so
   * the window is irrelevant. Alone, the window decides, so the divider is —
   * which is why this is not a media query: a media query could only ever
   * answer the second.
   */
  private readonly viewportWidth = signal(window.innerWidth);

  readonly paneWidth = computed(() =>
    this.showTimeline
      ? this.tableWidth()
      // The rail takes 208px of it, and gives them back below the width where
      // it lies down across the top.
      : Math.max(this.viewportWidth() - (this.viewportWidth() > 900 ? 208 : 0), 168)
  );

  /**
   * How much of the table the divider has left room for.
   *
   * Three settings rather than two, because there is a wide band of widths
   * where the status and the controls fit and the dates do not — and the dates
   * are the columns the reader can most afford to lose, since the bar beside
   * them is drawn from exactly those two numbers.
   */
  readonly tier = computed<'narrow' | 'mid' | 'wide'>(() => {
    const w = this.paneWidth();
    if (w < 470) return 'narrow';
    return w < 800 ? 'mid' : 'wide';
  });

  /**
   * The table's columns, as one grid template shared by the head and every row.
   *
   * Declared here rather than in the stylesheet because which one applies
   * depends on the divider, and the divider is state. Both the column head and
   * every row read it through --row-cols, so a column cannot be widened in one
   * and not the other.
   *
   * The task column floors at 0 and not at a readable minimum, which looks
   * like the wrong choice and is not: a floor big enough to be worth having is
   * a floor that, added to the fixed columns, exceeds the pane — and a grid
   * that cannot fit its minimums does not shrink, it overflows, silently
   * flattening whichever flexible column comes next. Measured: a 120px floor
   * here collapsed the assignee column to nothing and pushed the controls
   * seventy pixels out over the timeline. A title that ellipsises is the
   * cheaper failure.
   */
  readonly columns = computed(() => {
    const tier = this.tier();

    const base = {
      narrow: '3px 28px minmax(0, 1fr)',
      mid: '3px 28px minmax(0, 1fr) 80px 64px',
      wide: '3px 28px minmax(0, 1fr) 80px 64px minmax(0, 120px) 112px 36px',
    }[tier];

    // The last track holds the controls — a status picker, Edit, Delete. The
    // narrow pane has never had them, and paper has no use for them, so on
    // both the track goes rather than standing empty: 160px of a printed page
    // is a sixth of its width.
    return tier === 'narrow' || this.printing() ? base : `${base} 160px`;
  });

  private readonly resizing = signal(false);

  /** Keeps paneWidth honest when the table is the whole view. */
  private readonly onResize = (): void => this.viewportWidth.set(window.innerWidth);

  /* --- filtering and sorting ------------------------------------------- */

  readonly statuses = TASK_STATUSES;
  readonly priorities = TASK_PRIORITIES;
  readonly any = ANY;

  readonly filter = signal<TaskFilter>(NO_FILTER);
  readonly sortKey = signal<SortKey>('start');
  readonly filtering = computed(() => isFiltering(this.filter()));

  /**
   * The rows to draw, filtered and ordered.
   *
   * The window is measured from every task rather than from these, so
   * filtering thins the chart out without rescaling it — the bars that remain
   * stay exactly where they were, which is the only way a filter is useful
   * for comparing.
   */
  readonly visible = computed(() =>
    sortTasks(filterTasks(this.taskService.tasks(), this.filter()), this.sortKey())
  );

  readonly hiddenCount = computed(() => this.taskService.tasks().length - this.visible().length);

  readonly spanLabel = computed(() => {
    const span = projectSpan(this.taskService.tasks());
    return span ? `${formatDay(span.start)} → ${formatDay(span.end)}` : null;
  });

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  /** The frozen task-name column, for measuring how much of the scroller the
      timeline actually gets. */
  private readonly names = viewChild<ElementRef<HTMLElement>>('names');
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

    return this.visible().map(task => {
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
   * Connectors between dependent bars, with the geometry in schedule.ts.
   *
   * Three things were wrong with the previous version, all of them showing up
   * when bars overlap — which is the ordinary state of a plan that has
   * slipped, not an edge case.
   *
   * The corners were square, which at this density reads as a diagram rather
   * than a drawn line. They are rounded now, and the radius is capped at half
   * the shorter neighbouring segment so two turns close together cannot eat
   * the same run of line and cross over.
   *
   * The descent happened immediately after the predecessor. It now happens
   * just before the successor: the column to the left of a bar is far more
   * often empty than the one to its right, because that is where the next
   * task is about to start.
   *
   * And two connectors sharing a corridor were drawn on exactly the same
   * line, so one hid the other and the pair read as a single arrow. Each
   * additional lane between the same two rows is now nudged further out.
   */
  readonly connectors = computed(() => {
    const rows = this.rows();
    const dayWidth = this.dayWidth();

    // Tighter geometry at small zooms, where a fixed 8px stub would be wider
    // than the days it is drawn across.
    const stub = dayWidth < 12 ? 4 : 8;
    const approach = dayWidth < 12 ? 6 : 10;
    const radius = dayWidth < 12 ? 3 : 6;

    const positionOf = new Map<number, { row: ChartRow; index: number }>();
    rows.forEach((row, index) => positionOf.set(row.task.id, { row, index }));

    /**
     * How many backward routes already run between a given pair of rows.
     *
     * Two connectors travelling the same corridor used to be drawn on exactly
     * the same line, which reads as one arrow and hides the other. Each
     * subsequent lane is nudged a little further out.
     */
    const laneUse = new Map<string, number>();

    const paths: string[] = [];

    rows.forEach((row, index) => {
      for (const predecessor of row.task.dependsOn) {
        const from = positionOf.get(predecessor.id);
        if (!from || from.index === index) continue;

        const start = {
          x: (from.row.offset + from.row.length) * dayWidth,
          y: from.index * ROW_HEIGHT + ROW_HEIGHT / 2,
        };
        const end = {
          x: row.offset * dayWidth,
          y: index * ROW_HEIGHT + ROW_HEIGHT / 2,
        };

        // The corridor between the two rows, biased towards the successor so
        // the line is already heading the right way when it turns.
        const key = `${Math.min(from.index, index)}:${Math.max(from.index, index)}`;
        const taken = laneUse.get(key) ?? 0;
        laneUse.set(key, taken + 1);

        const towards = end.y > start.y ? 1 : -1;
        const lane = start.y + towards * (ROW_HEIGHT / 2 + 3 + taken * 4);

        paths.push(roundedPath(
          connectorPoints(start, end, { stub, approach, radius, lane }),
          radius
        ));
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
    // a deep link to either path working without the other having run.
    void this.taskService.load();
    this.taskService.startPolling();

    // Only where the window is what decides the columns. Beside a timeline the
    // divider decides, and listening would be answering a question nobody
    // asked.
    if (!this.showTimeline) window.addEventListener('resize', this.onResize);

    window.addEventListener('beforeprint', this.onBeforePrint);
    window.addEventListener('afterprint', this.onAfterPrint);
  }

  ngOnDestroy(): void {
    this.taskService.stopPolling();
    // A drag interrupted by navigation would otherwise leave polling off for
    // the rest of the session.
    this.taskService.resumePolling();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('beforeprint', this.onBeforePrint);
    window.removeEventListener('afterprint', this.onAfterPrint);
  }

  ngAfterViewInit(): void {
    // Scrolls today into view rather than starting at the far left. On a long
    // project the interesting part is almost never the beginning. Nothing to
    // scroll when there is no timeline.
    if (this.showTimeline) queueMicrotask(() => this.scrollToToday());
  }

  scrollToToday(): void {
    const index = this.todayIndex();
    const element = this.scroller()?.nativeElement;
    if (index === null || !element) return;

    // The names column is inside the scroller now and sits over the timeline
    // rather than beside it, so the width available to the days is the
    // scroller's minus the frozen column. Measured rather than assumed: the
    // width is a CSS variable that the narrow layout changes.
    const frozen = this.names()?.nativeElement.offsetWidth ?? 0;
    const target = index * this.dayWidth() - (element.clientWidth - frozen) / 3;
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
    this.formOpen.set(true);
  }

  openCreate(): void {
    this.editing.set(null);
    this.formOpen.set(true);
  }

  onDelete(task: Task): void {
    if (confirm(`Delete "${task.title}"? This cannot be undone.`)) {
      void this.taskService.delete(task.id);
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

  /* --- taking it away --------------------------------------------------- */

  /**
   * The active filters, in words.
   *
   * Only ever read on paper, and that is the whole reason it exists. On screen
   * the filter controls show their own state and the strip says how many rows
   * are hidden. A printed sheet shows six tasks out of fifteen with nothing to
   * say the other nine were left out, which is not a shorter document — it is
   * a wrong one.
   */
  readonly filterSummary = computed(() => {
    const filter = this.filter();
    const parts: string[] = [];

    if (filter.status !== ANY) parts.push(`status ${filter.status}`);
    if (filter.priority !== ANY) parts.push(`priority ${filter.priority}`);
    if (filter.from) parts.push(`active from ${formatDay(filter.from)}`);
    if (filter.to) parts.push(`active to ${formatDay(filter.to)}`);

    return parts.join(' · ');
  });

  /** Stamped when the print begins, so the sheet says when it was true. */
  readonly printedOn = signal('');

  /**
   * The plan as a spreadsheet, in the order and the selection on screen.
   *
   * Built from rows() rather than from the whole task list, which is the point:
   * what somebody means by "export" is nearly always "give me what I am looking
   * at". A dragged bar is drawn from the drag rather than from the task, but no
   * drag can be in progress while this button is being pressed.
   */
  exportCsv(): void {
    const csv = toCsv(this.rows().map(row => ({
      task: row.task,
      critical: this.isCritical(row.task.id),
      slip: this.slipOf(row),
    })));

    downloadText(
      csvFilename(this.projects.current()?.name ?? 'plan', todayIso()),
      csv,
      // The charset matters as much as the byte-order mark: between them, a
      // browser preview and a spreadsheet both read it as UTF-8.
      'text/csv;charset=utf-8'
    );
  }

  /**
   * Hands the view to the browser's print dialog, where "Save as PDF" lives.
   *
   * Not a PDF library. Producing one would mean drawing the chart a second
   * time in a different set of primitives — the same duplication that merging
   * the schedule and the chart into one component was meant to end — and
   * paying about 300 kB of bundle for the privilege. The browser already has a
   * renderer that agrees with the one on screen, and what it emits has
   * selectable text and real pagination rather than a picture of a plan.
   *
   * What the print stylesheet does with it is the actual work; this is one
   * line because it should be.
   */
  print(): void {
    window.print();
  }

  private readonly onBeforePrint = (): void => {
    this.printedOn.set(new Date().toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    }));
    this.printing.set(true);

    // Zoneless change detection is scheduled, and the browser lays the page
    // out for paper the instant this handler returns. Without a synchronous
    // flush the fitted day width would reach the DOM after the snapshot was
    // taken, and the chart would print at its screen zoom — the exact defect
    // this is here to prevent.
    this.appRef.tick();
  };

  private readonly onAfterPrint = (): void => this.printing.set(false);

  /* --- the divider ------------------------------------------------------ */

  /**
   * Drags the boundary between the table and the timeline.
   *
   * Measured from the scroller's left edge rather than by accumulating deltas:
   * the pane is what the pointer is pointing at, so an absolute measurement
   * cannot drift away from the cursor over a long drag the way a running total
   * can.
   */
  onDividerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.resizing.set(true);
  }

  onDividerMove(event: PointerEvent): void {
    if (!this.resizing()) return;

    const left = this.scroller()?.nativeElement.getBoundingClientRect().left ?? 0;
    // Floors at a width that still fits a number and a name, and stops well
    // short of the full pane so the timeline never disappears entirely.
    const width = Math.min(Math.max(event.clientX - left, 168), 960);
    this.tableWidth.set(Math.round(width));
  }

  onDividerUp(event: PointerEvent): void {
    if (!this.resizing()) return;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    this.resizing.set(false);
  }

  /** Keyboard equivalent, so the split is not mouse-only. */
  onDividerKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 96 : 24;
    if (event.key === 'ArrowLeft') {
      this.tableWidth.update(w => Math.max(w - step, 168));
    } else if (event.key === 'ArrowRight') {
      this.tableWidth.update(w => Math.min(w + step, 960));
    } else {
      return;
    }
    event.preventDefault();
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

    // A poll landing mid-gesture replaces the task list, and the drawn window
    // is measured from it — the columns would shift under a pointer that is
    // aiming at them.
    this.taskService.pausePolling();

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
    this.taskService.resumePolling();

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

  /**
   * The browser took the pointer away — a context menu, a system gesture.
   *
   * Its own handler rather than an inline drag.set(null), because abandoning
   * a gesture has to put polling back as well; leaving that out means one
   * interrupted drag stops the view updating for the rest of the session.
   */
  onBarCancel(): void {
    this.drag.set(null);
    this.taskService.resumePolling();
  }

  /** Escape abandons the drag; the bar returns to where it was. */
  onBarKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.drag()) {
      this.drag.set(null);
      this.taskService.resumePolling();
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