-- 017 · Coordinates on the property dimension, so private addresses stop
--       being geocoded to place a map pin.
--
-- Spec:  docs/superpowers/specs/2026-08-06-private-comp-geocoding.md
--        (AGREED 2026-08-06; §7 answered in favour of step 1 + the two
--        display guards, with import-time geocoding deferred)
-- Plan:  docs/ROADMAP.md "Now" → first item after v2.
--
-- Run this in the Supabase SQL editor, then add a line to APPLIED.md. There is
-- no runner; see migrations/README.md.
--
-- ---------------------------------------------------------------------------
-- WHAT PROBLEM THIS IS HALF OF
-- ---------------------------------------------------------------------------
-- A broker's private vault comp is geocoded BY ADDRESS, FROM THE BROKER'S OWN
-- BROWSER, on every report that includes it — so the address of an off-market
-- deal leaves in a URL query string and reaches a third party (the US Census
-- geocoder, and on a miss, OpenStreetMap with the broker's IP attached),
-- purely to place a map pin.
--
-- This migration is the STORAGE half. It does not fix anything on its own:
-- renderMap() in index.html still geocodes every comp unconditionally with no
-- check for coordinates it already carries, so until the display guards land
-- these columns are stored and ignored. That is stated plainly in §2 of the
-- spec and is why the work was contracted in two halves.
--
-- ---------------------------------------------------------------------------
-- WHY THE PROPERTY AND NOT THE COMP
-- ---------------------------------------------------------------------------
-- Two deals on the same building share one location. Putting lat/lng on
-- broker_comps would store the same pair once per deal and permit the copies
-- to disagree — the drift this repo puts ⚠ comments on elsewhere. On the
-- dimension it is one row per building per broker, which also means a broker
-- with three deals on one property supplies coordinates once.
--
-- ---------------------------------------------------------------------------
-- PURELY ADDITIVE. NOTHING IS DROPPED OR RENAMED.
-- ---------------------------------------------------------------------------
-- Every column broker_properties has today it still has afterwards, carrying
-- the same values. All four columns are NULLABLE, for the same reason 016 made
-- property_id nullable: migrations here are applied BY HAND, minutes or hours
-- from the deploy, and both orderings must work with no window where a
-- broker's upload fails. A null means "no coordinates for this building",
-- which the display half treats as "geocode it the old way" — so an
-- un-migrated database and an un-deployed code drop both degrade to exactly
-- today's behaviour rather than to an error.

begin;

alter table broker_properties
  -- The location itself. numeric rather than double precision: these arrive
  -- from a broker's spreadsheet as decimal text, and numeric stores what was
  -- written instead of the nearest binary approximation of it. Nobody is doing
  -- trigonometry on these — they are handed to a map.
  add column if not exists lat numeric,
  add column if not exists lng numeric,

  -- HOW the coordinates were obtained. Not decoration, and not a comment:
  --
  --   'broker' — supplied in the upload. Contacted nobody, and is usually more
  --              accurate than a geocode because the broker knows the parcel.
  --   'census' — geocoded server-side at import. NOT WRITTEN BY ANY CODE
  --              TODAY: that is step 2 of the spec, deliberately deferred
  --              (§7). The value is declared now so that adding it later is a
  --              code change and not another migration.
  --   null     — unknown, which is every row until a broker supplies some.
  --
  -- It is what lets the display half decide whether it may skip geocoding, and
  -- what makes a bad import correctable later without re-doing everything.
  add column if not exists geo_source text,

  -- When they were obtained. Null for 'broker' rows: nothing was geocoded, so
  -- there is no geocoding time to record, and a timestamp meaning "when this
  -- spreadsheet was read" would be the upload's business, not the location's.
  add column if not exists geocoded_at timestamptz;

-- ---------------------------------------------------------------------------
-- Bounds
-- ---------------------------------------------------------------------------
-- broker-vault.js already refuses out-of-range coordinates, one-of-two, and
-- 0,0, with a spreadsheet line number. This is not a second copy of that rule
-- competing with it — the application decides what to TELL the broker, and
-- this decides what the table will HOLD.
--
-- It earns its place where a duplicated business rule would not, because these
-- bounds are absolute and cannot legitimately change: there is no future
-- product decision that makes a latitude of 91 meaningful. The comparable case
-- is 016's RLS note, which argued AGAINST duplicating application scoping in a
-- policy — scoping is a rule that evolves, a sphere is not.
--
-- Both-or-neither is included because a lone coordinate is a mistake rather
-- than a partial answer, and a half-located building would place a pin at the
-- equator or the prime meridian.
--
-- Safe to add to a live table: every existing row has both columns null, and
-- NULL passes each of these.
alter table broker_properties
  add constraint broker_properties_latlng_range check (
    (lat is null or (lat >= -90  and lat <= 90)) and
    (lng is null or (lng >= -180 and lng <= 180))
  ),
  add constraint broker_properties_latlng_paired check (
    (lat is null) = (lng is null)
  );

-- 0,0 is Null Island, in the Gulf of Guinea. It is what a spreadsheet produces
-- when a lookup formula fails, so it is far more likely to be an error than a
-- location — and a pin 400 miles off the coast of Ghana is worse than no pin,
-- because no pin is obviously missing and a wrong pin is not.
alter table broker_properties
  add constraint broker_properties_latlng_not_null_island check (
    lat is null or lng is null or not (lat = 0 and lng = 0)
  );

-- ---------------------------------------------------------------------------
-- The read this feeds
-- ---------------------------------------------------------------------------
-- Every blended-comp read is already scoped (user_id, market, property_type)
-- and joins the property by id. No new index: broker_properties is keyed on
-- (user_id, address_key) and carries broker_properties_user_market_idx from
-- 016, and lat/lng are never a filter — they are payload, fetched by a lookup
-- that is already indexed. An index on a column nothing filters by is cost
-- with no reader.

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- Loses only the coordinates a broker supplied; every comp and every property
-- is untouched, and the display half falls back to geocoding by address, which
-- is what it does today.
--
--   begin;
--   alter table broker_properties
--     drop constraint if exists broker_properties_latlng_range,
--     drop constraint if exists broker_properties_latlng_paired,
--     drop constraint if exists broker_properties_latlng_not_null_island;
--   alter table broker_properties
--     drop column if exists lat,
--     drop column if exists lng,
--     drop column if exists geo_source,
--     drop column if exists geocoded_at;
--   commit;
