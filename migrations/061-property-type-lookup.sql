-- migrations/061-property-type-lookup.sql
-- 061 · The property type, worked out from the address (2026-10-09).
-- Spec: docs/superpowers/specs/2026-10-09-auto-property-type-design.md
--
-- Nobody picks a property type any more. The Comp report page's type box
-- silently started on Industrial and valued offices and apartments against
-- warehouse sales whenever it was left alone, so the owner asked for the
-- picker to go. CompNinja now looks the type up from the address
-- (resolvePropertyType in server.js; rules in property-type.js).
--
-- 1. subject_types — the lookup's memo, shaped like subject_sizes (009): one
--    row per normalized address (server.js subjectSizeKey), holding only the
--    AI's own high/medium answers (a street-level guess is never stored).
--    Public facts about a building, not private data: read and written only by
--    resolvePropertyType, with the service key.
--    DEPLOY ORDER IS SOFT. A missing table fails the memo read (caught; the
--    lookup simply runs) and the write (caught; it falls back to the local
--    property-types.json), so code ahead of this costs repeat lookups, never a
--    report.
--
-- 2. bulk_job_items.property_type — each address's own type on a Comp report
--    run, now that a run has no single picked type (its bulk_jobs.property_type
--    reads 'Auto'). Nullable: every row written before this keeps null and
--    keeps its job's type, which is what bulk.js's CSV already falls back to.
--    DEPLOY ORDER IS SOFT. The worker writes this column in a PATCH of its own
--    and swallows a 400, so a run before this migration still values every row
--    with its looked-up type; only the per-row type shown on the page and in
--    the CSV is missing until it runs. Reads are unaffected: bulk_job_items is
--    read with select=*.
--
-- Purely additive and idempotent.

create table if not exists subject_types (
  address_norm  text primary key,
  property_type text not null,
  confidence    text,
  evidence      text,
  -- "quick" or "deep": which lookup answered (property-type.js).
  pass          text,
  updated_at    timestamptz not null default now()
);

alter table subject_types enable row level security;

alter table bulk_job_items add column if not exists property_type text;
