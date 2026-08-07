package it.ghiacciolodev.vpm.security;

import it.ghiacciolodev.vpm.AbstractIT;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Who gets to inherit an invitation.
 *
 * Inviting somebody who has never signed in creates a placeholder row holding
 * their address and their membership. The first login that presents that
 * address claims it, which is what turns an invitation into a working account
 * rather than a duplicate.
 *
 * That claim is the whole of the risk. Registration on the realm is open, so
 * if the address alone were enough, the sequence would be: read that
 * somebody@example.com has been invited as an owner, register with it, sign in
 * once, and own their project. The realm requires the address to be verified
 * and this checks that the application does not take Keycloak's word for it.
 */
class PlaceholderClaimIT extends AbstractIT {

    private Long inviteTo(String owner, String projectName, String email) throws Exception {
        Long project = newProject(owner, projectName);

        mockMvc.perform(post("/api/v1/projects/{p}/members", project)
                .with(as(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"%s\",\"role\":\"OWNER\"}".formatted(email)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.signedUp").value(false));

        return project;
    }

    @Test
    void averifiedAddressClaimsTheInvitation() throws Exception {
        Long project = inviteTo("pc-ada", "Handover", "pc-bea@example.com");

        // Bea signs in for the first time, with the address verified. She
        // should find the project waiting for her rather than an empty
        // account.
        mockMvc.perform(get("/api/v1/projects").with(as("pc-bea")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].id").value(project))
            .andExpect(jsonPath("$[0].myRole").value("OWNER"));
    }

    @Test
    void anUnverifiedAddressIsRefusedRatherThanGivenTheInvitation() throws Exception {
        inviteTo("pc-cass", "Not yours", "pc-dev@example.com");

        // Same address, and the identity provider has not confirmed that this
        // person holds it. Claiming the row is the takeover; inserting beside
        // it breaks the unique constraint and answers 500 with no explanation.
        // So it is refused, with the instruction that resolves it.
        mockMvc.perform(get("/api/v1/projects").with(as("pc-dev", false)))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.detail").value(
                org.hamcrest.Matchers.containsString("Confirm your email address")));
    }

    @Test
    void anUnverifiedAddressNobodyInvitedIsStillAnOrdinaryNewAccount() throws Exception {
        // Nothing to inherit and nothing to collide with. Verification governs
        // who may claim an existing row, not who may have an account.
        mockMvc.perform(get("/api/v1/projects").with(as("pc-gus", false)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void theInvitationStaysAvailableForWhoeverVerifiesLater() throws Exception {
        Long project = inviteTo("pc-eli", "Patience", "pc-fay@example.com");

        // A refusal must not consume the invitation.
        mockMvc.perform(get("/api/v1/projects").with(as("pc-fay", false)))
            .andExpect(status().isConflict());

        // Still waiting, still unclaimed.
        mockMvc.perform(get("/api/v1/projects/{p}/members", project).with(as("pc-eli")))
            .andExpect(jsonPath("$[?(@.email == 'pc-fay@example.com')].signedUp")
                .value(org.hamcrest.Matchers.hasItem(false)));

        // And the person who does hold the address gets it once verified.
        mockMvc.perform(get("/api/v1/projects").with(as("pc-fay")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value(project));
    }
}
