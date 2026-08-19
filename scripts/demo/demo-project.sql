-- =====================================================================
-- The demo plan: "Storefront Relaunch"
--
-- Written straight into the application database rather than driven
-- through the API, because a seed has to be able to say things the API
-- deliberately will not: that a task was created five weeks ago, that
-- somebody changed a date on a Tuesday in July, that this project has a
-- history. Every one of those timestamps is server-owned for good
-- reasons — see TaskRequest, which refuses id, projectId and timestamps
-- from a client — so a seed that went through HTTP would produce a plan
-- where all fifteen tasks and all sixteen history entries happened in
-- the same second.
--
-- The people are fictional. The domain is `.example`, which is reserved
-- by RFC 2606 precisely so that documentation cannot accidentally name
-- somebody's real mailbox.
--
-- Run it through scripts/demo/seed.ps1, which creates the matching
-- Keycloak accounts first and passes their subject ids in. Running this
-- file on its own would leave four users nobody can sign in as.
--
-- Re-runnable: the two DELETEs at the top take the previous run with
-- them, and every foreign key that points at a project cascades.
-- =====================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Everything the demo people can reach, not only the project written
-- below. A visitor signs in as Harriet and is free to create projects of
-- their own, and matching on the name alone would leave those standing
-- for the next visitor to find on the same account.
--
-- Order matters. Projects first, so the cascade clears tasks,
-- memberships and history while the memberships that identify them still
-- exist. The other way round there would be nothing left to match on.
DELETE FROM projects p
 WHERE EXISTS (SELECT 1
                 FROM project_members m
                 JOIN users u ON u.id = m.user_id
                WHERE m.project_id = p.id
                  AND u.email LIKE '%@northwind.example');

DELETE FROM users WHERE email LIKE '%@northwind.example';

-- And the ones earlier runs left behind. projects.created_by is ON
-- DELETE SET NULL while project_members.user_id is ON DELETE CASCADE, so
-- deleting the demo people turned any project of theirs into one with no
-- owner and no members: unreachable through the application, and
-- permanent, because nothing else ever looks for it. A project nobody is
-- a member of cannot be opened by anyone, which makes this safe to run
-- against a database that has other things in it.
DELETE FROM projects p
 WHERE NOT EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id);

-- And the people somebody invited. The members panel takes an address rather
-- than picking from a list, because an invitation that only works for people
-- who already have an account is not much of an invitation; the row it writes
-- has no keycloak_sub until they sign in and claim it. On a public demo that
-- row can hold a real address belonging to someone who never asked to be
-- here, typed in by a stranger, and until this ran it outlived every reset
-- because it is not a @northwind.example address and no project points at it
-- any more.
--
-- No keycloak_sub means nobody has ever signed in as them. No membership
-- means they are attached to nothing. Together that is an invitation nobody
-- took up, and there is nothing in it worth keeping.
DELETE FROM users u
 WHERE u.keycloak_sub IS NULL
   AND NOT EXISTS (SELECT 1 FROM project_members m WHERE m.user_id = u.id);

INSERT INTO users (keycloak_sub, email, display_name) VALUES
    (:'sub_harriet', 'harriet.vance@northwind.example',   'Harriet Vance'),
    (:'sub_marcus',  'marcus.bell@northwind.example',     'Marcus Bell'),
    (:'sub_priya',   'priya.raghavan@northwind.example',  'Priya Raghavan'),
    (:'sub_tom',     'tom.iversen@northwind.example',     'Tom Iversen');

INSERT INTO projects (name, description, created_by)
SELECT :'project_name',
       'Rebuilding the public storefront on the new catalogue service, '
       'ending in a single cutover weekend at the start of October.',
       id
FROM users WHERE email = 'harriet.vance@northwind.example';

-- Referenced from every statement below. A subselect on a unique-ish
-- name rather than currval(), which would break the moment somebody
-- pasted these statements in a different order.
CREATE TEMPORARY VIEW demo_project AS
SELECT id FROM projects WHERE name = :'project_name';


-- --- who is in it ----------------------------------------------------
--
-- One of each role, because the roles are the interesting part: Tom can
-- read the plan and nothing else, which is what makes the disabled
-- controls in the interface worth photographing.

INSERT INTO project_members (project_id, user_id, role, joined_at)
SELECT (SELECT id FROM demo_project), u.id, m.role, now() - m.ago
FROM (VALUES
    ('harriet.vance@northwind.example',  'OWNER',  INTERVAL '34 days'),
    ('marcus.bell@northwind.example',    'EDITOR', INTERVAL '34 days'),
    ('priya.raghavan@northwind.example', 'EDITOR', INTERVAL '33 days'),
    ('tom.iversen@northwind.example',    'VIEWER', INTERVAL '26 days')
) AS m(email, role, ago)
JOIN users u ON u.email = m.email;


-- --- the plan --------------------------------------------------------
--
-- Fifteen tasks over thirteen weeks, arranged so that the schedule says
-- something true about a project of this kind: the discovery work is
-- finished, three streams are running at once, and everything after
-- mid-September is still a guess.
--
-- Colours group the streams — violet for shaping the work, blue for the
-- services behind it, pink for the interface, amber for content, green
-- for the launch itself.

INSERT INTO tasks (project_id, title, description, status, priority,
                   start_date, end_date, color, assignee_id,
                   created_at, updated_at)
SELECT (SELECT id FROM demo_project),
       t.title, t.description, t.status, t.priority,
       t.start_date, t.end_date, t.color, u.id,
       now() - t.age, now() - t.touched
FROM (VALUES
    ('Discovery and analytics review',
     'Twelve months of funnel data, session recordings and the top forty support tickets, read together to decide what the rebuild is actually for.',
     'DONE',  'HIGH',   DATE '2026-07-06', DATE '2026-07-17', '#8B5CF6',
     'harriet.vance@northwind.example', INTERVAL '34 days', INTERVAL '20 days'),

    ('Content audit',
     'Every page on the current storefront, sorted into keep, rewrite and drop. The drop column turned out to be the longest.',
     'DONE',  'MEDIUM', DATE '2026-07-13', DATE '2026-07-24', '#F59E0B',
     'tom.iversen@northwind.example', INTERVAL '33 days', INTERVAL '13 days'),

    ('Information architecture',
     'New category tree and URL scheme, with redirects mapped from the old paths so search rankings survive the move.',
     'DONE',  'HIGH',   DATE '2026-07-20', DATE '2026-07-31', '#8B5CF6',
     'priya.raghavan@northwind.example', INTERVAL '33 days', INTERVAL '6 days'),

    ('Design system refresh',
     'Type scale, colour tokens and the component set the new templates are built from. Contrast is checked against WCAG AA as part of the definition of done, not afterwards.',
     'DOING', 'HIGH',   DATE '2026-08-03', DATE '2026-08-21', '#EC4899',
     'priya.raghavan@northwind.example', INTERVAL '30 days', INTERVAL '2 days'),

    ('Checkout API contract',
     'The request and response shapes the storefront will call, agreed with the payments team and frozen before anybody builds against them.',
     'DOING', 'HIGH',   DATE '2026-08-03', DATE '2026-08-12', '#3B82F6',
     'marcus.bell@northwind.example', INTERVAL '30 days', INTERVAL '1 day'),

    ('Catalogue service migration',
     'Moving product data off the legacy database behind the new service, with both writing in parallel until the read path is proven.',
     'DOING', 'HIGH',   DATE '2026-08-13', DATE '2026-09-04', '#3B82F6',
     'marcus.bell@northwind.example', INTERVAL '29 days', INTERVAL '1 day'),

    ('Page templates',
     'Home, category, product and cart, built from the refreshed component set.',
     'TODO',  'MEDIUM', DATE '2026-08-24', DATE '2026-09-11', '#EC4899',
     'priya.raghavan@northwind.example', INTERVAL '27 days', INTERVAL '27 days'),

    ('Payment provider integration',
     'Card, wallet and the two regional methods, against the contract agreed in August. Sandbox first, live keys only after the rehearsal.',
     'TODO',  'HIGH',   DATE '2026-09-07', DATE '2026-09-18', '#3B82F6',
     'marcus.bell@northwind.example', INTERVAL '27 days', INTERVAL '27 days'),

    ('Search and filtering',
     'Faceted search over the new catalogue, including the synonym list the support tickets asked for.',
     'TODO',  'MEDIUM', DATE '2026-09-07', DATE '2026-09-16', '#3B82F6',
     'marcus.bell@northwind.example', INTERVAL '26 days', INTERVAL '26 days'),

    ('Accessibility pass',
     'Keyboard paths, focus order and screen-reader labels across the four templates, with an external audit booked for the last two days.',
     'TODO',  'MEDIUM', DATE '2026-09-14', DATE '2026-09-22', '#EC4899',
     'priya.raghavan@northwind.example', INTERVAL '26 days', INTERVAL '26 days'),

    ('Analytics and consent',
     'Event plan for the new funnel, behind a consent banner that defaults to nothing being set.',
     'TODO',  'LOW',    DATE '2026-09-07', DATE '2026-09-15', '#F59E0B',
     'tom.iversen@northwind.example', INTERVAL '24 days', INTERVAL '24 days'),

    ('Content migration',
     'Rewriting and moving the four hundred pages the audit said to keep. Long, and almost entirely independent of everything else.',
     'TODO',  'MEDIUM', DATE '2026-09-01', DATE '2026-09-18', '#F59E0B',
     'tom.iversen@northwind.example', INTERVAL '24 days', INTERVAL '24 days'),

    ('Load and performance testing',
     'Black Friday traffic replayed against the staging environment, with a pass mark agreed in advance rather than argued about after.',
     'TODO',  'HIGH',   DATE '2026-09-21', DATE '2026-09-25', '#10B981',
     'marcus.bell@northwind.example', INTERVAL '20 days', INTERVAL '20 days'),

    ('Cutover rehearsal',
     'The whole switch performed against a copy of production, timed, and then rolled back. Anything that surprises us here is cheap; the same surprise on the 2nd is not.',
     'TODO',  'HIGH',   DATE '2026-09-28', DATE '2026-10-01', '#10B981',
     'harriet.vance@northwind.example', INTERVAL '20 days', INTERVAL '20 days'),

    ('Go live',
     'DNS moved to the new storefront, legacy left running and reachable for a week in case it has to take traffic back.',
     'TODO',  'HIGH',   DATE '2026-10-02', DATE '2026-10-02', '#10B981',
     'harriet.vance@northwind.example', INTERVAL '20 days', INTERVAL '20 days')
) AS t(title, description, status, priority,
       start_date, end_date, color, assignee_email, age, touched)
LEFT JOIN users u ON u.email = t.assignee_email;


-- --- what waits on what ----------------------------------------------
--
-- The chain that decides the launch date runs discovery → checkout
-- contract → catalogue migration → payments → load testing → rehearsal
-- → go live. Everything else hangs off it with real slack, which is what
-- makes the critical path worth drawing: a plan where every task is
-- critical is just a list.

INSERT INTO task_dependencies (predecessor_id, successor_id)
SELECT pre.id, suc.id
FROM (VALUES
    ('Discovery and analytics review', 'Information architecture'),
    ('Discovery and analytics review', 'Checkout API contract'),
    ('Information architecture',       'Design system refresh'),
    ('Content audit',                  'Content migration'),
    ('Design system refresh',          'Page templates'),
    ('Design system refresh',          'Analytics and consent'),
    ('Checkout API contract',          'Catalogue service migration'),
    ('Catalogue service migration',    'Payment provider integration'),
    ('Catalogue service migration',    'Search and filtering'),
    ('Page templates',                 'Accessibility pass'),
    ('Payment provider integration',   'Load and performance testing'),
    ('Load and performance testing',   'Cutover rehearsal'),
    ('Accessibility pass',             'Cutover rehearsal'),
    ('Content migration',              'Cutover rehearsal'),
    ('Cutover rehearsal',              'Go live')
) AS d(predecessor, successor)
JOIN tasks pre ON pre.project_id = (SELECT id FROM demo_project)
              AND pre.title = d.predecessor
JOIN tasks suc ON suc.project_id = (SELECT id FROM demo_project)
              AND suc.title = d.successor;


-- --- how it got this way ---------------------------------------------
--
-- The summaries are written in the same wording the application itself
-- produces — see TaskService.describeChange and ProjectService.invite —
-- so the history panel reads the same whether the entry came from here
-- or from somebody dragging a bar this afternoon.

INSERT INTO audit_log (project_id, actor_id, actor_name,
                       entity_type, entity_id, action, summary, created_at)
SELECT (SELECT id FROM demo_project),
       u.id, u.display_name,
       a.entity_type,
       -- Points at the task the entry is about where there is one to
       -- point at. Nothing renders it today; the column exists so a
       -- later "show me this task" link has something to use.
       t.id,
       a.action, a.summary, now() - a.ago
FROM (VALUES
    ('harriet.vance@northwind.example',  'PROJECT',    'CREATE', NULL,
     'Created "Storefront Relaunch"',                                       INTERVAL '34 days 6 hours'),
    ('harriet.vance@northwind.example',  'MEMBER',     'CREATE', NULL,
     'Added Marcus Bell as EDITOR',                                         INTERVAL '34 days 5 hours'),
    ('harriet.vance@northwind.example',  'MEMBER',     'CREATE', NULL,
     'Added Priya Raghavan as EDITOR',                                      INTERVAL '33 days 7 hours'),
    ('harriet.vance@northwind.example',  'TASK',       'CREATE', 'Discovery and analytics review',
     'Added "Discovery and analytics review", 2026-07-06 to 2026-07-17',    INTERVAL '33 days 6 hours'),
    ('tom.iversen@northwind.example',    'TASK',       'CREATE', 'Content audit',
     'Added "Content audit", 2026-07-13 to 2026-07-24',                     INTERVAL '32 days 4 hours'),
    ('priya.raghavan@northwind.example', 'TASK',       'CREATE', 'Information architecture',
     'Added "Information architecture", 2026-07-20 to 2026-07-31',          INTERVAL '31 days 2 hours'),
    ('harriet.vance@northwind.example',  'MEMBER',     'CREATE', NULL,
     'Added Tom Iversen as VIEWER',                                         INTERVAL '26 days 5 hours'),
    ('marcus.bell@northwind.example',    'DEPENDENCY', 'CREATE', 'Catalogue service migration',
     '"Catalogue service migration" now waits for "Checkout API contract"', INTERVAL '24 days 3 hours'),
    ('harriet.vance@northwind.example',  'TASK',       'UPDATE', 'Discovery and analytics review',
     '"Discovery and analytics review": DOING → DONE',                      INTERVAL '20 days 1 hour'),
    ('tom.iversen@northwind.example',    'TASK',       'UPDATE', 'Content audit',
     '"Content audit": DOING → DONE',                                       INTERVAL '13 days 8 hours'),
    ('priya.raghavan@northwind.example', 'TASK',       'UPDATE', 'Page templates',
     '"Page templates": moved to 2026-08-24 – 2026-09-11',                  INTERVAL '9 days 5 hours'),
    ('priya.raghavan@northwind.example', 'TASK',       'UPDATE', 'Information architecture',
     '"Information architecture": DOING → DONE',                            INTERVAL '6 days 3 hours'),
    ('harriet.vance@northwind.example',  'TASK',       'UPDATE', 'Accessibility pass',
     '"Accessibility pass": priority LOW → MEDIUM, assigned to Priya Raghavan', INTERVAL '4 days 6 hours'),
    ('priya.raghavan@northwind.example', 'TASK',       'UPDATE', 'Design system refresh',
     '"Design system refresh": moved to 2026-08-03 – 2026-08-21',           INTERVAL '2 days 2 hours'),
    ('marcus.bell@northwind.example',    'TASK',       'UPDATE', 'Catalogue service migration',
     '"Catalogue service migration": TODO → DOING',                         INTERVAL '1 day 4 hours'),
    ('marcus.bell@northwind.example',    'TASK',       'UPDATE', 'Checkout API contract',
     '"Checkout API contract": moved to 2026-08-03 – 2026-08-12',           INTERVAL '22 hours')
) AS a(actor_email, entity_type, action, task_title, summary, ago)
JOIN users u ON u.email = a.actor_email
LEFT JOIN tasks t ON t.project_id = (SELECT id FROM demo_project)
                 AND t.title = a.task_title;

COMMIT;

\echo ''
\echo 'Seeded:'
SELECT (SELECT count(*) FROM tasks
         WHERE project_id = (SELECT id FROM projects WHERE name = :'project_name')) AS tasks,
       (SELECT count(*) FROM task_dependencies d
          JOIN tasks t ON t.id = d.successor_id
         WHERE t.project_id = (SELECT id FROM projects WHERE name = :'project_name')) AS dependencies,
       (SELECT count(*) FROM project_members
         WHERE project_id = (SELECT id FROM projects WHERE name = :'project_name')) AS members,
       (SELECT count(*) FROM audit_log
         WHERE project_id = (SELECT id FROM projects WHERE name = :'project_name')) AS history;
