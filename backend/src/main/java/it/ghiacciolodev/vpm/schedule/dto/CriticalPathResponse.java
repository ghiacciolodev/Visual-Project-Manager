package it.ghiacciolodev.vpm.schedule.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * The result of a critical path analysis.
 *
 * Reports the computed schedule *and* the planned one, because the gap between
 * them is the useful part: a plan that spans longer than its critical path has
 * slack somewhere, and this is what says how much and where.
 */
public record CriticalPathResponse(

    /** Anchor: the earliest planned start in the project. */
    LocalDate projectStart,

    /** Length of the critical path in days — the shortest the work can take. */
    int criticalDuration,

    /** projectStart + criticalDuration, as a date. */
    LocalDate earliestFinish,

    /** The last planned end date across all tasks. */
    LocalDate plannedFinish,

    /** Days the plan spends beyond what the dependencies require. */
    int slackInPlan,

    /** Ids on the critical path, in schedule order. */
    List<Long> criticalPath,

    List<TaskSchedule> tasks
) {

    public static CriticalPathResponse empty() {
        return new CriticalPathResponse(null, 0, null, null, 0, List.of(), List.of());
    }
}
