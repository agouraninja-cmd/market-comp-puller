-- 011 · Guest search quota ledger (2026-08-03, run in prod). One free report
-- search per anonymous visitor, keyed by sha256(IP). Blocked when EITHER this
-- ledger or the cn_guest cookie says the quota is spent. Fails OPEN on ledger
-- errors; DAILY_SEARCH_CAP still backstops spend.

create table guest_search_quota (
  ip_hash text primary key,
  used integer not null default 0,
  first_ts timestamptz not null default now(),
  last_ts timestamptz not null default now()
);
