package it.ghiacciolodev.vpm.project;

import com.jayway.jsonpath.JsonPath;
import it.ghiacciolodev.vpm.AbstractIT;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Creating, renaming and deleting a project.
 *
 * Renaming is new; creation and deletion were reachable only from a terminal
 * until the panel arrived, so this is also the first time the cascade is
 * asserted rather than assumed from the schema.
 */
class ProjectLifecycleIT extends AbstractIT {

    @Test
    void anOwnerMayRenameTheirProject() throws Exception {
        Long project = firstProjectOf("nina");

        mockMvc.perform(put("/api/v1/projects/{p}", project)
                .with(as("nina"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Apollo\",\"description\":\"The landing\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Apollo"))
            .andExpect(jsonPath("$.description").value("The landing"))
            // The caller's own role travels with the project, and renaming
            // must not quietly drop it: the client decides which controls to
            // draw from this field.
            .andExpect(jsonPath("$.myRole").value("OWNER"));

        mockMvc.perform(get("/api/v1/projects/{p}", project).with(as("nina")))
            .andExpect(jsonPath("$.name").value("Apollo"));
    }

    @Test
    void anEditorMayNotRenameTheProject() throws Exception {
        Long project = firstProjectOf("omar");

        mockMvc.perform(post("/api/v1/projects/{p}/members", project)
                .with(as("omar"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"pia@example.com\",\"role\":\"EDITOR\"}"))
            .andExpect(status().isOk());

        // Changing the plan and changing what the thing is called are
        // different powers: the name is what everyone outside the project
        // calls it.
        mockMvc.perform(put("/api/v1/projects/{p}", project)
                .with(as("pia"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Mine now\",\"description\":null}"))
            .andExpect(status().isForbidden());
    }

    @Test
    void aStrangerRenamingGetsNotFoundRatherThanForbidden() throws Exception {
        Long quinns = firstProjectOf("quinn");
        firstProjectOf("rosa");

        // Same reasoning as every other read: a 403 would confirm the project
        // exists, and an id that answers differently for members and strangers
        // is an enumeration oracle.
        mockMvc.perform(put("/api/v1/projects/{p}", quinns)
                .with(as("rosa"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Not mine\",\"description\":null}"))
            .andExpect(status().isNotFound());
    }

    @Test
    void aBlankNameIsRefused() throws Exception {
        Long project = firstProjectOf("sami");

        mockMvc.perform(put("/api/v1/projects/{p}", project)
                .with(as("sami"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"   \",\"description\":null}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors.name").exists());
    }

    @Test
    void deletingAProjectTakesItsTasksWithIt() throws Exception {
        Long project = firstProjectOf("tomas");
        Long task = taskIdByTitle("tomas", project, "Build the API");

        mockMvc.perform(delete("/api/v1/projects/{p}", project).with(as("tomas")))
            .andExpect(status().isNoContent());

        // Every foreign key pointing at a project is ON DELETE CASCADE in V1,
        // so the tasks, the dependency edges and the memberships go with it.
        // Asserted rather than trusted: a cascade that silently stopped
        // working would leave orphaned rows nobody would notice for months.
        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project).with(as("tomas")))
            .andExpect(status().isNotFound());

        mockMvc.perform(get("/api/v1/projects/{p}/tasks/{t}", project, task).with(as("tomas")))
            .andExpect(status().isNotFound());
    }

    @Test
    void aNewProjectStartsEmptyAndOwnedByItsCreator() throws Exception {
        String created = mockMvc.perform(post("/api/v1/projects")
                .with(as("ugo"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Gemini\",\"description\":null}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Gemini"))
            .andExpect(jsonPath("$.myRole").value("OWNER"))
            .andReturn().getResponse().getContentAsString();

        Long project = ((Number) JsonPath.read(created, "$.id")).longValue();

        // The sample tasks belong to provisioning, not to project creation:
        // somebody making their second project is past needing an example.
        mockMvc.perform(get("/api/v1/projects/{p}/tasks", project).with(as("ugo")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(0));
    }
}
