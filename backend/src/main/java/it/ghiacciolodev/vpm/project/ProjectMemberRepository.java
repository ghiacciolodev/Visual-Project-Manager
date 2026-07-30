package it.ghiacciolodev.vpm.project;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ProjectMemberRepository
    extends JpaRepository<ProjectMember, ProjectMember.Key> {

    Optional<ProjectMember> findByProjectIdAndUserId(Long projectId, Long userId);

    boolean existsByProjectIdAndUserId(Long projectId, Long userId);

    List<ProjectMember> findByProjectId(Long projectId);

    /** Guards the "a project always has an owner" rule. */
    long countByProjectIdAndRole(Long projectId, ProjectRole role);
}
