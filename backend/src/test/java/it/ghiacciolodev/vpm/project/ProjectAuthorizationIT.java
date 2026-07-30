package it.ghiacciolodev.vpm.project;

import it.ghiacciolodev.vpm.AbstractIT;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * The tests that make the authorisation model more than a claim.
 *
 * Every one of them asserts a refusal. A permission system is only worth
 * anything if it says no, and a refusal is the part nobody notices breaking.
 */
class ProjectAuthorizationIT extends AbstractIT {

    @Test
    void aStrangerGetsNotFoundRatherThanForbidden() throws Exception {
        Long adasProject = firstProjectOf("ada");
        firstProjectOf("grace");   // provisions grace with a project of her own

        // 404, deliberately. A 403 would confirm the project exists, turning
        // the id into an oracle for enumerating other people's work.
        mockMvc.perform(get("/api/v1/projects/{p}/tasks", adasProject).with(as("grace")))
            .andExpect(status().isNotFound());
    }

    @Test
    void aViewerMayReadButNotWrite() throws Exception {
        Long project = firstProjectOf("bea");

        mockMvc.perform(post("/api/v1/projects/{p}/members", project)
                .with(as("bea"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"carl@example.com\",\"role\":\"VIEWER\"}"))
            .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project).with(as("carl")))
            .andExpect(status().isOk());

        Long task = taskIdByTitle("bea", project, "Write the documentation");

        // 403 this time, not 404: carl can see the project, so telling him the
        // action needs a higher role is more useful than pretending the task
        // is not there.
        mockMvc.perform(delete("/api/v1/projects/{p}/tasks/{t}", project, task).with(as("carl")))
            .andExpect(status().isForbidden());
    }

    @Test
    void anEditorMayChangeThePlanButNotTheMembership() throws Exception {
        Long project = firstProjectOf("dana");

        mockMvc.perform(post("/api/v1/projects/{p}/members", project)
                .with(as("dana"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"eli@example.com\",\"role\":\"EDITOR\"}"))
            .andExpect(status().isOk());

        // Editing the plan and editing who may edit it are different powers.
        mockMvc.perform(get("/api/v1/projects/{p}/members", project).with(as("eli")))
            .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/projects/{p}/members", project)
                .with(as("eli"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"mallory@example.com\",\"role\":\"OWNER\"}"))
            .andExpect(status().isForbidden());
    }

    @Test
    void theLastOwnerCannotStepDown() throws Exception {
        Long project = firstProjectOf("fay");

        String members = mockMvc.perform(
                get("/api/v1/projects/{p}/members", project).with(as("fay")))
            .andReturn().getResponse().getContentAsString();

        Number me = com.jayway.jsonpath.JsonPath.read(members, "$[0].userId");

        // A project with no owner can never be administered again: nobody
        // could invite, change roles or delete it. Cheaper to refuse the last
        // step than to write the recovery path.
        mockMvc.perform(patch("/api/v1/projects/{p}/members/{u}", project, me.longValue())
                .with(as("fay"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"role\":\"VIEWER\"}"))
            .andExpect(status().isConflict());
    }
}
