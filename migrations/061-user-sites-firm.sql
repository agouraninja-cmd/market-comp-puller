-- 061: a Sites deal shared with the member's firm, the latest CompNinja
-- estimate written back onto it, and where it sits on a map (2026-10-21).
--
-- Deploy order: SOFT. server.js probes for these columns (sitesV2Ready) and
-- names them only once a read has seen them, so code deployed ahead of this
-- keeps every Sites route working as before and simply offers none of the
-- three. Run it, and within five minutes the routes find the columns.
--
--   org_id      The firm a deal is shared with, its owner's switch. NULL is
--               "only the owner". Read by sitesSharedWithFirm ALONE, a
--               separate query beside the owner's own user_id=eq. read, which
--               is never widened (CLAUDE.md rule 3), and only for colleagues
--               who are active members now. No FK: a firm that goes away
--               leaves an id nothing matches, and the deal stays its owner's.
--   estimate    { low, likely, high, report, at }: the comp report run from
--               the deal ("Run a land report"), written back when it drew.
--               sites.js cleanEstimate decides what is stored.
--   lat, lng,   Where the deal is, from the Census geocoder via our own
--   geo_source  server (rule 7), filled in the background. geo_source is
--               'census' (placed) or 'none' (Census had no match); NULL means
--               not looked up yet. Permits near a deal read these.
--
-- Additive only: no existing column, row or constraint changes.

alter table user_sites add column if not exists org_id uuid;
alter table user_sites add column if not exists estimate jsonb;
alter table user_sites add column if not exists lat double precision;
alter table user_sites add column if not exists lng double precision;
alter table user_sites add column if not exists geo_source text;

create index if not exists user_sites_org_id_idx on user_sites (org_id) where org_id is not null;
