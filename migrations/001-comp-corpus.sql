-- 001 · Comp corpus — the permanent raw-data layer. Every search response
-- (billed AND cached) has its comps harvested here by harvestComps() in
-- server.js, deduped by dedupe_key. See the comment above harvestComps() for
-- the surrounding rules (fire-and-forget, non-USD reports skipped).
--
-- Note: the table was originally created without the per-type spec columns
-- (building_class .. beds_baths); those were added by migration 004. This
-- file shows the FULL current shape so a fresh environment gets it in one go.

create table if not exists public.comp_corpus (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  dedupe_key text not null unique,
  property_type text not null, market text not null, address text not null,
  transaction text, deal_date text, size_sqft text, price_or_rate text,
  price_per_sqft text, cap_rate text,
  -- per-type specs (TYPE_COMP_FIELDS in server.js); each row carries every
  -- column, and the ones its type doesn't use stay empty
  clear_height text, dock_doors text,
  building_class text, floor_plate text,
  center_type text, anchor_tenant text,
  units text, price_per_unit text,
  lot_acres text, price_per_acre text, zoning text,
  beds_baths text,
  tenancy text, year_built text,
  notes text, source_url text, source_type text, lat text, lng text,
  verified boolean default false
);
alter table public.comp_corpus enable row level security;
