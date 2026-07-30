package it.ghiacciolodev.vpm.task.dto;

import jakarta.validation.constraints.NotNull;

/** Body of POST /tasks/{id}/dependencies. */
public record DependencyRequest(

    @NotNull(message = "A predecessor id is required")
    Long predecessorId

) {
}
