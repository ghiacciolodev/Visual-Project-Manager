package it.ghiacciolodev.vpm.project;

import it.ghiacciolodev.vpm.common.exception.NotFoundException;
import it.ghiacciolodev.vpm.security.CurrentUser;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The authorisation decision for a project, in one place.
 *
 * Registered as "access" so @PreAuthorize can read as prose:
 * @PreAuthorize("@access.canEdit(#projectId)"). A custom PermissionEvaluator
 * would do the same job with three more classes and a registration step.
 *
 * Note what Keycloak does not do here. It established who this person is; it
 * has no idea which projects they belong to, and putting that in the token
 * would mean reissuing tokens whenever a membership changes. Identity is
 * federated, authorisation is local — that split is the point.
 */
@Component("access")
public class ProjectAccess {

    private final CurrentUser currentUser;
    private final ProjectMemberRepository members;

    public ProjectAccess(CurrentUser currentUser, ProjectMemberRepository members) {
        this.currentUser = currentUser;
        this.members = members;
    }

    /**
     * The caller's role in this project.
     *
     * Throws NotFound — not Forbidden — when they are not a member. A 403 on a
     * project you have no business seeing confirms that it exists, and an id
     * that answers differently for members and strangers is an enumeration
     * oracle. To a non-member, a project they cannot see does not exist.
     */
    @Transactional(readOnly = true)
    public ProjectRole roleIn(Long projectId) {
        Long userId = currentUser.require().getId();

        return members.findByProjectIdAndUserId(projectId, userId)
            .map(ProjectMember::getRole)
            .orElseThrow(() -> new NotFoundException("Project " + projectId + " not found"));
    }

    /** Any member may read. */
    public boolean canView(Long projectId) {
        roleIn(projectId);   // throws 404 for non-members
        return true;
    }

    /**
     * Editors and owners may change the plan.
     *
     * Returns false rather than throwing, so a viewer gets a plain 403: they
     * already know the project exists, and hiding the reason would only leave
     * them guessing why a button did nothing.
     */
    public boolean canEdit(Long projectId) {
        return roleIn(projectId).satisfies(ProjectRole.EDITOR);
    }

    /** Only owners may change who else is in the project. */
    public boolean canAdminister(Long projectId) {
        return roleIn(projectId) == ProjectRole.OWNER;
    }
}
