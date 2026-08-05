-- =====================================================================
-- V3: the other direction of the membership table
--
-- The primary key is (project_id, user_id), which serves "who is in
-- this project" and cannot serve "which projects is this person in" —
-- a composite index is only usable from its leading column. That second
-- question is asked on every sign-in and on every page load that
-- populates the project picker, and until now it was answered by
-- reading the entire table into memory and filtering there.
-- =====================================================================

CREATE INDEX idx_members_user ON project_members (user_id);
