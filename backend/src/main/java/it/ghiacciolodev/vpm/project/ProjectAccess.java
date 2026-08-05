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

    /**
     * Owners may remove anybody. Everybody may remove themselves.
     *
     * The second half was missing, and its absence was a trap rather than a
     * restriction: an editor or a viewer had no way out of a project at all.
     * Somebody added to a plan they have nothing to do with could only ask an
     * owner to undo it — and if that owner had gone, nobody could.
     *
     * Leaving is not administering. The one rule it still has to respect is
     * that a project cannot be left without an owner, which ProjectService
     * enforces for departures and demotions alike.
     */
    public boolean canRemoveMember(Long projectId, Long userId) {
        if (currentUser.require().getId().equals(userId)) {
            roleIn(projectId);   // 404 if they are not in it to begin with
            return true;
        }
        return canAdminister(projectId);
    }
}
