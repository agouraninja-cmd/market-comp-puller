# Harvest Public Listings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop writing estimate/news comps into `comp_corpus`, keep priced listings without a close date, and offer those on-market rows to later searches as extra candidates that cannot shrink the search budget.

**Architecture:** Two new pure modules — `deal-date.js` (`parseDealDate`, moved out of `server.js` so sentinel strings can be tested) and `corpus-harvest.js` (harvest filter + retrieval split). `harvestComps` and `retrieveCorpusComps` stay impure callers. The prompt gains a date-rule split and an `ON-MARKET LISTINGS` block, sibling of `NEARBY COMPS`. Spec: `docs/superpowers/specs/2026-08-13-corpus-public-listings-design.md`.

**Tech Stack:** Plain Node 18+ (`node --test`), zero npm dependencies.

## Global Constraints

- No migration. Same `comp_corpus` table, same `deal_date` text column.
- Harvest keeps only `public_record` and `listing`. `estimate` and `news` still appear in the report that found them; they are not stored. Existing estimate/news rows are not deleted or rewritten.
- Empty listing dates store as `"Active"`. Non-empty dates are stored verbatim. `"Active"` and `"Listed Mar 2025"` must keep `parseDealDate` returning `null`.
- Dated listing comps remain coverage (`corpusIsStrong`). On-market listings are extra candidates only; they must not change `coverage`, `searchBudgetFor`, or the `source: "corpus"` analytics tag.
- `CORPUS_LISTED=off` drops the on-market prompt block and returns `listed: []`. Default ON. The harvest filter has no flag.
- Zero npm dependencies; no em dashes in new comments, CLAUDE.md, or `devlog.json`; shared checkout: `git status --short` before staging, explicit paths only, never `git add -A`. Untracked files you did not create (homepage-look docs) are someone else's WIP — leave them.
- Work on branch `corpus-public-listings` (worktree at `.claude/worktrees/corpus-public-listings` if the primary checkout cannot switch because of untracked homepage files).
- Portable node if off PATH: `& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe"`. For `npm test`, prepend that folder to `$env:Path`.

## File structure

- Create: `deal-date.js` — `parseDealDate` (and `MONTHS_IDX`). The one parser harvest, retrieval, the audit, and the backtest all use.
- Create: `corpus-harvest.js` — `shouldHarvest`, `listingDateForHarvest`, `isOnMarketListing`, `splitRetrieved`. Requires `isAggregateAddress` from `corpus-audit.js`. Injects `parseDealDate` and `corpusNum`; owns neither.
- Create: `test/deal-date.test.js`, `test/corpus-harvest.test.js`.
- Modify: `server.js` — require both modules; delete the inline `parseDealDate`; harvest loop; `retrieveCorpusComps` return shape; `CORPUS_LISTED`; `buildPrompt` + `callAnthropicOnce`; one log line.
- Modify: `test/routes.test.js` — grep the new prompt strings.
- Modify: `CLAUDE.md`, `devlog.json` — last task.

---

### Task 1: `deal-date.js` (move `parseDealDate`)

**Files:**
- Create: `deal-date.js`
- Create: `test/deal-date.test.js`
- Modify: `server.js` (delete `MONTHS_IDX` + `parseDealDate` around lines 5263-5285; `require("./deal-date")` near the other pure-module requires around line 95)

**Interfaces:**
- Produces: `parseDealDate(s) -> number|null` (fractional year, mid-period). Task 2 injects this into `isOnMarketListing` / `splitRetrieved`. `server.js` uses the same export everywhere it currently calls the local function (`retrieveCorpusComps`, `windowedComps`, `saleRowsWithDates`, audit and backtest injection).

- [ ] **Step 1: Write the failing tests**

Create `test/deal-date.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseDealDate } = require("../deal-date");

test("parseDealDate returns null for empty and on-market sentinels", () => {
  assert.equal(parseDealDate(""), null);
  assert.equal(parseDealDate("   "), null);
  assert.equal(parseDealDate(null), null);
  assert.equal(parseDealDate("Active"), null);
  assert.equal(parseDealDate("Listed Mar 2025"), null);
  assert.equal(parseDealDate("Listed Apr 2026"), null);
  assert.equal(parseDealDate("Active listing 2025-2026"), null);
  assert.equal(parseDealDate("2024-2025"), null);
});

test("parseDealDate still parses closed-looking month-year strings", () => {
  assert.equal(parseDealDate("Mar 2025"), 2025 + (3 - 0.5) / 12);
  assert.equal(parseDealDate("Jul 2026"), 2026 + (7 - 0.5) / 12);
  assert.equal(parseDealDate("2025"), 2025.5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" --test test/deal-date.test.js
```

Expected: FAIL with `Cannot find module '../deal-date'`.

- [ ] **Step 3: Move the function**

Create `deal-date.js` by copying the existing implementation from `server.js` lines 5263-5285, byte for byte except the export:

```js
"use strict";

const MONTHS_IDX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// "2025" | "Q1 2025" | "Apr 2026" | "April 2026" | "04/2026" | "2026-04(-15)"
// -> fractional year (mid-period), else null.
function parseDealDate(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(19|20)\d{2}$/))) return Number(t) + 0.5;
  if ((m = t.match(/^q([1-4])\s*((19|20)\d{2})$/))) return Number(m[2]) + (Number(m[1]) * 3 - 1.5) / 12;
  if ((m = t.match(/^([a-z]{3,9})\.?\s+((19|20)\d{2})$/))) {
    const mo = MONTHS_IDX[m[1].slice(0, 3)];
    return mo ? Number(m[2]) + (mo - 0.5) / 12 : null;
  }
  if ((m = t.match(/^(\d{1,2})\/((19|20)\d{2})$/))) {
    const mo = Number(m[1]);
    return mo >= 1 && mo <= 12 ? Number(m[2]) + (mo - 0.5) / 12 : null;
  }
  if ((m = t.match(/^((19|20)\d{2})-(\d{2})(-\d{2})?$/))) {
    const mo = Number(m[3]);
    return mo >= 1 && mo <= 12 ? Number(m[1]) + (mo - 0.5) / 12 : null;
  }
  return null;
}

module.exports = { parseDealDate };
```

In `server.js`, next to `const AUDIT = require("./corpus-audit");`:

```js
const { parseDealDate } = require("./deal-date");
```

Delete the local `MONTHS_IDX` constant and `function parseDealDate` (lines 5263-5285). Leave `saleRowsWithDates` and every other caller as they are — they already call `parseDealDate` by name.

- [ ] **Step 4: Run tests to verify they pass**

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" --test test/deal-date.test.js
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
npm test
```

Expected: `deal-date` tests PASS. Full suite still PASS (`node --check server.js` is inside `prestart`; `npm test` is enough here). If `parseDealDate` is still declared in `server.js`, Node will throw on boot-style checks later — grep to confirm one definition.

- [ ] **Step 5: Commit**

```powershell
git status --short
git add -- deal-date.js test/deal-date.test.js server.js
git commit -m "Move parseDealDate into deal-date.js so listing sentinels can be tested."
```

---

### Task 2: `corpus-harvest.js` (pure harvest + retrieval split)

**Files:**
- Create: `corpus-harvest.js`
- Create: `test/corpus-harvest.test.js`

**Interfaces:**
- Consumes: `parseDealDate` from Task 1 (injected, never required), `isAggregateAddress` from `corpus-audit.js`, `corpusNum` injected by the caller (same helper `server.js` already has at line 1715).
- Produces: `HARVESTABLE_SOURCES` (`["public_record","listing"]`), `shouldHarvest(comp) -> boolean`, `listingDateForHarvest(comp) -> string`, `isOnMarketListing(row, parseDealDate) -> boolean`, `splitRetrieved(rows, { parseDealDate, cutoffFrac, corpusNum }) -> { usable, listed }`. Task 3 and Task 4 call these via `const HARVEST = require("./corpus-harvest");`.

- [ ] **Step 1: Write the failing tests**

Create `test/corpus-harvest.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseDealDate } = require("../deal-date");
const H = require("../corpus-harvest");

function corpusNum(v) {
  const n = Number(String(v || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const pricedListing = {
  address: "100 Main St, Boise, ID",
  source_type: "listing",
  price_or_rate: "$1,200,000",
  date: "Mar 2025",
};

test("shouldHarvest keeps priced listing and public_record", () => {
  assert.equal(H.shouldHarvest(pricedListing), true);
  assert.equal(H.shouldHarvest({ ...pricedListing, source_type: "public_record" }), true);
});

test("shouldHarvest refuses estimate, news, empty source, unpriced, aggregate, missing address", () => {
  assert.equal(H.shouldHarvest({ ...pricedListing, source_type: "estimate" }), false);
  assert.equal(H.shouldHarvest({ ...pricedListing, source_type: "news" }), false);
  assert.equal(H.shouldHarvest({ ...pricedListing, source_type: "" }), false);
  assert.equal(H.shouldHarvest({ ...pricedListing, price_or_rate: "", price_per_sqft: "" }), false);
  assert.equal(H.shouldHarvest({ ...pricedListing, address: "Market Median, Boise, ID" }), false);
  assert.equal(H.shouldHarvest({ ...pricedListing, address: "" }), false);
});

test("shouldHarvest does not let verified open a back door for an estimate", () => {
  assert.equal(H.shouldHarvest({ ...pricedListing, source_type: "estimate", verified: true }), false);
});

test("listingDateForHarvest fills Active only for empty listing dates", () => {
  assert.equal(H.listingDateForHarvest({ ...pricedListing, date: "" }), "Active");
  assert.equal(H.listingDateForHarvest({ ...pricedListing, date: "   " }), "Active");
  assert.equal(H.listingDateForHarvest(pricedListing), "Mar 2025");
  assert.equal(H.listingDateForHarvest({ ...pricedListing, date: "Listed Mar 2025" }), "Listed Mar 2025");
  assert.equal(H.listingDateForHarvest({ ...pricedListing, source_type: "public_record", date: "" }), "");
});

test("isOnMarketListing is true only for priced listings with an unparseable date", () => {
  assert.equal(H.isOnMarketListing({ ...pricedListing, deal_date: "Active" }, parseDealDate), true);
  assert.equal(H.isOnMarketListing({ ...pricedListing, deal_date: "Mar 2025" }, parseDealDate), false);
  assert.equal(H.isOnMarketListing({ ...pricedListing, source_type: "estimate", deal_date: "Active" }, parseDealDate), false);
  assert.equal(H.isOnMarketListing({ ...pricedListing, price_or_rate: "", price_per_sqft: "", deal_date: "Active" }, parseDealDate), false);
});

test("splitRetrieved puts dated listings in usable and Active listings in listed", () => {
  const rows = [
    { address: "1 A St, Boise, ID", source_type: "listing", price_or_rate: "100", deal_date: "Mar 2025" },
    { address: "2 B St, Boise, ID", source_type: "listing", price_or_rate: "100", deal_date: "Apr 2025" },
    { address: "3 C St, Boise, ID", source_type: "listing", price_or_rate: "100", deal_date: "May 2025" },
    { address: "4 D St, Boise, ID", source_type: "listing", price_or_rate: "100", deal_date: "Jun 2025" },
    { address: "5 E St, Boise, ID", source_type: "listing", price_or_rate: "100", deal_date: "Active" },
    { address: "6 F St, Boise, ID", source_type: "listing", price_or_rate: "100", deal_date: "Listed Mar 2025" },
    { address: "7 G St, Boise, ID", source_type: "estimate", price_or_rate: "100", deal_date: "Mar 2025" },
    { address: "8 H St, Boise, ID", source_type: "news", price_or_rate: "100", deal_date: "Mar 2025" },
    { address: "9 I St, Boise, ID", source_type: "public_record", price_or_rate: "100", deal_date: "Mar 2025" },
  ];
  const { usable, listed } = H.splitRetrieved(rows, {
    parseDealDate, cutoffFrac: 2025.0, corpusNum,
  });
  assert.equal(usable.length, 5); // 4 dated listings + 1 public_record
  assert.equal(listed.length, 2);
  assert.equal(listed.every((r) => r.deal_date === "Active" || r.deal_date.startsWith("Listed")), true);
  assert.equal(usable.some((r) => r.deal_date === "Active"), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" --test test/corpus-harvest.test.js
```

Expected: FAIL with `Cannot find module '../corpus-harvest'`.

- [ ] **Step 3: Write the module**

Create `corpus-harvest.js`:

```js
"use strict";

const { isAggregateAddress } = require("./corpus-audit");

const HARVESTABLE_SOURCES = ["public_record", "listing"];

function sourceOf(comp) {
  return String((comp && comp.source_type) || "").trim().toLowerCase();
}

function hasAddress(comp) {
  return Boolean(comp && String(comp.address || "").trim());
}

function hasPriceString(comp) {
  return Boolean(String((comp && comp.price_or_rate) || "").trim() ||
                 String((comp && comp.price_per_sqft) || "").trim());
}

function rawDate(comp) {
  return String((comp && (comp.date || comp.deal_date)) || "");
}

function shouldHarvest(comp) {
  if (!hasAddress(comp)) return false;
  if (!hasPriceString(comp)) return false;
  if (isAggregateAddress(comp.address)) return false;
  return HARVESTABLE_SOURCES.includes(sourceOf(comp));
}

function listingDateForHarvest(comp) {
  const d = rawDate(comp).trim();
  if (sourceOf(comp) === "listing" && !d) return "Active";
  return d;
}

function isOnMarketListing(row, parseDealDate) {
  if (sourceOf(row) !== "listing") return false;
  const n = Number(String((row && (row.price_or_rate || row.price_per_sqft)) || "").replace(/[^0-9.]/g, ""));
  if (!(Number.isFinite(n) && n > 0)) return false;
  return parseDealDate(row.deal_date || row.date) == null;
}

function splitRetrieved(rows, opts) {
  const parseDealDate = opts.parseDealDate;
  const cutoffFrac = opts.cutoffFrac;
  const corpusNum = opts.corpusNum;
  const usable = [];
  const listed = [];
  for (const r of rows || []) {
    const st = sourceOf(r);
    const priced = corpusNum(r.price_or_rate) || corpusNum(r.price_per_sqft);
    if (st === "listing" && priced && parseDealDate(r.deal_date) == null) {
      listed.push(r);
      continue;
    }
    if (st === "estimate" || st === "news") continue;
    const d = parseDealDate(r.deal_date);
    if (priced && d != null && d >= cutoffFrac) usable.push(r);
  }
  return { usable, listed };
}

module.exports = {
  HARVESTABLE_SOURCES,
  shouldHarvest,
  listingDateForHarvest,
  isOnMarketListing,
  splitRetrieved,
};
```

`splitRetrieved` is the one that must use injected `corpusNum`, matching `retrieveCorpusComps` today.

- [ ] **Step 4: Run tests to verify they pass**

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" --test test/corpus-harvest.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git status --short
git add -- corpus-harvest.js test/corpus-harvest.test.js
git commit -m "Add the harvest filter that keeps public listings and drops guesses."
```

---

### Task 3: Wire `harvestComps`

**Files:**
- Modify: `server.js` (`require("./corpus-harvest")` near line 95; harvest loop at 2712-2751)

**Interfaces:**
- Consumes: `HARVEST.shouldHarvest(comp)`, `HARVEST.listingDateForHarvest(comp)` from Task 2.
- Produces: harvested rows whose `deal_date` is `"Active"` when the listing had no date, and no new `estimate`/`news` rows. Dedupe still uses `corpusKeyOf` **after** the date fill.

- [ ] **Step 1: Require the module**

Next to the `deal-date` require:

```js
const HARVEST = require("./corpus-harvest");
```

- [ ] **Step 2: Replace the per-comp skip + date assignment**

Inside `harvestComps`, replace the loop body that currently does address / price / aggregate checks then `corpusKeyOf(c)` with:

```js
    for (const c of comps) {
      if (!HARVEST.shouldHarvest(c)) {
        if (c && isAggregateAddress(c.address)) {
          console.warn("Comp corpus: skipped market-aggregate row —", String(c.address).trim().slice(0, 80));
        }
        continue;
      }
      // Fill empty listing dates before the dedupe key so "" and "Active"
      // cannot both occupy the store for the same address + price.
      const date = HARVEST.listingDateForHarvest(c);
      const keyed = { ...c, date };
      const key = corpusKeyOf(keyed);
      if (corpusSeen.has(key)) continue;
      corpusSeen.add(key);
      rows.push({
        ts: new Date().toISOString(),
        dedupe_key: key,
        property_type: String(type),
        market: marketOf(c.address),
        address: String(c.address).trim(),
        transaction: String(c.transaction || ""),
        deal_date: date,
        size_sqft: String(c.size_sqft || ""),
        price_or_rate: String(c.price_or_rate || ""),
        price_per_sqft: String(c.price_per_sqft || ""),
        cap_rate: String(c.cap_rate || ""),
        ...Object.fromEntries(ALL_TYPE_COMP_FIELDS.map((f) => [f, String(c[f] || "")])),
        tenancy: String(c.tenancy || ""),
        year_built: String(c.year_built || ""),
        notes: String(c.notes || ""),
        source_url: String(c.source_url || ""),
        source_type: String(c.source_type || ""),
        lat: String(c.lat || ""),
        lng: String(c.lng || ""),
        verified: Boolean(c.verified),
      });
    }
```

Keep the non-USD skip and `seedCorpusSeen` above the loop unchanged.

- [ ] **Step 3: Confirm `server.js` still parses**

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" --check server.js
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
npm test
```

Expected: `server.js` syntax OK; full suite PASS. Harvest is impure (DB/file), so the proof this task is wired is `shouldHarvest` / `listingDateForHarvest` appearing in the loop and the suite still green.

- [ ] **Step 4: Commit**

```powershell
git status --short
git add -- server.js
git commit -m "Harvest only public-record and listing comps, filling empty listing dates as Active."
```

---

### Task 4: Wire `retrieveCorpusComps` (`listed` extra candidates)

**Files:**
- Modify: `server.js` (`CORPUS_LISTED` next to `CORPUS_METRO` around line 1933; `retrieveCorpusComps` at 1838-1892; log line after the nearby log at 10051)

**Interfaces:**
- Consumes: `HARVEST.splitRetrieved(rows, { parseDealDate, cutoffFrac, corpusNum })` from Task 2. Nearby rows still use today's dated bar (do **not** run `splitRetrieved` on sibling-metro rows for a listed bucket).
- Produces: `{ comps, coverage, fresh, nearby, nearbyCount, listed, listedCount }`. Empty and error returns include `listed: []` and `listedCount: 0`. When `CORPUS_LISTED` is off, `listed` is `[]` and `listedCount` is `0` even if `splitRetrieved` found rows.

- [ ] **Step 1: Add the flag**

Immediately after the `CORPUS_METRO` constant:

```js
// On-market listing rows (unparseable deal_date) offered as extra candidates.
// Default ON; `off` hides the prompt block and returns listed: []. The harvest
// filter (no estimate/news) has no flag.
const CORPUS_LISTED = !/^(0|off|false|no)$/i.test(String(process.env.CORPUS_LISTED || ""));
```

- [ ] **Step 2: Split exact-market rows through `splitRetrieved`**

Replace the `isUsable` / `usable` / `nearbyUsable` block and the two return objects in `retrieveCorpusComps` so the function reads:

```js
async function retrieveCorpusComps(market, type, months, maxComps) {
  const empty = { comps: [], coverage: 0, fresh: false, nearby: [], nearbyCount: 0, listed: [], listedCount: 0 };
  try {
    const sibs = CORPUS_METRO ? siblingMarkets(market) : [];
    const rows = await corpusRowsForMarket(market, type, 300);
    const nearbyRows = sibs.length ? await corpusRowsForMarkets(sibs, type, 300) : [];
    if (!rows.length && !nearbyRows.length) return empty;

    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1);
    const cutoffFrac = cutoff.getFullYear() + (cutoff.getMonth() + 0.5) / 12;

    const split = HARVEST.splitRetrieved(rows, { parseDealDate, cutoffFrac, corpusNum });
    const usable = split.usable;
    const listedAll = CORPUS_LISTED ? split.listed : [];

    const isUsable = (r) => {
      const st = String(r.source_type || "").toLowerCase();
      if (st === "estimate" || st === "news") return false;
      const priced = corpusNum(r.price_or_rate) || corpusNum(r.price_per_sqft);
      const d = parseDealDate(r.deal_date);
      return Boolean(priced) && d != null && d >= cutoffFrac;
    };
    const nearbyUsable = nearbyRows.filter(isUsable);

    const newest = rows[0] && rows[0].ts ? new Date(rows[0].ts) : null;
    const fresh = Boolean(newest && (now - newest) < 75 * 24 * 3600 * 1000);

    return {
      comps: usable.slice(0, maxComps * 2),
      coverage: usable.length,
      fresh,
      nearby: nearbyUsable.slice(0, maxComps),
      nearbyCount: nearbyUsable.length,
      listed: listedAll.slice(0, maxComps),
      listedCount: listedAll.length,
    };
  } catch (e) {
    console.error("Corpus retrieval failed (falling back to full search):", e.message);
    return empty;
  }
}
```

Keep `isUsable` for **nearby** rows only. Exact-market usable/listed must come from `splitRetrieved` so coverage and the extra bucket cannot drift from the tests.

- [ ] **Step 3: Log listed candidates**

After the existing `corpus.nearbyCount` log (around 10051):

```js
        if (corpus.listedCount) {
          console.log(`Corpus listed: offering ${corpus.listed.length} of ${corpus.listedCount} on-market listing(s) for ${marketOf(addressOk)} (candidates only, budget unchanged)`);
        }
```

- [ ] **Step 4: Run the suite**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
npm test
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" --check server.js
```

Expected: PASS. `corpusIsStrong` still reads `corpus.coverage` only.

- [ ] **Step 5: Commit**

```powershell
git status --short
git add -- server.js
git commit -m "Offer unparseable listing dates as extra corpus candidates, not coverage."
```

---

### Task 5: Prompt date rule + `ON-MARKET LISTINGS` block

**Files:**
- Modify: `server.js` (`buildPrompt` signature at 3072; `nearbyBlock` then the new `listedBlock`; date sentence at 3303; `callAnthropicOnce` at 3982-3984)
- Modify: `test/routes.test.js` (add a grep test next to the existing `EXTRACT_PROMPT` / `buildPrompt` source test around line 1190)

**Interfaces:**
- Consumes: `corpus.listed` from Task 4. `buildPrompt(..., corpusComps, corpusNearby, corpusListed, subjectDetails, lane)`.
- Produces: prompt text containing `ON-MARKET LISTINGS` and `Listed Mar 2025`, and no longer containing `lease/listing was signed or posted`.

- [ ] **Step 1: Write the failing prompt grep**

In `test/routes.test.js`, add:

```js
test("buildPrompt splits close dates from on-market listing dates", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("function buildPrompt");
  assert.ok(start >= 0, "buildPrompt should still exist");
  const end = src.indexOf("async function callAnthropicOnce", start);
  assert.ok(end > start, "could not bound buildPrompt");
  const body = src.slice(start, end);
  assert.match(body, /ON-MARKET LISTINGS/,
    "on-market listing rows need their own prompt block, like NEARBY COMPS");
  assert.match(body, /Listed Mar 2025/,
    "active listings must be told to write Listed Mon YYYY, not a bare close month");
  assert.equal(body.includes("lease/listing was signed or posted"), false,
    "the old combined date sentence treats a list date as a close");
});
```

- [ ] **Step 2: Run it to verify it fails**

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" --test test/routes.test.js
```

Expected: FAIL on `ON-MARKET LISTINGS`.

- [ ] **Step 3: Change the signature, block, date rule, and call site**

Change the function line to:

```js
function buildPrompt(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft, corpusComps, corpusNearby, corpusListed, subjectDetails, lane = "solo") {
```

Immediately after `nearbyBlock` (after its `.join("\n") : "";`), add:

```js
  const listedBlock = (corpusListed && corpusListed.length) ? [
    ``,
    `ON-MARKET LISTINGS: our prior research surfaced these asking-price listings in this market that are currently on the market, not closed sales. They are already sourced.`,
    ...corpusListed.map((c, i) =>
      `${i + 1}. ${c.address} | ${c.transaction || "transaction type unknown"} | ${c.deal_date || "date unknown"} | ${c.size_sqft ? c.size_sqft + " SF" : "size unknown"} | ${c.price_or_rate || "price unknown"}${c.price_per_sqft ? " | " + c.price_per_sqft + "/SF" : ""}${c.cap_rate ? " | cap " + c.cap_rate : ""}${typeSpecsOf(c)}${c.source_url ? " | " + c.source_url : ""}`),
    `Include one only when it is genuinely comparable to the target. These are asking prices, not closed transactions: copy source_url, set source_type to "listing", keep the date string as given (Active or Listed Mon YYYY), and the notes caveat that the price is asking rather than a closed sale must fire. Do not treat an asking price as a closed sale. Set "verified": false on these unless they also appear in the verified list above.`,
  ].join("\n") : "";
```

Add `listedBlock,` to the return array immediately after `nearbyBlock,`.

Replace the date clause inside the `Rules: "address" = ...` sentence. The current text is:

` "date" = when the sale closed or the lease/listing was signed or posted, as a short month-year like "Mar 2025". `

Replace that clause only with:

` "date" = for a closed sale or a signed lease, the closing or signing month-year like "Mar 2025"; for an active listing, "Active" when the page has no post date, or "Listed Mar 2025" when it does. Never write a bare "Mar 2025" for an active listing. `

In `callAnthropicOnce`, pass the new argument:

```js
    prompt: buildPrompt(address, type, note, months, maxComps, txFocus, verifiedComps,
                        subjectSizeSqft, corpus && corpus.comps, corpus && corpus.nearby,
                        corpus && corpus.listed, subjectDetails, lane),
```

`buildPrompt` is only called from this one site. Inserting `corpusListed` **before** `subjectDetails` would shift the lane argument if a caller were missed — there is only this caller, but pass it explicitly in that position (after `corpusNearby`, before `subjectDetails`) as the spec says.

- [ ] **Step 4: Run tests to verify they pass**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
npm test
```

Expected: the new `routes.test.js` test PASS; full suite PASS.

- [ ] **Step 5: Commit**

```powershell
git status --short
git add -- server.js test/routes.test.js
git commit -m "Tell the model Active vs Listed dates, and offer on-market listings in their own prompt block."
```

---

### Task 6: CLAUDE.md + devlog

**Files:**
- Modify: `CLAUDE.md` (test-suite paragraph around lines 48-57; harvest paragraph around 808-817; corpus-first retrieval around 856-898)
- Modify: `devlog.json` (rebuild the staged file from `HEAD` plus one new entry — see shared-checkout)

**Interfaces:**
- Consumes: behavior from Tasks 1-5.
- Produces: docs that match the code. No new env-var section beyond mentioning `CORPUS_LISTED=off` next to `CORPUS_METRO=off`.

- [ ] **Step 1: Update CLAUDE.md**

In the test-suite paragraph, add **`deal-date.js`** (the deal-date parser, including the Active / Listed sentinels) and **`corpus-harvest.js`** (what gets stored, and the usable-vs-listed split) to the list of pure modules `npm test` covers.

In the harvest paragraph, after "every search response (billed AND cached) has its comps harvested", add: harvest keeps only `public_record` and `listing`; `estimate` and `news` stay in the report that found them and are not stored; an empty listing date is stored as `"Active"`.

In the corpus-first retrieval paragraph, after the metro-matching block, add an **On-market listings (2026-08-13)** subsection: unparseable listing dates (`Active`, `Listed Mar 2025`) come back as `listed` extra candidates with their own prompt block; they do not count toward `coverage` or shrink the budget; dated listing comps still do. Rollback is `CORPUS_LISTED=off`. The harvest filter has no flag.

Do not use em dashes in the new sentences.

- [ ] **Step 2: Append a devlog entry**

`devlog.json` is a guaranteed collision. Rebuild the staged version from `git show HEAD:devlog.json`, add only this entry, `git add` that, then restore the full working file if other unstaged entries exist:

```json
{
  "date": "2026-08-13",
  "type": "improvement",
  "title": "The corpus stores public listings, not guesses",
  "details": "New harvests keep only public-record and listing comps. Estimate and news still appear in the report that found them but no longer enter the permanent store. A priced listing with no close date is saved as Active (or Listed Mar 2025 when the page shows a post date) and offered to later searches in that market as an extra candidate, the same shape as nearby-metro rows: the model can use it, and it cannot make the market corpus-strong. Dated listing comps still count toward coverage. Rollback for the extra prompt block is CORPUS_LISTED=off."
}
```

- [ ] **Step 3: Run the suite once more**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
npm test
```

Expected: PASS. CI's mojibake check on `devlog.json` is the reason to keep this entry in clean UTF-8 with ASCII punctuation only (no em dashes).

- [ ] **Step 4: Commit**

```powershell
git status --short
git add -- CLAUDE.md devlog.json
git commit -m "Document that the corpus stores public listings, not guesses."
```

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| Stop writing estimate/news | Task 2 `shouldHarvest` + Task 3 harvest loop |
| Keep priced listings without a close date; empty -> `"Active"` | Task 2 `listingDateForHarvest` + Task 3 (before `corpusKeyOf`) |
| `"Active"` / `"Listed Mar 2025"` must not parse | Task 1 sentinel tests |
| On-market rows as extra candidates, not coverage | Task 2 `splitRetrieved` + Task 4 |
| Dated listings remain coverage | Task 2 fixture (4 dated + 1 public_record = usable 5) |
| No sibling-metro listed bucket | Task 4 (nearby still uses dated `isUsable`) |
| Empty/error returns include `listed: []` | Task 4 `empty` object |
| Prompt date rule split | Task 5 |
| `ON-MARKET LISTINGS` block | Task 5 |
| `buildPrompt` arg `corpusListed` after `corpusNearby` | Task 5 |
| `CORPUS_LISTED=off` | Task 4 |
| Harvest filter has no flag | Task 3 / Task 4 comments |
| No migration; no delete of existing rows | Global Constraints; no task touches SQL or a DELETE |
| `/api/corpus-comps`, valuation, backtest unchanged | No task |
| CLAUDE.md + devlog | Task 6 |
| `deal-date.js` + `corpus-harvest.js` tested | Tasks 1-2 |
