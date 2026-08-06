-- 016 · Broker comps: the property dimension, indexes, and a reporting view.
--
-- Plan:  docs/ROADMAP.md "Now" → broker tier. Ecosystem Plan §6.
-- Spec:  docs/superpowers/specs/2026-08-05-broker-tier-design.md
--        ("The vault (NOT built) — the contract for whoever takes it")
--
-- Run this in the Supabase SQL editor, then add a line to APPLIED.md. There is
-- no runner; see migrations/README.md.
--
-- ---------------------------------------------------------------------------
-- THIS MIGRATION IS PURELY ADDITIVE. NOTHING IS DROPPED OR RENAMED.
-- ---------------------------------------------------------------------------
-- Every column `broker_comps` has today, it still has afterwards, carrying the
-- same values. Existing reads and writes keep working untouched, which is the
-- whole reason it is shaped this way:
--
--   * The vault shipped on 2026-08-05 and brokers may already have uploaded
--     their books. A broker's book of business is the one thing in this system
--     we promised we would not lose.
--   * There is no staging database, and no way to rehearse this against real
--     rows before running it on production.
--
-- So the star shape is ADDED ALONGSIDE the flat table rather than replacing
-- it. It can be run on a live database in the middle of the day, and if it is
-- reverted nothing is lost — see the rollback at the bottom.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS ACTUALLY MISSING
-- ---------------------------------------------------------------------------
-- The brief was "store the comps in the shape reporting tools expect, with
-- clean links to property, market, broker and date." Three of those four
-- already existed after 013:
--
--   broker  -> `user_id`, a real FK to users. Clean.
--   date    -> `deal_date`, a real `date`. Clean. A date DIMENSION is not
--              added: it earns its place when there is a fiscal calendar or
--              non-Gregorian period to model, and there is neither here.
--              date_trunc() answers every question a date_dim would.
--   market  -> `market`, canonical text written by marketOf(), byte-identical
--              to comp_corpus.market. Deliberately NOT given a dimension table
--              either: it would duplicate the corpus's market vocabulary and
--              create a second thing to keep in sync. This repo already
--              carries one such mirrored pair (compWeight) and it has a ⚠ on
--              it. One is enough.
--
--   property -> `address_key` was written on every row and then read by
--               NOTHING. No index, no table, no foreign key. This is the gap,
--               and it is the one dimension a broker actually slices by:
--               "show me everything I have done on this building."
--
-- So this migration builds the property dimension and leaves the other three
-- alone. A star schema whose dimensions are invented rather than needed is
-- just more joins.

begin;

-- ---------------------------------------------------------------------------
-- 1. The property dimension
-- ---------------------------------------------------------------------------
-- One row per building per broker. A broker's repeat deals on the same
-- property collapse to one row here, which is exactly what makes
-- "everything I have done on this building" a lookup rather than a scan.
--
-- Scoped by user_id, like everything else in the vault. Two brokers who both
-- transacted on the same building each get their own property row: that is the
-- privacy wall, not a duplicate. Deduplicating across brokers would mean one
-- broker's activity is inferable from another's row, which is exactly the
-- inference the vault exists to prevent.
create table if not exists broker_properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,

  -- The natural key, and the reason this table can be backfilled safely:
  -- broker-vault.js already computes address_key for every row on ingest
  -- (addressKey(), used as the first segment of dedupe_key). It has always
  -- been correct; it was simply never read.
  address_key text not null,

  -- The display copy, and the market/type the building sits in. Denormalized
  -- from the comps rather than joined out: these are attributes OF the
  -- property, and a dimension row that cannot answer "what and where is this"
  -- without a further join is not doing its job.
  address text not null,
  market text not null,
  property_type text not null,

  first_seen date,
  last_seen date,
  created_at timestamptz not null default now(),

  unique (user_id, address_key)
);

-- ---------------------------------------------------------------------------
-- 2. The fact table's link to it
-- ---------------------------------------------------------------------------
-- NULLABLE on purpose, and it stays nullable after the backfill below.
--
-- The vault's ingest path (server.js, POST /api/vault/upload) writes
-- broker_comps rows directly. Were this NOT NULL, the moment this migration
-- ran against production every upload would 400 until the matching code
-- deployed — and migrations here are applied by hand, minutes or hours apart
-- from the deploy. A nullable column makes the two orderings equivalent:
-- migrate-then-deploy and deploy-then-migrate both work, and neither has a
-- window where a broker's upload fails.
--
-- The application backfills the link on write. A null here means "not linked
-- yet", never "no property" — reporting reads through the view below, which
-- falls back to the comp's own denormalized address.
alter table broker_comps
  add column if not exists property_id uuid references broker_properties(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. Backfill from the rows that already exist
-- ---------------------------------------------------------------------------
-- Idempotent: safe to re-run, and safe to run before or after the code deploy.
-- Takes the most recent address spelling per (user, building) — brokers
-- re-import spreadsheets with the address typed differently, and the newest
-- one is the closest to how they write it today.
insert into broker_properties (user_id, address_key, address, market, property_type, first_seen, last_seen)
select
  c.user_id,
  c.address_key,
  (array_agg(c.address order by c.deal_date desc, c.created_at desc))[1],
  (array_agg(c.market order by c.deal_date desc, c.created_at desc))[1],
  (array_agg(c.property_type order by c.deal_date desc, c.created_at desc))[1],
  min(c.deal_date),
  max(c.deal_date)
from broker_comps c
group by c.user_id, c.address_key
on conflict (user_id, address_key) do nothing;

update broker_comps c
   set property_id = p.id
  from broker_properties p
 where p.user_id = c.user_id
   and p.address_key = c.address_key
   and c.property_id is distinct from p.id;

-- ---------------------------------------------------------------------------
-- 4. The indexes the slicing actually needs
-- ---------------------------------------------------------------------------
-- Every one of these leads with user_id, because every vault read is scoped by
-- it first and always. An index that did not would be an index the privacy
-- wall cannot use.
--
-- 013 already created (user_id, market), (user_id, property_type) and
-- (user_id, created_at desc). The ones below SUPERSEDE the first two by
-- carrying deal_date desc as a trailing column, which is the order every vault
-- read actually asks for — so the sort comes off the index instead of being
-- done afterwards.
--
-- 013's originals are deliberately NOT dropped. This migration is additive,
-- and a redundant index on an empty table costs nothing measurable; dropping
-- them is a separate, easily-reverted cleanup once there is real data to
-- measure against. Noted here so the duplication is a recorded decision rather
-- than an oversight.
create index if not exists broker_comps_user_market_idx
  on broker_comps (user_id, market, deal_date desc);

create index if not exists broker_comps_user_type_idx
  on broker_comps (user_id, property_type, deal_date desc);

create index if not exists broker_comps_user_date_idx
  on broker_comps (user_id, deal_date desc);

create index if not exists broker_comps_property_idx
  on broker_comps (property_id);

-- The lookup the blended-comps read performs on every report for a broker:
-- user + market + type + a lookback window. Ordered to match.
create index if not exists broker_comps_blend_idx
  on broker_comps (user_id, market, property_type, deal_date desc);

create index if not exists broker_properties_user_market_idx
  on broker_properties (user_id, market, property_type);

-- ---------------------------------------------------------------------------
-- 4b. Row level security
-- ---------------------------------------------------------------------------
-- MATCHES 013, WHICH ENABLES RLS ON broker_uploads AND broker_comps.
--
-- A table in the `public` schema WITHOUT this is reachable through PostgREST
-- by the anon role. broker_properties holds every broker's buildings, markets
-- and property types keyed by user_id, so without RLS the dimension would be a
-- public index of exactly the book of business the vault promises to keep
-- private — and it would look completely healthy while doing it.
--
-- Enabled with NO policies, deliberately, exactly as 013 does it: that denies
-- anon and authenticated outright. The application reaches these tables with
-- the service key, which bypasses RLS, and does its own user_id scoping on
-- every single query. Adding a policy here would be a second, weaker copy of a
-- rule the application already enforces.
--
-- Idempotent: enabling RLS on a table that already has it is a no-op.
alter table broker_properties enable row level security;

-- ---------------------------------------------------------------------------
-- 5. The reporting view
-- ---------------------------------------------------------------------------
-- This is what "the shape reporting tools expect" means in practice. A BI tool
-- pointed at this gets one row per transaction with its dimensions already
-- resolved, and never needs to know how the vault stores anything.
--
-- The application does NOT read this view. server.js keeps querying
-- broker_comps directly, because this codebase has no ORM and never uses
-- PostgREST's embedded-resource joins — where it needs a join it runs two
-- queries and stitches them in JS. Making the app read a view would be a new
-- pattern for no gain, since the columns it wants are already on the fact row.
--
-- SECURITY: this view is NOT exposed through PostgREST's anon or authenticated
-- roles, and must never be. It carries user_id and every private measure, with
-- no per-caller scoping — the vault's scoping lives in the application, which
-- adds user_id=eq.<caller> to every request. A view has no such caller. It is
-- for the service role and for direct SQL only.
create or replace view broker_comps_reporting as
select
  c.id                                   as comp_id,
  c.user_id                              as broker_id,
  coalesce(p.id::text, 'unlinked:' || c.address_key) as property_key,
  coalesce(p.address, c.address)         as property_address,
  coalesce(p.market, c.market)           as market,
  coalesce(p.property_type, c.property_type) as property_type,
  c.deal_date,
  date_trunc('month', c.deal_date)::date as deal_month,
  date_trunc('quarter', c.deal_date)::date as deal_quarter,
  extract(year from c.deal_date)::int    as deal_year,
  c.transaction,
  c.price,
  c.size_sqft,
  c.price_per_sqft,
  c.cap_rate,
  c.published,
  c.upload_id,
  c.created_at
from broker_comps c
left join broker_properties p on p.id = c.property_id;

comment on view broker_comps_reporting is
  'One row per broker comp transaction with dimensions resolved. Service role / direct SQL only - carries user_id and private measures with no per-caller scoping. Never expose to the anon or authenticated PostgREST roles.';

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- Loses nothing: every measure still lives on broker_comps, which this
-- migration never modified beyond adding one nullable column.
--
--   begin;
--   drop view if exists broker_comps_reporting;
--   drop index if exists broker_comps_user_market_idx;
--   drop index if exists broker_comps_user_type_idx;
--   drop index if exists broker_comps_user_date_idx;
--   drop index if exists broker_comps_property_idx;
--   drop index if exists broker_comps_blend_idx;
--   drop index if exists broker_properties_user_market_idx;
--   alter table broker_comps drop column if exists property_id;
--   drop table if exists broker_properties;   -- takes its RLS with it
--   commit;
