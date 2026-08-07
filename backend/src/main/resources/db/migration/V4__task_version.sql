-- =====================================================================
-- V4: a version column, because the timestamp could not do the job
--
-- Concurrency was checked by comparing the updated_at a client last saw
-- against the one on the row. The check itself was right; where it broke
-- was on the way out. @UpdateTimestamp is written during a flush, and
-- the response was assembled before any flush was guaranteed, so a PUT
-- handed back the timestamp the row had *before* the write. A client
-- that saved that value and sent it on the next edit was refused with
-- "somebody else changed this task" when nobody had.
--
-- Measured rather than reasoned about: two consecutive edits of the same
-- task, each using the timestamp the previous response returned, ended
-- in 409 both when the task had an assignee and when it did not.
--
-- A version column moves the check to where Hibernate already handles
-- it. @Version is incremented in memory as part of the flush and
-- travels in the UPDATE's WHERE clause, so the database refuses a stale
-- write even if the application forgets to look.
-- =====================================================================

ALTER TABLE tasks
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0;

-- The default covers every row that already exists. New rows get 0 from
-- Hibernate on insert and count up from there.
