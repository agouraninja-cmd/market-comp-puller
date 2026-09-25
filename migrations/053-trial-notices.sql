-- 053 — the Pro trial's email ledger (2026-09-25)
-- Rules: trial-notices.js (which email an account is due, what it says)
-- Route: POST /api/trial/notices (ADMIN_KEY), driven daily by
--        .github/workflows/trial-notices.yml
--
-- One row per (account, kind) ever sent, kind being "start" or "ending". The
-- primary key IS the promise that nobody gets either email twice: the route
-- writes this row AFTER handing the email to the mailer, and a second run of
-- the route reads it and sends nothing. A failed write therefore costs at
-- most one duplicate on the next run; writing first would lose the email
-- outright on a failed send, and a lost trial-ending notice is invisible
-- where a duplicate is merely annoying (watchlist digest's rule, migration
-- 025).
--
-- ONLY the notices route reads or writes this table. Nothing on a page load,
-- a search or a sign-in names it, so running this after the deploy is safe:
-- until it exists the route answers 500 naming the missing table, and the
-- daily workflow goes red, which is how anybody finds out.
--
-- Purely additive. Deleting an account deletes its rows (on delete cascade).

create table if not exists trial_notices (
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('start', 'ending')),
  sent_at timestamptz not null default now(),
  primary key (user_id, kind)
);

-- Service role only, like every table here; the browser never reads it.
alter table trial_notices enable row level security;
