package it.ghiacciolodev.vpm.task.dto;

import it.ghiacciolodev.vpm.task.Task;
import it.ghiacciolodev.vpm.task.TaskPriority;
import it.ghiacciolodev.vpm.task.TaskStatus;

import java.time.LocalDate;
import java.util.List;

/**
 * Output payload. Entities are never returned directly: doing so publishes
 * every future field by accident, and drags Hibernate's lazy proxies into
 * JSON serialisation.
 */
public record TaskResponse(
    Long id,
    String title,
    String description,
    TaskStatus status,
    TaskPriority priority,
    LocalDate startDate,
    LocalDate endDate,
    String color,

    /** Every predecessor, whatever its status. */
    List<TaskRef> dependsOn,

    /**
     * Predecessors that are not DONE yet.
     *
     * Derived server-side rather than left to the client. The rule that
     * defines "blocked" is enforced by the backend, so the backend is also
     * the one that gets to say when it applies — otherwise two
     * implementations of the same rule drift apart.
     */
    List<TaskRef> blockedBy
) {

    public static TaskResponse from(Task task, List<TaskRef> predecessors) {
        List<TaskRef> blockers = predecessors.stream()
            .filter(ref -> ref.status() != TaskStatus.DONE)
            .toList();

        return new TaskResponse(
            task.getId(),
            task.getTitle(),
            task.getDescription(),
            task.getStatus(),
            task.getPriority(),
            task.getStartDate(),
            task.getEndDate(),
            task.getColor(),
            predecessors,
            blockers
        );
    }
}
