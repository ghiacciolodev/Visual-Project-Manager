-- =====================================================================
-- V2: who changed what
--
-- A plan that several people can edit needs to be able to answer "who
-- moved this?" — and the schedule itself cannot, because it only ever
-- holds the current state. Tasks are soft-deleted precisely so their
-- history stays referenceable; this is where the history goes.
-- =====================================================================

CREATE TABLE audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Every entry belongs to a project, which is also how it is read
    -- back: the log is scoped by the same membership check as the plan
    -- it describes. Cascade, because a deleted project's history is not
    -- something anybody is left able to look at.
    project_id  BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- SET NULL rather than CASCADE: an account being removed must not
    -- erase the record of what that person did. The name is copied
    -- alongside for the same reason — the log has to stay readable
    -- after the row it points at is gone.
    actor_id    BIGINT       REFERENCES users(id) ON DELETE SET NULL,
    actor_name  VARCHAR(120) NOT NULL,

    entity_type VARCHAR(16)  NOT NULL,
    -- Null for an entity that no longer exists, or never had an id of
    -- its own.
    entity_id   BIGINT,
    action      VARCHAR(16)  NOT NULL,

    -- What changed, in words, written at the point of the change. A
    -- generic listener could say that a task was updated; only the code
    -- doing the updating knows it moved from the 1st to the 5th.
    summary     VARCHAR(500) NOT NULL,

    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT chk_audit_action CHECK (action IN ('CREATE', 'UPDATE', 'DELETE')),
    CONSTRAINT chk_audit_entity CHECK (entity_type IN ('PROJECT', 'TASK', 'MEMBER', 'DEPENDENCY'))
);

-- The only query this table serves: one project's entries, newest first.
CREATE INDEX idx_audit_project_time ON audit_log (project_id, created_at DESC);
