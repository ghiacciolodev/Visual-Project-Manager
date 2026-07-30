package it.ghiacciolodev.vpm.common;

import it.ghiacciolodev.vpm.project.Project;
import it.ghiacciolodev.vpm.project.ProjectRepository;
import it.ghiacciolodev.vpm.security.CurrentUser;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Answers "which project are we working on?".
 *
 * This class was a hard-coded 1 through phases 1 to 4. Everything else was
 * written against it, so switching to real users came down to this file plus
 * the membership checks — the queries were already scoped by project, which is
 * why the schema was built multi-project on day one.
 *
 * Still an interim shape: it returns the user's first project because the
 * interface has no project switcher yet. When it grows one, the id arrives
 * with the request and this class goes away.
 */
@Component
public class ProjectContext {

    private final CurrentUser currentUser;
    private final ProjectRepository projects;

    public ProjectContext(CurrentUser currentUser, ProjectRepository projects) {
        this.currentUser = currentUser;
        this.projects = projects;
    }

    public Long currentProjectId() {
        // Through the injected bean, never this.something(): CurrentUser.require()
        // runs in its own transaction, and an internal call would bypass the
        // proxy that starts it — leaving first-time provisioning to be
        // discarded by the read-only transaction that called us.
        Long userId = currentUser.require().getId();

        List<Project> memberships = projects.findAllForUser(userId);

        if (memberships.isEmpty()) {
            // CurrentUser provisions a project on first sight, so an empty
            // list means the row was removed out from under us rather than
            // that the user is new.
            throw new IllegalStateException("User " + userId + " belongs to no project");
        }

        return memberships.getFirst().getId();
    }
}
