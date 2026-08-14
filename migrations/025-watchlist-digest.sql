-- migrations/025-watchlist-digest.sql
-- 025 · The watchlist digest: what has been mailed, and who wants none of it
--       (2026-08-13)
--
-- Why this exists: watchlist_items and /api/watchlist/feed have been live
-- since 2026-07-19 and are read only by someone who has already decided to
-- open the app. Every other loop in the product is pull. This is the one
-- surface that can bring somebody back without them remembering to come, and
-- the whole send path (sendOutboundEmail, the branded letterhead in
-- email-shell.js, which has named "market alerts" as an intended category
-- since the day it was written) was already built.
--
--   watchlist_items.last_digest_at  the high-water mark for MAIL. Nullable:
--                                   null means never mailed, and the first
--                                   digest for a row falls back to its
--                                   created_at so a new watch cannot mail a
--                                   year of backlog.
--   users.digest_optout             one switch per person, not per market.
--                                   Somebody who wants no email wants no
--                                   email; making them turn off four markets
--                                   one at a time is a dark pattern.
--
-- last_digest_at is deliberately SEPARATE from last_seen_at rather than
-- reusing it, and the two are read together. last_seen_at is the in-app
-- marker, moved only by an explicit bell/desk click. If the digest wrote to
-- it, opening an email would silently mark comps read in the app the reader
-- never looked at; if the digest READ only it, a person who never clicks the
-- bell would be mailed the same comps forever. The send rule uses the LATER
-- of the two, so the email can never tell somebody something they have
-- already seen on screen, and an active user quietly stops receiving digests
-- without ever unsubscribing.
--
-- No file fallback, and the digest route refuses without a database. This is
-- the vault's rule for the same reason: on Render the local disk is erased
-- on every deploy, so a "already mailed" marker stored there would be lost
-- and every watcher would be re-sent the same comps after each deploy. A
-- lost convenience is acceptable; mailing people twice is not.
--
-- Purely additive and idempotent. Deploy-order-safe in BOTH directions:
--   migrate-then-deploy — the columns sit unread until the code ships.
--   deploy-then-migrate — the digest route is admin-gated and nothing calls
--   it automatically, so the worst case is that the first manual run 400s on
--   the missing column and mails nobody. Nothing visitor-facing touches
--   these columns; the feed route reads last_seen_at exactly as before.

alter table public.watchlist_items
  add column if not exists last_digest_at timestamptz;

alter table public.users
  add column if not exists digest_optout boolean not null default false;

-- Verify (zero rows = schema complete):
--   select c from unnest(array['last_digest_at']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_name = 'watchlist_items' and column_name = c)
--   union all
--   select c from unnest(array['digest_optout']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_name = 'users' and column_name = c);
