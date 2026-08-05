package it.ghiacciolodev.vpm.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    /**
     * Explicit origin, read from configuration. Never "*": a wildcard is
     * invalid together with credentials, and it hands every site on the
     * internet the right to call this API from a victim's browser.
     */
    @Value("${app.cors.allowed-origin:http://localhost:4200}")
    private String allowedOrigin;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOrigins(allowedOrigin)
            .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
            .allowedHeaders("*")
            // A cross-origin response hands JavaScript only a handful of
            // headers unless the server names the rest. Without this the
            // paging counts and the rate-limit figures are sent, arrive, and
            // are invisible to the very client they are addressed to — the
            // kind of omission that looks like the server not sending them.
            .exposedHeaders(
                "Location",
                "X-Total-Count", "X-Page", "X-Page-Size",
                "X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After")
            .maxAge(3600);   // caches the preflight, one less round trip
    }
}
