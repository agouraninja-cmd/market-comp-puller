# Report Outlier Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark outlier sale comps in the report table with a calm, screen-only chip so the person curating the report sees what the valuation math already resists.

**Architecture:** `VALUATION.outlierOf(ppsf, band)` joins valuation.js (pure, dual-export, tested). `renderOwnerHero` stashes the `psfBand` it already computes; the table/card renderers derive a chip per included sale comp from that stash, rendered inside the existing curation cell so the sharing/print gates come for free. Nothing is stored anywhere. Spec: `docs/superpowers/specs/2026-08-09-report-outlier-markers-design.md`.

**Tech Stack:** valuation.js (dual Node/browser export), index.html inline JS, existing Tailwind/rd-chip classes, `node --test`.

## Global Constraints

- Threshold 25% from the NEAREST band edge, direction + integer pct: `{ dir: "above"|"below", pct }`, the SAME product rule as `gut-check.js`'s `OUTLIER_PCT`; both sides get a keep-in-step `⚠` comment naming the other.
- Chips render ONLY when `curationControlsAllowed()` is true, and carry `no-print no-capture` besides. Copy: `{pct}% above the range` / `{pct}% below the range`. Muted `rd-chip` styling; no red, no animation (calm-UI rule).
- Leases never flag (same filter as the hero: `transaction` starting with "lease"); excluded rows drop their chip; comps with no parseable $/SF get no marker; free-tier locked rows untouched.
- Nothing stored: no `meta` writes, no server change, no migration; shared/saved reports byte-identical.
- No em dashes in new prose or comments; shared checkout: explicit paths only, never `git add -A`.
- Portable node if off PATH: `C:\Users\JacobAdler\AppData\Local\node-portable\node-v24.16.0-win-x64\node.exe`.

---

### Task 1: `VALUATION.outlierOf` (TDD) + the paired `⚠` comments

**Files:**
- Modify: `valuation.js` (new function above the `return {` export block at ~line 196; add to exports)
- Modify: `gut-check.js:34` (the `OUTLIER_PCT` constant gains the cross-reference comment)
- Test: `test/valuation.test.js` (append; if the file does not exist, create it with the same `node:test` + `assert` shape as `test/link-check.test.js` and require `../valuation`)

**Interfaces:**
- Produces: `VALUATION.outlierOf(ppsf, band) -> null | { dir: "above"|"below", pct: number }` where `band` is `{ low, high }` (extra keys like `mid`/`trimmed` ignored). Task 2 calls it from index.html via the existing `VALUATION` global.

- [ ] **Step 1: Write the failing tests** (append to `test/valuation.test.js`)

```js
test("outlierOf: inside the band and at the edges is null", () => {
  const band = { low: 100, high: 200 };
  assert.equal(V.outlierOf(150, band), null);
  assert.equal(V.outlierOf(100, band), null);
  assert.equal(V.outlierOf(200, band), null);
  // Outside the band but within 25% of the edge: still null.
  assert.equal(V.outlierOf(249, band), null);   // 24.5% above 200
  assert.equal(V.outlierOf(76, band), null);    // 24% below 100
});

test("outlierOf: beyond 25% of the nearest edge flags with direction and pct", () => {
  const band = { low: 100, high: 200 };
  assert.deepEqual(V.outlierOf(276, band), { dir: "above", pct: 38 });  // (276-200)/200
  assert.deepEqual(V.outlierOf(70, band), { dir: "below", pct: 30 });   // (100-70)/100
});

test("outlierOf: exactly 25% past an edge is null (strict inequality)", () => {
  const band = { low: 100, high: 200 };
  assert.equal(V.outlierOf(250, band), null);
  assert.equal(V.outlierOf(75, band), null);
});

test("outlierOf: degenerate and junk inputs are null", () => {
  assert.equal(V.outlierOf(NaN, { low: 100, high: 200 }), null);
  assert.equal(V.outlierOf(0, { low: 100, high: 200 }), null);
  assert.equal(V.outlierOf(-5, { low: 100, high: 200 }), null);
  assert.equal(V.outlierOf(150, null), null);
  assert.equal(V.outlierOf(150, { low: 0, high: 0 }), null);
  assert.equal(V.outlierOf(150, { low: 200, high: 100 }), null);  // inverted band
  // Single-point band: 25% rule still applies around the point.
  assert.deepEqual(V.outlierOf(130, { low: 100, high: 100 }), { dir: "above", pct: 30 });
  assert.equal(V.outlierOf(120, { low: 100, high: 100 }), null);
});
```

If creating the file fresh, the header is:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const V = require("../valuation");
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/valuation.test.js`
Expected: the new tests FAIL with `V.outlierOf is not a function` (pre-existing tests, if the file existed, stay green).

- [ ] **Step 3: Implement** (in `valuation.js`, above the export block)

```js
  // Is this displayed $/SF an outlier against the hero's displayed band?
  // Returns null, or { dir, pct } where pct is the integer percent distance
  // from the NEAREST band edge (+38 means 38% above the band top).
  // ⚠ 25% and the nearest-edge delta semantics are the SAME product rule as
  // gut-check.js's OUTLIER_PCT and its band-delta math. Change them together.
  var OUTLIER_PCT = 0.25;
  function outlierOf(ppsf, band) {
    if (!band || !(ppsf > 0)) return null;
    var low = band.low, high = band.high;
    if (!(low > 0) || !(high > 0) || high < low) return null;
    if (ppsf > high * (1 + OUTLIER_PCT)) return { dir: "above", pct: Math.round(((ppsf - high) / high) * 100) };
    if (ppsf < low * (1 - OUTLIER_PCT)) return { dir: "below", pct: Math.round(((low - ppsf) / low) * 100) };
    return null;
  }
```

Add `outlierOf, OUTLIER_PCT,` to the export object (after `valueFromComps,`).

In `gut-check.js`, extend the comment above `const OUTLIER_PCT = 0.25;` (line ~34) with:

```js
  // ⚠ Same product rule as valuation.js's OUTLIER_PCT/outlierOf (the report
  // table's screen-only outlier chips). Change the two together.
```

- [ ] **Step 4: Run green, then the whole suite**

Run: `node --test test/valuation.test.js` then `npm test`. All pass.

- [ ] **Step 5: Commit**

```bash
git status --short
git add valuation.js gut-check.js test/valuation.test.js
git commit -m "valuation.js: outlierOf, the report-side twin of the gut check's 25% rule"
```

---

### Task 2: band stash + chips in the curation cell (index.html)

**Files:**
- Modify: `index.html` (three spots: a module-level stash near the other `current*` state; `renderOwnerHero` at the `psfBand` computation ~line 3659; the row and card builders where `buildCurationControl(comp)` is appended, ~lines 10460-10730)

**Interfaces:**
- Consumes: Task 1's `VALUATION.outlierOf`; existing `salePsfOf` (already destructured from `VALUATION` in index.html), `curationControlsAllowed()`, `isExcluded(comp)`, `buildCurationControl(comp)`.
- Produces: `currentPsfBand` (module state), `buildOutlierChip(comp) -> HTMLElement | null`.

- [ ] **Step 1: Add the stash and set it in renderOwnerHero**

Near the other module state (search for `let currentComps`), add:

```js
  // The per-SF band the hero last displayed, stashed for the table's
  // screen-only outlier chips. One computation feeds both surfaces, so the
  // hero and the chips can never disagree. Null when no estimate rendered.
  let currentPsfBand = null;
```

In `renderOwnerHero`, directly after the existing lines:

```js
    const psfBand = val
      ? { low: val.psfLow, mid: val.psfMid, high: val.psfHigh, trimmed: val.trimmed }
      : null;
```

add:

```js
    currentPsfBand = psfBand;
```

Then verify ordering: `renderOwnerHero` must run before the table renderer in BOTH full renders and curation repaints. Check with `grep -n "renderOwnerHero(\|renderTable(\|applyCuration" index.html` and read the call order inside `renderResults` and `applyCuration`. If (and only if) some path paints the table first, move that path's `renderOwnerHero` call ahead of its table call and note it in the report; do not restructure anything else.

- [ ] **Step 2: Add the chip builder** (next to `buildCurationControl`)

```js
  // Screen-only outlier chip: the curation aid for the person deciding what
  // to exclude. Rendered ONLY into the curation cell (whose existence is
  // already gated on curationControlsAllowed(), i.e. never a shared view)
  // and additionally no-print/no-capture, so it cannot reach a print, a PNG,
  // or anyone the report is sent to. Derived at render time from the same
  // band the hero displays; nothing is stored.
  function buildOutlierChip(comp) {
    if (!currentPsfBand || isExcluded(comp) || comp.locked) return null;
    if (String(comp.transaction || "").toLowerCase().startsWith("lease")) return null;
    const o = VALUATION.outlierOf(salePsfOf(comp), currentPsfBand);
    if (!o) return null;
    const chip = document.createElement("span");
    chip.className = "rd-chip no-print no-capture whitespace-nowrap";
    chip.textContent = `${o.pct}% ${o.dir} the range`;
    chip.title = `This sale sits ${o.pct}% ${o.dir} the ${formatUsd(currentPsfBand.low)}-${formatUsd(currentPsfBand.high)}/SF range the estimate uses. Worth a look; Exclude removes it from the math.`;
    return chip;
  }
```

Note on `formatUsd`: it exists in index.html; if its signature needs a rounding hint for per-SF figures, match how the hero's `ownerLowPpsf` line formats them (read that code and reuse the same call shape; report which you used).

- [ ] **Step 3: Wire the chip into the desktop row and mobile card**

In the ROW builder (~line 10460 region): find where the curation control cell is built (`buildCurationControl(comp)` appended when `showCuration`). Append the chip in the same cell, before the button, with a little separation, e.g.:

```js
        const chip = buildOutlierChip(comp);
        if (chip) { chip.classList.add("mr-2"); cell.appendChild(chip); }
        cell.appendChild(buildCurationControl(comp));
```

(Adapt local variable names to the surrounding code; the chip must live in the same td as the control.)

In the CARD builder (~line 10710 region): same pattern where the card's curation control is appended (the `.cur-ctrl` area): chip first, control after.

- [ ] **Step 4: Tailwind check**

`rd-chip`, `no-print`, `no-capture`, `whitespace-nowrap`, `mr-2` are all existing classes. Confirm each with a fixed-string grep in `tailwind.css` (for the utilities) and in the `<style>` block (for `rd-chip`, `no-print`, `no-capture`). If `mr-2` is somehow absent, use an inline `style="margin-right:8px"` instead of introducing a new utility; say which you did.

- [ ] **Step 5: Syntax + suite**

Run the inline-script parse check from the repo root:
`node -e "const s=require('fs').readFileSync('index.html','utf8'); const blocks=[...s.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)]; const main=blocks.reduce((a,b)=>b[1].length>a[1].length?b:a); new Function(main[1]); console.log('PARSE_OK')"`
Then `npm test`.

- [ ] **Step 6: Browser verification** (server from the worktree, sample report; no billed searches)

Start the worktree server on a spare port (launch.json pattern: chdir to the worktree, `ACCOUNT_WALL=off`, `GUEST_SEARCH_LIMIT=off`, `LEAD_CAPTURE=off`). Load the app, click "View a sample report", then in the console:

1. Baseline: `document.querySelectorAll("#tableBody .rd-chip").length` — record it (sample comps may or may not naturally flag).
2. Synthesize an outlier: `currentComps.push({ address: "999 Outlier Way, Dallas, TX", transaction: "Sale", date: "2026-06-01", size_sqft: "50,000", price_or_rate: "$25,000,000", price_per_sqft: "$500", source_type: "listing" }); applyCuration();` — with the sample's band around $107-$117/SF, a $500/SF sale must flag "above". Confirm a chip appears on that row with sensible pct, and on the mobile card list (`cardList`).
3. Exclude that comp via its Exclude button (or by pushing its `compKeyOf` into `currentMeta.curation.excluded` and calling `applyCuration()`): its chip disappears (row grays), and note whether any OTHER comp newly flags (cascade is acceptable).
4. Screen-only: `document.querySelectorAll("#tableBody .rd-chip.no-print").length` equals the chip count (every chip carries the classes); simulate the shared gate: `currentMeta.shared = true; applyCuration();` — chips (and the whole curation cell) gone; reset with `currentMeta.shared = false; applyCuration();`.
5. Console error sweep: zero errors.

- [ ] **Step 7: Commit**

```bash
git status --short
git add index.html
git commit -m "Screen-only outlier chips in the comp table's curation cell"
```

---

### Task 3: docs + devlog + one spec parenthetical

**Files:**
- Modify: `CLAUDE.md` (flow 3, the curation sentences: after "The valuation math reads `includedComps()`; the table shows excluded rows greyed as an audit trail.")
- Modify: `devlog.json` (append one entry)
- Modify: `docs/superpowers/specs/2026-08-09-report-outlier-markers-design.md` (one clause)

**Interfaces:**
- Consumes: shipped behavior from Tasks 1-2.

- [ ] **Step 1: CLAUDE.md sentence**

After the sentence ending "...the table shows excluded rows greyed as an audit trail." insert:

> Since 2026-08-09 the curation cell also carries a screen-only outlier chip (`buildOutlierChip`): an included sale comp whose displayed $/SF sits more than 25% outside the hero's displayed band (`VALUATION.outlierOf`, the same 25% rule as the vault gut check, `⚠`-paired) reads "{pct}% above/below the range". Chips derive at render from `currentPsfBand` (stashed by `renderOwnerHero`, one computation for both surfaces), are never stored, never print or capture, and never render on shared views; below 4 sale comps the band is the full spread, so they cannot fire.

- [ ] **Step 2: devlog entry** (surgical append; clean UTF-8; validate JSON parses and mojibake count unchanged)

```json
{ "date": "2026-08-09", "type": "improvement",
  "title": "Outlier comps get a quiet flag while you curate",
  "details": "A sale comp priced more than 25% outside the report's own value band now carries a small chip saying so, next to its Exclude button. It is a curation aid for you only: it never prints, never exports, and never appears on a shared link. The same 25% rule the vault gut check uses." }
```

- [ ] **Step 3: spec parenthetical**

In the spec's "The band" section, change "displayed (untrended, unweighted) $/SF on both sides" to "displayed $/SF on both sides (the comp side raw and unweighted; the band exactly as the hero shows it)". The original parenthetical over-claimed: the displayed band itself already reflects the hero's weighting and trend indexing, and that is fine because it IS the displayed number.

- [ ] **Step 4: Verify + commit**

`npm test`, JSON parse check on devlog.json, then:

```bash
git status --short
git add CLAUDE.md devlog.json docs/superpowers/specs/2026-08-09-report-outlier-markers-design.md
git commit -m "Document the report outlier chips"
```

---

## Post-merge (deploy time, owner-triggered)

Deploy via the `deploy` skill. Live proof needs no billed search: open any cached or sample report signed in and check a chip appears only where a comp actually sits 25%+ outside the band (most reports show none, which is correct and expected).

## Self-review notes

- Spec coverage: rule + pairing comments (Task 1), band-stash single computation + ordering check (Task 2 Step 1), chip copy/tooltip/gating/no-print (Task 2 Steps 2-3), lease/excluded/locked/NaN skips (buildOutlierChip's guards), natural sub-4-comp silence (no code needed; verified by the band math), nothing-stored (no meta writes anywhere in the plan), docs + devlog + the spec's over-claiming parenthetical (Task 3), browser verification incl. shared-view absence and cascade (Task 2 Step 6).
- Type consistency: `outlierOf(ppsf, band)`, `currentPsfBand`, `buildOutlierChip(comp)` used identically across tasks; `salePsfOf`/`isExcluded`/`curationControlsAllowed` are existing names verified against the file.
- Placeholder scan: clean.
