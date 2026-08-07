package it.ghiacciolodev.vpm.audit;

import com.jayway.jsonpath.JsonPath;
import it.ghiacciolodev.vpm.AbstractIT;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.util.List;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * The history, and the reason it is written where the changes are made.
 *
 * The assertions worth reading are the ones about the summaries: a log that
 * only says a task was updated is a table nobody opens twice.
 */
class AuditLogIT extends AbstractIT {

    private static final String TASK = """
        {
          "title": "%s",
          "status": "%s",
          "priority": "%s",
          "startDate": "%s",
          "endDate": "%s",
          "color": "#3B82F6"
        }""";

    /** The same payload with the version a caller must quote to update. */
    private static final String EDIT = """
        {
          "title": "%s",
          "status": "%s",
          "priority": "%s",
          "startDate": "%s",
          "endDate": "%s",
          "color": "#3B82F6",
          "expectedVersion": %s
        }""";

    private List<String> summariesFor(String username, Long project) throws Exception {
        String body = mockMvc.perform(get("/api/v1/projects/{p}/audit", project)
                .with(as(username)))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        return JsonPath.read(body, "$[*].summary");
    }

    @Test
    void opensWithTheProjectBeingCreated() throws Exception {
        Long project = newProject("au-ada", "Apollo");

        mockMvc.perform(get("/api/v1/projects/{p}/audit", project).with(as("au-ada")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].action").value("CREATE"))
            .andExpect(jsonPath("$[0].entityType").value("PROJECT"))
            .andExpect(jsonPath("$[0].actorName").value("au-ada"))
            .andExpect(jsonPath("$[0].summary").value(containsString("Apollo")));
    }

    @Test
    void saysWhatChangedRatherThanThatSomethingDid() throws Exception {
        Long project = newProject("au-bea", "Plan");
        Long task = newTask("au-bea", project, "Draft the spec", "TODO",
            java.time.LocalDate.of(2026, 9, 1), java.time.LocalDate.of(2026, 9, 5));

        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", project, task)
                .with(as("au-bea"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("Draft the spec", "DOING", "HIGH",
                    "2026-09-03", "2026-09-08", versionOf("au-bea", project, task))))
            .andExpect(status().isOk());

        // The point of writing history from the code that makes the change:
        // the previous status and the previous dates only exist there.
        List<String> summaries = summariesFor("au-bea", project);
        String update = summaries.getFirst();

        assert update.contains("TODO → DOING") : update;
        assert update.contains("priority MEDIUM → HIGH") : update;
        assert update.contains("2026-09-03") : update;
    }

    @Test
    void staysQuietWhenAnEditChangesNothing() throws Exception {
        Long project = newProject("au-cass", "Plan");
        Long task = newTask("au-cass", project, "Unchanged", "TODO",
            java.time.LocalDate.of(2026, 9, 1), java.time.LocalDate.of(2026, 9, 5));

        int before = summariesFor("au-cass", project).size();

        // Saving a form without touching it is a common thing to do, and an
        // entry for it is noise that pushes real history off the screen.
        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", project, task)
                .with(as("au-cass"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("Unchanged", "TODO", "MEDIUM",
                    "2026-09-01", "2026-09-05", versionOf("au-cass", project, task))))
            .andExpect(status().isOk());

        assert summariesFor("au-cass", project).size() == before;
    }

    @Test
    void recordsNothingWhenTheChangeItselfIsRefused() throws Exception {
        Plan plan = aPlanFor("au-dev");
        int before = summariesFor("au-dev", plan.project()).size();

        // "Build the interface" waits on an unfinished task, so this is
        // refused. Sharing the caller's transaction is what makes the entry
        // roll back with it — a log that claims something happened when it
        // did not is worse than no log.
        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", plan.project(), plan.ui())
                .with(as("au-dev"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("Build the interface", "DONE", "MEDIUM",
                    "2026-09-01", "2026-09-05",
                    versionOf("au-dev", plan.project(), plan.ui()))))
            .andExpect(status().isConflict());

        assert summariesFor("au-dev", plan.project()).size() == before;
    }

    @Test
    void followsMembershipAsWellAsThePlan() throws Exception {
        Long project = newProject("au-eli", "Staffing");

        mockMvc.perform(post("/api/v1/projects/{p}/members", project)
                .with(as("au-eli"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"fay@example.com\",\"role\":\"EDITOR\"}"))
            .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/projects/{p}/audit", project).with(as("au-eli")))
            .andExpect(jsonPath("$[0].entityType").value("MEMBER"))
            .andExpect(jsonPath("$[0].summary").value(containsString("EDITOR")));
    }

    @Test
    void isReadableByAnyMemberAndInvisibleToEverybodyElse() throws Exception {
        Long project = newProject("au-gus", "Private");
        newProject("au-hana", "Somewhere else");

        mockMvc.perform(post("/api/v1/projects/{p}/members", project)
                .with(as("au-gus"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"au-ivy@example.com\",\"role\":\"VIEWER\"}"))
            .andExpect(status().isOk());

        // A viewer may read it. The log answers "who moved this?", which is a
        // question anybody working from the plan has — restricting it to
        // owners would leave the people affected by a change unable to see
        // who made it.
        mockMvc.perform(get("/api/v1/projects/{p}/audit", project).with(as("au-ivy")))
            .andExpect(status().isOk());

        // A stranger gets the same 404 every other read gives them.
        mockMvc.perform(get("/api/v1/projects/{p}/audit", project).with(as("au-hana")))
            .andExpect(status().isNotFound());
    }

    @Test
    void offersNoWayToEditOrRemoveAnEntry() throws Exception {
        Long project = newProject("au-jon", "Immutable");

        // A history somebody can tidy up is not a history. There is no
        // endpoint and no service method behind one.
        mockMvc.perform(delete("/api/v1/projects/{p}/audit", project).with(as("au-jon")))
            .andExpect(status().isMethodNotAllowed());
    }
}
