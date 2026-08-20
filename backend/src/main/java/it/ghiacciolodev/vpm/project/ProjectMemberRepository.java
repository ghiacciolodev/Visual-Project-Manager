package it.ghiacciolodev.vpm.project;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ProjectMemberRepository
    extends JpaRepository<ProjectMember, ProjectMember.Key> {

    Optional<ProjectMember> findByProjectIdAndUserId(Long projectId, Long userId);

    boolean existsByProjectIdAndUserId(Long projectId, Long userId);

    List<ProjectMember> findByProjectId(Long projectId);

    /**
     * Every membership belonging to one person.
     *
     * Filtered by the database, not in memory. findAll() and a stream would
     * read every membership row there is — every project of every user — to
     * answer a question about one of them: harmless with three accounts and
     * quadratic nonsense with three thousand.
     */
    List<ProjectMember> findByUserId(Long userId);

    /** Guards the "a project always has an owner" rule. */
    long countByProjectIdAndRole(Long projectId, ProjectRole role);

    /* --- ceilings ------------------------------------------------------- */

    /** How many people are in one project. */
    long countByProjectId(Long projectId);

    /**
     * How many projects one person is in.
     *
     * Membership rather than ownership, deliberately: a ceiling counted on
     * projects created would be walked straight around by an account that
     * makes one project, hands ownership over and makes another.
     */
    long countByUserId(Long userId);
}
