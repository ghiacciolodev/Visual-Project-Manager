package it.ghiacciolodev.vpm.task;

import it.ghiacciolodev.vpm.AbstractIT;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Each test builds a chain — set up → build API → build interface — plus a
 * standalone documentation task. Enough shape to exercise every rule, and
 * declared by the test rather than inherited from whatever provisioning
 * happened to create.
 */
class DependencyApiIT extends AbstractIT {

    @Test
    void reportsWhatIsBlockingATask() throws Exception {
        Plan plan = aPlanFor("quinn");
        Long project = plan.project();
        Long ui = plan.ui();

        mockMvc.perform(get("/api/v1/projects/{p}/tasks/{t}", project, ui).with(as("quinn")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dependsOn.length()").value(1))
            .andExpect(jsonPath("$.blockedBy[0].title").value("Build the API"));
    }

    @Test
    void refusesToFinishATaskWhosePrerequisiteIsUnfinished() throws Exception {
        Plan plan = aPlanFor("rhea");
        Long project = plan.project();
        Long ui = plan.ui();

        String payload = """
                {
                  "title": "Build the interface",
                  "status": "DONE",
                  "priority": "MEDIUM",
                  "startDate": "2026-08-11",
                  "endDate": "2026-08-21",
                  "color": "#15803D"
                }
                """;

        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", project, ui)
                .with(as("rhea"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.offenders[0].title").value("Build the API"));
    }

    @Test
    void refusesAnEdgeThatWouldCloseACycle() throws Exception {
        Plan plan = aPlanFor("sami");
        Long project = plan.project();
        Long setup = plan.setup();
        Long ui = plan.ui();

        // The chain already runs setup → api → ui, so making ui a prerequisite
        // of setup closes the loop. The path is indirect, which is what the
        // recursive CTE is for: the CHECK constraint on the table only stops a
        // task depending on itself.
        mockMvc.perform(post("/api/v1/projects/{p}/tasks/{t}/dependencies", project, setup)
                .with(as("sami"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"predecessorId\": " + ui + "}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.detail").value(containsString("cycle")));
    }

    @Test
    void addsAndRemovesADependency() throws Exception {
        Plan plan = aPlanFor("tao");
        Long project = plan.project();
        Long docs = plan.docs();
        Long setup = plan.setup();

        mockMvc.perform(post("/api/v1/projects/{p}/tasks/{t}/dependencies", project, docs)
                .with(as("tao"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"predecessorId\": " + setup + "}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dependsOn.length()").value(1));

        // Asking twice is a no-op rather than an error: the caller's desired
        // state is already true.
        mockMvc.perform(post("/api/v1/projects/{p}/tasks/{t}/dependencies", project, docs)
                .with(as("tao"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"predecessorId\": " + setup + "}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dependsOn.length()").value(1));

        mockMvc.perform(delete("/api/v1/projects/{p}/tasks/{t}/dependencies/{d}",
                project, docs, setup).with(as("tao")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dependsOn.length()").value(0));
    }
}
