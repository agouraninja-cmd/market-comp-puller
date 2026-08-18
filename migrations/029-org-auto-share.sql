-- 029 · The firm's auto-share default, member half (2026-08-16)
-- Spec: docs/superpowers/specs/2026-08-16-enterprise-team-accounts-design.md §5
-- Rules: org-access.js (autoShareFor)
--
-- RUN BEFORE DEPLOYING the auto-share setting. Purely additive, one nullable
-- column; deploy-then-migrate is survivable here, unlike 028 (PostgREST reads a
-- missing column as absent on a SELECT that does not name it, and org-access.js
-- reads `undefined` as "has not chosen"), but the setting is inert until it
-- runs and every member would silently sit on the firm default.
--
-- ---------------------------------------------------------------------------
-- WHY A MEMBER COLUMN AT ALL, when 028 already shipped orgs.share_default
-- ---------------------------------------------------------------------------
-- share_default is an ADMIN's decision about other people's work. On its own
-- it means one person can start publishing every colleague's new valuations to
-- a shared shelf, and the colleague's only recourse is to leave the firm. That
-- is the exact objection the spec raised against building this at all, so the
-- feature ships with the answer attached rather than as a follow-up.
--
-- THREE STATES, WHICH IS WHY IT IS NULLABLE AND NOT `not null default false`:
--
--   null   the member has not chosen  -> the firm's share_default applies
--   true   always share my new reports with the firm, whatever the firm says
--   false  never                       -> and an admin flipping the firm
--                                        switch cannot override it
--
-- A boolean with a default would collapse the first state into one of the
-- other two, and the difference is the whole point: a member who has never
-- touched the setting must follow the firm, and a member who has said no must
-- keep saying no through every later change of the firm's mind.

alter table org_members
  add column if not exists auto_share boolean;

-- Verify (zero rows = applied):
--   select 'org_members.auto_share'
--   where not exists (select 1 from information_schema.columns
--                     where table_schema = 'public'
--                       and table_name = 'org_members'
--                       and column_name = 'auto_share');
