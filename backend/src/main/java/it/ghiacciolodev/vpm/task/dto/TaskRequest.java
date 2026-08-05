package it.ghiacciolodev.vpm.task.dto;

import it.ghiacciolodev.vpm.common.validation.DateRange;
import it.ghiacciolodev.vpm.common.validation.ValidDateRange;
import it.ghiacciolodev.vpm.task.TaskPriority;
import it.ghiacciolodev.vpm.task.TaskStatus;
import jakarta.validation.constraints.*;

import java.time.Instant;
import java.time.LocalDate;

/**
 * Input payload for both POST and PUT.
 *
 * One record for both because the two payloads are genuinely identical today.
 * Splitting them now would be duplication maintained by hand; split them the
 * day they actually diverge.
 *
 * Note what is absent: id, projectId, timestamps. A client must never be able
 * to set those — accepting them is how mass-assignment bugs happen.
 */
@ValidDateRange
public record TaskRequest(

    @NotBlank(message = "Title is required")
    @Size(max = 120, message = "Title must be at most 120 characters")
    String title,

    @Size(max = 2000, message = "Description must be at most 2000 characters")
    String description,

    @NotNull(message = "Status is required")
    TaskStatus status,

    @NotNull(message = "Priority is required")
    TaskPriority priority,

    @NotNull(message = "Start date is required")
    LocalDate startDate,

    @NotNull(message = "End date is required")
    LocalDate endDate,

    // Mirrors the CHECK constraint in the schema. Validating here turns a
    // database error into a readable 400, and keeps unvalidated input out
    // of the inline styles the Gantt will build from this value.
    @NotBlank(message = "Color is required")
    @Pattern(regexp = "^#[0-9A-Fa-f]{6}$",
        message = "Color must be a 6-digit hex value, e.g. #3B82F6")
    String color,

    /**
     * Who is doing this, or null for nobody.
     *
     * Deliberately unconstrained by an annotation: "is a member of this
     * project" is not something a validator can know, and the check belongs
     * next to the data anyway. TaskService refuses an id that is not in the
     * project, which is what stops a task being assigned to an arbitrary user
     * id guessed from outside.
     */
    Long assigneeId,

    /**
     * The updatedAt this caller last saw, for an optimistic concurrency check.
     *
     * Two people editing one task used to end in last-write-wins, silently:
     * whoever pressed save second replaced the other's work with a form filled
     * in before it existed, and nothing anywhere said so. Sending back the
     * timestamp the form was built from lets the server notice.
     *
     * Optional, and that is a real weakness rather than a convenience. A
     * client that omits it gets the old behaviour with no warning. It is
     * optional because requiring it would break every existing caller at once
     * and because there are legitimate unconditional writes — but a client
     * that means to be safe must send it, and this application always does.
     *
     * Not If-Unmodified-Since, which would be the obvious HTTP answer: that
     * header carries an HTTP-date, whole seconds only, and two edits inside
     * the same second are exactly the case being defended against.
     */
    Instant expectedUpdatedAt

) implements DateRange {
}
