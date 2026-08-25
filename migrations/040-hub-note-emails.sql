-- 040 · Email when somebody posts a note in a hub (2026-08-25)
--
-- The gap this closes: POST /api/hub/message wrote its row and told nobody.
-- The only way to see a reply was to have the hub open in a VISIBLE tab,
-- because the 15s poll skips hidden ones by design. A broker sent comps on
-- Tuesday, the tenant replied on Thursday, and the broker found out whenever
-- he next opened /vault. For a product sold as "one place instead of an email
-- thread", the email thread was winning the one round that mattered.
--
-- RUN THIS BEFORE DEPLOYING the notification code. Purely additive: two new
-- tables, nothing altered, nothing dropped. An unrun migration here does NOT
-- break posting a note — every read and write below is wrapped so that a
-- missing table costs the mail and never the message (see hubNotifyState in
-- server.js). That is the opposite of 024's stance on purpose: 024 guards
-- ACCESS, where failing closed is the only honest answer, and this guards a
-- courtesy email, where failing closed would mean losing somebody's note.
--
-- NUMBERING: main already holds a duplicate 036 (036-bulk-valuations and
-- 036-org-shop-kind both exist). Check `ls migrations` before adding 041.
--
-- ---------------------------------------------------------------------------
-- WHY THE KEY IS AN EMAIL AND NOT A user_id
-- ---------------------------------------------------------------------------
-- 024's rule, adopted wholesale: identity in a hub is the email address. A
-- tenant can READ a hub with nothing but an invite token and no account at
-- all, and those people are exactly the ones a notification exists to reach.
-- users.digest_optout (025) is keyed on a user id and could not serve them.
--
-- It also solves a problem 024 left behind: the hub OWNER has no row in
-- hub_participants (nothing has ever written one), so there was nowhere to
-- keep the broker's own state. Keying on the email covers the owner and the
-- participants with one table and no role special-casing.
--
-- ---------------------------------------------------------------------------
-- 1. One nudge per absence.
-- ---------------------------------------------------------------------------
-- The rule the notifier applies, and the reason both columns exist:
--
--   send when notified_at is null, or when seen_at is newer than notified_at.
--
-- So a person who has been mailed and has not come back is not mailed again,
-- however chatty the thread gets; opening the hub re-arms them. Ten notes
-- posted while you are away is one email, not ten. That is what keeps this
-- from being the kind of notification people turn off, which matters more
-- here than usual because turning it off is one click (see table 2).
--
-- seen_at is stamped on every successful hub READ, which is why this cannot
-- reuse hub_participants.last_seen_at: that column is stamped by the poll
-- too, and it does not exist at all for the owner.
create table if not exists hub_notify (
  hub_id text not null references hubs(id) on delete cascade,
  email text not null,                       -- normalized by hub-access.js normalizeEmail at write time
  seen_at timestamptz,                       -- last successful read of this hub by this person
  notified_at timestamptz,                   -- last note email sent to this person about this hub
  primary key (hub_id, email)
);
-- A FULL primary key, deliberately, and not a partial unique index: PostgREST
-- upserts here with on_conflict=hub_id,email, and Postgres cannot infer a
-- PARTIAL index from an ON CONFLICT clause. That exact mistake in 024's
-- hub_items index made every vault send fail 100% of the time and was
-- invisible to a test suite that runs with no database. Do not add a WHERE
-- to this key.
alter table hub_notify enable row level security;

-- ---------------------------------------------------------------------------
-- 2. The off switch.
-- ---------------------------------------------------------------------------
-- One switch per person, not per hub — 025's shape and 025's reasoning. A
-- tenant who does not want CompNinja in their inbox wants that once, not once
-- per broker who invites them.
--
-- A row is only written when somebody CHANGES the setting, so an absent row
-- means "on". That keeps the default in one place (the code that reads this)
-- instead of requiring a row per participant per hub.
--
-- Turning it off must not need an account, for the same reason the key is an
-- email: the person most likely to want out is the one who never signed up.
-- The unsubscribe link authenticates itself with an HMAC of the address, the
-- same trick and the same domain-separated key as digestMac() in 025.
create table if not exists hub_email_prefs (
  email text primary key,
  notify boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table hub_email_prefs enable row level security;

-- ---------------------------------------------------------------------------
-- Verify (zero rows = applied). `node migrations/verify.js` asks the same
-- questions through PostgREST, which is the way the app itself would trip.
--
--   select t from unnest(array['hub_notify','hub_email_prefs']) as t
--   where not exists (select 1 from information_schema.tables
--                     where table_schema = 'public' and table_name = t);
--
--   select 'column: ' || tc || '.' || c
--   from (values
--     ('hub_notify','seen_at'), ('hub_notify','notified_at'),
--     ('hub_email_prefs','notify')) as v(tc, c)
--   where not exists (select 1 from information_schema.columns
--                     where table_schema = 'public' and table_name = tc and column_name = c);
-- ---------------------------------------------------------------------------
