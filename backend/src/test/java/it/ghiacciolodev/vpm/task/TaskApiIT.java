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
 * Runs against a real PostgreSQL in a container, not H2.
 *
 * This matters more than it looks: the CHECK constraints, the hex regex and —
 * later — the recursive CTEs are PostgreSQL features. A test on H2 would pass
 * while the production query is broken, which is worse than having no test.
 *
 * @ServiceConnection wires the datasource from the container automatically:
 * no @DynamicPropertySource plumbing needed.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@ActiveProfiles("dev")   // loads db/seed, so the demo project (id 1) exists
class TaskApiIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    private MockMvc mockMvc;

    @Test
    void createsATaskAndReadsItBack() throws Exception {
        String payload = """
                {
                  "title": "Write the Gantt renderer",
                  "description": "CSS Grid, no library",
                  "status": "TODO",
                  "priority": "HIGH",
                  "startDate": "2026-08-01",
                  "endDate": "2026-08-10",
                  "color": "#3B82F6"
                }
                """;

        mockMvc.perform(post("/api/v1/tasks")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isCreated())
            .andExpect(header().exists("Location"))
            .andExpect(jsonPath("$.id").exists())
            .andExpect(jsonPath("$.title").value("Write the Gantt renderer"));

        mockMvc.perform(get("/api/v1/tasks"))
            .andExpect(status().isOk())
            // 3 seeded tasks + the one just created
            .andExpect(jsonPath("$.length()").value(4));
    }

    @Test
    void rejectsAnEndDateBeforeTheStartDate() throws Exception {
        String payload = """
                {
                  "title": "Impossible task",
                  "status": "TODO",
                  "priority": "LOW",
                  "startDate": "2026-08-10",
                  "endDate": "2026-08-01",
                  "color": "#FF0000"
                }
                """;

        mockMvc.perform(post("/api/v1/tasks")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors.endDate").exists());
    }

    @Test
    void rejectsAMalformedColor() throws Exception {
        String payload = """
                {
                  "title": "Bad colour",
                  "status": "TODO",
                  "priority": "LOW",
                  "startDate": "2026-08-01",
                  "endDate": "2026-08-02",
                  "color": "blue"
                }
                """;

        mockMvc.perform(post("/api/v1/tasks")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors.color").exists());
    }
}
