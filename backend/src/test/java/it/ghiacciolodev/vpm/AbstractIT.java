package it.ghiacciolodev.vpm;

import com.jayway.jsonpath.JsonPath;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;

import java.time.LocalDate;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
        return as(username, true);
    }

    /**
     * The same, with the verification state of the address spelled out.
     *
     * It matters because provisioning claims an invited placeholder row by
     * email, and only does so for a verified address: registration is open, so
     * an unverified claim would let anybody who registers somebody else's
     * address inherit their memberships. Almost every test wants the verified
     * token, because that is what Keycloak issues once the realm requires
     * verification.
     */
    protected static JwtRequestPostProcessor as(String username, boolean emailVerified) {
        return jwt().jwt(token -> token
            .subject("sub-" + username)
            .claim("email", username + "@example.com")
            .claim("email_verified", emailVerified)
            .claim("name", username));
    }

    /* --- fixtures ------------------------------------------------------- */

    /**
     * Every test builds the data it needs.
     *
     * Until now they read a sample project that provisioning created for each
     * new account, which meant the seed shipped to real users was also the
     * fixture the suite was written against. Two things went wrong with that.
     * A test could not describe the shape it was testing — the shape was
     * somewhere else, in production code — and changing the sample data to
     * suit a user would silently change what the tests asserted. Removing the
     * sample project is what forced the issue; building fixtures here is the
     * better arrangement regardless.
     */
    protected Long newProject(String username, String name) throws Exception {
        String body = mockMvc.perform(post("/api/v1/projects")
                .with(as(username))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"name": "%s", "description": null}""".formatted(name)))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        return ((Number) JsonPath.read(body, "$.id")).longValue();
    }

    protected Long newTask(String username, Long projectId, String title,
                           String status, LocalDate start, LocalDate end) throws Exception {
        String body = mockMvc.perform(post("/api/v1/projects/{p}/tasks", projectId)
                .with(as(username))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "title": "%s",
                      "status": "%s",
                      "priority": "MEDIUM",
                      "startDate": "%s",
                      "endDate": "%s",
                      "color": "#3B82F6"
                    }""".formatted(title, status, start, end)))
            .andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString();

        return ((Number) JsonPath.read(body, "$.id")).longValue();
    }

    /**
     * The version a client would have read before writing.
     *
     * Every update has to quote one now, so nearly every suite needs this. It
     * lives here rather than being copied per test because a helper that fakes
     * the number would defeat the check it is quoting.
     */
    protected int versionOf(String username, Long projectId, Long taskId) throws Exception {
        String body = mockMvc.perform(
                org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                    .get("/api/v1/projects/{p}/tasks/{t}", projectId, taskId)
                    .with(as(username)))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        return JsonPath.read(body, "$.version");
    }

    /** Makes predecessor a prerequisite of task. */
    protected void dependsOn(String username, Long projectId,
                             Long taskId, Long predecessorId) throws Exception {
        mockMvc.perform(post("/api/v1/projects/{p}/tasks/{t}/dependencies", projectId, taskId)
                .with(as(username))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"predecessorId\": " + predecessorId + "}"))
            .andExpect(status().isOk());
    }

    /**
     * A chain of three plus one task that depends on nothing.
     *
     * The durations — 5, 9 and 11 days in the chain, 2 standing alone — are
     * chosen so the arithmetic can be checked by hand: the critical path is
     * 25 days, and the standalone task carries 23 days of float. Several tests
     * want exactly this shape, and repeating it in each of them would invite
     * the copies to drift.
     */
    protected record Plan(Long project, Long setup, Long api, Long ui, Long docs) {}

    protected Plan aPlanFor(String username) throws Exception {
        LocalDate today = LocalDate.now();
        Long project = newProject(username, "Test plan");

        Long setup = newTask(username, project, "Set up the database",
            "DONE", today.minusDays(2), today.plusDays(2));      // 5 days
        Long api = newTask(username, project, "Build the API",
            "DOING", today.plusDays(3), today.plusDays(11));      // 9 days
        Long ui = newTask(username, project, "Build the interface",
            "TODO", today.plusDays(12), today.plusDays(22));      // 11 days
        Long docs = newTask(username, project, "Write the documentation",
            "TODO", today.plusDays(5), today.plusDays(6));        // 2 days

        dependsOn(username, project, api, setup);
        dependsOn(username, project, ui, api);

        return new Plan(project, setup, api, ui, docs);
    }
}
