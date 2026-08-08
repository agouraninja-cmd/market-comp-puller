-- migrations/019-broker-bovs.sql
-- 019 · BOV tracker: the broker's practice log (2026-08-08)
-- Spec: docs/superpowers/specs/2026-08-08-bov-tracking-design.md
-- Plan: docs/superpowers/plans/2026-08-08-bov-tracking.md
--
-- RUN BEFORE DEPLOYING the /api/broker/bovs routes.
--
-- Broker PRIVATE data, vault-class: read only by the /api/broker/bovs
-- routes, every one scoped by user_id. No owner surface reads it, nothing
-- public reads it. Purely additive, like 016: there is no staging database
-- to rehearse against, and test/bov-log.test.js fails the build if a
-- destructive statement appears in this file.
--
-- There is deliberately NO SQL backfill from lead_intro_requests: `market`
-- must be canonical marketOf() form and marketOf lives in server.js, so
-- seeding happens in JS on first tracker open instead (the coverage-seeding
-- pattern), made idempotent by the unique constraint below.

create table if not exists broker_bovs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- Set only when the row came from a CompNinja intro request. No FK to
  -- leads, matching lead_intro_requests' reasoning (015 asserts the id
  -- type; a dangling id renders nothing). NULLs compare distinct, so the
  -- unique constraint only bites compninja-sourced rows and manual rows
  -- are unlimited (the same trick broker_comps.dedupe_key documents).
  lead_id bigint,
  market text not null,            -- canonical marketOf() form, computed in server.js
  property_type text not null,     -- VAULT.PROPERTY_TYPES vocabulary
  size_sqft numeric,
  address text,
  notes text,
  received_on date,
  -- Both lists restate bov-log.js's SOURCES/STATUSES; keep the three in step.
  source text not null default 'other'
    check (source in ('compninja', 'referral', 'repeat_client', 'other')),
  status text not null default 'open'
    check (status in ('open', 'delivered', 'won', 'lost')),
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, lead_id)
);
create index if not exists broker_bovs_user_id_idx on broker_bovs (user_id);
alter table broker_bovs enable row level security;

-- Verify (zero rows = schema complete):
--   select t from unnest(array['broker_bovs']) as t
--   where not exists (select 1 from information_schema.tables
--                     where table_schema = 'public' and table_name = t);
