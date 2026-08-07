package it.ghiacciolodev.vpm.security;

import it.ghiacciolodev.vpm.common.exception.ConflictException;
import it.ghiacciolodev.vpm.user.User;
import it.ghiacciolodev.vpm.user.UserRepository;
import org.springframework.dao.DataIntegrityViolationException;
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

    public CurrentUser(UserRepository users) {
        this.users = users;
    }

    /**
     * The local row for whoever is making this request.
     *
     * REQUIRES_NEW, and the reason is not obvious. This method writes, but it
     * is reached from read paths: TaskService is annotated
     * @Transactional(readOnly = true), and joining that transaction would put
     * Hibernate in manual flush mode — the save below would be discarded
     * silently, with no error and no row. The user would appear provisioned
     * for the length of one request and be gone by the next.
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

    /* --- provisioning --------------------------------------------------- */

    private User provision(Jwt jwt) {
        try {
            return insert(jwt);
        } catch (DataIntegrityViolationException race) {
            // Another request provisioned the same person a moment ago.
            //
            // On a first sign-in the browser fires several requests at once —
            // /me alongside the first data load — and each one finds no user
            // and tries to create one. REQUIRES_NEW makes those transactions
            // genuinely independent, so none of them sees the others' insert;
            // the unique constraint on keycloak_sub is what lets exactly one
            // through. That constraint doing its job is not a failure worth
            // reporting: the caller asked who this person is, and by now
            // somebody has answered.
            //
            // Catching the violation rather than locking up front, because the
            // collision happens once in an account's lifetime. Paying for a
            // lock on every request to smooth over a single moment would be
            // the wrong trade.
            return users.findByKeycloakSub(jwt.getSubject())
                .orElseThrow(() -> race);
        }
    }

    private User insert(Jwt jwt) {
        String email = normalise(jwt.getClaimAsString("email"));
        String name = jwt.getClaimAsString("name");
        String sub = jwt.getSubject();

        /*
         * An account may predate Keycloak: invited by email before the person
         * ever signed in. Claiming that row by email is what turns an
         * invitation into a working login instead of a duplicate.
         *
         * Only on a verified address, and that condition is the whole defence.
         * Registration is open, so without it the sequence is: somebody is
         * invited as an owner, anybody at all registers with their address,
         * and on first sign-in inherits the row and every membership attached
         * to it. The invitation would be the vulnerability rather than the
         * feature.
         *
         * An unverified address falls through to a fresh row, which is the
         * safe half of the same behaviour: the person gets an account, and
         * somebody else's project is not part of it. The realm also sets
         * verifyEmail, so in practice they cannot reach this point at all
         * without having answered the message.
         */
        User user;

        if (claimable(jwt, email)) {
            user = users.findByEmail(email).orElseGet(User::new);
        } else {
            /*
             * Not verified. The address may still be free, in which case this
             * is an ordinary new account that simply inherits nothing.
             *
             * If it is taken, there is no safe answer available: claiming the
             * row is the takeover, and inserting beside it violates the unique
             * constraint and leaves a 500 in place of an explanation. So the
             * sign-in is refused with the one instruction that resolves it.
             * The realm requires verification, so reaching this at all means
             * something upstream is configured differently from what this
             * application expects.
             */
            if (users.findByEmail(email).isPresent()) {
                throw new ConflictException(
                    "This address is already waiting for somebody to verify it. "
                        + "Confirm your email address, then sign in again.");
            }
            user = new User();
        }

        user.setKeycloakSub(sub);
        user.setEmail(email);
        user.setDisplayName(name != null ? name : email);

        // saveAndFlush, not save: the insert has to reach the database inside
        // the caller's try block. With a deferred flush the violation would
        // surface at commit, outside the catch, and the losing request would
        // fail anyway — which is the whole thing being prevented here.
        //
        // No sample project is created here any more. One used to be, because
        // a new account with no project landed on an application that showed
        // nothing and let them create nothing. The rail can create a project
        // now, so the argument for seeding fake work has gone with it — and an
        // empty schedule that the person fills themselves says more about what
        // this is for than four invented tasks do.
        return users.saveAndFlush(user);
    }

    /* --- internals ------------------------------------------------------ */

    /**
     * Whether this token may take over a row that already holds this address.
     *
     * The claim is a boolean in the specification and arrives as one from
     * Keycloak, but a claim is whatever the issuer put there: anything that is
     * not explicitly true is treated as not verified, including absent.
     */
    private boolean claimable(Jwt jwt, String email) {
        if (email == null || email.isBlank()) {
            return false;
        }
        return Boolean.TRUE.equals(jwt.getClaim("email_verified"));
    }

    /**
     * Lower-cased, because the invitation path already does it.
     *
     * ProjectService.invite stores the address it was given in lower case, and
     * this is the lookup that has to match it. Keycloak happens to lower-case
     * addresses itself, which meant the two agreed by coincidence rather than
     * by anything written down: an identity provider that did not would break
     * every invitation without a single error.
     */
    private String normalise(String email) {
        return email == null ? null : email.trim().toLowerCase(java.util.Locale.ROOT);
    }

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

    /**
     * Keeps the local copy in step with the identity provider. Keycloak owns
     * these fields; this row only caches them so that listing project members
     * does not need a call to Keycloak per person.
     */
    private User syncProfile(User user, Jwt jwt) {
        String email = normalise(jwt.getClaimAsString("email"));
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
}
