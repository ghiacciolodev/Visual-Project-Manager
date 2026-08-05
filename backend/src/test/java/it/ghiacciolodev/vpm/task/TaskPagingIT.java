package it.ghiacciolodev.vpm.task;

import it.ghiacciolodev.vpm.AbstractIT;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Paging is opt-in, and reported in headers so the body is the same shape
 * whether or not it was asked for.
 */
class TaskPagingIT extends AbstractIT {

    /** Seven tasks, one per day, so position in the page is unambiguous. */
    private Long aProjectWithSevenTasks(String username) throws Exception {
        Long project = newProject(username, "Long plan");
        LocalDate day = LocalDate.of(2026, 9, 1);

        for (int i = 1; i <= 7; i++) {
            newTask(username, project, "Task " + i, "TODO", day.plusDays(i), day.plusDays(i));
        }
        return project;
    }

    @Test
    void returnsEverythingWhenNoPageIsAskedFor() throws Exception {
        Long project = aProjectWithSevenTasks("pg-ada");

        // The default has to stay unpaged: the chart measures its window from
        // the whole plan, and the dashboard filters over the whole list.
        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project).with(as("pg-ada")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(7))
            .andExpect(header().doesNotExist("X-Total-Count"));
    }

    @Test
    void cutsThePlanIntoPagesAndSaysHowManyThereAre() throws Exception {
        Long project = aProjectWithSevenTasks("pg-bea");

        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project)
                .param("page", "0").param("size", "3")
                .with(as("pg-bea")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(3))
            .andExpect(jsonPath("$[0].title").value("Task 1"))
            // The total is what lets a client know there is more to ask for.
            .andExpect(header().string("X-Total-Count", "7"));

        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project)
                .param("page", "2").param("size", "3")
                .with(as("pg-bea")))
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].title").value("Task 7"));
    }

    @Test
    void answersPastTheEndWithNothingRatherThanAnError() throws Exception {
        Long project = aProjectWithSevenTasks("pg-cass");

        // Asking for a page that does not exist is an ordinary thing for a
        // client walking a list while somebody else deletes from it.
        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project)
                .param("page", "99").param("size", "3")
                .with(as("pg-cass")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(0))
            .andExpect(header().string("X-Total-Count", "7"));
    }

    @Test
    void refusesToTreatAHugePageSizeAsAWayToAskForEverything() throws Exception {
        Long project = aProjectWithSevenTasks("pg-dev");

        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project)
                .param("page", "0").param("size", "1000000")
                .with(as("pg-dev")))
            .andExpect(status().isOk())
            // Clamped to the ceiling. Seven tasks fit inside it either way,
            // so what is asserted is the header rather than the length.
            .andExpect(header().string("X-Page-Size", "200"));
    }

    @Test
    void treatsNonsenseBoundsAsTheFirstPage() throws Exception {
        Long project = aProjectWithSevenTasks("pg-eli");

        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project)
                .param("page", "-4").param("size", "0")
                .with(as("pg-eli")))
            .andExpect(status().isOk())
            .andExpect(header().string("X-Page", "0"))
            .andExpect(header().string("X-Page-Size", "1"));
    }
}
