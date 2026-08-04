-- 008 · Pro tier billing (2026-07-31) — run BEFORE deploying with
-- PRO_ENABLED=on. These tables have NO file fallback by design: Render's
-- filesystem is ephemeral, and a subscription written to disk would vanish on
-- the next deploy, silently turning a paying customer into a free user.

alter table users add column if not exists stripe_customer_id text;
create unique index if not exists users_stripe_customer_id_idx
  on users (stripe_customer_id) where stripe_customer_id is not null;

create table subscriptions (
  user_id uuid primary key references users(id) on delete cascade,
  stripe_subscription_id text unique,
  stripe_customer_id text,
  plan text not null,                  -- pro_monthly | pro_annual_founding
  status text not null,                -- active | past_due | grace | cancelled
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  grace_until timestamptz,             -- set when a payment fails (7 days)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One subscription per user by primary key: a second checkout by the same
-- person must UPDATE, never insert a rival row that could out-rank it.

create table branding_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  logo_url text, firm_name text, preparer_name text,
  phone text, email text, license_number text, disclaimer text,
  updated_at timestamptz not null default now()
);

create table report_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  report_id text not null,             -- reportIdFor(): hash of address|type|months
  stripe_payment_intent_id text unique,
  comp_snapshot jsonb,                 -- NULLABLE, and unused — see below
  purchased_at timestamptz not null default now(),
  unique (user_id, report_id)
);
create index on report_purchases (user_id, report_id);

-- If the table was already created with `comp_snapshot jsonb not null`, run
-- this before deploying the single-report unlock or every webhook insert 400s
-- and a paid purchase is never recorded:
--   alter table report_purchases alter column comp_snapshot drop not null;
--
-- Why it is nullable and empty: the row is written by the Stripe webhook,
-- which carries a session and a payment intent and NO report data — the
-- report is a client-side artifact. The unlock is keyed on the SEARCH
-- (address+type+lookback), so re-running that search re-serves it ungated
-- from the cache for free, and computeEntitlements never reads a snapshot:
-- it only flips maxComps/canBrand/exportsRemaining off the row's EXISTENCE.
-- The column is kept for a future "comps exactly as you bought them"
-- feature, which would need a pending row written at checkout creation.

-- One row per REPORT exported, not one per click. The primary key makes a
-- second export of the same report in the same month a no-op, so wanting a
-- report as both a CSV and a PDF costs one, not two. The tally is the row
-- COUNT for (user_id, period) — there is no counter column to race on.
create table export_usage (
  user_id uuid not null references users(id) on delete cascade,
  period text not null,                -- 'YYYY-MM', UTC
  report_key text not null,            -- stable per report; see reportKeyOf()
  created_at timestamptz not null default now(),
  primary key (user_id, period, report_key)
);

-- Stripe retries webhooks; this is what makes handlers idempotent.
create table stripe_events (
  id text primary key,                 -- Stripe's event id (evt_...)
  type text,
  received_at timestamptz not null default now()
);

-- Verify (zero rows = schema complete):
--   select t from unnest(array['subscriptions','branding_profiles',
--     'report_purchases','export_usage','stripe_events']) as t
--   where not exists (select 1 from information_schema.tables
--                     where table_name = t);
