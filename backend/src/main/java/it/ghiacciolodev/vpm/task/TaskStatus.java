package it.ghiacciolodev.vpm.task;

/**
 * Values are persisted as text (see @Enumerated(STRING) on the entity) and are
 * mirrored by a CHECK constraint in V1__init.sql. If you add a value here, add
 * it to the constraint too — the database is the last line of defence.
 */
public enum TaskStatus {
    TODO,
    DOING,
    DONE
}
