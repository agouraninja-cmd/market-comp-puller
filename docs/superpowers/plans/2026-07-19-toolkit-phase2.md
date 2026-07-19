# Toolkit Phase 2: Rent-Roll + Report | Analysis Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the report into Market Report | Analysis tabs (hero stays above) and add a standalone rent-roll/rollover card (WALT, occupancy, expiry schedule) behind the existing account gate.

**Architecture:** index.html-centric: two wrapper divs re-parent existing cards untouched; a rent-roll card joins the analysis cluster and rides the existing `meta.assumptions` persistence pipeline; the server change is a one-line share-strip extension. Spec: `docs/superpowers/specs/2026-07-19-toolkit-phase2-rentroll-tabs-design.md`.

**Tech Stack:** Vanilla JS in index.html; vendored Tailwind (auto-regen hook); no test suite by design — verification is browser-driven with hand-checked math, per house rules.

**Verified anchors (2026-07-19):** print CSS block at index.html:305-320 (note `#reportArea > *` break rule — wrappers change card depth, extend the selector); lock card copy :1056-1057; signup nudge string :2503; `let mapInstance` :2740 (module scope, null when no map); `renderAnalysisCluster(parsed, meta, true)` in renderResults :3085; share-strip block server.js ~3153 (`safeMeta.assumptions` clone already exists from phase 1).

---

### Task 1: Server share-strip + CLAUDE.md (5 minutes)

**Files:** Modify `server.js` (share sanitize block ~3153), `CLAUDE.md` (privacy paragraph).

- [ ] In the `/api/share` sanitize block, extend the existing assumptions clone:

```js
        if (safeMeta.assumptions && typeof safeMeta.assumptions === "object") {
          safeMeta.assumptions = { ...safeMeta.assumptions };
          delete safeMeta.assumptions.debt;
          delete safeMeta.assumptions.rentRoll;
        }
```

- [ ] CLAUDE.md: in the finance-privacy sentence, change "**debt terms** (`meta.assumptions.debt` — loan amount/rate/amortization, powering the debt & refi card)" to also name "and the **rent roll** (`meta.assumptions.rentRoll` — tenant-level rents)".
- [ ] `node --check server.js` → exit 0; restart dev server; curl a share POST carrying `assumptions.rentRoll:[{"label":"A","sf":1,"rent":1,"endYear":2030}]` → GET `/api/shared?id=` contains no `rentRoll` (and still no `noi`/`debt`).
- [ ] Commit: `git add server.js CLAUDE.md && git commit -m "Share strip covers the rent roll"`

### Task 2: Tabs (index.html)

**Files:** Modify `index.html` — markup around :1045-1120 (post-hero through compsCard), print CSS :305-320, JS near renderAnalysisCluster + renderResults :3085.

- [ ] **Markup**: insert the tab bar directly after `#ownerHero`'s closing `</div>`; open `<div id="tabAnalysis" class="hidden space-y-6">` before `#dcfCard` and close it after `#sensCard` (rent-roll card joins inside in Task 3), appending inside it:

```html
          <p id="analysisEmpty" class="hidden text-sm text-[#5A6473]">Enter an NOI in Property details above to unlock the analysis tools for this building.</p>
```

Then open `<div id="tabReport" class="space-y-6">` before `#statTiles` and close it after `#compsCard`. Disclaimer + print footer stay outside. Tab bar:

```html
        <div id="reportTabs" class="no-print flex items-center gap-6 border-b rd-hairline">
          <button id="tabBtnReport" type="button" class="pb-2 text-sm font-semibold text-[#1A2433] border-b-2 border-[#B91C1C] -mb-px">Market Report</button>
          <button id="tabBtnAnalysis" type="button" class="pb-2 text-sm font-medium text-[#5A6473] border-b-2 border-transparent -mb-px hover:text-[#1A2433]">Analysis</button>
        </div>
```

- [ ] **Print CSS** (:305 block): add `#tabReport, #tabAnalysis { display: block !important; }` and extend the break rule selector `#reportArea > *` to `#reportArea > *, #tabReport > *, #tabAnalysis > *`.
- [ ] **JS** (place directly above `renderAnalysisCluster`):

```js
  // Report | Analysis tabs — pure class toggling; print CSS ignores them.
  function setReportTab(which) {
    const isReport = which !== "analysis";
    document.getElementById("tabReport").classList.toggle("hidden", !isReport);
    document.getElementById("tabAnalysis").classList.toggle("hidden", isReport);
    const on = "pb-2 text-sm font-semibold text-[#1A2433] border-b-2 border-[#B91C1C] -mb-px";
    const off = "pb-2 text-sm font-medium text-[#5A6473] border-b-2 border-transparent -mb-px hover:text-[#1A2433]";
    document.getElementById("tabBtnReport").className = isReport ? on : off;
    document.getElementById("tabBtnAnalysis").className = isReport ? off : on;
    if (!isReport && currentParsed && currentMeta) renderAnalysisCluster(currentParsed, currentMeta, false);
    // Leaflet renders blank tiles if its container was hidden — re-measure.
    if (isReport && mapInstance) setTimeout(() => mapInstance.invalidateSize(), 50);
  }
  document.getElementById("tabBtnReport").addEventListener("click", () => setReportTab("report"));
  document.getElementById("tabBtnAnalysis").addEventListener("click", () => setReportTab("analysis"));
```

- [ ] In `renderAnalysisCluster`, add after the lock-card toggle: `document.getElementById("analysisEmpty").classList.toggle("hidden", hasNoi);`
- [ ] In `renderResults` next to `renderAnalysisCluster(parsed, meta, true)` (:3085): add `setReportTab("report");` (every fresh render lands on Market Report).
- [ ] Verify (browser, saved-chip test report with NOI): default = Market Report (stat tiles visible, DCF hidden); click Analysis → cluster visible, market cards hidden; back → map still paints; no-NOI report (clear NOI, re-render) → Analysis tab shows only `#analysisEmpty`; print rule present (`document.styleSheets` scan or source grep); zero console errors.
- [ ] Commit: `git add index.html tailwind.css && git commit -m "Split the report into Market Report | Analysis tabs (hero above, print unaffected)"`

### Task 3: Rent-roll card (index.html)

**Files:** Modify `index.html` — markup inside `#tabAnalysis` after `#sensCard`; JS after `renderSensCard`; lock copy :1056-1057 + nudge :2503; cluster wiring.

- [ ] **Markup** (after `#sensCard`, before `#analysisEmpty`):

```html
        <!-- Rent roll & rollover — standalone risk view (WALT, occupancy, expiry
             schedule). Tenant rents are private finances: portfolio-only, shares
             strip them. Built by renderRentRollCard(). -->
        <div id="rentRollCard" class="hidden rd-bcard print-shadow-none fade-in">
          <div class="flex items-center justify-between gap-4 mb-4">
            <h2 class="font-brand uppercase tracking-wide text-base font-semibold text-slate-800">Rent Roll &amp; Rollover</h2>
            <span id="rrBasis" class="text-xs text-[#8A93A0] text-right"></span>
          </div>
          <div id="rrRows" class="no-print space-y-2 mb-2"></div>
          <button id="rrAdd" type="button" class="no-print btn-live text-sm font-medium text-[#5A6473] bg-white hover:text-[#1A2433] border border-[#D8D4C9] rounded px-3 py-1.5 mb-4">+ Add lease</button>
          <div id="rrOut" class="hidden">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div class="rd-tile"><div class="rd-lab">WALT</div><div id="rrWalt" class="text-2xl font-semibold text-[#1A2433] mt-1">—</div><div class="text-xs text-[#8A93A0] mt-1">rent-weighted avg lease term</div></div>
              <div class="rd-tile"><div class="rd-lab">Occupancy</div><div id="rrOcc" class="text-2xl font-semibold text-[#1A2433] mt-1">—</div><div id="rrOccSub" class="text-xs text-[#8A93A0] mt-1"></div></div>
              <div class="rd-tile"><div class="rd-lab">Total base rent</div><div id="rrRent" class="text-2xl font-semibold text-[#1A2433] mt-1">—</div><div id="rrRentSub" class="text-xs text-[#8A93A0] mt-1"></div></div>
            </div>
            <div id="rrScheduleWrap" class="overflow-x-auto mt-4"></div>
          </div>
          <p class="text-xs text-[#8A93A0] mt-4">Lease data stays in your browser and your own portfolio — never on shared links. Rollover shows base rent expiring by calendar year; renewals aren't assumed.</p>
        </div>
```

- [ ] **JS** — after `renderSensCard`, before `renderAnalysisCluster`. Row editor rebuilds only from data (`rebuildRows`), edits recompute outputs without touching row DOM (no focus loss):

```js
  // ----------------------------------------------------------------------------
  // Rent roll & rollover — standalone risk view. Leases live in
  // meta.assumptions.rentRoll and ride the same persistence pipeline.
  // ----------------------------------------------------------------------------
  const RR_MAX_LEASES = 12;

  function rentRollStats(rentRoll, subjectSf) {
    const yearNow = new Date().getFullYear();
    const leases = (rentRoll || []).filter((l) => l && (l.sf > 0 || l.rent > 0));
    const totRent = leases.reduce((n, l) => n + (l.rent || 0), 0);
    const totSf = leases.reduce((n, l) => n + (l.sf || 0), 0);
    const walt = totRent > 0
      ? leases.reduce((n, l) => n + (l.rent || 0) * Math.max(0, (l.endYear || yearNow) - yearNow), 0) / totRent
      : null;
    const buckets = [];   // next 10 calendar years + "later"; expired clamps to now
    for (let y = yearNow; y < yearNow + 10; y++) buckets.push({ year: String(y), count: 0, sf: 0, rent: 0 });
    buckets.push({ year: "Later", count: 0, sf: 0, rent: 0 });
    leases.forEach((l) => {
      const y = Math.max(yearNow, l.endYear || yearNow);
      const b = y >= yearNow + 10 ? buckets[10] : buckets[y - yearNow];
      b.count += 1; b.sf += l.sf || 0; b.rent += l.rent || 0;
    });
    return { leases, totRent, totSf, walt,
      occupancy: subjectSf > 0 && totSf > 0 ? totSf / subjectSf : null,
      buckets: buckets.filter((b) => b.count > 0) };
  }

  function rrRowEl(lease) {
    const row = document.createElement("div");
    row.className = "rr-row flex flex-wrap items-center gap-2";
    const mk = (cls, ph, val, label) => {
      const i = document.createElement("input");
      i.className = "rr-in " + cls + " rounded border border-[#D8D4C9] px-2.5 py-1.5 text-sm text-[#1A2433] focus:border-[#B91C1C] focus:ring-1 focus:ring-[#B91C1C] outline-none";
      i.placeholder = ph; i.setAttribute("aria-label", label);
      if (val != null && val !== "") i.value = val;
      return i;
    };
    row.appendChild(mk("rr-label flex-1 min-w-[110px]", "Suite / tenant (optional)", lease.label || "", "Suite or tenant"));
    row.appendChild(mk("rr-sf w-24", "SF", lease.sf > 0 ? lease.sf : "", "Square feet"));
    row.appendChild(mk("rr-rent w-32", "Annual rent $", lease.rent > 0 ? lease.rent : "", "Annual base rent"));
    row.appendChild(mk("rr-end w-20", "Expires", lease.endYear || "", "Expiration year"));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "text-[#8A93A0] hover:text-red-700 text-lg leading-none px-1";
    del.textContent = "×";
    del.title = "Remove lease";
    del.addEventListener("click", () => { row.remove(); syncRentRoll(); });
    row.appendChild(del);
    row.querySelectorAll("input").forEach((i) => i.addEventListener("input", () => {
      clearTimeout(rrEditTimer);
      rrEditTimer = setTimeout(syncRentRoll, 300);
    }));
    return row;
  }
  let rrEditTimer = null;

  // Read the row DOM -> assumptions.rentRoll -> persist + recompute outputs.
  function syncRentRoll() {
    if (!currentMeta || !currentParsed) return;
    const a = ensureAssumptions(currentMeta, currentParsed);
    const yearNow = new Date().getFullYear();
    a.rentRoll = [...document.querySelectorAll("#rrRows .rr-row")].map((row) => {
      const num = (sel) => numericValue(row.querySelector(sel).value);
      const yr = Math.round(num(".rr-end"));
      return {
        label: row.querySelector(".rr-label").value.trim().slice(0, 60),
        sf: num(".rr-sf") > 0 ? Math.round(num(".rr-sf")) : null,
        rent: num(".rr-rent") > 0 ? Math.round(num(".rr-rent")) : null,
        endYear: yr >= yearNow - 1 && yr <= yearNow + 30 ? yr : null,
      };
    }).filter((l) => l.sf > 0 || l.rent > 0);
    persistAssumptions();
    renderRentRollOutputs();
  }

  function renderRentRollOutputs() {
    const a = ensureAssumptions(currentMeta, currentParsed);
    const s = currentMeta.subject || {};
    const subjectSf = s.sizeMin > 0 ? (s.sizeMin + (s.sizeMax || s.sizeMin)) / 2 : null;
    const st = rentRollStats(a.rentRoll, subjectSf);
    const out = document.getElementById("rrOut");
    if (!st.leases.length) { out.classList.add("hidden"); document.getElementById("rrBasis").textContent = ""; return; }
    out.classList.remove("hidden");
    document.getElementById("rrWalt").textContent = st.walt != null ? (Math.round(st.walt * 10) / 10).toFixed(1) + " yrs" : "—";
    document.getElementById("rrOcc").textContent = st.occupancy != null ? Math.round(st.occupancy * 100) + "%" : "—";
    document.getElementById("rrOccSub").textContent = st.occupancy == null ? "enter the building SF above"
      : st.occupancy > 1 ? "leased SF exceeds the entered building SF" : `${st.totSf.toLocaleString()} SF leased`;
    document.getElementById("rrRent").textContent = st.totRent ? "$" + Math.round(st.totRent).toLocaleString() : "—";
    document.getElementById("rrRentSub").textContent = s.noi > 0
      ? `base rent before expenses & vacancy — your NOI is $${Math.round(s.noi).toLocaleString()}` : "";
    document.getElementById("rrBasis").textContent = `${st.leases.length} lease${st.leases.length === 1 ? "" : "s"}`;
    const wrap = document.getElementById("rrScheduleWrap");
    wrap.innerHTML = "";
    const table = document.createElement("table");
    table.className = "w-full text-xs border-collapse";
    const head = document.createElement("tr");
    ["Expires", "Leases", "SF", "% of rent"].forEach((h, i) => {
      const th = document.createElement("th");
      th.className = "font-medium text-[#8A93A0] p-1.5 " + (i === 0 ? "text-left" : "text-right");
      th.textContent = h;
      head.appendChild(th);
    });
    table.appendChild(head);
    st.buckets.forEach((b) => {
      const share = st.totRent > 0 ? b.rent / st.totRent : 0;
      const tr = document.createElement("tr");
      tr.className = share > 0.5 ? "bg-[#FCF1EF]" : share > 0.3 ? "bg-[#FBF8EF]" : "";
      const cells = [b.year, String(b.count), b.sf ? b.sf.toLocaleString() : "—",
        Math.round(share * 100) + "%"];
      cells.forEach((c, i) => {
        const td = document.createElement("td");
        td.className = "p-1.5 border border-[#EFEDE7] tabular-nums " + (i === 0 ? "text-left" : "text-right") +
          (share > 0.3 && i === 3 ? " font-semibold" : "");
        td.textContent = c;
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    wrap.appendChild(table);
  }

  function renderRentRollCard(parsed, meta, rebuildRows) {
    const card = document.getElementById("rentRollCard");
    const noi = meta && meta.subject && meta.subject.noi > 0 ? meta.subject.noi : null;
    if (!noi || !currentUser) { card.classList.add("hidden"); return; }
    const a = ensureAssumptions(meta, parsed);
    if (!Array.isArray(a.rentRoll)) a.rentRoll = [];
    const rowsEl = document.getElementById("rrRows");
    if (rebuildRows || !rowsEl.children.length) {
      rowsEl.innerHTML = "";
      (a.rentRoll.length ? a.rentRoll : [{}]).forEach((l) => rowsEl.appendChild(rrRowEl(l)));
    }
    renderRentRollOutputs();
    card.classList.remove("hidden");
  }
  document.getElementById("rrAdd").addEventListener("click", () => {
    const rowsEl = document.getElementById("rrRows");
    if (rowsEl.children.length >= RR_MAX_LEASES) return;
    rowsEl.appendChild(rrRowEl({}));
  });
```

- [ ] Wire into the cluster: `renderRentRollCard(parsed, meta, resetAssumptions);` added to `renderAnalysisCluster` after `renderSensCard`.
- [ ] Lock copy (:1056-1057): "Debt &amp; Sensitivity Analysis" → "Debt, Sensitivity &amp; Rent-Roll Analysis"; the `<p>` → "DSCR, refi headroom, a value sensitivity grid, and lease-rollover risk for this building — free with an account."; nudge string (:2503) → "Create a free account to unlock the debt, sensitivity, and rent-roll analysis for this report."
- [ ] Verify (browser, signed in, test report NOI 120k, subject SF 10,000): add the spec's three leases (4,000 SF/$60k/2028 · 3,000/$45k/2027 · 2,000/$30k/2033) → WALT "2.8 yrs", occupancy "90%", total rent "$135,000" with the NOI note, 2027 row amber at 33%, %s sum to 100; remove a row → recompute; reload + reopen chip → rows rebuilt from persisted data; portfolio GET shows rentRoll; typing in a row doesn't lose focus; XSS probe label `<b>x</b>` renders inert; signed out → lock card covers it.
- [ ] Commit: `git add index.html tailwind.css && git commit -m "Add rent-roll & rollover card: WALT, occupancy, expiry schedule"`

### Task 4: XLSX fourth sheet (index.html)

**Files:** Modify `index.html` — `exportXlsx` after the Assumptions sheet append.

- [ ] Insert before the filename/slug lines:

```js
      const rr = (a.rentRoll || []).filter((l) => l && (l.sf > 0 || l.rent > 0));
      if (rr.length) {
        const subjectSf2 = s.sizeMin > 0 ? (s.sizeMin + (s.sizeMax || s.sizeMin)) / 2 : null;
        const st = rentRollStats(rr, subjectSf2);
        const rrAoa = [
          ["Suite / tenant", "SF", "Annual base rent", "Expires"],
          ...rr.map((l) => [l.label || "", l.sf || "", l.rent || "", l.endYear || ""]),
          [],
          ["WALT (yrs)", st.walt != null ? Math.round(st.walt * 10) / 10 : ""],
          ...(st.occupancy != null ? [["Occupancy", Math.round(st.occupancy * 100) + "%"]] : []),
          ["Total base rent", Math.round(st.totRent)],
          [],
          ["Rollover", "Leases", "SF", "% of rent"],
          ...st.buckets.map((b) => [b.year, b.count, b.sf, st.totRent > 0 ? Math.round((b.rent / st.totRent) * 100) + "%" : ""]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rrAoa), "Rent Roll");
      }
```

- [ ] Verify via the writeFile-intercept pattern: 4 sheets with leases present, 3 without; Rent Roll sheet rows match the card.
- [ ] Commit: `git add index.html && git commit -m "XLSX export gains a Rent Roll sheet when leases exist"`

### Task 5: QA + deploy

- [ ] Full sweep: spec verification items 1-6 (tabs incl. map round-trip + print rule, rent-roll math, persistence, share strip, XLSX, gate); zero console errors; zero billed searches; clean up test leases from the QA portfolio item; `git status` clean.
- [ ] Push `origin/main`; wait for Render; live checks: new tab markup + rentRollCard in served HTML; prod share-strip re-proof with rentRoll; memory + wrap-up.

## Self-review

Spec coverage: tabs (Task 2 — bar, wrappers, default, empty-state, print incl. break-rule fix, map invalidateSize), rent-roll (Task 3 — fields/limits/gating/persistence/outputs/tints), strip + CLAUDE.md (Task 1), XLSX (Task 4), verification (Task 5 + per-task). Placeholders: none. Consistency: `rentRollStats(rentRoll, subjectSf)` used identically in Tasks 3/4; `renderRentRollCard(parsed, meta, rebuildRows)` matches the cluster call; tint hues reuse the sens palette (#FBF8EF) + a soft red (#FCF1EF).
