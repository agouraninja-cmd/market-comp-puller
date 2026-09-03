-- migrations/049-broker-csv-mappings-signature.sql
-- 049 · Vault CSV mapper: one remembered mapping per FILE SHAPE (2026-09-02)
-- Follows 021, which made this table one row per broker.
--
-- RUN BEFORE DEPLOYING. getCsvMapping SELECTs `signature` by name on every
-- /api/vault/inspect, and PostgREST 400s an unknown column. Both halves of
-- the mapping read/write swallow their errors, so deploy-first would not
-- break an upload — it would silently stop REMEMBERING anything, which is a
-- regression nobody would report. Migrate, then deploy.
--
-- WHY. A broker's remembered column mapping was keyed on the broker alone,
-- so alternating between two differently shaped exports (a CoStar sale-comps
-- export and their own tracking sheet) overwrote one mapping with the other
-- on every upload. `signature` is VAULT.headerSignature of the file's
-- normalized header row — a short hash plus the column count — computed
-- server-side from the CSV the route actually received, never sent by the
-- client. The existing row keeps working: it gets the empty signature, and
-- getCsvMapping falls back to the most recently saved mapping of any shape
-- when the exact one is not there, which is exactly what one-per-broker
-- always returned.
--
-- Broker PRIVATE data, vault-class, unchanged: read and written only by the
-- vault routes, always scoped by user_id, never read by an owner surface.
--
-- The primary key moves from (user_id) to (user_id, signature). That is a
-- constraint swap on a table holding column NAMES — no row is dropped, no
-- column is dropped, and the old key is a strict prefix of the new one, so
-- every existing row satisfies it.

alter table broker_csv_mappings
  add column if not exists signature text not null default '';

alter table broker_csv_mappings
  drop constraint if exists broker_csv_mappings_pkey;

alter table broker_csv_mappings
  add primary key (user_id, signature);

-- Verify (zero rows = schema complete):
--   select c from unnest(array['signature']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_name = 'broker_csv_mappings' and column_name = c);
