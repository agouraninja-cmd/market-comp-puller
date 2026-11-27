-- 067 · Saved BOVs: a broker keeps a Broker Opinion of Value on their
--       account (2026-11-27)
-- Rules: bov-doc.js (cleanDraft decides what a row may hold)
-- Docs:  .claude/rules/bov-builder.md
--
-- The owner: "let brokers save BOVs to their account". The BOV builder
-- (/bov) kept a draft only in the browser it was typed in. This table is
-- where a broker keeps one when they press Save, so it opens on another
-- computer.
--
-- DEPLOY ORDER IS SOFT. Until this runs, /api/broker/bov-docs answers 503
-- `not_ready`, the builder hides its Save controls and works from the
-- browser exactly as it did. Nothing else reads this table.
--
-- Broker PRIVATE data, vault-class (013's and 019's rules): read and written
-- only by /api/broker/bov-docs, every call scoped by user_id. No owner
-- surface reads it and nothing public does. A draft can hold an owner's
-- name and an NOI: it is the broker's own document, stored only on their
-- own press, and never read into a report, the corpus or a share.
--
-- PURELY ADDITIVE and idempotent: one new table and one index.

create table if not exists broker_bov_docs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- The Pipeline card this BOV was written for, when there is one. No FK to
  -- broker_bovs on purpose: removing a card must not remove the document
  -- written for it, and a dangling id simply starts nothing.
  bov_id uuid,
  -- Copied out of the draft so the list can name a BOV without reading it.
  address text,
  property_type text,
  -- BOVDOC.cleanDraft's answer, whole: the subject, who it is for, the
  -- chosen comp ids and typed comps, the value, the words, the look.
  draft jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists broker_bov_docs_user_idx on broker_bov_docs (user_id, updated_at desc);
alter table broker_bov_docs enable row level security;

-- Verify (zero rows = schema complete):
--   select t from unnest(array['broker_bov_docs']) as t
--   where not exists (select 1 from information_schema.tables
--                     where table_schema = 'public' and table_name = t);
