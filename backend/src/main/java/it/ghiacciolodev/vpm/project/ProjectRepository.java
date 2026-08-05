package it.ghiacciolodev.vpm.project;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ProjectRepository extends JpaRepository<Project, Long> {

    /**
     * Projects the user belongs to. Never "all projects": a query that can
     * return something the caller is not a member of is one refactor away from
     * being called without a filter.
     */
    @Query("""
            SELECT p FROM Project p
            WHERE p.id IN (
                SELECT m.projectId FROM ProjectMember m WHERE m.userId = :userId
            )
            ORDER BY p.createdAt
            """)
    List<Project> findAllForUser(@Param("userId") Long userId);
}
