package it.ghiacciolodev.vpm;

import com.jayway.jsonpath.JsonPath;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.List;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Shared setup for the integration tests.
 *
 * Two things here are load-bearing.
 *
 * PostgreSQL runs in a container rather than H2: the CHECK constraints, the
 * hex pattern and the recursive CTEs are PostgreSQL features, and a test on H2
 * would pass while the real query was broken — worse than no test at all.
 *
 * The JwtDecoder is replaced rather than configured. The production bean is
 * built by calling Keycloak's discovery endpoint at startup, so without this
 * the context would refuse to load anywhere Keycloak is not running — which
 * includes every CI runner. Replacing the definition means the network call
 * never happens, and the tokens below are constructed directly instead of
 * being signed and verified. What is under test is the authorisation that
 * follows authentication, not the signature check, which is Spring's code.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
public abstract class AbstractIT {

    /**
     * One container for the whole run, started by hand and never stopped.
     *
     * Not @Testcontainers with @Container, which is the obvious spelling and
     * the wrong one here. That extension stops a static container when its
     * test class finishes; the field is declared once on this base class, so
     * the first class to run would shut the database down while Spring's
     * cached application context — shared by every class with the same
     * configuration — went on pointing at the dead port. Every suite after the
     * first failed with "Could not open JPA EntityManager".
     *
     * Nothing stops it: Ryuk reaps the container when the JVM exits.
     */
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres =
        new PostgreSQLContainer<>("postgres:16-alpine");

    static {
        postgres.start();
    }

    @MockitoBean
    JwtDecoder jwtDecoder;

    @Autowired
    protected MockMvc mockMvc;

    /**
     * A request as a given person. The subject is stable per username, so the
     * same caller resolves to the same account across requests — which is what
     * makes just-in-time provisioning observable.
     */
    protected static JwtRequestPostProcessor as(String username) {
        return jwt().jwt(token -> token
            .subject("sub-" + username)
            .claim("email", username + "@example.com")
            .claim("name", username));
    }

    /**
     * The id of a caller's first project.
     *
     * Signing in provisions an account with a sample project, so every test
     * starts from data it created simply by showing up. Fixtures loaded by a
     * migration were the previous approach; they belonged to a user nobody
     * could authenticate as.
     */
    protected Long firstProjectOf(String username) throws Exception {
        String body = mockMvc.perform(get("/api/v1/projects").with(as(username)))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        return ((Number) JsonPath.read(body, "$[0].id")).longValue();
    }

    /**
     * The id of a sample task, looked up by title rather than by position.
     *
     * The filter is read as a list and indexed in Java. Ending the path with
     * [0] instead reads as "the first element of each matched id", which is an
     * index into a number — JsonPath hands back the whole match array and the
     * cast to Number fails.
     */
    protected Long taskIdByTitle(String username, Long projectId, String title) throws Exception {
        String body = mockMvc.perform(
                get("/api/v1/projects/{p}/tasks", projectId).with(as(username)))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        List<Number> ids = JsonPath.read(body, "$[?(@.title == '" + title + "')].id");
        return ids.getFirst().longValue();
    }
}
