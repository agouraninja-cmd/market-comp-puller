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
2. Run it:

   ```bash
   node migrations/apply.js          # what is pending? (runs nothing)
   node migrations/apply.js --yes    # apply it, in order, and verify after
   ```

3. Read the row it appends to `APPLIED.md` and replace the placeholder note
   with what the migration does and what its absence would have cost.
4. Commit both files together with the code change that needs them.

`apply.js` needs `SUPABASE_ACCESS_TOKEN` in `.env`. Set it once with:

```bash
node scripts/setup-supabase-token.js
```

which prints where `.env` actually is, takes the token at a hidden prompt
(never as an argument, which would land a secret in shell history), refuses a
service key by name rather than as a generic "invalid", fills in
`SUPABASE_URL` if it is absent, and replaces rather than duplicates when it is
run again. Without a token, step 2 is still the [Supabase SQL
editor](https://supabase.com/dashboard) and step 3 is still by hand — nothing
below changes, and that path stays supported.

**To check whether prod is current:**

```bash
node migrations/apply.js --check   # Management API token
node migrations/verify.js          # service key
```

Both answer the same question from the same list (`verify.js` owns `TABLES`
and `COLUMNS`; `apply.js --check` asks `information_schema` through the other
door). Two transports because the keys live in different places: this repo's
local `.env` has never held a SERVICE key — five rows in `APPLIED.md` say
"not verified by verify.js" for exactly that reason — while a Management API
token is one a person can hold. Either exits non-zero listing what is missing,
grouped by the migration that creates it.

Applying is now a command, but the practice is unchanged and the reason for it
is the same: `APPLIED.md` is a claim, and 004 is the proof that claims can be
wrong. `apply.js` logs only what actually ran, only after it ran, and then
checks the result rather than trusting its own success message — 036's first
run reported Success into the wrong project.

### What the runner refuses

It runs DDL against production, so its refusals are the point:

- **A project it was not pointed at.** The ref is derived from `SUPABASE_URL`,
  never passed in, so it can only reach the database the app uses. A blank
  `SUPABASE_URL` (an eval worktree's deliberate isolation) refuses outright.
- **Destructive statements** — `drop table`/`drop column`/`truncate`, an
  unscoped `delete` or `update` — without `--allow-destructive`. This folder is
  append-only by convention; a `DROP` reaching it is a question.
- **Two pending files sharing a number**, because the order would be undefined.
  (036 collides on disk today; both are applied, so nothing is blocked.)
- **`000` and `010`**, by name — they are reconstructions, never run as files.
- **An unknown flag**, rather than guessing it.

Ad-hoc SQL goes through the same door, read-only unless you say otherwise:

```bash
node migrations/apply.js --sql "select count(*) from comp_corpus"
node migrations/apply.js --sql "update users set vault_beta = true where email = 'x@y.co'" --write
```

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
