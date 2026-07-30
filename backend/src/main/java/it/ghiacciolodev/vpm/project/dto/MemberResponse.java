
package it.ghiacciolodev.vpm.project.dto;

import it.ghiacciolodev.vpm.project.ProjectRole;

public record MemberResponse(
    Long userId,
    String email,
    String displayName,
    ProjectRole role,

    /**
     * False for someone invited by email who has never signed in.
     *
     * Worth showing: an invitation that has not been taken up looks
     * exactly like a member who is simply quiet, and the difference
     * matters when you are wondering why nobody has done the work.
     */
    boolean signedUp
) {
}
