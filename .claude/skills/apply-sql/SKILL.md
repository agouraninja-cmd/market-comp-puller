---
name: apply-sql
description: Use when SQL needs to reach the live CompNinja database — a new migration in migrations/, a one-off admin UPDATE (vault_beta, pro_tester, seats), or a question about production data. Also use when about to hand the owner SQL to paste into the Supabase SQL editor, or when a feature looks broken in a way an unrun migration would explain.
---

# Run the SQL, don't paste it at the owner

There is a runner. Handing the owner a SQL block to copy into the Supabase
SQL editor is the old way and is now the fallback, not the default.

```bash
node migrations/apply.js            # what is pending? runs nothing
node migrations/apply.js --yes      # apply pending files in order, log, verify
node migrations/apply.js --check    # is the live schema what the code expects?
node migrations/apply.js --sql "select count(*) from comp_corpus"
```

It needs `SUPABASE_ACCESS_TOKEN` in `.env` (an `sbp_...` from
https://supabase.com/dashboard/account/tokens — **not** the service key;
PostgREST cannot run DDL at all). If it is unset the runner says so and exits;
that is the moment to point the owner at the one-command setup rather than to
fall back silently:

```bash
node scripts/setup-supabase-token.js
```

It prints the `.env` path, takes the token at a hidden prompt (never as an
argument — that would land it in shell history), refuses a service key by name,
sets `SUPABASE_URL` if absent, and replaces rather than duplicates on a re-run.
**Never ask the owner to paste a token into the chat**, and if one appears
there anyway, say plainly that it is burned and must be revoked.

## Which mode

| Situation | Command |
|---|---|
| New migration file written | `node migrations/apply.js --yes` |
| One specific file | `node migrations/apply.js 037-foo.sql --yes` |
| "Is prod current?" / a feature is silently dead | `node migrations/apply.js --check` |
| Reading production data | `node migrations/apply.js --sql "select …"` |
| Granting one account something (`vault_beta`, `pro_tester`) | `--sql "update … where email = '…'" --write` |
| Anything that drops or truncates | ask the owner first, then `--allow-destructive` |

## Rules

1. **Write the migration file first, then run it.** The file is the record;
   running SQL that lives nowhere is how 036's `orgs.kind` ended up applied by
   one session and unlogged for another to raise a false alarm over.
2. **Never `--yes` a file you have not read**, and in this shared checkout
   **name the file** rather than bare `--yes` — with no filename it applies
   every pending file, and one you did not write is another session's
   in-flight work. The plan output (no `--yes`) names the files and the
   statement count, not the statements; read the file itself.
3. **Read the `APPLIED.md` row it writes and replace the note.** The runner
   leaves a factual placeholder; the row is worth having only when it says what
   the migration does and what its absence would have cost — that is the
   column every other row in that file earns its keep with.
4. **`--check` after applying, and believe it over the success message.**
   036-bulk-valuations reported Success into the wrong project and created two
   tables in a database nothing reads. The runner checks automatically after
   `--yes`; do not skip reading the result.
5. **`--write` is deliberate.** Ad-hoc SQL is read-only by default, so a stray
   `update` cannot run by being typed into the wrong command.
6. **Destructive means ask.** The runner refuses `drop`/`truncate`/unscoped
   `delete`/unscoped `update` without `--allow-destructive`. That refusal is a
   prompt to check with the owner, not a flag to add reflexively.
7. **Migration ordering still matters more than the runner does.** A column a
   live SELECT names (018's `org_id`, 030's, 035's `verified_key`) must be
   applied BEFORE the code deploys, or PostgREST 400s every read of that table.
   The `deploy` skill's step 5 is where that ordering lives.

## When it cannot run

No token, no `SUPABASE_URL`, or no network to `api.supabase.com` — then it is
the SQL editor by hand, project **"Market comp puller"**
(`bqdgthxkdnpofgzfcyhl`), and an `APPLIED.md` row written by hand. Say which
one happened; a silent fallback to pasting is how the owner ends up doing the
work they asked not to do.
