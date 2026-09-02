-- 047 — the firm's leases (Three Spaces, slice 6; 2026-09-02)
-- Plan:  ~/.claude/plans/could-you-help-me-mighty-crane.md ("Slice 6 — Leases, and the dates that matter")
-- Spec:  docs/superpowers/specs/2026-09-01-three-spaces-design.md
-- Rules: org-leases.js (what may be stored, the critical-dates window), org-access.js (membership)
--
-- The plan numbered this 046; messaging took 044, so buildings became 045,
-- notes 046 and this is 047.
--
-- ---------------------------------------------------------------------------
-- A LEASE THE FIRM MANAGES IS A DIFFERENT NOUN FROM A LEASE COMP
-- ---------------------------------------------------------------------------
-- broker_comps.lease_expiry (038) is a fact about a COMPARABLE, in one
-- broker's private book, used to remind that broker. This is a record of a
-- lease the FIRM holds or manages: tenant, suite, term, option notice — the
-- thing "what expires next year" is a question about. Building it as a view
-- over vault rows would be a widened user_id read (013's rule) and would
-- double-count a lease two colleagues both filed. New table, new functions,
-- firm-scoped like org_contacts and org_building_notes.
--
-- ---------------------------------------------------------------------------
-- renewal_notified_at SHIPS UNWRITTEN
-- ---------------------------------------------------------------------------
-- The orgs.share_default / hub_items.status precedent: the column exists so
-- wiring a reminder later is a code change and not a second SQL trip. This
-- slice does NOT send anything. renewal-watch.js governs one of only two
-- things this product mails on its own initiative, its bar is "when in
-- doubt, send nothing", and one-email-per-lease-ever is enforced by a single
-- high-water mark on broker_comps. A second source would let two tables each
-- claim to have sent it — and there is an unanswered product question, which
-- MEMBER at a firm gets the mail, that is the owner's to decide.
--
-- Dates are `date`, not timestamptz: a lease expires on a calendar day.

create table if not exists org_leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  building_id uuid not null references org_buildings(id) on delete cascade,

  tenant text not null,
  suite text,
  size_sqft numeric,
  term_start date,
  lease_expiry date not null,
  -- Refused at the door when AFTER lease_expiry — an option notice is given
  -- before a term ends, so the later date is the expiry by definition.
  option_notice_date date,
  rent_psf numeric,
  -- Required whenever rent_psf is present and NEVER defaulted (029's rule):
  -- $1.35/SF is an ordinary monthly rent and an impossible annual one.
  rent_basis text check (rent_basis is null or rent_basis in ('annual', 'monthly')),
  lease_type text check (lease_type is null or lease_type in ('NNN', 'FS', 'MG')),
  status text not null default 'active',
  notes text,

  -- Who filed it. SET NULL on account deletion, name kept — 039's rule.
  added_by_user_id uuid references users(id) on delete set null,
  added_by_name text not null default '',

  -- Unwritten by this slice; see above.
  renewal_notified_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The sheet read: one building's leases.
create index if not exists org_leases_building_idx
  on org_leases (org_id, building_id);
-- The critical-dates read: one firm's leases by when they end.
create index if not exists org_leases_expiry_idx
  on org_leases (org_id, lease_expiry);

alter table org_leases enable row level security;

-- Verify (zero rows = applied):
--   select 'org_leases' where not exists (select 1 from information_schema.tables
--                                         where table_schema = 'public' and table_name = 'org_leases');
--   select 'column: org_leases.' || c
--   from unnest(array['org_id','building_id','tenant','suite','size_sqft','term_start','lease_expiry',
--                     'option_notice_date','rent_psf','rent_basis','lease_type','status','notes',
--                     'added_by_user_id','added_by_name','renewal_notified_at']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_schema = 'public' and table_name = 'org_leases' and column_name = c)
--   union all
--   select 'index: ' || i
--   from unnest(array['org_leases_building_idx','org_leases_expiry_idx']) as i
--   where not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = i)
--   union all
--   select 'rls off on org_leases' where not exists (
--     select 1 from pg_class where relname = 'org_leases' and relrowsecurity);
