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

    Optional<Task> findByIdAndProjectIdAndDeletedAtIsNull(Long id, Long projectId);
}
