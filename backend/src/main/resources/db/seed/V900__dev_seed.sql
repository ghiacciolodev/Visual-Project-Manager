-- =====================================================================
-- V900: dati di sviluppo.
--
-- Caricato SOLO con il profilo "dev" (vedi spring.flyway.locations in
-- application.yml). In produzione questa cartella non viene inclusa.
--
-- Il progetto con id 1 fa da segnaposto finche' non c'e' l'autenticazione:
-- in fase 1-4 il backend lavora su un projectId fisso. Quando arriva
-- Keycloak, il valore fisso viene sostituito dal progetto dell'utente
-- autenticato e nient'altro cambia.
-- =====================================================================

INSERT INTO users (email, display_name)
VALUES ('dev@localhost', 'Utente Sviluppo');

INSERT INTO projects (name, description, created_by)
VALUES ('Progetto Demo', 'Dati di esempio per lo sviluppo locale', 1);

INSERT INTO project_members (project_id, user_id, role)
VALUES (1, 1, 'OWNER');

INSERT INTO tasks (project_id, title, status, priority, start_date, end_date, color)
VALUES
    (1, 'Database Setup',  'DONE',  'HIGH',   CURRENT_DATE,     CURRENT_DATE + 4,  '#EF4444'),
    (1, 'API Development', 'DOING', 'MEDIUM', CURRENT_DATE + 3, CURRENT_DATE + 11, '#3B82F6'),
    (1, 'Frontend UI',     'TODO',  'MEDIUM', CURRENT_DATE + 9, CURRENT_DATE + 19, '#22C55E');

INSERT INTO task_dependencies (predecessor_id, successor_id)
VALUES (1, 2), (2, 3);