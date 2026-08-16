-- 024 · The messaging hub (2026-08-13) — brokers and tenants trading comps
-- in one place instead of in an email thread.
-- Spec: docs/superpowers/specs/2026-08-13-messaging-hub-design.md
--
-- RUN THIS BEFORE DEPLOYING the hub routes, and run 023 first. PostgREST 400s
-- on an unknown table and the hub deliberately has NO file fallback (see the
-- privacy note below), so an unrun migration here is a hard, visible failure
-- rather than a silent one. Verify with `node migrations/verify.js`.
--
-- ---------------------------------------------------------------------------
-- NAMING: this is NOT the connection hub
-- ---------------------------------------------------------------------------
-- Three other things in this repo are already called a hub: the public broker
-- directory at /brokers (the "connection hub", which is what ROADMAP's "Hub
-- ratings" and "Hub monetization" lines mean), the /dev changelog ("Dev hub"),
-- and an aspiration in a server.js comment. None of them are these tables.
-- The owner named this feature the messaging hub on 2026-08-13; the spec's
-- naming warning is the place that keeps the four apart.
--
-- ---------------------------------------------------------------------------
-- NO FILE FALLBACK, DELIBERATELY
-- ---------------------------------------------------------------------------
-- Same stance as the vault (013) and invited shares (018), for the same
-- reason: this is an access-control surface, and an access-control list in a
-- JSON file on an ephemeral disk is not one. With Supabase unconfigured every
-- hub route answers 503 rather than degrading into something that looks like
-- it works. Public shares keep their file fallback; nothing here touches it.
--
-- ---------------------------------------------------------------------------
-- WHAT A HUB HOLDS, AND WHY IT IS A SNAPSHOT
-- ---------------------------------------------------------------------------
-- hub_items.snapshot is a COPY of the comp as it was sent, never a join back
-- to broker_comps. The repo has already decided this shape twice — report
-- branding is "a snapshot taken at share time" (branding.js) and a shared
-- report is "decided entirely by its own snapshot". The reason is stronger
-- here: a live join would let a later vault edit silently rewrite what a
-- tenant read last week. A record of what was disclosed is the only version
-- worth keeping.

-- ---------------------------------------------------------------------------
-- 1. The hub itself.
-- ---------------------------------------------------------------------------
create table if not exists hubs (
  id text primary key,                       -- short public id, reportIdFor() alphabet
  -- SET NULL, not cascade — migration 018's rule, and it holds here for the
  -- same reason: a broker deleting their account must not vaporize a
  -- conversation their client is relying on. An ownerless hub goes read-only
  -- (hub-access.js enforces it) and says so. Silent disappearance is the one
  -- outcome that is never honest.
  owner_user_id uuid references users(id) on delete set null,
  title text not null default '',
  market text,                               -- canonical marketOf() form, same as broker_comps
  property_type text,
  subject_address text,
  -- 'closed' is READ-ONLY, not revoked: everyone keeps access to what is
  -- already here. Revoking one person is removed_at on their participant row.
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
-- The broker's list on /vault, and nothing else, reads by owner.
create index if not exists hubs_owner_idx
  on hubs (owner_user_id, updated_at desc)
  where owner_user_id is not null;
alter table hubs enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Who is in it.
--
-- IDENTITY IS THE EMAIL, not a user id — migration 018's decision, adopted
-- wholesale. A tenant invited before they have an account is recognized the
-- moment they sign up with that address, with nothing to reconcile. user_id
-- is NOT written by anything today. This comment used to claim it was
-- "stamped on the first authenticated read"; nothing stamped it, and the
-- column has been null on every row since the table shipped (verified on
-- production 2026-08-14). Harmless, because identity is the email and the
-- email match is what actually resolves a participant — but a schema comment
-- describing behaviour that does not exist is worse than no comment, so this
-- says what is true. Fill it only if something needs the join; access must
-- keep being decided on the email.
--
-- ONE TOKEN PER PARTICIPANT, HASHED. A single hub-wide link cannot say who
-- said what, and a forwarded hub-wide link cannot be cut off without cutting
-- everyone off. Only sha256(token) is stored: a database read must not hand
-- someone the keys to every live hub. The raw token exists once, in the
-- invite link the create route returns, and is never recoverable after.
-- ---------------------------------------------------------------------------
create table if not exists hub_participants (
  id uuid primary key default gen_random_uuid(),
  hub_id text not null references hubs(id) on delete cascade,
  email text not null,                       -- normalized (lowercased, trimmed) by hub-access.js at write time
  -- An unrecognized role reads as 'observer' in hub-access.js (read, never
  -- write). The check constraint and the module agree on purpose: the
  -- constraint stops the row, the module stops the write if the row somehow
  -- exists anyway.
  role text not null default 'tenant' check (role in ('broker', 'tenant', 'observer')),
  user_id uuid references users(id) on delete set null,
  token_hash text not null,
  invited_at timestamptz not null default now(),
  first_viewed_at timestamptz,               -- stamped once, on the first successful read
  last_seen_at timestamptz,                  -- the unread count, and nothing more
  removed_at timestamptz,                    -- beats everything, ownership included
  unique (hub_id, email)
);
-- "Hubs shared with me" on /desk reads by email, the same shape as
-- report_viewers_email_idx.
create index if not exists hub_participants_email_idx on hub_participants (email);
-- The token lookup on POST /api/hub/access.
create index if not exists hub_participants_token_idx on hub_participants (token_hash);
alter table hub_participants enable row level security;

-- ---------------------------------------------------------------------------
-- 3. What is in it. See the snapshot note at the top.
-- ---------------------------------------------------------------------------
create table if not exists hub_items (
  id uuid primary key default gen_random_uuid(),
  hub_id text not null references hubs(id) on delete cascade,
  kind text not null check (kind in ('comp', 'report', 'note')),
  source text not null check (source in ('vault', 'report', 'corpus', 'manual')),
  source_ref text,                           -- broker_comps.id, shared_reports.id; null for manual
  snapshot jsonb not null,                   -- the comp AS SENT
  -- true when it came out of the vault. Drives the "private to your vault"
  -- confirm on the way in and the badge on the way out. It does NOT mean the
  -- tenant sees less: the owner answered full detail, per-comp opt-in.
  private boolean not null default false,
  -- Slice 1 writes 'new' and never changes it; the pipeline is slice 2. The
  -- column ships now so slice 2 is not a migration.
  status text not null default 'new' check (status in ('new', 'shortlist', 'toured', 'passed')),
  status_by uuid references users(id) on delete set null,
  status_at timestamptz,
  added_by_email text not null,
  added_at timestamptz not null default now(),
  removed_at timestamptz
);
create index if not exists hub_items_hub_idx on hub_items (hub_id, added_at);
-- PARTIAL on removed_at: a comp may be re-sent after being removed, which is
-- exactly how the snapshot rule expects a corrected price to travel (a new
-- row saying "updated by the broker", never a mutation of the old one).
create unique index if not exists hub_items_live_source_uidx
  on hub_items (hub_id, source, source_ref)
  where removed_at is null and source_ref is not null;
alter table hub_items enable row level security;

-- ---------------------------------------------------------------------------
-- 4. The talking. item_id null = hub-level; set = a note on one comp.
-- Per-comp threads are slice 2, but the column ships now for the same reason
-- hub_items.status does.
--
-- No read receipts beyond hub_participants.last_seen_at: per-message receipts
-- are three tables of state to answer a question nobody asked, and they make
-- a slow reply feel accusatory.
-- ---------------------------------------------------------------------------
create table if not exists hub_messages (
  id uuid primary key default gen_random_uuid(),
  hub_id text not null references hubs(id) on delete cascade,
  item_id uuid references hub_items(id) on delete cascade,
  author_email text not null,
  author_user_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- The polling read: everything in this hub after a cursor.
create index if not exists hub_messages_hub_idx on hub_messages (hub_id, created_at);
alter table hub_messages enable row level security;

-- ---------------------------------------------------------------------------
-- Verify (zero rows = applied). `node migrations/verify.js` asks the same
-- questions through PostgREST, which is the way the app itself would trip.
--
--   select t from unnest(array['hubs','hub_participants','hub_items','hub_messages']) as t
--   where not exists (select 1 from information_schema.tables
--                     where table_schema = 'public' and table_name = t);
--
--   select 'column: ' || tc || '.' || c
--   from (values
--     ('hubs','owner_user_id'), ('hubs','closed_at'),
--     ('hub_participants','token_hash'), ('hub_participants','removed_at'),
--     ('hub_items','snapshot'), ('hub_items','private'),
--     ('hub_messages','item_id')) as v(tc, c)
--   where not exists (select 1 from information_schema.columns
--                     where table_schema = 'public' and table_name = tc and column_name = c);
-- ---------------------------------------------------------------------------
