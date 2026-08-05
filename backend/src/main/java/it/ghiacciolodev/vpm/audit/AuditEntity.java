package it.ghiacciolodev.vpm.audit;

/** What kind of thing an entry is about. Mirrored by a CHECK constraint. */
public enum AuditEntity {
    PROJECT, TASK, MEMBER, DEPENDENCY
}
