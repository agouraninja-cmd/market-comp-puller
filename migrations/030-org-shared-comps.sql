-- 030 · The shared vault: a broker's comps, opted in to their firm (2026-08-16)
-- Spec:  docs/superpowers/specs/2026-08-16-enterprise-team-accounts-design.md §7
-- Rules: blend-comps.js (shaping, dedupe), org-access.js (membership)
--
-- RUN BEFORE DEPLOYING the /api/vault/firm routes. Purely additive: one new
-- table, nothing altered. Deploy-then-migrate costs the feature (every route
-- 400s at PostgREST) and nothing else — no existing read names this table.
--
-- ---------------------------------------------------------------------------
-- WHY A SEPARATE TABLE, AND NOT A COLUMN ON broker_comps
-- ---------------------------------------------------------------------------
-- Migration 013's rule, third time of asking. The one-line version of this
-- feature is `or=(user_id.eq.X,org_id.eq.Y)` on vaultCompsForReport, or an
-- `org_id` column on broker_comps filtered at read time. Both look correct in
-- review and both fail SILENTLY, because that read path returns [] on error
-- and swallows what went wrong: a missed filter would put one broker's whole
-- book into a colleague's report — or, one bug further, into the public corpus
-- — with nothing anywhere alerting anyone.
--
-- A separate table makes the leak impossible rather than unlikely. Nothing
-- public reads this table either: not harvestComps(), not corpusRowsForMarket(),
-- not maybePublishMarketSnapshot(), not /api/corpus-comps. Firm-shared is not
-- published, and the two words stay separate — the "0 published" counter on
-- /vault still counts only comps in the PUBLIC records.
--
-- ---------------------------------------------------------------------------
-- WHY A COPY, AND WHY THE COPY IS jsonb
-- ---------------------------------------------------------------------------
-- A copy, not a join, for the reason 024 gives about hub_items: a live join
-- would let a later vault edit silently rewrite what a colleague read last
-- week. It differs from the hub in ONE way, deliberately — the owner's edit
-- REFRESHES this copy and their delete pulls it (see the cascade below),
-- because a hub records what was disclosed to an outside party while this is
-- the firm's own working comp database, and a correction inside one firm is
-- theirs to make.
--
-- jsonb rather than a column per field, which is the opposite of 013's choice
-- and for a reason 013 does not have: per-type spec columns arrive through the
-- add-comp-field skill, and CLAUDE.md already warns that such a field "spans
-- up to four maps". Duplicating the whole comp shape here would make it five,
-- and the fifth would be a MIGRATION rather than a code change — the exact
-- shape of the 004 outage. The payload is written by blend-comps.js's own
-- FIELD_MAP, so it carries what a report can render and nothing else: no
-- user_id, no dedupe_key, no address_key, no upload_id, no published flags.
--
-- The three columns that are NOT in the payload are the three the blend read
-- filters on. Those have to be real columns and real types, 013's argument
-- exactly: a text deal_date cannot answer a lookback window.

create table if not exists org_comps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,

  -- Who put it there. SET NULL on account deletion so the firm keeps the comp
  -- and simply loses the name — attribution is a label, and dropping the row
  -- would quietly change every colleague's valuation.
  shared_by_user_id uuid references users(id) on delete set null,
  -- Denormalized at share time, like report branding's snapshot: the name is
  -- what a colleague reads on the badge, and it must survive the account.
  shared_by_name text not null default '',

  -- CASCADE, and this is the one place this feature deliberately differs from
  -- migration 018's set-null rule for shared reports. A shared REPORT is a
  -- record of what was sent, so it must outlive its sender. A shared COMP is a
  -- live copy of a row in the broker's own book, and the broker deleting that
  -- row is precisely the signal that the copy is wrong — most often because
  -- the deal was entered wrong. The DELETE route pulls it explicitly; this is
  -- the backstop for account deletion and for anything that bypasses it.
  source_comp_id uuid not null references broker_comps(id) on delete cascade,

  -- The three the blend filters on. Real columns, real types.
  market text not null,               -- canonical marketOf(), same as broker_comps
  property_type text not null,
  deal_date date not null,

  -- The comp itself, shaped by blend-comps.js's FIELD_MAP. See above.
  comp jsonb not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Sharing the same comp twice is a no-op, and it is what makes the refresh
  -- on edit an upsert rather than a read-then-write race.
  unique (org_id, source_comp_id)
);

-- The blend read: this firm, this market, this type, inside the lookback.
create index if not exists org_comps_lookup_idx
  on org_comps (org_id, market, property_type, deal_date desc);
-- "What have I shared?", for the vault's own header and its unshare control.
create index if not exists org_comps_sharer_idx
  on org_comps (shared_by_user_id) where shared_by_user_id is not null;

alter table org_comps enable row level security;

-- Verify (zero rows = applied):
--   select 'org_comps' where not exists (select 1 from information_schema.tables
--                                        where table_schema = 'public' and table_name = 'org_comps');
--   select 'column: org_comps.' || c
--   from unnest(array['org_id','shared_by_user_id','source_comp_id','market',
--                     'property_type','deal_date','comp']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_schema = 'public' and table_name = 'org_comps' and column_name = c);
