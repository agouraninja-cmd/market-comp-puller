-- 034 · app_settings (2026-08-20) — settings the owner can change from /admin
-- without an environment variable and a redeploy. One key today: the outbound
-- email From address.
--
-- SAFE TO DEPLOY EITHER WAY ROUND, unlike 024/026/028. The only read is
-- refreshSenderOverride(), which is wrapped and falls back to EMAIL_FROM on
-- any error, so deploying before this runs costs the admin card and nothing
-- else: mail keeps going out as EMAIL_FROM, exactly as it did before. That is
-- deliberate — this table decides where password reset email comes from, and a
-- migration ordering mistake must never be able to stop that mail.
--
-- ---------------------------------------------------------------------------
-- A KEY/VALUE TABLE, WHICH THIS REPO OTHERWISE AVOIDS
-- ---------------------------------------------------------------------------
-- Every other table here is explicit: named columns, a check constraint, one
-- purpose. This one is not, and the reason is that the alternative is worse in
-- a specific way. A single-row `email_settings` table would need a migration
-- for the second setting, and the settings that follow this one are exactly
-- the kind that get skipped because "it needs a migration" — the same argument
-- that made `orgs.share_default` and `hub_items.status` ship as unwritten
-- columns ahead of the code that used them.
--
-- The rule that keeps it honest: A KEY IS NEVER A PLACE TO PUT DATA ABOUT A
-- PERSON, A REPORT, OR A COMP. It holds deployment configuration the owner
-- would otherwise set in Render — one short string, read by the server, never
-- scoped to a user. Anything per-user belongs in a column on a real table,
-- where a constraint can defend it and a scoped read can find it.
--
-- ---------------------------------------------------------------------------
-- NO FILE FALLBACK, AND NO REFUSAL EITHER
-- ---------------------------------------------------------------------------
-- The vault, invited shares and the digest refuse without a database because
-- the file WOULD be the loss. Here neither stance fits:
--
--   * A file fallback is wrong. Render wipes its disk on every deploy, so an
--     override saved into a file would silently revert days later and mail
--     would go out from the old address with nothing on screen saying so —
--     the exact silent-revert failure this feature exists to remove.
--   * Refusing is wrong too. The fallback is EMAIL_FROM, which is a real,
--     working answer that predates this table by months.
--
-- So the READ degrades to EMAIL_FROM and the WRITE refuses with a 503 naming
-- EMAIL_FROM as the way to set it without a database.

create table if not exists app_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now(),
  -- Who changed it, for the one question a wrong From address prompts. The
  -- signed-in admin's email when there is one; null when the change came from
  -- a machine holding ADMIN_KEY (there is no admin USER in this codebase —
  -- see CLAUDE.md's "Admin access" — so this cannot be a FK to users).
  updated_by text
);

alter table app_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Verify (zero rows = applied). `node migrations/verify.js` asks the same
-- question through PostgREST, which is how the app itself would trip.
--
--   select 'app_settings' where not exists (
--     select 1 from information_schema.tables
--     where table_schema = 'public' and table_name = 'app_settings');
--
-- Read the live value:
--   select key, value, updated_at, updated_by from app_settings;
--
-- Clear the From override by hand (mail reverts to EMAIL_FROM):
--   delete from app_settings where key = 'email_from';
-- ---------------------------------------------------------------------------
