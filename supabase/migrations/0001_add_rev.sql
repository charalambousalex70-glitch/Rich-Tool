-- 0001 — give user_state a revision to check saves against.
--
-- Run this in the Supabase SQL editor against a database that already has the
-- table. schema.sql is the end state and its `create table if not exists` will
-- not touch a table that is already there, so an existing database gets the
-- column from here.
--
-- Why: the client used to save the whole document unconditionally. A tab left
-- open since the morning would post its stale copy over everything a second
-- tab had done since, and both said "All changes saved". Saves are now
-- `where user_id = ... and rev = <the revision that tab read>`, so the stale
-- one changes no rows and the user is asked which version to keep.
--
-- Safe to run more than once, and safe to run on a live database: existing
-- rows get rev 0, which is exactly what a client reads back and sends with its
-- next save. There is no window in which saves fail — a client that has not
-- been deployed yet ignores the column, and a client that has been deployed
-- before this ran detects the missing column and falls back to the old
-- unconditional write.

alter table public.user_state
  add column if not exists rev bigint not null default 0;
