-- Speed observability (2026-08-04): per-billed-search timing on the existing
-- PII-free analytics events. All nullable; old rows are untouched.
alter table public.analytics_events
  add column if not exists duration_ms integer,
  add column if not exists searches integer,
  add column if not exists out_tokens integer,
  add column if not exists rescue text;
