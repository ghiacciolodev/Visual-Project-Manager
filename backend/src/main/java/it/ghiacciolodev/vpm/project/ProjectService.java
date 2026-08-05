package it.ghiacciolodev.vpm.project;

import it.ghiacciolodev.vpm.audit.AuditAction;
import it.ghiacciolodev.vpm.audit.AuditEntity;
import it.ghiacciolodev.vpm.audit.AuditService;
import it.ghiacciolodev.vpm.common.exception.ConflictException;
import it.ghiacciolodev.vpm.common.exception.NotFoundException;
import it.ghiacciolodev.vpm.project.dto.*;
import it.ghiacciolodev.vpm.security.CurrentUser;
import it.ghiacciolodev.vpm.user.User;
import it.ghiacciolodev.vpm.user.UserRepository;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@Transactional(readOnly = true)
public class ProjectService {

    private final ProjectRepository projects;
    private final ProjectMemberRepository members;
    private final UserRepository users;
    private final CurrentUser currentUser;
    private final ProjectAccess access;
    private final AuditService audit;

    public ProjectService(ProjectRepository projects,
                          ProjectMemberRepository members,
                          UserRepository users,
                          CurrentUser currentUser,
                          ProjectAccess access,
                          AuditService audit) {
        this.projects = projects;
        this.members = members;
        this.users = users;
        this.currentUser = currentUser;
        this.access = access;
        this.audit = audit;
    }

    /* --- projects ------------------------------------------------------- */

    /**
     * Projects the caller belongs to.
     *
     * No @PreAuthorize: the query itself is the authorisation. There is no way
     * to ask this method for somebody else's projects, which is a stronger
     * guarantee than a check that could be forgotten on the next method.
     */
    public List<ProjectResponse> findMine() {
        Long userId = currentUser.require().getId();

        Map<Long, ProjectRole> roles = members.findByUserId(userId).stream()
            .collect(Collectors.toMap(ProjectMember::getProjectId, ProjectMember::getRole));

        return projects.findAllForUser(userId).stream()
            .map(p -> new ProjectResponse(
                p.getId(), p.getName(), p.getDescription(), roles.get(p.getId())))
            .toList();
    }

    @PreAuthorize("@access.canView(#projectId)")
    public ProjectResponse findOne(Long projectId) {
        Project project = projects.findById(projectId)
            .orElseThrow(() -> new NotFoundException("Project " + projectId + " not found"));

        return new ProjectResponse(
            project.getId(),
            project.getName(),
            project.getDescription(),
            access.roleIn(projectId));
    }

    @Transactional
    public ProjectResponse create(CreateProjectRequest request) {
        User me = currentUser.require();

        Project project = new Project();
        project.setName(request.name());
        project.setDescription(request.description());
        project.setCreatedBy(me.getId());

        Project saved = projects.save(project);

        ProjectMember membership = new ProjectMember();
        membership.setProjectId(saved.getId());
        membership.setUserId(me.getId());
        membership.setRole(ProjectRole.OWNER);
        members.save(membership);

        // The first line of the project's history, and the only one whose
        // project id has to come from the saved entity rather than an argument.
        audit.record(saved.getId(), AuditEntity.PROJECT, saved.getId(), AuditAction.CREATE,
            "Created \"%s\"".formatted(saved.getName()));

        return new ProjectResponse(
            saved.getId(), saved.getName(), saved.getDescription(), ProjectRole.OWNER);
    }

    /**
     * Renames a project, and re-describes it.
     *
     * Restricted to owners rather than editors. An editor changes the plan;
     * the name is what everyone else in the organisation calls this thing, and
     * that belongs with the people who can also decide who is in it.
     */
    @Transactional
    @PreAuthorize("@access.canAdminister(#projectId)")
    public ProjectResponse update(Long projectId, UpdateProjectRequest request) {
        Project project = projects.findById(projectId)
            .orElseThrow(() -> new NotFoundException("Project " + projectId + " not found"));

        String was = project.getName();

        project.setName(request.name());
        project.setDescription(request.description());

        if (!was.equals(request.name())) {
            audit.record(projectId, AuditEntity.PROJECT, projectId, AuditAction.UPDATE,
                "Renamed from \"%s\" to \"%s\"".formatted(was, request.name()));
        }

        // No save(): the entity is managed inside the transaction and Hibernate
        // flushes on commit, the same as a task update.
        return new ProjectResponse(
            project.getId(),
            project.getName(),
            project.getDescription(),
            access.roleIn(projectId));
    }

    @Transactional
    @PreAuthorize("@access.canAdminister(#projectId)")
    public void delete(Long projectId) {
        // Tasks, dependencies and memberships go with it: every foreign key
        // pointing at a project is ON DELETE CASCADE in V1.
        projects.deleteById(projectId);
    }

    /* --- membership ----------------------------------------------------- */

    @PreAuthorize("@access.canView(#projectId)")
    public List<MemberResponse> listMembers(Long projectId) {
        List<ProjectMember> memberships = members.findByProjectId(projectId);

        // Two queries rather than a join: the number of members is small, and
        // an ad-hoc JPQL join between unrelated entities is the kind of thing
        // that works until a Hibernate upgrade decides otherwise.
        Map<Long, User> byId = users
            .findAllById(memberships.stream().map(ProjectMember::getUserId).toList())
            .stream()
            .collect(Collectors.toMap(User::getId, Function.identity()));

        return memberships.stream()
            .map(m -> {
                User user = byId.get(m.getUserId());
                return new MemberResponse(
                    user.getId(),
                    user.getEmail(),
                    user.getDisplayName(),
                    m.getRole(),
                    user.getKeycloakSub() != null);
            })
            .sorted((a, b) -> a.role().compareTo(b.role()))
            .toList();
    }

    /**
     * Adds somebody to the project by email.
     *
     * The person need not have an account yet. A placeholder row is created
     * with no keycloak_sub, and CurrentUser.provision() claims it by email the
     * first time they sign in — which is why that lookup by email exists at
     * all. Requiring them to register first would mean an invitation could not
     * be sent to anyone who is not already a user.
     */
    @Transactional
    @PreAuthorize("@access.canAdminister(#projectId)")
    public MemberResponse invite(Long projectId, InviteRequest request) {
        String email = request.email().trim().toLowerCase();

        User user = users.findByEmail(email).orElseGet(() -> {
            User placeholder = new User();
            placeholder.setEmail(email);
            placeholder.setDisplayName(email);
            return users.save(placeholder);
        });

        if (members.existsByProjectIdAndUserId(projectId, user.getId())) {
            throw new ConflictException(
                "%s is already in this project".formatted(user.getDisplayName()));
        }

        ProjectMember membership = new ProjectMember();
        membership.setProjectId(projectId);
        membership.setUserId(user.getId());
        membership.setRole(request.role());
        members.save(membership);

        audit.record(projectId, AuditEntity.MEMBER, user.getId(), AuditAction.CREATE,
            "Added %s as %s".formatted(user.getDisplayName(), request.role()));

        return new MemberResponse(
            user.getId(), user.getEmail(), user.getDisplayName(),
            request.role(), user.getKeycloakSub() != null);
    }

    @Transactional
    @PreAuthorize("@access.canAdminister(#projectId)")
    public MemberResponse changeRole(Long projectId, Long userId, ChangeRoleRequest request) {
        ProjectMember membership = members.findByProjectIdAndUserId(projectId, userId)
            .orElseThrow(() -> new NotFoundException("That person is not in this project"));

        if (membership.getRole() == ProjectRole.OWNER && request.role() != ProjectRole.OWNER) {
            assertNotTheLastOwner(projectId);
        }

        ProjectRole was = membership.getRole();
        membership.setRole(request.role());

        User user = users.findById(userId).orElseThrow();

        if (was != request.role()) {
            audit.record(projectId, AuditEntity.MEMBER, userId, AuditAction.UPDATE,
                "%s: %s → %s".formatted(user.getDisplayName(), was, request.role()));
        }

        return new MemberResponse(
            user.getId(), user.getEmail(), user.getDisplayName(),
            request.role(), user.getKeycloakSub() != null);
    }

    /**
     * Removes somebody, or lets somebody remove themselves.
     *
     * Guarded by canRemoveMember rather than canAdminister: leaving a project
     * is not an act of administration, and requiring an owner for it left
     * editors and viewers with no way out of a plan they had been added to.
     */
    @Transactional
    @PreAuthorize("@access.canRemoveMember(#projectId, #userId)")
    public void removeMember(Long projectId, Long userId) {
        ProjectMember membership = members.findByProjectIdAndUserId(projectId, userId)
            .orElseThrow(() -> new NotFoundException("That person is not in this project"));

        if (membership.getRole() == ProjectRole.OWNER) {
            assertNotTheLastOwner(projectId);
        }

        members.delete(membership);

        audit.record(projectId, AuditEntity.MEMBER, userId, AuditAction.DELETE,
            "Removed %s from the project".formatted(
                users.findById(userId).map(User::getDisplayName).orElse("someone")));
    }

    /**
     * A project without an owner cannot be administered by anyone: no one
     * could invite, change roles or delete it, and it would sit there
     * permanently frozen. Cheaper to refuse the last step than to write the
     * recovery path.
     */
    private void assertNotTheLastOwner(Long projectId) {
        if (members.countByProjectIdAndRole(projectId, ProjectRole.OWNER) <= 1) {
            throw new ConflictException(
                "This is the project's only owner. Make somebody else an owner first.");
        }
    }
}
