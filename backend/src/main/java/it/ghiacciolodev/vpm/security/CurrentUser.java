package it.ghiacciolodev.vpm.security;

import it.ghiacciolodev.vpm.project.Project;
import it.ghiacciolodev.vpm.project.ProjectMember;
import it.ghiacciolodev.vpm.project.ProjectMemberRepository;
import it.ghiacciolodev.vpm.project.ProjectRepository;
import it.ghiacciolodev.vpm.project.ProjectRole;
import it.ghiacciolodev.vpm.user.User;
import it.ghiacciolodev.vpm.user.UserRepository;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Resolves the authenticated principal into a local user row, creating it on
 * first sight.
 *
 * Just-in-time provisioning rather than a sign-up form: Keycloak has already
 * established who this person is, and asking them to register a second time
 * would be asking them to tell us something we already know. The first request
 * after a first login is where the row appears.
 */
@Component
public class CurrentUser {

    private final UserRepository users;
    private final ProjectRepository projects;
    private final ProjectMemberRepository members;

    public CurrentUser(UserRepository users,
                       ProjectRepository projects,
                       ProjectMemberRepository members) {
        this.users = users;
        this.projects = projects;
        this.members = members;
    }

    /**
     * The local row for whoever is making this request.
     *
     * REQUIRES_NEW, and the reason is not obvious. This method writes, but it
     * is reached from read paths: TaskService is annotated
     * @Transactional(readOnly = true), and joining that transaction would put
     * Hibernate in manual flush mode — the save below would be discarded
     * silently, with no error and no row. The user would appear provisioned
     * for the length of the request and be gone by the next one.
     *
     * Suspending the caller's transaction and running in a fresh writable one
     * is what makes provisioning survive a request that only meant to read.
     *
     * There is deliberately no requireId() convenience method: it would be
     * called as this.requireId() -> this.require(), an internal call that
     * bypasses Spring's proxy and takes the annotation with it. Callers go
     * through the bean, so the proxy always applies.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public User require() {
        Jwt jwt = jwt();
        String sub = jwt.getSubject();

        // Never look up by a null subject. Spring Data turns a null parameter
        // into "WHERE keycloak_sub IS NULL", which matches every row that has
        // not been linked yet — so a token without a sub claim would silently
        // adopt somebody else's account, and the next such token would adopt
        // it in turn. A missing sub is a broken identity provider, not a user
        // to be resolved.
        if (sub == null || sub.isBlank()) {
            throw new IllegalStateException(
                "Token carries no subject claim. Check that the Keycloak client "
                    + "includes the 'basic' scope, which provides sub.");
        }

        return users.findByKeycloakSub(sub)
            .map(user -> syncProfile(user, jwt))
            .orElseGet(() -> provision(jwt));
    }

    /* --- internals ------------------------------------------------------ */

    private Jwt jwt() {
        Authentication authentication =
            SecurityContextHolder.getContext().getAuthentication();

        if (authentication instanceof JwtAuthenticationToken token) {
            return token.getToken();
        }
        // Every endpoint but health requires authentication, so reaching here
        // means the filter chain was misconfigured, not that a user did
        // something wrong. Failing loudly is the point.
        throw new IllegalStateException("No authenticated JWT in the security context");
    }

    private User provision(Jwt jwt) {
        String email = jwt.getClaimAsString("email");
        String name = jwt.getClaimAsString("name");
        String sub = jwt.getSubject();

        // An account may predate Keycloak — seeded, or invited by email before
        // ever signing in. Claiming it by email is what turns an invitation
        // into a working login instead of a duplicate row.
        //
        // It is also what links the seeded demo data to a real account: the
        // row already exists with keycloak_sub null, and this is where it
        // stops being a placeholder.
        User user = users.findByEmail(email).orElseGet(User::new);

        user.setKeycloakSub(sub);
        user.setEmail(email);
        user.setDisplayName(name != null ? name : email);

        User saved = users.save(user);

        // Somewhere to put work. Without this a new user signs in successfully
        // and lands on an application that shows them nothing and lets them
        // create nothing — technically correct, practically broken.
        //
        // Checked rather than assumed: a claimed seed account already has a
        // project, and a second empty one would only be in the way.
        if (projects.findAllForUser(saved.getId()).isEmpty()) {
            createPersonalProject(saved);
        }

        return saved;
    }

    /**
     * Keeps the local copy in step with the identity provider. Keycloak owns
     * these fields; this row only caches them so that listing project members
     * does not need a call to Keycloak per person.
     */
    private User syncProfile(User user, Jwt jwt) {
        String email = jwt.getClaimAsString("email");
        String name = jwt.getClaimAsString("name");

        boolean changed = false;

        if (email != null && !email.equals(user.getEmail())) {
            user.setEmail(email);
            changed = true;
        }
        if (name != null && !name.equals(user.getDisplayName())) {
            user.setDisplayName(name);
            changed = true;
        }

        return changed ? users.save(user) : user;
    }

    private void createPersonalProject(User user) {
        Project project = new Project();
        project.setName("My Project");
        project.setDescription("Created automatically on first sign-in");
        project.setCreatedBy(user.getId());

        Project saved = projects.save(project);

        ProjectMember membership = new ProjectMember();
        membership.setProjectId(saved.getId());
        membership.setUserId(user.getId());
        membership.setRole(ProjectRole.OWNER);

        members.save(membership);
    }
}
