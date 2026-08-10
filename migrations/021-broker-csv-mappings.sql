-- migrations/021-broker-csv-mappings.sql
-- 021 · Vault CSV column mapper: one remembered mapping per broker (2026-08-10)
-- Spec: docs/superpowers/specs/2026-08-10-vault-csv-column-mapper-design.md
-- Plan: docs/superpowers/plans/2026-08-10-vault-csv-column-mapper.md
--
-- RUN BEFORE DEPLOYING the /api/vault/inspect route.
--
-- Broker PRIVATE data, vault-class: read and written only by the vault
-- routes, always scoped by user_id, never read by an owner surface. It
-- holds column NAMES rather than comp values, but it is a broker's own
-- file structure and is treated the same way. Purely additive.
--
-- user_id is the primary key rather than a surrogate id alongside it,
-- unlike broker_bovs and broker_comps. Those are fact tables with many
-- rows per broker; this holds exactly one, so the key enforces that in
-- the schema instead of in a code path, gives the upsert an obvious
-- conflict target, and needs no separate index.

create table if not exists broker_csv_mappings (
  user_id    uuid primary key references users(id) on delete cascade,
  mapping    jsonb not null,
  updated_at timestamptz not null default now()
);

alter table broker_csv_mappings enable row level security;
