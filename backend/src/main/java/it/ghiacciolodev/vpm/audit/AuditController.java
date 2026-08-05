package it.ghiacciolodev.vpm.audit;

import it.ghiacciolodev.vpm.audit.dto.AuditEntryResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Read-only, by design and by the absence of anything else.
 *
 * There is no endpoint to edit or delete an entry, and no service method
 * behind one. A history somebody can tidy up is not a history.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectId}/audit")
public class AuditController {

    private final AuditService service;

    public AuditController(AuditService service) {
        this.service = service;
    }

    @GetMapping
    public List<AuditEntryResponse> list(@PathVariable Long projectId) {
        return service.findFor(projectId);
    }
}
