package it.ghiacciolodev.vpm.schedule;

import it.ghiacciolodev.vpm.schedule.dto.CriticalPathResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Analysis lives under its own path rather than hanging off /tasks: it is a
 * derived view of the whole project, not a property of any one task.
 */
@RestController
@RequestMapping("/api/v1/schedule")
public class ScheduleController {

    private final CriticalPathService service;

    public ScheduleController(CriticalPathService service) {
        this.service = service;
    }

    @GetMapping("/critical-path")
    public CriticalPathResponse criticalPath() {
        return service.analyse();
    }
}
