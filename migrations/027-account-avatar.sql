-- 027 · Account profile photo (2026-08-14)
--
-- The picture in the account circle. Bytes live in user_avatars, NOT on
-- users, because getSessionUser's findUserById is SELECT * on every
-- authenticated request and an 80KB data URI riding along would tax every
-- signed-in call. users.avatar_rev is a short content hash that rides along
-- for free: presence means the circle should show a photo, and the value
-- cache-busts GET /api/account/avatar.
--
-- Purely additive and idempotent. Both deploy orders are safe:
--   migrate-then-deploy — the column and table sit unread until the routes
--   ship.
--   deploy-then-migrate — getSessionUser reads avatar_rev as undefined
--   (PostgREST returns the row without the column rather than erroring on a
--   SELECT *), which String()s to "", so every visitor is simply without a
--   photo. PUT would 400 on the unknown table/column and surface as a save
--   failure — a broken feature, never a wrong picture, never a leaked one.
--   createUser's INSERT does not name avatar_rev, so signup is untouched.
--
-- Account deletion cascades the photo (FK on delete cascade), matching
-- deleteUserCascade's rule that removing an account removes its saved data.
-- The file fallback stores both fields on the user object in
-- account-store.json; there is no second file, because local-dev has no
-- SELECT * tax to avoid.

alter table users add column if not exists avatar_rev text;

create table if not exists user_avatars (
  user_id uuid primary key references users(id) on delete cascade,
  data_uri text not null,
  updated_at timestamptz not null default now()
);

-- Verify (zero rows = schema complete):
--   select c from unnest(array['avatar_rev']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_name = 'users' and column_name = c);
--   select 1 from information_schema.tables where table_name = 'user_avatars';
