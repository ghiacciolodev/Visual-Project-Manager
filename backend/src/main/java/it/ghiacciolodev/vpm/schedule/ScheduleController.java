package it.ghiacciolodev.vpm.schedule;

import it.ghiacciolodev.vpm.schedule.dto.CriticalPathResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Analysis is a derived view of one project, so it hangs off that project
 * rather than living at the root.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectId}/schedule")
public class ScheduleController {

    private final CriticalPathService service;

    public ScheduleController(CriticalPathService service) {
        this.service = service;
    }

    @GetMapping("/critical-path")
    public CriticalPathResponse criticalPath(@PathVariable Long projectId) {
        return service.analyse(projectId);
    }
}
