package it.ghiacciolodev.vpm.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoders;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableMethodSecurity   // switches on @PreAuthorize, used for per-project roles
public class SecurityConfig {

    private final KeycloakRoleConverter roleConverter;

    @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri}")
    private String issuerUri;

    public SecurityConfig(KeycloakRoleConverter roleConverter) {
        this.roleConverter = roleConverter;
    }

    /**
     * Declared explicitly rather than left to autoconfiguration.
     *
     * Built from the issuer, not from a hard-coded JWKS URL:
     * fromIssuerLocation fetches the realm's discovery document, learns where
     * the keys live, and validates the `iss` claim against this value. Point a
     * decoder straight at the JWKS endpoint and the issuer check quietly
     * disappears — tokens from any realm on the same server would then pass.
     *
     * This runs at startup and contacts Keycloak, so the backend refuses to
     * start while the identity provider is unreachable. That is the correct
     * failure: an API that cannot verify signatures should not be serving.
     */
    @Bean
    public JwtDecoder jwtDecoder() {
        return JwtDecoders.fromIssuerLocation(issuerUri);
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
