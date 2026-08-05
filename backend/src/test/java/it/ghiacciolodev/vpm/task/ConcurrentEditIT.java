package it.ghiacciolodev.vpm.task;

import com.jayway.jsonpath.JsonPath;
import it.ghiacciolodev.vpm.AbstractIT;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.time.LocalDate;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Two people editing the same task.
 *
 * The failure this defends against is silent, which is what makes it worth a
 * suite of its own: the person whose work disappears is the one who is not
 * looking, and the schedule only ever shows the current state.
 */
class ConcurrentEditIT extends AbstractIT {

    private static final String EDIT = """
        {
          "title": "%s",
          "status": "TODO",
          "priority": "MEDIUM",
          "startDate": "2026-09-01",
          "endDate": "2026-09-05",
          "color": "#3B82F6",
          "expectedUpdatedAt": %s
        }""";

    /** A project shared by two editors, and one task in it. */
    private record Shared(Long project, Long task) {}

    private Shared shared(String owner, String editor) throws Exception {
        Long project = newProject(owner, "Shared plan");

        mockMvc.perform(post("/api/v1/projects/{p}/members", project)
                .with(as(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"%s@example.com\",\"role\":\"EDITOR\"}".formatted(editor)))
            .andExpect(status().isOk());

        Long task = newTask(owner, project, "Contested", "TODO",
            LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 5));

        return new Shared(project, task);
    }

    private String updatedAtOf(String username, Long project, Long task) throws Exception {
        String body = mockMvc.perform(get("/api/v1/projects/{p}/tasks/{t}", project, task)
                .with(as(username)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.updatedAt").exists())
            .andReturn().getResponse().getContentAsString();

        return JsonPath.read(body, "$.updatedAt");
    }

    @Test
    void refusesAWriteBuiltOnAVersionSomebodyHasReplaced() throws Exception {
        Shared it = shared("cc-ada", "cc-bea");

        // Both open the task and read the same version.
        String asAdaSaw = updatedAtOf("cc-ada", it.project(), it.task());
        String asBeaSaw = updatedAtOf("cc-bea", it.project(), it.task());

        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", it.project(), it.task())
                .with(as("cc-ada"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("Ada's title", "\"" + asAdaSaw + "\"")))
            .andExpect(status().isOk());

        // Bea saves a form she filled in before Ada's change existed. Without
        // the check this succeeds and Ada's title is gone, with nothing
        // anywhere recording that it ever existed.
        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", it.project(), it.task())
                .with(as("cc-bea"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("Bea's title", "\"" + asBeaSaw + "\"")))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.detail").value(containsString("Somebody else changed")));

        // Ada's version is what survived.
        mockMvc.perform(get("/api/v1/projects/{p}/tasks/{t}", it.project(), it.task())
                .with(as("cc-ada")))
            .andExpect(jsonPath("$.title").value("Ada's title"));
    }

    @Test
    void acceptsTheSecondWriteOnceTheEditorHasCaughtUp() throws Exception {
        Shared it = shared("cc-cass", "cc-dev");

        String first = updatedAtOf("cc-cass", it.project(), it.task());

        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", it.project(), it.task())
                .with(as("cc-cass"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("First", "\"" + first + "\"")))
            .andExpect(status().isOk());

        // Rereading is the whole remedy the message asks for, and it has to
        // actually work.
        String afterReload = updatedAtOf("cc-dev", it.project(), it.task());

        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", it.project(), it.task())
                .with(as("cc-dev"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("Second", "\"" + afterReload + "\"")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.title").value("Second"));
    }

    @Test
    void returnsATimestampThatSurvivesTheRoundTrip() throws Exception {
        Shared it = shared("cc-eli", "cc-fay");

        // The check is an equality test on a value that goes out as JSON and
        // comes back parsed. If the serialisation loses precision — a
        // microsecond in Postgres against a nanosecond in Java — every write
        // would be refused as stale and the feature would be unusable.
        String seen = updatedAtOf("cc-eli", it.project(), it.task());

        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", it.project(), it.task())
                .with(as("cc-eli"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("Round trip", "\"" + seen + "\"")))
            .andExpect(status().isOk());
    }

    @Test
    void leavesAnUnconditionalWriteAlone() throws Exception {
        Shared it = shared("cc-gus", "cc-hana");

        // Omitting the field keeps the old behaviour. That is a real weakness
        // rather than a convenience, and it is why the client always sends it
        // — but a caller that has no version to quote must still be able to
        // write.
        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", it.project(), it.task())
                .with(as("cc-gus"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("No expectation", "null")))
            .andExpect(status().isOk());
    }
}
