package it.ghiacciolodev.vpm.task;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * Every method filters on deletedAt IS NULL. Soft-deleted rows must never
 * surface through the API.
 *
 * This is done with explicit method names rather than Hibernate's @SoftDelete
 * or a @Where clause on the entity, both of which hide the filter globally and
 * then make it impossible to read deleted rows when an audit view needs them.
 * Explicit is slightly more typing and considerably less surprise.
 *
 * findByIdAndProjectId... looks redundant while the project is a constant. It
 * is the habit that prevents IDOR in phase 5: once the project comes from the
 * authenticated user, the filter is already in the right place.
 */
public interface TaskRepository extends JpaRepository<Task, Long> {

    List<Task> findByProjectIdAndDeletedAtIsNullOrderByStartDateAsc(Long projectId);

    /**
     * One page of a project's tasks, ordered and counted by the database.
     *
     * The paged endpoint used to read every task and then call subList, which
     * made X-Total-Count honest and the cost of producing it a lie: a caller
     * asking for ten rows out of two thousand was served all two thousand.
     * Paging that does not reduce the work is a header, not a feature.
     */
    org.springframework.data.domain.Page<Task> findByProjectIdAndDeletedAtIsNull(
        Long projectId, org.springframework.data.domain.Pageable pageable);

    Optional<Task> findByIdAndProjectIdAndDeletedAtIsNull(Long id, Long projectId);

    /**
     * How many live tasks a project holds, for the ceiling in TaskService.
     *
     * Counts what the API can see, so soft-deleted rows do not hold a quota
     * against a project forever: a plan at the limit is one somebody can get
     * back under by deleting a task, which is the only remedy the interface
     * offers and therefore the one it has to honour.
     */
    long countByProjectIdAndDeletedAtIsNull(Long projectId);
}
