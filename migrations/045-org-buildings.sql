-- 045 — the firm's buildings (Three Spaces, slice 3; 2026-09-01)
-- Plan:  ~/.claude/plans/could-you-help-me-mighty-crane.md ("Slice 3 — The firm's buildings")
-- Spec:  docs/superpowers/specs/2026-09-01-three-spaces-design.md
-- Rules: org-buildings.js (what may be stored), org-access.js (membership)
--
-- The plan numbered this 044. Firm messaging (slice 7) shipped ahead and took
-- 044, so the building entity is 045, its notes will be 046 and leases 047.
--
-- ---------------------------------------------------------------------------
-- WHY A TABLE AND NOT A DERIVED LIST
-- ---------------------------------------------------------------------------
-- A building sheet has to be LINKABLE — from a message, a lease reminder, a
-- colleague's note — and an address string is not an id: `1210N17th st` and
-- `1210 N 17th st Boise Idaho 83702` are the exact pair that produced
-- portfolio-match.js. And org_comps keeps its address inside the `comp`
-- jsonb, so filtering a firm's comps by building without a table means
-- pulling the firm's entire comp set on every sheet open.
--
-- ---------------------------------------------------------------------------
-- WHY THIS DOES NOT BREACH THE PRIVACY WALL
-- ---------------------------------------------------------------------------
-- Migration 016's rule stands untouched: two brokers on one building get
-- SEPARATE broker_properties rows, because deduplicating them would make one
-- broker's activity inferable from the other's. An org_buildings row is a
-- different act — a member CHOOSING to put a building on the firm's board.
-- Structurally it is the third opt-in of the same shape as
-- `POST /api/share {visibility:"org"}` and `POST /api/vault/firm`: a new
-- table, read and written by new functions, so no `user_id=eq.` read is
-- widened and test/org-routes.test.js's `or=(user_id.eq` scan stays satisfied
-- by construction.
--
-- THE RULE THAT KEEPS THAT TRUE: linkVaultProperties() must never touch this
-- table. A building row is created only by an explicit route call carrying a
-- member's session. If one appeared as a side effect of an upload, a
-- colleague could read another's book by watching the list.
-- test/org-routes.test.js scans for exactly that.
--
-- ---------------------------------------------------------------------------
-- TWO KEYS, DELIBERATELY, AND NO THIRD
-- ---------------------------------------------------------------------------
-- `address_key` is the natural key — it is what broker_comps and
-- broker_properties already carry (broker-vault.js's addressKey), and comps
-- are the sheet's largest section. `verified_key` is a nullable second column
-- so a portfolio_items / recent_searches row (035's verifiedKeyFor) can be
-- matched too. Both come from existing tested pure modules; this file invents
-- nothing new to keep in step.

create table if not exists org_buildings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,

  -- The address as a member typed or verified it, and its two keys.
  address text not null,
  address_key text not null,
  verified_key text,

  -- Derived by server.js with marketOf() so it agrees byte for byte with
  -- comp_corpus.market and broker_comps.market — the vault's rule.
  market text not null default '',
  property_type text not null default '',
  size_sqft numeric,
  year_built integer,

  -- Who put it on the board. SET NULL on account deletion, name kept, 039's
  -- rule: a building nobody can attribute is one nobody can ask about.
  added_by_user_id uuid references users(id) on delete set null,
  added_by_name text not null default '',

  -- Location, when a door that already had it (a verified portfolio row)
  -- handed it over. Never geocoded here.
  lat double precision,
  lng double precision,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One building is one row per firm, and this is what the add route's upsert
-- names in its ON CONFLICT. PLAIN, not partial and not an expression index —
-- 039's correction: PostgREST's on_conflict needs an index matching the
-- columns EXACTLY, and the normalizing is done into the column instead.
create unique index if not exists org_buildings_key_idx
  on org_buildings (org_id, address_key);

-- The list read: one firm, most recent activity first.
create index if not exists org_buildings_recent_idx
  on org_buildings (org_id, updated_at desc);

alter table org_buildings enable row level security;

-- A contact can belong to a building (slice 5 reads it; nothing reads it
-- yet). `building_id`, not the plan's `property_id`: the plan's own noun rule
-- says the NEW entity is a building in its table, module, routes, URLs and
-- copy, and `property` stays only where it already is.
--
-- ⚠ Not named in orgContactRows' explicit `select=` until this has run —
-- PostgREST 400s an unknown column and would take every /api/org/contacts
-- read down with it. Adding it there is a code change AFTER the migration.
alter table org_contacts add column if not exists building_id uuid
  references org_buildings(id) on delete set null;

-- Verify (zero rows = applied):
--   select 'org_buildings' where not exists (select 1 from information_schema.tables
--                                            where table_schema = 'public' and table_name = 'org_buildings');
--   select 'column: org_buildings.' || c
--   from unnest(array['org_id','address','address_key','verified_key','market','property_type',
--                     'size_sqft','year_built','added_by_user_id','added_by_name','lat','lng']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_schema = 'public' and table_name = 'org_buildings' and column_name = c)
--   union all
--   select 'column: org_contacts.building_id' where not exists (
--     select 1 from information_schema.columns
--     where table_schema = 'public' and table_name = 'org_contacts' and column_name = 'building_id')
--   union all
--   select 'index: ' || i
--   from unnest(array['org_buildings_key_idx','org_buildings_recent_idx']) as i
--   where not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = i)
--   union all
--   select 'rls off on org_buildings' where not exists (
--     select 1 from pg_class where relname = 'org_buildings' and relrowsecurity);
