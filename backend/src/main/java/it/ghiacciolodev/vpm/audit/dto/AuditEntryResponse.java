package it.ghiacciolodev.vpm.audit.dto;

import it.ghiacciolodev.vpm.audit.AuditAction;
import it.ghiacciolodev.vpm.audit.AuditEntity;
import it.ghiacciolodev.vpm.audit.AuditEntry;

import java.time.Instant;

/**
 * One line of history.
 *
 * actorId is absent because nothing needs it: the screen names people, and a
 * client that wanted to act on an account already has the member list. Note
 * that this is not a confidentiality measure — entityId carries the user id
 * on membership entries, and the member endpoint hands the same ids to anyone
 * who can read the project. Withholding it here would be theatre.
 */
public record AuditEntryResponse(
    Long id,
    String actorName,
    AuditEntity entityType,
    Long entityId,
    AuditAction action,
    String summary,
    Instant at
) {

    public static AuditEntryResponse from(AuditEntry entry) {
        return new AuditEntryResponse(
            entry.getId(),
            entry.getActorName(),
            entry.getEntityType(),
            entry.getEntityId(),
            entry.getAction(),
            entry.getSummary(),
            entry.getCreatedAt());
    }
}
