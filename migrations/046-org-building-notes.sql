-- 046 — notes on a firm's building (Three Spaces, slice 5; 2026-09-02)
-- Plan:  ~/.claude/plans/could-you-help-me-mighty-crane.md ("Slice 5 — Each building has a sheet")
-- Spec:  docs/superpowers/specs/2026-09-01-three-spaces-design.md
-- Rules: org-buildings.js (validateNote, composeSheet), org-access.js (membership)
--
-- The plan numbered this 045; firm messaging took 044, so buildings became
-- 045 and this is 046.
--
-- Firm-wide, appended, attributed. A note is a sentence a colleague left on a
-- building's sheet — "owner says he'll consider offers after Q3", "roof
-- replaced 2021" — and the whole point of it is that the NEXT colleague to
-- open the sheet reads it. So it is org-scoped like org_contacts (039), not
-- member-scoped like the vault, and 039's reasoning carries over: every
-- member reads the whole list, and `added_by` is recorded so that if notes
-- should ever become private-by-default the ownership is already there.
--
-- Append-only in spirit: there is no edit route. A note is a record of what
-- somebody said when they said it; the author may delete their own. Nothing
-- here is ever collected from a lead, a hub or a report — it is typed.
--
-- CASCADE with the building: a note is a fact ABOUT a building on the firm's
-- board, and a building taken off the board takes its notes with it. That
-- is deliberately not the vault's "nothing deletes a lapsed vault" stance —
-- the board is the firm's index, not anybody's book.

create table if not exists org_building_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  building_id uuid not null references org_buildings(id) on delete cascade,

  body text not null,

  -- Who wrote it. SET NULL on account deletion, name kept — 039's rule.
  added_by_user_id uuid references users(id) on delete set null,
  added_by_name text not null default '',

  created_at timestamptz not null default now()
);

-- The sheet read: one building, newest first. org_id is in the query as the
-- second wall (every read carries it), the index is on what the read orders.
create index if not exists org_building_notes_building_idx
  on org_building_notes (building_id, created_at desc);

alter table org_building_notes enable row level security;

-- Verify (zero rows = applied):
--   select 'org_building_notes' where not exists (select 1 from information_schema.tables
--                                                 where table_schema = 'public' and table_name = 'org_building_notes');
--   select 'column: org_building_notes.' || c
--   from unnest(array['org_id','building_id','body','added_by_user_id','added_by_name','created_at']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_schema = 'public' and table_name = 'org_building_notes' and column_name = c)
--   union all
--   select 'index: org_building_notes_building_idx' where not exists (
--     select 1 from pg_indexes where schemaname = 'public' and indexname = 'org_building_notes_building_idx')
--   union all
--   select 'rls off on org_building_notes' where not exists (
--     select 1 from pg_class where relname = 'org_building_notes' and relrowsecurity);
