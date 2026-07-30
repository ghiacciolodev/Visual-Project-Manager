package it.ghiacciolodev.vpm.project.dto;

import it.ghiacciolodev.vpm.project.ProjectRole;
import jakarta.validation.constraints.NotNull;

public record ChangeRoleRequest(

    @NotNull(message = "A role is required")
    ProjectRole role
) {
}
