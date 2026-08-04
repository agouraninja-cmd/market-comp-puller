-- 010 · Dynamic market pages (Address Explorer, 2026-08-03). Visitor-generated
-- market pages, upserted with on_conflict=slug, so slug must be unique.
-- RECONSTRUCTED from the code's reads/writes (slug, payload, created_at) —
-- the original DDL was run by hand and never recorded.

create table if not exists market_pages (
  slug text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
