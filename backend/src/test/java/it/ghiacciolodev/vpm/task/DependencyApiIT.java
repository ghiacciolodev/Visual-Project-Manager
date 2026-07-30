package it.ghiacciolodev.vpm.task;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * The seed builds a chain: 1 (DONE) → 2 (DOING) → 3 (TODO).
 * These tests exercise the rules that chain is supposed to enforce.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@ActiveProfiles("dev")
class DependencyApiIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    private MockMvc mockMvc;

    @Test
    void reportsWhatIsBlockingATask() throws Exception {
        // Task 3 depends on task 2, which is DOING, so 3 is blocked.
        mockMvc.perform(get("/api/v1/tasks/3"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dependsOn.length()").value(1))
            .andExpect(jsonPath("$.blockedBy.length()").value(1))
            .andExpect(jsonPath("$.blockedBy[0].title").value("API Development"));

        // Task 1 has no predecessors at all.
        mockMvc.perform(get("/api/v1/tasks/1"))
            .andExpect(jsonPath("$.blockedBy.length()").value(0));
    }

    @Test
    void refusesToFinishATaskWhosePrerequisiteIsUnfinished() throws Exception {
        String payload = """
                {
                  "title": "Frontend UI",
                  "status": "DONE",
                  "priority": "MEDIUM",
                  "startDate": "2026-08-07",
                  "endDate": "2026-08-17",
                  "color": "#22C55E"
                }
                """;

        mockMvc.perform(put("/api/v1/tasks/3")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.offenders[0].title").value("API Development"));
    }

    @Test
    void refusesAnEdgeThatWouldCloseACycle() throws Exception {
        // 1 → 2 → 3 already exists, so making 3 a prerequisite of 1 closes the
        // loop. The path is indirect, which is exactly what the recursive CTE
        // is there to catch — a self-loop check alone would let this through.
        mockMvc.perform(post("/api/v1/tasks/1/dependencies")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"predecessorId\": 3}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.detail").value(
                org.hamcrest.Matchers.containsString("cycle")));
    }

    @Test
    void refusesASelfDependency() throws Exception {
        mockMvc.perform(post("/api/v1/tasks/2/dependencies")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"predecessorId\": 2}"))
            .andExpect(status().isConflict());
    }

    @Test
    void addsAndRemovesADependency() throws Exception {
        // 1 → 3 is a new edge alongside the existing chain: no cycle.
        mockMvc.perform(post("/api/v1/tasks/3/dependencies")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"predecessorId\": 1}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dependsOn.length()").value(2));

        // Repeating it is a no-op, not an error: the caller's desired state is
        // already true.
        mockMvc.perform(post("/api/v1/tasks/3/dependencies")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"predecessorId\": 1}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dependsOn.length()").value(2));

        mockMvc.perform(delete("/api/v1/tasks/3/dependencies/1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dependsOn.length()").value(1));
    }
}
