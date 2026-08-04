-- 000 · Baseline: the tables created BY HAND in the Supabase SQL editor before
-- this migrations folder existed. Their original DDL was never recorded, so
-- everything below is RECONSTRUCTED from what server.js reads and writes.
-- The live tables may differ in details (extra columns, identity ids).
--
-- DO NOT run this against the production database — these tables already
-- exist there. It exists so the schema is documented in one place, and so a
-- fresh environment (a new Supabase project) can be stood up from scratch.

-- POST /api/lead → storeRow("leads", ...). `source` is 'export' | 'bov'.
create table if not exists leads (
  ts timestamptz not null default now(),
  name text not null,
  email text not null,
  phone text,
  company text,
  address text,
  type text,
  source text
);

-- The 30-day search cache. Upserted with on_conflict=cache_key, so cache_key
-- must be unique (primary key).
create table if not exists search_cache (
  cache_key text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- Published share links (/r/<id>). No expiry by design.
create table if not exists shared_reports (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- PII-free analytics events (logEvent in server.js).
create table if not exists analytics_events (
  ts timestamptz not null default now(),
  kind text not null,
  prop_type text,
  market text,
  source text,
  cached boolean
);

-- Broker comp submissions (POST /api/comp-submission). The id column is
-- documented in server.js as "id bigint generated always as identity".
-- status: 'pending' | 'approved' | 'rejected' — approved rows become the
-- verified comp layer. cited_count is added later in 003.
create table if not exists comp_submissions (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  status text not null default 'pending',
  broker_name text,
  broker_email text,
  broker_phone text,
  broker_company text,
  address text not null,
  property_type text,
  transaction text,
  deal_date text,
  size_sqft text,
  price_or_rate text,
  cap_rate text,
  notes text
);
