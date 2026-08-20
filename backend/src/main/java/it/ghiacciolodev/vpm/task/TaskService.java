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
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
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
 * Explicitly, and not resolved from the caller's account. A project derived
 * from whoever is asking makes authorisation impossible to get wrong and
 * impossible to demonstrate, and a check that cannot fail is not a check.
 * The id arrives from the URL, so "am I allowed?" has an answer that can be no.
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

    /**
     * One page of a project's tasks.
     *
     * Separate from findAll rather than a parameter on it, because the two
     * genuinely differ in what they fetch: the whole plan wants the dependency
     * graph in one query, and a page wants the edges of ten rows. Sharing a
     * method would mean the page paying the project's cost, which is what the
     * previous version did by reading everything and calling subList.
     */
    @PreAuthorize("@access.canView(#projectId)")
    public Page<TaskResponse> findPage(Long projectId, Pageable pageable) {
        Page<Task> page = repository.findByProjectIdAndDeletedAtIsNull(projectId, pageable);

        Map<Long, List<TaskRef>> predecessors =
            graph.findPredecessorsByTaskIds(page.map(Task::getId).toList());

        Map<Long, AssigneeRef> assignees = assigneesOf(page.getContent());

        return page.map(task -> TaskResponse.from(
            task,
            predecessors.getOrDefault(task.getId(), List.of()),
            task.getAssigneeId() == null ? null : assignees.get(task.getAssigneeId())));
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

        // saveAndFlush, and this is the line the whole version column exists
        // for. Both updatedAt and version are written by Hibernate during a
        // flush, so a response assembled before one reports the values from
        // before this write. Nothing else here forces a flush reliably:
        // findPredecessors goes through JdbcTemplate, and the audit insert
        // writes only its own row.
        Task saved = repository.saveAndFlush(task);

        return TaskResponse.from(saved, graph.findPredecessors(id), assigneeOf(saved));
    }

    /**
     * Marks a task deleted, and cuts its edges for real.
     *
     * Worth being straight about, because the schema comment in V1 is not: it
     * says soft deletion "keeps dependency references intact", and this method
     * physically removes every one of them. Both halves are deliberate and
     * they do not add up to a restore.
     *
     * The edges have to go. A soft-deleted row still exists, so ON DELETE
     * CASCADE never fires for it, and an edge left behind goes on blocking a
     * successor on behalf of a task nobody can see or finish.
     *
     * What the surviving row is actually for is reference, not recovery: the
     * audit log names tasks, and a foreign key elsewhere still resolves. There
     * is no restore endpoint and undeleting one would not bring its
     * prerequisites back. SECURITY.md lists the retention question this
     * leaves open.
     */
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
        // First, and before anything is read. What follows is check-then-act:
        // ask whether this edge closes a cycle, then insert it. Two requests
        // adding opposite edges at once would both be told no cycle exists,
        // because neither has written yet.
        graph.lockProject(projectId);

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

        // Loaded for its title alone, and worth the query. Without it the
        // entry reads "no longer waits for task 34", which nobody can act on
        // without going to look up 34 — in a log whose only job is to be
        // readable later.
        String predecessor = repository
            .findByIdAndProjectIdAndDeletedAtIsNull(predecessorId, projectId)
            .map(Task::getTitle)
            .orElse("a task that has since been deleted");

        if (!graph.unlink(predecessorId, taskId)) {
            throw new NotFoundException(
                "Task %d does not depend on task %d".formatted(taskId, predecessorId));
        }

        audit.record(projectId, AuditEntity.DEPENDENCY, taskId, AuditAction.DELETE,
            "\"%s\" no longer waits for \"%s\"".formatted(task.getTitle(), predecessor));

        return TaskResponse.from(task, graph.findPredecessors(taskId), assigneeOf(task));
    }

    /* --- internals ------------------------------------------------------ */

    /**
     * Refuses a write built from a version of the task somebody has replaced.
     *
     * Without it, two people editing one task end in last-write-wins,
     * silently: whoever saves second overwrites the other with a form filled
     * in before their change existed, and nothing says so. The person whose
     * work disappears has no way to find out, because the schedule only ever
     * shows the current state.
     *
     * The version is required rather than optional. Optional would make the
     * guarantee a convention, which any client could opt out of by omitting
     * the field, without being told what it had given up.
     *
     * This check is not the only line of defence, and it is not the strongest
     * one. @Version puts the same number in the UPDATE's WHERE clause, so a
     * stale write fails at the database whatever this method does. What the
     * check adds is a sentence the reader can act on, where Hibernate's own
     * failure is a stack trace about an optimistic lock.
     */
    private void assertNobodyGotHereFirst(Task task, TaskRequest request) {
        if (request.expectedVersion() == null) {
            throw new ConflictException(
                "This save did not say which version of the task it was built from. "
                    + "Reload the task and try again.");
        }
        if (!request.expectedVersion().equals(task.getVersion())) {
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
        // Not the text itself, which can be two thousand characters and would
        // fill the panel with one entry. That somebody rewrote the notes is
        // the part a reader needs; what they wrote is on the task.
        if (!Objects.equals(task.getDescription(), request.description())) {
            changes.add(request.description() == null || request.description().isBlank()
                ? "notes cleared"
                : "notes edited");
        }
        if (!task.getColor().equalsIgnoreCase(request.color())) {
            changes.add("colour %s → %s".formatted(task.getColor(), request.color()));
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
