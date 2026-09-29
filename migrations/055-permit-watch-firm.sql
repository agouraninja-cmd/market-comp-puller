-- 055 — a tracked permit shared with the whole firm (2026-09-29)
-- Rules:  permit-watch.js (firmRecipients, canShareWithFirm, the email copy)
-- Routes: PATCH /api/permits/watch { firm } (owner only), POST
--         /api/permits/mute; the fan-out rides POST /api/permits/sweep
--
-- Owner's call, 2026-09-29: tracking a permit is a Pro tool, and "firm owners
-- can set alerts to the whole firm if they want to but it is mostly for
-- employees tracking permits". So a watch stays one member's (054), and an
-- owner can switch one of THEIR watches to the firm: every active Pro member
-- of that firm then gets its notices, by the steps and channels the owner
-- picked, and each member can mute it for themselves.
--
-- ---------------------------------------------------------------------------
-- org_id ON THE WATCH, NOT A SECOND WATCH TABLE
-- ---------------------------------------------------------------------------
-- A firm permit is the owner's watch with a firm attached: one portal read,
-- one status, one ledger of passed steps. Copying it per member would mean N
-- ledgers that could disagree about whether "Issued" was already announced.
-- Events stay per RECIPIENT (054's permit_watch_events.user_id), so the
-- unread count, the seen stamp and the email ledger work unchanged for a
-- colleague. `on delete set null`: a firm that is deleted leaves the owner's
-- own watch in place, tracked for them alone.
--
-- ---------------------------------------------------------------------------
-- MUTES ARE THE MEMBER'S VETO
-- ---------------------------------------------------------------------------
-- Migration 031's rule for auto-share, applied to notices: the firm decides
-- what is tracked, the member decides what interrupts them. A row here means
-- "stop telling me about this firm permit"; no row means follow the firm.
-- Muting writes the member's events with app/email off, so the permit's
-- history still reads whole if they unmute.
--
-- Deploy order is SOFT. Nothing names org_id in a SELECT (the watch reads are
-- select=*), the firm and mute reads fail open to "none", and the firm switch
-- answers "unavailable" until this runs. Run it before deploying anyway, so
-- the switch works the moment it appears. Purely additive and idempotent.

alter table permit_watches
  add column if not exists org_id uuid references orgs(id) on delete set null;
-- A colleague's list reads the firm's shared watches by org.
create index if not exists permit_watches_org_idx
  on permit_watches (org_id) where org_id is not null;

create table if not exists permit_watch_mutes (
  watch_id uuid not null references permit_watches(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (watch_id, user_id)
);

-- Service role only, like every other table.
alter table permit_watch_mutes enable row level security;
