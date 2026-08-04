# Search speed observability

Date: 2026-08-04
Status: approved (owner, in-session)

## Problem

A live Phoenix search ran ~102s against a ~70s local baseline, and nothing
recorded why: per-search timing exists only as a console line in Render's
ephemeral logs, and the parse-rescue layers log there too. Whether prod
slowness is a silent repair call, Render's free tier, or normal variance is
currently unanswerable without a log dig nobody does. The next speed decision
(Render upgrade, stop-when-satisfied rule, corpus warming) needs data.

## Design

Pure instrumentation; search behavior unchanged.

1. **Migration `migrations/012-search-timings.sql`** (run on prod BEFORE the
   code deploys, logged in APPLIED.md - the corpus lesson):
   nullable `duration_ms integer`, `searches integer`, `out_tokens integer`,
   `rescue text` on `analytics_events`.
2. **`logEvent`** passes the four new fields through when provided (defaults:
   null/""), so every other event keeps its exact current shape.
3. **Stats threading.** The `/api/comps` handler creates `callStats = {}` and
   stamps `duration_ms` around the whole billed leg (what the visitor waits
   for server-side). Threaded via a new trailing param through `getComps` ->
   `solo` -> `callAnthropicOnce`, which fills `searches` and `out_tokens`
   from the values it already console-logs. Rescue markers, single field,
   precedence retried > repaired > salvaged:
   - `parseCompJson(rawText, stats?)` sets `rescue = "salvaged"`;
   - the repair path sets `rescue = "repaired"` after a successful repair;
   - `solo()` sets `rescue = "retried"` after a successful attempt 2.
   The billed-search `logEvent` carries all four; cache hits stay unchanged.
   PII stance unchanged: numbers plus a one-word enum.
4. **`/api/stats`** gains `speed`: over the last 7 days of billed searches
   with a recorded duration - `{ count, p50_ms, p90_ms, avg_searches,
   rescues: { salvaged, repaired, retried } }`. The stats `readRows` select
   list gains the four columns.
5. **`/admin`** gains a separate "Search speed (7 days)" section BELOW the
   existing tile strip - deliberately its own block, because the strip's
   grid column count must divide its tile count (per its own comment) and
   the other session actively owns that strip's styling.

## Concurrency caution

The other session holds an uncommitted /admin restyle in server.js. Stage
this feature's hunks selectively (the filter-patch approach), never the whole
file, and put the /admin addition in its own section to minimize collision.

## Verification (zero cost)

Fetch-shim harness with `ADMIN_KEY` set: a fake billed search must produce an
analytics row carrying all four fields; the Junkville scenario must record
`rescue: "salvaged"` and Brokenton `"repaired"`; `/api/stats` must return the
speed block and `/admin` must render the section. Then: run the migration on
prod via the owner's Chrome, update APPLIED.md, deploy, health check.

## Non-goals

- No change to budgets, prompts, or any search behavior.
- No per-visitor or per-address timing (PII stance).
- No alerting; the dashboard tile is the deliverable.
