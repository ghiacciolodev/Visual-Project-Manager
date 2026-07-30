package it.ghiacciolodev.vpm.project.dto;

import it.ghiacciolodev.vpm.project.ProjectRole;

/**
 * A project as seen by one member — hence `myRole`, which is a property of the
 * pairing rather than of the project. The client uses it to decide which
 * controls to show; the server uses its own copy to decide what to allow.
 */
public record ProjectResponse(
    Long id,
    String name,
    String description,
    ProjectRole myRole
) {
}
