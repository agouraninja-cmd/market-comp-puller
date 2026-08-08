# BOV Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "BOV tracker" section on `/vault`: the broker's complete log of BOV engagements from any source, with statuses (open, delivered, won, lost) and summary tiles (this year, open, delivered, win rate).

**Architecture:** A new `broker_bovs` table (migration 019) scoped by `user_id`; a new pure rules module `bov-log.js` (broker-leads.js's contract: no I/O, no clock reads, no requires); four routes in server.js through the existing `requireBroker` gate; auto-create from the intro-request handler plus idempotent JS seeding on first tracker open; UI rendered by vault-page.js.

**Tech Stack:** Plain Node 18+ (zero npm deps), Supabase via PostgREST `sbRequest`, `node --test`.

## Global Constraints

- **No npm dependencies.** Plain Node, built-in `fetch`, `node --test`.
- **No em dashes** in any copy, comment, or doc (owner rule).
- **The privacy wall**: `broker_bovs` is broker private data. No owner surface reads it, nothing public reads it, every read/write scopes by `user_id`. `/admin` is unchanged.
- **DB-only, no file fallback** for all four routes (the vault rule): a practice log on Render's disk would vanish on deploy.
- **Copy never names a "broker plan"**; the one subscription is Pro.
- **Migrations are purely additive**; a destructive statement in 019 must fail the build.
- **`market` is computed with `marketOf()` in server.js and nowhere else**; `bov-log.js` never parses an address (broker-leads.js's rule). Property-type validation lives with `VAULT.PROPERTY_TYPES` in server.js so no second enum can drift.
- **devlog.json is clean UTF-8**; never ASCII-escape its punctuation.
- **Shared checkout**: `git fetch origin` and read the whole diff before every commit; stage explicit paths only (never `git add -A`). Another session pushes to `origin/main` without warning.
- Spec: `docs/superpowers/specs/2026-08-08-bov-tracking-design.md`. **One deviation, found at plan time:** the spec says the migration backfills from `lead_intro_requests`, but `market` must be canonical `marketOf()` form and `marketOf` is JavaScript, so SQL cannot write it. The backfill is instead JS seeding on first tracker open (the coverage-seeding pattern, idempotent via `unique (user_id, lead_id)`). Task 3 amends the spec file to record this.

---

### Task 1: `bov-log.js`, the pure rules module

**Files:**
- Create: `bov-log.js`
- Test: `test/bov-log.test.js`

**Interfaces:**
- Produces: `BOVSVC` (server.js will `require("./bov-log")` under that name), exporting:
  - `SOURCES` = `["compninja","referral","repeat_client","other"]`, `STATUSES` = `["open","delivered","won","lost"]`
  - `WIN_RATE_FLOOR` = `3`, `MAX_ROWS` = `500`
  - `isSource(v)`, `isStatus(v)` (exact string membership)
  - `cleanNotes(v)` (trim, cap 500, empty becomes null), `cleanAddress(v)` (trim, cap 300, empty becomes null)
  - `cleanReceivedOn(v)` returns `{ ok: true, value: "YYYY-MM-DD"|null }` or `{ ok: false, error }`
  - `rollup(rows, now)` returns `{ total, thisYear, open, delivered, won, lost, decided, winRate }` with `winRate: null` below the floor
  - `seedFromIntroRequests(joined, isCanonicalMarket)` returns insertable row objects (no `user_id`; the caller adds it)

- [ ] **Step 1: Write the failing test**

```js
// test/bov-log.test.js
// The BOV tracker's rules. Pure like broker-leads.js: no I/O, no clock
// (rollup takes `now`), which is what lets npm test cover the practice
// log's math with no database.
// Spec: docs/superpowers/specs/2026-08-08-bov-tracking-design.md

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const BOV = require("../bov-log");

// The vocabulary is the contract the check constraints in migration 019
// and the UI's <select>s both restate. Pin it exactly.
test("source and status vocabularies", () => {
  assert.deepEqual(BOV.SOURCES, ["compninja", "referral", "repeat_client", "other"]);
  assert.deepEqual(BOV.STATUSES, ["open", "delivered", "won", "lost"]);
  assert.ok(BOV.isSource("referral"));
  assert.ok(!BOV.isSource("Referral"));   // exact, the UI select is the caller
  assert.ok(!BOV.isSource(""));
  assert.ok(BOV.isStatus("lost"));
  assert.ok(!BOV.isStatus("cancelled"));
  assert.ok(!BOV.isStatus(null));
});

test("cleanNotes and cleanAddress trim, cap, and null out emptiness", () => {
  assert.equal(BOV.cleanNotes("  called twice  "), "called twice");
  assert.equal(BOV.cleanNotes(""), null);
  assert.equal(BOV.cleanNotes(null), null);
  assert.equal(BOV.cleanNotes("x".repeat(600)).length, 500);
  assert.equal(BOV.cleanAddress("x".repeat(400)).length, 300);
  assert.equal(BOV.cleanAddress("   "), null);
});

// ISO only. The form's <input type=date> emits exactly this; anything else
// is refused rather than guessed (the vault importer's rule).
test("cleanReceivedOn accepts ISO, refuses everything else, allows empty", () => {
  assert.deepEqual(BOV.cleanReceivedOn("2026-08-08"), { ok: true, value: "2026-08-08" });
  assert.deepEqual(BOV.cleanReceivedOn(""), { ok: true, value: null });
  assert.deepEqual(BOV.cleanReceivedOn(undefined), { ok: true, value: null });
  assert.equal(BOV.cleanReceivedOn("2026-02-30").ok, false);  // not a real date
  assert.equal(BOV.cleanReceivedOn("8/5/2026").ok, false);    // not ISO
  assert.equal(BOV.cleanReceivedOn("45000").ok, false);       // Excel serial
});

test("rollup counts statuses, the year, and holds the win rate to the floor", () => {
  const now = Date.parse("2026-08-08T12:00:00Z");
  const rows = [
    { status: "open",      received_on: "2026-01-05" },
    { status: "delivered", received_on: "2026-03-01" },
    { status: "won",       received_on: "2025-11-20" },   // last year
    { status: "lost",      created_at: "2026-02-02T00:00:00Z" }, // no received_on
  ];
  const r = BOV.rollup(rows, now);
  assert.equal(r.total, 4);
  assert.equal(r.thisYear, 3);      // the 2025 row is out
  assert.equal(r.open, 1);
  assert.equal(r.delivered, 1);
  assert.equal(r.won, 1);
  assert.equal(r.lost, 1);
  assert.equal(r.decided, 2);
  // 2 decided is under the floor of 3: a rate over so few reads as a joke.
  assert.equal(r.winRate, null);
});

test("rollup shows a win rate at the floor, and survives junk rows", () => {
  const now = Date.parse("2026-08-08T12:00:00Z");
  const rows = [
    { status: "won", received_on: "2026-01-01" },
    { status: "won", received_on: "2026-01-02" },
    { status: "lost", received_on: "2026-01-03" },
    null,
    { status: "nonsense", received_on: "2026-01-04" },  // counted in total only
  ];
  const r = BOV.rollup(rows, now);
  assert.equal(r.decided, 3);
  assert.ok(Math.abs(r.winRate - 2 / 3) < 1e-9);
  assert.equal(r.total, 4);   // null skipped, junk-status row still a row
});

test("rollup of an empty log is all zeros and no rate", () => {
  const r = BOV.rollup([], Date.parse("2026-08-08T00:00:00Z"));
  assert.deepEqual(r, { total: 0, thisYear: 0, open: 0, delivered: 0,
    won: 0, lost: 0, decided: 0, winRate: null });
});

// Seeding: the caller (server.js) supplies intro requests joined to their
// leads with `market` already computed by marketOf(). This module never
// parses an address; it takes the canonical-market predicate as an
// argument rather than growing a second copy of broker-leads.js's regex.
test("seedFromIntroRequests shapes rows, dedupes, and drops bad markets", () => {
  const { isCanonicalMarket } = require("../broker-leads");
  const joined = [
    { lead_id: 7, market: "Boise, ID", property_type: "Industrial",
      size_sqft: 42000, ts: "2026-08-01T10:00:00Z" },
    { lead_id: 7, market: "Boise, ID", property_type: "Industrial",
      size_sqft: 42000, ts: "2026-08-01T10:00:00Z" },          // duplicate id
    { lead_id: 8, market: "123 Main St", property_type: "Office",
      size_sqft: null, ts: "2026-08-02T10:00:00Z" },           // marketOf fallback junk
    { lead_id: 9, market: "Meridian, ID", property_type: "",
      size_sqft: null, ts: "bad" },                            // no type
    { lead_id: 10, market: "Meridian, ID", property_type: "Retail",
      size_sqft: null, ts: "not-a-date" },
  ];
  const rows = BOV.seedFromIntroRequests(joined, isCanonicalMarket);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    lead_id: 7, market: "Boise, ID", property_type: "Industrial",
    size_sqft: 42000, received_on: "2026-08-01",
    source: "compninja", status: "open",
  });
  // An unparseable ts seeds with no received_on rather than an invented one.
  assert.equal(rows[1].received_on, null);
  assert.equal(rows[1].lead_id, 10);
});

// Migration 019 guard: purely additive, because there is no staging
// database to rehearse against (016's rule, applied to the new file).
test("migration 019 contains no destructive statement", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "migrations", "019-broker-bovs.sql"), "utf8").toLowerCase();
  for (const forbidden of ["drop table", "drop column", "rename to",
                           "rename column", "truncate", "delete from"]) {
    assert.ok(!sql.includes(forbidden), "019 contains destructive statement: " + forbidden);
  }
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/bov-log.test.js`
Expected: FAIL, `Cannot find module '../bov-log'` (and the migration test fails on a missing file; that is Task 2's deliverable, so if you are running tasks in order, comment nothing out; the module tests are the ones this task must turn green, and Task 2 turns the migration test green).

Note: if the migration-guard test failing blocks your read of the module results, run a single test with `--test-name-pattern`, but do not delete or skip the guard test; it must exist before the migration does.

- [ ] **Step 3: Write the module**

```js
// bov-log.js
"use strict";
// ---------------------------------------------------------------------------
// BOV tracker rules — PURE. No I/O, no clock reads (rollup takes `now`), no
// requires, the same contract as broker-leads.js and entitlements.js, which
// is what lets `npm test` cover the practice log with no database.
//
// server.js owns every read and write. It computes `market` with marketOf()
// and validates it with LEADSVC.isCanonicalMarket, and validates property
// type against VAULT.PROPERTY_TYPES, before calling in — neither vocabulary
// grows a second copy here (broker-leads.js's rule).
//
// Spec: docs/superpowers/specs/2026-08-08-bov-tracking-design.md
// ---------------------------------------------------------------------------

// The check constraints in migrations/019-broker-bovs.sql restate both of
// these lists; keep the three in step.
const SOURCES = ["compninja", "referral", "repeat_client", "other"];
const STATUSES = ["open", "delivered", "won", "lost"];

// Decided (won or lost) BOVs before a win rate is shown at all. A 100% win
// rate over one data point reads as a joke.
const WIN_RATE_FLOOR = 3;

// GET cap, newest first. Matches the coverage read's order of magnitude; a
// broker with 500 tracked BOVs in 90 days is not a real inbox problem yet.
const MAX_ROWS = 500;

function isSource(v) { return SOURCES.includes(v); }
function isStatus(v) { return STATUSES.includes(v); }

function cleanText(v, max) {
  const s = String(v == null ? "" : v).trim();
  return s ? s.slice(0, max) : null;
}
function cleanNotes(v) { return cleanText(v, 500); }
function cleanAddress(v) { return cleanText(v, 300); }

// ISO ("YYYY-MM-DD") only. The form's <input type=date> emits exactly this;
// anything else (US order, Excel serials) is refused rather than guessed,
// the vault importer's rule. Empty is fine: received_on is optional.
function cleanReceivedOn(v) {
  const raw = String(v == null ? "" : v).trim();
  if (!raw) return { ok: true, value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
      return { ok: true, value: raw };
    }
  }
  return { ok: false, error: `"${raw}" is not a date we can read: use YYYY-MM-DD` };
}

// The tiles. thisYear keys on received_on when present, created_at
// otherwise, compared as UTC years against the caller's `now`. A row with a
// status outside the vocabulary still counts in `total` (it exists) but in
// no status bucket — the check constraint makes that unreachable from our
// own writes, and inventing a bucket for it would hide a corrupt row.
function rollup(rows, now) {
  const year = new Date(now).getUTCFullYear();
  const out = { total: 0, thisYear: 0, open: 0, delivered: 0, won: 0, lost: 0,
    decided: 0, winRate: null };
  for (const r of rows || []) {
    if (!r) continue;
    out.total++;
    if (isStatus(r.status)) out[r.status]++;
    const basis = String(r.received_on || r.created_at || "");
    if (/^\d{4}/.test(basis) && Number(basis.slice(0, 4)) === year) out.thisYear++;
  }
  out.decided = out.won + out.lost;
  if (out.decided >= WIN_RATE_FLOOR) out.winRate = out.won / out.decided;
  return out;
}

// First tracker open: rows derived from the broker's existing intro
// requests (the coverage-seeding pattern; a SQL backfill cannot write
// canonical markets because marketOf lives in JS). The caller supplies each
// request joined to its lead with `market` already computed, and passes the
// canonical-market predicate in rather than this file copying the regex.
// Non-canonical markets are dropped, not seeded. The caller adds user_id
// and inserts with on_conflict=user_id,lead_id, so this list need not know
// what already exists.
function seedFromIntroRequests(joined, isCanonicalMarket) {
  const out = [];
  const seen = new Set();
  for (const r of joined || []) {
    if (!r || r.lead_id == null) continue;
    const k = String(r.lead_id);
    if (seen.has(k)) continue;
    if (typeof isCanonicalMarket !== "function" || !isCanonicalMarket(r.market)) continue;
    if (!String(r.property_type || "").trim()) continue;
    seen.add(k);
    const ts = String(r.ts || "");
    out.push({
      lead_id: r.lead_id,
      market: String(r.market).trim(),
      property_type: String(r.property_type).trim(),
      size_sqft: r.size_sqft == null ? null : r.size_sqft,
      received_on: /^\d{4}-\d{2}-\d{2}/.test(ts) ? ts.slice(0, 10) : null,
      source: "compninja",
      status: "open",
    });
  }
  return out;
}

module.exports = {
  SOURCES, STATUSES, WIN_RATE_FLOOR, MAX_ROWS,
  isSource, isStatus,
  cleanNotes, cleanAddress, cleanReceivedOn,
  rollup, seedFromIntroRequests,
};
```

- [ ] **Step 4: Run the tests and make sure the module tests pass**

Run: `node --test test/bov-log.test.js`
Expected: every test passes except "migration 019 contains no destructive statement" (missing file until Task 2).

- [ ] **Step 5: Commit**

```bash
git fetch origin && git status --short
git add bov-log.js test/bov-log.test.js
git commit -m "bov-log.js: pure rules for the BOV tracker (v4 slice 2)"
```

---

### Task 2: Migration 019

**Files:**
- Create: `migrations/019-broker-bovs.sql`

**Interfaces:**
- Produces: table `broker_bovs` with exactly the columns Task 3's routes select: `id, user_id, lead_id, market, property_type, size_sqft, address, notes, received_on, source, status, status_changed_at, created_at`.

- [ ] **Step 1: The failing test already exists**

Run: `node --test test/bov-log.test.js --test-name-pattern "migration 019"`
Expected: FAIL, ENOENT on `migrations/019-broker-bovs.sql`.

- [ ] **Step 2: Write the migration**

```sql
-- migrations/019-broker-bovs.sql
-- 019 · BOV tracker: the broker's practice log (2026-08-08)
-- Spec: docs/superpowers/specs/2026-08-08-bov-tracking-design.md
-- Plan: docs/superpowers/plans/2026-08-08-bov-tracking.md
--
-- RUN BEFORE DEPLOYING the /api/broker/bovs routes.
--
-- Broker PRIVATE data, vault-class: read only by the /api/broker/bovs
-- routes, every one scoped by user_id. No owner surface reads it, nothing
-- public reads it. Purely additive, like 016: there is no staging database
-- to rehearse against, and test/bov-log.test.js fails the build if a
-- destructive statement appears in this file.
--
-- There is deliberately NO SQL backfill from lead_intro_requests: `market`
-- must be canonical marketOf() form and marketOf lives in server.js, so
-- seeding happens in JS on first tracker open instead (the coverage-seeding
-- pattern), made idempotent by the unique constraint below.

create table if not exists broker_bovs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- Set only when the row came from a CompNinja intro request. No FK to
  -- leads, matching lead_intro_requests' reasoning (015 asserts the id
  -- type; a dangling id renders nothing). NULLs compare distinct, so the
  -- unique constraint only bites compninja-sourced rows and manual rows
  -- are unlimited (the same trick broker_comps.dedupe_key documents).
  lead_id bigint,
  market text not null,            -- canonical marketOf() form, computed in server.js
  property_type text not null,     -- VAULT.PROPERTY_TYPES vocabulary
  size_sqft numeric,
  address text,
  notes text,
  received_on date,
  -- Both lists restate bov-log.js's SOURCES/STATUSES; keep the three in step.
  source text not null default 'other'
    check (source in ('compninja', 'referral', 'repeat_client', 'other')),
  status text not null default 'open'
    check (status in ('open', 'delivered', 'won', 'lost')),
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, lead_id)
);
create index if not exists broker_bovs_user_id_idx on broker_bovs (user_id);
alter table broker_bovs enable row level security;

-- Verify (zero rows = schema complete):
--   select t from unnest(array['broker_bovs']) as t
--   where not exists (select 1 from information_schema.tables
--                     where table_schema = 'public' and table_name = t);
```

- [ ] **Step 3: Run the full module test file to verify green**

Run: `node --test test/bov-log.test.js`
Expected: PASS, all tests including the migration guard.

- [ ] **Step 4: Commit**

```bash
git fetch origin && git status --short
git add migrations/019-broker-bovs.sql
git commit -m "Migration 019: broker_bovs, the BOV tracker's table"
```

---

### Task 3: Routes: GET (with seeding) and POST add

**Files:**
- Modify: `server.js` (require near the other module requires at the top; routes next to the existing `/api/broker/leads` block, before the `/api/broker/leads/intro` handler around line 10091)
- Modify: `test/routes.test.js` (extend the existing "broker lead-inbox routes" 401 test around line 348)
- Modify: `docs/superpowers/specs/2026-08-08-bov-tracking-design.md` (the backfill amendment)

**Interfaces:**
- Consumes: `BOVSVC` from Task 1 (`rollup`, `seedFromIntroRequests`, `isSource`, `cleanNotes`, `cleanAddress`, `cleanReceivedOn`, `MAX_ROWS`), table from Task 2, plus existing `requireBroker`, `sbRequest`, `rateLimited`, `clientIp`, `sendJson`, `marketOf`, `LEADSVC.isCanonicalMarket`, `LEADSVC.cleanSizeSqft`, `VAULT.PROPERTY_TYPES`, `logEvent`.
- Produces: `GET /api/broker/bovs` answering `{ bovs: [...], rollup: {...} }`; `POST /api/broker/bovs` answering `{ ok: true }`. Task 5's UI reads exactly these shapes.

- [ ] **Step 1: Write the failing wiring test**

In `test/routes.test.js`, extend the existing broker-gate test (the one asserting `/api/broker/coverage`, `/api/broker/leads`, `/api/broker/leads/intro` answer 401 bare). Add inside the same `t.test` after the `r3` assertion:

```js
    // The BOV tracker (v4 slice 2) sits behind the same gate. 401 first,
    // before the 503 this bare server would give for a missing database.
    const r4 = await fetch(srv.base + "/api/broker/bovs");
    assert.equal(r4.status, 401);
    const r5 = await fetch(srv.base + "/api/broker/bovs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ market: "Boise, ID", property_type: "Industrial" }),
    });
    assert.equal(r5.status, 401);
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/routes.test.js`
Expected: FAIL: the new assertions get 404 (route does not exist yet), not 401.

- [ ] **Step 3: Implement the routes**

At the top of server.js, next to `const LEADSVC = require("./broker-leads");`:

```js
const BOVSVC = require("./bov-log");
```

Insert this block immediately BEFORE the `/api/broker/leads/intro` handler (`if (req.method === "POST" && req.url.split("?")[0] === "/api/broker/leads/intro")`):

```js
  // --- BOV tracker (v4 slice 2) ---------------------------------------------
  // The broker's practice log: every BOV they are working, from any source.
  // Broker PRIVATE data, vault-class: DB-only (no file fallback — Render
  // erases its disk on deploy), every read and write scoped by user_id, and
  // no owner surface reads it. Rules in bov-log.js (pure, tested).
  // Spec: docs/superpowers/specs/2026-08-08-bov-tracking-design.md
  if (req.url.split("?")[0] === "/api/broker/bovs") {
    if (req.method === "GET") {
      (async () => {
        if (rateLimited("bovs:" + clientIp(req), 60)) {
          return sendJson(res, 429, { error: "Too many requests. Please slow down." });
        }
        const user = await requireBroker(req, res);
        if (!user) return;
        try {
          // Seed from existing intro requests on every open (the coverage-
          // seeding pattern): marketOf lives here in JS, so migration 019
          // deliberately has no SQL backfill. on_conflict=user_id,lead_id
          // makes it idempotent, and makes the race with the intro
          // handler's own auto-create harmless.
          const intros = await sbRequest("GET",
            `lead_intro_requests?user_id=eq.${encodeURIComponent(user.id)}&select=lead_id&limit=500`);
          const ids = (intros || []).map((r) => String(r.lead_id)).filter((s) => /^\d+$/.test(s));
          if (ids.length) {
            const leads = await sbRequest("GET",
              `leads?id=in.(${ids.join(",")})&select=id,ts,address,type,size_sqft&limit=500`);
            const joined = (leads || []).map((l) => ({
              lead_id: l.id, market: marketOf(l.address), property_type: l.type,
              size_sqft: LEADSVC.cleanSizeSqft(l.size_sqft), ts: l.ts,
            }));
            const seeds = BOVSVC.seedFromIntroRequests(joined, LEADSVC.isCanonicalMarket)
              .map((s) => ({ ...s, user_id: user.id }));
            if (seeds.length) {
              await sbRequest("POST", "broker_bovs?on_conflict=user_id,lead_id",
                seeds, { prefer: "resolution=ignore-duplicates,return=minimal" });
            }
          }
          const rows = await sbRequest("GET",
            `broker_bovs?user_id=eq.${encodeURIComponent(user.id)}` +
            `&select=id,lead_id,market,property_type,size_sqft,address,notes,received_on,source,status,status_changed_at,created_at` +
            `&order=created_at.desc&limit=${BOVSVC.MAX_ROWS}`);
          return sendJson(res, 200, {
            bovs: rows || [],
            rollup: BOVSVC.rollup(rows || [], Date.now()),
          });
        } catch (err) {
          console.error("bov read failed:", err.message);
          return sendJson(res, 503, { error: "Couldn't load your BOV log. Please try again in a minute." });
        }
      })().catch((err) => { console.error("bov error:", err); sendJson(res, 500, { error: "BOV log failed." }); });
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
      req.on("end", async () => {
        try {
          if (rateLimited("bovs:" + clientIp(req), 60)) {
            return sendJson(res, 429, { error: "Too many requests. Please slow down." });
          }
          const user = await requireBroker(req, res);
          if (!user) return;
          const { market, property_type, source, size_sqft, received_on, address, notes } =
            JSON.parse(body || "{}");
          const canonical = marketOf(String(market || ""));
          if (!LEADSVC.isCanonicalMarket(canonical)) {
            return sendJson(res, 400, { error: 'Enter a market as "City, ST" (for example "Boise, ID").' });
          }
          const type = String(property_type || "");
          if (!VAULT.PROPERTY_TYPES.includes(type)) {
            return sendJson(res, 400, { error: "Unknown property type." });
          }
          const src = source === undefined ? "other" : String(source);
          if (!BOVSVC.isSource(src)) {
            return sendJson(res, 400, { error: "Unknown source." });
          }
          const dateRes = BOVSVC.cleanReceivedOn(received_on);
          if (!dateRes.ok) return sendJson(res, 400, { error: dateRes.error });
          // Same cap discipline as coverage: refuse past the read cap so a
          // broker can never own rows the GET silently truncates away.
          const count = ((await sbRequest("GET",
            `broker_bovs?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=${BOVSVC.MAX_ROWS + 1}`)) || []).length;
          if (count >= BOVSVC.MAX_ROWS) {
            return sendJson(res, 400, { error: `The log is capped at ${BOVSVC.MAX_ROWS} BOVs. Remove one to add another.` });
          }
          await sbRequest("POST", "broker_bovs", [{
            user_id: user.id,
            market: canonical,
            property_type: type,
            source: src,
            status: "open",
            size_sqft: LEADSVC.cleanSizeSqft(size_sqft),
            received_on: dateRes.value,
            address: BOVSVC.cleanAddress(address),
            notes: BOVSVC.cleanNotes(notes),
          }], { prefer: "return=minimal" });
          // PII-free, like every analytics event: market and type only.
          logEvent("bov", { prop_type: type, market: canonical });
          return sendJson(res, 200, { ok: true });
        } catch (err) {
          if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
          console.error("bov add failed:", err.message);
          return sendJson(res, 503, { error: "Couldn't save that BOV. Please try again in a minute." });
        }
      });
      return;
    }
    if (req.method === "DELETE") {
      // Implemented in the next task; until then fall through to 404 below.
      return sendJson(res, 404, { error: "Not found." });
    }
    return sendJson(res, 404, { error: "Not found." });
  }
```

(Task 4 replaces the DELETE stub with the real handler; leaving the stub keeps this task shippable on its own.)

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, including the new 401 assertions and every pre-existing test.

- [ ] **Step 5: Amend the spec's backfill line**

In `docs/superpowers/specs/2026-08-08-bov-tracking-design.md`, replace the paragraph beginning `**Backfill.** The migration seeds one row per existing` with:

```markdown
**Backfill (amended at plan time).** The spec originally put the backfill
in the migration, but `market` must be canonical `marketOf()` form and
`marketOf` lives in server.js, so SQL cannot write it. Instead, `GET
/api/broker/bovs` seeds rows from the broker's existing
`lead_intro_requests` (joined to `leads` in JS, markets computed with
`marketOf()`) on every open, made idempotent by `unique (user_id,
lead_id)`; the coverage-seeding precedent. Migration 019 creates the table
only. The existing destructive-statement test guard covers the new file.
```

- [ ] **Step 6: Commit**

```bash
git fetch origin && git status --short
git add server.js test/routes.test.js docs/superpowers/specs/2026-08-08-bov-tracking-design.md
git commit -m "BOV tracker routes: GET with intro-request seeding, POST add"
```

---

### Task 4: Routes: update, delete, and the intro handler's auto-create

**Files:**
- Modify: `server.js` (the `/api/broker/bovs` block from Task 3; a new `/api/broker/bovs/update` handler directly above it; the `/api/broker/leads/intro` handler)
- Modify: `test/routes.test.js`

**Interfaces:**
- Consumes: Task 3's block, `BOVSVC.isStatus`, `BOVSVC.cleanNotes`.
- Produces: `POST /api/broker/bovs/update` `{ id, status?, notes? }` answering `{ ok: true }`; `DELETE /api/broker/bovs?id=<uuid>` answering `{ ok: true }`. Task 5's UI calls both.

- [ ] **Step 1: Write the failing wiring test**

In the same broker-gate test in `test/routes.test.js`, after the `r5` assertion from Task 3:

```js
    const r6 = await fetch(srv.base + "/api/broker/bovs/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "x", status: "won" }),
    });
    assert.equal(r6.status, 401);
    const r7 = await fetch(srv.base + "/api/broker/bovs?id=00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
    });
    assert.equal(r7.status, 401);
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/routes.test.js`
Expected: FAIL: `/api/broker/bovs/update` answers 404; the DELETE answers 404 from the Task 3 stub.

- [ ] **Step 3: Implement**

Directly ABOVE the `if (req.url.split("?")[0] === "/api/broker/bovs")` block (exact-path matching means order only matters for readability; keep the two adjacent):

```js
  // Status and notes edits. One route for both so the page has one failure
  // mode; a status change stamps status_changed_at. Transitions are
  // deliberately not policed (bov-log.js's rule): this is the broker's own
  // log, not a workflow engine.
  if (req.method === "POST" && req.url.split("?")[0] === "/api/broker/bovs/update") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", async () => {
      try {
        if (rateLimited("bovs:" + clientIp(req), 60)) {
          return sendJson(res, 429, { error: "Too many requests. Please slow down." });
        }
        const user = await requireBroker(req, res);
        if (!user) return;
        const { id, status, notes } = JSON.parse(body || "{}");
        if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) {
          return sendJson(res, 400, { error: "Missing or malformed id." });
        }
        const patch = {};
        if (status !== undefined) {
          if (!BOVSVC.isStatus(String(status))) {
            return sendJson(res, 400, { error: "Unknown status." });
          }
          patch.status = String(status);
          patch.status_changed_at = new Date().toISOString();
        }
        if (notes !== undefined) patch.notes = BOVSVC.cleanNotes(notes);
        if (!Object.keys(patch).length) {
          return sendJson(res, 400, { error: "Nothing to update." });
        }
        // Scoped by user_id: nobody edits another broker's log.
        await sbRequest("PATCH",
          `broker_bovs?id=eq.${encodeURIComponent(String(id))}&user_id=eq.${encodeURIComponent(user.id)}`,
          patch, { prefer: "return=minimal" });
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
        console.error("bov update failed:", err.message);
        return sendJson(res, 503, { error: "Couldn't save that change. Please try again in a minute." });
      }
    });
    return;
  }
```

Replace Task 3's DELETE stub inside the `/api/broker/bovs` block with:

```js
    if (req.method === "DELETE") {
      (async () => {
        if (rateLimited("bovs:" + clientIp(req), 60)) {
          return sendJson(res, 429, { error: "Too many requests. Please slow down." });
        }
        const user = await requireBroker(req, res);
        if (!user) return;
        const id = String(new URL(req.url, "http://localhost").searchParams.get("id") || "").trim();
        if (!/^[0-9a-f-]{36}$/i.test(id)) return sendJson(res, 400, { error: "Missing or malformed id." });
        try {
          // Scoped by user_id: nobody deletes another broker's log entry.
          await sbRequest("DELETE",
            `broker_bovs?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`);
          return sendJson(res, 200, { ok: true });
        } catch (err) {
          console.error("bov delete failed:", err.message);
          return sendJson(res, 503, { error: "Couldn't remove that BOV. Please try again in a minute." });
        }
      })().catch((err) => { console.error("bov error:", err); sendJson(res, 500, { error: "BOV update failed." }); });
      return;
    }
```

In the `/api/broker/leads/intro` handler, directly after the `lead_intro_requests` insert (`await sbRequest("POST", "lead_intro_requests?on_conflict=lead_id,user_id", ...)`) and BEFORE the `BROKER_PROFILES` lookup, add:

```js
        // The BOV tracker's auto-create (v4 slice 2). Non-blocking: the
        // introduction is the primary action, and a lost row here is
        // re-derived by /api/broker/bovs's seeding on next open. The
        // market is canonical here by construction — the coverage check
        // above only passes leads whose marketOf() matched a canonical
        // coverage key. unique(user_id, lead_id) makes the race with that
        // seeding harmless.
        sbRequest("POST", "broker_bovs?on_conflict=user_id,lead_id",
          [{
            user_id: user.id,
            lead_id: lead.id,
            market: marketOf(lead.address),
            property_type: lead.type,
            size_sqft: LEADSVC.cleanSizeSqft(lead.size_sqft),
            received_on: /^\d{4}-\d{2}-\d{2}/.test(String(lead.ts || "")) ? String(lead.ts).slice(0, 10) : null,
            source: "compninja",
            status: "open",
          }],
          { prefer: "resolution=ignore-duplicates,return=minimal" })
          .catch((e) => console.error("bov auto-create failed (seeding recovers it):", e.message));
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, everything.

- [ ] **Step 5: Commit**

```bash
git fetch origin && git status --short
git add server.js test/routes.test.js
git commit -m "BOV tracker: status/notes update, delete, intro auto-create"
```

---

### Task 5: The `/vault` UI

**Files:**
- Modify: `vault-page.js` (HTML section + browser JS inside the one template literal; `applyFirstRun`)
- Modify: `test/vault-page.test.js`

**Interfaces:**
- Consumes: `GET /api/broker/bovs` → `{ bovs, rollup }`, `POST /api/broker/bovs`, `POST /api/broker/bovs/update`, `DELETE /api/broker/bovs?id=` from Tasks 3-4.

**The one-template-literal hazard applies to every step here**: inside the page's inline script, regex backslashes and `\u` escapes must be written doubled (`\\u00b7`), and a literal `${` must never appear. The test file compiles the emitted script, which is the only thing that catches a slip.

- [ ] **Step 1: Write the failing tests**

Append to `test/vault-page.test.js`:

```js
// ---------------------------------------------------------------------------
// The BOV tracker (v4 slice 2)
// ---------------------------------------------------------------------------

test("the BOV tracker section is present and first-run hides it", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  assert.ok(html.includes('id="bovSec"'), "the tracker section is missing");
  // First run keys on comps AND uploads (the standing rule); the tracker
  // hides with everything else so the start page stays a two-step page.
  const js = pageScript(html);
  assert.match(js, /\$\("bovSec"\)\.className=first\?"hide":""/,
    "applyFirstRun does not hide the tracker");
});

test("the tracker's empty state is a sentence, not an empty table", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  // The table wrapper starts hidden and #noBovs exists: with zero rows the
  // section is prose plus the form, never a header row over nothing.
  assert.ok(html.includes('class="tw hide" id="bovTableWrap"'));
  assert.ok(html.includes('id="noBovs"'));
});

test("the emitted script still parses with the tracker in it", () => {
  assert.doesNotThrow(() => new Function(pageScript(renderVaultHTML(boot([]), CHROME))));
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test test/vault-page.test.js`
Expected: the two new content tests FAIL (no `bovSec`); the parse test passes vacuously.

- [ ] **Step 3: Add the HTML section**

In `vault-page.js`, between the `</section>` that closes `<section id="leads">` and `<section id="importsSec">`, insert:

```html
    <section id="bovSec">
      <h2>BOV tracker</h2>
      <p class="sub" style="margin-top:0">Every Broker Opinion of Value you&rsquo;re working,
        from any source. Introductions you request above land here automatically; log the
        rest yourself. This is your private log: only you can see it.</p>
      <div class="cards" id="bovCards"></div>
      <div class="row" style="margin-top:var(--s4)">
        <label>Market <input id="bovMarket" type="text" placeholder="City, ST"/></label>
        <label>Type <select id="bovType"></select></label>
        <label>Source <select id="bovSource">
          <option value="referral">Referral</option>
          <option value="repeat_client">Repeat client</option>
          <option value="other" selected>Other</option>
        </select></label>
        <label>Size (SF) <input id="bovSize" type="text" style="width:90px"/></label>
        <label>Received <input id="bovDate" type="date"/></label>
        <label>Address <input id="bovAddr" type="text" placeholder="optional"/></label>
        <label>Notes <input id="bovNotes" type="text" placeholder="optional"/></label>
        <button class="btn ghost" id="bovAdd">Log a BOV</button>
      </div>
      <div id="bovMsg"></div>
      <div class="tw hide" id="bovTableWrap"><table id="bovTbl">
        <thead><tr>
          <th data-bk="received_on">Received</th><th data-bk="market">Market</th>
          <th data-bk="property_type">Type</th><th data-bk="size_sqft" class="num">Size</th>
          <th data-bk="source">Source</th><th data-bk="status">Status</th>
          <th>Notes</th><th></th>
        </tr></thead><tbody id="bovRows"></tbody>
      </table></div>
      <div class="empty hide" id="noBovs">Nothing logged yet. Request an introduction above,
        or log a BOV you got elsewhere.</div>
    </section>
```

The `source` select deliberately omits `compninja`: those rows arrive by auto-create, and a manual row claiming to be a CompNinja intro would only confuse the log's own story. The server still accepts the value (it is in `SOURCES`) because the auto-create path sends it.

- [ ] **Step 4: Add the browser JS**

Inside the page's inline script (same IIFE), after the leads code (after the `document.addEventListener("click", ...)` block that handles `data-cov`/`data-intro`), add:

```js
  // ---- BOV tracker ----------------------------------------------------------
  var bovs=[],bovRollup=null,bovSortK="received_on",bovSortAsc=false;
  var BOV_STATUSES=["open","delivered","won","lost"];
  var BOV_SOURCE_LABEL={compninja:"CompNinja intro",referral:"Referral",repeat_client:"Repeat client",other:"Other"};
  $("bovType").innerHTML=PROP_TYPES.map(function(t){return "<option>"+t+"</option>"}).join("");
  function loadBovs(){
    fetch("/api/broker/bovs",{credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200){
          $("bovCards").innerHTML=""; $("bovRows").innerHTML="";
          $("bovTableWrap").className="tw hide"; $("noBovs").className="empty hide";
          $("bovMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't load your BOV log.")+"</div>";
          return;
        }
        $("bovMsg").innerHTML="";
        bovs=o.j.bovs||[];
        bovRollup=o.j.rollup||null;
        renderBovs(bovRollup);
      })
      .catch(function(){
        $("bovCards").innerHTML=""; $("bovRows").innerHTML="";
        $("bovTableWrap").className="tw hide"; $("noBovs").className="empty hide";
        $("bovMsg").innerHTML='<div class="msg bad">Couldn\\'t load your BOV log. Please try again.</div>';
      });
  }
  function bovTile(label,val){
    return '<div class="card"><span class="ty">'+esc(label)+'</span>'+
      '<div class="big">'+esc(String(val))+"</div></div>";
  }
  function renderBovs(ru){
    // Tiles only once there is anything to count: four zeros over an empty
    // section is the 0-0 scoreboard the first-run work removed elsewhere.
    if(!ru||!ru.total){ $("bovCards").innerHTML=""; }
    else{
      // The dash under the floor is deliberate: a win rate over one or two
      // decided BOVs reads as a joke (bov-log.js holds the floor).
      var wr=ru.winRate==null?"\\u2014":Math.round(ru.winRate*100)+"%";
      $("bovCards").innerHTML=bovTile("This year",ru.thisYear)+bovTile("Open",ru.open)+
        bovTile("Delivered",ru.delivered)+bovTile("Win rate",wr);
    }
    $("noBovs").className=bovs.length?"empty hide":"empty";
    $("bovTableWrap").className=bovs.length?"tw":"tw hide";
    var rows=bovs.slice().sort(function(a,b){
      var av=a[bovSortK],bv=b[bovSortK];
      if(av==null&&bv==null)return 0;
      if(av==null)return 1;
      if(bv==null)return -1;
      var c=typeof av==="number"&&typeof bv==="number"?av-bv:String(av).localeCompare(String(bv));
      return bovSortAsc?c:-c;
    });
    $("bovRows").innerHTML=rows.map(function(b){
      var sel='<select data-bov="'+escA(b.id)+'" data-prev="'+escA(b.status)+'">'+
        BOV_STATUSES.map(function(s){
          return '<option value="'+s+'"'+(b.status===s?" selected":"")+">"+
            s.charAt(0).toUpperCase()+s.slice(1)+"</option>";
        }).join("")+"</select>";
      return "<tr><td>"+esc(b.received_on||String(b.created_at||"").slice(0,10))+"</td>"+
        "<td>"+esc(b.market)+(b.address?' <span class="note">'+esc(b.address)+"</span>":"")+"</td>"+
        "<td>"+esc(b.property_type)+"</td>"+
        '<td class="num">'+(b.size_sqft?num(b.size_sqft)+" SF":"")+"</td>"+
        "<td>"+esc(BOV_SOURCE_LABEL[b.source]||b.source)+"</td>"+
        "<td>"+sel+"</td>"+
        "<td>"+esc(b.notes||"")+"</td>"+
        '<td><button class="pubbtn" data-bovdel="'+escA(b.id)+'">Remove</button></td></tr>';
    }).join("");
  }
  document.querySelector("#bovTbl thead").addEventListener("click",function(e){
    var th=e.target.closest("th[data-bk]"); if(!th)return;
    var k=th.getAttribute("data-bk");
    if(k===bovSortK)bovSortAsc=!bovSortAsc; else{bovSortK=k;bovSortAsc=false;}
    // The kept rollup means a sort click redraws in place and never clears
    // the tiles or costs a refetch.
    renderBovs(bovRollup);
  });
  $("bovAdd").addEventListener("click",function(){
    var b=$("bovAdd");
    b.disabled=true;
    fetch("/api/broker/bovs",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        market:$("bovMarket").value, property_type:$("bovType").value,
        source:$("bovSource").value, size_sqft:$("bovSize").value,
        received_on:$("bovDate").value, address:$("bovAddr").value,
        notes:$("bovNotes").value })})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        b.disabled=false;
        if(o.s!==200){ $("bovMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't log that BOV.")+"</div>"; return; }
        $("bovMarket").value=""; $("bovSize").value=""; $("bovDate").value="";
        $("bovAddr").value=""; $("bovNotes").value="";
        loadBovs();
      })
      .catch(function(){ b.disabled=false;
        $("bovMsg").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was logged.</div>'; });
  });
  // Status changes post immediately and revert on failure: the intro
  // button's optimistic-with-rollback pattern, applied to a <select>.
  document.addEventListener("change",function(e){
    var id=e.target.getAttribute&&e.target.getAttribute("data-bov");
    if(!id)return;
    var sel=e.target,prev=sel.getAttribute("data-prev"),next=sel.value;
    sel.disabled=true;
    fetch("/api/broker/bovs/update",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({id:id,status:next})})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        sel.disabled=false;
        if(o.s!==200){
          sel.value=prev;
          $("bovMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't save that change.")+"</div>";
          return;
        }
        sel.setAttribute("data-prev",next);
        loadBovs();   // the tiles moved
      })
      .catch(function(){
        sel.disabled=false; sel.value=prev;
        $("bovMsg").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was changed.</div>';
      });
  });
  document.addEventListener("click",function(e){
    var del=e.target.getAttribute&&e.target.getAttribute("data-bovdel");
    if(!del)return;
    if(!confirm("Remove this BOV from your log?"))return;
    fetch("/api/broker/bovs?id="+encodeURIComponent(del),{method:"DELETE",credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200){ $("bovMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't remove that BOV.")+"</div>"; return; }
        loadBovs();
      })
      .catch(function(){ $("bovMsg").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was changed.</div>'; });
  });
```

Wire the load: in `apply()`, next to the existing lazy-leads line `if(!leadsLoaded){ leadsLoaded=true; loadLeads(); }`, add:

```js
    if(!bovsLoaded){ bovsLoaded=true; loadBovs(); }
```

and declare `bovsLoaded=false` alongside `leadsLoaded` in the `var comps=[],...` line near the top of the script.

In `applyFirstRun`, add one line matching its neighbors:

```js
    $("bovSec").className=first?"hide":"";
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/vault-page.test.js`
Expected: PASS, including the emitted-script parse tests for every boot state.

Then: `npm test`
Expected: PASS, everything.

- [ ] **Step 6: Commit**

```bash
git fetch origin && git status --short
git add vault-page.js test/vault-page.test.js
git commit -m "BOV tracker on /vault: tiles, log table, status flow"
```

---

### Task 6: Docs and devlog

**Files:**
- Modify: `devlog.json` (one new entry; save as clean UTF-8, never ASCII-escape its punctuation, and follow the shared-checkout skill's rebuild-not-patch rule if another session's entry is uncommitted)
- Modify: `docs/ROADMAP.md` (the "Later" v4 line)
- Modify: `CLAUDE.md` (a short tracker section under the broker vault)

- [ ] **Step 1: devlog entry**

Add to `devlog.json` (shape per the standing rule; the details string is one sentence, plain UTF-8):

```json
{ "date": "2026-08-08", "type": "feature",
  "title": "BOV tracker on /vault (v4 slice 2)",
  "details": "The broker's private practice log: every BOV from any source, statuses open/delivered/won/lost, tiles for this year, open, delivered and win rate. Intro requests auto-log; the rest is a small form. Vault-class privacy: DB-only, user-scoped, invisible to every owner surface.",
  "commit": "<short hash of the Task 5 commit>" }
```

- [ ] **Step 2: ROADMAP**

In `docs/ROADMAP.md`, update the "Later" line that currently reads `v4 remaining: BOV tracking, 1031 workflow education → hub ratings last.` to say BOV tracking shipped (with the date) and only 1031 education remains before hub ratings. Check the line's current wording first: the other session ships to this file too.

- [ ] **Step 3: CLAUDE.md**

Under the broker vault section of CLAUDE.md (after the gut-check subsection), add a short subsection:

```markdown
  - **BOV tracker** (v4 slice 2, 2026-08-08; spec
    `docs/superpowers/specs/2026-08-08-bov-tracking-design.md`). A panel on
    `/vault`: the broker's private log of BOV engagements from any source,
    statuses open/delivered/won/lost (vocabulary validated, transitions
    deliberately unpoliced), tiles for this year / open / delivered / win
    rate (dash under 3 decided). Rules in the pure, tested **`bov-log.js`**;
    table `broker_bovs` (migration 019), vault-class private: DB-only, every
    read/write user-scoped, read by no owner surface (`/admin`'s
    intro-requests card is unchanged). Intro requests auto-create rows
    (non-blocking) and `GET /api/broker/bovs` re-seeds from
    `lead_intro_requests` on every open — idempotent via
    `unique (user_id, lead_id)`, and the reason migration 019 has no SQL
    backfill (`marketOf()` is JS). Routes go through `requireBroker`.
    Manual adds log a PII-free `bov` analytics event. Lapse locks the log,
    never deletes it.
```

(CLAUDE.md's own prose uses em dashes historically; match the file's existing style there, since the no-em-dash rule is the owner's rule for deliverables and this file already carries them throughout. If in doubt, use colons.)

- [ ] **Step 4: Run the full suite one more time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git fetch origin && git status --short
git add devlog.json docs/ROADMAP.md CLAUDE.md
git commit -m "Docs + devlog for the BOV tracker (v4 slice 2)"
```

---

## After the tasks: verification and rollout (primary session, not a subagent)

1. **Run migration 019 in Supabase** (SQL editor, the owner's project) BEFORE deploying; verify with the migration's own zero-rows query.
2. **Browser drive of `/vault`** with a Pro account: tracker section renders; log a manual BOV; change its status and watch the tiles move; remove it; request an intro in the inbox and confirm the row auto-appears (or appears on reload via seeding); confirm the empty state is prose, not a table; confirm first-run (fresh broker account) hides the section.
3. **Deploy** via the deploy skill (push to main; Render deploys main).
4. Confirm `/admin` renders unchanged and shows no new broker data anywhere.

## Sequencing notes

- The gut check (v4 slice 1) is already merged to main; vault-page.js on main carries it. The slice-1 session may still be pushing follow-ups to `origin/main`: `git fetch origin` before every commit, and rebase rather than merge if the branch diverges.
- Implementation should run in an isolated worktree (superpowers:using-git-worktrees) because the primary checkout is shared.
