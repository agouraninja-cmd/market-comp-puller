-- migrations/022-tester-passkey.sql
-- 022 · Comped Pro for beta testers: one flag per account (2026-08-10)
-- Spec: docs/superpowers/specs/2026-08-10-tester-passkey-design.md
-- Plan: docs/superpowers/plans/2026-08-10-tester-passkey.md
--
-- RUN BEFORE DEPLOYING the /api/redeem-passkey route.
--
-- Purely additive and idempotent. `not null default false` means every
-- existing row is backfilled to "not a tester" by the ALTER itself, which is
-- the fail-closed direction: no account gains access from this migration.
--
-- Deploy-order-safe in BOTH directions, deliberately:
--   migrate-then-deploy — the column sits unread until the route ships.
--   deploy-then-migrate — getSessionUser reads `user.pro_tester` as undefined
--   (PostgREST returns the row without the column rather than erroring on a
--   SELECT *), which Boolean()s to false, so every visitor is simply not a
--   tester until the column exists. The redeem route's PATCH would 400 on the
--   unknown column and surface as a redeem failure — a broken feature, never
--   a wrong grant.
--
-- Revoking one tester is a one-row UPDATE here, which is the whole reason the
-- grant is stored per-account rather than carried in a cookie:
--   update users set pro_tester = false where email = 'someone@example.com';

alter table users add column if not exists pro_tester boolean not null default false;

-- Verify (zero rows = schema complete):
--   select c from unnest(array['pro_tester']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_name = 'users' and column_name = c);
