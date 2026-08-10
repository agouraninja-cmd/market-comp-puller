# Search-Quality Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make search quality measurable, so a model upgrade or a prompt change can be compared instead of guessed at.

**Architecture:** A pure, tested `eval-score.js` (scoring rules) plus a zero-dependency `run-eval.js` runner (the `gen-market-seed.js` precedent) over a committed `eval-set.json` of 12 targets. Two small gated server changes make a controlled comparison possible at all: `MODEL` from the environment, and an internal-only `fresh: true` flag that skips every cache read path. Spec: `docs/superpowers/specs/2026-08-09-search-quality-eval-design.md`.

**Tech Stack:** Plain Node (built-in `fetch`), `node --test`, zero npm dependencies.

## Global Constraints

- **It is a scorecard, not an assertion suite.** No pass/fail thresholds anywhere in the code or output. One run of a stochastic model over 12 addresses is noisy; the deliverable is per-metric deltas a human reads.
- **A failed target is recorded with its message and EXCLUDED from metric averages, never scored as a zero**, and the failure count is a headline number in the summary. The runner continues after a failure so already-billed searches are not wasted.
- **`fresh: true` must skip BOTH cache read paths**: the exact `getCachedSearch(cacheKey)` hit AND the `findDerivableReport` wider-window derivation. Missing the second one lets run B serve a report derived from run A's entry, which is the exact false-"no difference" this flag exists to prevent.
- **`fresh` is gated on the existing `internal` check** (`ADMIN_KEY && req.headers["x-admin-key"] === ADMIN_KEY`) and ignored otherwise. It skips the cache READ only; the write still happens.
- **`MODEL` env default stays exactly `claude-sonnet-4-6`**, and the startup banner logs the live model.
- **Isolation is the runner's contract**: it targets a server started from a worktree with `SUPABASE_URL` blank, so every write lands in that worktree's git-ignored fallback files. The runner refuses to run without an explicit `EVAL_BASE`.
- Zero npm dependencies; no em dashes in new prose or comments; shared checkout: `git status --short` before staging, explicit paths only, never `git add -A`.
- Portable node if off PATH: `C:\Users\JacobAdler\AppData\Local\node-portable\node-v24.16.0-win-x64\node.exe`.

---

### Task 1: `eval-score.js` (TDD)

**Files:**
- Create: `eval-score.js`
- Test: `test/eval-score.test.js`

**Interfaces:**
- Consumes: `valuation.js`'s `TIER_WEIGHT` and `tierOf`; `corpus-audit.js`'s `isAggregateAddress`.
- Produces: `scoreReport(report, target, now) -> metrics`, `summarize(results) -> summary`, `compare(baseline, candidate) -> deltas`. Task 3's runner calls all three.

- [ ] **Step 1: Write the failing tests**

Create `test/eval-score.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const S = require("../eval-score");

const NOW = Date.parse("2026-08-09T00:00:00Z");
const TARGET = { address: "100 Main St, Boise, ID", type: "Industrial", months: 24 };

function report(comps, extra) {
  return Object.assign({ comps: comps, summary: "s".repeat(500) }, extra || {});
}

test("scoreReport counts priced sale comps and whether a valuation is possible", () => {
  const m = S.scoreReport(report([
    { address: "1 A St, Boise, ID", transaction: "Sale", date: "2026-05-01", size_sqft: "10,000", price_or_rate: "$1,000,000", price_per_sqft: "$100", source_type: "listing" },
    { address: "2 B St, Boise, ID", transaction: "Sale", date: "2026-04-01", size_sqft: "5,000", price_or_rate: "$750,000", price_per_sqft: "$150", source_type: "public_record" },
    { address: "3 C St, Boise, ID", transaction: "Lease", date: "2026-03-01", size_sqft: "8,000", price_or_rate: "$9.50/SF/yr", source_type: "listing" },
  ]), TARGET, NOW);
  assert.equal(m.comps, 3);
  assert.equal(m.pricedSales, 2);
  assert.equal(m.valuationPossible, true);
});

test("scoreReport: one priced sale is not enough for a valuation", () => {
  const m = S.scoreReport(report([
    { address: "1 A St, Boise, ID", transaction: "Sale", date: "2026-05-01", size_sqft: "10,000", price_or_rate: "$1,000,000", price_per_sqft: "$100", source_type: "listing" },
  ]), TARGET, NOW);
  assert.equal(m.pricedSales, 1);
  assert.equal(m.valuationPossible, false);
});

test("scoreReport scores provenance with valuation.js tier weights", () => {
  const m = S.scoreReport(report([
    { address: "1 A St, Boise, ID", transaction: "Sale", date: "2026-05-01", price_per_sqft: "$100", source_type: "public_record" },
    { address: "2 B St, Boise, ID", transaction: "Sale", date: "2026-05-01", price_per_sqft: "$110", source_type: "estimate" },
  ]), TARGET, NOW);
  // public_record 1 + estimate 0.5, averaged.
  assert.equal(m.provenanceScore, 0.75);
  assert.equal(m.tierCounts.public_record, 1);
  assert.equal(m.tierCounts.estimate, 1);
  assert.equal(m.estimateRate, 0.5);
});

test("scoreReport flags aggregate addresses and out-of-window dates", () => {
  const m = S.scoreReport(report([
    { address: "Market Median, Boise, ID", transaction: "Sale", date: "2026-05-01", price_per_sqft: "$100", source_type: "estimate" },
    { address: "2 B St, Boise, ID", transaction: "Sale", date: "2019-01-01", price_per_sqft: "$110", source_type: "listing" },
  ]), TARGET, NOW);
  assert.equal(m.aggregateRate, 0.5);
  assert.equal(m.inWindowRate, 0.5);
});

test("scoreReport matches the subject's city and state", () => {
  const m = S.scoreReport(report([
    { address: "1 A St, Boise, ID", transaction: "Sale", date: "2026-05-01", price_per_sqft: "$100", source_type: "listing" },
    { address: "9 Z Ave, Dallas, TX", transaction: "Sale", date: "2026-05-01", price_per_sqft: "$110", source_type: "listing" },
  ]), TARGET, NOW);
  assert.equal(m.marketMatchRate, 0.5);
});

test("scoreReport records narrative lengths and subject size lookup", () => {
  const m = S.scoreReport(report([], {
    summary: "abc", value_drivers: ["one", "two"], market_trend: "flat",
    price_discovery: { note: "xyz" }, subject_size_sqft: "42,000",
  }), TARGET, NOW);
  assert.equal(m.summaryChars, 3);
  assert.equal(m.valueDriversChars, 6);
  assert.equal(m.marketTrendChars, 4);
  assert.equal(m.priceDiscoveryChars, 3);
  assert.equal(m.subjectSizeFound, true);
});

test("scoreReport does not throw on empty or malformed reports", () => {
  for (const bad of [null, {}, { comps: null }, { comps: [null, {}] }]) {
    const m = S.scoreReport(bad, TARGET, NOW);
    assert.equal(typeof m.comps, "number");
    assert.equal(m.valuationPossible, false);
  }
});

test("summarize averages successes and reports failures separately", () => {
  const sum = S.summarize([
    { target: "a", ok: true, metrics: { comps: 4, pricedSales: 4, valuationPossible: true, provenanceScore: 1, durationMs: 60000 } },
    { target: "b", ok: true, metrics: { comps: 2, pricedSales: 0, valuationPossible: false, provenanceScore: 0.5, durationMs: 40000 } },
    { target: "c", ok: false, error: "timeout" },
  ]);
  assert.equal(sum.targets, 3);
  assert.equal(sum.failures, 1);
  assert.deepEqual(sum.failedTargets, [{ target: "c", error: "timeout" }]);
  assert.equal(sum.metrics.comps, 3);              // (4+2)/2, failure excluded
  assert.equal(sum.metrics.provenanceScore, 0.75);
  assert.equal(sum.valuationPossibleRate, 0.5);
});

test("compare reports per-metric deltas and tolerates a missing metric", () => {
  const a = { metrics: { comps: 4, provenanceScore: 0.8 }, valuationPossibleRate: 1, failures: 0 };
  const b = { metrics: { comps: 6, provenanceScore: 0.6 }, valuationPossibleRate: 0.5, failures: 2 };
  const d = S.compare(a, b);
  assert.equal(d.metrics.comps.baseline, 4);
  assert.equal(d.metrics.comps.candidate, 6);
  assert.equal(d.metrics.comps.delta, 2);
  assert.equal(d.metrics.provenanceScore.delta, -0.2);
  assert.equal(d.valuationPossibleRate.delta, -0.5);
  assert.equal(d.failures.delta, 2);
  const d2 = S.compare({ metrics: { comps: 4 } }, { metrics: { other: 1 } });
  assert.equal(d2.metrics.comps.candidate, null);
  assert.equal(d2.metrics.other.baseline, null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/eval-score.test.js`
Expected: FAIL with `Cannot find module '../eval-score'`.

- [ ] **Step 3: Implement**

Create `eval-score.js`:

```js
// ---------------------------------------------------------------------------
// Search-quality scoring. Turns one /api/comps report into a row of numbers,
// and a set of rows into a summary two runs can be diffed on.
//
// Deliberately PURE, like entitlements.js and corpus-audit.js: no I/O, no
// fetch, no clock reads (the caller passes `now`). run-eval.js owns every
// side effect.
//
// This is a SCORECARD, not an assertion suite. Nothing here has a pass/fail
// threshold: one run of a stochastic model over a dozen addresses is noisy,
// and a number dressed up as a verdict would be worse than no number. The
// product is the delta between two runs, read by a human.
// Spec: docs/superpowers/specs/2026-08-09-search-quality-eval-design.md
// ---------------------------------------------------------------------------

"use strict";

const VALUATION = require("./valuation");
const AUDIT = require("./corpus-audit");

function num(v) {
  const n = Number(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : NaN;
}

function isSale(c) {
  return !String((c && c.transaction) || "").toLowerCase().startsWith("lease");
}

// $/SF for a sale comp: the model's figure, else price / size.
function salePpsf(c) {
  const direct = num(c && c.price_per_sqft);
  if (direct > 0) return direct;
  const p = num(c && c.price_or_rate), s = num(c && c.size_sqft);
  return p > 0 && s > 0 ? p / s : NaN;
}

// "1 A St, Boise, ID 83702" -> "boise, id". An approximation of server.js's
// marketOf, which cannot be required here (server.js boots a server on
// require). Good enough to catch a comp from another metro, which is the
// failure this metric exists to see.
function cityStateOf(address) {
  const parts = String(address || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  const state = (parts[parts.length - 1].match(/^([A-Za-z]{2})\b/) || [])[1];
  if (!state) return "";
  return (parts[parts.length - 2] + ", " + state).toLowerCase();
}

function scoreReport(report, target, now) {
  const r = report || {};
  const comps = Array.isArray(r.comps) ? r.comps.filter(Boolean) : [];
  const months = Number((target && target.months) || 12);
  const windowStart = now - months * 30.44 * 24 * 3600 * 1000;
  const subjectMarket = cityStateOf(target && target.address);

  let pricedSales = 0, sized = 0, aggregate = 0, inWindow = 0, marketMatch = 0, estimates = 0;
  let weight = 0;
  const tierCounts = {};
  for (const c of comps) {
    const tier = VALUATION.tierOf(c) || "estimate";
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    weight += VALUATION.TIER_WEIGHT[tier] != null ? VALUATION.TIER_WEIGHT[tier] : 0;
    if (tier === "estimate") estimates += 1;
    if (AUDIT.isAggregateAddress(c.address)) aggregate += 1;
    const t = Date.parse(c.date);
    if (!isNaN(t) && t >= windowStart && t <= now) inWindow += 1;
    if (subjectMarket && cityStateOf(c.address) === subjectMarket) marketMatch += 1;
    if (isSale(c) && salePpsf(c) > 0) {
      pricedSales += 1;
      if (num(c.size_sqft) > 0) sized += 1;
    }
  }
  const rate = (n) => (comps.length ? n / comps.length : 0);
  const drivers = Array.isArray(r.value_drivers) ? r.value_drivers.join("") : String(r.value_drivers || "");
  return {
    comps: comps.length,
    pricedSales: pricedSales,
    valuationPossible: pricedSales >= 2,
    provenanceScore: comps.length ? weight / comps.length : 0,
    tierCounts: tierCounts,
    estimateRate: rate(estimates),
    aggregateRate: rate(aggregate),
    inWindowRate: rate(inWindow),
    marketMatchRate: rate(marketMatch),
    sizeRate: pricedSales ? sized / pricedSales : 0,
    subjectSizeFound: Boolean(r.subject_size_sqft),
    summaryChars: String(r.summary || "").length,
    valueDriversChars: drivers.length,
    marketTrendChars: String(r.market_trend || "").length,
    priceDiscoveryChars: String((r.price_discovery && r.price_discovery.note) || "").length,
  };
}

// Averaged over SUCCESSES only. A failed target is a fact of its own (see
// `failures`), never a zero dragging an average toward a flattering middle.
const AVERAGED = ["comps", "pricedSales", "provenanceScore", "estimateRate", "aggregateRate",
  "inWindowRate", "marketMatchRate", "sizeRate", "summaryChars", "valueDriversChars",
  "marketTrendChars", "priceDiscoveryChars", "durationMs"];

function summarize(results) {
  const rows = Array.isArray(results) ? results : [];
  const ok = rows.filter((x) => x && x.ok && x.metrics);
  const metrics = {};
  for (const key of AVERAGED) {
    const vals = ok.map((x) => x.metrics[key]).filter((v) => typeof v === "number" && isFinite(v));
    if (vals.length) metrics[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  const boolRate = (key) => (ok.length ? ok.filter((x) => x.metrics[key]).length / ok.length : 0);
  return {
    targets: rows.length,
    scored: ok.length,
    failures: rows.length - ok.length,
    failedTargets: rows.filter((x) => !x || !x.ok).map((x) => ({ target: x && x.target, error: x && x.error })),
    metrics: metrics,
    valuationPossibleRate: boolRate("valuationPossible"),
    subjectSizeFoundRate: boolRate("subjectSizeFound"),
  };
}

function compare(baseline, candidate) {
  const b = baseline || {}, c = candidate || {};
  const bm = b.metrics || {}, cm = c.metrics || {};
  const metrics = {};
  for (const key of Object.keys(bm).concat(Object.keys(cm))) {
    if (metrics[key]) continue;
    const bv = typeof bm[key] === "number" ? bm[key] : null;
    const cv = typeof cm[key] === "number" ? cm[key] : null;
    metrics[key] = { baseline: bv, candidate: cv, delta: bv != null && cv != null ? cv - bv : null };
  }
  const scalar = (key) => {
    const bv = typeof b[key] === "number" ? b[key] : null;
    const cv = typeof c[key] === "number" ? c[key] : null;
    return { baseline: bv, candidate: cv, delta: bv != null && cv != null ? cv - bv : null };
  };
  return {
    metrics: metrics,
    valuationPossibleRate: scalar("valuationPossibleRate"),
    subjectSizeFoundRate: scalar("subjectSizeFoundRate"),
    failures: scalar("failures"),
  };
}

module.exports = { scoreReport, summarize, compare, cityStateOf, AVERAGED };
```

- [ ] **Step 4: Run green, then the whole suite**

Run: `node --test test/eval-score.test.js`, then `npm test`. All pass.

- [ ] **Step 5: Commit**

```bash
git status --short
git add eval-score.js test/eval-score.test.js
git commit -m "eval-score.js: turn a report into a row of comparable numbers"
```

---

### Task 2: the two server changes

**Files:**
- Modify: `server.js` (four spots: the `MODEL` const at line ~132; the body destructure in `/api/comps` at ~line 8882; the two cache read guards at ~lines 9028 and 9050; the startup banner at ~line 12892)

**Interfaces:**
- Produces: `MODEL` honoring `process.env.MODEL`; `/api/comps` accepting `fresh: true` from internal callers. Task 3's runner sends the flag.

- [ ] **Step 1: MODEL from the environment**

Change:

```js
const MODEL = "claude-sonnet-4-6";
```

to:

```js
// Overridable so the eval harness can score one model against another
// (run-eval.js). Unset everywhere in production, which keeps this exactly
// the constant it has always been. If the API 404s on a model id, list the
// live ones via GET https://api.anthropic.com/v1/models and update this
// default.
const MODEL = (process.env.MODEL || "claude-sonnet-4-6").trim();
```

- [ ] **Step 2: Accept `fresh` in the request body**

In `/api/comps`, the destructure currently reads:

```js
        const { address, type, note, months, maxComps, txFocus, subjectSizeSqft, subjectDetails, stream } = JSON.parse(body || "{}");
```

Add `fresh` to it:

```js
        const { address, type, note, months, maxComps, txFocus, subjectSizeSqft, subjectDetails, stream, fresh } = JSON.parse(body || "{}");
```

- [ ] **Step 3: Skip BOTH cache read paths for an internal fresh call**

Immediately after the line that computes `internal` (`const internal = ADMIN_KEY && req.headers["x-admin-key"] === ADMIN_KEY;`), add:

```js
        // The eval harness needs a genuinely fresh search: a cached report
        // would score the model that WROTE it, silently reporting "no
        // difference" between two models. Internal callers only, and it
        // skips the cache READ only, never the write. Both read paths are
        // guarded below, because the derivable-window path can serve a
        // report derived from the previous run's entry just as easily.
        const skipCache = internal && fresh === true;
```

Then guard the exact-hit read:

```js
        const cached = skipCache ? null : await getCachedSearch(cacheKey);
```

and the derivable-window read:

```js
        const dw = skipCache ? null : await findDerivableReport({
```

(keeping the rest of that call unchanged, including its closing arguments).

- [ ] **Step 4: Log the live model at startup**

After the existing first banner line (`console.log(\`Market Comp Puller running at http://localhost:${PORT}\`);`), add:

```js
  if (process.env.MODEL) console.log(`🤖 Model overridden by MODEL: ${MODEL}`);
```

- [ ] **Step 5: Verify**

Run: `node --check server.js`, then `npm test` (the routes tests boot a real server twice; they must stay green).

Then prove the flag is inert for a normal caller and active for an internal one, with no billed search, using a server with no API key. From the repo root start:

```bash
ANTHROPIC_API_KEY="" SUPABASE_URL="" SUPABASE_SERVICE_KEY="" ADMIN_KEY=evalkey ACCOUNT_WALL=off GUEST_SEARCH_LIMIT=off PORT=3170 node server.js
```

With it running, `curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3170/api/comps -H 'content-type: application/json' -d '{"address":"1 Test St, Boise, ID","type":"Industrial","fresh":true}'` must NOT 400 on the flag (it will fail later for the missing key, which is the expected proof that the flag parsed and was ignored without the admin header). Record the status and the server's log line. Stop the server.

- [ ] **Step 6: Commit**

```bash
git status --short
git add server.js
git commit -m "MODEL from the environment; internal fresh flag that skips both cache reads"
```

---

### Task 3: `eval-set.json` + `run-eval.js`

**Files:**
- Create: `eval-set.json`
- Create: `run-eval.js`
- Modify: `.gitignore` (add the raw-report scratch dir)

**Interfaces:**
- Consumes: Task 1's `scoreReport(report, target, now)`, `summarize(results)`, `compare(baseline, candidate)`; Task 2's `fresh: true` flag.
- Produces: `node run-eval.js --label <name>` writes `docs/evals/<ISO-date>-<label>.json`; `node run-eval.js --compare <a.json> <b.json>` prints deltas.

- [ ] **Step 1: Create the golden set**

Create `eval-set.json`:

```json
{
  "note": "Fixed targets for run-eval.js. Each entry states what it is here to catch. Changing this list breaks comparability with older runs in docs/evals, so add rather than edit, and say why in `why`.",
  "targets": [
    { "address": "1200 W Industrial Blvd, Dallas, TX", "type": "Industrial", "months": 24, "maxComps": 12, "why": "dense metro, the easy case; a regression here is unambiguous" },
    { "address": "4050 E Franklin Rd, Nampa, ID", "type": "Industrial", "months": 24, "maxComps": 12, "why": "mid market, the product's home turf" },
    { "address": "1010 Yellowstone Ave, Pocatello, ID", "type": "Industrial", "months": 24, "maxComps": 12, "why": "thin rural market; where padding with submarket estimates shows up" },
    { "address": "500 W Madison St, Chicago, IL", "type": "Office", "months": 24, "maxComps": 12, "why": "large office, plentiful public reporting" },
    { "address": "3300 N Central Ave, Phoenix, AZ", "type": "Office", "months": 24, "maxComps": 12, "why": "office in a market with heavy repricing" },
    { "address": "8500 Beverly Blvd, Los Angeles, CA", "type": "Retail", "months": 24, "maxComps": 12, "why": "urban retail, center-type reporting" },
    { "address": "2100 S Federal Hwy, Fort Lauderdale, FL", "type": "Retail", "months": 24, "maxComps": 12, "why": "strip retail, where anchor tenant data is thin" },
    { "address": "1600 Peachtree St NE, Atlanta, GA", "type": "Multifamily", "months": 24, "maxComps": 12, "why": "multifamily prices per unit; catches the $/unit path" },
    { "address": "700 E Riverside Dr, Austin, TX", "type": "Multifamily", "months": 24, "maxComps": 12, "why": "second multifamily so the per-unit metrics are not one sample" },
    { "address": "12500 S Pflumm Rd, Olathe, KS", "type": "Land", "months": 36, "maxComps": 12, "why": "land quotes per acre and needs a longer window" },
    { "address": "742 N 5th St, Boise, ID", "type": "Residential", "months": 12, "maxComps": 12, "why": "residential, the type with the fewest per-comp fields" },
    { "address": "1 Innovation Way, Cheyenne, WY", "type": "Industrial", "months": 36, "maxComps": 12, "why": "known-hard: sparse market plus a generic address, the shape that produced aggregate rows before" }
  ]
}
```

- [ ] **Step 2: Ignore the raw-report scratch dir**

Append to `.gitignore`, under the "Local runtime logs" block:

```
# Raw per-target reports from run-eval.js (the committed summary lives in docs/evals/)
eval-runs/
```

- [ ] **Step 3: Write the runner**

Create `run-eval.js`:

```js
// Search-quality eval harness. Puts every target in eval-set.json through a
// REAL /api/comps search, scores each report with eval-score.js, and writes a
// summary two runs can be diffed on.
//
// This costs one billed Anthropic search per target (about $0.36 measured
// 2026-08-03), so a 12-target run is about $4.30 and a model comparison is
// two runs.
//
// ISOLATION IS THE CONTRACT. Point this at a server started from a separate
// worktree with SUPABASE_URL blank: every fallback file is relative to that
// server's own directory, so the run writes its cache, corpus rows, market
// pages, and analytics there and production sees none of it. Running it
// against the production database would both pollute it and measure the
// wrong thing.
//
// Usage:
//   EVAL_BASE=http://localhost:3170 ADMIN_KEY=... node run-eval.js --label sonnet-4-6
//   node run-eval.js --compare docs/evals/a.json docs/evals/b.json
//   ... --only 2            run just the first 2 targets (plumbing check)
// Spec: docs/superpowers/specs/2026-08-09-search-quality-eval-design.md

const fs = require("fs");
const path = require("path");
const SCORE = require("./eval-score");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] || "") : null;
};

if (args.includes("--compare")) {
  const i = args.indexOf("--compare");
  const a = JSON.parse(fs.readFileSync(args[i + 1], "utf8"));
  const b = JSON.parse(fs.readFileSync(args[i + 2], "utf8"));
  const d = SCORE.compare(a.summary, b.summary);
  const row = (label, o) => {
    const fmt = (v) => (v == null ? "n/a" : (Math.round(v * 1000) / 1000).toString());
    const arrow = o.delta == null ? "" : (o.delta > 0 ? "  +" : "   ") + fmt(o.delta);
    console.log(`  ${label.padEnd(22)} ${fmt(o.baseline).padStart(10)} -> ${fmt(o.candidate).padStart(10)}${arrow}`);
  };
  console.log(`\nbaseline: ${a.label} (${a.model || "model not recorded"}, ${a.ranAt})`);
  console.log(`candidate: ${b.label} (${b.model || "model not recorded"}, ${b.ranAt})\n`);
  row("valuation possible", d.valuationPossibleRate);
  row("subject size found", d.subjectSizeFoundRate);
  row("failures", d.failures);
  Object.keys(d.metrics).sort().forEach((k) => row(k, d.metrics[k]));
  console.log("\nDeltas only. A dozen stochastic searches per run means small moves are noise; read the direction, not the decimal.\n");
  process.exit(0);
}

const BASE = (process.env.EVAL_BASE || "").trim();
const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();
if (!BASE) {
  console.error("EVAL_BASE is required (no default, on purpose: it must not silently hit your normal dev server).");
  console.error("Start an isolated server from a worktree with SUPABASE_URL blank, then set EVAL_BASE to it.");
  process.exit(1);
}
if (!ADMIN_KEY) {
  console.error("ADMIN_KEY is required: it is what makes this an internal caller, which is what the fresh flag and the whole-report bypass are gated on.");
  process.exit(1);
}

const label = flag("--label") || "run";
const only = Number(flag("--only") || 0);
const set = JSON.parse(fs.readFileSync(path.join(__dirname, "eval-set.json"), "utf8"));
const targets = only > 0 ? set.targets.slice(0, only) : set.targets;

async function runOne(t) {
  const started = Date.now();
  const r = await fetch(`${BASE}/api/comps`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": ADMIN_KEY },
    body: JSON.stringify({
      address: t.address, type: t.type, months: t.months, maxComps: t.maxComps,
      txFocus: "both",
      // Never serve this run a report an earlier run wrote.
      fresh: true,
    }),
  });
  const durationMs = Date.now() - started;
  if (!r.ok) {
    let detail = "";
    try { detail = ((await r.json()) || {}).error || ""; } catch (_) {}
    throw new Error(`HTTP ${r.status}${detail ? ": " + detail : ""}`);
  }
  const report = await r.json();
  if (Number(report.locked_count) > 0) {
    throw new Error(`report came back gated (${report.locked_count} locked) — ADMIN_KEY does not match the server's`);
  }
  const metrics = SCORE.scoreReport(report, t, Date.now());
  metrics.durationMs = durationMs;
  return { report: report, metrics: metrics };
}

(async () => {
  const runDir = path.join(__dirname, "eval-runs", `${label}-${Date.now()}`);
  fs.mkdirSync(runDir, { recursive: true });
  const results = [];
  for (const t of targets) {
    const name = `${t.type} — ${t.address}`;
    process.stdout.write(`${name} ... `);
    try {
      const { report, metrics } = await runOne(t);
      fs.writeFileSync(path.join(runDir, `${results.length + 1}.json`), JSON.stringify(report, null, 2));
      results.push({ target: name, ok: true, metrics: metrics });
      console.log(`${metrics.comps} comps, ${metrics.pricedSales} priced sales, ${(metrics.durationMs / 1000).toFixed(0)}s`);
    } catch (e) {
      // A failure is data, not a reason to abandon searches already paid for.
      results.push({ target: name, ok: false, error: e.message });
      console.log(`FAILED: ${e.message}`);
    }
  }
  const summary = SCORE.summarize(results);
  const out = {
    label: label,
    model: process.env.MODEL || "(server default)",
    ranAt: new Date().toISOString(),
    base: BASE,
    setSize: targets.length,
    summary: summary,
    results: results,
  };
  const dir = path.join(__dirname, "docs", "evals");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nScored ${summary.scored}/${summary.targets} (${summary.failures} failed).`);
  console.log(`Valuation possible: ${(summary.valuationPossibleRate * 100).toFixed(0)}%`);
  console.log(`Raw reports: ${runDir}`);
  console.log(`Summary: ${file}`);
})();
```

- [ ] **Step 4: Syntax + suite**

Run: `node --check run-eval.js` and `node --check eval-score.js`, then `npm test`.

- [ ] **Step 5: Prove the plumbing end to end (2 targets, about $0.72)**

Start an isolated server from this worktree (real API key, no database):

```bash
SUPABASE_URL="" SUPABASE_SERVICE_KEY="" ADMIN_KEY=evalkey ACCOUNT_WALL=off GUEST_SEARCH_LIMIT=off PORT=3170 node server.js
```

(The key comes from the worktree's own `.env`; copy it in if absent.) Then:

```bash
EVAL_BASE=http://localhost:3170 ADMIN_KEY=evalkey node run-eval.js --label plumbing --only 2
```

Confirm and record in your report: both targets scored, a summary file written under `docs/evals/`, raw reports under `eval-runs/`, and the server log showing two real Anthropic calls with NO "Cache hit" line. Then re-run the identical command and confirm the server AGAIN logs real calls rather than cache hits, which is the proof that `fresh: true` works (this costs another ~$0.72; it is the single most important check in this plan, because a silent cache hit is the failure mode the whole flag exists to prevent). Stop the server.

Delete the two throwaway summary files from `docs/evals/` before committing (they are plumbing checks, not a baseline).

- [ ] **Step 6: Commit**

```bash
git status --short
git add eval-set.json run-eval.js .gitignore
git commit -m "run-eval.js: score the golden set against a real search"
```

---

### Task 4: docs + devlog

**Files:**
- Modify: `CLAUDE.md` (a paragraph after the `MODEL` sentence, which currently says the model is hard-coded)
- Modify: `devlog.json` (append one entry)

**Interfaces:**
- Consumes: shipped behavior from Tasks 1-3.

- [ ] **Step 1: CLAUDE.md**

The file currently says: "`MODEL` is hard-coded in `server.js` as `claude-sonnet-4-6`. If the API returns a 404 for the model, list available models via `GET https://api.anthropic.com/v1/models` with the key and update the constant — an earlier model ID was retired."

Replace the first sentence's "hard-coded in `server.js`" with "set in `server.js`, overridable by a `MODEL` environment variable (unset in production, so the constant is the live value)", keep the rest of that paragraph, and append:

> **Measuring a model or prompt change** (2026-08-09). `run-eval.js` puts the 12 fixed targets in `eval-set.json` through real searches and scores each report with the pure, tested `eval-score.js` (priced sale comps and whether a valuation was possible at all, provenance weighted with `valuation.js`'s own `TIER_WEIGHT`, aggregate-address and out-of-window and off-market rates, narrative lengths against the 2026-08-03 caps, wall clock). It is a SCORECARD, not an assertion suite: nothing has a pass/fail threshold, because a dozen stochastic searches are noisy, and the product is `--compare` between two runs. Summaries land in `docs/evals/` (committed, so history accumulates); raw reports go to the git-ignored `eval-runs/`. Two things make it trustworthy and must not be undone: the run sends `fresh: true`, an internal-only flag that skips BOTH cache read paths (the exact hit and the derivable-window one), because a cached report would score the model that wrote it and report a false "no difference"; and the runner must target a server started from a separate worktree with `SUPABASE_URL` blank, so every write lands in that worktree's own fallback files instead of production's corpus, market pages, and cache. A full run costs about $4.30, a model comparison about $8.60. The accuracy backtest (`/api/accuracy`) is the other half of the picture and answers a different question: it scores the reconciliation math over comps already harvested, never what a search found.

- [ ] **Step 2: devlog entry**

Append to `devlog.json` (surgical edit, clean UTF-8, validate it parses and the mojibake-pattern count is unchanged):

```json
{ "date": "2026-08-09", "type": "improvement",
  "title": "Search quality can finally be measured instead of guessed at",
  "details": "A new eval harness runs a fixed set of 12 addresses through real searches and scores what came back: how many priced sale comps, whether a valuation was possible at all, how good the sources were, how many comps sat outside the window or the market. Two runs can be compared, so a model upgrade or a prompt change is now a decision with numbers behind it. Nothing customer-facing changed." }
```

- [ ] **Step 3: Verify + commit**

Run `npm test`, then the JSON parse check on devlog.json, then:

```bash
git status --short
git add CLAUDE.md devlog.json
git commit -m "Document the search-quality eval harness"
```

---

## Post-merge (owner-triggered, not part of implementation)

The first real baseline run is an owner decision because it costs money: start the isolated server, run the full 12 with `--label sonnet-4-6`, and commit that summary as the baseline. A model comparison is then a second run with `MODEL=<candidate>` and `--label <candidate>`, followed by `--compare`. Nothing here needs deploying: no production behavior changes until someone sets `MODEL` in Render, which is a separate decision.

## Self-review notes

- Spec coverage: scorecard-not-assertions (Task 1's module comment and the absence of any threshold), isolation contract (runner's EVAL_BASE refusal + comment, CLAUDE.md paragraph), both server changes with the two-read-path guard (Task 2 Step 3), every named metric (Task 1's `scoreReport`), failure handling excluded from averages with the count surfaced (Task 1's `summarize` + `AVERAGED` comment, runner's catch), the four files and where each output lives (Task 3), out-of-scope items (nothing in the plan builds an /admin card, CI gate, or token plumbing), testing including the 2-target plumbing check and the deferred first full run (Task 3 Step 5, Post-merge).
- Type consistency: `scoreReport(report, target, now)` / `summarize(results)` / `compare(baseline, candidate)` used identically in tests, runner, and docs; the runner attaches `durationMs` onto the metrics object before `summarize` averages it, and `durationMs` is in `AVERAGED`.
- Placeholder scan: clean; every code block is complete and runnable.
- One judgment call worth flagging to a reviewer: the golden-set addresses are plausible real-world CRE addresses chosen for market and type coverage, not verified parcels. A target that consistently fails to geocode or returns nothing should be replaced (and the replacement noted in `why`), which the set's own `note` field instructs.
