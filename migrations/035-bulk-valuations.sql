-- 035 · Bulk valuation jobs (2026-08-21)
-- Spec:   docs/superpowers/specs/2026-08-21-bulk-valuation-design.md
-- Module: bulk.js (what counts as an address, what a row is worth, the totals)
--
-- RUN THIS BEFORE DEPLOYING the /api/bulk* routes and the /bulk page.
-- PostgREST 400s on an unknown table, so without it every bulk route answers
-- an error rather than the honest 503 the no-database path is meant to give.
-- Nothing ELSE breaks — this migration touches no existing table and adds no
-- column to one, unlike 030 — so an unrun migration costs the new feature and
-- only the new feature.
--
-- Purely additive: no DROP, no destructive ALTER, nothing that rewrites an
-- existing row's meaning. Same rule as 016, 019 and 030, and for the same
-- reason — there is no staging database to rehearse against.
--
-- ---------------------------------------------------------------------------
-- NO FILE FALLBACK, DELIBERATELY
-- ---------------------------------------------------------------------------
-- The stance of 013 (vault), 018 (invited shares), 024 (hub) and 030 (firms),
-- reached here by a different road. Those refuse because a JSON file on an
-- ephemeral disk is not an access-control list. This one refuses because a
-- bulk job is a RECEIPT: fifty billed searches, up to ~$18 and half an hour
-- of somebody's afternoon. Render erases its disk on every deploy, so a file
-- store would lose a finished portfolio days later, silently, and the only
-- way to get it back would be to pay for it again. Refusing to start the job
-- is the honest answer; degrading into something that looks like it works is
-- not.
--
-- The results are not the only copy of the work, and that is by design: every
-- finished row is also upserted into `portfolio_items` (server.js), so the
-- valuations live on My Desk exactly as if each address had been searched by
-- hand. A job row is the record of the RUN — what was asked for, what came
-- back, what failed and why.

-- ---------------------------------------------------------------------------
-- 1. The job.
-- ---------------------------------------------------------------------------
create table if not exists bulk_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,

  -- One property type and one lookback for the whole job. A list of addresses
  -- a broker pastes is a portfolio or a pipeline — industrial buildings, or a
  -- fund's retail centers — so the type is asked once rather than fifty times.
  -- A mixed list is two jobs, which is honest about the fact that the comps
  -- for a warehouse and a house are found by different searches.
  property_type text not null,
  months int not null,
  -- The market note ("within 2.5 miles", "north submarket") the whole job
  -- runs with, exactly as the single-property form's Focus field. It reaches
  -- the prompt AND the radius blend, so it is stored rather than re-typed.
  note text not null default '',
  -- What the person called this run. Free text, theirs, never shown publicly.
  label text,

  status text not null default 'running',
  -- Counts are DENORMALIZED on purpose: the page polls this row every few
  -- seconds while a job runs, and a count(*) over the items on every poll is
  -- a table scan per second per open tab for something the worker already
  -- knows. `total` is fixed at creation; `done_count` is the worker's own
  -- tally of rows it has finished with, whatever the outcome.
  total int not null default 0,
  done_count int not null default 0,

  -- The stall detector. A job is worked by the process that created it, so a
  -- deploy, a Render sleep or a crash mid-run leaves it 'running' forever with
  -- nobody advancing it. The worker touches this after every row; a read that
  -- finds it older than bulk.js's STALL_MS marks the job 'interrupted' and
  -- says so. Deliberately not a timer or a boot sweep: a timer fires at an
  -- hour nobody chose and a boot sweep fights a second instance, which is the
  -- watchlist digest's argument (migration 025) applied to a different job.
  heartbeat_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists bulk_jobs_user_idx
  on bulk_jobs (user_id, created_at desc);

-- RLS, for 016's reason and 016's scar. A table in the public schema without
-- it is reachable through PostgREST by the anon role, and this one holds a
-- member's address list keyed by user_id -- an index of exactly which
-- buildings somebody is valuing, which is competitive intelligence about them
-- and nobody else's business. 016 shipped without this line on
-- broker_properties, was caught by hand, and had to be re-run.
--
-- No policies, deliberately: the service role bypasses RLS and server.js is
-- the only thing that talks to these tables, scoping every read by user_id
-- itself. Enabling it with no policy therefore changes nothing for the app
-- and closes the door for everyone else. Enabling it twice is a no-op, so
-- re-running this file stays safe.
alter table bulk_jobs enable row level security;

comment on table bulk_jobs is
  'One bulk valuation run. Pro-only, user-scoped, no file fallback (see 035). '
  'A row is the record of the RUN; the valuations themselves also land in portfolio_items.';

-- ---------------------------------------------------------------------------
-- 2. One address in it.
-- ---------------------------------------------------------------------------
create table if not exists bulk_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references bulk_jobs(id) on delete cascade,
  -- Denormalized from the job so EVERY read can be scoped by user_id directly,
  -- the vault's rule (013): a scoped read that has to join to find out whose
  -- row this is, is a scoped read one refactor away from not being one.
  user_id uuid not null,

  position int not null,
  address text not null,
  label text,
  -- The size the broker supplied for THIS address, when their upload had a
  -- column for it. It skips the model's own two-search size lookup and, more
  -- importantly, cannot be the wrong building's footprint.
  size_sqft numeric,

  status text not null default 'queued',
  -- Why a row has no value. Shown verbatim on the page and in the CSV, so it
  -- is customer copy: "no priced sale comps in this window", not a stack.
  error text,

  -- The valuation, as the report's own hero would have printed it. Stored
  -- rather than recomputed on read, because the comps that produced it are
  -- not stored here and a number that could silently change between two
  -- readings of the same finished job is not a portfolio.
  value_low numeric,
  value_likely numeric,
  value_high numeric,
  psf_low numeric,
  psf_mid numeric,
  psf_high numeric,

  -- What stands behind the figure, so a row can be doubted on its own terms.
  subject_size_sqft numeric,
  size_source text,
  sale_comps int,
  comp_count int,
  market text,
  -- True when the band is the weighted interquartile range (4+ sale comps)
  -- rather than the full observed spread. A materially weaker number, and the
  -- page says which one it is looking at.
  trimmed boolean,
  -- Whether this address cost a billed search or came back from the cache.
  -- The one number that explains why one job took four minutes and the next
  -- took forty, and the only place it can be counted.
  cached boolean,

  -- The desk row this valuation was written to, so a finished line links to
  -- the property rather than dead-ending in the job.
  portfolio_item_id uuid,

  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists bulk_job_items_job_idx
  on bulk_job_items (job_id, position);
create index if not exists bulk_job_items_user_idx
  on bulk_job_items (user_id, created_at desc);

-- Same rule, and this is the table that actually holds the addresses.
alter table bulk_job_items enable row level security;

comment on table bulk_job_items is
  'One address inside a bulk valuation run. user_id is denormalized from the '
  'job so every read is scoped without a join (013''s rule).';
