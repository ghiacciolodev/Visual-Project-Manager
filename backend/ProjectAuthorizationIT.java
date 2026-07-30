package it.ghiacciolodev.vpm.project;

import it.ghiacciolodev.vpm.common.exception.NotFoundException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The tests that make the authorisation model more than a claim.
 *
 * Each one asserts a refusal rather than a success: a permission system is
 * only worth anything if it says no, and the failures are what nobody notices
 * breaking.
 */
@SpringBootTest
@Testcontainers
@ActiveProfiles("dev")
class ProjectAuthorizationIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired ProjectService projects;
    @Autowired it.ghiacciolodev.vpm.task.TaskService tasks;

    @Test
    void aStrangerGetsNotFoundRatherThanForbidden() {
        signInAs("ada", "ada@example.com");
        Long adaProject = projects.findMine().getFirst().id();

        signInAs("grace", "grace@example.com");

        // Not AccessDeniedException: a 403 would confirm the project exists,
        // turning the id into an oracle for enumerating other people's work.
        assertThatThrownBy(() -> tasks.findAll(adaProject))
            .isInstanceOf(NotFoundException.class);
    }

    @Test
    void aViewerMayReadButNotWrite() {
        signInAs("ada", "ada@example.com");
        Long project = projects.findMine().getFirst().id();
        projects.invite(project, new it.ghiacciolodev.vpm.project.dto.InviteRequest(
            "grace@example.com", ProjectRole.VIEWER));

        signInAs("grace", "grace@example.com");

        assertThat(tasks.findAll(project)).isNotEmpty();

        assertThatThrownBy(() -> tasks.delete(project, tasks.findAll(project).getFirst().id()))
            .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void anEditorMayNotChangeWhoIsInTheProject() {
        signInAs("ada", "ada@example.com");
        Long project = projects.findMine().getFirst().id();
        projects.invite(project, new it.ghiacciolodev.vpm.project.dto.InviteRequest(
            "grace@example.com", ProjectRole.EDITOR));

        signInAs("grace", "grace@example.com");

        // Editing the plan and editing the membership are different powers.
        assertThatThrownBy(() -> projects.listMembers(project)).doesNotThrowAnyException();
        assertThatThrownBy(() -> projects.invite(project,
            new it.ghiacciolodev.vpm.project.dto.InviteRequest("x@example.com", ProjectRole.VIEWER)))
            .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void theLastOwnerCannotStepDown() {
        signInAs("ada", "ada@example.com");
        Long project = projects.findMine().getFirst().id();
        Long me = projects.listMembers(project).getFirst().userId();

        // A project with no owner can never be administered again — cheaper to
        // refuse the step than to write the recovery path.
        assertThatThrownBy(() -> projects.changeRole(project, me,
            new it.ghiacciolodev.vpm.project.dto.ChangeRoleRequest(ProjectRole.VIEWER)))
            .hasMessageContaining("only owner");
    }

    /**
     * Installs a JWT in the security context by hand. Faster and clearer than
     * standing up Keycloak for a test: what is under test is the authorisation
     * that follows authentication, not the signature check itself.
     */
    private void signInAs(String username, String email) {
        Jwt jwt = Jwt.withTokenValue("test-token")
            .header("alg", "none")
            .subject("sub-" + username)
            .claim("email", email)
            .claim("name", username)
            .issuedAt(Instant.now())
            .expiresAt(Instant.now().plusSeconds(300))
            .build();

        SecurityContextHolder.getContext().setAuthentication(
            new JwtAuthenticationToken(jwt, List.of(), jwt.getSubject()));
    }
}
