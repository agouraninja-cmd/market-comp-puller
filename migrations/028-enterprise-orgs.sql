-- 028 · Enterprise (firm) accounts, slice 1 (2026-08-16)
-- Spec:   docs/superpowers/specs/2026-08-16-enterprise-team-accounts-design.md
-- Module: org-access.js (who is in a firm; what their membership allows)
--
-- RUN THIS BEFORE DEPLOYING the /api/org* routes and the firm share branch.
-- PostgREST 400s on an unknown table AND on an unknown column, and this
-- migration touches BOTH: it adds `org_id` to `shared_reports`, which
-- getShareRecord() selects by name on every single share read. An unrun
-- migration therefore breaks existing public share links, not just the new
-- feature. That is deliberate — a hard, visible failure rather than migration
-- 004's silent one — but it is the reason this file is not optional.
--
-- Purely additive: no DROP, no destructive ALTER, nothing that rewrites an
-- existing row's meaning. Same rule as 016 and 019, and for the same reason —
-- there is no staging database to rehearse against.
--
-- ---------------------------------------------------------------------------
-- NAMING: "org" here, "firm" on screen
-- ---------------------------------------------------------------------------
-- Every identifier in this schema says org; every string a broker reads says
-- firm. One translation point, at the copy layer. org-access.js's header has
-- the argument; the thing to preserve is that the two never meet in the
-- middle.
--
-- ---------------------------------------------------------------------------
-- NO FILE FALLBACK, DELIBERATELY
-- ---------------------------------------------------------------------------
-- The stance of 013 (vault), 018 (invited shares) and 024 (hub), for their
-- reason: this is an access-control surface, and an access-control list in a
-- JSON file on an ephemeral disk is not one. With Supabase unconfigured every
-- /api/org route answers 503 rather than degrading into something that looks
-- like it works. Public shares keep the file fallback they have always had;
-- nothing here touches it.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT DO
-- ---------------------------------------------------------------------------
-- Slice 1 is membership plus a share audience. There is NO shelf table
-- (org_shelf_items, spec §4/§5) and NO shared vault (spec §7). Nothing here
-- widens any existing `user_id=eq.` read: a firm read is a new query against
-- these new tables, which is migration 013's separate-tables rule applied
-- again. If a future change adds `or=(user_id.eq.X,org_id.eq.Y)` to a vault
-- read, that is the failure this schema was shaped to make unnecessary.

-- ---------------------------------------------------------------------------
-- 1. The firm.
-- ---------------------------------------------------------------------------
create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- SET NULL, not cascade — 018's rule and 024's after it. The member who
  -- created a firm deleting their account must not vaporize the firm their
  -- colleagues are using. Ownership lives on org_members.role, not here; this
  -- column is provenance only.
  created_by uuid references users(id) on delete set null,
  -- Slice 2's default ('reports' publishes a member's new reports to the
  -- shelf automatically). Ships now, WRITTEN BY NOTHING in slice 1, for the
  -- same reason hub_items.status shipped early in 024: so slice 2 is a code
  -- change and not a migration. 'none' is the only value slice 1 can hold.
  share_default text not null default 'none'
    check (share_default in ('none', 'reports')),
  -- Slice 4's seat count (spec §9: seats are granted by hand until a firm
  -- asks to pay for them). Present, unenforced, and deliberately defaulted
  -- high enough that nothing in slice 1 reads it as a limit.
  seats integer not null default 200,
  created_at timestamptz not null default now()
);
alter table orgs enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Who is in it.
--
-- IDENTITY IS THE EMAIL, not a user id — 018's decision, adopted by 024 and
-- again here: a colleague invited before they have an account is recognized
-- the moment they sign up with that address, with nothing to reconcile.
-- user_id is stamped on accept as a convenience for joins, never as the thing
-- access is decided on.
--
-- AN INVITE IS NOT A MEMBERSHIP. joined_at is null until the invited person
-- themselves accepts, and org-access.js's isActive() requires it. This is not
-- politeness: because identity is an email, anyone can write anyone's address
-- into their own org_members table, so without the accept step adding a
-- stranger's address would put a firm's shared reports on that stranger's
-- desk and offer their next report a "share with my firm" button pointing at
-- a firm they have never heard of.
--
-- THERE IS NO DOMAIN COLUMN, and that is a decision rather than an omission.
-- Auto-joining on an email domain treats gmail.com as a company, and even a
-- real corporate domain proves only that someone can receive mail there. A
-- domain may one day SUGGEST an invite to an admin; it may never grant one,
-- and a column here would be the first step toward the query that does.
-- Spec §3.
-- ---------------------------------------------------------------------------
create table if not exists org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,                      -- normalized (lowercased, trimmed) by org-access.js at write time
  -- Stamped on accept. SET NULL on account deletion so the row survives as a
  -- member record rather than disappearing from a firm's list mid-audit.
  user_id uuid references users(id) on delete set null,
  -- An unrecognized role reads as 'member' in org-access.js (the least
  -- privileged). The check constraint and the module agree on purpose: the
  -- constraint stops the row, the module stops the grant if the row somehow
  -- exists anyway. Same pattern as 024's participant role.
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  invited_by uuid references users(id) on delete set null,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,                    -- null = invited, not a member
  -- Beats everything, ownership included. One-way, matching the vault's and
  -- 018's stance that access lapsing is safer than access silently returning.
  removed_at timestamptz,
  unique (org_id, email)
);
-- "My firms" and "my pending invites" both read by email, the same shape as
-- report_viewers_email_idx and hub_participants_email_idx.
create index if not exists org_members_email_idx on org_members (email);
-- The member list, and the org-id set that feeds report-access.js's firm
-- branch. Partial on removed_at: a removed member is never either.
create index if not exists org_members_org_idx on org_members (org_id)
  where removed_at is null;
alter table org_members enable row level security;

-- ---------------------------------------------------------------------------
-- 3. A report shared with a firm.
--
-- A THIRD VISIBILITY, not a viewer list of everyone's address. The viewer
-- list is a snapshot of who was named; a firm is a membership that changes
-- after the share is created — somebody joins next month and should see it,
-- somebody removed today should not. Expanding a firm into report_viewers
-- rows at share time would freeze both of those wrong.
--
-- SET NULL on org delete, so a share whose firm is gone falls back to the
-- invited path (its viewer list, which for a firm share is empty) and becomes
-- readable by its owner alone. That is fail-closed: the alternative, a
-- dangling id, is a share nobody can revoke.
--
-- report-access.js requires BOTH visibility = 'org' AND a non-null org_id
-- before it consults membership, so neither column alone can widen a share.
-- ---------------------------------------------------------------------------
alter table shared_reports
  add column if not exists org_id uuid references orgs(id) on delete set null;

-- "Shared with my firm" on /desk reads by org, newest first.
create index if not exists shared_reports_org_idx
  on shared_reports (org_id, created_at desc)
  where org_id is not null;

-- ---------------------------------------------------------------------------
-- Verify (zero rows = applied). `node migrations/verify.js` asks the same
-- questions through PostgREST, which is the way the app itself would trip.
--
--   select t from unnest(array['orgs','org_members']) as t
--   where not exists (select 1 from information_schema.tables
--                     where table_schema = 'public' and table_name = t);
--
--   select 'column: ' || tc || '.' || c
--   from (values
--     ('orgs','share_default'), ('orgs','seats'),
--     ('org_members','joined_at'), ('org_members','removed_at'),
--     ('shared_reports','org_id')) as v(tc, c)
--   where not exists (select 1 from information_schema.columns
--                     where table_schema = 'public' and table_name = tc and column_name = c);
-- ---------------------------------------------------------------------------
