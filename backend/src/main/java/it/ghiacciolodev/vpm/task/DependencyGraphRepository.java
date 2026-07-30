package it.ghiacciolodev.vpm.task;

import it.ghiacciolodev.vpm.task.dto.TaskRef;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Graph queries, written by hand.
 *
 * This is the deliberate exception to using JPA everywhere else. Reachability
 * over a dependency graph is a recursive query, and an ORM cannot express one:
 * the alternative is loading every edge into memory and walking it in Java,
 * which does in the application what the database does better and in one
 * round trip. JPA keeps the CRUD; SQL gets the part SQL is for.
 *
 * Every parameter is bound, never concatenated. A recursive CTE assembled by
 * string building would be an injection point like any other query.
 */
@Repository
public class DependencyGraphRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public DependencyGraphRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Can `targetId` be reached from `fromId` by following dependency edges?
     *
     * Used before inserting an edge P → S: if S can already reach P, then
     * adding the edge closes a loop. The CHECK constraint in the schema stops
     * self-loops; everything longer has to be caught here.
     */
    public boolean pathExists(Long fromId, Long targetId) {
        String sql = """
                WITH RECURSIVE reachable(id) AS (
                    SELECT successor_id
                    FROM task_dependencies
                    WHERE predecessor_id = :fromId

                    UNION

                    SELECT d.successor_id
                    FROM task_dependencies d
                    JOIN reachable r ON d.predecessor_id = r.id
                )
                SELECT EXISTS (SELECT 1 FROM reachable WHERE id = :targetId)
                """;

        // UNION, not UNION ALL. The deduplication is what guarantees the
        // recursion terminates: should a cycle ever slip into the data, the
        // query stops instead of looping forever.

        MapSqlParameterSource params = new MapSqlParameterSource()
            .addValue("fromId", fromId)
            .addValue("targetId", targetId);

        return Boolean.TRUE.equals(jdbc.queryForObject(sql, params, Boolean.class));
    }

    /**
     * Predecessors of every task in a project, in one query.
     *
     * One round trip for the whole graph rather than one per task: with the
     * per-task version, a board of 200 tasks would issue 201 queries to render
     * a single list.
     */
    public Map<Long, List<TaskRef>> findPredecessorsByProject(Long projectId) {
        String sql = """
                SELECT d.successor_id AS successor_id,
                       p.id           AS predecessor_id,
                       p.title        AS predecessor_title,
                       p.status       AS predecessor_status
                FROM task_dependencies d
                JOIN tasks p ON p.id = d.predecessor_id
                JOIN tasks s ON s.id = d.successor_id
                WHERE s.project_id = :projectId
                  AND s.deleted_at IS NULL
                  AND p.deleted_at IS NULL
                ORDER BY p.start_date, p.id
                """;

        // Both sides are filtered on deleted_at. A soft-deleted task must not
        // block anything: it is gone as far as the user is concerned, and a
        // blocker nobody can see is a blocker nobody can clear.

        Map<Long, List<TaskRef>> bySuccessor = new HashMap<>();

        jdbc.query(sql, new MapSqlParameterSource("projectId", projectId), rs -> {
            Long successorId = rs.getLong("successor_id");
            TaskRef ref = new TaskRef(
                rs.getLong("predecessor_id"),
                rs.getString("predecessor_title"),
                TaskStatus.valueOf(rs.getString("predecessor_status"))
            );
            bySuccessor.computeIfAbsent(successorId, key -> new ArrayList<>()).add(ref);
        });

        return bySuccessor;
    }

    /** Predecessors of a single task. */
    public List<TaskRef> findPredecessors(Long taskId) {
        String sql = """
                SELECT p.id, p.title, p.status
                FROM task_dependencies d
                JOIN tasks p ON p.id = d.predecessor_id
                WHERE d.successor_id = :taskId
                  AND p.deleted_at IS NULL
                ORDER BY p.start_date, p.id
                """;

        return jdbc.query(sql, new MapSqlParameterSource("taskId", taskId),
            (rs, rowNum) -> new TaskRef(
                rs.getLong("id"),
                rs.getString("title"),
                TaskStatus.valueOf(rs.getString("status"))
            ));
    }

    /**
     * Creates an edge, ignoring a request that duplicates one.
     *
     * ON CONFLICT DO NOTHING makes the endpoint idempotent: asking twice for a
     * link that already exists leaves the graph in the state the caller wants,
     * which is what they asked for. Failing the second call would be
     * technically defensible and practically annoying.
     */
    public void link(Long predecessorId, Long successorId) {
        String sql = """
                INSERT INTO task_dependencies (predecessor_id, successor_id)
                VALUES (:predecessorId, :successorId)
                ON CONFLICT DO NOTHING
                """;

        jdbc.update(sql, new MapSqlParameterSource()
            .addValue("predecessorId", predecessorId)
            .addValue("successorId", successorId));
    }

    /** Removes an edge. Returns false when there was nothing to remove. */
    public boolean unlink(Long predecessorId, Long successorId) {
        String sql = """
                DELETE FROM task_dependencies
                WHERE predecessor_id = :predecessorId
                  AND successor_id = :successorId
                """;

        return jdbc.update(sql, new MapSqlParameterSource()
            .addValue("predecessorId", predecessorId)
            .addValue("successorId", successorId)) > 0;
    }

    /**
     * Drops every edge touching a task, in either direction.
     *
     * Called when a task is soft-deleted. The rows have to go physically: the
     * foreign keys point at a row that still exists, so ON DELETE CASCADE
     * never fires for a soft delete, and the orphaned edges would keep
     * blocking their successors indefinitely.
     */
    public int unlinkAll(Long taskId) {
        String sql = """
                DELETE FROM task_dependencies
                WHERE predecessor_id = :taskId
                   OR successor_id = :taskId
                """;

        return jdbc.update(sql, new MapSqlParameterSource("taskId", taskId));
    }

    /** All edges in a project, for drawing connectors on the chart. */
    public List<long[]> findEdgesByProject(Long projectId) {
        String sql = """
                SELECT d.predecessor_id, d.successor_id
                FROM task_dependencies d
                JOIN tasks p ON p.id = d.predecessor_id
                JOIN tasks s ON s.id = d.successor_id
                WHERE s.project_id = :projectId
                  AND p.deleted_at IS NULL
                  AND s.deleted_at IS NULL
                """;

        return jdbc.query(sql, new MapSqlParameterSource("projectId", projectId),
            (rs, rowNum) -> new long[]{ rs.getLong(1), rs.getLong(2) });
    }
}
