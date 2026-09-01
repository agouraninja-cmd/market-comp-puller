-- 043 — recent searches, server-side and separate from the portfolio
--
-- WHY. Every signed-in search auto-saved itself into portfolio_items, so a
-- "portfolio" was really a log of everything the account had ever looked up.
-- A portfolio is meant to be what you OWN. From here the desk holds only
-- properties the member explicitly added, and this table holds the rest.
--
-- A SEPARATE TABLE, not a `kind` column on portfolio_items. That is 013's
-- rule (the vault privacy wall) and 032's, for the reason comp_corpus is the
-- standing cautionary tale: once one table holds two kinds of row, EVERY
-- aggregate over it has to remember to exclude the other kind, and the ones
-- that forget fail silently. comp_corpus took on-market listings alongside
-- closed sales and two consumers quietly started averaging asking prices into
-- their medians. portfolio_items is read in more places than that — the desk,
-- the caps, the bulk upsert, the market-page decoration, the value-history
-- delta — and a missed `kind <> 'recent'` in any one of them puts somebody
-- else's browsing back on their books with no symptom on screen.
--
-- Separate tables read by separate functions makes the wrong thing
-- unspellable instead of merely discouraged.
--
-- DEPLOY ORDER IS SOFT HERE, unlike 030/035/026. Nothing that exists today
-- reads this table: it is only named by new code. Deploying before the
-- migration costs cross-device recents (POST /api/recents fails, the browser
-- keeps its own localStorage copy and the list still renders) and leaves a
-- bulk row without its link. Nothing 500s and no desk goes down. Prefer
-- migrate-then-deploy anyway; just do not treat a slip as an incident.
--
-- PAYLOAD RETENTION. Only the newest rows keep their full report — the same
-- rule the browser's local history has always used (HISTORY_MAX /
-- PAYLOAD_MAX in index.html). A meta-only row is a couple of hundred bytes
-- against tens of KB for a report, so history reaches back a long way at
-- almost no storage cost, and an aged-out row is still re-runnable. Trimming
-- is done in server.js on insert, not by a trigger, so the rule lives beside
-- the browser's copy of it rather than in two languages.

create table if not exists recent_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  address text not null,
  property_type text not null,
  -- Same normalized geocoder answer portfolio_items.verified_key holds, from
  -- the same portfolio-match.js helper, so "is this the same property" has
  -- one definition across both tables. Nullable: a bulk row is never
  -- confirmed by anybody and falls through to the typed-address rule.
  verified_key text,
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The list read is always user-scoped and newest-first.
create index if not exists recent_searches_user_idx
  on recent_searches (user_id, updated_at desc);

-- The upsert match: same shape as portfolio_items_verified_key_idx, partial
-- for the same reason — a null key is the common case and indexing it buys
-- nothing.
create index if not exists recent_searches_verified_key_idx
  on recent_searches (user_id, property_type, verified_key)
  where verified_key is not null;

-- Bulk valuation rows point at the recent they created, not at a portfolio
-- item. The old portfolio_item_id column stays exactly as it is so that every
-- run already on a member's screen keeps its working /?property= link; new
-- runs fill this one instead and link to /?recent=.
alter table bulk_job_items add column if not exists recent_item_id uuid;
