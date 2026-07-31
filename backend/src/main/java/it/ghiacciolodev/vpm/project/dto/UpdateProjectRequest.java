package it.ghiacciolodev.vpm.project.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * The mutable fields of a project, all of them.
 *
 * Separate from CreateProjectRequest despite carrying the same pair today.
 * Creation and renaming diverge the moment either grows a field the other has
 * no business accepting — a template to copy from, an owner to hand over to —
 * and sharing one record until then would make that the awkward change rather
 * than the obvious one.
 */
public record UpdateProjectRequest(

    @NotBlank(message = "Name is required")
    @Size(max = 120, message = "Name must be at most 120 characters")
    String name,

    @Size(max = 2000, message = "Description must be at most 2000 characters")
    String description
) {
}
