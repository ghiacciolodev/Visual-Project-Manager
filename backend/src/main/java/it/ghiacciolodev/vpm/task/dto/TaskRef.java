package it.ghiacciolodev.vpm.task.dto;

import it.ghiacciolodev.vpm.task.TaskStatus;

/**
 * A task referred to from somewhere else in the payload — a predecessor, or a
 * blocker named in an error.
 *
 * Carries only what a reference needs: enough to render a name and decide
 * whether it is still blocking. Returning the full task here would nest the
 * whole graph inside every response.
 */
public record TaskRef(
    Long id,
    String title,
    TaskStatus status
) {
}
