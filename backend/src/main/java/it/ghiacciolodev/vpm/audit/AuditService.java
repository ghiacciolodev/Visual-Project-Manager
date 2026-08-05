package it.ghiacciolodev.vpm.audit;

import it.ghiacciolodev.vpm.audit.dto.AuditEntryResponse;
import it.ghiacciolodev.vpm.security.CurrentUser;
import it.ghiacciolodev.vpm.user.User;
import org.springframework.data.domain.Limit;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Records who changed what, and reads it back.
 *
 * Written from the service methods that make the changes, rather than by a
 * JPA entity listener or an aspect. Both of those were considered and both
 * are worse here.
 *
 * A listener firing on @PostPersist runs inside the flush that is persisting
 * the entity, and persisting a second entity from there is not something the
 * same EntityManager will do — it would need its own transaction, at which
 * point a rolled-back change leaves a log entry saying it happened.
 *
 * An aspect avoids that and keeps the write paths clean, but it can only see
 * that a method was called and what it was handed. It can say a task was
 * updated. It cannot say the task moved from the 1st to the 5th, because
 * working that out means holding the previous state, which only the method
 * doing the update has. A history that says "somebody changed something" is
 * a table nobody opens twice.
 *
 * Being inside the caller's transaction is the other half of it: a change
 * that rolls back takes its entry with it, so the log cannot claim something
 * happened that did not.
 */
@Service
@Transactional(readOnly = true)
public class AuditService {

    /**
     * How much history one request returns.
     *
     * The screen is a recent-activity list rather than an archive, and an
     * unbounded read of a busy project's whole history is a slow query nobody
     * asked for.
     */
    private static final int PAGE = 200;

    private final AuditRepository repository;
    private final CurrentUser currentUser;

    public AuditService(AuditRepository repository, CurrentUser currentUser) {
        this.repository = repository;
        this.currentUser = currentUser;
    }

    /**
     * Any member may read the history of their own project.
     *
     * Not owners only. The log answers "who moved this?", which is a question
     * anybody working from the plan has, and restricting it would leave the
     * people affected by a change unable to see who made it.
     */
    @PreAuthorize("@access.canView(#projectId)")
    public List<AuditEntryResponse> findFor(Long projectId) {
        return repository
            .findByProjectIdOrderByCreatedAtDescIdDesc(projectId, Limit.of(PAGE))
            .stream()
            .map(AuditEntryResponse::from)
            .toList();
    }

    /* --- writing -------------------------------------------------------- */

    /**
     * Adds an entry, attributed to whoever is making the current request.
     *
     * No @PreAuthorize: this is never reached from a controller. It is called
     * by methods that have already been through their own check, and a guard
     * here would run the membership query a second time on every write.
     */
    @Transactional
    public void record(Long projectId, AuditEntity entityType, Long entityId,
                       AuditAction action, String summary) {

        User actor = currentUser.require();

        AuditEntry entry = new AuditEntry();
        entry.setProjectId(projectId);
        entry.setActorId(actor.getId());
        entry.setActorName(actor.getDisplayName());
        entry.setEntityType(entityType);
        entry.setEntityId(entityId);
        entry.setAction(action);
        entry.setSummary(abbreviate(summary));

        repository.save(entry);
    }

    /**
     * Keeps a summary inside the column.
     *
     * Task titles are capped at 120 characters and a summary can hold two of
     * them plus a pair of dates, which fits — until somebody writes one by
     * concatenating a list. Truncating is better than a constraint violation
     * that rolls back the change the entry was describing.
     */
    private String abbreviate(String summary) {
        return summary.length() <= 500 ? summary : summary.substring(0, 497) + "…";
    }
}
