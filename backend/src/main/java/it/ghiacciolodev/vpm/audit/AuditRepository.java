package it.ghiacciolodev.vpm.audit;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AuditRepository extends JpaRepository<AuditEntry, Long> {

    /**
     * One project's history, newest first.
     *
     * The tie-break on id matters more than it looks: several entries can
     * share a timestamp, because one request often writes more than one — and
     * without it their order between page loads is whatever the database
     * happens to return.
     */
    List<AuditEntry> findByProjectIdOrderByCreatedAtDescIdDesc(Long projectId, Limit limit);
}
