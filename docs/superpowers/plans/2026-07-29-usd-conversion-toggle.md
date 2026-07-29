# Convert-to-USD Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Non-US comp searches report prices in the local currency with a model-supplied exchange rate, and the report gets a "Show in USD" switch that converts every displayed price.

**Architecture:** The model contract gains two top-level fields (`currency`, `usd_rate`) filled via the existing web-search prompt; the server normalizes them and skips corpus harvesting for non-USD reports. The front-end keeps all valuation math in local currency and converts only at the formatting layer: `formatUsd()` (already the choke point for every client-computed money figure) becomes currency-aware, and a `displayMoney()` helper converts the model's raw price strings in the comp table, cards, stat tile, and CSV export.

**Tech Stack:** Plain Node 18+ (`server.js`), single-file vanilla-JS front-end (`index.html`), vendored Tailwind. No npm deps, no test suite (per CLAUDE.md — verification is manual; this overrides the TDD default).

**Spec:** `docs/superpowers/specs/2026-07-29-usd-conversion-toggle-design.md`

**Conventions that govern this plan (from CLAUDE.md):**
- `server.js` is loaded once — restart the process after editing it. `index.html` is read per request — just refresh.
- Launch Node by full path on this machine:
  `& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" server.js`
- All Tailwind classes used below already appear in `index.html`, so **no `tailwind.css` regen is needed**. If you deviate and add a new utility class, you must regen per CLAUDE.md.
- Line numbers below are as of commit `768373b`. Match on the quoted code, not the number, if drift has occurred.

---

### Task 1: Server — model contract (`currency` + `usd_rate`)

**Files:**
- Modify: `server.js` — `buildPrompt()` output-format section (~lines 1572–1600) and the rules list
- Modify: `server.js` — response pipeline (~line 1797)

- [ ] **Step 1: Add the two fields to the JSON output shape in `buildPrompt`**

In the output-shape array (the block starting `` `OUTPUT FORMAT — return ONLY valid JSON...` ``), find:

```js
    `  "summary": "3-4 sentence plain-English takeaway about the local market, understandable to a non-professional",`,
    `  "avg_price_per_sqft": "string or null",`,
```

and insert two lines after `avg_price_per_sqft`:

```js
    `  "summary": "3-4 sentence plain-English takeaway about the local market, understandable to a non-professional",`,
    `  "avg_price_per_sqft": "string or null",`,
    `  "currency": "",`,
    `  "usd_rate": "",`,
```

- [ ] **Step 2: Add the currency rule sentence to the rules list**

In the same return array, find the line that begins:

```js
    `"source_type" = where you found the comp, exactly one of: ...`,
```

and insert this new element **before** it:

```js
    `"currency" = the ISO 4217 code of the currency ALL prices in this report are quoted in. For a target property in the United States use "USD". For a target property in any other country, quote EVERY price figure (each comp's "price_or_rate" and "price_per_sqft", plus "avg_price_per_sqft") in that country's local currency, set "currency" to its code (e.g. "CAD", "MXN", "GBP"), and set "usd_rate" to the current value of 1 unit of that currency in US dollars as a plain number string (e.g. "0.73" for CAD), using the exchange rate your web search finds. When currency is "USD", set "usd_rate" to "". Never mix currencies within one report.`,
```

- [ ] **Step 3: Add `normalizeCurrency()` next to `normalizeSourceTypes()`**

Directly after the closing brace of `normalizeSourceTypes` (~line 1650), add:

```js
// currency/usd_rate drive the front-end's convert-to-USD toggle. Coerce to a
// safe pair: unknown/blank currency reads as USD (the pre-feature behavior),
// and a rate that isn't a positive finite number becomes null so the toggle
// simply doesn't render. Rates are sanity-bounded: no real currency trades
// at 1 unit = $10,000, and a zero/negative rate is garbage.
function normalizeCurrency(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const code = String(parsed.currency || "").trim().toUpperCase();
  parsed.currency = /^[A-Z]{3}$/.test(code) ? code : "USD";
  const rate = Number(parsed.usd_rate);
  parsed.usd_rate =
    parsed.currency !== "USD" && Number.isFinite(rate) && rate > 0 && rate < 10000
      ? rate
      : null;
  return parsed;
}
```

- [ ] **Step 4: Call it in the response pipeline**

Find (~line 1797):

```js
  const parsed = normalizeSourceTypes(parseCompJson(text));
```

Change to:

```js
  const parsed = normalizeCurrency(normalizeSourceTypes(parseCompJson(text)));
```

- [ ] **Step 5: Syntax-check and commit**

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" --check "C:\Users\JacobAdler\OneDrive - Adler Realty\Documents\Market Comp puller web app\server.js"
```

Expected: no output (exit 0).

```bash
git add server.js
git commit -m "feat: model reports currency + USD rate for non-US searches"
```

---

### Task 2: Server — skip corpus harvest for non-USD reports

**Files:**
- Modify: `server.js` — `harvestComps()` (~line 1223)

- [ ] **Step 1: Add the currency guard at the top of `harvestComps`**

Find:

```js
async function harvestComps(type, searchAddress, payload) {
  try {
    await seedCorpusSeen();
    const comps = payload && Array.isArray(payload.comps) ? payload.comps : [];
```

Change to:

```js
async function harvestComps(type, searchAddress, payload) {
  try {
    // Corpus rows have no currency column, so a foreign report's prices would
    // be stored indistinguishable from USD and poison retrieval/market pages.
    // Non-US markets are rare enough that skipping beats an ALTER TABLE (the
    // missing-column class of outage — see CLAUDE.md corpus health).
    const cur = String((payload && payload.currency) || "USD").toUpperCase();
    if (cur !== "USD") {
      console.log(`🗃  Comp corpus skipped (non-USD report: ${cur} — ${marketOf(searchAddress)})`);
      return;
    }
    await seedCorpusSeen();
    const comps = payload && Array.isArray(payload.comps) ? payload.comps : [];
```

Note: `harvestComps` is called with the full report payload on both the cache-hit path (~line 3253) and the fresh-search path (~line 3275), so this one guard covers both.

- [ ] **Step 2: Syntax-check and commit**

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" --check "C:\Users\JacobAdler\OneDrive - Adler Realty\Documents\Market Comp puller web app\server.js"
```

Expected: no output (exit 0).

```bash
git add server.js
git commit -m "feat: skip comp-corpus harvest for non-USD reports"
```

---

### Task 3: Front-end — currency state + currency-aware `formatUsd()`

**Files:**
- Modify: `index.html` — state block (~line 1671) and `formatUsd` (~line 1760)

- [ ] **Step 1: Add report-currency state**

Find (~line 1671):

```js
  let currentComps = [];
```

Insert immediately before it:

```js
  // Currency of the current report. Non-USD reports carry a model-supplied
  // rate (value of 1 local unit in USD); showUsd is the "Show in USD" toggle.
  // Valuation MATH always stays in local currency — only formatting converts.
  let reportCurrency = { code: "USD", rate: null };
  let showUsd = false;
```

- [ ] **Step 2: Make `formatUsd` currency-aware**

Replace (~line 1760):

```js
  function formatUsd(n, opts) {
    return "$" + n.toLocaleString(undefined, opts || { maximumFractionDigits: 2 });
  }
```

with:

```js
  // Named for its original life as a plain USD formatter; now the single
  // formatting choke point for every client-computed money figure. All call
  // sites pass numbers in the report's local currency.
  function formatUsd(n, opts) {
    const o = opts || { maximumFractionDigits: 2 };
    if (reportCurrency.code === "USD") return "$" + n.toLocaleString(undefined, o);
    if (showUsd && reportCurrency.rate) {
      return "$" + (n * reportCurrency.rate).toLocaleString(undefined, o);
    }
    try {
      return n.toLocaleString(undefined, {
        style: "currency",
        currency: reportCurrency.code,
        minimumFractionDigits: 0,
        maximumFractionDigits: o.maximumFractionDigits == null ? 2 : o.maximumFractionDigits,
      });
    } catch (_) {
      // Intl throws on a code it doesn't know — fall back to "CAD 1,234".
      return reportCurrency.code + " " + n.toLocaleString(undefined, o);
    }
  }
```

(`minimumFractionDigits: 0` is required: currency style defaults min-fraction to 2, which throws a RangeError when combined with the `maximumFractionDigits: 0` many call sites pass.)

- [ ] **Step 3: Set `reportCurrency` per report in `renderResults`**

In `renderResults(parsed, meta)` (~line 3880), find:

```js
    renderStatTiles(parsed, meta);
```

Insert immediately before it:

```js
    // Currency context must be set before anything renders money.
    reportCurrency = {
      code: String(parsed.currency || "USD").toUpperCase(),
      rate: Number(parsed.usd_rate) > 0 ? Number(parsed.usd_rate) : null,
    };
    if (reportCurrency.code === "USD") showUsd = false;
    renderCurrencyBar();
```

(`renderCurrencyBar` is defined in Task 5; the plan's tasks are committed together per-task, so if you run this task standalone, stub it as `function renderCurrencyBar() {}` and replace it in Task 5 — or simply do Tasks 3–5 as one working session and commit at each task boundary; the page will error on refresh only between Step 3 here and Task 5 Step 2.)

- [ ] **Step 4: Verify no console errors on a US report**

Refresh `http://localhost:3000`, open the sample report (or any saved report). Expected: renders exactly as before, no console errors, all prices still `$…`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: currency-aware money formatting behind report currency state"
```

---

### Task 4: Front-end — convert the model's raw price strings (table, cards, tile, CSV)

**Files:**
- Modify: `index.html` — helper near `numericValue` (~line 1755), `renderStatTiles` (~line 3835), `renderTableBody` (~line 5352), `renderCards` (~line 5480), `exportCsv` (~lines 5631–5644), `exportXlsx` (~lines 5675–5710)

- [ ] **Step 1: Add `MONEY_KEYS` + `displayMoney()` helper**

Directly after the `formatUsd` function (end of Task 3 Step 2's block), add:

```js
  // Comp fields whose raw model strings are money and get converted by the
  // USD toggle. Percentages (cap_rate) and sizes are deliberately absent.
  const MONEY_KEYS = new Set(["price_or_rate", "price_per_sqft", "price_per_unit", "price_per_acre"]);

  // Convert one of the model's raw price strings for display. Local mode (or
  // a USD report) returns the string untouched. USD mode parses the leading
  // number, converts it, and keeps any trailing unit text ("/SF/yr NNN").
  // Anything that doesn't parse cleanly renders as-is — never a wrong number.
  function displayMoney(raw) {
    if (reportCurrency.code === "USD" || !showUsd || !reportCurrency.rate) return raw;
    const s = String(raw ?? "");
    const m = s.match(/-?[\d][\d,]*(\.\d+)?/);
    if (!m) return s;
    const tail = s.slice(m.index + m[0].length);
    // "1.2M" / "850K" style shorthand: converting just the mantissa would be
    // off by orders of magnitude — leave the raw string alone.
    if (/^\s*(m\b|million|k\b|thousand|b\b|billion)/i.test(tail)) return s;
    const n = parseFloat(m[0].replace(/,/g, ""));
    if (!isFinite(n)) return s;
    const usd = n * reportCurrency.rate;
    return "$" + usd.toLocaleString(undefined, { maximumFractionDigits: usd < 100 ? 2 : 0 }) + tail;
  }
```

- [ ] **Step 2: Route the comp-table cell through it**

In `renderTableBody` (~line 5352), find:

```js
        const cell = document.createElement("div");
        const val = comp[col.key];
```

Change the second line to:

```js
        const val = MONEY_KEYS.has(col.key) ? displayMoney(comp[col.key]) : comp[col.key];
```

- [ ] **Step 3: Route the mobile cards through it**

In `renderCards` (~line 5480), find:

```js
        if (col.key === "address") return;   // already the card header
        const val = comp[col.key];
```

Change the second line to:

```js
        const val = MONEY_KEYS.has(col.key) ? displayMoney(comp[col.key]) : comp[col.key];
```

- [ ] **Step 4: Route the Avg $/SF stat tile through it**

In `renderStatTiles` (~line 3835), find:

```js
      { label: "Avg $/SF", value: parsed.avg_price_per_sqft || "" },
```

Change to:

```js
      { label: "Avg $/SF", value: displayMoney(parsed.avg_price_per_sqft) || "" },
```

(The tile's spread bar values already flow through `formatUsd` inside `buildSpreadBar`, so they convert via Task 3.)

- [ ] **Step 5: Route the CSV export through it and record the currency in the title row**

In `exportCsv` (~line 5632), find:

```js
    const rows = includedComps().map((comp) =>
      [...COLUMNS.map((c) => esc(comp[c.key])), esc((SOURCE_TIERS[compTier(comp)] || {}).label || "")].join(","));
```

Change to:

```js
    const rows = includedComps().map((comp) =>
      [...COLUMNS.map((c) => esc(MONEY_KEYS.has(c.key) ? displayMoney(comp[c.key]) : comp[c.key])), esc((SOURCE_TIERS[compTier(comp)] || {}).label || "")].join(","));
```

Then find the title-row builder just below:

```js
    const cc = curationCounts();
    const curationBits = [];
```

and insert after `const curationBits = [];`:

```js
    if (reportCurrency.code !== "USD") {
      curationBits.push(showUsd && reportCurrency.rate
        ? `Prices converted to USD at 1 ${reportCurrency.code} = $${reportCurrency.rate}`
        : `Prices in ${reportCurrency.code}`);
    }
```

- [ ] **Step 6: Route the XLSX export through it (comps sheet + valuation sheet)**

In `exportXlsx` (~line 5683), find:

```js
      const compsAoa = [
        [...COLUMNS.map((c) => c.label), "Source confidence"],
        ...includedComps().map((comp) => [
          ...COLUMNS.map((c) => String(comp[c.key] ?? "")),
          (SOURCE_TIERS[compTier(comp)] || {}).label || "",
        ]),
      ];
```

Change the cell mapper line to:

```js
          ...COLUMNS.map((c) => String((MONEY_KEYS.has(c.key) ? displayMoney(comp[c.key]) : comp[c.key]) ?? "")),
```

Then, in the valuation-sheet rows just below, find:

```js
      const vRows = [
        ["Property", currentMeta.address],
        ["Type", currentMeta.type],
        ["Search", metaLine(currentMeta)],
        ["Generated", new Date(currentMeta.generatedAt || Date.now()).toLocaleString()],
```

and insert after the `["Generated", ...]` line:

```js
        ...(reportCurrency.code !== "USD" ? [[
          "Currency",
          showUsd && reportCurrency.rate
            ? `Converted to USD at 1 ${reportCurrency.code} = $${reportCurrency.rate}`
            : `${reportCurrency.code} (local currency)`,
        ]] : []),
```

The `lastValuation` numbers (`low`/`likely`/`high`/`median_psf`) a few lines below are captured from the hero render in whatever the current toggle state was — the hero recomputes `lastValuation` through `formatUsd`'s math inputs, which stay local-currency. Convert them at the sheet boundary: find

```js
        ...(lastValuation ? [
          ["Low", lastValuation.low],
          ["Likely", lastValuation.likely],
          ["High", lastValuation.high],
          ["Comp median $/SF", lastValuation.median_psf],
        ] : []),
```

and change to:

```js
        ...(lastValuation ? [
          ["Low", xlsxMoney(lastValuation.low)],
          ["Likely", xlsxMoney(lastValuation.likely)],
          ["High", xlsxMoney(lastValuation.high)],
          ["Comp median $/SF", xlsxMoney(lastValuation.median_psf)],
        ] : []),
```

and add this helper directly above `async function exportXlsx() {`:

```js
  // Numeric cells for the valuation sheet, converted to match the on-screen
  // toggle state. USD reports pass through untouched.
  function xlsxMoney(n) {
    if (!isFinite(n)) return n;
    return showUsd && reportCurrency.rate && reportCurrency.code !== "USD"
      ? Math.round(n * reportCurrency.rate * 100) / 100
      : n;
  }
```

Check whether `exportXlsx` writes any OTHER `lastValuation`-derived or money value further down (e.g. the `sellTodayEstimate` row visible right after the `lastValuation` block) — wrap each such numeric money cell in `xlsxMoney(...)` the same way. Read the full function before editing; it continues past the excerpt shown here.

- [ ] **Step 7: Verify a US report is unchanged**

Refresh, open any existing report, export CSV (and XLSX if signed in). Expected: identical output to before (USD reports short-circuit in `displayMoney` and `xlsxMoney`), no console errors.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: USD conversion for raw comp price strings in table, cards, tile, CSV, XLSX"
```

---

### Task 5: Front-end — the "Show in USD" switch + rate footnote

**Files:**
- Modify: `index.html` — report header markup (~line 913) and script (listener near the other startup listeners; `renderCurrencyBar` near `renderResults`)

- [ ] **Step 1: Add the bar to the report header markup**

Find (~line 913):

```html
              <div id="reportMeta" class="flex flex-wrap mt-1"></div>
```

Insert directly after it:

```html
              <!-- Non-USD reports only: the convert-to-USD switch. The note
                   prints/exports (it discloses the rate); the control doesn't. -->
              <div id="currencyBar" class="hidden mt-2 flex flex-wrap items-center text-sm">
                <label class="no-print no-capture inline-flex items-center cursor-pointer mr-3 font-medium text-[#1A2433]">
                  <input id="usdToggle" type="checkbox" class="mr-1.5">
                  <span>Show in USD</span>
                </label>
                <span id="currencyNote" class="text-xs text-[#8A93A0]"></span>
              </div>
```

(Every class here already exists in `index.html` — no Tailwind regen.)

- [ ] **Step 2: Add `renderCurrencyBar()`**

Directly before `function renderResults(parsed, meta) {` (~line 3880), add:

```js
  // Show the USD switch only when the report is non-USD AND has a usable
  // rate; otherwise prices stay labeled in their local currency and nothing
  // masquerades as dollars.
  function renderCurrencyBar() {
    const bar = document.getElementById("currencyBar");
    const foreign = reportCurrency.code !== "USD" && reportCurrency.rate;
    bar.classList.toggle("hidden", !foreign);
    if (!foreign) return;
    document.getElementById("usdToggle").checked = showUsd;
    document.getElementById("currencyNote").textContent = showUsd
      ? `Converted at 1 ${reportCurrency.code} = $${reportCurrency.rate} USD, rate as of report date`
      : `Prices in ${reportCurrency.code} (local currency)`;
  }
```

If you stubbed `renderCurrencyBar` in Task 3, delete the stub now.

- [ ] **Step 3: Wire the toggle listener**

Near the other startup listeners (a good anchor is directly after the `subjectEditTimer` listener block that ends `}, 300);\n    });\n  });` ~line 1820), add:

```js
  // Toggling re-renders every money surface. Mirrors the subject-edit
  // re-render path above; renderTableBody(false) also re-renders the cards.
  document.getElementById("usdToggle").addEventListener("change", (e) => {
    showUsd = e.target.checked;
    if (!currentParsed || !currentMeta) return;
    renderCurrencyBar();
    renderStatTiles(currentParsed, currentMeta);
    renderOwnerHero(currentParsed, currentMeta);
    renderAnalysisCluster(currentParsed, currentMeta, false);
    renderComparison(currentParsed);
    renderMarketChart();
    renderTableBody(false);
  });
```

- [ ] **Step 4: Verify with a faked foreign report (no billed search)**

Refresh, open any existing report, then in the browser console:

```js
currentParsed.currency = "CAD"; currentParsed.usd_rate = 0.73;
renderResults(currentParsed, currentMeta);
```

Expected: the "Show in USD" switch appears under the report meta chips with note "Prices in CAD (local currency)"; prices render via Intl as `CA$…`. Tick the switch: every money surface (hero, tiles, chart, comparison, table, cards) flips to `$…` at 0.73×, note changes to the conversion line. Untick: flips back. Export CSV in each state and confirm the title row carries the matching currency note and the price columns match the display.

(This mutates only the in-browser copy; don't save/share while testing. Reload the page afterward to discard it.)

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: Show-in-USD switch with rate footnote on non-USD reports"
```

---

### Task 6: End-to-end verification + docs

**Files:**
- Modify: `CLAUDE.md` (the CompNinja one) — brief note under the non-obvious flows

- [ ] **Step 1: Restart the server** (server.js changed in Tasks 1–2)

Kill the process on port 3000, then:

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" server.js
```

- [ ] **Step 2: One real Canadian search (ONE billed Anthropic call — owner approved in spec)**

Search e.g. `5900 Explorer Dr, Mississauga, ON, Canada`, type Office. Expected:
- Report renders with prices in CAD, switch visible, both toggle states correct across table/hero/tile/chart/exports.
- Server log shows `Comp corpus skipped (non-USD report: CAD — Mississauga, ON)` (market string may differ; the skip line is what matters).
- `search_cache` gets the entry as usual (re-submitting the same search is a cache hit and also skips harvest).

- [ ] **Step 3: US regression search**

Re-open any saved US report AND run one cached US search. Expected: no currency bar, prices identical to pre-feature, corpus harvest log line present (`Comp corpus +N …`).

- [ ] **Step 4: Document the flow in CLAUDE.md**

Add to the CompNinja `CLAUDE.md` "Non-obvious flows" list (as item 5):

```markdown
5. **Currency (non-US searches).** The model quotes a foreign target's prices
   in the LOCAL currency and returns top-level `currency` (ISO code) +
   `usd_rate` (value of 1 unit in USD), normalized by `normalizeCurrency()`
   in server.js. The front-end never converts the math — `formatUsd()` and
   `displayMoney()` convert at the formatting layer when the report-header
   "Show in USD" switch is on. `harvestComps()` skips non-USD reports
   entirely (corpus rows have no currency column, so foreign prices would
   masquerade as USD — skipping beats an ALTER TABLE for a rare case).
```

- [ ] **Step 5: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: currency flow for international comp searches"
```

---

## Self-review notes

- Spec coverage: model contract (Task 1), normalization incl. rate bounds (Task 1), corpus skip (Task 2), toggle + all money surfaces incl. exports (Tasks 3–5; XLSX added beyond the spec's CSV/PNG/print list because the code has it and it would otherwise leak unconverted figures), footnote + no-masquerade rule (Task 5), cache untouched (no task needed — additive shape), shares/portfolio carry currency automatically (currency lives inside `parsed`, which both already store), verification (Task 6).
- PNG/print exports need no extra work: they capture the DOM, which already reflects the toggle; the footnote span is printable while the checkbox is `no-print no-capture`.
- `usd_rate` normalizes to a **number or null** server-side; the front-end also guards with `Number(...) > 0` so pre-feature cached reports (field absent) behave as USD.
