package it.ghiacciolodev.vpm.schedule;

import it.ghiacciolodev.vpm.AbstractIT;
import org.junit.jupiter.api.Test;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The fixture is a chain of 5 + 9 + 11 days, so the critical path is 25 —
 * short enough to check by hand, which is the point of a fixture for an
 * algorithm.
 */
class CriticalPathIT extends AbstractIT {

    @Test
    void computesTheChainAsTheCriticalPath() throws Exception {
        Plan plan = aPlanFor("uma");

        mockMvc.perform(get("/api/v1/projects/{p}/schedule/critical-path", plan.project())
                .with(as("uma")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.criticalDuration").value(25))
            .andExpect(jsonPath("$.criticalPath.length()").value(3));
    }

    @Test
    void givesTheStandaloneTaskFloatAndTheChainNone() throws Exception {
        Plan plan = aPlanFor("vera");

        // The documentation task depends on nothing and lasts two days, so it
        // can slip a long way without moving the end date. Every task in the
        // chain can slip by nothing at all. That difference is the whole
        // reason the analysis exists — a task list cannot show it.
        mockMvc.perform(get("/api/v1/projects/{p}/schedule/critical-path", plan.project())
                .with(as("vera")))
            .andExpect(jsonPath("$.tasks[?(@.title == 'Write the documentation')].critical")
                .value(false))
            .andExpect(jsonPath("$.tasks[?(@.title == 'Write the documentation')].totalFloat")
                .value(23))
            .andExpect(jsonPath("$.tasks[?(@.title == 'Build the API')].totalFloat")
                .value(0));
    }
}
