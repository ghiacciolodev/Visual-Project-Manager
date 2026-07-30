package it.ghiacciolodev.vpm.project;

import it.ghiacciolodev.vpm.common.ProjectContext;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Reads the project the current session is working on.
 *
 * A single endpoint for now, because the interface has no project switcher:
 * the answer is whichever project ProjectContext resolves to. When switching
 * arrives this becomes a list plus a selection, and the views already ask the
 * server for the name rather than assuming it.
 */
@RestController
@RequestMapping("/api/v1/project")
public class ProjectController {

    private final ProjectContext context;
    private final ProjectRepository projects;

    public ProjectController(ProjectContext context, ProjectRepository projects) {
        this.context = context;
        this.projects = projects;
    }

    public record ProjectResponse(Long id, String name, String description) {
    }

    @GetMapping
    public ProjectResponse current() {
        Long id = context.currentProjectId();

        return projects.findById(id)
            .map(p -> new ProjectResponse(p.getId(), p.getName(), p.getDescription()))
            // ProjectContext resolved this id a line ago, so a miss means
            // the row vanished mid-request, not that the user asked for
            // something that does not exist.
            .orElseThrow(() -> new IllegalStateException("Project " + id + " disappeared"));
    }
}
