-- 062: has this account proven it owns its email address? (2026-11-10)
--
-- Why: identity here is the EMAIL (018). A report shared with an address, a
-- firm invitation, a deal room and a broker profile are all handed to
-- whichever account carries that address, and sign-up never checked that the
-- person typing it could read its inbox. Anybody who knew client@acme.com had
-- been sent something could sign up as client@acme.com first and read it.
-- The rules are in email-verify.js; the history is in
-- .claude/rules/accounts.md ("Confirming an email address").
--
--   email_verified_at   When the address was proven: a Google sign-in, a
--                       completed password reset, or the confirm link mailed
--                       at sign-up. NULL is "not proven": the account works
--                       for everything of its own and is not recognized by
--                       its address (no shared reports, no firm, no deal
--                       rooms sent to it, no broker profile).
--
-- THE BACKFILL, and who counts as proven on day one: EVERY account that
-- exists when this runs (the owner's decision, 2026-11-10: "Treat them all as
-- confirmed"). Nobody who has an account today is asked anything or loses a
-- shared report, a firm or a deal room. The cost is stated rather than
-- hidden: an account that had already been made with somebody else's address
-- keeps it. There was no sign of one; the gap was found by reading the code.
--
-- Deploy order: SOFT, in both directions.
--   Code first: server.js reads whole users rows, and a row with no
--     email_verified_at KEY means the column does not exist yet, so the check
--     is simply not on (email-verify.js rule 5) and every write that names
--     the column tolerates its absence (markEmailVerified,
--     usersReadWithProof). Nothing breaks and nobody is locked out; the gap
--     stays open until this runs.
--   This first: old code ignores the column. Accounts made between this
--     running and the deploy are born NULL and see the confirm notice once
--     the new code is live, which is correct: nobody proved those either.
--
-- RE-RUN SAFE, and that needed care. A bare
--   update users set email_verified_at = now() where email_verified_at is null
-- is the obvious backfill, and run a second time (after the code is live) it
-- would confirm every account that had NOT proven its address, which is the
-- hole this migration closes. So the backfill lives inside the same block
-- that creates the column: it runs exactly once, when the column is added,
-- and a re-run does nothing at all.
--
-- `public.users` by name throughout: Supabase has its own auth.users, and an
-- information_schema check on table_name alone would see that one.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name = 'email_verified_at'
  ) then
    alter table public.users add column email_verified_at timestamptz;
    update public.users set email_verified_at = now();
  end if;
end $$;
