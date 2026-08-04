---
name: housekeeping
description: Use when the owner asks for a housekeeping pass, repo cleanup, monthly review, "what needs attention", or to check for drift — stale branches, docs that no longer match the code, an unverified schema log, or a corrupted devlog. Also run this proactively at the start of a session if it has been weeks since the last one (check docs/ROADMAP.md's shipped log or the last devlog date for how stale things might be).
---

# Repo Housekeeping Sweep

## Overview

Small drift compounds because nothing owns catching it day to day: a
merged branch nobody deleted, a migration nobody logged, a CLAUDE.md claim
that quietly went stale the day it shipped, a devlog entry with corrupted
characters. None of it breaks anything by itself, but it piles up for
weeks (2026-08-04's sweep found all four at once) until someone spends a
whole session just catching up. This skill is that catch-up, done
regularly instead of once.

**REQUIRED BACKGROUND:** read `shared-checkout` before touching git — a
sweep does a lot of git operations and this repo's checkout may be shared
with another session. Read `deploy` before pushing anything that isn't
pure documentation.

## What this sweep does NOT do

It reports and fixes only what's provably safe; it never guesses on the
owner's behalf.

- Never deletes a branch with unmerged commits — flag it, don't touch it
  (see the "flag, don't fix" list below).
- Never edits `docs/ROADMAP.md`'s priorities — only moves clearly-shipped
  lines to the shipped log and flags stale ones for the owner to reorder.
- Never runs a database migration itself — Supabase changes need the
  owner's browser session; flag what's unlogged, don't run it.
- Never touches another session's uncommitted work — see `shared-checkout`.

## The checklist

Node isn't on PATH in the plain Bash environment on the owner's machine —
use the portable path
(`$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe`, or the
PowerShell equivalent) for any `node` command below if a bare `node` fails.

### 1. Branch & worktree hygiene

```
git fetch --prune
git branch -a --merged origin/main    # candidates: fully merged, safe to delete
git branch -a --no-merged origin/main # NOT safe — has unique commits
git worktree list
```

**Auto-fix:** any branch (local or `origin/*`) that's fully merged into
`origin/main` and isn't `main`/`dev-hub` themselves — delete it
(`git branch -d`, `git push origin --delete`). Confirm zero unique commits
first: `git log origin/main..<branch>` must be empty. **Before deleting,
check memory and CLAUDE.md for any explicit note about that branch** — a
merge check is purely mechanical and can't see "the owner deliberately
kept this as a marker." Merged-with-zero-commits is necessary but not
sufficient; a flagged branch goes to the list below even if it mechanically
qualifies.

**Flag, don't fix:** any unmerged branch. Name it, summarize what it holds
(`git log --oneline origin/main..<branch>`), and ask the owner: dead
(archive-tag then delete — see `shared-checkout`'s pattern) or still
wanted (leave it)?

**Auto-fix:** a worktree directory git no longer tracks (`git worktree
list` doesn't show it but the directory exists) — before deleting, confirm
nothing unique lives there per `shared-checkout`'s worktree-litter recipe.

### 2. Schema truth: migrations vs APPLIED.md

Compare every file in `migrations/*.sql` against `migrations/APPLIED.md`.
Any migration not listed there is either unlogged-but-applied (ask the
owner to confirm, then log it) or genuinely unapplied (flag it — running
it needs the owner's Supabase session). If it's been over ~2 weeks since
APPLIED.md's last "full schema verified" date, ask the owner to re-run the
verification query in that file and update the date.

### 3. `devlog.json` integrity

Non-ASCII characters (em dashes, curly quotes, arrows, emoji) are NORMAL
and correct in this file — do not flag them, and never "fix" them by
escaping or stripping. The only real failure is **mojibake**: UTF-8 bytes
that got saved as Windows-1252 and now decode as garbage. Test for the
SPECIFIC pattern, matching CI exactly (`.github/workflows/ci.yml`), not
"any non-ASCII":

```
node -e "
  const fs = require('fs');
  const raw = fs.readFileSync('devlog.json');
  if (raw.includes('﻿')) { console.log('BOM present — re-save without one'); process.exit(1); }
  const entries = JSON.parse(raw.toString('utf8'));
  const bad = entries.filter(e => /Ã|â€|Â/.test(JSON.stringify(e)));
  console.log(bad.length ? bad.length + ' entries mojibake\'d' : 'clean');
"
```

CI already runs this exact check, so a red CI run is the same signal — but
check locally too, since a bad entry can sit uncommitted. **Auto-fix** only
if genuine mojibake is found (the check above says so, not a personal
guess): decode the corrupted run as cp1252 bytes back to UTF-8, repeating
until stable, then write it back as plain UTF-8 (not `\uXXXX`-escaped —
CLAUDE.md's rule is "clean UTF-8," not "ASCII-only"). Verify the JSON
still parses and re-run the check above (zero found) before committing.

### 4. Docs vs. reality

Spot-check the claims in `CLAUDE.md` most likely to drift, since they're
the ones that already have:
- The test-suite paragraph: does the module list and count match
  `test/*.js`?
- Any "NOT yet built" / "still unbuilt" claim: does the feature exist now?
- The tailwind-regen description: does it match what
  `.claude/hooks/regen-tailwind.js` actually does?

Check `docs/ROADMAP.md`: does its "Now" section list anything the devlog
shows as already shipped? Move it to the shipped log. Does its shipped log
lag more than a few entries behind the actual devlog? Catch it up.

### 5. CI health

Open the Actions tab (`github.com/<org>/<repo>/actions`, Claude Chrome —
no `gh` CLI in this environment) and check the last few runs. A red run
that predates the current HEAD and was never addressed is worth flagging
even if HEAD is now green.

### 6. Open pull requests

Check the PR list in Claude Chrome. A PR open more than a few days with no
activity is worth a one-line status ask to the owner: merge, needs
changes, or abandon?

### 7. Working tree cleanliness

`git status --short` for stray untracked files that look like scratch
output (not `.env`/data files the app owns — see `.gitignore`) sitting in
the repo root. Ask before deleting anything whose purpose isn't obvious;
a file another session is using looks identical to true cruft.

## Reporting back

End with a short structured summary, not a wall of command output:

```
Fixed automatically: <list, or "nothing needed fixing">
Needs your decision: <list with enough context to decide, or "none">
All clear: <what was checked and found healthy>
```
