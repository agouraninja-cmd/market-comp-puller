-- 066 · Contacts gain a phone and a source; every member gets a list of their
--       own; owner lookups (2026-11-23)
-- Rules: org-contacts.js (the contact fields), owner-lookup.js (the lookup)
-- Docs:  .claude/rules/owner-lookup.md
--
-- DEPLOY ORDER IS SOFT. server.js PROBES for what this file adds (061's and
-- 063's pattern) and names none of it until a read has seen it. Deployed
-- ahead of this migration, the firm's contact list works exactly as before
-- with its four fields, and the three new things (a phone number, a member's
-- own list, owner lookup) answer "not switched on yet". Nothing else reads
-- any of it.
--
-- PURELY ADDITIVE: three nullable columns and two new tables. Nothing is
-- altered, dropped or backfilled.
--
-- ---------------------------------------------------------------------------
-- 1. A firm's contacts: a phone number, and where a contact came from
-- ---------------------------------------------------------------------------
-- `phone` is kept as typed (an extension and a country code are written on
-- purpose); org-contacts.js refuses what is not a number.
--
-- `source` is null for a contact somebody typed or imported, and 'lookup'
-- for one a member saved from an owner lookup; `source_url` is the public
-- page that person was read from. THE LIST IS STILL NEVER COLLECTED (039):
-- nothing writes a row here on its own. A 'lookup' row was saved by a member
-- pressing Save on that one person.
alter table org_contacts add column if not exists phone text;
alter table org_contacts add column if not exists source text;
alter table org_contacts add column if not exists source_url text;

-- ---------------------------------------------------------------------------
-- 2. A member's OWN contacts
-- ---------------------------------------------------------------------------
-- Until now a contact list existed only inside a firm, so a broker working
-- alone had nowhere to keep one. This is the same list scoped to one account:
-- private to that member, read and written only by /api/account/contacts,
-- every call scoped by user_id.
--
-- A SEPARATE TABLE, not org_contacts with a nullable org_id (013's rule, a
-- fourth time): the firm read is `org_id=eq.`, and a personal row reachable
-- by widening that filter is a member's private client list on a colleague's
-- screen. A member in a firm keeps both lists and chooses which one a contact
-- goes on; nothing moves between them on its own.
create table if not exists user_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,

  name text not null,
  email text,
  phone text,
  company text,
  notes text,
  source text,
  source_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_contacts_user_idx
  on user_contacts (user_id, created_at desc);

-- PLAIN, not partial and not on lower(email): 039's correction. PostgREST's
-- on_conflict=user_id,email needs an index on exactly those columns, case is
-- handled at write time (normalizeContact lowercases), and NULLs stay
-- distinct so two contacts with no email are never merged.
create unique index if not exists user_contacts_email_idx
  on user_contacts (user_id, email);

alter table user_contacts enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Owner lookups
-- ---------------------------------------------------------------------------
-- One row per search a member ran. It is three things at once:
--   the member's history (reopening a building within 90 days is free),
--   the monthly allowance (rows this month are what has been used), and
--   the answer itself (`result`, what owner-lookup.js's parseAnswer kept).
--
-- USER-SCOPED, AND NEVER READ FOR ANOTHER ACCOUNT. Which buildings a broker
-- is chasing is their book, and an answer names real people. There is
-- deliberately no shared cache across accounts: this is a search a member
-- ran for themselves, not a file of owners CompNinja keeps and sells.
--
-- No file fallback (never-break rule 4): the route refuses without a
-- database. Deleting the account deletes its lookups.
create table if not exists owner_lookups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,

  address text not null,
  address_key text not null,
  property_type text,
  found boolean not null default false,
  result jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

-- The allowance count and the history: one member, newest first.
create index if not exists owner_lookups_user_idx
  on owner_lookups (user_id, created_at desc);
-- The repeat lookup: one member, one building.
create index if not exists owner_lookups_key_idx
  on owner_lookups (user_id, address_key, created_at desc);

alter table owner_lookups enable row level security;

-- Verify (zero rows = applied):
--   select 'table: ' || t
--   from unnest(array['user_contacts','owner_lookups']) as t
--   where not exists (select 1 from information_schema.tables
--                     where table_schema = 'public' and table_name = t)
--   union all
--   select 'column: org_contacts.' || c
--   from unnest(array['phone','source','source_url']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_schema = 'public' and table_name = 'org_contacts' and column_name = c)
--   union all
--   select 'index: ' || i
--   from unnest(array['user_contacts_user_idx','user_contacts_email_idx','owner_lookups_user_idx','owner_lookups_key_idx']) as i
--   where not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = i)
--   union all
--   select 'rls off on ' || t
--   from unnest(array['user_contacts','owner_lookups']) as t
--   where not exists (select 1 from pg_class where relname = t and relrowsecurity);
