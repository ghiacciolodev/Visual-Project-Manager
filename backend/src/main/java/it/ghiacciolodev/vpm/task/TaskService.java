package it.ghiacciolodev.vpm.task;

import it.ghiacciolodev.vpm.common.ProjectContext;
import it.ghiacciolodev.vpm.common.exception.ConflictException;
import it.ghiacciolodev.vpm.common.exception.NotFoundException;
import it.ghiacciolodev.vpm.task.dto.TaskRef;
import it.ghiacciolodev.vpm.task.dto.TaskRequest;
import it.ghiacciolodev.vpm.task.dto.TaskResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Service
@Transactional(readOnly = true)   // read-only by default; writes opt in below
public class TaskService {

    private final TaskRepository repository;
    private final DependencyGraphRepository graph;

    /**
     * Answers "which project are we working on?". Temporary in its current
     * form — see ProjectContext. Routing every lookup through one seam is what
     * keeps phase 5 to a single edit.
     */
    private final ProjectContext projects;

    public TaskService(TaskRepository repository,
                       DependencyGraphRepository graph,
                       ProjectContext projects) {
        // Constructor injection, not @Autowired on fields: it makes the
        // dependencies impossible to forget and the class trivial to test.
        this.repository = repository;
        this.graph = graph;
        this.projects = projects;
    }

    /* --- reads ---------------------------------------------------------- */

    public List<TaskResponse> findAll() {
        Long projectId = projects.currentProjectId();

        List<Task> tasks =
            repository.findByProjectIdAndDeletedAtIsNullOrderByStartDateAsc(projectId);

        // The whole dependency graph in one query, then joined in memory.
        // Asking per task would turn a 200-task board into 201 round trips.
        Map<Long, List<TaskRef>> predecessors = graph.findPredecessorsByProject(projectId);

        return tasks.stream()
            .map(task -> TaskResponse.from(
                task,
                predecessors.getOrDefault(task.getId(), List.of())))
            .toList();
    }

    public TaskResponse findById(Long id) {
        Task task = loadOrThrow(id);
        return TaskResponse.from(task, graph.findPredecessors(id));
    }

    /* --- writes --------------------------------------------------------- */

    @Transactional
    public TaskResponse create(TaskRequest request) {
        Task task = new Task();
        task.setProjectId(projects.currentProjectId());
        apply(request, task);

        Task saved = repository.save(task);
        // A brand new task has no predecessors, so no blocking check is needed
        // and the list is empty by construction.
        return TaskResponse.from(saved, List.of());
    }

    @Transactional
    public TaskResponse update(Long id, TaskRequest request) {
        Task task = loadOrThrow(id);

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
    public void delete(Long id) {
        Task task = loadOrThrow(id);
        graph.unlinkAll(id);
        task.setDeletedAt(Instant.now());
    }

    /* --- dependencies --------------------------------------------------- */

    /**
     * Makes `predecessorId` a prerequisite of `taskId`.
     *
     * Four things can go wrong, and each gets its own answer rather than a
     * generic refusal: the task or the predecessor does not exist (404), they
     * are the same task, the edge would close a cycle, or the successor is
     * already DONE while the new predecessor is not (409).
     */
    @Transactional
    public TaskResponse addDependency(Long taskId, Long predecessorId) {
        Task task = loadOrThrow(taskId);
        Task predecessor = loadOrThrow(predecessorId);

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
    public TaskResponse removeDependency(Long taskId, Long predecessorId) {
        Task task = loadOrThrow(taskId);

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

    private Task loadOrThrow(Long id) {
        return repository
            .findByIdAndProjectIdAndDeletedAtIsNull(id, projects.currentProjectId())
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
