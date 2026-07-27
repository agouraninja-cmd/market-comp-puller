# Market Page Per-Asset-Class Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each property type's own comp specs (clear height, units, acreage, …) in the Recent-comps table on `/market/<slug>` pages, matching the columns the app's report already shows.

**Architecture:** `market-snapshot.js` stops discarding those fields (allowlist → denylist, so it needs no shared constant and no circular import). `renderMarketPageHTML` in `server.js` derives its columns from the existing `TYPE_COMP_FIELDS` plus a new flat `FIELD_LABELS` lookup, and drops any column that is empty on every comp — which is what keeps the 27 un-backfilled seed pages looking exactly as they do today.

**Tech Stack:** Plain Node HTTP server (zero npm deps, Node 18+), server-rendered market pages with their own inline CSS, `market-seed.json` as committed static data.

**Spec:** `docs/superpowers/specs/2026-07-27-market-page-type-columns-design.md`

---

## Read this before Task 1

**There is no test suite, no build step, and no linter.** Do not look for
`npm test`. Verification uses what this project actually has:

- `market-snapshot.js` is a **real module with no side effects** — it exports
  `distillMarketSnapshot` and requiring it starts nothing. Task 1 unit-tests it
  by plain `require()`. (Contrast `server.js`, which starts a listener on
  require, so its internals are checked by source extraction instead.)
- `.claude/skills/add-comp-field/check-field-maps.js` already cross-checks the
  per-type maps; Task 2 extends it.
- Market pages render from static seed data, so **rendering them costs nothing**
  — no Anthropic calls. Tasks 3 and 4 exercise real HTTP responses for free.

**Node is a portable copy.** Every invocation below uses:
`"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe"`

**Restart rule:** editing `server.js` or `market-snapshot.js` **requires
restarting the dev server** — both are loaded once at startup. Editing
`index.html` does not.

**Never change production code to make a check work.** If a check can't see
something, fix the check.

**Do NOT call `/api/comps`, `/api/explore-market`, or run `gen-market-seed.js`.**
Each search bills ~$0.60 and `gen-market-seed.js` would run 27 of them. Every
task in this plan is free.

**Commit by explicit path. Never `git add -A`.** Another session shares this
working directory and edits the same files. Run `git --no-pager diff` and read
the whole diff before each commit; if you see a change that isn't yours, don't
commit it — report it. Note `CLAUDE.md` currently has uncommitted edits that are
**not yours**; leave them alone.

---

### Task 1: Stop discarding per-type fields in the snapshot

**Files:**
- Modify: `market-snapshot.js:74-82` (the comp trim inside `distillMarketSnapshot`)

- [ ] **Step 1: Write the failing check**

Create `check-snapshot-fields.js` in the scratchpad
(`C:\Users\JACOBA~1\AppData\Local\Temp\claude\C--Users-JacobAdler-OneDrive---Adler-Realty-Documents-Market-Comp-puller-web-app\02228ef5-60df-4f93-9053-3e5803826905\scratchpad`)
with exactly this content:

Note the `path.resolve` below. `require("./market-snapshot")` would resolve
relative to *this script's own directory*, not the working directory, so a
script living in the scratchpad cannot find the module no matter what `cwd` it
is run from. Resolving against `cwd` is what lets the check live outside the
repo. (This bit an executor once already.)

```js
// Requires the REAL module — market-snapshot.js has no side effects.
const path = require("path");
const { distillMarketSnapshot } = require(path.resolve("market-snapshot"));

const check = (label, cond) => {
  console.log((cond ? "PASS " : "FAIL ") + label);
  if (!cond) process.exitCode = 1;
};

// Three priced sale comps so the snapshot is not rejected, carrying per-type
// fields plus the bulky keys that must be dropped.
const data = {
  summary: "s", market_trend: "t", value_drivers: ["a"],
  market_cap_rate_range: { low: "5%", high: "6%" },
  comps: [1, 2, 3].map((i) => ({
    address: `${i} Main St, Ontario, CA`, date: "Mar 2026", transaction: "Sale",
    size_sqft: "20000", price_or_rate: "$4,000,000", price_per_sqft: `$${190 + i}`,
    source_type: "listing",
    clear_height: `${30 + i} ft`, dock_doors: `${i} dock-high`,
    cap_rate: "5.5%", tenancy: "Single-tenant NNN", year_built: "2019",
    notes: "a long note that should not be stored on a market page payload",
    source_url: "https://example.com/x", lat: "34.06", lng: "-117.6", verified: false,
  })),
};

const { snapshot, pricedSaleCount } = distillMarketSnapshot(
  { type: "Industrial", city: "Ontario", state: "CA" }, data);

check("snapshot was produced", !!snapshot);
check("counted 3 priced sale comps", pricedSaleCount === 3);

const c = snapshot.comps[0];
console.log("  stored keys:", Object.keys(c).join(", "));

// Kept: the original six plus source_type
["address", "date", "transaction", "size_sqft", "price_or_rate", "price_per_sqft", "source_type"]
  .forEach((k) => check(`keeps ${k}`, c[k] !== undefined && c[k] !== ""));

// Kept: the per-type specs this task exists to preserve
check("keeps clear_height", c.clear_height === "31 ft");
check("keeps dock_doors", c.dock_doors === "1 dock-high");

// Kept (stored, not necessarily displayed)
["cap_rate", "tenancy", "year_built"].forEach((k) => check(`keeps ${k}`, !!c[k]));

// Dropped: bulky keys no market page shows
["notes", "source_url", "lat", "lng", "verified"]
  .forEach((k) => check(`drops ${k}`, !(k in c)));

// A comp missing a key must yield "" rather than undefined, so renderers can
// treat every cell the same way.
const sparse = distillMarketSnapshot({ type: "Industrial", city: "Ontario", state: "CA" }, {
  ...data,
  comps: data.comps.map(({ clear_height, dock_doors, ...rest }) => rest),
}).snapshot.comps[0];
check("absent key is absent, not undefined-valued", !("clear_height" in sparse) || sparse.clear_height === "");
```

- [ ] **Step 2: Run it to verify it fails**

Run from the repo root:

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" "<scratchpad>/check-snapshot-fields.js"
```

Expected: the seven base-field checks PASS, and `keeps clear_height`,
`keeps dock_doors`, `keeps cap_rate`, `keeps tenancy`, `keeps year_built` all
FAIL — the current allowlist drops them. The five `drops …` checks PASS
trivially (those keys aren't stored today either). Confirm that pattern before
implementing.

- [ ] **Step 3: Implement the denylist**

In `market-snapshot.js`, replace the comp map (lines 74-82):

```js
    comps: comps.slice(0, 8).map((c) => ({
      address: c.address || "",
      date: c.date || "",
      transaction: c.transaction || "",
      size_sqft: c.size_sqft || "",
      price_or_rate: c.price_or_rate || "",
      price_per_sqft: c.price_per_sqft || "",
      source_type: c.source_type || "",
    })),
```

with:

```js
    comps: comps.slice(0, 8).map(trimComp),
```

and add this function immediately above `function distillMarketSnapshot` (which
starts at line 41):

```js
// Keys a market page never shows, and which would bloat every stored payload.
// `notes` is the long one; the rest are app-only concerns.
const COMP_DROP_KEYS = new Set(["notes", "source_url", "lat", "lng", "verified"]);

// Deliberately a DENYLIST, not an allowlist. The per-type comp fields live in
// TYPE_COMP_FIELDS in server.js, and server.js already requires this file — so
// importing that list here would be circular, and gen-market-seed.js would need
// it too. Keeping everything except the bulky keys means a future comp field
// needs no change here at all.
function trimComp(c) {
  const out = {};
  for (const k of Object.keys(c || {})) {
    if (COMP_DROP_KEYS.has(k)) continue;
    out[k] = c[k] == null ? "" : String(c[k]);
  }
  return out;
}
```

- [ ] **Step 4: Run the check to verify it passes**

Same command as Step 2. Expected: every line PASS, exit code 0. The
`stored keys:` line should now list the per-type fields and omit the five
denylisted ones.

- [ ] **Step 5: Confirm the server still boots**

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" --check market-snapshot.js
```

Expected: no output. Then restart the dev server and confirm
`GET http://localhost:3000/healthz` returns 200 and
`GET http://localhost:3000/market/industrial-ontario-ca` returns 200.

- [ ] **Step 6: Commit**

```bash
git --no-pager diff market-snapshot.js
git add market-snapshot.js
git commit -m "Keep per-type comp fields in market snapshots"
```

---

### Task 2: Field labels, with a drift guard

**Files:**
- Modify: `server.js` (add `FIELD_LABELS` after `ALL_TYPE_COMP_FIELDS`, line 1436)
- Modify: `.claude/skills/add-comp-field/check-field-maps.js`

The labels must match the client's `TYPE_COLUMNS` exactly, or the same field is
named one thing in the report and another on the market page. The guard makes
that a caught error instead of a silent inconsistency.

- [ ] **Step 1: Extend the checker with the failing assertions**

In `.claude/skills/add-comp-field/check-field-maps.js`, add after the existing
`ALT_BASIS` extraction line:

```js
const FIELD_LABELS = grab("server.js", /const FIELD_LABELS = \{[\s\S]*?\n\};/, "FIELD_LABELS");
```

and add this block immediately before the final `console.log(problems ? ...)`:

```js
// FIELD_LABELS (server.js, used by the market pages) must cover every per-type
// field and agree with TYPE_COLUMNS (index.html, used by the report table).
// Without this the same field can be labelled differently in the two tables.
console.log("\nFIELD_LABELS vs TYPE_COLUMNS");
const clientLabels = {};
for (const cols of Object.values(TYPE_COLUMNS)) {
  for (const col of cols) clientLabels[col.key] = col.label;
}
for (const spec of Object.values(TYPE_COMP_FIELDS)) {
  for (const key of spec.fields) {
    if (!(key in FIELD_LABELS)) {
      fail(`FIELD_LABELS has no label for "${key}" — the market page would render a blank header`);
      continue;
    }
    if (key in clientLabels && FIELD_LABELS[key] !== clientLabels[key]) {
      fail(`label drift for "${key}": FIELD_LABELS "${FIELD_LABELS[key]}" vs TYPE_COLUMNS "${clientLabels[key]}"`);
    } else {
      console.log(`  ok    ${key.padEnd(16)} "${FIELD_LABELS[key]}"`);
    }
  }
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" .claude/skills/add-comp-field/check-field-maps.js
```

Expected: it throws `Error: FIELD_LABELS not found in server.js`, because the
map doesn't exist yet. That is the correct failure.

- [ ] **Step 3: Add `FIELD_LABELS`**

In `server.js`, immediately after the `ALL_TYPE_COMP_FIELDS` declaration (which
ends at the line `);` following line 1436), add:

```js
// Display labels for the per-type comp fields, for the server-rendered market
// pages. Flat and keyed by field name — NOT a fifth per-type map. These must
// match index.html's TYPE_COLUMNS labels exactly, so the same field never
// reads one way in the report and another on a market page;
// .claude/skills/add-comp-field/check-field-maps.js enforces that.
const FIELD_LABELS = {
  clear_height: "Clear Height",
  dock_doors: "Dock Doors",
  building_class: "Class",
  floor_plate: "Floor Plate",
  center_type: "Center Type",
  anchor_tenant: "Anchor",
  units: "Units",
  price_per_unit: "$/Unit",
  lot_acres: "Acres",
  zoning: "Zoning",
  price_per_acre: "$/Acre",
  beds_baths: "Beds / Baths",
};
```

- [ ] **Step 4: Run the checker to verify it passes**

Same command as Step 2. Expected: the existing per-type sections still report
`All per-type field maps agree.`-style output with no FAIL lines, plus a new
`FIELD_LABELS vs TYPE_COLUMNS` section listing all 12 fields as `ok`, exit 0.

- [ ] **Step 5: Prove the guard actually catches drift**

A guard that has never failed is untrustworthy. Temporarily change
`clear_height: "Clear Height"` to `clear_height: "Ceiling Height"` in
`server.js`, re-run the checker, and confirm it prints:

```
FAIL label drift for "clear_height": FIELD_LABELS "Ceiling Height" vs TYPE_COLUMNS "Clear Height"
```

Then **revert that edit** and re-run to confirm it passes again.

- [ ] **Step 6: Syntax check and commit**

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" --check server.js
git --no-pager diff server.js .claude/skills/add-comp-field/check-field-maps.js
git add server.js .claude/skills/add-comp-field/check-field-maps.js
git commit -m "Add FIELD_LABELS with a drift guard against TYPE_COLUMNS"
```

---

### Task 3: Derive the market-page columns

**Files:**
- Modify: `server.js:2214-2223` (the `compRows` / `compsTable` block inside `renderMarketPageHTML`)

- [ ] **Step 1: Replace the hardcoded table**

The current block reads:

```js
  const compRows = (p.comps || []).map((c) => {
    const badge = c.source_type ? `<span class="badge">${escHtml(c.source_type.replace("_", " "))}</span>` : "";
    return `<tr><td>${escHtml(c.address)} ${badge}</td><td>${escHtml(c.date)}</td><td>${escHtml(c.transaction)}</td>` +
      `<td>${escHtml(c.size_sqft)}</td><td>${escHtml(c.price_or_rate)}</td><td>${escHtml(c.price_per_sqft)}</td></tr>`;
  }).join("");
  const compsTable = compRows
    ? `<div class="card"><h2>Recent ${escHtml(p.type)} comps in ${escHtml(p.city)}, ${escHtml(p.state)}</h2>` +
      `<div class="scroll"><table><thead><tr><th>Address</th><th>Date</th><th>Type</th><th>Size (SF)</th><th>Price / Rate</th><th>$/SF</th></tr></thead>` +
      `<tbody>${compRows}</tbody></table></div></div>`
    : "";
```

Replace it with:

```js
  // Columns are derived, not hardcoded: this type's TYPE_COMP_FIELDS specs slot
  // in after Size (SF), matching the report table's ordering convention.
  // A spec column that is empty on EVERY comp is dropped, which is what lets
  // the pre-#5 seed markets render exactly as they always have instead of
  // sprouting blank columns until they are backfilled.
  const marketComps = p.comps || [];
  const specCols = ((TYPE_COMP_FIELDS[p.type] || { fields: [] }).fields)
    .filter((key) => marketComps.some((c) => String(c[key] || "").trim()))
    .map((key) => ({ key, label: FIELD_LABELS[key] || key }));
  const compCols = [
    { key: "address", label: "Address" },
    { key: "date", label: "Date" },
    { key: "transaction", label: "Type" },
    { key: "size_sqft", label: "Size (SF)" },
    ...specCols,
    { key: "price_or_rate", label: "Price / Rate" },
    { key: "price_per_sqft", label: "$/SF" },
  ];
  const compRows = marketComps.map((c) => {
    const badge = c.source_type ? `<span class="badge">${escHtml(c.source_type.replace("_", " "))}</span>` : "";
    return "<tr>" + compCols.map((col) => (col.key === "address"
      ? `<td>${escHtml(c.address)} ${badge}</td>`
      : `<td>${escHtml(c[col.key] || "")}</td>`)).join("") + "</tr>";
  }).join("");
  const compsTable = compRows
    ? `<div class="card"><h2>Recent ${escHtml(p.type)} comps in ${escHtml(p.city)}, ${escHtml(p.state)}</h2>` +
      `<div class="scroll"><table><thead><tr>` +
      compCols.map((col) => `<th>${escHtml(col.label)}</th>`).join("") +
      `</tr></thead><tbody>${compRows}</tbody></table></div></div>`
    : "";
```

- [ ] **Step 2: Syntax check and restart**

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" --check server.js
```

Expected: no output. Restart the dev server.

- [ ] **Step 3: Confirm a seeded page is UNCHANGED**

This is the regression that matters: the 27 seed markets have no per-type data,
so their tables must look exactly as before.

```bash
curl -s http://localhost:3000/market/industrial-ontario-ca -o /tmp/mk-after.html
grep -o '<thead><tr>.*</tr></thead>' /tmp/mk-after.html | head -1
```

Expected exactly:

```
<thead><tr><th>Address</th><th>Date</th><th>Type</th><th>Size (SF)</th><th>Price / Rate</th><th>$/SF</th></tr></thead>
```

Six headers, no Clear Height, no Dock Doors. If spec columns appear here, the
empty-column filter is wrong.

- [ ] **Step 4: Commit**

```bash
git --no-pager diff server.js
git add server.js
git commit -m "Derive market page comp columns from the per-type field map"
```

---

### Task 4: Verify a page that DOES carry per-type data

**Files:** none modified — verification only. Free; no searches.

`market-pages-dynamic.json` is loaded alongside `market-seed.json` and serves
the same `/market/<slug>` route (`server.js:82-87`), so a crafted entry renders
a real page through the real code path.

- [ ] **Step 1: Back up the dynamic pages file**

```bash
cp market-pages-dynamic.json market-pages-dynamic.json.testbak
```

- [ ] **Step 2: Add a synthetic market with per-type fields**

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" -e '
const fs = require("fs");
const f = "market-pages-dynamic.json";
const d = JSON.parse(fs.readFileSync(f, "utf8"));
d["industrial-testville-tx"] = {
  type: "Industrial", city: "Testville", state: "TX",
  generatedAt: "2026-07-27", summary: "synthetic fixture", market_trend: "flat",
  value_drivers: ["fixture"], cap_rate_low: "5%", cap_rate_high: "6%",
  ppsf: { median: 120, p25: 110, p75: 130, min: 100, max: 140, count: 3 },
  date_range: "Jan 2026 - Mar 2026",
  comps: [1, 2, 3].map((i) => ({
    address: `${i} Test Rd, Testville, TX`, date: "Mar 2026", transaction: "Sale",
    size_sqft: "20000", price_or_rate: "$2,400,000", price_per_sqft: `$${110 + i * 10}`,
    source_type: "listing", clear_height: `${30 + i} ft`, dock_doors: `${i} dock-high`,
  })),
};
fs.writeFileSync(f, JSON.stringify(d, null, 2));
console.log("fixture added");'
```

Restart the dev server so it reloads the file.

- [ ] **Step 3: Confirm the spec columns appear, correctly labelled and positioned**

```bash
curl -s http://localhost:3000/market/industrial-testville-tx -o /tmp/mk-fixture.html
grep -o '<thead><tr>.*</tr></thead>' /tmp/mk-fixture.html | head -1
grep -c "31 ft" /tmp/mk-fixture.html
```

Expected header, with the two spec columns **between Size (SF) and Price /
Rate**:

```
<thead><tr><th>Address</th><th>Date</th><th>Type</th><th>Size (SF)</th><th>Clear Height</th><th>Dock Doors</th><th>Price / Rate</th><th>$/SF</th></tr></thead>
```

and `grep -c "31 ft"` returns at least 1, proving the values render, not just
the headers.

- [ ] **Step 4: Confirm the price-trend chart still renders (spec trap 1)**

`p.comps` has a second consumer at `server.js:2154` that feeds the trend SVG.
Widening the stored comp shape must not disturb it.

```bash
grep -c "<svg" /tmp/mk-fixture.html
grep -c "<svg" /tmp/mk-after.html
```

Expected: both at least 1. If the seeded page (`mk-after.html`) lost its chart,
Task 3 broke the trend path.

- [ ] **Step 5: Confirm the /markets directory still lists correctly**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/markets
curl -s http://localhost:3000/markets | grep -c "Testville"
```

Expected: `200`, and the fixture appears (confirming the directory reads
`ppsf`/counts and is unaffected by the comp shape change).

- [ ] **Step 6: Restore the dynamic pages file**

```bash
mv market-pages-dynamic.json.testbak market-pages-dynamic.json
```

Restart the dev server and confirm
`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/market/industrial-testville-tx`
returns **404** — the fixture is gone.

Confirm `git status --porcelain` shows no change to `market-pages-dynamic.json`
(it is git-ignored, but a leftover fixture would still confuse the next
session).

- [ ] **Step 7: Record results and commit nothing**

This task changes no files. Note the two `<thead>` lines you observed (seeded
vs fixture) in the completion report.

---

## Self-review notes for the executor

- **Do not regenerate `market-seed.json`.** It is explicitly out of scope and
  would cost ~$16 in searches.
- **Land and Residential have no seeded markets** (the 27 are Industrial 8,
  Office 8, Retail 5, Multifamily 6), so their column paths are only exercised
  by the Task 4 fixture pattern. If you want extra confidence, add a second
  fixture with `type: "Land"` and `lot_acres`/`zoning`/`price_per_acre` and
  confirm three spec columns appear.
- **Backfilling existing pages is a separate, later job.** The spec records two
  routes: enriching from `comp_corpus` (free, preferred — `refreshMarketIntel`
  at `server.js:2065` already caches corpus rows but does not select the
  per-type columns) and regenerating the seed (~$16). Neither is in this plan.
- **On the spec's optional live check.** Spec section 7 item 6 offers one
  `/api/explore-market` run (~$0.60) to see the whole path end to end. This plan
  deliberately excludes it: Task 4's fixture drives the same render path with
  the same data shape for free, so the only thing a live run would add is proof
  that a fresh search populates the fields — which #5 already verified directly.
  Run it only if the owner asks; it is not a step here.
