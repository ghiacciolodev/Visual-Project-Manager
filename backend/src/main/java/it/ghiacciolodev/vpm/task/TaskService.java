package it.ghiacciolodev.vpm.task;

import it.ghiacciolodev.vpm.audit.AuditAction;
import it.ghiacciolodev.vpm.audit.AuditEntity;
import it.ghiacciolodev.vpm.audit.AuditService;
import it.ghiacciolodev.vpm.common.exception.ConflictException;
import it.ghiacciolodev.vpm.common.exception.NotFoundException;
import it.ghiacciolodev.vpm.common.limits.LimitProperties;
import it.ghiacciolodev.vpm.project.ProjectMemberRepository;
import it.ghiacciolodev.vpm.task.dto.AssigneeRef;
import it.ghiacciolodev.vpm.task.dto.TaskRef;
import it.ghiacciolodev.vpm.task.dto.TaskRequest;
import it.ghiacciolodev.vpm.task.dto.TaskResponse;
import it.ghiacciolodev.vpm.user.User;
import it.ghiacciolodev.vpm.user.UserRepository;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

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
    private final UserRepository users;
    private final ProjectMemberRepository members;
    private final AuditService audit;
    private final LimitProperties limits;

    public TaskService(TaskRepository repository,
                       DependencyGraphRepository graph,
                       UserRepository users,
                       ProjectMemberRepository members,
                       AuditService audit,
                       LimitProperties limits) {
        this.repository = repository;
        this.graph = graph;
        this.users = users;
        this.members = members;
        this.audit = audit;
        this.limits = limits;
    }

    /* --- reads ---------------------------------------------------------- */

    @PreAuthorize("@access.canView(#projectId)")
    public List<TaskResponse> findAll(Long projectId) {
        List<Task> tasks =
            repository.findByProjectIdAndDeletedAtIsNullOrderByStartDateAsc(projectId);

        // The whole dependency graph in one query, then joined in memory.
        // Asking per task would turn a 200-task board into 201 round trips.
        Map<Long, List<TaskRef>> predecessors = graph.findPredecessorsByProject(projectId);

        // Assignees in one query too, for the same reason. Several tasks
        // usually share an assignee, so the distinct ids are far fewer than
        // the rows.
        Map<Long, AssigneeRef> assignees = assigneesOf(tasks);

        return tasks.stream()
            .map(task -> TaskResponse.from(
                task,
                predecessors.getOrDefault(task.getId(), List.of()),
                // The null check is not defensive padding. Map.of() rejects a
                // null key on get() with a NullPointerException rather than
                // answering null, so a project where nobody has been assigned
                // anything — every new project — threw on its first task list.
                task.getAssigneeId() == null ? null : assignees.get(task.getAssigneeId())))
            .toList();
    }

    @PreAuthorize("@access.canView(#projectId)")
    public TaskResponse findById(Long projectId, Long id) {
        Task task = loadOrThrow(projectId, id);
        return TaskResponse.from(task, graph.findPredecessors(id), assigneeOf(task));
    }

    /* --- writes --------------------------------------------------------- */

    @Transactional
    @PreAuthorize("@access.canEdit(#projectId)")
    public TaskResponse create(Long projectId, TaskRequest request) {
        // Checked on create only. An update cannot grow the plan, and refusing
        // one because the project is already at its ceiling would trap somebody
        // at exactly the moment they are trying to tidy up.
        if (repository.countByProjectIdAndDeletedAtIsNull(projectId) >= limits.tasksPerProject()) {
            throw new ConflictException(
                "This project has reached its limit of %d tasks. Delete something, or split the plan."
                    .formatted(limits.tasksPerProject()));
        }

        Task task = new Task();
        task.setProjectId(projectId);
        apply(request, task);

        Task saved = repository.save(task);

        audit.record(projectId, AuditEntity.TASK, saved.getId(), AuditAction.CREATE,
            "Added \"%s\", %s to %s".formatted(
                saved.getTitle(), saved.getStartDate(), saved.getEndDate()));

        // A brand new task has no predecessors, so no blocking check is needed
        // and the list is empty by construction.
        return TaskResponse.from(saved, List.of(), assigneeOf(saved));
    }

    @Transactional
    @PreAuthorize("@access.canEdit(#projectId)")
    public TaskResponse update(Long projectId, Long id, TaskRequest request) {
        Task task = loadOrThrow(projectId, id);

        assertNobodyGotHereFirst(task, request);

        // The rule lives here, not in the browser. The frontend disables the
        // control as a courtesy; this is what actually enforces it, including
        // against a direct API call.
        if (request.status() == TaskStatus.DONE) {
            assertNothingIsBlocking(id);
        }

        // Captured before apply(), which is the whole reason this is written
        // here rather than by a listener: after the change there is nothing
        // left to compare against.
        String changed = describeChange(task, request);

        apply(request, task);

        if (!changed.isEmpty()) {
            audit.record(projectId, AuditEntity.TASK, id, AuditAction.UPDATE,
                "\"%s\": %s".formatted(task.getTitle(), changed));
        }

        // No explicit save(): the entity is managed inside the transaction and
        // Hibernate flushes the changes on commit.
        return TaskResponse.from(task, graph.findPredecessors(id), assigneeOf(task));
    }

    @Transactional
    @PreAuthorize("@access.canEdit(#projectId)")
    public void delete(Long projectId, Long id) {
        Task task = loadOrThrow(projectId, id);
        graph.unlinkAll(id);
        task.setDeletedAt(Instant.now());

        audit.record(projectId, AuditEntity.TASK, id, AuditAction.DELETE,
            "Deleted \"%s\"".formatted(task.getTitle()));
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

        audit.record(projectId, AuditEntity.DEPENDENCY, taskId, AuditAction.CREATE,
            "\"%s\" now waits for \"%s\"".formatted(task.getTitle(), predecessor.getTitle()));

        return TaskResponse.from(task, graph.findPredecessors(taskId), assigneeOf(task));
    }

    @Transactional
    @PreAuthorize("@access.canEdit(#projectId)")
    public TaskResponse removeDependency(Long projectId, Long taskId, Long predecessorId) {
        Task task = loadOrThrow(projectId, taskId);

        if (!graph.unlink(predecessorId, taskId)) {
            throw new NotFoundException(
                "Task %d does not depend on task %d".formatted(taskId, predecessorId));
        }

        audit.record(projectId, AuditEntity.DEPENDENCY, taskId, AuditAction.DELETE,
            "\"%s\" no longer waits for task %d".formatted(task.getTitle(), predecessorId));

        return TaskResponse.from(task, graph.findPredecessors(taskId), assigneeOf(task));
    }

    /* --- internals ------------------------------------------------------ */

    /**
     * Refuses a write built from a version of the task somebody has replaced.
     *
     * Two people editing one task ended in last-write-wins, silently: whoever
     * saved second overwrote the other with a form filled in before their
     * change existed, and nothing said so. The person whose work disappeared
     * had no way to find out — the schedule only ever shows the current state.
     *
     * Compared by equality rather than by "is older", deliberately. A clock
     * that steps backwards, or two application instances a few milliseconds
     * apart, would make an ordering test quietly accept a stale write. The
     * question here is not "is this newer" but "is this the same task I read".
     */
    private void assertNobodyGotHereFirst(Task task, TaskRequest request) {
        if (request.expectedUpdatedAt() == null) {
            return;
        }
        if (!request.expectedUpdatedAt().equals(task.getUpdatedAt())) {
            throw new ConflictException(
                "Somebody else changed this task while you were editing it. "
                    + "Reload to see their version before saving yours.");
        }
    }

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
        task.setAssigneeId(assignableOrThrow(task.getProjectId(), request.assigneeId()));
    }

    /* --- history -------------------------------------------------------- */

    /**
     * What this update actually changes, in words, compared against the task
     * as it stands.
     *
     * Must be called before apply(). This is the argument for writing history
     * from the code that makes the change rather than from a listener or an
     * aspect: both of those see the task only after it has been mutated, when
     * the previous value is gone and the best they can honestly report is
     * that something was updated.
     *
     * Returns empty when nothing moved. Saving a form without touching it is
     * a common thing to do and does not belong in a history.
     */
    private String describeChange(Task task, TaskRequest request) {
        List<String> changes = new java.util.ArrayList<>();

        if (!task.getTitle().equals(request.title())) {
            changes.add("renamed to \"%s\"".formatted(request.title()));
        }
        if (task.getStatus() != request.status()) {
            changes.add("%s → %s".formatted(task.getStatus(), request.status()));
        }
        if (task.getPriority() != request.priority()) {
            changes.add("priority %s → %s".formatted(task.getPriority(), request.priority()));
        }
        if (!task.getStartDate().equals(request.startDate())
            || !task.getEndDate().equals(request.endDate())) {
            changes.add("moved to %s – %s".formatted(request.startDate(), request.endDate()));
        }
        if (!Objects.equals(task.getAssigneeId(), request.assigneeId())) {
            changes.add(request.assigneeId() == null
                ? "unassigned"
                : "assigned to %s".formatted(nameOf(request.assigneeId())));
        }

        return String.join(", ", changes);
    }

    private String nameOf(Long userId) {
        return users.findById(userId).map(User::getDisplayName).orElse("someone");
    }

    /* --- assignees ------------------------------------------------------ */

    /**
     * Checks that the person being assigned is in this project.
     *
     * Without this, assignee_id accepts any number and the column becomes a
     * way to attach a stranger's account to your plan — their name would then
     * be read back out of the task list by everybody in it. The schema cannot
     * express the rule: its foreign key says "some user", and what is needed
     * is "a user who is a member of this project".
     *
     * 404 rather than 400, matching how every other unreachable id is
     * answered here. To somebody outside the project the account is not a
     * value they were entitled to learn, and a distinct error for "exists but
     * not here" would confirm it does exist.
     */
    private Long assignableOrThrow(Long projectId, Long assigneeId) {
        if (assigneeId == null) {
            return null;
        }
        if (!members.existsByProjectIdAndUserId(projectId, assigneeId)) {
            throw new NotFoundException("That person is not in this project");
        }
        return assigneeId;
    }

    private AssigneeRef assigneeOf(Task task) {
        if (task.getAssigneeId() == null) {
            return null;
        }
        return users.findById(task.getAssigneeId()).map(AssigneeRef::of).orElse(null);
    }

    /**
     * Every task's assignee in one query.
     *
     * Keyed by user id rather than task id, because tasks share assignees:
     * a plan with forty rows and four people costs four rows here, not forty.
     */
    private Map<Long, AssigneeRef> assigneesOf(List<Task> tasks) {
        List<Long> ids = tasks.stream()
            .map(Task::getAssigneeId)
            .filter(Objects::nonNull)
            .distinct()
            .toList();

        if (ids.isEmpty()) {
            return Map.of();
        }

        return users.findAllById(ids).stream()
            .collect(Collectors.toMap(User::getId, AssigneeRef::of));
    }
}
