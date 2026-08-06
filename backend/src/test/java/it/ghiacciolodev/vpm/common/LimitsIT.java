package it.ghiacciolodev.vpm.common;

import it.ghiacciolodev.vpm.AbstractIT;
import it.ghiacciolodev.vpm.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * The ceilings on how much one account can create.
 *
 * Set absurdly low here for the same reason the rate-limit suite sets three
 * writes a minute: a test that had to create two thousand tasks to reach the
 * real limit would be testing the machine rather than the rule.
 *
 * These are not authorisation. The rate limiter already answers "how fast",
 * and at 120 writes a minute the answer to "how much" was "for ever", which
 * with open registration is a way to fill a disk for the price of an email
 * address.
 */
@TestPropertySource(properties = {
    "app.limits.tasks-per-project=2",
    "app.limits.members-per-project=2",
    "app.limits.projects-per-user=2",
})
class LimitsIT extends AbstractIT {

    @Autowired
    UserRepository users;

    private static final String TASK = """
        {"title":"%s","status":"TODO","priority":"LOW",
         "startDate":"2026-09-01","endDate":"2026-09-02","color":"#3B82F6"}""";

    /* --- tasks ----------------------------------------------------------- */

    @Test
    void refusesTaskThatWouldPassTheCeiling() throws Exception {
        Long project = newProject("lim-ann", "Full");

        newTask("lim-ann", project, "One", "TODO",
            LocalDate.parse("2026-09-01"), LocalDate.parse("2026-09-02"));
        newTask("lim-ann", project, "Two", "TODO",
            LocalDate.parse("2026-09-03"), LocalDate.parse("2026-09-04"));

        mockMvc.perform(post("/api/v1/projects/{p}/tasks", project)
                .with(as("lim-ann"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(TASK.formatted("Three")))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.detail").value(
                org.hamcrest.Matchers.containsString("limit of 2 tasks")));
    }

    @Test
    void stillLetsAFullProjectBeEdited() throws Exception {
        // The ceiling is checked on create only. An update cannot grow the
        // plan, and refusing one because the project is already full would trap
        // somebody at exactly the moment they are trying to tidy up.
        Long project = newProject("lim-bert", "Full but editable");

        Long first = newTask("lim-bert", project, "One", "TODO",
            LocalDate.parse("2026-09-01"), LocalDate.parse("2026-09-02"));
        newTask("lim-bert", project, "Two", "TODO",
            LocalDate.parse("2026-09-03"), LocalDate.parse("2026-09-04"));

        mockMvc.perform(put("/api/v1/projects/{p}/tasks/{t}", project, first)
                .with(as("lim-bert"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(TASK.formatted("One, renamed")))
            .andExpect(status().isOk());
    }

    @Test
    void aDeletedTaskGivesItsPlaceBack() throws Exception {
        // Soft-deleted rows stay in the table. Counting them would mean a
        // project that has hit the ceiling can never get back under it, and
        // deleting a task is the only remedy the interface offers.
        Long project = newProject("lim-cate", "Recoverable");

        Long first = newTask("lim-cate", project, "One", "TODO",
            LocalDate.parse("2026-09-01"), LocalDate.parse("2026-09-02"));
        newTask("lim-cate", project, "Two", "TODO",
            LocalDate.parse("2026-09-03"), LocalDate.parse("2026-09-04"));

        mockMvc.perform(delete("/api/v1/projects/{p}/tasks/{t}", project, first)
                .with(as("lim-cate")))
            .andExpect(status().isNoContent());

        mockMvc.perform(post("/api/v1/projects/{p}/tasks", project)
                .with(as("lim-cate"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(TASK.formatted("Three")))
            .andExpect(status().isCreated());
    }

    /* --- projects -------------------------------------------------------- */

    @Test
    void refusesAThirdProject() throws Exception {
        newProject("lim-dana", "One");
        newProject("lim-dana", "Two");

        mockMvc.perform(post("/api/v1/projects")
                .with(as("lim-dana"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"name": "Three", "description": null}"""))
            .andExpect(status().isConflict());
    }

    @Test
    void countsMembershipRatherThanOwnership() throws Exception {
        // Counting what somebody created is walked around by making a project,
        // handing it over and making another. Being *in* two projects is the
        // limit, however you came to be in them.
        Long hosted = newProject("lim-evan", "Somebody else's");
        mockMvc.perform(post("/api/v1/projects/{p}/members", hosted)
                .with(as("lim-evan"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"email": "lim-fern@example.com", "role": "EDITOR"}"""))
            .andExpect(status().isOk());

        // Fern is now in one project without having created any.
        newProject("lim-fern", "Their own");

        mockMvc.perform(post("/api/v1/projects")
                .with(as("lim-fern"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"name": "One too many", "description": null}"""))
            .andExpect(status().isConflict());
    }

    /* --- members --------------------------------------------------------- */

    @Test
    void refusesAMemberPastTheCeilingWithoutCreatingTheAccount() throws Exception {
        Long project = newProject("lim-gale", "Crowded");

        // The owner is already one of the two.
        mockMvc.perform(post("/api/v1/projects/{p}/members", project)
                .with(as("lim-gale"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"email": "lim-hana@example.com", "role": "VIEWER"}"""))
            .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/projects/{p}/members", project)
                .with(as("lim-gale"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"email": "never-invited@example.com", "role": "VIEWER"}"""))
            .andExpect(status().isConflict());

        // The check runs before the lookup, so a refused invitation is not a
        // way of writing rows into the users table for arbitrary addresses.
        assertThat(users.findByEmail("never-invited@example.com")).isEmpty();
    }
}
