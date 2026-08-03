package it.ghiacciolodev.vpm.task;

import it.ghiacciolodev.vpm.AbstractIT;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class TaskApiIT extends AbstractIT {

    @Test
    void createsATaskAndReadsItBack() throws Exception {
        Long project = newProject("nina", "Renderer work");

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

        mockMvc.perform(post("/api/v1/projects/{p}/tasks", project)
                .with(as("nina"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isCreated())
            .andExpect(header().exists("Location"))
            .andExpect(jsonPath("$.title").value("Write the Gantt renderer"));

        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project).with(as("nina")))
            .andExpect(status().isOk())
            // A new project starts empty, so the one just created is all of it.
            .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void rejectsAnEndDateBeforeTheStartDate() throws Exception {
        Long project = newProject("omar", "Date rules");

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

        // Reported against endDate rather than the form as a whole, so the
        // client can put the message under the offending input.
        mockMvc.perform(post("/api/v1/projects/{p}/tasks", project)
                .with(as("omar"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors.endDate").exists());
    }

    @Test
    void rejectsAMalformedColour() throws Exception {
        Long project = newProject("pia", "Colour rules");

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

        mockMvc.perform(post("/api/v1/projects/{p}/tasks", project)
                .with(as("pia"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors.color").exists());
    }

    @Test
    void refusesAnythingWithoutAToken() throws Exception {
        mockMvc.perform(get("/api/v1/projects/1/tasks"))
            .andExpect(status().isUnauthorized());
    }
}
