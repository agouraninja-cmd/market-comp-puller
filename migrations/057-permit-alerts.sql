-- 057 — permit alerts on the Permit tracker (2026-10-01, Draft B)
-- Rules:  permit-alerts.js (what an alert matches, what is new, the email)
-- Routes: POST|PATCH|DELETE /api/permits/alerts; /permits boots the list;
--         the weekday email rides POST /api/permits/sweep (ADMIN_KEY), driven
--         by .github/workflows/permit-sweep.yml
--
-- ---------------------------------------------------------------------------
-- PER MEMBER, LIKE 054
-- ---------------------------------------------------------------------------
-- An alert is one member's saved filter over the public permit_filings: a
-- city (jurisdiction key, null for every city the sweep reads), a property
-- type, a kind ('ti' tenant build-outs, 'new' new buildings and additions)
-- and optional words. Every route reads and writes it `user_id=eq.` the
-- signed-in member; the sweep's email is the one reader across members.
--
-- ---------------------------------------------------------------------------
-- THE LEDGER: notified_through
-- ---------------------------------------------------------------------------
-- A permit is new to an alert when the sweep first stored it after this
-- mark. It starts at the alert's creation (saving one never mails the past),
-- moves to now when its filters change, and moves forward ONLY after an
-- email carrying the alert's new permits was sent (rule 12). A failed or
-- switched-off send leaves it, so the next weekday run sends them again.
--
-- No file fallback (rule 4): without a database the routes answer 503.
-- Deploy order is SOFT: /permits reads the table inside its own try, so an
-- unrun 057 costs the "Your alerts" section (it says it is unavailable) and a
-- named line in the sweep summary, never the feed or the city sweep. Run it
-- BEFORE deploying anyway. Purely additive and idempotent.

create table if not exists permit_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  jurisdiction text,
  property_type text,
  kind text,
  words text,
  notify_email boolean not null default true,
  notified_through timestamptz not null default now(),
  last_emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists permit_alerts_user_idx on permit_alerts (user_id, created_at);
alter table permit_alerts enable row level security;
