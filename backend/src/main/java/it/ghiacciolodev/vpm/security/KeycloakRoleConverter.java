package it.ghiacciolodev.vpm.security;

import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Reads roles out of a Keycloak token.
 *
 * Spring's default converter looks in the `scope` claim, which is where OAuth2
 * puts scopes and where Keycloak puts nothing useful. Realm roles live under
 * `realm_access.roles`, so without this converter every authenticated request
 * arrives with no authorities at all and every @PreAuthorize refuses it — with
 * a 403 that gives no hint as to why.
 */
@Component
public class KeycloakRoleConverter implements Converter<Jwt, AbstractAuthenticationToken> {

    @Override
    @SuppressWarnings("unchecked")
    public AbstractAuthenticationToken convert(Jwt jwt) {
        Map<String, Object> realmAccess = jwt.getClaim("realm_access");

        Collection<String> roles = realmAccess == null
            ? List.of()
            : (Collection<String>) realmAccess.getOrDefault("roles", List.of());

        // The ROLE_ prefix is Spring Security's convention for hasRole().
        // Keycloak does not add it, so it is added here rather than writing
        // hasAuthority("vpm-user") at every call site.
        Set<GrantedAuthority> authorities = roles.stream()
            .map(role -> (GrantedAuthority) new SimpleGrantedAuthority("ROLE_" + role))
            .collect(Collectors.toSet());

        // The principal name becomes the `sub` claim: Keycloak's stable,
        // immutable user id. Using the username instead would break every
        // ownership record the day somebody changes their username.
        return new JwtAuthenticationToken(jwt, authorities, jwt.getSubject());
    }
}
