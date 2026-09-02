-- 045: public macro readings per CBSA, appended monthly (2026-09-02).
--
-- The store behind the market ranking's macro block. One row per
-- (cbsa, metric, observation date) — never per fetch — so the table is a
-- history of what the government published, not a cache of what we last saw.
--
-- ---------------------------------------------------------------------------
-- APPEND, NEVER UPDATE, and the key is the OBSERVATION date.
--
-- BLS and Census both revise. Employment for a given month is published, then
-- revised the following month, then benchmarked again a year later against
-- unemployment-insurance records — the annual benchmark routinely moves a
-- metro by thousands of jobs. If a revision overwrote the original row, a
-- ranking computed last March could never be reproduced: the inputs would have
-- silently changed underneath it, and the only honest answer to "why did this
-- market move" would be "we don't know".
--
-- So a revision arrives as a NEW row with a later `fetched_at` and the same
-- `as_of`, and readers take the most recently fetched row for each
-- (cbsa, metric, as_of). The unique constraint below is on all three plus the
-- fetch date, which is what allows that.
-- ---------------------------------------------------------------------------
--
-- Purely additive. No existing table is touched, no column is added to one,
-- and every statement is `if not exists`, so a re-run is a clean no-op.
--
-- Blast radius if it is NOT run: the refresh script writes its file fallback
-- (macro-readings.json) and the ranking scores from that, exactly as
-- search-cache and comp-corpus already degrade. Nothing 500s. What is lost is
-- durability — Render erases its disk on every deploy — so an unrun migration
-- costs the history, not the feature.

create table if not exists macro_readings (
  id          uuid primary key default gen_random_uuid(),

  cbsa_code   text not null,
  -- The metric's name as it appears in market-weights.json, so a reading joins
  -- to its weight by string with no translation table in between. That is the
  -- same contract broker_comps.market keeps with marketOf().
  metric      text not null,

  -- WHEN THE GOVERNMENT SAYS THIS WAS TRUE. Not when we asked.
  as_of       date not null,
  -- The raw published figure, in the unit market-thresholds.json states for
  -- this metric. Stored alongside the derived number rather than instead of
  -- it: `value` is what the source said and can be checked against the source;
  -- `yoy_pct` is ours and cannot.
  value       numeric,
  yoy_pct     numeric,

  source      text not null default 'fred' check (source in ('fred', 'census', 'bea', 'bls')),
  series_id   text,                   -- FRED series or Census variable, for tracing one number back
  fetched_at  timestamptz not null default now(),

  -- Three-part identity plus the fetch, so a revision is a new row rather than
  -- a conflict. Deliberately NOT unique on (cbsa, metric, as_of) alone.
  unique (cbsa_code, metric, as_of, fetched_at)
);

alter table macro_readings enable row level security;

-- The read the ranking actually performs: every metric for one market, newest
-- observation first. Second index serves the monthly refresh asking "what is
-- the latest as_of I already hold for this series".
create index if not exists macro_readings_lookup
  on macro_readings (cbsa_code, metric, as_of desc, fetched_at desc);
create index if not exists macro_readings_freshness
  on macro_readings (metric, as_of desc);

-- ---------------------------------------------------------------------------
-- Verify (zero rows = applied):
--
--   select 'macro_readings missing' as problem
--   where to_regclass('public.macro_readings') is null
--   union all
--   select 'rls off on macro_readings'
--   from pg_class where relname = 'macro_readings' and relrowsecurity = false
--   union all
--   select 'index ' || i
--   from (values ('macro_readings_lookup'), ('macro_readings_freshness')) as v(i)
--   where not exists (select 1 from pg_indexes where indexname = v.i);
--
-- And after the first refresh, the number worth reading once — it is the
-- coverage the ranking will honestly report, and a low figure early is
-- expected rather than alarming:
--
--   select metric, count(distinct cbsa_code) as markets, max(as_of) as newest
--   from macro_readings group by metric order by markets desc;
-- ---------------------------------------------------------------------------
