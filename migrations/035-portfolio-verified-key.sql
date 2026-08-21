-- 035 — the saved property's verified address
--
-- WHY. portfolio_items upserts on the address the visitor TYPED, compared
-- character for character, so one building typed three ways is three saved
-- properties with three separate value histories — measured on a real desk:
--
--     1210N17th st
--     1210 N 17th st Boise Idaho 83702
--     1210N17th st Boise Id
--
-- The app geocodes and confirms the address before it ever runs the report,
-- so it already knows those are one place. This column is where that answer
-- is kept, normalized by portfolio-match.js's verifiedKeyFor().
--
-- ⚠ RUN THIS BEFORE THE CODE DEPLOYS, like 026 and 028 and unlike most here.
-- listPortfolio SELECTs verified_key by name on every desk load, and PostgREST
-- 400s a select naming a column that does not exist — sbRequest throws on
-- that, so until the column exists the desk answers 500 and My Desk shows its
-- "couldn't load your portfolio" line instead of the owner's properties.
-- Loud and instantly fixable by running this, but a real outage of the desk
-- either way, so the order is not optional.
--
-- PURELY ADDITIVE, and nullable on purpose. Every existing row keeps a null
-- and keeps matching on its address exactly as before (portfolio-match.js's
-- fallback), so no row has to be touched and there is no window where saving
-- fails once the column is there. Rows fill their key in as they are next
-- saved; nothing backfills, because a backfill would mean geocoding addresses
-- server-side to reconstruct an answer the browser supplies anyway.
--
-- It does NOT merge the duplicates already on a desk. Those are the owner's
-- to delete — merging two histories is a decision about whose numbers to
-- keep, and this column has no business making it silently.

alter table portfolio_items add column if not exists verified_key text;

-- The read is always user-scoped and type-filtered (POST /api/portfolio hands
-- listPortfolio's rows to PFMATCH.findMatch), so the index leads with user_id. Partial, because a null key is the common
-- case for existing rows and indexing those buys nothing.
create index if not exists portfolio_items_verified_key_idx
  on portfolio_items (user_id, property_type, verified_key)
  where verified_key is not null;
