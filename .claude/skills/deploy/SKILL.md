---
name: deploy
description: Use when shipping committed work in this repo to production (compninja.co) — the owner says "ship it", "deploy", "push it live", or a finished feature needs to go out. Also use when a deploy looks live but changes aren't showing (stale CSS, cached reports, a migration that was never run).
---

# Deploy CompNinja to Production

Render auto-deploys `main` on every push; there is no staging. The order
below is load-bearing: migrations run BEFORE the code that needs them, and
`main` regularly holds commits dev-hub doesn't (PRs merge to main
directly), so sync before pushing or the push is rejected.

Shipping a new per-comp field? The `add-comp-field` skill is the
build-time checklist (maps, short key, migration); this skill is the
ship-time one. Both apply.

## Checklist, in order

1. **Read the whole diff.** `git status --short`, then read every hunk. A
   second session shares this checkout: stage explicit paths only, never
   `git add -A` (it would also sweep the real ledger CSVs on a public repo).
2. **Devlog entry** rides in the same commit as the work (standing rule;
   entry shape in CLAUDE.md). Work already committed without one? Add it as
   a follow-up commit — never amend in this shared checkout. Validate
   devlog.json still parses.
3. **Tests**: `npm test` — or with node off PATH:
   `& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" --test`
   All green or stop here.
4. **New Tailwind utility classes?** The auto-regen hook rebuilds
   `tailwind.css` on edit — do NOT regen manually unless a class is
   actually missing from the vendored file (Select-String each new class).
   The regen may be sitting UNCOMMITTED in the shared tree: read its diff
   (additions for your classes = yours to commit; anything else may be the
   other session's regen — leave it) and commit it alongside the HTML.
5. **Pending migrations?** Compare `migrations/` against
   `migrations/APPLIED.md`. Run **your own** unlogged migration in the
   Supabase SQL editor FIRST — project **"Market comp puller"**
   (`bqdgthxkdnpofgzfcyhl`), not "compninja" (that's the Google Cloud
   project). An unlogged migration you didn't write is the other session's
   in-flight work: leave it for their deploy. When NAMING a migration,
   check existing files (tracked AND untracked) for a number collision.
   New code against the old schema 400s silently: harvests divert to an
   ephemeral file and corpus reads return empty. Log the run in APPLIED.md
   and commit it.
6. **Sync with main**: `git fetch origin`, then if
   `git log --oneline HEAD..origin/main` shows anything, merge
   `origin/main` into dev-hub before pushing (never rebase or force-push).
   If the merge touched code, re-run step 3's tests before continuing.
7. **Push**: `git push origin dev-hub` (branch backup), then
   `git push origin HEAD:main`. Render deploys automatically — but since
   2026-08-08 `npm start` carries a `prestart` (`node --check server.js &&
   npm test`), so a red suite makes the deploy FAIL and the previous build
   keeps serving. The push "succeeding" therefore proves nothing about the
   deploy: a blocked deploy looks exactly like a slow one from outside
   (happened 2026-08-09 — two deploys failed back-to-back on a
   non-hermetic test fixture and production silently served the old build
   for an hour). If the live check in step 9 doesn't show the change
   within ~3 minutes, check the service's Events tab on
   https://dashboard.render.com before suspecting caches.
   Tests on Render run against a FRESH disk: any test fixture that leans
   on a git-ignored local file (market-pages-dynamic.json, leads.jsonl,
   a local corpus) passes on this machine and fails the deploy.
8. **CI green**: the push also triggers the same checks at
   github.com/agouraninja-cmd/market-comp-puller/actions. A red X means
   fix or revert now.
9. **Verify live**: `https://compninja.co/healthz` answers `{"ok":true...}`.
   Check the changed surface at its exact URL, no query strings.
   `tailwind.css` serves with max-age 300, so curl it rather than trusting
   a browser that may hold stale CSS.
   **To check a change inside `index.html`, you must use a wall-exempt
   URL.** While `ACCOUNT_WALL` is on, an anonymous request to `/` OR
   `/index.html` gets the LANDING page (~30KB, server-rendered) — the app
   HTML is never in those bytes, so grepping them for your change reports
   "not deployed" forever, no matter how long you wait. Use
   `https://compninja.co/?auth=signup` or `/r/<anything>` (~674KB; both
   exemptions exist precisely because they must serve the app). Sanity-
   check the fetch itself before believing a negative: if a string that
   shipped WEEKS ago is also missing, you are reading the wrong page, not
   a failed deploy. This cost a false 10-minute "deploy timed out" on
   2026-08-09 when the deploy had in fact already succeeded.
10. **Smoke a report change live**: one search on a FRESH address — a
    previously searched address is a cache hit serving the pre-change
    report, which proves nothing. Sign in + admin unlock first so guest
    caps and comp gating don't distort the check. Costs ~$0.36.
11. **New corpus field?** Durability proof is the Supabase
    `select count(*) from comp_corpus` rising after the search — the
    `Comp corpus +N` console line also appears on fallback writes. /admin
    must show no red corpus banner.
12. **Sync local main**: `git branch -f main origin/main` so the checkout
    matches production.

## Common mistakes

| Mistake | Consequence |
|---|---|
| Pushing before running the migration | weeks-long silent corpus outage (happened 2026-07) |
| Verifying on an already-searched address | the 30-day cache serves the OLD report shape |
| Judging live CSS through the browser | max-age 300 shows stale styles for 5 minutes |
| Curling `/` or `/index.html` to confirm an app change | the wall serves the LANDING page there, so the change never appears and a healthy deploy reads as failed — use `/?auth=signup` or `/r/<id>` |
| `git add -A` | sweeps the other session's work-in-progress into your commit |
| Trusting the `+N` harvest log line | fallback writes log it too; only the DB row count proves durability |
| Skipping the main sync | `push HEAD:main` rejected as non-fast-forward |
