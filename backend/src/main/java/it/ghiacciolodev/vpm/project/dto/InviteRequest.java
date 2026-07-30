package it.ghiacciolodev.vpm.project.dto;

import it.ghiacciolodev.vpm.project.ProjectRole;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record InviteRequest(

    @NotBlank(message = "An email address is required")
    @Email(message = "That does not look like an email address")
    String email,

    @NotNull(message = "A role is required")
    ProjectRole role
) {
}
