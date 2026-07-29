-- =====================================================================
-- V1: initial schema
--
-- Design note: the schema is multi-project and multi-user from day one,
-- even though authentication and authorisation only arrive in phase 5.
-- Reason: adding project_id and ownership later would mean rewriting
-- every query. Authorisation rules are easy to add afterwards;
-- structural columns are not.
-- =====================================================================

CREATE TABLE users (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    keycloak_sub VARCHAR(64) UNIQUE,          -- NULL until Keycloak lands
    email        VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE projects (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    description TEXT,
    created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Roles are per project, not global: the same user can own project A
-- and only read project B. This is what makes authorisation non-trivial
-- and worth demonstrating.
CREATE TABLE project_members (
    project_id BIGINT      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    role       VARCHAR(16) NOT NULL,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id),
    CONSTRAINT chk_member_role CHECK (role IN ('OWNER', 'EDITOR', 'VIEWER'))
);

CREATE TABLE tasks (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id  BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       VARCHAR(120) NOT NULL,
    description TEXT,
    status      VARCHAR(16)  NOT NULL DEFAULT 'TODO',
    priority    VARCHAR(16)  NOT NULL DEFAULT 'MEDIUM',
    start_date  DATE         NOT NULL,
    end_date    DATE         NOT NULL,
    color       CHAR(7)      NOT NULL DEFAULT '#3B82F6',
    assignee_id BIGINT       REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- Soft delete: keeps dependency references intact and leaves room
    -- for a history view later.
    deleted_at  TIMESTAMPTZ,

    -- Integrity rules live in the database, the one place nobody can
    -- bypass them: not an application bug, not a manual INSERT.
    CONSTRAINT chk_task_dates    CHECK (end_date >= start_date),
    CONSTRAINT chk_task_status   CHECK (status   IN ('TODO', 'DOING', 'DONE')),
    CONSTRAINT chk_task_priority CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
    CONSTRAINT chk_task_color    CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

-- The Gantt view always reads by project ordered by start date.
CREATE INDEX idx_tasks_project_start ON tasks (project_id, start_date);
-- Partial index: soft-deleted rows are never listed, so keep them out.
CREATE INDEX idx_tasks_project_alive ON tasks (project_id) WHERE deleted_at IS NULL;

CREATE TABLE task_dependencies (
    predecessor_id BIGINT      NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    successor_id   BIGINT      NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (predecessor_id, successor_id),

    -- Self-loops are stopped here. Longer cycles cannot be: they need a
    -- recursive CTE and an application-level check (phase 3).
    CONSTRAINT chk_no_self_loop CHECK (predecessor_id <> successor_id)
);

-- Traversing the graph backwards ("what blocks this task?") is the most
-- frequent query, and the primary key only indexes the forward direction.
CREATE INDEX idx_deps_successor ON task_dependencies (successor_id);