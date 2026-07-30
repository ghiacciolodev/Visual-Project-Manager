package it.ghiacciolodev.vpm.task;

import it.ghiacciolodev.vpm.common.exception.ConflictException;
import it.ghiacciolodev.vpm.common.exception.NotFoundException;
import it.ghiacciolodev.vpm.task.dto.TaskRef;
import it.ghiacciolodev.vpm.task.dto.TaskRequest;
import it.ghiacciolodev.vpm.task.dto.TaskResponse;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Every method takes the project explicitly and is guarded by @PreAuthorize.
 *
 * The project used to be resolved from the caller's account, which made
 * authorisation impossible to get wrong and impossible to demonstrate: a check
 * that cannot fail is not a check. Now the id arrives from the URL, so
 * "am I allowed?" has an answer that can be no.
 *
 * The guards sit on the service rather than the controller — one layer closer
 * to the data, and still enforced if a second controller, a scheduled job or a
 * test calls in.
 */
@Service
@Transactional(readOnly = true)
public class TaskService {

    private final TaskRepository repository;
    private final DependencyGraphRepository graph;

    public TaskService(TaskRepository repository, DependencyGraphRepository graph) {
        this.repository = repository;
        this.graph = graph;
    }

    /* --- reads ---------------------------------------------------------- */

    @PreAuthorize("@access.canView(#projectId)")
    public List<TaskResponse> findAll(Long projectId) {
        List<Task> tasks =
            repository.findByProjectIdAndDeletedAtIsNullOrderByStartDateAsc(projectId);

        // The whole dependency graph in one query, then joined in memory.
        // Asking per task would turn a 200-task board into 201 round trips.
        Map<Long, List<TaskRef>> predecessors = graph.findPredecessorsByProject(projectId);

        return tasks.stream()
            .map(task -> TaskResponse.from(
                task, predecessors.getOrDefault(task.getId(), List.of())))
            .toList();
    }

    @PreAuthorize("@access.canView(#projectId)")
    public TaskResponse findById(Long projectId, Long id) {
        Task task = loadOrThrow(projectId, id);
        return TaskResponse.from(task, graph.findPredecessors(id));
    }

    /* --- writes --------------------------------------------------------- */

    @Transactional
    @PreAuthorize("@access.canEdit(#projectId)")
    public TaskResponse create(Long projectId, TaskRequest request) {
        Task task = new Task();
        task.setProjectId(projectId);
        apply(request, task);

        Task saved = repository.save(task);
        // A brand new task has no predecessors, so no blocking check is needed
        // and the list is empty by construction.
        return TaskResponse.from(saved, List.of());
    }

    @Transactional
    @PreAuthorize("@access.canEdit(#projectId)")
    public TaskResponse update(Long projectId, Long id, TaskRequest request) {
        Task task = loadOrThrow(projectId, id);

        // The rule lives here, not in the browser. The frontend disables the
        // control as a courtesy; this is what actually enforces it, including
        // against a direct API call.
        if (request.status() == TaskStatus.DONE) {
            assertNothingIsBlocking(id);
        }

        apply(request, task);
        // No explicit save(): the entity is managed inside the transaction and
        // Hibernate flushes the changes on commit.
        return TaskResponse.from(task, graph.findPredecessors(id));
    }

    @Transactional
    @PreAuthorize("@access.canEdit(#projectId)")
    public void delete(Long projectId, Long id) {
        Task task = loadOrThrow(projectId, id);
        graph.unlinkAll(id);
        task.setDeletedAt(Instant.now());
    }

    /* --- dependencies --------------------------------------------------- */

    @Transactional
    @PreAuthorize("@access.canEdit(#projectId)")
    public TaskResponse addDependency(Long projectId, Long taskId, Long predecessorId) {
        Task task = loadOrThrow(projectId, taskId);
        // Loaded through the same project filter, so an edge can never reach
        // across into somebody else's plan.
        Task predecessor = loadOrThrow(projectId, predecessorId);

        if (taskId.equals(predecessorId)) {
            throw new ConflictException("A task cannot depend on itself");
        }

        // Direction matters. The new edge runs predecessor → task, so it
        // closes a loop precisely when the predecessor is already reachable
        // *from* the task.
        if (graph.pathExists(taskId, predecessorId)) {
            throw new ConflictException(
                "That dependency would create a cycle: \"%s\" already depends on \"%s\", directly or through other tasks"
                    .formatted(predecessor.getTitle(), task.getTitle()),
                List.of(toRef(predecessor)));
        }

        // Guards the pair of states the DONE rule forbids. Without this check
        // the rule could be bypassed by finishing a task first and adding the
        // unfinished prerequisite afterwards.
        if (task.getStatus() == TaskStatus.DONE && predecessor.getStatus() != TaskStatus.DONE) {
            throw new ConflictException(
                "\"%s\" is already done, so it cannot depend on the unfinished task \"%s\""
                    .formatted(task.getTitle(), predecessor.getTitle()),
                List.of(toRef(predecessor)));
        }

        graph.link(predecessorId, taskId);
        return TaskResponse.from(task, graph.findPredecessors(taskId));
    }

    @Transactional
    @PreAuthorize("@access.canEdit(#projectId)")
    public TaskResponse removeDependency(Long projectId, Long taskId, Long predecessorId) {
        Task task = loadOrThrow(projectId, taskId);

        if (!graph.unlink(predecessorId, taskId)) {
            throw new NotFoundException(
                "Task %d does not depend on task %d".formatted(taskId, predecessorId));
        }

        return TaskResponse.from(task, graph.findPredecessors(taskId));
    }

    /* --- internals ------------------------------------------------------ */

    private void assertNothingIsBlocking(Long taskId) {
        List<TaskRef> blockers = graph.findPredecessors(taskId).stream()
            .filter(ref -> ref.status() != TaskStatus.DONE)
            .toList();

        if (!blockers.isEmpty()) {
            String names = blockers.stream().map(TaskRef::title).toList().toString();
            throw new ConflictException(
                "This task cannot be marked done until its prerequisites are finished: " + names,
                blockers);
        }
    }

    /**
     * Loads by id *and* project. The pairing is what prevents an IDOR: an id
     * guessed from another project simply does not resolve, and the caller
     * learns nothing about whether it exists elsewhere.
     */
    private Task loadOrThrow(Long projectId, Long id) {
        return repository
            .findByIdAndProjectIdAndDeletedAtIsNull(id, projectId)
            .orElseThrow(() -> new NotFoundException("Task " + id + " not found"));
    }

    private TaskRef toRef(Task task) {
        return new TaskRef(task.getId(), task.getTitle(), task.getStatus());
    }

    /**
     * Copies the mutable fields only. id, projectId and the timestamps are
     * deliberately not touched here — they are not the client's to set.
     */
    private void apply(TaskRequest request, Task task) {
        task.setTitle(request.title());
        task.setDescription(request.description());
        task.setStatus(request.status());
        task.setPriority(request.priority());
        task.setStartDate(request.startDate());
        task.setEndDate(request.endDate());
        task.setColor(request.color());
    }
}
