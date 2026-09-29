-- 054 — tracking your own permit (2026-09-27)
-- Rules:  permit-watch.js (the five steps, what a status change announces,
--         the email copy), permit-portals.js's lookupPermit (the read)
-- Routes: GET /api/permits/mine, GET /api/permits/unread,
--         POST|PATCH|DELETE /api/permits/watch, POST /api/permits/seen;
--         the re-check rides POST /api/permits/sweep (ADMIN_KEY), driven by
--         .github/workflows/permit-sweep.yml on weekday mornings
--
-- ---------------------------------------------------------------------------
-- PER MEMBER, NOT PUBLIC RECORD
-- ---------------------------------------------------------------------------
-- permit_filings (052) is public record with no user_id. A WATCH is the
-- opposite: which permits one member cares about, what they called them, and
-- how they want to be told. Every read and write is scoped `user_id=eq.` to
-- the signed-in member and nothing else reads it but the sweep's re-check.
-- The permit's own facts (status, address, portal link) are copied onto the
-- watch from the city portal, deliberately NOT joined to permit_filings: a
-- member's permit may be residential, or older than the sweep's window, and
-- the sweep never stored it.
--
-- ---------------------------------------------------------------------------
-- NO FILE FALLBACK (CLAUDE.md rule 4)
-- ---------------------------------------------------------------------------
-- Without a database the routes refuse (503): Render erases its disk on every
-- deploy, and a watch list that quietly vanished would stop notifying people
-- who believe they are covered.
--
-- ---------------------------------------------------------------------------
-- THE TWO LEDGERS
-- ---------------------------------------------------------------------------
-- passed_steps: the steps this permit has been seen at or past, so a step's
--   notice fires once, ever — a permit that drops back and returns is not
--   announced twice, and adding an already-issued permit announces nothing.
-- permit_watch_events.emailed_at: stamped only AFTER the send succeeds
--   (rule 12). A skipped or failed send leaves email_due set and emailed_at
--   null, and the next sweep retries it for up to seven days.
--
-- Deploy order is SOFT and the blast radius is the feature alone: /permits
-- reads the tables inside its own try, so an unrun 054 costs the "Your
-- permits" section (it says it is unavailable) and the sweep's re-check (a
-- named line in its summary), never the public feed or the city sweep. Run
-- it BEFORE deploying anyway, so the section works the moment it appears.
-- Purely additive and idempotent.

create table if not exists permit_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  jurisdiction text not null,
  permit_number text not null,
  label text,
  address text,
  description text,
  source_url text,
  status text,
  status_changed_at timestamptz,
  last_checked_at timestamptz,
  check_error text,
  passed_steps jsonb not null default '[]'::jsonb,
  notify_steps jsonb not null default '["approved","issued","final"]'::jsonb,
  notify_any boolean not null default false,
  notify_alerts boolean not null default true,
  notify_email boolean not null default true,
  notify_app boolean not null default true,
  created_at timestamptz not null default now()
);
-- One watch per member per permit; the add route answers 409 on a repeat.
create unique index if not exists permit_watches_user_permit_key
  on permit_watches (user_id, jurisdiction, permit_number);
-- The sweep reads every watch, stalest first.
create index if not exists permit_watches_checked_idx
  on permit_watches (last_checked_at nulls first);

create table if not exists permit_watch_events (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references permit_watches(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  old_status text,
  new_status text not null,
  kind text not null,
  steps jsonb not null default '[]'::jsonb,
  -- The headline ("Step complete: Issued"), null when the change notified
  -- nobody (the member did not ask about it). Such a change is still a row:
  -- the page's history shows every move.
  notice text,
  -- Shown on CompNinja as unread until the member opens /permits.
  app boolean not null default false,
  seen_at timestamptz,
  email_due boolean not null default false,
  emailed_at timestamptz,
  detected_at timestamptz not null default now()
);
create index if not exists permit_watch_events_user_idx
  on permit_watch_events (user_id, detected_at desc);
create index if not exists permit_watch_events_watch_idx
  on permit_watch_events (watch_id, detected_at desc);

-- Service role only, like every other table (the app connects with
-- SUPABASE_SERVICE_KEY, which bypasses RLS; enabling it with no policies
-- denies the anon and authenticated keys entirely).
alter table permit_watches enable row level security;
alter table permit_watch_events enable row level security;
