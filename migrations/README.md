# Database migrations

Every Supabase schema change lives here as a numbered `.sql` file, in the order
it was written. [APPLIED.md](APPLIED.md) records which files have been run on
the production database. Together they answer, in ten seconds, the question
that used to live only in the owner's head: **is the live database up to date
with the code?**

## The routine

**Before (or with) any deploy that changes the schema:**

1. Write the change as the next numbered file: `012-something.sql`,
   `013-something.sql`, ...
2. Open the [Supabase SQL editor](https://supabase.com/dashboard) and run it.
3. Add a line to `APPLIED.md` with the date.
4. Commit both files together with the code change that needs them.

**To check whether prod is current:** compare this folder against `APPLIED.md`.
Any file not listed there has not been run. That is the whole system; there is
no tooling, no runner, no framework.

## Why this exists

This app is deliberately forgiving: when a database write fails it falls back
to a local file and keeps going. That is great for uptime and terrible for
noticing a missed schema change. In July 2026 the ALTER in `004` shipped in
code but was never run in Supabase; every corpus insert silently failed for
weeks while the logs looked healthy. The `/admin` corpus-health banner catches
that case after the fact; this folder is the practice that prevents it.

## Conventions

- Files are append-only. Never edit a migration that has already been applied
  to prod; write a new numbered file that alters it instead.
- Prefer `if not exists` / `add column if not exists` so a re-run is harmless.
- Keep the "why" as SQL comments in the file, the same way server.js keeps it
  in code comments.
- server.js keeps a one-line pointer comment (`-- see migrations/NNN-*.sql`)
  where each DDL block used to live, so code and schema stay cross-referenced.
- `000` and `010` are *reconstructions* of tables that were created by hand
  before this folder existed. They document the shape; they were never run as
  files and must not be run against prod.
- New per-comp fields (the `add-comp-field` skill) always need a migration
  here: a new `comp_corpus` column, run BEFORE the deploy.
