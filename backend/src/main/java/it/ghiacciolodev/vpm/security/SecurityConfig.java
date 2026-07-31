package it.ghiacciolodev.vpm.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableMethodSecurity   // switches on @PreAuthorize, used for per-project roles
public class SecurityConfig {

    private final KeycloakRoleConverter roleConverter;

    /** The issuer as it appears in the token — the public URL. */
    @Value("${app.keycloak.issuer}")
    private String issuer;

    /**
     * Where to fetch the signing keys. Empty in local development, where the
     * public URL is reachable and discovery can find them on its own.
     */
    @Value("${app.keycloak.jwk-set-uri:}")
    private String jwkSetUri;

    public SecurityConfig(KeycloakRoleConverter roleConverter) {
        this.roleConverter = roleConverter;
    }

    /**
     * Declared explicitly rather than left to autoconfiguration, because the
     * two halves of the job need different addresses once this runs in a
     * container.
     *
     * The browser reaches Keycloak at http://localhost:8081, so that is what
     * every token says its issuer is. The backend, inside the compose network,
     * cannot resolve localhost:8081 — that is its own loopback. It reaches
     * Keycloak at http://keycloak:8080 instead.
     *
     * So: keys are fetched over the internal address, and the issuer claim is
     * checked against the public one. Validating against the internal address
     * would reject every real token; skipping the check would accept tokens
     * from any realm on that server.
     */
    @Bean
    public JwtDecoder jwtDecoder() {
        if (jwkSetUri.isBlank()) {
            // Development: one address works for both, so let discovery do it.
            return JwtDecoders.fromIssuerLocation(issuer);
        }

        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(jwkSetUri).build();
        // withJwkSetUri does not know the issuer, so it does not check it.
        // Putting the validator back is the whole point of this branch.
        decoder.setJwtValidator(JwtValidators.createDefaultWithIssuer(issuer));
        return decoder;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                // Preflight requests carry no credentials by definition:
                // requiring authentication on OPTIONS breaks CORS entirely.
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .requestMatchers("/actuator/health").permitAll()
                // Deny by default. A new endpoint is protected the moment it
                // exists, rather than the moment somebody remembers to add it
                // to a list.
                .anyRequest().authenticated()
            )

            // Stateless: the token travels on every request and the server
            // keeps nothing between them.
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))

            // CSRF is disabled deliberately, not carelessly. The attack needs a
            // credential the browser attaches automatically — a cookie. This
            // API authenticates with a Bearer header that a cross-site form
            // cannot set, so there is nothing to forge. If the client ever
            // moves to cookie-based sessions (a BFF), this must come back on.
            .csrf(AbstractHttpConfigurer::disable)

            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt.jwtAuthenticationConverter(roleConverter))
            );

        return http.build();
    }
}
