package it.ghiacciolodev.vpm.task.dto;

import it.ghiacciolodev.vpm.task.Task;
import it.ghiacciolodev.vpm.task.TaskPriority;
import it.ghiacciolodev.vpm.task.TaskStatus;

import java.time.LocalDate;

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
    String color
) {
    public static TaskResponse from(Task task) {
        return new TaskResponse(
            task.getId(),
            task.getTitle(),
            task.getDescription(),
            task.getStatus(),
            task.getPriority(),
            task.getStartDate(),
            task.getEndDate(),
            task.getColor()
        );
    }
}
