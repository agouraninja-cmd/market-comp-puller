-- 067 · The owner lookup's removal list (2026-11-26)
-- Rules: owner-lookup.js rule 8 (suppressionKey, applySuppressions)
-- Docs:  .claude/rules/owner-lookup.md ("Removal requests")
--
-- A person who asks CompNinja to stop showing their details in owner lookups
-- goes on this list, one row per thing to hide: a property address (the
-- lookup refuses it before any search), a person's or company's name, a
-- phone number or an email address (scrubbed out of every answer, fresh and
-- stored). Written only by /admin's "Removal requests" box
-- (/api/admin/owner-suppressions, ADMIN_KEY), never by a member.
--
-- `value_key` is what the check matches (owner-lookup.js suppressionKey: a
-- normalized address, a lowercased name, ten phone digits, a lowercased
-- email). `label` is the value as the owner typed it, so the list reads back
-- as something a person recognizes. `note` is who asked and when, for the
-- record a privacy law expects.
--
-- DEPLOY ORDER IS SOFT. Before this runs, the lookup reads an empty list
-- (a missing table can hold no removal yet) and the admin box answers "run
-- migration 067". PURELY ADDITIVE: one new table.
create table if not exists owner_suppressions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('address', 'name', 'phone', 'email')),
  value_key text not null,
  label text,
  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists owner_suppressions_key_idx
  on owner_suppressions (kind, value_key);

alter table owner_suppressions enable row level security;

-- Verify (zero rows = applied):
--   select 'table: owner_suppressions'
--   where not exists (select 1 from information_schema.tables
--                     where table_schema = 'public' and table_name = 'owner_suppressions')
--   union all
--   select 'index: owner_suppressions_key_idx'
--   where not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'owner_suppressions_key_idx')
--   union all
--   select 'rls off on owner_suppressions'
--   where not exists (select 1 from pg_class where relname = 'owner_suppressions' and relrowsecurity);
