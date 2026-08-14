-- migrations/024-analytics-visitor.sql
-- 024 · Which visit an analytics event belongs to (2026-08-13)
--
-- Why this exists: analytics_events records WHAT happened and nothing about
-- WHOSE visit it was, so the table can count signups and count reports and
-- can never say whether one person did both. "Did anybody get from the
-- landing page to a first report?" is the question the first broker cohort
-- raises, and the 2026-08-06 measurement had to answer it by hand-assembling
-- rows out of several tables. These two columns make it a query.
--
--   visitor_id  an opaque random id this server mints and hands to a browser
--               in the `cn_vid` cookie. NOT derived from IP, user agent, or
--               anything else about the person: it can say "the same browser
--               did these things" and it cannot say who that is. The events
--               stay PII-free — no email, no name, no street address, no IP,
--               which is the standing rule for this table.
--   user_id     the account id once a session resolves. Not a foreign key on
--               purpose (see below), and TEXT rather than uuid (see below
--               that).
--
-- No FK to users(id), deliberately. Account deletion cascades — that is the
-- point of deleteUserCascade — and an FK here would either drag the analytics
-- history down with the account or block the delete outright. These rows are
-- a counter, not a record about a person, so a deleted account should leave
-- its funnel history behind as an orphaned id and nothing else. Same reason
-- there is no index-backed join guarantee: read it with a join and expect
-- misses (`users.id::text = user_id`).
--
-- Both columns are TEXT, including the one holding a uuid, and that is not
-- laziness. Every other dimension on this row is text and logEvent writes
-- "" for "not applicable" across all of them; a uuid column would reject
-- that empty string, and because the write path here is an INSERT rather
-- than a SELECT, PostgREST would 400 the whole row — so EVERY anonymous
-- event, which is most of them, would divert to the ephemeral
-- analytics.jsonl fallback and the dashboard would quietly flatten. One
-- consistent text convention costs a cast at query time and removes that
-- entire failure mode.
--
-- Indexed because every funnel question groups by visitor_id over a date
-- range, and this table is append-only and already the largest one here.
--
-- Purely additive, idempotent, and nullable, so BOTH deploy orders are safe:
--   migrate-then-deploy — the columns sit null until the code ships.
--   deploy-then-migrate — this is the ONE case worth naming, because the
--   write path is an INSERT rather than a SELECT: PostgREST 400s on an
--   unknown column in an insert, and logEvent's insert would carry
--   visitor_id/user_id before the columns exist. Every analytics write would
--   fail into the ephemeral analytics.jsonl fallback (the 004 outage's exact
--   shape). logEvent is fire-and-forget and its failure is logged, so nothing
--   visitor-facing breaks, but the dashboard would go flat and stay flat.
--   RUN THIS BEFORE DEPLOYING, not after.
--
-- Old rows keep a null visitor_id forever. aggregateStats' funnel block
-- excludes unattributed rows rather than bucketing them as one unknown
-- visitor, so the pre-migration history reads as "not measured" instead of
-- inventing a single visitor who did everything the product has ever seen.

alter table public.analytics_events
  add column if not exists visitor_id text,
  add column if not exists user_id text;

create index if not exists analytics_events_visitor_ts_idx
  on public.analytics_events (visitor_id, ts);

-- Verify (zero rows = schema complete):
--   select c from unnest(array['visitor_id','user_id']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_name = 'analytics_events' and column_name = c);
