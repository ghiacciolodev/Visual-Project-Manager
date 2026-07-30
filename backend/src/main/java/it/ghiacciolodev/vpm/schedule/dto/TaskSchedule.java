package it.ghiacciolodev.vpm.schedule.dto;

import java.time.LocalDate;

/**
 * One task's place in the computed schedule.
 *
 * The four integers are day offsets from the project anchor, not dates. CPM
 * works in durations and offsets; turning them into calendar dates is a
 * presentation concern, and keeping the arithmetic in whole days avoids
 * dragging weekends, months and time zones through the algorithm.
 */
public record TaskSchedule(

    Long taskId,
    String title,

    /** Inclusive length in days, taken from the planned dates. */
    int duration,

    /** Earliest the task can start, given its prerequisites. */
    int earliestStart,
    int earliestFinish,

    /** Latest it can start without pushing the project's end date. */
    int latestStart,
    int latestFinish,

    /**
     * Days this task can slip before the project finishes later.
     * Zero means it is on the critical path.
     */
    int totalFloat,

    boolean critical,

    LocalDate plannedStart,
    LocalDate plannedEnd,

    /**
     * True when the plan schedules this task to begin on or before a
     * prerequisite ends.
     *
     * Not an error — plans overlap all the time, sometimes deliberately —
     * but it is worth surfacing, because the dependency then describes
     * something the dates contradict.
     */
    boolean startsBeforePrerequisites
) {
}
