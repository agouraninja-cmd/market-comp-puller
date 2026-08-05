-- 014 · Link a published vault comp to its public copy (2026-08-05)
-- Plan: docs/superpowers/plans/2026-08-05-broker-vault-v1.md (step 2)
--
-- RUN BEFORE DEPLOYING the publish button. Verify with `node migrations/verify.js`.
--
-- Publishing a vault comp COPIES it into `comp_submissions` (the table the
-- verified-comp pipeline already reads) rather than opening any public read on
-- `broker_comps`. That keeps the privacy wall exactly where it was — but it
-- means the private row and its public copy are two separate rows, and nothing
-- connects them.
--
-- This column is that connection, and it exists for one reason: UNPUBLISH HAS
-- TO ACTUALLY WORK. Without a stored id the only way to find the public copy
-- is to match on broker email + address + deal date, which breaks the moment a
-- broker has also submitted the same property through the public form — and
-- the failure mode is the worst one available: a comp the broker believes they
-- retracted, still being offered to reports.
--
-- Nullable: null means "not published", which is every existing row.

alter table broker_comps
  add column if not exists published_submission_id bigint;

-- Finding "which vault comp is this public row?" is a reverse lookup done on
-- unpublish and nowhere else, but it is cheap and the table will grow.
create index if not exists broker_comps_published_submission_idx
  on broker_comps (published_submission_id)
  where published_submission_id is not null;

-- Verify (zero rows = applied):
--   select 1 where not exists (
--     select 1 from information_schema.columns
--     where table_name = 'broker_comps' and column_name = 'published_submission_id');
