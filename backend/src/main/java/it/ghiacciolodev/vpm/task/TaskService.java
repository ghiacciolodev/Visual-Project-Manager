package it.ghiacciolodev.vpm.task;

import it.ghiacciolodev.vpm.common.exception.NotFoundException;
import it.ghiacciolodev.vpm.task.dto.TaskRequest;
import it.ghiacciolodev.vpm.task.dto.TaskResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

@Service
@Transactional(readOnly = true)   // read-only by default; writes opt in below
public class TaskService {

    /**
     * TEMPORARY — removed in phase 5.
     *
     * Until authentication exists there is no "current user", so every task
     * belongs to the seeded demo project (see V900__dev_seed.sql). Replacing
     * this constant with the authenticated user's project is the whole of the
     * change: the queries are already scoped by project.
     *
     * Kept as a visible named constant on purpose. Temporary code that hides
     * inside a method body stops being temporary.
     */
    private static final Long CURRENT_PROJECT_ID = 1L;

    private final TaskRepository repository;

    public TaskService(TaskRepository repository) {
        // Constructor injection, not @Autowired on a field: it makes the
        // dependency impossible to forget and the class trivial to unit test.
        this.repository = repository;
    }

    public List<TaskResponse> findAll() {
        return repository
            .findByProjectIdAndDeletedAtIsNullOrderByStartDateAsc(CURRENT_PROJECT_ID)
            .stream()
            .map(TaskResponse::from)
            .toList();
    }

    public TaskResponse findById(Long id) {
        return TaskResponse.from(loadOrThrow(id));
    }

    @Transactional
    public TaskResponse create(TaskRequest request) {
        Task task = new Task();
        task.setProjectId(CURRENT_PROJECT_ID);
        apply(request, task);
        return TaskResponse.from(repository.save(task));
    }

    @Transactional
    public TaskResponse update(Long id, TaskRequest request) {
        Task task = loadOrThrow(id);
        apply(request, task);
        // No explicit save(): the entity is managed inside the transaction and
        // Hibernate flushes the changes on commit.
        return TaskResponse.from(task);
    }

    @Transactional
    public void delete(Long id) {
        Task task = loadOrThrow(id);
        task.setDeletedAt(Instant.now());
    }

    private Task loadOrThrow(Long id) {
        return repository
            .findByIdAndProjectIdAndDeletedAtIsNull(id, CURRENT_PROJECT_ID)
            .orElseThrow(() -> new NotFoundException("Task " + id + " not found"));
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
