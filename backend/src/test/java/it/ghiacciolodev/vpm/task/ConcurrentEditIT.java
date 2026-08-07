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
          "assigneeId": %s,
          "expectedVersion": %s
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

    @Test
    void refusesAWriteBuiltOnAVersionSomebodyHasReplaced() throws Exception {
        Shared it = shared("cc-ada", "cc-bea");

        // Both open the task and read the same version.
        int asAdaSaw = versionOf("cc-ada", it.project(), it.task());
        int asBeaSaw = versionOf("cc-bea", it.project(), it.task());

        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", it.project(), it.task())
                .with(as("cc-ada"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("Ada's title", "null", asAdaSaw)))
            .andExpect(status().isOk());

        // Bea saves a form she filled in before Ada's change existed. Without
        // the check this succeeds and Ada's title is gone, with nothing
        // anywhere recording that it ever existed.
        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", it.project(), it.task())
                .with(as("cc-bea"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("Bea's title", "null", asBeaSaw)))
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

        int first = versionOf("cc-cass", it.project(), it.task());

        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", it.project(), it.task())
                .with(as("cc-cass"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("First", "null", first)))
            .andExpect(status().isOk());

        // Rereading is the whole remedy the message asks for, and it has to
        // actually work.
        int afterReload = versionOf("cc-dev", it.project(), it.task());

        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", it.project(), it.task())
                .with(as("cc-dev"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("Second", "null", afterReload)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.title").value("Second"));
    }

    /**
     * The regression that the version column was added for.
     *
     * The check used to compare updatedAt, which the response could not report
     * honestly: @UpdateTimestamp is written during a flush, and the response
     * was assembled before one was guaranteed, so a PUT answered with the
     * value from before its own write. One person editing one task twice was
     * told somebody else had got there first.
     *
     * Both cases are here because the first fix that suggested itself was
     * wrong: it looked as though a task with an assignee escaped, since the
     * membership lookup forces a flush. It does, and then apply() sets the
     * assignee afterwards and dirties the row again, so both were stale.
     */
    @Test
    void thePutAnswersWithTheVersionItJustWrote() throws Exception {
        Shared it = shared("cc-eli", "cc-fay");

        int seen = versionOf("cc-eli", it.project(), it.task());

        String response = mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}",
                it.project(), it.task())
                .with(as("cc-eli"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("Once", "null", seen)))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        int fromPut = JsonPath.read(response, "$.version");

        // What the row holds now, asked for independently.
        assertThatVersionIs(fromPut, "cc-eli", it.project(), it.task());

        // And the point of all of it: a second edit that trusts the first
        // response goes through, because one person editing one task twice is
        // not a conflict.
        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", it.project(), it.task())
                .with(as("cc-eli"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("Twice", "null", fromPut)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.title").value("Twice"));
    }

    @Test
    void thePutAnswersWithTheVersionItJustWroteWithAnAssigneeToo() throws Exception {
        Shared it = shared("cc-gus", "cc-hana");

        String me = mockMvc.perform(get("/api/v1/me").with(as("cc-gus")))
            .andReturn().getResponse().getContentAsString();
        long userId = ((Number) JsonPath.read(me, "$.id")).longValue();

        int seen = versionOf("cc-gus", it.project(), it.task());

        String response = mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}",
                it.project(), it.task())
                .with(as("cc-gus"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("Assigned", String.valueOf(userId), seen)))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        int fromPut = JsonPath.read(response, "$.version");
        assertThatVersionIs(fromPut, "cc-gus", it.project(), it.task());

        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", it.project(), it.task())
                .with(as("cc-gus"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("Assigned twice", String.valueOf(userId), fromPut)))
            .andExpect(status().isOk());
    }

    @Test
    void refusesAWriteThatNamesNoVersionAtAll() throws Exception {
        Shared it = shared("cc-iris", "cc-jae");

        // This used to be allowed, on the argument that requiring it would
        // break existing callers. There are no external callers, so the
        // argument was protecting nothing and the protection was optional.
        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", it.project(), it.task())
                .with(as("cc-iris"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(EDIT.formatted("No expectation", "null", "null")))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.detail").value(containsString("which version")));
    }

    private void assertThatVersionIs(int expected, String username,
                                     Long project, Long task) throws Exception {
        mockMvc.perform(get("/api/v1/projects/{p}/tasks/{t}", project, task)
                .with(as(username)))
            .andExpect(jsonPath("$.version").value(expected));
    }
}
