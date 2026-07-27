# Operating-Expense Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one gated Analysis-tab card that compares the owner's own expense ratio (gross income − NOI, both browser-held) against a model-supplied `market_opex_range` for that asset class, as a benchmark, never advice.

**Architecture:** One new model field rides the existing billed search exactly like `market_cap_rate_range` (omitted for Land). All math is client-side in a new `renderOpexCard()` inside the Analysis cluster; the gross-income input lives on the card and stores at `meta.assumptions.opex`, which `/api/share` strips like `debt` and `rentRoll`. No cache-key change, no Supabase migration, no per-comp field maps touched.

**Tech Stack:** Plain Node HTTP server (no deps, Node 18+), single-file HTML front-end, vendored `tailwind.css`.

**Spec:** `docs/superpowers/specs/2026-07-27-opex-benchmark-design.md`

---

## Read this before Task 1

**There is no test suite, no build step, and no linter in this repo.** Do not
look for `npm test` — it does not exist. Checks below use `node --check`, a
source-text assertion script, and browser verification against the running dev
server. Live billed searches happen only in Task 7, which states its own cost.

**Never change production code to make a check work.** The checks observe the
shipped source; the shipped source does not bend to them.

**Node is a portable copy.** Every `node` invocation below uses:
`"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe"`

**Restart rule:** editing `server.js` requires restarting the dev server (it
loads once at startup). Editing `index.html` does not — reload the page.

**Commit by explicit path. Never `git add -A` or a bare `git add server.js`
without reading the diff first.** Another session shares this working
directory and has had uncommitted `server.js` changes in flight. **Pre-flight
for every server.js task:** run `git status --short` and
`git --no-pager diff server.js`. If `server.js` already carries changes that
are not yours, STOP and ask the owner before editing or committing that file —
do not sweep another session's work into your commit. Before each commit, read
the **whole** staged diff (`git --no-pager diff --cached`), then commit.

**No Tailwind regeneration is needed.** Every utility class in the new markup
(`rd-bcard`, `rd-tile`, `rd-tile-hi`, `rd-lab`, `grid-cols-1 sm:grid-cols-3`,
`text-[#374253]`, the shared input classes, etc.) already appears in
`index.html`, so the vendored `tailwind.css` covers it. The auto-regen hook is
the backstop if you deviate; never regen manually.

**Line numbers below are anchors from 2026-07-27 and may drift** (the shared
checkout moves). Always locate edits by the quoted anchor text, not the line
number.

---

### Task 1: `market_opex_range` in the prompt (server.js)

**Files:**
- Modify: `server.js` — `buildPrompt()`, JSON skeleton (~line 1578) and rules block (~line 1592)

- [ ] **Step 1: Pre-flight the shared checkout**

Run: `git status --short` and `git --no-pager diff server.js`
Expected: `server.js` clean, or carries only changes you made in this plan.
If it carries someone else's changes: STOP, ask the owner.

- [ ] **Step 2: Add the skeleton line**

In `buildPrompt()`, find the skeleton line:

```js
    `  "market_cap_rate_range": { "low": "", "high": "" },`,
```

Insert directly after it (conditional-spread pattern copied from the
`subject_size_sqft` lines a few entries below):

```js
    ...(type !== "Land" ? [`  "market_opex_range": { "low": "", "high": "", "note": "" },`] : []),
```

- [ ] **Step 3: Add the rules sentence**

Find the rules line that begins:

```js
    `"market_cap_rate_range" = your best estimate of the going-in capitalization rate range
```

Insert directly after that full array entry:

```js
    ...(type !== "Land" ? [`"market_opex_range" = typical total operating expenses for stabilized ${type} properties in this market, as a percent of effective gross income, as short percent strings like "32%". "note" = a few words naming the lease structure the range assumes (e.g. "assumes NNN, owner keeps roof and structure" or "full-service gross"), since expense ratios depend heavily on it. This is a market-level benchmark for the asset class, not a statement about the target property. Use "" for all three if you cannot estimate it.`] : []),
```

- [ ] **Step 4: Syntax check**

Run: `"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" --check server.js`
Expected: no output, exit 0.

- [ ] **Step 5: Source assertion — both lines present, both Land-guarded**

Run:

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" -e "
const s = require('fs').readFileSync('server.js','utf8');
const hits = s.split('\n').filter(l => l.includes('market_opex_range'));
if (hits.length !== 2) throw new Error('expected exactly 2 market_opex_range lines, got ' + hits.length);
for (const l of hits) if (!l.includes('type !== \"Land\"')) throw new Error('unguarded line: ' + l.trim());
console.log('OK: skeleton + rules present, both Land-guarded');
"
```

Expected: `OK: skeleton + rules present, both Land-guarded`

- [ ] **Step 6: Commit**

```bash
git add server.js
git --no-pager diff --cached
git commit -m "Ask the model for a market_opex_range on non-Land searches"
```

Read the cached diff before the commit — it must contain ONLY the two
`buildPrompt` insertions.

---

### Task 2: `/api/share` strips `assumptions.opex` (server.js)

**Files:**
- Modify: `server.js` — the share-publish handler (~line 4094)

- [ ] **Step 1: Add the delete**

Find:

```js
        if (safeMeta.assumptions && typeof safeMeta.assumptions === "object") {
          safeMeta.assumptions = { ...safeMeta.assumptions };
          delete safeMeta.assumptions.debt;
          delete safeMeta.assumptions.rentRoll;
        }
```

Add one line so the block reads:

```js
        if (safeMeta.assumptions && typeof safeMeta.assumptions === "object") {
          safeMeta.assumptions = { ...safeMeta.assumptions };
          delete safeMeta.assumptions.debt;
          delete safeMeta.assumptions.rentRoll;
          delete safeMeta.assumptions.opex;
        }
```

Also extend the comment above the block: after "NOI and loan terms are the
owner's private finances", it should also name gross income. Change the first
comment line to:

```js
        // NOI, loan terms, and the op-ex card's gross income are the owner's
```

- [ ] **Step 2: Syntax check**

Run: `"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" --check server.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add server.js
git --no-pager diff --cached
git commit -m "Strip the op-ex gross income from shared reports"
```

---

### Task 3: Assumptions slot + card markup (index.html)

**Files:**
- Modify: `index.html` — `ensureAssumptions()` (~line 2418) and the Analysis tab markup between `#analysisLockCard` and `#debtCard` (~line 1031)

- [ ] **Step 1: Initialize `a.opex` in `ensureAssumptions`**

Find:

```js
    if (!a.debt || typeof a.debt !== "object") a.debt = { loanAmount: null, ratePct: null, amortYears: 30 };
```

Insert directly after it:

```js
    if (!a.opex || typeof a.opex !== "object") a.opex = { grossIncome: null };
```

- [ ] **Step 2: Insert the card markup**

Find the closing of the lock card followed by the debt-card comment:

```html
        </div>

        <!-- Debt & refi — DSCR / LTV / debt yield + refi headroom, computed on the
```

Insert between them (after the lock card's `</div>`, before the debt comment):

```html
        <!-- Operating-expense benchmark — the owner's own expense ratio vs what
             this market typically spends for the asset class. Gross income is
             private finance: browser + portfolio only, stripped from shares.
             Signed-in only; built by renderOpexCard(). -->
        <div id="opexCard" class="hidden rd-bcard print-shadow-none fade-in">
          <div class="flex items-center justify-between gap-4 mb-4">
            <h2 class="font-brand uppercase tracking-wide text-base font-semibold text-slate-800">Operating Expense Check</h2>
          </div>
          <div class="no-print grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <div>
              <label class="rd-lab" for="opexGross">Gross annual income ($/yr)</label>
              <input id="opexGross" type="text" inputmode="numeric" placeholder="e.g. 1,085,000"
                class="mt-1 w-full rounded border border-[#D8D4C9] px-2.5 py-1.5 text-sm text-[#1A2433] focus:border-[#B91C1C] focus:ring-1 focus:ring-[#B91C1C] outline-none" />
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="rd-tile">
              <div class="rd-lab">Your expense ratio</div>
              <div id="opexRatio" class="text-2xl font-semibold text-[#1A2433] mt-1">—</div>
              <div id="opexRatioSub" class="text-xs text-[#8A93A0] mt-1"></div>
            </div>
            <div class="rd-tile">
              <div class="rd-lab">Typical for this market</div>
              <div id="opexBand" class="text-2xl font-semibold text-[#1A2433] mt-1">—</div>
              <div id="opexBandSub" class="text-xs text-[#8A93A0] mt-1"></div>
            </div>
            <div class="rd-tile">
              <div class="rd-lab">Your operating expenses</div>
              <div id="opexDollars" class="text-2xl font-semibold text-[#1A2433] mt-1">—</div>
              <div id="opexDollarsSub" class="text-xs text-[#8A93A0] mt-1"></div>
            </div>
          </div>
          <div class="rd-tile-hi mt-4">
            <div class="rd-lab">Expense Benchmark<span id="opexVerdict"></span></div>
            <p id="opexRead" class="text-sm text-[#374253] mt-1"></p>
          </div>
          <p class="text-xs text-[#8A93A0] mt-4">Automated benchmark from this search, not an audit of your books. Your income figures stay in your browser.</p>
        </div>
```

- [ ] **Step 3: Smoke check in the browser**

Start the dev server if not running:
`"$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" server.js`
Load http://localhost:3000, open the console, run:

```js
Boolean(document.getElementById("opexCard") && document.getElementById("opexGross"))
```

Expected: `true` (card exists, hidden — no renderer yet, so nothing shows).

- [ ] **Step 4: Commit**

```bash
git add index.html
git --no-pager diff --cached
git commit -m "Add the op-ex benchmark card markup and assumptions slot"
```

---

### Task 4: `renderOpexCard()` + input listener + cluster wiring (index.html)

**Files:**
- Modify: `index.html` — new function after the debt input-listener block (~line 2669), one call added in `renderAnalysisCluster()` (~line 2903), new listener beside the debt listener

- [ ] **Step 1: Add the renderer**

Find the end of the debt input-listener block:

```js
      }, 250);
    });
  });

  // ----------------------------------------------------------------------------
  // Sensitivity matrix — DCF value across exit cap (rows) × NOI growth (cols),
```

Insert between the listener's closing `});` and the sensitivity comment:

```js
  // ----------------------------------------------------------------------------
  // Operating-expense benchmark — the owner's own expense ratio (gross income
  // held in the browser, never sent to the server) against the model's
  // market_opex_range. A benchmark, never advice: no colors, no "should".
  // Missing range (cached/legacy payloads) degrades to a ratio-only card.
  // ----------------------------------------------------------------------------
  function renderOpexCard(parsed, meta, resetAssumptions) {
    const card = document.getElementById("opexCard");
    const noi = meta && meta.subject && meta.subject.noi > 0 ? meta.subject.noi : null;
    if (!noi || !currentUser) { card.classList.add("hidden"); return; }
    const a = ensureAssumptions(meta, parsed);
    const inGross = document.getElementById("opexGross");
    if (resetAssumptions || !inGross.value) {
      inGross.value = a.opex.grossIncome > 0 ? Math.round(a.opex.grossIncome).toLocaleString() : "";
    }
    const gross = a.opex.grossIncome > 0 ? a.opex.grossIncome : null;

    const r = parsed && parsed.market_opex_range ? parsed.market_opex_range : null;
    const bandLo = r ? numericValue(r.low) : NaN;
    const bandHi = r ? numericValue(r.high) : NaN;
    const bandOk = bandLo > 0 && bandHi >= bandLo && bandHi < 100;
    const pc = (v) => String(Math.round(v * 10) / 10);
    const bandStr = bandOk ? pc(bandLo) + "-" + pc(bandHi) + "%" : null;

    const set = (id, txt, sub) => {
      document.getElementById(id).textContent = txt;
      document.getElementById(id + "Sub").textContent = sub || "";
    };
    const fmtT = (v) => "$" + Math.round(v).toLocaleString();
    const typeWord = String(meta.type || "").toLowerCase();
    const verdictEl = document.getElementById("opexVerdict");
    const readEl = document.getElementById("opexRead");

    set("opexBand", bandStr || "—",
      bandOk ? (r && r.note ? String(r.note) : "of gross income") : "not in this report");

    if (!gross) {
      set("opexRatio", "—", "operating expenses ÷ gross income");
      set("opexDollars", "—", "gross income − NOI");
      verdictEl.textContent = "";
      readEl.textContent = "Enter your gross annual income to compare against what this market typically spends.";
      card.classList.remove("hidden");
      return;
    }

    const expenses = gross - noi;
    const ratioPct = (expenses / gross) * 100;
    if (!(expenses > 0) || !(ratioPct > 0 && ratioPct < 100)) {
      set("opexRatio", "—", "operating expenses ÷ gross income");
      set("opexDollars", "—", "gross income − NOI");
      verdictEl.textContent = "";
      readEl.textContent = "Gross income should be larger than NOI — worth a check on the two figures.";
      card.classList.remove("hidden");
      return;
    }

    set("opexRatio", pc(ratioPct) + "%", "operating expenses ÷ gross income");
    set("opexDollars", fmtT(expenses), "gross income − NOI");

    if (!bandOk) {
      verdictEl.textContent = "";
      readEl.textContent = "Your expense ratio is " + pc(ratioPct) + "% of gross income. This report has no market benchmark to compare against — a fresh search will include one.";
    } else if (ratioPct > bandHi) {
      const gap = expenses - (bandHi / 100) * gross;
      verdictEl.textContent = " · Above typical range";
      readEl.textContent = "Your expense ratio is " + pc(ratioPct) + "%; this market typically runs " + bandStr + " for " + typeWord + ". That gap is about " + fmtT(gap) + " a year on your gross income.";
    } else if (ratioPct < bandLo) {
      verdictEl.textContent = " · Below typical range";
      readEl.textContent = "Your expense ratio is " + pc(ratioPct) + "%, below the " + bandStr + " typical here — often the case where leases pass most operating costs to tenants.";
    } else {
      verdictEl.textContent = " · Within typical range";
      readEl.textContent = "Your expense ratio is " + pc(ratioPct) + "%, inside the " + bandStr + " this market typically runs for " + typeWord + ".";
    }
    card.classList.remove("hidden");
  }

  // Gross-income edits: clamp into assumptions and re-render the cluster.
  let opexEditTimer = null;
  document.getElementById("opexGross").addEventListener("input", () => {
    if (!currentParsed || !currentMeta) return;
    clearTimeout(opexEditTimer);
    opexEditTimer = setTimeout(() => {
      const a = ensureAssumptions(currentMeta, currentParsed);
      const gross = numericValue(document.getElementById("opexGross").value);
      a.opex.grossIncome = gross > 0 ? Math.min(gross, 2e9) : null;
      persistAssumptions();
      renderAnalysisCluster(currentParsed, currentMeta, false);
    }, 250);
  });
```

- [ ] **Step 2: Wire into the cluster**

In `renderAnalysisCluster`, find:

```js
    renderDcfCard(parsed, meta, resetAssumptions);
    renderDebtCard(parsed, meta, resetAssumptions);
```

Change to:

```js
    renderDcfCard(parsed, meta, resetAssumptions);
    renderOpexCard(parsed, meta, resetAssumptions);
    renderDebtCard(parsed, meta, resetAssumptions);
```

- [ ] **Step 3: Browser smoke check**

Reload http://localhost:3000. Sign in (create a throwaway local account via
the Sign in link if none exists — local dev stores it in the git-ignored
`account-store.json`). Load any report from Recent searches (or run the
sample first if history is empty — note the sample itself has no NOI so the
card stays hidden there; use a real prior report). Enter an NOI in "Your
property details", open the Analysis tab, and verify:

1. The Operating Expense Check card appears between DCF and Debt, in empty
   state ("Enter your gross annual income…").
2. Type a gross income larger than the NOI — ratio, expenses, and the band
   sentence fill in. For a cached/older report, tile 2 reads "—" with "not in
   this report" and the sentence is the ratio-only variant (expected: the
   payload predates `market_opex_range`).
3. Type a gross income smaller than the NOI — the "Gross income should be
   larger than NOI" hint replaces the ratio.
4. Sign out — the card disappears; the lock card stands in.

- [ ] **Step 4: Commit**

```bash
git add index.html
git --no-pager diff --cached
git commit -m "Render the operating-expense benchmark card"
```

---

### Task 5: Lock-card and signup-modal copy (index.html)

**Files:**
- Modify: `index.html` — `#analysisLockCard` markup (~line 1022) and the `analysisLockBtn` click handler (~line 2912)

- [ ] **Step 1: Widen the lock-card copy**

Find:

```html
              <h2 class="font-brand uppercase tracking-wide text-base font-semibold text-slate-800">Debt, Sensitivity &amp; Rent-Roll Analysis</h2>
              <p class="text-sm text-[#5A6473] mt-1">DSCR, refi headroom, a value sensitivity grid, and lease-rollover risk for this building — free with an account.</p>
```

Replace with:

```html
              <h2 class="font-brand uppercase tracking-wide text-base font-semibold text-slate-800">Expense, Debt &amp; Risk Analysis</h2>
              <p class="text-sm text-[#5A6473] mt-1">How your expense ratio compares to this market, plus DSCR, refi headroom, a value sensitivity grid, and lease-rollover risk — free with an account.</p>
```

- [ ] **Step 2: Match the signup-modal string**

Find:

```js
    openAcctModal("signup", "Create a free account to unlock the debt, sensitivity, and rent-roll analysis for this report."));
```

Replace with:

```js
    openAcctModal("signup", "Create a free account to unlock the expense benchmark, debt, sensitivity, and rent-roll analysis for this report."));
```

- [ ] **Step 3: Browser check**

Reload, sign out, enter an NOI, open Analysis: the lock card shows the new
heading and body; its button opens the signup modal with the new sentence.

- [ ] **Step 4: Commit**

```bash
git add index.html
git --no-pager diff --cached
git commit -m "Fold the expense benchmark into the analysis lock copy"
```

---

### Task 6: Document the new private field (CLAUDE.md)

**Files:**
- Modify: `CLAUDE.md` — flow 3 (~line 369) and the `/api/share` route bullet (~line 159)

- [ ] **Step 1: Extend flow 3's private-finance list**

Find:

```
   `/api/share` strips it before publishing. The same rule covers **debt
   terms** (`meta.assumptions.debt` — loan amount/rate/amortization, powering
   the debt & refi card) and the **rent roll** (`meta.assumptions.rentRoll` —
   tenant-level rents behind the rollover card): private finances, stripped
   from shares.
```

Replace with:

```
   `/api/share` strips it before publishing. The same rule covers **debt
   terms** (`meta.assumptions.debt` — loan amount/rate/amortization, powering
   the debt & refi card), the **rent roll** (`meta.assumptions.rentRoll` —
   tenant-level rents behind the rollover card), and the op-ex card's **gross
   income** (`meta.assumptions.opex.grossIncome` — the expense-ratio
   denominator; the market band `market_opex_range` itself is market data and
   stays): private finances, stripped from shares.
```

- [ ] **Step 2: Update the `/api/share` route bullet**

Find:

```
  Strips `meta.subject.noi` (private income figure) before storing.
```

Replace with:

```
  Strips `meta.subject.noi` and `meta.assumptions` `debt`/`rentRoll`/`opex`
  (private finances) before storing.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git --no-pager diff --cached
git commit -m "Document the op-ex gross income in the privacy boundary"
```

---

### Task 7: End-to-end verification (one billed search, ~$0.60)

**Files:** none — verification only.

The states below come from spec section 12. Steps 1-4 of Task 4 already
covered: signed-out lock card, empty state, ratio math, gross ≤ NOI, and the
missing-band degradation. This task verifies the parts that need a restarted
server and a real model response.

- [ ] **Step 1: Restart the dev server** (Task 1 changed `server.js`; the
running process predates it). Kill the process on port 3000, relaunch:
`"$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" server.js`

- [ ] **Step 2: One billed search on a non-cached address** (~$0.60 — say so
to the owner before running; do not run extras). Use any real industrial
address + market not searched in the last 7 days. Confirm in the browser
console:

```js
currentParsed.market_opex_range
```

Expected: `{ low: "…", high: "…", note: "…" }` with percent strings, or
all-empty strings if the model couldn't estimate (acceptable — the card
degrades; but note it for the owner).

- [ ] **Step 3: Full card render.** Sign in, enter NOI + gross on that fresh
report, and check all three band states by varying gross (e.g. with a 30%
midpoint band: gross = NOI/0.6 lands above the band, NOI/0.7 within,
NOI/0.95 below). Verify the exact sentences match the spec's three copy
states and that nothing renders in red/amber/green.

- [ ] **Step 4: Land exclusion.** Switch the type select to Land: the NOI
input hides and clears, and the Analysis tab shows no op-ex card for a Land
report. Also confirm (console, after a Land search only if one is already
cached — do NOT bill a search for this) that a Land payload has no
`market_opex_range` key; otherwise verify via the Task 1 source assertion.

- [ ] **Step 5: Share strip.** On the fresh report with gross entered, click
Share, then in the console:

```js
fetch("/api/shared?id=" + new URL(document.querySelector("#shareOut a, #shareUrl, [data-share-url]")?.href || prompt("paste share URL")).pathname.split("/").pop())
  .then(r => r.json()).then(d => console.log("opex in share:", d.meta.assumptions && d.meta.assumptions.opex));
```

(Adapt the id extraction to however the share UI exposes the URL — the point
is: fetch the shared payload.) Expected: `opex in share: undefined`, and
`d.meta.subject.noi` is `null`.

- [ ] **Step 6: Persistence round-trip.** Reload the page, reopen the report
from Recent searches: the gross-income input re-fills and the card re-renders
without a new search. If signed in with portfolio configured, save to
portfolio and re-open: same result.

- [ ] **Step 7: Print preview.** Ctrl+P on the report: the gross-income input
row is absent (`no-print`), the three tiles and the benchmark sentence print,
and the sentence alone carries all the figures.

- [ ] **Step 8: Report results to the owner** — including the billed-search
cost, whether the model returned a usable band on the first try, and the
`note` text it chose (the lease-structure caveat is the part worth
eyeballing for quality).

---

## Deploy notes (for the owner, after the plan lands)

- **No Supabase migration.** Nothing here is harvested or stored server-side.
- Deploy is the usual `git push` of main (Render auto-deploys); the prompt
  change takes effect on the restarted service automatically.
- Cached searches keep serving payloads without `market_opex_range` for up to
  7 days — the card's "not in this report" state is expected in that window.
- Roadmap memory: mark #8 done after deploy verification.

## Self-review notes

- Spec coverage: placement/guard (Task 4), input + assumptions (Tasks 3-4),
  math + copy states + degradation + edge cases (Task 4), prompt + Land
  omission (Task 1), share strip (Task 2), lock copy + modal (Task 5),
  CLAUDE.md flow 3 + route bullet (Task 6), verification walk (Tasks 4 + 7).
  `SAMPLE_REPORT` deliberately untouched per spec §7.
- Naming: `opexCard`/`opexGross`/`opexRatio`/`opexBand`/`opexDollars`/
  `opexVerdict`/`opexRead` consistent across Tasks 3-4;
  `a.opex.grossIncome` consistent across Tasks 2-4 and 6.
- The Task 7 share-strip console snippet is intentionally adaptive (share UI
  markup wasn't re-read for this plan); the assertion itself is exact.
