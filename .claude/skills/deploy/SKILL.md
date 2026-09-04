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
3. **Tests**: `npm test`. All green or stop here.
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
   `git push origin HEAD:main`. Render deploys automatically. `npm start`
   runs a `prestart` of **`node --check server.js` and nothing else**, so
   the one thing that stops a deploy here is a syntax error in server.js —
   the failure that would otherwise take the whole site down at boot; the
   previous green build keeps serving instead.
   **`npm test` has NOT been in `prestart` since 2026-08-20.** It was
   removed after it broke production: the suite was written when it took
   two seconds and now takes ~63 seconds on Render, with several suites
   spawning real child servers. On a 0.5-CPU Starter instance that is a
   minute of saturated CPU before the port is ever bound, re-run on every
   restart and by every concurrent instance. Three deploys in a row died on
   `Timed out after waiting for internal health check ... /healthz` while
   the health checker fought the tests for the one core, and each failure
   restarted the instance, which re-ran the suite. Correctness is CI's job
   (step 8). Do not put it back.
   The push "succeeding" still proves nothing about the deploy: a blocked
   deploy looks exactly like a slow one from outside (happened 2026-08-09 —
   two deploys failed back-to-back and production silently served the old
   build for an hour). If the live check in step 9 doesn't show the change
   within ~3 minutes, check the service's Events tab on
   https://dashboard.render.com before suspecting caches.
8. **CI green**: the push also triggers the checks at
   github.com/agouraninja-cmd/market-comp-puller/actions. A red X means fix
   or revert now — and since `npm test` left `prestart`, **CI is the only
   automated gate on correctness**: a red suite now reaches production
   instead of being stopped at the boot, so this step stopped being a
   formality the day that changed.
   CI runs against a FRESH checkout: any test fixture that leans on a
   git-ignored local file (market-pages-dynamic.json, leads.jsonl, a local
   corpus) passes on this machine and fails there.
   **No result at all is not the same as green.** During a GitHub incident
   webhooks get dropped and no run is ever created (2026-08-06: four
   branches merged with no CI result). `ci.yml` carries a
   `workflow_dispatch` "Run workflow" button for exactly that — a direct
   API call rather than a webhook delivery — so use it to get a verdict on
   a commit already on main instead of pushing an empty commit to
   manufacture one. The same checks also run locally in about two seconds.
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
| Assuming a red suite can't reach production | it can, since 2026-08-20 — `prestart` is `node --check` only, so CI (step 8) is the only thing standing between a failing test and the live site |
