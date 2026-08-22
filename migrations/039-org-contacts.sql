-- 039 · A firm's own tenant contacts (2026-08-22)
-- Plan:  docs/superpowers/plans/2026-08-21-divide-and-conquer-to-aug-27.md (O5)
-- Rules: org-contacts.js (validation), org-access.js (membership)
--
-- ---------------------------------------------------------------------------
-- NOT `contacts`. THAT TABLE ALREADY EXISTS AND IS SOMETHING ELSE.
-- ---------------------------------------------------------------------------
-- Migration 007 created `contacts`: the owner's internal rolodex behind
-- `/contacts`, ADMIN_KEY-gated, holding leads and prospects CompNinja itself
-- collected. This is a customer's own address book, scoped to their firm, and
-- the two must never meet. `org_contacts` keeps them apart by name as well as
-- by scope, so a future reader cannot mistake one for the other.
--
-- ---------------------------------------------------------------------------
-- NOTHING HERE IS EVER AUTO-POPULATED FROM COMPNINJA LEADS
-- ---------------------------------------------------------------------------
-- The plan states this as a condition of building the feature at all, and it
-- is the reason the table is deliberately dull. Lead routing in this product
-- is owner-mediated and anonymized by standing rule: a broker sees a lead's
-- market, type, size and date and never the owner's name, email, phone or
-- street address (`LEADSVC.anonymizeLead`). A firm's contact list must be data
-- the firm TYPED or IMPORTED. Wiring `leads` into this table would hand a
-- broker exactly the PII that every other surface exists to withhold, and it
-- would do it silently, which is worse.
--
-- The same applies to hub participants, which do carry real tenant emails: a
-- tenant who agreed to talk to one broker through one hub did not thereby
-- agree to join that firm's marketing list. If contacts ever gain an import
-- from hubs it needs its own consent surface, disclosed, per §5.
--
-- ---------------------------------------------------------------------------
-- FIRM-WIDE, BUT `added_by` IS RECORDED (Owen's call, 2026-08-22)
-- ---------------------------------------------------------------------------
-- Every member of the firm reads the whole list. That is what was asked for,
-- and it is deliberately NOT the shape `broker_comps` → `org_comps` uses,
-- where a comp is private to the member and shared one at a time.
--
-- The tension is real and was weighed rather than missed: a broker's client
-- relationships are at least as sensitive as their comps, and the vault wall
-- exists because colleagues compete. The reason it goes the other way here is
-- that a shared tenant list is the thing a firm actually needs in order to
-- cover for each other, which is the wishlist item this came from.
--
-- `added_by_user_id` is what keeps the other decision reversible. If contacts
-- should later become private-by-default with an opt-in, the ownership is
-- already recorded and that becomes a code change rather than a migration plus
-- a data cleanup nobody can do correctly after the fact. A column now is much
-- cheaper than asking every firm later whose contact was whose.
--
-- `added_by_name` is denormalized at write time for 032's reason, learned
-- again in 038: `on delete set null` means a departed member's rows lose the
-- join, and a list that cannot say who added a contact is a list nobody can
-- follow up on. Name only, never the email — persisting an address would
-- outlive the account it belongs to.

create table if not exists org_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,

  -- Who added it. SET NULL on account deletion, name kept — see above.
  added_by_user_id uuid references users(id) on delete set null,
  added_by_name text not null default '',

  -- The contact itself. `name` is the only required field: a tenant rep who
  -- knows a company and a person but not yet an email still has a contact
  -- worth recording, and refusing that row would push it into a spreadsheet
  -- where this feature cannot help.
  name text not null,
  email text,
  company text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The list read: one firm, newest first.
create index if not exists org_contacts_org_idx
  on org_contacts (org_id, created_at desc);

-- One person is one row per firm, and this index is what the import's upsert
-- names in its ON CONFLICT.
--
-- PLAIN, not partial, and not on `lower(email)` — and that is a correction
-- rather than a preference. The first draft was
-- `unique (org_id, lower(email)) where email is not null`, which reads better
-- and is unusable: PostgREST's `on_conflict=org_id,email` becomes
-- `ON CONFLICT (org_id, email)`, and Postgres requires an index matching those
-- columns EXACTLY. An expression index over `lower(email)`, or a partial one,
-- matches nothing, so every import would have failed with "there is no unique
-- or exclusion constraint matching the ON CONFLICT specification". The stand-in
-- PostgREST in the test suite does not model that, so the tests passed and
-- production would not have — its own header says it is a stand-in and not a
-- Postgres, and this is exactly that gap.
--
-- Case is handled at WRITE time instead: `normalizeContact` lowercases every
-- address before it is stored, so a plain unique index is case-insensitive in
-- effect. That is 013's `dedupe_key` argument — normalize into the column
-- rather than into the index.
--
-- NULLs stay DISTINCT, which is Postgres's default and is wanted here: a
-- contact with no email is never merged with another, because two people
-- sharing a name may be two people. `dropExisting` makes the same decision in
-- the application, so the two agree.
create unique index if not exists org_contacts_email_idx
  on org_contacts (org_id, email);

alter table org_contacts enable row level security;

-- Verify (zero rows = applied):
--   select 'org_contacts' where not exists (select 1 from information_schema.tables
--                                           where table_schema = 'public' and table_name = 'org_contacts');
--   select 'column: org_contacts.' || c
--   from unnest(array['org_id','added_by_user_id','added_by_name','name','email','company','notes']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_schema = 'public' and table_name = 'org_contacts' and column_name = c)
--   union all
--   select 'index: ' || i
--   from unnest(array['org_contacts_org_idx','org_contacts_email_idx']) as i
--   where not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = i)
--   union all
--   select 'rls off on org_contacts' where not exists (
--     select 1 from pg_class where relname = 'org_contacts' and relrowsecurity);
