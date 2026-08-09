-- 020 — search_cache learns which ADDRESS and TYPE a cache entry answers for.
--
-- Why: the Address Explorer's "instant report" badge (roadmap follow-up from
-- the 2026-08-03 explorer spec, listed there as "needs per-address cache
-- probes; possible later"). The cache is keyed by an opaque SHA-256 of the
-- whole request, which is right for correctness and useless for the question
-- "does ANY recent cached report exist for this address + type?" — the badge's
-- question. These two nullable columns record it at write time.
--
-- The badge is a nudge, not a promise the server can perfectly keep: the real
-- cache hit still requires the visitor's exact key (months, size estimate,
-- note, verified-comps signature) to match. The explorer's whole design makes
-- those parameters near-identical across visitors (deterministic list, empty
-- note, per-type recommended lookback, deterministic footprint estimate), so
-- presence-by-address is an honest approximation; an approved broker comp
-- deliberately busts the key and the next click bills once to include it.
--
-- DEPLOY ORDER: safe in EITHER order, by construction. The code writes these
-- columns in a separate best-effort PATCH after the main cache insert, so a
-- deploy that lands before this migration loses nothing but the badge (the
-- PATCH 400s quietly; the cache row itself is untouched). Running this first
-- is still the polite order. Purely additive; both columns nullable; old rows
-- stay null and simply never badge (the 30-day TTL turns them over anyway).

begin;

alter table search_cache add column if not exists address_key text;
alter table search_cache add column if not exists prop_type text;

-- The probe is always "these =<8 normalized addresses, this one type".
create index if not exists search_cache_address_key_idx
  on search_cache (address_key, prop_type);

commit;
