package it.ghiacciolodev.vpm.task.dto;

import it.ghiacciolodev.vpm.user.User;

/**
 * The person a task is assigned to, as much of them as a schedule needs.
 *
 * The name travels with the task rather than the client resolving an id
 * against the member list. Reading the plan and administering it are separate
 * powers — an editor can see every task but has no reason to fetch the roster
 * — and a card that could only name its assignee after a second request would
 * show a bare number to exactly the people doing the work.
 */
public record AssigneeRef(Long id, String displayName) {

    public static AssigneeRef of(User user) {
        return new AssigneeRef(user.getId(), user.getDisplayName());
    }
}
