package it.ghiacciolodev.vpm.common.limits;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Ceilings on how much one account can create.
 *
 * The rate limiter answers "how fast", and it turns out that is only half the
 * question. At 120 writes a minute one signed-in account can add somewhere
 * around a hundred and seventy thousand rows a day, indefinitely, and nothing
 * anywhere says stop. Registration is open, so that account costs an email
 * address. The two facts are harmless separately and are a way to fill a disk
 * together.
 *
 * These are not security boundaries in the way an authorisation check is. They
 * are the difference between an accident that is noticed and one that is not,
 * and between abuse that costs a day and abuse that costs a mount point.
 *
 * The numbers are deliberately far above any honest use. A plan of two
 * thousand tasks is already past the point where this application's rendering
 * is the thing to fix; a hundred projects is more than anybody is tracking at
 * once. Anyone who genuinely needs more changes one line of configuration,
 * which is exactly the property a limit should have.
 */
@ConfigurationProperties(prefix = "app.limits")
public record LimitProperties(

    int tasksPerProject,
    int membersPerProject,

    /**
     * Projects one person may be a member of.
     *
     * Membership rather than ownership: counting what somebody created is
     * walked around by creating a project, handing it over and creating
     * another.
     */
    int projectsPerUser
) {

    public LimitProperties {
        if (tasksPerProject <= 0) tasksPerProject = 2000;
        if (membersPerProject <= 0) membersPerProject = 100;
        if (projectsPerUser <= 0) projectsPerUser = 100;
    }
}
