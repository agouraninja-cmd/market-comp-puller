-- migrations/060-user-sites.sql
-- 060 · Sites: the land and buildings a development firm's member is buying,
-- and the status of the buildings they own or track (2026-10-05).
-- Design: the owner's pick "M2" of the Sites drafts,
--   https://claude.ai/artifact/BMeJY9d3vegjmDxcAPtxzR
--
-- RUN BEFORE DEPLOYING the /api/sites routes. Nothing else reads this table,
-- so deploy-first costs only the Sites tab (its reads answer 503 until this
-- runs), never another surface.
--
-- PRIVATE, vault-class, exactly like broker_bovs (019): read and written only
-- by the /api/sites routes, every one scoped by user_id; no owner surface, no
-- corpus and no public page reads it. DB-only: the routes refuse without a
-- database rather than fall back to a file Render erases on deploy.
--
-- One table, two kinds of row:
--   * a DEAL: portfolio_item_id is null; stage is prospect, loi, contract,
--     entitle or passed. Everything about the deal lives here.
--   * a STATUS on a property the member already holds in portfolio_items:
--     portfolio_item_id is set; stage is owned or tracking. A deal that
--     closes becomes this kind (its stage_dates are the deal's history).
-- portfolio_items itself is NOT altered, on purpose: listPortfolio names its
-- columns, and a column added there would 400 every Properties read on a
-- deploy that ran ahead of the migration.
--
-- Purely additive and idempotent; test/sites.test.js fails the build if a
-- destructive statement appears in this file.

create table if not exists user_sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  address text not null,
  -- canonical marketOf() form when the address yields one, else null.
  market text,
  property_type text not null default 'Land',
  acres numeric,
  zoning text,
  asking_price numeric,
  earnest_money numeric,
  seller text,
  -- Restates sites.js STAGES; keep the two in step.
  stage text not null default 'prospect'
    check (stage in ('prospect', 'loi', 'contract', 'entitle', 'owned', 'tracking', 'passed')),
  -- { "<stage>": "YYYY-MM-DD" }: the day each stage was reached.
  stage_dates jsonb not null default '{}'::jsonb,
  -- [ { "on": "YYYY-MM-DD", "label": "Due diligence ends" } ]
  dates jsonb not null default '[]'::jsonb,
  notes text,
  -- portfolio_items.id when this row is the status of a held property. No FK:
  -- removing a property must never fail on this table, and a row whose
  -- property is gone simply renders nothing.
  portfolio_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_sites_user_id_idx on user_sites (user_id);
alter table user_sites enable row level security;

-- Verify (zero rows = schema complete):
--   select t from unnest(array['user_sites']) as t
--   where not exists (select 1 from information_schema.tables
--                     where table_schema = 'public' and table_name = t);
