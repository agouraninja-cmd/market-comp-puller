# Search Speed Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every billed search records duration, search count, output tokens, and which rescue layer (if any) fired, into the existing PII-free analytics, surfaced as a "Search speed (7 days)" section on /admin.

**Architecture:** A `stats` object threaded as optional trailing params (`getComps(..., stats)`, `solo(call, onProgress, stats)`, `callAnthropicOnce(..., stats)`, `parseCompJson(raw, stats)`); `logEvent` passes four new optional fields; `/api/stats` computes a `speed` block; /admin renders its own section below the tile strip. Migration 012 adds the four nullable columns.

**Tech Stack:** Plain Node 18+. Shim harness for zero-cost verification.

**Spec:** `docs/superpowers/specs/2026-08-04-search-speed-observability-design.md`

**Cautions:** the other session holds an uncommitted /admin restyle in server.js — stage ONLY this feature's hunks (filter-patch by marker strings); the /admin addition is its own section, not tiles in the shared strip. Grep anchors, no em dashes, server restart needed.

---

### Task 1: Migration file

- [ ] Write `migrations/012-search-timings.sql`:

```sql
-- Speed observability (2026-08-04): per-billed-search timing on the existing
-- PII-free analytics events. All nullable; old rows are untouched.
alter table public.analytics_events
  add column if not exists duration_ms integer,
  add column if not exists searches integer,
  add column if not exists out_tokens integer,
  add column if not exists rescue text;
```

(APPLIED.md line is added in Task 5 AFTER it actually runs on prod.)

---

### Task 2: server.js instrumentation

- [ ] **logEvent** (~line 5195) — add after `cached`:

```js
    // Speed observability (2026-08-04): billed searches carry timing. All
    // optional — every other event keeps its exact previous shape.
    duration_ms: dims && Number.isFinite(dims.duration_ms) ? Math.round(dims.duration_ms) : null,
    searches: dims && Number.isFinite(dims.searches) ? dims.searches : null,
    out_tokens: dims && Number.isFinite(dims.out_tokens) ? dims.out_tokens : null,
    rescue: (dims && dims.rescue) || "",
```

- [ ] **parseCompJson** — signature `function parseCompJson(rawText, stats)`; in the salvage success branch, before returning: `if (stats) stats.rescue = "salvaged";`

- [ ] **callAnthropicOnce** — signature gains trailing `stats = null`. After the timing console.log: `if (stats) { stats.searches = searches; stats.out_tokens = usage.output_tokens || 0; }`. `finishReport` passes stats: `parseCompJson(raw, stats)`. In the repair success path, after `finishReport(repaired)` returns: `if (stats) stats.rescue = "repaired";` (before the console.warn).

- [ ] **solo** — signature `async function solo(call, onProgress = null, stats = null)`; after `call(2)` returns successfully: `if (stats) stats.rescue = "retried";` (precedence: retried > repaired > salvaged, enforced by set order).

- [ ] **getComps** — signature gains trailing `stats = null`; pass to both `solo(...)` calls as the third arg and to the solo/primary `callAnthropicOnce` as the trailing arg (records lane: leave unthreaded — progress and stats both ride the primary lane).

- [ ] **Handler** (~line 7280) — before the `getComps` call: `const callStats = {}; const billedT0 = Date.now();`. Pass `callStats` as the new trailing arg. Extend the billed logEvent (~line 7295):

```js
        logEvent("search", { prop_type: typeOk, market: marketOf(addressOk), cached: false, source: corpusIsStrong(corpus) ? "corpus" : undefined, plan: ent.plan,
          duration_ms: Date.now() - billedT0, searches: callStats.searches, out_tokens: callStats.out_tokens, rescue: callStats.rescue });
```

- [ ] `node --check server.js` — exit 0.

---

### Task 3: /api/stats speed block + /admin section

- [ ] **readRows select** (~line 9296): add `"duration_ms", "searches", "out_tokens", "rescue"` to the column list.

- [ ] **aggregateStats**: add near the end (shape mirrors the existing blocks):

```js
  // Search speed (7 days): billed searches that recorded a duration.
  const weekAgo = Date.now() - 7 * 864e5;
  const timed = searches.filter((r) => !r.cached && Number.isFinite(Number(r.duration_ms)) && Date.parse(r.ts) > weekAgo);
  const durs = timed.map((r) => Number(r.duration_ms)).sort((a, b) => a - b);
  const pct = (p) => durs.length ? durs[Math.min(durs.length - 1, Math.floor(durs.length * p))] : null;
  const speed = {
    count: durs.length,
    p50_ms: pct(0.5),
    p90_ms: pct(0.9),
    avg_searches: timed.length ? +(timed.reduce((s, r) => s + (Number(r.searches) || 0), 0) / timed.length).toFixed(1) : null,
    rescues: {
      salvaged: timed.filter((r) => r.rescue === "salvaged").length,
      repaired: timed.filter((r) => r.rescue === "repaired").length,
      retried: timed.filter((r) => r.rescue === "retried").length,
    },
  };
```

and include `speed` in the returned object.

- [ ] **/admin page**: directly below the tile-strip markup (its own block, marker comment `<!-- speed section (2026-08-04) -->`), a section rendered from `stats.speed`:
  - "Search speed - last 7 days" heading; three inline stats: Typical `p50` (as `Xs`), Slowest 10% `p90`, Avg searches; one line "Rescues: N salvaged · N repaired · N retried"; "no timed searches yet" fallback when `count` is 0. Reuse the page's existing classes only — no new CSS (the other session owns that stylesheet right now).

- [ ] `node --check server.js`.

---

### Task 4: Zero-cost verification via the shim

- [ ] The shim gains `process.env.ADMIN_KEY = "test-key-123";` beside the other env lines. Re-add the `shim` launch entry, `preview_start`.
- [ ] Run three probes: plain (rescue ""), Junkville ("salvaged"), Brokenton ("repaired"). Assert each analytics.jsonl tail row has `duration_ms > 0`, `searches` numeric, `out_tokens > 0`, and the right `rescue`.
- [ ] `GET /api/stats` with `x-admin-key: test-key-123`: `speed.count === 3`, sane p50/p90, rescues `{salvaged:1, repaired:1, retried:0}`.
- [ ] /admin in the pane: the section renders (drive via javascript_tool; read_page is blind on this app).
- [ ] Cleanup: stop shim, remove launch entry, strip Testville/Junkville/Brokenton rows from analytics.jsonl, search-cache.json, comp-corpus.jsonl.

---

### Task 5: Migration on prod, ship

- [ ] Run 012 in the prod Supabase SQL editor via the owner's Chrome; verify with `select column_name from information_schema.columns where table_name='analytics_events';` showing the four new columns.
- [ ] Add the APPLIED.md line with today's date.
- [ ] Devlog entry (top of devlog.json):

```json
{ "date": "2026-08-04", "type": "improvement", "title": "Every search now records how long it took and why", "details": "A live search ran 102 seconds against a 70-second local baseline and nothing could say where the time went: per-search timing existed only as a console line in the host's ephemeral logs, alongside the parse-rescue messages. Every billed search now records its duration, how many web searches it used, how much the model wrote, and whether a rescue layer fired, into the same PII-free analytics that already count searches. The /admin dashboard gained a Search speed section: typical time, slowest tenth, average search count, and rescue tallies over the last seven days. Nothing about search behavior changed; this is the measurement that decides the next speed move instead of guessing.", "commit": "" }
```

- [ ] Stage selectively: filter-patch server.js hunks (markers: `Speed observability`, `stats.rescue`, `stats.searches`, `callStats`, `speed section`, `duration_ms`), plus `migrations/012-search-timings.sql`, `migrations/APPLIED.md`, `devlog.json`. Read every staged diff. Commit; push via the scratch-clone merge path if the shared tree blocks; background health check.

---

## Self-review notes

- Spec coverage: migration (T1), logEvent + threading + markers with precedence (T2), stats/admin (T3), shim proof incl. rescue variants (T4), prod migration-first + APPLIED.md + selective staging (T5). No gaps.
- Signature consistency: `parseCompJson(rawText, stats)`, `solo(call, onProgress, stats)`, `callAnthropicOnce(..., stats = null)` trailing, `getComps(..., stats = null)` trailing; handler passes `callStats`.
- The records lane is deliberately unthreaded, mirroring how progress already works.
