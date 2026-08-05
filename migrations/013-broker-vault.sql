-- 013 · Broker vault v1 (2026-08-05) — the private, per-broker comp store.
-- Plan: docs/superpowers/plans/2026-08-05-broker-vault-v1.md
-- Spec: docs/superpowers/specs/2026-08-05-broker-tier-design.md
--
-- RUN THIS BEFORE DEPLOYING the vault routes. PostgREST 400s on an unknown
-- table, and the vault deliberately has NO file fallback (see below), so an
-- unrun migration here is a hard, visible failure rather than a silent one.
-- That is the intended behaviour: this folder's cautionary tale (migration
-- 004) is what happens when a missing table degrades quietly instead.
--
-- ---------------------------------------------------------------------------
-- THE PRIVACY WALL
-- ---------------------------------------------------------------------------
-- These are SEPARATE TABLES, deliberately, rather than a `private` flag on
-- comp_corpus. Ecosystem Plan §2: CompNinja stores broker data but never reads
-- it into the public database, and privacy is not a feature of the broker
-- product, it IS the broker product.
--
-- The reason it is separate tables and not a filtered column is mechanical:
-- the public corpus read path (corpusRowsForMarket / retrieveCorpusComps) is
-- built to swallow its own errors so a database hiccup can never break a
-- visitor's search. Correct, and it means a missed `.eq("published", true)`
-- would leak a broker's book of business into public reports with NOTHING
-- alerting anyone — that exact blindness already hid a total corpus outage for
-- weeks. A separate table makes the leak impossible instead of unlikely.
--
-- Nothing public may ever read broker_comps: not harvestComps(), not
-- corpusRowsForMarket(), not maybePublishMarketSnapshot(), not
-- gen-market-seed.js, not /api/corpus-comps.
--
-- ---------------------------------------------------------------------------
-- SCOPE: this is v1 STORAGE, not the analytics model
-- ---------------------------------------------------------------------------
-- Two plain tables, flat, with no dimension tables and no joins. The broker
-- data model proper — the star schema in Ecosystem Plan §6 — is Jacob and
-- Chuck's, and nothing here is meant to pre-empt it. This exists only so the
-- upload feature has somewhere to put a row.
--
-- WHAT THAT MEANS FOR THAT WORK: the vault writes to `broker_comps` with the
-- columns below. Their design can adopt this table, read from it, or replace
-- it — replacing it is cheap while the row count is small, which is the whole
-- reason to say so here rather than let it be discovered later.
--
-- ---------------------------------------------------------------------------
-- WHY REAL TYPES HERE, WHEN comp_corpus IS ALL text
-- ---------------------------------------------------------------------------
-- comp_corpus stores everything as text because it arrives from a language
-- model and is irregular by nature — "$1.2M", "approx 45,000 SF", "Q3 2025".
-- Broker uploads are validated at the door (broker-vault.js) and rejected when
-- they do not parse, so this table can hold real numeric/date types.
--
-- That is not tidiness, it is the dashboard: sorting a text column puts
-- "1,000,000" before "900,000". Storing a price as numeric and a date as date
-- is the minimum for the table to sort correctly, and it is independent of
-- whatever shape the analytics layer eventually takes.

-- One row per import, so a broker who uploads the wrong file undoes it in one
-- action instead of forty. Deleting the batch cascades to its comps.
create table broker_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  filename text not null default '',
  row_count integer not null default 0,       -- rows actually stored
  skipped_count integer not null default 0,   -- rows rejected at validation
  created_at timestamptz not null default now()
);
create index on broker_uploads (user_id, created_at desc);

-- One row per comp a broker has uploaded.
create table broker_comps (
  id uuid primary key default gen_random_uuid(),
  -- The owning broker. Every read is scoped by this; a broker must not see
  -- another broker's vault any more than the public may.
  user_id uuid not null references users(id) on delete cascade,
  upload_id uuid references broker_uploads(id) on delete cascade,

  -- --- what the comp is about ----------------------------------------------
  -- `market` MUST be written with server.js's own marketOf() and no other
  -- parse. It is deliberately the same canonical form the public corpus uses
  -- ("Ontario, CA" — title-case city, uppercase state) so that a comp
  -- published in step 2 lands in comp_corpus needing no translation, and so
  -- "brokers active in this market" can one day match on equal terms.
  market text not null,
  property_type text not null,
  address text not null,
  -- Normalized address (lowercased, punctuation and whitespace collapsed).
  -- Carries the dedupe constraint below; the display copy stays in `address`.
  address_key text not null,

  -- --- time dimension ------------------------------------------------------
  -- NOT NULL: a comp with no date cannot be filtered by any lookback, which
  -- is the one thing comps are for, and it is part of the dedupe key below.
  -- broker-vault.js rejects an undated row at the door, so this can never fire
  -- for an upload; it is here so a future writer cannot quietly weaken it.
  deal_date date not null,

  -- --- measures, as real numbers -------------------------------------------
  transaction text,              -- 'sale' | 'lease', normalized at the door
  price numeric,                 -- sale price, or annual rent for a lease
  size_sqft numeric,
  price_per_sqft numeric,        -- computed when price and size are both given
  cap_rate numeric,              -- percent, e.g. 6.25

  -- --- per-type specs ------------------------------------------------------
  -- Same column names as comp_corpus (TYPE_COMP_FIELDS in server.js), for the
  -- same reason `market` is canonical: a published comp must not need a
  -- translation layer. Each row carries every column; unused ones stay null.
  clear_height text, dock_doors text,
  building_class text, floor_plate text,
  center_type text, anchor_tenant text,
  units text, price_per_unit text,
  lot_acres text, price_per_acre text, zoning text,
  beds_baths text,
  tenancy text, year_built text,
  notes text,

  -- --- publishing (step 2; present but NOT written in v1) ------------------
  -- The column exists now so the vault header can honestly say "0 published"
  -- from day one. That counter is the trust proof the whole tier rests on: a
  -- broker does not hand over their book of business because the terms promise
  -- we cannot read it, they do it because they can watch this number stay at
  -- zero. Nothing in v1 sets it to true.
  published boolean not null default false,
  published_at timestamptz,

  created_at timestamptz not null default now(),

  -- Re-importing an overlapping spreadsheet is normal broker behaviour, so the
  -- same deal twice must not become two rows.
  --
  -- One explicit key column rather than `unique (user_id, address_key,
  -- deal_date, price)`, for the same reason comp_corpus has one: Postgres
  -- compares NULLs as DISTINCT in a unique constraint, so an UNPRICED comp
  -- (allowed — brokers track deals whose price was never disclosed) would
  -- re-import without limit on every upload. Built as a string by
  -- broker-vault.js, where a null price is an empty segment that compares
  -- equal to itself. It is also a plain column, which is what PostgREST's
  -- on_conflict needs.
  --
  -- Scoped per broker, not global: two brokers holding the same deal each keep
  -- their own private copy. That is the privacy wall, not a duplicate.
  dedupe_key text not null,
  unique (user_id, dedupe_key)
);

-- The dashboard's two filters (Ecosystem Plan §3: "sortable by property and by
-- market"), plus the default recent-first listing.
create index on broker_comps (user_id, market);
create index on broker_comps (user_id, property_type);
create index on broker_comps (user_id, created_at desc);

alter table broker_uploads enable row level security;
alter table broker_comps  enable row level security;

-- Verify (zero rows = schema complete):
--   select t from unnest(array['broker_uploads','broker_comps']) as t
--   where not exists (select 1 from information_schema.tables
--                     where table_name = t);
