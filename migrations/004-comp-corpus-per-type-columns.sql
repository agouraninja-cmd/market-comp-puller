-- 004 · Per-type spec columns on comp_corpus (added 2026-07-27).
--
-- THE CAUTIONARY TALE OF THIS FOLDER: this ALTER shipped in code but was not
-- run in Supabase for weeks. Every corpus insert 400'd on the unknown columns
-- and silently fell back to the ephemeral file; every read returned empty and
-- the corpus hit rate pinned at 0%. The corpus health alarm on /admin exists
-- because of it. When adding a NEW per-comp field (add-comp-field skill),
-- create the next numbered migration here and run it BEFORE deploying.
--
-- No-op on a fresh environment that ran 001 (which already includes these).

alter table public.comp_corpus
  add column if not exists building_class text,
  add column if not exists floor_plate text,
  add column if not exists center_type text,
  add column if not exists anchor_tenant text,
  add column if not exists units text,
  add column if not exists price_per_unit text,
  add column if not exists lot_acres text,
  add column if not exists price_per_acre text,
  add column if not exists zoning text,
  add column if not exists beds_baths text;

-- Verify (zero rows = schema complete):
--   select c from unnest(array['clear_height','dock_doors','building_class',
--     'floor_plate','center_type','anchor_tenant','units','price_per_unit',
--     'lot_acres','price_per_acre','zoning','beds_baths']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_name='comp_corpus' and column_name = c);
