-- 058 — permit areas (2026-10-01, step 2 of permit alerts, Draft B)
-- Rules:  permit-alerts.js (an alert's area, the distance match),
--         permit-zoning.js (the parcel's center point), permit-filings.js
--         (geocodeLine, a filing's lat/lng on the page)
-- Writers: the sweep (parcel center on insert; locatePermitFilings for the
--         rest), POST|PATCH /api/permits/alerts (an alert's placed area)
--
-- ---------------------------------------------------------------------------
-- A PLACE FOR EVERY PERMIT
-- ---------------------------------------------------------------------------
-- permit_filings.lat/lng: the permit's place on a map. geo_source says where
-- it came from: 'parcel' (Ada County's parcel center, read on the same request
-- as its zoning), 'address' (the Census geocoder, for permits stored without a
-- parcel), or 'none' (Census had no match; not asked again). NULL means not
-- tried yet — the sweep's locate step reads those, newest first, a capped
-- number per run. A permit with no place never matches an area alert.
--
-- permit_alerts.area_*: the circle an alert follows — the placed address (as
-- the geocoder matched it), its point, and the distance in miles. All NULL is
-- an alert with no area, as every alert before this was.
--
-- ---------------------------------------------------------------------------
-- DEPLOY ORDER: HARD. Run this BEFORE the code merges.
-- ---------------------------------------------------------------------------
-- The sweep's insert names lat/lng/geo_source and its locate step filters on
-- geo_source; PostgREST 400s both on an unknown column (CLAUDE.md rule 9), so
-- an unrun 058 turns every city's sweep into an error line and fails the
-- weekday workflow. Purely additive and idempotent.

alter table permit_filings add column if not exists lat double precision;
alter table permit_filings add column if not exists lng double precision;
alter table permit_filings add column if not exists geo_source text;
create index if not exists permit_filings_unplaced_idx
  on permit_filings (applied_date desc) where geo_source is null;

alter table permit_alerts add column if not exists area_address text;
alter table permit_alerts add column if not exists area_lat double precision;
alter table permit_alerts add column if not exists area_lng double precision;
alter table permit_alerts add column if not exists area_miles real;
