-- 038 · Lease dates, so a renewal can be watched (2026-08-22)
-- Plan:  docs/superpowers/plans/2026-08-21-divide-and-conquer-to-aug-27.md (O4)
-- Rules: broker-vault.js (parsing and refusal), renewal-watch.js (the copy and
--        the "is this worth sending?" rule)
--
-- ---------------------------------------------------------------------------
-- RUN THIS BEFORE DEPLOYING. It is 030's hazard, not 031's.
-- ---------------------------------------------------------------------------
-- The vault's READ path passes no `select=` and so cannot name a column that
-- does not exist. Its WRITE path can and does: `normalizeRow` always emits
-- every field it knows about, null included, so the moment the new code ships
-- an upload, an inline cell edit and a hand-added comp all POST a payload
-- naming `lease_expiry` and `option_notice_date`. PostgREST 400s an insert on
-- an unknown column, and on the upload path that refuses the broker's WHOLE
-- spreadsheet — the shape of the 004 outage. Deploy-then-migrate therefore
-- costs a broker their import, not merely the new feature.
--
-- ---------------------------------------------------------------------------
-- WHY THESE LIVE ON broker_comps AND NOT IN A TABLE OF THEIR OWN
-- ---------------------------------------------------------------------------
-- Owen's call, 2026-08-22. A lease a broker wants to be reminded about is,
-- in practice, a lease they already keep — the tenant rep who negotiated it
-- has it in their book as a lease comp with its rent, its basis and its
-- structure (029). A separate `lease_watches` table would be conceptually
-- tidier (a comp is a deal that closed, a watched lease is one still running)
-- and would make every broker type the same lease twice, which is the version
-- nobody keeps up to date. Filling these two cells IS the opt-in; leaving them
-- blank is a vault that behaves exactly as it does today.
--
-- ---------------------------------------------------------------------------
-- WHY THE MARKER IS A COLUMN HERE RATHER THAN A ROW SOMEWHERE ELSE
-- ---------------------------------------------------------------------------
-- `renewal_notified_at` is the high-water mark, and it is the same shape as
-- `watchlist_items.last_digest_at` (025) for the same reason: the thing that
-- was mailed about is the thing that records having been mailed about, so
-- there is no second table to fall out of step with this one. It is written
-- only by the digest run, is never in EDITABLE_FIELDS, and is deliberately
-- NOT part of the vault's API contract — a broker has no use for it and
-- `vault-api.js`'s allowlist is what keeps plumbing off the wire.
--
-- Nullable, like every column added to this table since 013, so the two
-- orderings differ only in what the new feature can do and never in whether
-- an existing vault works.

alter table broker_comps add column if not exists lease_expiry date;
alter table broker_comps add column if not exists option_notice_date date;
alter table broker_comps add column if not exists renewal_notified_at timestamptz;

-- The sweep's own index: rows that have a deadline and have not been mailed
-- about. Partial, because the overwhelming majority of a book is sales and
-- past leases, and a full index over every comp to find the handful with a
-- live deadline is the wrong shape. `user_id` leads because the run groups by
-- broker before it does anything else.
create index if not exists broker_comps_renewal_idx
  on broker_comps (user_id, option_notice_date)
  where option_notice_date is not null and renewal_notified_at is null;

-- The same, for a lease that carries only an expiry. A lease with no option
-- notice still has a decision point, and renewal-watch.js falls back to the
-- expiry rather than staying silent — so the read has to be able to find it.
create index if not exists broker_comps_expiry_idx
  on broker_comps (user_id, lease_expiry)
  where lease_expiry is not null and renewal_notified_at is null;

-- ---------------------------------------------------------------------------
-- ONE MORE COLUMN, ON A DIFFERENT TABLE, RIDING ALONG DELIBERATELY
-- ---------------------------------------------------------------------------
-- Owen's call, 2026-08-22: bundle the deal board's known gap here so Jacob
-- runs one migration this week rather than two.
--
-- The board (O3, PR #167) currently splits a departed member into TWO rows.
-- `org_comps` denormalizes `shared_by_name` at share time (032) so a comp
-- keeps its attribution after an account is deleted, while `shared_reports`
-- has no name column at all — 018 adds `user_id` with `on delete set null`
-- and the name is only ever joined from `users`. So one person who leaves
-- shows up once by name (their comps) and once as an unattributed row (their
-- reports). The totals stay right; the identity splits.
--
-- This is the storage half only, and it is DELIBERATELY an unwritten column
-- for now — `orgs.share_default` and `hub_items.status` both shipped that way
-- for the same reason: the code that fills it in lives on the deal-board
-- branch, and a column landing ahead of its writer costs nothing while the
-- reverse costs a 400 on every share. Nothing reads it until that lands, and
-- an unfilled column changes no behaviour.
--
-- NOT backfillable in SQL: the names it wants belong to accounts that have
-- already been deleted. It fixes the split for members who leave AFTER it
-- ships, which is the only group it ever could have.
alter table shared_reports add column if not exists shared_by_name text not null default '';

-- Verify (zero rows = applied):
--   select 'column: shared_reports.shared_by_name'
--   where not exists (select 1 from information_schema.columns
--                     where table_schema = 'public' and table_name = 'shared_reports'
--                       and column_name = 'shared_by_name')
--   union all
--   select 'column: broker_comps.' || c
--   from unnest(array['lease_expiry','option_notice_date','renewal_notified_at']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_schema = 'public' and table_name = 'broker_comps'
--                       and column_name = c)
--   union all
--   select 'index: ' || i
--   from unnest(array['broker_comps_renewal_idx','broker_comps_expiry_idx']) as i
--   where not exists (select 1 from pg_indexes
--                     where schemaname = 'public' and indexname = i);
