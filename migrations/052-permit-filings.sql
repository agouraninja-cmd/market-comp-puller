-- 052 — permit filings (permit signals, slice 2; 2026-09-16)
-- Spec:  docs/superpowers/specs/2026-09-16-permit-signals-design.md (§5)
-- Rules: permit-filings.js (what is stored, the dedupe key, the match),
--        permit-portals.js (where a row comes from), permit-zoning.js
--
-- ---------------------------------------------------------------------------
-- PUBLIC RECORD, NOT SCOPED TO A FIRM
-- ---------------------------------------------------------------------------
-- A filing is a row a city's own permit portal publishes to anyone. Every
-- firm covering Boise sees the same Boise filings, so there is no user_id,
-- no org_id and no privacy wall here — this is the corpus's class of table,
-- not the vault's. What IS per-firm is the MATCH to a building on a board,
-- and that is a read (permit-filings.js's matchFilingsToBuildings over the
-- firm's own org_buildings rows), never a column. Nothing here writes to
-- org_buildings and nothing may: test/org-routes.test.js fails the build if
-- that table is named outside its read function and route block.
--
-- ---------------------------------------------------------------------------
-- ONE ROW PER (jurisdiction, permit_number), FOREVER
-- ---------------------------------------------------------------------------
-- The tracker's dedupe, kept: the sweep window overlaps on purpose (a
-- four-day window covers a long weekend), so a filing is re-seen on several
-- sweeps and must land once. The insert is resolution=ignore-duplicates on
-- this key; a re-seen row's STATUS is compared separately and a change is
-- appended to permit_filing_events (the tracker's permit_events shape),
-- because "when did it move to Prep for Issuance" is the question a critical
-- dates strip asks.
--
-- street_key is broker-vault.js's addressKey over the STREET LINE of the
-- portal's address (permit-filings.js's streetKey) — a portal prints a bare
-- street and a board row carries a full address, and the two must key the
-- same way. market is the JURISDICTION's "City, ST" through marketOf, never
-- parsed from the portal string.

create table if not exists permit_filings (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null,
  permit_number text not null,
  permit_type text,
  description text,
  project_name text,
  address text,
  street_key text,
  market text,
  parcel_number text,
  zoning text,
  is_industrial boolean not null default false,
  applicant_company text,
  contractor_company text,
  applied_date date,
  status text,
  status_changed_at timestamptz,
  source_url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create unique index if not exists permit_filings_jur_number_key
  on permit_filings (jurisdiction, permit_number);
-- The building-sheet read (slice 3) joins on market + street_key.
create index if not exists permit_filings_market_street_idx
  on permit_filings (market, street_key);
-- The sweep's "seen recently" read and the development shop's feed both
-- order by when a filing was applied for.
create index if not exists permit_filings_applied_idx
  on permit_filings (applied_date desc);

create table if not exists permit_filing_events (
  id uuid primary key default gen_random_uuid(),
  filing_id uuid not null references permit_filings(id) on delete cascade,
  old_status text,
  new_status text not null,
  detected_at timestamptz not null default now()
);
create index if not exists permit_filing_events_filing_idx
  on permit_filing_events (filing_id, detected_at desc);

-- Service role only, like every other table (the app connects with
-- SUPABASE_SERVICE_KEY, which bypasses RLS; enabling it with no policies
-- denies the anon and authenticated keys entirely).
alter table permit_filings enable row level security;
alter table permit_filing_events enable row level security;
