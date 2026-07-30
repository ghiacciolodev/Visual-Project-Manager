package it.ghiacciolodev.vpm.task;

import it.ghiacciolodev.vpm.task.dto.DependencyRequest;
import it.ghiacciolodev.vpm.task.dto.TaskRequest;
import it.ghiacciolodev.vpm.task.dto.TaskResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;
import java.util.List;

/**
 * Tasks are a sub-resource of their project. The URL carries the id that the
 * authorisation check reads, so the shape of the API and the shape of the
 * permission model agree.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectId}/tasks")
public class TaskController {

    private final TaskService service;

    public TaskController(TaskService service) {
        this.service = service;
    }

    @GetMapping
    public List<TaskResponse> list(@PathVariable Long projectId) {
        return service.findAll(projectId);
    }

    @GetMapping("/{id}")
    public TaskResponse get(@PathVariable Long projectId, @PathVariable Long id) {
        return service.findById(projectId, id);
    }

    // @Valid is the word that makes it all work: without it the annotations on
    // the DTO are decorative and nobody notices until bad data arrives.
    @PostMapping
    public ResponseEntity<TaskResponse> create(@PathVariable Long projectId,
                                               @Valid @RequestBody TaskRequest request) {
        TaskResponse created = service.create(projectId, request);

        // 201 with a Location header, not a bare 200. It is the correct
        // response for a creation and it costs one line.
        URI location = ServletUriComponentsBuilder
            .fromCurrentRequest()
            .path("/{id}")
            .buildAndExpand(created.id())
            .toUri();

        return ResponseEntity.created(location).body(created);
    }

    @PutMapping("/{id}")
    public TaskResponse update(@PathVariable Long projectId,
                               @PathVariable Long id,
                               @Valid @RequestBody TaskRequest request) {
        return service.update(projectId, id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long projectId, @PathVariable Long id) {
        service.delete(projectId, id);
        return ResponseEntity.noContent().build();
    }

    /* --- dependencies --------------------------------------------------- */

    @PostMapping("/{id}/dependencies")
    public TaskResponse addDependency(@PathVariable Long projectId,
                                      @PathVariable Long id,
                                      @Valid @RequestBody DependencyRequest request) {
        return service.addDependency(projectId, id, request.predecessorId());
    }

    @DeleteMapping("/{id}/dependencies/{predecessorId}")
    public TaskResponse removeDependency(@PathVariable Long projectId,
                                         @PathVariable Long id,
                                         @PathVariable Long predecessorId) {
        return service.removeDependency(projectId, id, predecessorId);
    }
}
