package it.ghiacciolodev.vpm.task;

import it.ghiacciolodev.vpm.task.dto.DependencyRequest;
import it.ghiacciolodev.vpm.task.dto.TaskRequest;
import it.ghiacciolodev.vpm.task.dto.TaskResponse;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
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

    /** Used when a caller asks for pages without saying how big. */
    private static final int DEFAULT_PAGE_SIZE = 50;

    /**
     * The largest page anyone may ask for.
     *
     * Without a ceiling, size=1000000 is a way to ask for everything while
     * looking like a paginated request — which is to say, no ceiling at all.
     */
    private static final int MAX_PAGE_SIZE = 200;

    private final TaskService service;

    public TaskController(TaskService service) {
        this.service = service;
    }

    /**
     * Every task in the project, or one page of them.
     *
     * Paging is opt-in and reported in headers rather than by wrapping the
     * body. Two reasons.
     *
     * The response shape never changes, so a caller that does not ask for
     * pages cannot be broken by its arrival — and this application is such a
     * caller, deliberately. The Gantt chart measures its window from the
     * earliest start to the latest end across the whole plan, and the
     * dashboard's filters are computed over the same list; hand either of them
     * a page and the chart draws the wrong scale while the filters silently
     * narrow one fiftieth of the data.
     *
     * And the alternative — an envelope — would put the count in the same
     * place as the data for every caller, including the ones who only ever
     * want all of it.
     *
     * The dashboard slowing down at a few hundred tasks is a rendering cost
     * rather than a transfer one: several hundred rows of JSON is nothing, and
     * several hundred live components is not. Virtualising the list is the fix
     * for that, and it does not need this.
     */
    @GetMapping
    public ResponseEntity<List<TaskResponse>> list(
        @PathVariable Long projectId,
        @RequestParam(required = false) Integer page,
        @RequestParam(required = false) Integer size) {

        if (page == null && size == null) {
            return ResponseEntity.ok(service.findAll(projectId));
        }

        int pageNumber = Math.max(0, page == null ? 0 : page);
        int pageSize = Math.clamp(size == null ? DEFAULT_PAGE_SIZE : size, 1, MAX_PAGE_SIZE);

        // Paged in the query rather than in memory. Reading the whole project
        // and calling subList produces correct headers over work that has not
        // been reduced at all: ten rows out of two thousand, with two thousand
        // fetched to serve them.
        Page<TaskResponse> result = service.findPage(projectId,
            PageRequest.of(pageNumber, pageSize, Sort.by("startDate").and(Sort.by("id"))));

        return ResponseEntity.ok()
            .header("X-Total-Count", String.valueOf(result.getTotalElements()))
            .header("X-Page", String.valueOf(pageNumber))
            .header("X-Page-Size", String.valueOf(pageSize))
            .body(result.getContent());
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
