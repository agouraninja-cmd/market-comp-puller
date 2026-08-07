-- 018 · Permissioned report sharing (broker tier v3, 2026-08-06)
-- Spec: docs/superpowers/specs/2026-08-06-client-sharing-design.md
-- Plan: docs/superpowers/plans/2026-08-06-client-sharing.md
--
-- RUN BEFORE DEPLOYING the sharing routes.
--
-- ---------------------------------------------------------------------------
-- EVERY DEFAULT HERE IS A BACKWARD-COMPATIBILITY PROMISE
-- ---------------------------------------------------------------------------
-- shared_reports has been an unowned, public, permanent link since the feature
-- shipped, and those links are already in the world: the BOV follow-up email
-- has mailed /r/<id> to property owners who have no account and never will.
-- So visibility defaults to 'public' and user_id is nullable. An existing row
-- must keep behaving EXACTLY as it does today.

alter table shared_reports
  add column if not exists user_id uuid references users(id) on delete set null,
  add column if not exists visibility text not null default 'public',
  add column if not exists include_private boolean not null default false,
  add column if not exists revoked_at timestamptz;

-- set null, NOT cascade: a member deleting their account must not silently
-- break a link their client is relying on. The share loses its owner and
-- becomes unmanageable, which is the honest outcome rather than a vanishing.

-- "My shared reports" on /desk, and nothing else, reads by owner.
create index if not exists shared_reports_user_idx
  on shared_reports (user_id, created_at desc)
  where user_id is not null;

-- The viewer list. Identity is the EMAIL, not a user id: a client invited
-- before they have an account gets access the moment they sign up with that
-- address, with nothing to reconcile.
create table if not exists report_viewers (
  id uuid primary key default gen_random_uuid(),
  share_id text not null references shared_reports(id) on delete cascade,
  email text not null,                 -- normalized (lowercased, trimmed) by report-access.js at write time
  invited_at timestamptz not null default now(),
  first_viewed_at timestamptz,         -- stamped once, on the first successful read
  last_viewed_at timestamptz,
  unique (share_id, email)
);

-- "Shared with me" on /desk reads by email.
create index if not exists report_viewers_email_idx on report_viewers (email);

alter table report_viewers enable row level security;

-- Verify (zero rows = applied):
--   select c from unnest(array['user_id','visibility','include_private','revoked_at']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_name='shared_reports' and column_name = c)
--   union all
--   select 'report_viewers' where not exists (select 1 from information_schema.tables
--                                             where table_name='report_viewers');
