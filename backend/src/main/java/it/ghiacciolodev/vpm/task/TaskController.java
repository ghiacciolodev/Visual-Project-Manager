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
 * Versioned base path from day one. Adding /v2 later is cheap; retrofitting a
 * version segment onto URLs a client already depends on is not.
 */
@RestController
@RequestMapping("/api/v1/tasks")
public class TaskController {

    private final TaskService service;

    public TaskController(TaskService service) {
        this.service = service;
    }

    @GetMapping
    public List<TaskResponse> list() {
        return service.findAll();
    }

    @GetMapping("/{id}")
    public TaskResponse get(@PathVariable Long id) {
        return service.findById(id);
    }

    // @Valid is the word that makes it all work: without it the annotations on
    // the DTO are decorative and nobody notices until bad data arrives.
    @PostMapping
    public ResponseEntity<TaskResponse> create(@Valid @RequestBody TaskRequest request) {
        TaskResponse created = service.create(request);

        // 201 with a Location header, not a bare 200. It is the correct
        // response for a creation and it costs one line: the client learns
        // the new resource's URL without having to construct it.
        URI location = ServletUriComponentsBuilder
            .fromCurrentRequest()
            .path("/{id}")
            .buildAndExpand(created.id())
            .toUri();

        return ResponseEntity.created(location).body(created);
    }

    @PutMapping("/{id}")
    public TaskResponse update(@PathVariable Long id,
                               @Valid @RequestBody TaskRequest request) {
        return service.update(id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }

    /* --- dependencies --------------------------------------------------- */

    /**
     * Dependencies are a sub-resource of the task they belong to, not a
     * top-level collection: an edge has no meaning without its successor, and
     * the URL should say so.
     *
     * Both methods return the updated task rather than 204, so the client can
     * refresh one row without a second request.
     */
    @PostMapping("/{id}/dependencies")
    public TaskResponse addDependency(@PathVariable Long id,
                                      @Valid @RequestBody DependencyRequest request) {
        return service.addDependency(id, request.predecessorId());
    }

    @DeleteMapping("/{id}/dependencies/{predecessorId}")
    public TaskResponse removeDependency(@PathVariable Long id,
                                         @PathVariable Long predecessorId) {
        return service.removeDependency(id, predecessorId);
    }
}
