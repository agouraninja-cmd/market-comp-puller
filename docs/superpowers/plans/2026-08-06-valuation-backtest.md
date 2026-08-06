# Valuation Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure how far CompNinja's valuation math lands from known sale prices, by holding each usable comp-corpus row out and valuing it from its peers, and show the result on `/admin`.

**Architecture:** Extract the browser's valuation core into a shared pure module (`valuation.js`) that both `index.html` and Node can load, so the harness runs the same arithmetic customers see rather than a copy of it. A second pure module (`backtest.js`) does hold-one-out scoring over corpus rows. `server.js` owns the database read, a 15-minute memo and an admin-gated `GET /api/accuracy`, following the `/api/corpus-audit` pattern exactly.

**Tech Stack:** Plain Node 18+ (built-in `fetch`), `node:test` + `node:assert`, zero npm dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-08-06-valuation-backtest-design.md`

## Global Constraints

- **Zero npm dependencies.** Nothing may be added to `package.json`.
- **Node 18+**, plain CommonJS for Node modules. `valuation.js` is the one exception: it must load in a browser too, via the dual-export wrapper in Task 1.
- **Pure modules are pure:** no I/O, no `fetch`, no `Date.now()` inside the module (the caller passes `now` / `asOf`), no `require` except other pure modules. This is what lets `npm test` run them with no database.
- **Run tests with:** `npm test` (which is `node --test "test/*.test.js"`). If `node` is not on PATH, prefix with `$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path`.
- **Editing `server.js` requires restarting the process** to see the change. Editing `index.html` does not.
- **A Claude Code hook regenerates `tailwind.css`** when `index.html` is edited in a session. This plan adds no new Tailwind utility classes, so the regenerated file should be byte-identical. Do not regenerate by hand.
- **Shared checkout.** Another session and a human collaborator use this working tree. Run `git status --short` immediately before staging, stage explicit paths only, and never `git add -A` or `git add .`.
- **`/admin` must never break.** Every new route here fails safe with HTTP 200 and `{ error: "unavailable" }`, matching `/api/corpus-audit`. A dashboard is what the owner opens when something else is already wrong.
- **No fabricated zeros.** A failed read, an empty corpus, or a sample below the floor renders text, never `0%`.

---

### Task 1: `valuation.js`, the shared pure valuation core

Creates the module by moving code out of `index.html` verbatim, with two signature changes that remove the impure inputs. `index.html` is **not** touched in this task, so nothing customer-facing can regress; the wiring happens in Task 2.

**Files:**
- Create: `valuation.js`
- Create: `test/valuation.test.js`
- Read for reference: `index.html:2115-2135` (`numericValue`, `salePsfOf`), `index.html:2909-2995` (`robustPpsfRange`, `heroRound`, `TIER_WEIGHT`, `compAgeYears`, `compWeight`, `trendFactor`), `index.html:8069-8119` (`isVerifiedComp`, `SOURCE_TIERS`, `compTier`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `numericValue(str) -> number|NaN`
  - `salePsfOf(comp) -> number|NaN`
  - `heroRound(v) -> number`
  - `robustPpsfRange(items) -> { low, mid, high, trimmed }` where `items` is `Array<number | { v, w }>`
  - `compAgeYears(comp, asOfMs) -> number|null`
  - `compWeight(comp, asOfMs, subjSF) -> number`
  - `trendFactor(comp, asOfMs, trendPct) -> number`
  - `tierOf(comp) -> "verified"|"public_record"|"listing"|"news"|"estimate"|"user"|null`
  - `TIER_WEIGHT` object

**Two signature changes, both behavior-preserving:**
- `compAgeYears(c, meta)` becomes `compAgeYears(c, asOfMs)`. The old body read `meta.generatedAt` and fell back to `Date.now()`; the caller now resolves that.
- `trendFactor(c, meta, parsed)` becomes `trendFactor(c, asOfMs, trendPct)`. The old body read `parsed.annual_price_trend_pct`; the caller now passes the number.

`compTier` is renamed `tierOf` and stops depending on `SOURCE_TIERS` (a display map that stays in `index.html`), keying off `TIER_WEIGHT` instead. The two maps carry the same six keys today, so behavior is identical.

- [ ] **Step 1: Write the failing test**

Create `test/valuation.test.js`:

```js
// The valuation core, extracted from index.html so the browser and the
// accuracy harness run one copy of the math.
//
// Run: npm test
//
// These are CHARACTERIZATION tests: every expected value is what the inline
// code in index.html produced before the extraction. They exist to prove the
// move changed nothing, so do not "fix" one by adjusting the expectation.

const test = require("node:test");
const assert = require("node:assert");

const V = require("../valuation");

const AS_OF = Date.parse("2026-07-01");

// A comp shaped the way the report's comps array is shaped.
function comp(over) {
  return Object.assign({
    address: "100 Main St, Boise, ID",
    transaction: "Sale",
    date: "2026-07-01",
    size_sqft: "10000",
    price_per_sqft: "100",
    source_type: "public_record",
  }, over || {});
}

test("numericValue strips commas and currency", () => {
  assert.equal(V.numericValue("$1,500,000"), 1500000);
  assert.equal(V.numericValue("150.5"), 150.5);
  assert.ok(Number.isNaN(V.numericValue(null)));
  assert.ok(Number.isNaN(V.numericValue("no digits here")));
});

test("salePsfOf prefers the reported figure, then derives price / size", () => {
  assert.equal(V.salePsfOf(comp({ price_per_sqft: "$150" })), 150);
  assert.equal(
    V.salePsfOf(comp({ price_per_sqft: "", price_or_rate: "$1,500,000", size_sqft: "10,000" })),
    150);
});

test("salePsfOf refuses a shorthand price that would derive a nonsense rate", () => {
  // numericValue("$1.2M") is 1.2, so the derived rate is 0.00012/SF. The
  // 1..100000 guard is what stops that reaching the valuation.
  assert.ok(Number.isNaN(
    V.salePsfOf(comp({ price_per_sqft: "", price_or_rate: "$1.2M", size_sqft: "10000" }))));
});

test("heroRound steps by magnitude", () => {
  assert.equal(V.heroRound(45678), 46000);         // < 100k  -> 1,000
  assert.equal(V.heroRound(926987), 925000);       // < 1M    -> 5,000
  assert.equal(V.heroRound(1234567), 1225000);     // < 10M   -> 25,000
  assert.equal(V.heroRound(12345678), 12300000);   // >= 10M  -> 100,000
});

test("heroRound is idempotent, so a rounded value can pass through it again", () => {
  [45678, 926987, 1234567, 12345678].forEach((v) => {
    assert.equal(V.heroRound(V.heroRound(v)), V.heroRound(v));
  });
});

test("robustPpsfRange with two comps shows the raw spread, untrimmed", () => {
  const rr = V.robustPpsfRange([{ v: 100, w: 1 }, { v: 200, w: 1 }]);
  assert.equal(rr.low, 100);
  assert.equal(rr.mid, 150);
  assert.equal(rr.high, 200);
  assert.equal(rr.trimmed, false);
});

test("robustPpsfRange with four comps trims to weighted quartiles", () => {
  const rr = V.robustPpsfRange([100, 200, 300, 400].map((v) => ({ v, w: 1 })));
  assert.equal(rr.low, 150);
  assert.equal(rr.mid, 250);
  assert.equal(rr.high, 350);
  assert.equal(rr.trimmed, true);
});

test("robustPpsfRange accepts bare numbers as weight-1 items", () => {
  const rr = V.robustPpsfRange([100, 200, 300, 400]);
  assert.equal(rr.low, 150);
  assert.equal(rr.high, 350);
});

test("compAgeYears is zero for a same-day comp and capped at five years", () => {
  assert.equal(V.compAgeYears(comp({ date: "2026-07-01" }), AS_OF), 0);
  assert.equal(V.compAgeYears(comp({ date: "2010-01-01" }), AS_OF), 5);
  assert.equal(V.compAgeYears(comp({ date: "not a date" }), AS_OF), null);
});

test("compWeight is 1 for a same-day, same-size, public-record comp", () => {
  assert.equal(V.compWeight(comp(), AS_OF, 10000), 1);
});

test("compWeight halves once per octave beyond 2x the subject size", () => {
  // 40,000 SF against a 10,000 SF subject is two octaves, so one halving.
  assert.equal(V.compWeight(comp({ size_sqft: "40000" }), AS_OF, 10000), 0.5);
});

test("compWeight gives a free pass inside 0.5x-2x", () => {
  assert.equal(V.compWeight(comp({ size_sqft: "20000" }), AS_OF, 10000), 1);
  assert.equal(V.compWeight(comp({ size_sqft: "5000" }), AS_OF, 10000), 1);
});

test("compWeight applies the source tier", () => {
  assert.equal(V.compWeight(comp({ source_type: "listing" }), AS_OF, 10000), 0.85);
  assert.equal(V.compWeight(comp({ source_type: "news" }), AS_OF, 10000), 0.7);
  assert.equal(V.compWeight(comp({ source_type: "estimate" }), AS_OF, 10000), 0.5);
});

test("compWeight floors at 0.15 so no comp silently vanishes", () => {
  // Seven years old (capped to five), three octaves off size, estimate tier:
  // 0.176776 * 0.25 * 0.5 = 0.0221, well under the floor.
  const w = V.compWeight(
    comp({ date: "2019-07-01", size_sqft: "80000", source_type: "estimate" }), AS_OF, 10000);
  assert.equal(w, 0.15);
});

test("compWeight treats missing data as neutral, never as a penalty", () => {
  assert.equal(V.compWeight(comp({ date: "", size_sqft: "", source_type: "" }), AS_OF, 10000), 1);
});

test("trendFactor compounds the market trend over the comp's age", () => {
  const f = V.trendFactor(comp({ date: "2024-07-01" }), AS_OF, 10);
  assert.ok(Math.abs(f - 1.21) < 0.005, "expected ~1.21, got " + f);
});

test("trendFactor caps extrapolation at three years", () => {
  const five = V.trendFactor(comp({ date: "2021-07-01" }), AS_OF, 10);
  assert.ok(Math.abs(five - 1.331) < 0.005, "expected ~1.331, got " + five);
});

test("trendFactor is identity without a usable trend", () => {
  assert.equal(V.trendFactor(comp({ date: "2024-07-01" }), AS_OF, null), 1);
  assert.equal(V.trendFactor(comp({ date: "2024-07-01" }), AS_OF, 0), 1);
  assert.equal(V.trendFactor(comp({ date: "2024-07-01" }), AS_OF, 45), 1);  // server bounds at 30
  assert.equal(V.trendFactor(comp({ date: "2026-07-01" }), AS_OF, 10), 1);  // age 0
});

test("tierOf reads the verified flag first, then the source type", () => {
  assert.equal(V.tierOf(comp({ verified: true })), "verified");
  assert.equal(V.tierOf(comp({ verified: "true" })), "verified");
  assert.equal(V.tierOf(comp({ source_type: "listing" })), "listing");
  assert.equal(V.tierOf(comp({ source_type: "who knows" })), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `Cannot find module '../valuation'`.

- [ ] **Step 3: Create `valuation.js`**

```js
// ---------------------------------------------------------------------------
// The valuation core: how a set of comps becomes a value range.
//
// Extracted from index.html on 2026-08-06 so the browser and the accuracy
// harness (backtest.js) run ONE copy of this math. A second copy would let the
// harness report a healthy number for arithmetic no customer runs, and nothing
// would catch it. The repo already carries two such pairs (compWeight and
// exportReportKey, both flagged in CLAUDE.md); this module exists so the
// valuation is not a third.
//
// PURE, like entitlements.js, comp-gate.js and corpus-audit.js: no DOM, no
// globals, no fetch, and no clock reads. The caller passes `asOf` and the
// market trend. That is what lets `npm test` exercise the whole thing.
//
// Loads in both a browser (as the global `VALUATION`) and Node (as a CommonJS
// module), which is new for this repo: every other pure module here is
// Node-only.
// ---------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VALUATION = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function numericValue(str) {
    if (str == null) return NaN;
    const m = String(str).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  // A sale comp's $/SF for the valuation math. Fresh reports arrive with the
  // server's reconciled figure; saved and shared reports from before that
  // change never re-touch the server, so derive price / size at read time or
  // their unpriced comps silently drop out of the range. The sane per-SF band
  // guards against numericValue's shorthand hazard ("$1.2M" -> 1.2).
  function salePsfOf(c) {
    const v = numericValue(c.price_per_sqft);
    if (v > 0) return v;
    const p = numericValue(c.price_or_rate), s = numericValue(c.size_sqft);
    if (p > 0 && s > 0) {
      const d = p / s;
      if (d >= 1 && d <= 100000) return d;
    }
    return NaN;
  }

  // Weighted percentile band. Four or more comps get an outlier-resistant
  // interquartile band; below that there is nothing to trim, so the raw spread
  // stands and `trimmed` says so.
  function robustPpsfRange(vals) {
    const items = vals
      .map((x) => (typeof x === "number" ? { v: x, w: 1 } : x))
      .sort((a, b) => a.v - b.v);
    const n = items.length;
    const total = items.reduce((sum, x) => sum + x.w, 0);
    let cum = 0;
    const pos = items.map((x) => { const p = (cum + x.w / 2) / total; cum += x.w; return p; });
    const q = (p) => {
      if (p <= pos[0]) return items[0].v;
      if (p >= pos[n - 1]) return items[n - 1].v;
      let i = 0;
      while (pos[i + 1] < p) i++;
      const t = (p - pos[i]) / (pos[i + 1] - pos[i]);
      return items[i].v + t * (items[i + 1].v - items[i].v);
    };
    if (n >= 4) return { low: q(0.25), mid: q(0.5), high: q(0.75), trimmed: true };
    return { low: items[0].v, mid: q(0.5), high: items[n - 1].v, trimmed: false };
  }

  // Display rounding for TOTAL dollar figures. "$926,987" projects a precision
  // the math does not have: it is an interpolated percentile of a handful of
  // comps times a size range.
  function heroRound(v) {
    if (!isFinite(v) || v === 0) return v;
    const a = Math.abs(v);
    const step = a >= 10e6 ? 100000 : a >= 1e6 ? 25000 : a >= 100000 ? 5000 : 1000;
    return Math.round(v / step) * step;
  }

  // Source-tier weights. Also the tier vocabulary: index.html's SOURCE_TIERS
  // holds the badge labels and CSS classes for the same six keys, and tierOf
  // below is the ONE place a comp's tier is decided.
  const TIER_WEIGHT = { verified: 1, user: 1, public_record: 1, listing: 0.85, news: 0.7, estimate: 0.5 };

  function tierOf(comp) {
    if (comp.verified === true || String(comp.verified).toLowerCase() === "true") return "verified";
    return TIER_WEIGHT[comp.source_type] != null ? comp.source_type : null;
  }

  // Age in years at `asOf`, capped at five. A future-dated comp reads as 0
  // rather than negative, and an unparseable date reads as null (neutral).
  function compAgeYears(c, asOf) {
    const d = Date.parse(c.date);
    if (isNaN(d)) return null;
    const yrs = (asOf - d) / (365.25 * 24 * 3600 * 1000);
    return yrs > 0 ? Math.min(yrs, 5) : 0;
  }

  // Three quiet factors, multiplied:
  //   recency      2-year half-life on the comp's age at the report date
  //   size match   free pass within 0.5x-2x of the subject, halving per
  //                further doubling (a 5k SF building should not be priced by
  //                a 100k SF warehouse: big buildings trade at lower $/SF)
  //   source       verified/public-record full weight, down to half for model
  //                estimates (mirrors the badge tiers)
  // Floored at 0.15 so no comp silently vanishes from a range it visibly sits
  // in. Missing data is neutral, never a penalty.
  function compWeight(c, asOf, subjSF) {
    let w = 1;
    const age = compAgeYears(c, asOf);
    if (age !== null) w *= Math.pow(0.5, age / 2);
    const compSF = numericValue(c.size_sqft);
    if (subjSF > 0 && compSF > 0) {
      const octaves = Math.abs(Math.log2(compSF / subjSF));
      if (octaves > 1) w *= Math.pow(0.5, octaves - 1);
    }
    const tier = tierOf(c);
    if (tier && TIER_WEIGHT[tier] != null) w *= TIER_WEIGHT[tier];
    return Math.max(0.15, w);
  }

  // Index an older comp's price to the report date at the market's annual
  // trend, compounded over the comp's age and capped at three years so an
  // out-of-window straggler is never extrapolated into fiction. `trendPct` is
  // the model's market-level figure (server-bounded to +/-30%/yr, null when
  // its searches showed no clear trend).
  function trendFactor(c, asOf, trendPct) {
    const pct = Number(trendPct);
    if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 30) return 1;
    const age = compAgeYears(c, asOf);
    if (!age) return 1;
    return Math.pow(1 + pct / 100, Math.min(age, 3));
  }

  return {
    numericValue, salePsfOf, robustPpsfRange, heroRound,
    TIER_WEIGHT, tierOf, compAgeYears, compWeight, trendFactor,
  };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS. The whole suite should still be green; nothing else imports this yet.

- [ ] **Step 5: Commit**

```bash
git status --short
git add -- valuation.js test/valuation.test.js
git diff --cached --stat
git commit -m "Extract the valuation core into a shared pure module"
```

---

### Task 2: Wire `index.html` to the module

Deletes the inline copies and points `index.html` at `valuation.js`. The trick that keeps this diff small: destructure the module into local `const`s with the **same names**, so all 49 `numericValue` call sites, 8 `heroRound` call sites and the rest stay untouched.

**Files:**
- Modify: `index.html` (add script tag in `<head>`; add destructuring line at the top of the main inline script; delete lines `2115-2119`, `2126-2135`, `2909-2941`, `2959-2995`; rewrite `compTier` at `8116-8119`)
- Modify: `server.js:10804` (add `/valuation.js` to `STATIC_FILES`)

**Interfaces:**
- Consumes: everything Task 1 produces, via the browser global `VALUATION`.
- Produces: nothing new. `compTier(comp)` keeps its name and behavior in `index.html` as a one-line delegate.

- [ ] **Step 1: Serve the file**

In `server.js`, add one line to `STATIC_FILES` (around line 10805). A short `max-age` matches `tailwind.css`, because this file changes with the app and a stale copy would be a stale valuation:

```js
    "/valuation.js": { file: "valuation.js", type: "text/javascript; charset=utf-8", maxAge: 300 },
```

- [ ] **Step 2: Load it in `index.html`**

Add the script tag next to the existing `tailwind.css` link in `<head>`. It must be a plain (non-module, non-deferred) script so it executes before the main inline script:

```html
  <script src="/valuation.js"></script>
```

- [ ] **Step 3: Alias the module into the existing names**

At the top of the main inline `<script>` in `index.html`, before any function that uses them:

```js
  // The valuation core lives in /valuation.js so the accuracy harness on
  // /admin runs the same math this page does. Aliased into the original names
  // so every call site below reads exactly as it did when these were local.
  const { numericValue, salePsfOf, robustPpsfRange, heroRound,
          compAgeYears, compWeight, trendFactor } = VALUATION;
```

- [ ] **Step 4: Delete the inline copies**

Delete these blocks, **including their comments**. Every comment that documented a decision was carried over verbatim into `valuation.js` in Task 1, so leaving a copy here would create the exact drift this task exists to remove. Verify before deleting: each comment below should already appear in `valuation.js`.

- `numericValue` (`index.html:2115-2119`)
- `salePsfOf` and its comment (`index.html:2120-2135`)
- `robustPpsfRange` (`index.html:2909-2927`)
- `heroRound` and its comment (`index.html:2929-2941`)
- the `TIER_WEIGHT` const, `compAgeYears`, `compWeight` and the big comment block above them (`index.html:2943-2981`)
- `trendFactor` and its comment (`index.html:2983-2995`)

Leave `offSizeClass`, `matchQuality`, `subjectSizeForMatch`, `indexedPsfNote` and `MATCH_TIERS` alone: they read page globals and stay.

- [ ] **Step 5: Delegate `compTier`**

Replace `index.html:8116-8119` with:

```js
  // One source of truth for a comp's tier: valuation.js owns the vocabulary
  // (it has to, since compWeight keys off it). SOURCE_TIERS above keeps only
  // the badge label and CSS class for each of those same keys.
  function compTier(comp) {
    return VALUATION.tierOf(comp);
  }
```

`isVerifiedComp` at `index.html:8069` has other callers and stays.

- [ ] **Step 6: Fix the changed call sites**

Six call sites pass `meta` or `parsed` and must now pass `asOf` / `trendPct`. Add this helper next to `subjectSizeForMatch` in `index.html`:

```js
  // The report date the weighting measures ages against. Anchored to the
  // report, not the wall clock, so a saved report's numbers do not drift as
  // it ages (the old compAgeYears read this out of meta itself).
  function asOfOf(meta) {
    return meta && meta.generatedAt ? new Date(meta.generatedAt).getTime() : Date.now();
  }
  function trendPctOf(parsed) {
    return parsed ? parsed.annual_price_trend_pct : null;
  }
```

Then update each call site:

| Line | Was | Becomes |
|---|---|---|
| 3025 | `compWeight(comp, meta, subjectSizeForMatch(parsed))` | `compWeight(comp, asOfOf(meta), subjectSizeForMatch(parsed))` |
| 3030 | `compAgeYears(comp, meta)` | `compAgeYears(comp, asOfOf(meta))` |
| 3054 | `trendFactor(comp, meta, parsed)` | `trendFactor(comp, asOfOf(meta), trendPctOf(parsed))` |
| 3101 | `trendFactor(x.comp, meta, parsed)` | `trendFactor(x.comp, asOfOf(meta), trendPctOf(parsed))` |
| 3102 | `compWeight(x.comp, meta, 0)` | `compWeight(x.comp, asOfOf(meta), 0)` |
| 3173 | `trendFactor(x.comp, meta, parsed)` | `trendFactor(x.comp, asOfOf(meta), trendPctOf(parsed))` |
| 3174 | `compWeight(x.comp, meta, subjSFMid)` | `compWeight(x.comp, asOfOf(meta), subjSFMid)` |
| 3549 | `trendFactor(x.comp, meta, parsed)` | `trendFactor(x.comp, asOfOf(meta), trendPctOf(parsed))` |
| 3550 | `compWeight(x.comp, meta, subjSFMid)` | `compWeight(x.comp, asOfOf(meta), subjSFMid)` |
| 5890 | `compAgeYears(c, meta)` | `compAgeYears(c, asOfOf(meta))` |

Line numbers shift as blocks are deleted in Step 4, so find each by its text rather than by number. Verify none remain:

```bash
grep -n -E "compWeight\(|trendFactor\(|compAgeYears\(" index.html
```

Every hit should now pass `asOfOf(...)`.

- [ ] **Step 5b: Syntax-check and run the suite**

```bash
node --check server.js
node --check valuation.js
npm test
```

Expected: all pass. Note `node --check` cannot check `index.html`; the browser check is the next step.

- [ ] **Step 7: Verify the report renders identically**

Start the server, run one search (or open a saved report from My Desk, which needs no billed search), and confirm:

1. The hero shows a Low / Likely / High range, not `$NaN` or a blank card.
2. The trust line under it still reads "Based on N sale comps ... Recent, similar-size, well-sourced comps count more".
3. The comp table's Match column still shows Strong / Fair / Weak.
4. The browser console has **no** errors, in particular no `VALUATION is not defined`.
5. `GET /valuation.js` returns 200 with `content-type: text/javascript` (check the network panel).

If the hero is blank, the usual cause is the script tag being placed after the inline script or marked `defer`.

- [ ] **Step 8: Commit**

```bash
git status --short
git add -- index.html server.js
git diff --cached
git commit -m "Point index.html at the shared valuation module"
```

Read the whole staged diff before committing: `index.html` is a file another session may also be editing.

---

### Task 3: `valueFromComps`, the one composition

The leaves are shared now, but the *sequence* that turns comps into a range is still written out three times in `index.html` (`altBasisRange` at 3088, `renderOwnerHero` at 3164, and the likely-value helper at 3542, whose own comment reads "Same weighting/indexing as the hero, so this can never disagree with it"). The harness must not become a fourth. This task adds the composition and converts the hero.

**Files:**
- Modify: `valuation.js` (add `valueFromComps`)
- Modify: `test/valuation.test.js` (add cases)
- Modify: `index.html` (`renderOwnerHero`, around 3164-3175 and 3296-3313)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `valueFromComps(comps, { subjectSF, asOf, trendPct, valueOf }) -> { psfLow, psfMid, psfHigh, low, mid, high, n, trimmed, raw } | null`
  - `subjectSF` is a number **or** `{ min, max }`. The range form is load-bearing: the hero multiplies low by `sizeR.min` and high by `sizeR.max`, so a scalar could not reproduce it for an owner who enters a size range. A number is treated as `min === max`.
  - `valueOf` defaults to `salePsfOf`; `altBasisRange` passes its own extractor in Task 4.
  - Lease comps are filtered out inside, always. Leases are quoted per SF per year and would skew the range, and `trendFactor` never indexes them.
  - Returns `null` when no comp yields a usable value.

- [ ] **Step 1: Write the failing test**

Append to `test/valuation.test.js`:

```js
test("valueFromComps composes the weighted, trimmed range and the totals", () => {
  // Four same-day, same-size, public-record comps: equal weights, so the
  // quartiles are exact and independent of the weighting.
  const comps = [100, 200, 300, 400].map((psf) =>
    comp({ price_per_sqft: String(psf), address: psf + " Main St" }));
  const v = V.valueFromComps(comps, { subjectSF: 10000, asOf: AS_OF, trendPct: null });
  assert.equal(v.psfLow, 150);
  assert.equal(v.psfMid, 250);
  assert.equal(v.psfHigh, 350);
  assert.equal(v.low, 1500000);
  assert.equal(v.mid, 2500000);
  assert.equal(v.high, 3500000);
  assert.equal(v.n, 4);
  assert.equal(v.trimmed, true);
});

test("valueFromComps spans a size RANGE the way the hero does", () => {
  const comps = [100, 200, 300, 400].map((psf) =>
    comp({ price_per_sqft: String(psf), address: psf + " Main St" }));
  const v = V.valueFromComps(comps, {
    subjectSF: { min: 8000, max: 12000 }, asOf: AS_OF, trendPct: null,
  });
  assert.equal(v.low, 150 * 8000);    // low $/SF x the SMALLEST size
  assert.equal(v.mid, 250 * 10000);   // mid $/SF x the MIDPOINT size
  assert.equal(v.high, 350 * 12000);  // high $/SF x the LARGEST size
});

test("valueFromComps drops leases, which are a different unit", () => {
  const comps = [
    comp({ price_per_sqft: "100", address: "1 Main St" }),
    comp({ price_per_sqft: "200", address: "2 Main St" }),
    comp({ price_per_sqft: "9", address: "3 Main St", transaction: "Lease" }),
  ];
  const v = V.valueFromComps(comps, { subjectSF: 10000, asOf: AS_OF, trendPct: null });
  assert.equal(v.n, 2);
  assert.equal(v.psfLow, 100);
  assert.equal(v.psfHigh, 200);
});

test("valueFromComps takes an alternate value extractor for $/unit bases", () => {
  const comps = [100000, 200000, 300000, 400000].map((ppu) =>
    comp({ price_per_unit: String(ppu), address: ppu + " Main St" }));
  const v = V.valueFromComps(comps, {
    subjectSF: 0, asOf: AS_OF, trendPct: null,
    valueOf: (c) => V.numericValue(c.price_per_unit),
  });
  assert.equal(v.psfLow, 150000);
  assert.equal(v.psfMid, 250000);
  assert.equal(v.psfHigh, 350000);
});

test("valueFromComps returns null when nothing carries a usable value", () => {
  assert.equal(V.valueFromComps([], { subjectSF: 10000, asOf: AS_OF }), null);
  assert.equal(
    V.valueFromComps([comp({ price_per_sqft: "", price_or_rate: "", size_sqft: "" })],
      { subjectSF: 10000, asOf: AS_OF }),
    null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `V.valueFromComps is not a function`.

- [ ] **Step 3: Add `valueFromComps` to `valuation.js`**

Insert before the `return { ... }` at the bottom of the factory, and add `valueFromComps` to that returned object:

```js
  // The whole sequence, in one place: filter to sales, read each comp's value,
  // index it to the report date, weight it, take the band, and apply the
  // subject's size. index.html wrote this out three times and the harness in
  // backtest.js would have been a fourth. It is the composition, not the
  // leaves, that has to be shared: leaves alone still let two callers disagree
  // about the ORDER of operations, which is exactly what an accuracy harness
  // must not do.
  //
  // `subjectSF` is a number or { min, max }. The range form is what the hero
  // uses: low $/SF against the smallest size, high against the largest.
  function valueFromComps(comps, opts) {
    const o = opts || {};
    const valueOf = o.valueOf || salePsfOf;
    const sf = o.subjectSF;
    const isRange = sf && typeof sf === "object";
    const sizeMin = Number(isRange ? sf.min : sf) || 0;
    const sizeMax = Number(isRange ? sf.max : sf) || 0;
    const sizeMid = (sizeMin + sizeMax) / 2;

    const items = (comps || [])
      .filter((c) => c && !String(c.transaction || "").toLowerCase().startsWith("lease"))
      .map((c) => ({ comp: c, v: valueOf(c) }))
      .filter((x) => x.v > 0);
    if (!items.length) return null;

    const rr = robustPpsfRange(items.map((x) => ({
      v: x.v * trendFactor(x.comp, o.asOf, o.trendPct),
      w: compWeight(x.comp, o.asOf, sizeMid),
    })));

    return {
      psfLow: rr.low, psfMid: rr.mid, psfHigh: rr.high,
      low: heroRound(rr.low * sizeMin),
      mid: heroRound(rr.mid * sizeMid),
      high: heroRound(rr.high * sizeMax),
      n: items.length,
      trimmed: rr.trimmed,
      raw: items.map((x) => x.v),
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Convert `renderOwnerHero` to use it**

`wItems` is built once (around 3172) and read by **three** mutually-relevant places, so all four sites change together. Confirm the readers before editing:

```bash
grep -n "wItems" index.html
```

Expected: four hits. The definition, then the `$/SF`-leads branch (~3298), the per-unit branch's `$/SF` cross-check (~3404), and the no-size fallback that shows a bare `$/SF` band (~3445). All three consumers want the same band, which is why one call can serve them.

Add `valueFromComps` to the destructuring line from Task 2 Step 3.

Replace the `wItems` construction:

```js
    const subjSFMid = sizeR ? (sizeR.min + sizeR.max) / 2 : 0;
    const wItems = saleComps.map((x) => ({
      v: x.v * trendFactor(x.comp, asOfOf(meta), trendPctOf(parsed)),
      w: compWeight(x.comp, asOfOf(meta), subjSFMid),
    }));
```

with:

```js
    const subjSFMid = sizeR ? (sizeR.min + sizeR.max) / 2 : 0;
    // One weighted band for the whole hero. All three branches below read it:
    // the $/SF headline, the per-unit branch's $/SF cross-check, and the
    // no-size fallback that shows the band on its own.
    // `sizeR || 0` reproduces the old subjSFMid exactly: a size range weights
    // by its midpoint, and no size at all means no size penalty.
    const val = valueFromComps(saleComps.map((x) => x.comp), {
      subjectSF: sizeR || 0, asOf: asOfOf(meta), trendPct: trendPctOf(parsed),
    });
    const psfBand = val
      ? { low: val.psfLow, mid: val.psfMid, high: val.psfHigh, trimmed: val.trimmed }
      : null;
```

Then replace each consumer:

| Around | Was | Becomes |
|---|---|---|
| 3298 | `const rr = robustPpsfRange(wItems);` | `const rr = psfBand;` |
| 3404 | `const rrSf = robustPpsfRange(wItems);` | `const rrSf = psfBand;` |
| 3445 | `const rr = robustPpsfRange(wItems);` | `const rr = psfBand;` |

Every one of those three sits behind a guard that already requires two or more priced sale comps (`sfUsable`, or `ppsfs.length >= 2`), so `psfBand` is non-null wherever it is read.

Everything downstream of `rr` keeps working unchanged, and `lastValuation` (around 3306) can now read the totals off `val` instead of re-applying `heroRound`, since `valueFromComps` already rounded them against the same `sizeR`:

```js
      lastValuation = {
        low: val.low,
        likely: val.mid,
        high: val.high,
        median_psf: Math.round(rr.mid * 100) / 100,
      };
```

- [ ] **Step 6: Verify the hero is unchanged**

Restart the server, open the same saved report used in Task 2 Step 7, and confirm the Low / Likely / High figures are **identical** to what they were before this task. If they moved, the likely cause is `subjectSF` being passed as `subjSFMid` (a scalar) rather than `sizeR` (the range).

```bash
node --check valuation.js
npm test
```

- [ ] **Step 7: Commit**

```bash
git status --short
git add -- valuation.js test/valuation.test.js index.html
git diff --cached
git commit -m "One composition for the valuation, shared by the hero and the harness"
```

---

### Task 4: Convert the other two compositions

Removes the remaining two hand-written copies so `valueFromComps` really is the only path.

**Files:**
- Modify: `index.html` (`altBasisRange` around 3088-3105; the likely-value helper around 3542-3553)

**Interfaces:**
- Consumes: `valueFromComps` from Task 3.
- Produces: nothing new.

- [ ] **Step 1: Convert `altBasisRange`**

Replace the body's `items` construction and `robustPpsfRange` call:

```js
  function altBasisRange(meta, subject, saleComps, parsed) {
    const spec = ALT_BASIS[meta.type];
    if (!spec) return null;
    const qty = numericValue((subject.details || {})[spec.subjKey]);
    if (!(qty > 0)) return null;
    const carriers = saleComps
      .map((x) => ({ comp: x.comp, v: numericValue(x.comp[spec.compKey]) }))
      .filter((x) => x.v > 0);
    if (carriers.length < 3) return null;
    const per = carriers.map((x) => x.v);
    // Same weighting and indexing as the $/SF headline, through the same
    // function. Size-neutral (subjectSF 0): this basis exists precisely
    // because SF often is not known for these types.
    const val = valueFromComps(carriers.map((x) => x.comp), {
      subjectSF: 0, asOf: asOfOf(meta), trendPct: trendPctOf(parsed),
      valueOf: (c) => numericValue(c[spec.compKey]),
    });
    if (!val) return null;
    return { spec, qty, per, rr: { low: val.psfLow, mid: val.psfMid, high: val.psfHigh, trimmed: val.trimmed } };
  }
```

- [ ] **Step 2: Convert the likely-value helper**

Replace the `saleItems` / `robustPpsfRange` block (around 3542-3553) with:

```js
    // Same weighting and indexing as the hero, through the same function, so
    // this can never disagree with it.
    const val = sizeR ? valueFromComps(valuationComps(), {
      subjectSF: sizeR, asOf: asOfOf(meta), trendPct: trendPctOf(parsed),
    }) : null;
    if (val && val.n >= 2) {
      return { value: val.psfMid * ((sizeR.min + sizeR.max) / 2), source: "comp-based likely value" };
    }
```

Note the guard moved from `saleItems.length >= 2` to `val.n >= 2`; `n` counts the same comps (sales carrying a usable $/SF), so the threshold is unchanged.

- [ ] **Step 3: Confirm no hand-rolled composition remains**

```bash
grep -n "robustPpsfRange(" index.html
```

Expected: **zero** hits. Every range now comes from `valueFromComps`. If `robustPpsfRange` is no longer referenced in `index.html`, drop it from the destructuring line added in Task 2.

- [ ] **Step 4: Verify in the browser**

Restart, then check two reports:
1. A Multifamily or Land report with the subject's unit count or acreage filled in, so `altBasisRange` runs. The hero's "$/unit" or "$/acre" cross-check line must show the same figures as before.
2. Any saved report, to confirm the portfolio value snapshot still computes.

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git status --short
git add -- index.html
git diff --cached
git commit -m "Retire the last two hand-written copies of the valuation sequence"
```

---

### Task 5: `backtest.js`, the hold-one-out harness

**Files:**
- Create: `backtest.js`
- Create: `test/backtest.test.js`

**Interfaces:**
- Consumes: `valuation.js` via `require`. It requires the module directly rather than taking it as an argument, because running the real math is the entire point.
- Produces:
  - `score(rows, { now, parseDealDate, minPeers, minSubjects }) -> report`
  - `report` is `{ scored, minSubjects, belowFloor, skipped: { unusable, notGroundTruth, thinPeers }, medianAbsError, bandCoverage, medianBandWidth, byType }`
  - `medianAbsError`, `bandCoverage` and `medianBandWidth` are fractions (0.18 means 18%) and are `null` when `belowFloor` is true.
  - `byType` is `Array<{ type, scored, medianAbsError, bandCoverage, medianBandWidth }>`, empty when `belowFloor`.

**Two design points worth reading before writing code:**

- **`parseDealDate` is injected, not reimplemented**, exactly as `corpusAuditReport` injects it (`server.js:1599`). It lives in `server.js:4355` and returns a **decimal year** (2026.208333 for "2026-03") or `null`. A row this harness cannot date is a row corpus retrieval cannot see either, and the two must not disagree about that.
- **Subjects and peers have different bars.** A subject is ground truth, so it needs provenance better than `estimate`/`news`; scoring predictions against the model's own guess would measure agreement between two guesses. Peers have no such bar, because in production the model returns comps of every tier and `compWeight` down-weights the weak ones. Restricting peers to good provenance would score a comp set the product never sees.

- [ ] **Step 1: Write the failing test**

Create `test/backtest.test.js`:

```js
// Hold-one-out accuracy scoring over the comp corpus.
//
// Run: npm test
//
// Nothing here touches a database. Fixtures are built so the arithmetic is
// exact: peers share a deal date and a size, which makes their weights equal
// and the quartiles independent of the weighting.

const test = require("node:test");
const assert = require("node:assert");

const BT = require("../backtest");

// The real parseDealDate from server.js, in the two forms these fixtures use.
// Returns a decimal year, or null. Kept deliberately small: the point is to
// inject the same CONTRACT the server injects, not to re-test that parser.
function parseDealDate(s) {
  const m = String(s || "").trim().match(/^((19|20)\d{2})-(\d{2})$/);
  if (!m) return null;
  const mo = Number(m[3]);
  return mo >= 1 && mo <= 12 ? Number(m[1]) + (mo - 0.5) / 12 : null;
}

function row(over) {
  return Object.assign({
    market: "Boise, ID",
    property_type: "Industrial",
    address: "100 Main St, Boise, ID",
    transaction: "Sale",
    deal_date: "2026-01",
    size_sqft: "10000",
    price_or_rate: "$1,000,000",
    price_per_sqft: "100",
    source_type: "public_record",
  }, over || {});
}

// Four peers at 100/200/300/400 dated 2026-01, and one subject at 250 dated
// 2026-06. With minPeers 4 the peers cannot score each other (each sees only
// three), so exactly one subject scores and its numbers are hand-checkable:
// equal weights -> quartiles 150 / 250 / 350 against an actual of 250.
function fixture() {
  return [
    row({ address: "1 A St", price_per_sqft: "100" }),
    row({ address: "2 A St", price_per_sqft: "200" }),
    row({ address: "3 A St", price_per_sqft: "300" }),
    row({ address: "4 A St", price_per_sqft: "400" }),
    row({ address: "9 Subject Way", deal_date: "2026-06", price_per_sqft: "250" }),
  ];
}

const OPTS = { now: Date.parse("2026-07-01"), parseDealDate, minPeers: 4, minSubjects: 1 };

test("score holds a subject out and grades it against its peers", () => {
  const r = BT.score(fixture(), OPTS);
  assert.equal(r.scored, 1);
  assert.equal(r.belowFloor, false);
  // Predicted mid 250 against an actual of 250.
  assert.equal(r.medianAbsError, 0);
  // 250 sits inside 150..350.
  assert.equal(r.bandCoverage, 1);
  // (350 - 150) / 250
  assert.ok(Math.abs(r.medianBandWidth - 0.8) < 1e-9, "got " + r.medianBandWidth);
});

test("score skips a subject without enough peers, and says how many", () => {
  const r = BT.score(fixture(), OPTS);
  // The four 2026-01 rows each see only three peers under minPeers 4.
  assert.equal(r.skipped.thinPeers, 4);
});

test("score never uses a peer that sold after the subject", () => {
  const rows = fixture().concat([
    // A wildly-priced later sale. If as-of filtering broke, the prediction
    // would move and medianAbsError would stop being 0.
    row({ address: "99 Later Ave", deal_date: "2026-12", price_per_sqft: "9999",
          source_type: "estimate" }),
  ]);
  const r = BT.score(rows, OPTS);
  assert.equal(r.scored, 1);
  assert.equal(r.medianAbsError, 0);
});

test("score DOES use an estimate-tier peer, because production does", () => {
  const rows = fixture().concat([
    row({ address: "98 Earlier Ave", deal_date: "2025-12", price_per_sqft: "9999",
          source_type: "estimate" }),
  ]);
  const r = BT.score(rows, OPTS);
  assert.equal(r.scored, 1);
  // The outlier is down-weighted, not ignored, so the prediction moves.
  assert.ok(r.medianAbsError > 0, "estimate-tier peer should have moved the prediction");
});

test("score refuses an estimate-tier row as ground truth", () => {
  const rows = fixture().map((r) =>
    r.address === "9 Subject Way" ? Object.assign({}, r, { source_type: "estimate" }) : r);
  const r = BT.score(rows, OPTS);
  assert.equal(r.scored, 0);
  assert.equal(r.skipped.notGroundTruth, 1);
});

test("score excludes a same-address duplicate from its own peer set", () => {
  const rows = fixture().concat([
    // Same building, harvested twice at a different price: must not help
    // value itself.
    row({ address: "9 SUBJECT WAY  ", deal_date: "2026-05", price_per_sqft: "250" }),
  ]);
  const r = BT.score(rows, OPTS);
  assert.equal(r.scored, 1);
  assert.equal(r.medianAbsError, 0);
});

test("score never mixes markets or property types", () => {
  const rows = fixture().concat([
    row({ address: "5 A St", market: "Ontario, CA", price_per_sqft: "9999" }),
    row({ address: "6 A St", property_type: "Office", price_per_sqft: "9999" }),
  ]);
  const r = BT.score(rows, OPTS);
  assert.equal(r.scored, 1);
  assert.equal(r.medianAbsError, 0);
});

test("score drops rows it cannot use at all, and counts them", () => {
  const rows = fixture().concat([
    row({ address: "7 A St", deal_date: "sometime in 2026" }),   // undateable
    row({ address: "8 A St", price_per_sqft: "", price_or_rate: "" }),  // unpriced
    row({ address: "10 A St", transaction: "Lease" }),           // a lease
  ]);
  const r = BT.score(rows, OPTS);
  assert.equal(r.skipped.unusable, 3);
  assert.equal(r.scored, 1);
});

test("score withholds every figure below the subject floor", () => {
  const r = BT.score(fixture(), Object.assign({}, OPTS, { minSubjects: 20 }));
  assert.equal(r.scored, 1);
  assert.equal(r.belowFloor, true);
  assert.equal(r.medianAbsError, null);
  assert.equal(r.bandCoverage, null);
  assert.equal(r.medianBandWidth, null);
  assert.deepEqual(r.byType, []);
});

test("score breaks results out by property type", () => {
  const r = BT.score(fixture(), OPTS);
  assert.equal(r.byType.length, 1);
  assert.equal(r.byType[0].type, "Industrial");
  assert.equal(r.byType[0].scored, 1);
  assert.equal(r.byType[0].medianAbsError, 0);
});

test("score survives an empty corpus without inventing a number", () => {
  const r = BT.score([], OPTS);
  assert.equal(r.scored, 0);
  assert.equal(r.belowFloor, true);
  assert.equal(r.medianAbsError, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `Cannot find module '../backtest'`.

- [ ] **Step 3: Create `backtest.js`**

```js
// ---------------------------------------------------------------------------
// Valuation backtest: how far the reconciliation lands from a known price.
//
// Hold-one-out over the comp corpus. Any priced, sized corpus row of decent
// provenance is a known outcome, and the rows around it are the comps a search
// would have used. Take one out, value it from its peers with the PRODUCTION
// math, and compare.
//
// Pure, like corpus-audit.js: no I/O, no clock reads (the caller passes `now`),
// and the only require is valuation.js. server.js owns the database read, the
// memo and the route.
//
// WHAT THIS MEASURES: the math, not the comp-finding. It feeds the valuation
// comps that are already in the corpus rather than running a search, so it
// cannot say whether the model finds good comps. It also runs the UNTRENDED
// path, because corpus rows do not store the market trend the search ran with.
// Both limits belong on screen next to the numbers.
//
// See docs/superpowers/specs/2026-08-06-valuation-backtest-design.md.
// ---------------------------------------------------------------------------

"use strict";

const VALUATION = require("./valuation");

// Ground truth needs provenance better than a model guess. This is the same
// standard corpus-first retrieval calls "usable".
const GROUND_TRUTH_TIERS = ["verified", "public_record", "listing"];

// Mirrors the `norm` inside corpusKeyOf (server.js:2256), which is what the
// corpus dedupes addresses with. Kept byte-identical on purpose: if the two
// drift, a building harvested twice could help value itself.
function normAddress(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// parseDealDate returns a decimal year; compAgeYears needs something
// Date.parse can read. Mid-month keeps the error under two weeks, which is
// noise next to a two-year half-life. A bare year ("2026" -> 2026.5) lands in
// July, which is the intended mid-year reading.
function isoFromDecimalYear(dy) {
  const year = Math.floor(dy);
  let month = Math.round((dy - year) * 12 + 0.5);
  if (month < 1) month = 1;
  if (month > 12) month = 12;
  return year + "-" + String(month).padStart(2, "0") + "-15";
}

// A corpus row, shaped like a report comp so valuation.js can read it.
function compFromRow(row, dy) {
  return {
    address: row.address,
    transaction: row.transaction || "",
    date: isoFromDecimalYear(dy),
    size_sqft: row.size_sqft,
    price_or_rate: row.price_or_rate,
    price_per_sqft: row.price_per_sqft,
    source_type: row.source_type,
    verified: row.verified,
  };
}

// Usable at all: a dated, priced, sized sale. Tier is not tested here, because
// peers of every tier are legitimate; see isGroundTruth.
function prepare(row, parseDealDate) {
  if (!row) return null;
  if (String(row.transaction || "").toLowerCase().startsWith("lease")) return null;
  const dy = parseDealDate(row.deal_date);
  if (dy == null) return null;
  const comp = compFromRow(row, dy);
  const psf = VALUATION.salePsfOf(comp);
  if (!(psf > 0)) return null;
  if (!(VALUATION.numericValue(row.size_sqft) > 0)) return null;
  return { row, dy, comp, psf, key: normAddress(row.address) };
}

function isGroundTruth(p) {
  return GROUND_TRUTH_TIERS.indexOf(VALUATION.tierOf(p.row)) >= 0;
}

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function summarize(rs) {
  return {
    scored: rs.length,
    medianAbsError: median(rs.map((r) => r.absError)),
    bandCoverage: rs.length ? rs.filter((r) => r.inBand).length / rs.length : null,
    medianBandWidth: median(rs.map((r) => r.bandWidth)),
  };
}

function score(rows, opts) {
  const o = opts || {};
  const parseDealDate = o.parseDealDate;
  const minPeers = o.minPeers == null ? 3 : o.minPeers;
  const minSubjects = o.minSubjects == null ? 20 : o.minSubjects;

  const pool = [];
  let unusable = 0;
  (rows || []).forEach((r) => {
    const p = prepare(r, parseDealDate);
    if (p) pool.push(p); else unusable += 1;
  });

  // Bucket by market + type. The market comparison is case-SENSITIVE, matching
  // the `eq` filter corpusRowsForMarket uses; marketOf() canonicalizes on the
  // write side for exactly this reason.
  const buckets = new Map();
  pool.forEach((p) => {
    const k = p.row.market + "|" + p.row.property_type;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  });

  let notGroundTruth = 0;
  let thinPeers = 0;
  const results = [];

  buckets.forEach((group) => {
    group.forEach((subj) => {
      if (!isGroundTruth(subj)) { notGroundTruth += 1; return; }
      const peers = group.filter((p) => p.key !== subj.key && p.dy <= subj.dy);
      if (peers.length < minPeers) { thinPeers += 1; return; }
      const v = VALUATION.valueFromComps(peers.map((p) => p.comp), {
        subjectSF: VALUATION.numericValue(subj.row.size_sqft),
        asOf: Date.parse(subj.comp.date),
        trendPct: null,
      });
      if (!v || !(v.psfMid > 0)) { thinPeers += 1; return; }
      results.push({
        type: subj.row.property_type,
        absError: Math.abs(v.psfMid - subj.psf) / subj.psf,
        inBand: subj.psf >= v.psfLow && subj.psf <= v.psfHigh,
        bandWidth: (v.psfHigh - v.psfLow) / v.psfMid,
      });
    });
  });

  const overall = summarize(results);
  const belowFloor = results.length < minSubjects;

  const types = Array.from(new Set(results.map((r) => r.type))).sort();
  const byType = types.map((t) =>
    Object.assign({ type: t }, summarize(results.filter((r) => r.type === t))));

  return {
    scored: results.length,
    minSubjects,
    belowFloor,
    skipped: { unusable, notGroundTruth, thinPeers },
    // Withheld below the floor: a median over a handful of subjects swings
    // enough that tuning against it would be tuning against noise.
    medianAbsError: belowFloor ? null : overall.medianAbsError,
    bandCoverage: belowFloor ? null : overall.bandCoverage,
    medianBandWidth: belowFloor ? null : overall.medianBandWidth,
    byType: belowFloor ? [] : byType,
  };
}

module.exports = { score, normAddress, isoFromDecimalYear, GROUND_TRUTH_TIERS };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git status --short
git add -- backtest.js test/backtest.test.js
git diff --cached --stat
git commit -m "Hold-one-out accuracy scoring over the comp corpus"
```

---

### Task 6: The read, the memo and `GET /api/accuracy`

**Files:**
- Modify: `server.js` (require near the other pure-module requires at the top; read + memo next to `corpusAuditReport` around 1587-1602; route next to `/api/corpus-audit` around 11120)
- Modify: `test/routes.test.js` (one case in the existing `test("admin gating", ...)` block)

**Interfaces:**
- Consumes: `BACKTEST.score` from Task 5; `parseDealDate` (server.js:4355).
- Produces: `GET /api/accuracy` returning the `score` report as JSON, or `{ error: "unavailable" }` with status 200.

- [ ] **Step 1: Write the failing test**

In `test/routes.test.js`, inside the existing `test("admin gating", async (t) => { ... })` block (which already has `const ADMIN` and a booted `srv`), add:

```js
  await t.test("/api/accuracy refuses without the admin key", async () => {
    const r = await fetch(srv.base + "/api/accuracy");
    assert.equal(r.status, 401);
  });

  await t.test("/api/accuracy accepts the admin key header", async () => {
    const r = await fetch(srv.base + "/api/accuracy", { headers: { "x-admin-key": ADMIN } });
    assert.equal(r.status, 200);
    const body = await r.json();
    // No database in this test environment, so the corpus is empty or
    // file-only. Either way the shape must be sound and the figure withheld
    // rather than invented.
    assert.equal(typeof body.scored, "number");
    assert.equal(body.belowFloor, true);
    assert.equal(body.medianAbsError, null);
  });

  // The cookie is how a browser carries the key across tabs. isAdminRequest
  // accepts both forms, and this file exists to prove the wiring, not the rule.
  await t.test("/api/accuracy accepts the admin cookie too", async () => {
    const grant = await fetch(srv.base + "/api/admin-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: ADMIN }),
    });
    assert.equal(grant.status, 200);
    const cookie = String(grant.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cookie.startsWith("cn_admin="), "expected a cn_admin cookie, got " + cookie);
    const r = await fetch(srv.base + "/api/accuracy", { headers: { cookie } });
    assert.equal(r.status, 200);
  });
```

Also add, inside the existing `test(...)` block that asserts admin endpoints 404 when `ADMIN_KEY` is unset (around line 100):

```js
    assert.equal((await fetch(srv.base + "/api/accuracy")).status, 404);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL. The route does not exist, so the unset-key case gets 404 (passing by accident) but the keyed case returns 404 instead of 200.

- [ ] **Step 3: Require the module**

At the top of `server.js`, alongside the other pure-module requires (`corpus-audit`, `entitlements`, `comp-gate`):

```js
const BACKTEST = require("./backtest");
```

- [ ] **Step 4: Add the read and the memo**

In `server.js`, directly after `corpusAuditReport()` (around line 1602):

```js
// ---------------------------------------------------------------------------
// Accuracy backtest. Whole-corpus read, so it is memoized and lives on its own
// route rather than inside /api/stats, which runs on every /admin load.
//
// The column list is deliberately narrow and does NOT include
// ALL_TYPE_COMP_FIELDS: a missing per-type column is what froze the corpus for
// weeks in July, and the accuracy report is among the last things that should
// go dark when that happens again.
// ---------------------------------------------------------------------------
const BACKTEST_LIMIT = 5000;
let BACKTEST_CACHE = { at: 0, data: null };

async function readCorpusRowsForBacktest(limit) {
  let dbRows = [];
  if (DB_CONFIGURED) {
    try {
      dbRows = await sbRequest("GET",
        "comp_corpus?select=ts,market,property_type,address,transaction,deal_date," +
        `size_sqft,price_or_rate,price_per_sqft,source_type,verified&order=ts.desc&limit=${limit}`) || [];
    } catch (e) { noteCorpusFailure("read", e); }
  }
  const fileRows = await readRowsFromFile(COMP_CORPUS_FILE);
  return [...dbRows, ...fileRows].slice(0, limit);
}

async function accuracyReport(force) {
  if (!force && BACKTEST_CACHE.data && Date.now() - BACKTEST_CACHE.at < 15 * 60_000) {
    return BACKTEST_CACHE.data;
  }
  const rows = await readCorpusRowsForBacktest(BACKTEST_LIMIT);
  // parseDealDate is INJECTED rather than reimplemented, exactly as the corpus
  // audit injects it: a row this cannot date is a row retrieval cannot see.
  const data = BACKTEST.score(rows, { now: Date.now(), parseDealDate });
  data.rowsRead = rows.length;
  data.generatedAt = new Date().toISOString();
  BACKTEST_CACHE = { at: Date.now(), data };
  return data;
}
```

- [ ] **Step 5: Add the route**

In `server.js`, directly after the `/api/corpus-audit` route block (around line 11131):

```js
  // Accuracy backtest for /admin. Same shape as /api/corpus-audit: admin-gated,
  // memoized, and it fails SAFE with a 200, because /admin is the page the
  // owner opens when something else is already wrong and this panel must never
  // be what breaks it. `?refresh=1` busts the memo.
  if (req.method === "GET" && req.url.split("?")[0] === "/api/accuracy") {
    if (!ADMIN_KEY) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    const params = new URL(req.url, "http://localhost").searchParams;
    if (!isAdminRequest(req) && !secretMatches(params.get("key"), ADMIN_KEY)) {
      return sendJson(res, 401, { error: "Unauthorized." });
    }
    accuracyReport(params.get("refresh") === "1")
      .then((data) => sendJson(res, 200, data))
      .catch((err) => {
        console.warn("Accuracy backtest failed:", err && err.message);
        return sendJson(res, 200, { error: "unavailable" });
      });
    return;
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
node --check server.js
npm test
```

Expected: PASS, including the two new route cases.

- [ ] **Step 7: Check it by hand against real data**

Restart the server with `ADMIN_KEY` set and a real `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`, then:

```bash
curl -s -H "x-admin-key: $ADMIN_KEY" http://localhost:3000/api/accuracy
```

Read the `scored` and `skipped` counts. If `scored` is 0 while `rowsRead` is large, the likely causes in order: every row failed `parseDealDate`, no bucket reached three peers, or `market` values differ in case between rows. `skipped` distinguishes the first two.

- [ ] **Step 8: Commit**

```bash
git status --short
git add -- server.js test/routes.test.js
git diff --cached
git commit -m "Serve the accuracy backtest at /api/accuracy, admin-gated and memoized"
```

---

### Task 7: The `/admin` card, and the devlog entry

**Files:**
- Modify: `server.js` (`renderAdminHTML`: the audit card's markup and its `loadAudit` fetch around 6243-6251 are the template)
- Modify: `devlog.json`

**Interfaces:**
- Consumes: `GET /api/accuracy` from Task 6.
- Produces: nothing.

- [ ] **Step 1: Add the card markup and renderer**

In `renderAdminHTML`, next to the corpus-audit card, add a container and a renderer. Follow the surrounding inline-CSS conventions of that page; it does not use `tailwind.css`.

Follow `renderAudit`'s conventions exactly (it is the card directly above): the
target element receives the **whole card** including its own `<div class=card>`
wrapper, interpolated values go through the page's `esc()` helper, and the
stored key is read as `sessionStorage.getItem(KEYK)` (`KEYK` is
`"cn_admin_key"`, defined around server.js:6046). Stat tiles use the page's
`.tile` structure with `.k` / `.v` / `.n` children.

```js
function renderAccuracy(d){
  var el=document.getElementById("accuracy");
  var LIMITS="<p class=muted>Each scored sale is held out of the corpus and valued from the comps "+
    "that sold before it in the same market and property type. This measures the valuation MATH, "+
    "not whether the model finds good comps, and it runs without the market-trend adjustment "+
    "(corpus rows do not store it).</p>";
  if(!d||d.error){el.innerHTML="<div class=card><h2>Valuation accuracy</h2>"+
    "<p class=muted>Unavailable right now &mdash; the corpus could not be read. Nothing else on this page is affected.</p></div>";return;}
  var pct=function(v){return v==null?"n/a":(v*100).toFixed(1)+"%";};
  var tile=function(k,v,n){return "<div class=tile><div class=k>"+k+"</div><div class=v>"+v+"</div>"+
    (n?"<div class=n>"+n+"</div>":"")+"</div>";};
  var head;
  if(d.belowFloor){
    head="<p class=muted>Not enough scoreable history yet: "+esc(d.scored)+" of "+esc(d.minSubjects)+
      " sales. A median over a handful of subjects swings too much to tune against, so the figures "+
      "appear once the corpus reaches the floor.</p>";
  }else{
    head="<div class=tiles>"+
      tile("Median error",pct(d.medianAbsError),"vs actual $/SF")+
      tile("In range",pct(d.bandCoverage),"actual inside low-high")+
      tile("Range width",pct(d.medianBandWidth),"median, as % of likely")+
      tile("Scored",esc(d.scored),"held-out sales")+
    "</div>";
  }
  var rows=(d.byType||[]).map(function(t){
    return "<tr><td>"+esc(t.type)+"</td><td>"+esc(t.scored)+"</td><td>"+pct(t.medianAbsError)+
      "</td><td>"+pct(t.bandCoverage)+"</td></tr>";
  }).join("");
  el.innerHTML="<div class=card><h2>Valuation accuracy</h2>"+head+
    (rows?"<table><tr><th>Type</th><th>Scored</th><th>Median error</th><th>In range</th></tr>"+rows+"</table>":"")+
    LIMITS+
    "<p class=muted>Read from "+esc(d.rowsRead||0)+" corpus rows; "+
    esc((d.skipped&&d.skipped.thinPeers)||0)+" sales had too few earlier comps to score.</p>"+
    "<p><button onclick=\"loadAccuracy(sessionStorage.getItem(KEYK),true)\">Recompute</button></p></div>";
}
function loadAccuracy(key,force){
  var h=key?{"x-admin-key":key}:{};
  fetch("/api/accuracy"+(force?"?refresh=1":""),{headers:h})
    .then(function(r){if(!r.ok){throw new Error("accuracy "+r.status);}return r.json();})
    .then(renderAccuracy)
    .catch(function(e){console.error(e);renderAccuracy({error:1});});
}
```

Add `<div id="accuracy"></div>` where the card should sit (below the
corpus-audit card; the wrapper `<div class=card>` comes from the renderer, as
it does for the audit), and call `loadAccuracy(key)` from the same place
`loadAudit(key)` is called.

- [ ] **Step 2: Verify on the page**

Restart, open `http://localhost:3000/admin`, enter the admin key.

1. The card renders. With a thin corpus it should read "Not enough scoreable history yet: N of 20", **not** `0.0%`.
2. Recompute re-fetches (watch the network panel for `?refresh=1`).
3. No console errors.
4. With `ADMIN_KEY` unset the card shows "Unavailable" and the rest of `/admin` still works.

- [ ] **Step 3: Add the devlog entry**

The standing rule: a shipped feature gets an entry in the same commit. Append to `devlog.json`.

**Save as clean UTF-8. Em dashes, curly quotes and arrows are correct raw characters; do not escape them.** CI fails the build on the double-encoding pattern. Because another session may be appending an entry at the same time, rebuild rather than patch: take `git show HEAD:devlog.json`, add only this entry, stage that, then restore the full working file.

```json
{
  "date": "2026-08-06",
  "type": "feature",
  "title": "The valuation now gets graded against sales it did not see",
  "details": "Every priced corpus sale is held out and re-valued from the comps that sold before it in the same market and type, and /admin reports the median error, how often the actual price lands inside the range, and how wide that range is. Nothing had ever measured whether the weighting and reconciliation produce the right number. Getting there meant extracting the valuation core out of index.html into a shared valuation.js, so the harness runs the same arithmetic the report does rather than a copy that could drift."
}
```

- [ ] **Step 4: Commit**

```bash
git status --short
git add -- server.js devlog.json
git diff --cached
git show :devlog.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{JSON.parse(s);console.log('devlog.json parses, entries:',JSON.parse(s).length)})"
git commit -m "Show valuation accuracy on /admin"
```

The `git show :devlog.json` check confirms the staged version is valid JSON and did not lose another session's entry.

---

## Verification before calling this done

- [ ] `npm test` is green, and its own summary reports **more** tests than before (the count in CLAUDE.md has lagged twice; trust the summary, not the doc).
- [ ] `node --check server.js`, `node --check valuation.js`, `node --check backtest.js` all pass.
- [ ] `grep -n "robustPpsfRange(" index.html` returns zero hits.
- [ ] A real report's hero shows the same Low / Likely / High as it did before Task 2.
- [ ] `/admin` renders the accuracy card and never shows a `0.0%` it did not measure.
- [ ] `git diff main --stat` touches only: `valuation.js`, `backtest.js`, `index.html`, `server.js`, `devlog.json`, `test/valuation.test.js`, `test/backtest.test.js`, `test/routes.test.js`, and the two docs.
- [ ] `tailwind.css` is unchanged (no new utility classes were added).

## Follow-ups this plan deliberately leaves open

- **Tuning the coefficients.** The instrument exists; changing the half-life or the size penalty is the next project, and it now has a way to prove itself.
- **The trend gap.** Scoring the trended path needs `annual_price_trend_pct` stored on corpus rows, which is a migration and a `harvestComps` change.
- **Publishing the number.** Not until it has been watched long enough to sit still.
