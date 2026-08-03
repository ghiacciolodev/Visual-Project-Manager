package it.ghiacciolodev.vpm.task;

import com.jayway.jsonpath.JsonPath;
import it.ghiacciolodev.vpm.AbstractIT;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * assignee_id has been in the schema since V1 and unreachable by any API.
 *
 * The rule worth testing is not that the column round-trips — it is that only
 * a member of the project can be named, since a foreign key to users would
 * otherwise let any id at all be attached to a plan.
 */
class AssigneeApiIT extends AbstractIT {

    private static final String TASK = """
        {
          "title": "%s",
          "status": "TODO",
          "priority": "MEDIUM",
          "startDate": "2026-09-01",
          "endDate": "2026-09-05",
          "color": "#3B82F6",
          "assigneeId": %s
        }""";

    /** The caller's own user id, read back from the member list. */
    private Long userIdOf(String username, Long project) throws Exception {
        String body = mockMvc.perform(get("/api/v1/projects/{p}/members", project)
                .with(as(username)))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        return ((Number) JsonPath.read(body, "$[0].userId")).longValue();
    }

    @Test
    void namesTheAssigneeOnTheTaskItself() throws Exception {
        Long project = newProject("iris", "Assignment");
        Long iris = userIdOf("iris", project);

        // The display name travels with the task rather than being resolved
        // against the roster: an editor reads every task and has no reason to
        // fetch the member list.
        mockMvc.perform(post("/api/v1/projects/{p}/tasks", project)
                .with(as("iris"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(TASK.formatted("Draw the chart", iris)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.assignee.id").value(iris))
            .andExpect(jsonPath("$.assignee.displayName").value("iris"));

        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project).with(as("iris")))
            .andExpect(jsonPath("$[0].assignee.displayName").value("iris"));
    }

    @Test
    void leavesTheAssigneeNullWhenNobodyIsNamed() throws Exception {
        Long project = newProject("jonas", "Unassigned");

        mockMvc.perform(post("/api/v1/projects/{p}/tasks", project)
                .with(as("jonas"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(TASK.formatted("Nobody's job", "null")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.assignee").doesNotExist());
    }

    @Test
    void refusesSomebodyWhoIsNotInTheProject() throws Exception {
        Long kira = newProject("kira", "Kira's plan");
        Long liam = newProject("liam", "Liam's plan");
        Long liamsId = userIdOf("liam", liam);

        // Without this check the column accepts any number, and a stranger's
        // name would then be read back out of the task list by everybody in
        // the project. 404 rather than 400: to somebody outside, that account
        // is not a value they were entitled to learn exists.
        mockMvc.perform(post("/api/v1/projects/{p}/tasks", kira)
                .with(as("kira"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(TASK.formatted("Not yours to give", liamsId)))
            .andExpect(status().isNotFound());
    }

    @Test
    void followsSomebodyInvitedByEmailWhoHasNeverSignedIn() throws Exception {
        Long project = newProject("mira", "Invitations");

        mockMvc.perform(post("/api/v1/projects/{p}/members", project)
                .with(as("mira"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"noor@example.com\",\"role\":\"EDITOR\"}"))
            .andExpect(status().isOk());

        String members = mockMvc.perform(get("/api/v1/projects/{p}/members", project)
                .with(as("mira")))
            .andReturn().getResponse().getContentAsString();

        // Read as a list and indexed in Java: ending the path with [0] indexes
        // into each matched id rather than into the matches, and JsonPath
        // hands back the whole array.
        List<Number> found = JsonPath.read(members, "$[?(@.email == 'noor@example.com')].userId");
        Number noor = found.getFirst();

        // An invitation creates a placeholder row before the person has an
        // account. Work can be assigned to them in advance — which is most of
        // the point of inviting somebody before they arrive.
        mockMvc.perform(post("/api/v1/projects/{p}/tasks", project)
                .with(as("mira"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(TASK.formatted("Waiting for Noor", noor.longValue())))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.assignee.displayName").value("noor@example.com"));
    }

    @Test
    void unassignsWhenTheFieldComesBackNull() throws Exception {
        Long project = newProject("owen", "Reassignment");
        Long owen = userIdOf("owen", project);

        String created = mockMvc.perform(post("/api/v1/projects/{p}/tasks", project)
                .with(as("owen"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(TASK.formatted("Mine for now", owen)))
            .andExpect(jsonPath("$.assignee.id").value(owen))
            .andReturn().getResponse().getContentAsString();

        Long task = ((Number) JsonPath.read(created, "$.id")).longValue();

        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", project, task)
                .with(as("owen"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(TASK.formatted("Mine for now", "null")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.assignee").doesNotExist());
    }
}
