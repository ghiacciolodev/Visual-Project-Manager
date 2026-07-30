package it.ghiacciolodev.vpm.schedule;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The seed is a single chain: 1 (5 days) → 2 (9 days) → 3 (11 days).
 *
 * With no branches every task is critical and the path is the whole chain,
 * which makes the arithmetic easy to check by hand: 5 + 9 + 11 = 25 days.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@ActiveProfiles("dev")
class CriticalPathIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    private MockMvc mockMvc;

    @Test
    void computesTheChainAsOneCriticalPath() throws Exception {
        mockMvc.perform(get("/api/v1/schedule/critical-path"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.criticalDuration").value(25))
            .andExpect(jsonPath("$.criticalPath.length()").value(3))
            .andExpect(jsonPath("$.criticalPath[0]").value(1))
            .andExpect(jsonPath("$.criticalPath[2]").value(3));
    }

    @Test
    void givesEveryTaskInAChainZeroFloat() throws Exception {
        mockMvc.perform(get("/api/v1/schedule/critical-path"))
            .andExpect(jsonPath("$.tasks[?(@.taskId == 2)].totalFloat").value(0))
            .andExpect(jsonPath("$.tasks[?(@.taskId == 2)].earliestStart").value(5))
            .andExpect(jsonPath("$.tasks[?(@.taskId == 2)].earliestFinish").value(14));
    }

    @Test
    void flagsTasksScheduledToStartBeforeTheirPrerequisiteEnds() throws Exception {
        // The seed deliberately overlaps: task 2 starts three days before task
        // 1 is due to finish. The dependency and the dates disagree, and the
        // analysis says so rather than quietly picking one.
        mockMvc.perform(get("/api/v1/schedule/critical-path"))
            .andExpect(jsonPath("$.tasks[?(@.taskId == 2)].startsBeforePrerequisites")
                .value(true));
    }
}
