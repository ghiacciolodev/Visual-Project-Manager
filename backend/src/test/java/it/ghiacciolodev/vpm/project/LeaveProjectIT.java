package it.ghiacciolodev.vpm.project;

import com.jayway.jsonpath.JsonPath;
import it.ghiacciolodev.vpm.AbstractIT;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.util.List;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Getting out of a project.
 *
 * Removing a member was owner-only, which read as a restriction and worked as
 * a trap: anybody added to a plan they had nothing to do with could only ask
 * an owner to undo it, and if that owner had gone, nobody could.
 */
class LeaveProjectIT extends AbstractIT {

    private Long invite(String owner, Long project, String email, String role) throws Exception {
        String body = mockMvc.perform(post("/api/v1/projects/{p}/members", project)
                .with(as(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"%s\",\"role\":\"%s\"}".formatted(email, role)))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        return ((Number) JsonPath.read(body, "$.userId")).longValue();
    }

    private Long userIdOf(String username, Long project, String email) throws Exception {
        String body = mockMvc.perform(get("/api/v1/projects/{p}/members", project)
                .with(as(username)))
            .andReturn().getResponse().getContentAsString();

        List<Number> found = JsonPath.read(body, "$[?(@.email == '" + email + "')].userId");
        return found.getFirst().longValue();
    }

    @Test
    void anEditorMayLeaveOnTheirOwn() throws Exception {
        Long project = newProject("lv-ada", "Shared");
        invite("lv-ada", project, "lv-bea@example.com", "EDITOR");

        // Signing in is what turns the placeholder row into an account, so the
        // id is read back after Bea has actually been here.
        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project).with(as("lv-bea")))
            .andExpect(status().isOk());
        Long bea = userIdOf("lv-ada", project, "lv-bea@example.com");

        mockMvc.perform(delete("/api/v1/projects/{p}/members/{u}", project, bea)
                .with(as("lv-bea")))
            .andExpect(status().isNoContent());

        // Gone means gone: the project is no longer hers to read.
        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project).with(as("lv-bea")))
            .andExpect(status().isNotFound());
    }

    @Test
    void aViewerMayLeaveToo() throws Exception {
        Long project = newProject("lv-cass", "Shared");
        invite("lv-cass", project, "lv-dev@example.com", "VIEWER");

        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project).with(as("lv-dev")))
            .andExpect(status().isOk());
        Long dev = userIdOf("lv-cass", project, "lv-dev@example.com");

        // A viewer can change nothing about the plan, and still gets to
        // decide whether it is on their screen.
        mockMvc.perform(delete("/api/v1/projects/{p}/members/{u}", project, dev)
                .with(as("lv-dev")))
            .andExpect(status().isNoContent());
    }

    @Test
    void stillRefusesToRemoveSomebodyElse() throws Exception {
        Long project = newProject("lv-eli", "Shared");
        invite("lv-eli", project, "lv-fay@example.com", "EDITOR");
        invite("lv-eli", project, "lv-gus@example.com", "EDITOR");

        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project).with(as("lv-fay")))
            .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project).with(as("lv-gus")))
            .andExpect(status().isOk());

        Long gus = userIdOf("lv-eli", project, "lv-gus@example.com");

        // Leaving is not administering. Widening the rule to cover departures
        // must not widen it to cover evictions.
        mockMvc.perform(delete("/api/v1/projects/{p}/members/{u}", project, gus)
                .with(as("lv-fay")))
            .andExpect(status().isForbidden());
    }

    @Test
    void refusesToLetTheLastOwnerWalkAway() throws Exception {
        Long project = newProject("lv-hana", "Alone");
        Long hana = userIdOf("lv-hana", project, "lv-hana@example.com");

        // A project with no owner can never be administered again — the same
        // rule that stops the last owner demoting themselves has to stop them
        // leaving, or the back door reopens it.
        mockMvc.perform(delete("/api/v1/projects/{p}/members/{u}", project, hana)
                .with(as("lv-hana")))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.detail").value(containsString("only owner")));
    }

    @Test
    void letsAnOwnerLeaveOnceSomebodyElseCanTakeOver() throws Exception {
        Long project = newProject("lv-iris", "Handover");
        invite("lv-iris", project, "lv-jon@example.com", "OWNER");

        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project).with(as("lv-jon")))
            .andExpect(status().isOk());
        Long iris = userIdOf("lv-iris", project, "lv-iris@example.com");

        mockMvc.perform(delete("/api/v1/projects/{p}/members/{u}", project, iris)
                .with(as("lv-iris")))
            .andExpect(status().isNoContent());
    }

    @Test
    void answersAStrangerWithNotFoundRatherThanForbidden() throws Exception {
        Long project = newProject("lv-kira", "Private");
        newProject("lv-liam", "Elsewhere");

        Long kira = userIdOf("lv-kira", project, "lv-kira@example.com");

        // Same enumeration reasoning as every other read: to somebody outside,
        // the project does not exist.
        mockMvc.perform(delete("/api/v1/projects/{p}/members/{u}", project, kira)
                .with(as("lv-liam")))
            .andExpect(status().isNotFound());
    }
}
