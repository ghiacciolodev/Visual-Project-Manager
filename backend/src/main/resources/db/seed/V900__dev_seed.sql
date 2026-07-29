-- =====================================================================
-- V900: development data.
--
-- Loaded only under the "dev" profile (see spring.flyway.locations in
-- application.yml). Production never includes this folder.
--
-- Project id 1 acts as a placeholder until authentication exists: in
-- phases 1-4 the backend works against a fixed projectId. When Keycloak
-- lands, that fixed value is replaced by the authenticated user's
-- project and nothing else changes.
--
-- Version 900 leaves room for the real migrations to grow underneath
-- without ever colliding with the seed.
-- =====================================================================

INSERT INTO users (email, display_name)
VALUES ('dev@localhost', 'Development User');

INSERT INTO projects (name, description, created_by)
VALUES ('Demo Project', 'Sample data for local development', 1);

INSERT INTO project_members (project_id, user_id, role)
VALUES (1, 1, 'OWNER');

-- Dates are relative to CURRENT_DATE so the Gantt is always populated
-- around today, no matter when the project is cloned.
INSERT INTO tasks (project_id, title, status, priority, start_date, end_date, color)
VALUES
    (1, 'Database Setup',  'DONE',  'HIGH',   CURRENT_DATE,     CURRENT_DATE + 4,  '#EF4444'),
    (1, 'API Development', 'DOING', 'MEDIUM', CURRENT_DATE + 3, CURRENT_DATE + 11, '#3B82F6'),
    (1, 'Frontend UI',     'TODO',  'MEDIUM', CURRENT_DATE + 9, CURRENT_DATE + 19, '#22C55E');

-- A short chain: 1 -> 2 -> 3. Enough to exercise blocking rules and the
-- critical path once those exist.
INSERT INTO task_dependencies (predecessor_id, successor_id)
VALUES (1, 2), (2, 3);