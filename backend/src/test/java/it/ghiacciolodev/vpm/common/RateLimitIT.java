package it.ghiacciolodev.vpm.common;

import it.ghiacciolodev.vpm.AbstractIT;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;

import static org.hamcrest.Matchers.matchesRegex;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * The write limit, at a capacity small enough to reach in a test.
 *
 * Its own property source, so this runs against a context configured for three
 * writes a minute while every other suite keeps the production allowance and
 * never notices the filter is there.
 */
@TestPropertySource(properties = {
    "app.rate-limit.enabled=true",
    "app.rate-limit.capacity=3",
    "app.rate-limit.period=1m",
})
class RateLimitIT extends AbstractIT {

    private static final String PROJECT = """
        {"name": "%s", "description": null}""";

    @Test
    void refusesWritesPastTheAllowanceAndSaysWhenToComeBack() throws Exception {
        for (int i = 1; i <= 3; i++) {
            mockMvc.perform(post("/api/v1/projects")
                    .with(as("rl-alice"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(PROJECT.formatted("Project " + i)))
                .andExpect(status().isOk())
                .andExpect(header().exists("X-RateLimit-Remaining"));
        }

        // Retry-After is what makes a 429 actionable rather than a wall: a
        // client that is told the number can wait exactly long enough instead
        // of guessing or hammering.
        mockMvc.perform(post("/api/v1/projects")
                .with(as("rl-alice"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(PROJECT.formatted("One too many")))
            .andExpect(status().isTooManyRequests())
            .andExpect(header().string("X-RateLimit-Remaining", "0"))
            .andExpect(header().string("Retry-After", matchesRegex("[1-9][0-9]*")))
            // Same Problem Details shape as every other error, even though a
            // filter rejection never reaches the exception handler.
            .andExpect(jsonPath("$.status").value(429))
            .andExpect(jsonPath("$.title").value("Too many requests"));
    }

    @Test
    void leavesReadingAlone() throws Exception {
        Long project = newProject("rl-bea", "Reading");

        // Two of the three tokens are gone: creating the project, and nothing
        // else. Reads must not touch the bucket at all — a limit low enough to
        // stop abusive reading would interrupt somebody switching between the
        // schedule and the chart.
        for (int i = 0; i < 10; i++) {
            mockMvc.perform(get("/api/v1/projects/{p}/tasks", project).with(as("rl-bea")))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-RateLimit-Remaining"));
        }

        // Still two writes in hand, so the reads really did cost nothing.
        mockMvc.perform(post("/api/v1/projects/{p}/tasks", project)
                .with(as("rl-bea"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"Cheap","status":"TODO","priority":"LOW",
                     "startDate":"2026-09-01","endDate":"2026-09-02","color":"#3B82F6"}"""))
            .andExpect(status().isCreated());
    }

    @Test
    void metersEachCallerSeparately() throws Exception {
        for (int i = 1; i <= 3; i++) {
            mockMvc.perform(post("/api/v1/projects")
                    .with(as("rl-cass"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(PROJECT.formatted("Cass " + i)))
                .andExpect(status().isOk());
        }

        mockMvc.perform(post("/api/v1/projects")
                .with(as("rl-cass"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(PROJECT.formatted("Cass 4")))
            .andExpect(status().isTooManyRequests());

        // Keyed by the token's subject, not by address. Every one of these
        // requests comes from the same place, and an office behind one NAT
        // address would otherwise share a single allowance.
        mockMvc.perform(post("/api/v1/projects")
                .with(as("rl-dev"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(PROJECT.formatted("Somebody else entirely")))
            .andExpect(status().isOk());
    }
}
