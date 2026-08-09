# Progressive Report Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During the 40-70s report-writing phase, fill the real report surfaces (hero placeholder, summary, comp table) from the SSE events instead of a throwaway preview inside the loading card.

**Architecture:** index.html only; no server changes. New "assembly" functions route the existing `comp` and `field:summary` progress events into `#ownerHero`, `#summaryCard`, and `#compsCard`, hidden-siblings managed by a JS allowlist walk (`data-assemble` attributes + an `asm-hidden` class). The final `result` still runs `renderResults` unchanged, which repaints everything wholesale. Spec: `docs/superpowers/specs/2026-08-09-progressive-report-rendering-design.md`.

**Tech Stack:** Vanilla JS in index.html's inline script, existing Tailwind classes only (no regen needed), one new CSS rule in the page's `<style>` block.

## Global Constraints

- **No dollar figures in the preview, ever.** The hero placeholder shows counts only. Comp events deliberately omit `price_per_sqft` and `source_type`; do not add fields to the events.
- **Model-written text goes in via `textContent`, never `innerHTML`** (matches the rule stamped on the old preview code).
- **No shimmer or skeleton animation on assembling content**; rows use the existing `row-in` entrance class only (calm-UI rule).
- **Assembly never toggles the `hidden` class on anything except `#results` and `#ownerHero`** (both re-decided by the final render). Everything else it hides uses its own `asm-hidden` class so `resetAssembly()` can restore it wholesale.
- **No server changes**: `makeCompExtractor`, `guardComp`, and event payloads stay untouched.
- **Shared checkout hazard (real, current):** another session has uncommitted edits in `index.html` and `tailwind.css` right now. Before every commit follow the shared-checkout skill: `git status --short` fresh, build a filtered patch of only YOUR hunks with the Bash tool (`git diff -- index.html`, select hunks, `git apply --cached`), check `git diff --cached` for foreign hunks, never `git add index.html` whole, never stage `tailwind.css` (this feature adds no new utility classes; the regen hook may still touch the file, leave it unstaged).
- **No em dashes in any user-facing copy or doc prose** (owner rule). The `·` separator is fine.
- Node runs by full path on this machine: `& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" server.js`

---

### Task 1: HTML + CSS groundwork

**Files:**
- Modify: `index.html:1430-1435` (remove the `#loadingComps` preview box and its comment)
- Modify: `index.html:1439` (id the decorative skeleton wrapper)
- Modify: `index.html:1587` (`#ownerHero` gets `data-assemble`)
- Modify: `index.html:1876` (summary card gets `id="summaryCard"` and `data-assemble`)
- Modify: `index.html:1970` (`#compsCard` gets `data-assemble`)
- Modify: the page's `<style>` block (add `.asm-hidden`, next to the `.skeleton` rules)

**Interfaces:**
- Produces: `[data-assemble]` on exactly three cards; `#loadingSkeletons`; `#summaryCard`; CSS class `asm-hidden`. Task 2's JS depends on all four.

- [ ] **Step 1: Remove the loadingComps box**

Delete lines 1430-1435 (the comment starting `<!-- Live report preview:` and the `<div id="loadingComps" ...></div>` line). The old JS null-guards `getElementById("loadingComps")`, so the page keeps working between this task and Task 2; the preview is simply absent.

- [ ] **Step 2: Id the decorative skeleton wrapper**

At line 1439 change:

```html
      <div class="mt-6 space-y-6" aria-hidden="true">
```

to:

```html
      <div id="loadingSkeletons" class="mt-6 space-y-6" aria-hidden="true">
```

- [ ] **Step 3: Tag the three participating cards**

```html
        <div id="ownerHero" data-assemble class="hidden rd-bcard print-shadow-none fade-in">
```

```html
        <div id="summaryCard" data-assemble class="rd-bcard print-shadow-none fade-in">
```

(the summary card at 1876 currently has no id)

```html
        <div id="compsCard" data-assemble class="rd-exhibit overflow-hidden print-shadow-none fade-in">
```

- [ ] **Step 4: Add the CSS rule**

In the `<style>` block, next to the `.skeleton` rules:

```css
      /* Assembling report: children of #results outside the data-assemble
         allowlist are hidden by beginAssembly()'s walk and restored wholesale
         by resetAssembly(). Its own class, never `hidden`, which belongs to
         the renderers. */
      .asm-hidden { display: none !important; }
```

- [ ] **Step 5: Verify the page still boots clean**

Start the server, load http://localhost:3000, open the console: no errors. Run a search against a CACHED address (any address searched before; instant, unbilled): report renders normally. `npm test` passes (2s).

- [ ] **Step 6: Commit (filtered patch per Global Constraints)**

```bash
git status --short
git diff -- index.html        # confirm which hunks are yours vs the other session's
# stage ONLY your hunks via git apply --cached, then:
git diff --cached -- index.html   # zero foreign hunks before committing
git commit -m "Progressive rendering groundwork: data-assemble tags, asm-hidden, retire the loading-card preview box"
```

---

### Task 2: Assembly functions + rewiring

**Files:**
- Modify: `index.html:2990-3065` (replace `loadingCompsSeen`, `resetLoadingComps`, `loadingCompTable`, `addLoadingCompLine`, `showLoadingSummary` with the assembly module)
- Modify: `index.html:3067-3078` (`showLoadingCard`), `index.html:3146-3157` (`applyProgress` comp/field/retry branches), `index.html:3172-3179` (`hideLoadingCard`)

**Interfaces:**
- Consumes: Task 1's `[data-assemble]`, `#loadingSkeletons`, `#summaryCard`, `.asm-hidden`; existing `setReportTab(which)`, `geocodeAddress(addr)`.
- Produces: `beginAssembly()`, `assemblyComp(evt)`, `assemblySummary(text)`, `resetAssembly()` (all idempotent / null-safe via the `asm` state variable). No other code may call the deleted preview functions afterward.

- [ ] **Step 1: Replace the preview functions with the assembly module**

Delete `loadingCompsSeen`, `resetLoadingComps()`, `loadingCompTable()`, `addLoadingCompLine()`, `showLoadingSummary()` (lines 2990-3065) and the stale comment block above them, and put this in their place:

```js
  // -------------------------------------------------------------------------
  // Assembling report: from the first streamed event, the REAL report
  // surfaces (#ownerHero, #summaryCard, #compsCard) fill in live while the
  // model writes; everything else in #results is hidden by an allowlist walk.
  // renderResults repaints all of it wholesale at the end, so nothing here
  // survives into the report of record. Counts only, never a dollar figure:
  // comp events deliberately omit price_per_sqft and source_type (both are
  // corrected post-parse), and the preview must never show a number the
  // final report walks back.
  let asm = null;   // null = not assembling; else { comps, priced, lockedN }
  const ASM_COLUMNS = [
    { label: "Address", numeric: false },
    { label: "Type", numeric: false },
    { label: "Price", numeric: true },
    { label: "Size (SF)", numeric: true },
    { label: "Date", numeric: false },
  ];
  function beginAssembly() {
    if (asm) return;
    asm = { comps: 0, priced: 0, lockedN: 0 };
    const results = document.getElementById("results");
    // The assembling cards live in the Report tab panel.
    setReportTab("report");
    // Allowlist, not a blocklist: hide every child that neither is nor
    // contains a data-assemble block, so a future results card stays out of
    // the assembly by default instead of leaking in half-rendered.
    (function hideOthers(el) {
      for (const child of el.children) {
        if (child.hasAttribute("data-assemble")) continue;
        if (child.querySelector("[data-assemble]")) { hideOthers(child); continue; }
        child.classList.add("asm-hidden");
      }
    })(results);
    // Hero -> counts-only placeholder.
    ["ownerLow", "ownerMid", "ownerHigh"].forEach((id) => { document.getElementById(id).textContent = "-"; });
    ["ownerLowPpsf", "ownerMidPpsf", "ownerHighPpsf"].forEach((id) => { document.getElementById(id).textContent = ""; });
    document.getElementById("ownerBasis").textContent = "Valuation computes when all comps are in";
    ["widenSearchWrap", "ownerApproaches", "ownerTrust", "bovCtaWrap"].forEach((id) =>
      document.getElementById(id).classList.add("asm-hidden"));
    document.getElementById("ownerHero").classList.remove("hidden");
    // A repeat search must not show the previous report's prose or rows.
    document.getElementById("summaryText").textContent = "";
    const card = document.getElementById("compsCard");
    for (const child of card.children) {
      if (child.id === "scrollBody" || child.id === "cardList" || child.querySelector("h2")) continue;
      child.classList.add("asm-hidden");
    }
    document.getElementById("txFilter").classList.add("asm-hidden");
    document.getElementById("compCount").textContent = "";
    const head = document.getElementById("tableHead");
    head.innerHTML = "";
    ASM_COLUMNS.forEach((col) => {
      const th = document.createElement("th");
      th.className = "font-semibold px-4 py-3 whitespace-nowrap " + (col.numeric ? "text-right" : "text-left");
      th.textContent = col.label;
      head.appendChild(th);
    });
    ["subjectRowBody", "tableBody", "tableFoot", "cardList"].forEach((id) => {
      document.getElementById(id).innerHTML = "";
    });
    results.classList.add("assembling");
    results.setAttribute("aria-busy", "true");
    results.classList.remove("hidden");
    // The loading card slims down: its decorative gray skeletons are
    // redundant once real cards are filling in below it.
    document.getElementById("loadingSkeletons").classList.add("hidden");
  }
  function updateAsmHero() {
    const found = asm.comps + asm.lockedN;
    document.getElementById("ownerBasis").textContent =
      "Valuation computes when all comps are in · " + found + (found === 1 ? " comp" : " comps") + " found" +
      (asm.priced ? " · " + asm.priced + " priced sale" + (asm.priced === 1 ? "" : "s") : "");
  }
  function assemblyComp(evt) {
    beginAssembly();
    if (evt.locked) {
      // Gated comps stream as { locked: true } with no identity (guardComp,
      // server-side). One line below the table, same as the final report's
      // stance: redacted, never blurred.
      asm.lockedN = Math.max(asm.lockedN, Math.max(1, Number(evt.n) - asm.comps));
      const foot = document.getElementById("tableFoot");
      let cell = foot.querySelector("[data-asm-lock]");
      if (!cell) {
        const tr = foot.insertRow();
        cell = tr.insertCell();
        cell.colSpan = ASM_COLUMNS.length;
        cell.setAttribute("data-asm-lock", "1");
        cell.className = "px-4 py-3 text-sm text-[#68707E]";
      }
      cell.textContent = "+ " + asm.lockedN + " more found · unlock with Pro";
    } else {
      if (!evt.address) return;
      asm.comps++;
      if (evt.price && /sale/i.test(String(evt.transaction || ""))) asm.priced++;
      const tr = document.getElementById("tableBody").insertRow();
      tr.className = "row-in";
      // Model-written text: textContent only, never innerHTML.
      [evt.n + ". " + evt.address, evt.transaction || "", evt.price || "", evt.size_sqft || "", evt.date || ""]
        .forEach((v, i) => {
          const td = tr.insertCell();
          td.textContent = v;
          td.className = "px-4 py-3 align-top whitespace-nowrap" + (ASM_COLUMNS[i].numeric ? " text-right" : "");
        });
      // Mobile mirror: the table body is hidden under sm, cards carry it.
      const div = document.createElement("div");
      div.className = "px-6 py-3 row-in";
      const a = document.createElement("p");
      a.className = "text-sm font-medium text-[#1A2433]";
      a.textContent = evt.n + ". " + evt.address;
      const m = document.createElement("p");
      m.className = "text-xs text-[#68707E] mt-0.5";
      m.textContent = [evt.transaction, evt.price, evt.size_sqft, evt.date].filter(Boolean).join(" · ");
      div.appendChild(a); div.appendChild(m);
      document.getElementById("cardList").appendChild(div);
      document.getElementById("compCount").textContent =
        asm.comps + (asm.comps === 1 ? " comp" : " comps") + " so far";
      // Cache warmer: the same lookup renderResults' map will make, done now
      // during the wait so pins paint instantly at render. Failures are
      // already swallowed inside geocodeAddress.
      geocodeAddress(evt.address);
    }
    updateAsmHero();
  }
  function assemblySummary(text) {
    beginAssembly();
    document.getElementById("summaryText").textContent = text;
  }
  function resetAssembly() {
    if (!asm) return;
    asm = null;
    const results = document.getElementById("results");
    results.querySelectorAll(".asm-hidden").forEach((el) => el.classList.remove("asm-hidden"));
    results.classList.remove("assembling");
    results.removeAttribute("aria-busy");
    results.classList.add("hidden");
    // Leave nothing half-real behind: renderResults rebuilds all of these
    // wholesale on success, and on error the report region must be empty.
    ["tableBody", "tableFoot", "cardList", "subjectRowBody"].forEach((id) => {
      document.getElementById(id).innerHTML = "";
    });
    document.getElementById("summaryText").textContent = "";
    document.getElementById("compCount").textContent = "";
    document.getElementById("ownerBasis").textContent = "";
    document.getElementById("loadingSkeletons").classList.remove("hidden");
  }
```

- [ ] **Step 2: Rewire the three call sites**

In `showLoadingCard` (line ~3072): `resetLoadingComps();` becomes `resetAssembly();`

In `applyProgress`:
- the `comp` branch (line ~3147): `addLoadingCompLine(evt);` becomes `assemblyComp(evt);`
- the `field` branch (line ~3149): `showLoadingSummary(String(evt.value));` becomes `assemblySummary(String(evt.value));`
- the `retry` branch (line ~3153): `resetLoadingComps();   // attempt 2 finds its own comps` becomes `resetAssembly();   // attempt 2 finds its own comps`

In `hideLoadingCard` (line ~3177): `resetLoadingComps();` becomes `resetAssembly();`

- [ ] **Step 3: Confirm no stragglers**

```bash
grep -n "loadingComps\|addLoadingCompLine\|showLoadingSummary\|resetLoadingComps\|loadingCompTable" index.html
```

Expected: zero matches.

- [ ] **Step 4: Run the suite**

Run: `npm test` (via portable node if needed). Expected: all pass; this change touches no tested module, so a failure means an accidental edit outside index.html.

- [ ] **Step 5: Commit (filtered patch per Global Constraints)**

```bash
git diff --cached -- index.html   # verify only assembly hunks staged
git commit -m "Assemble the real report during the write phase (hero counts, summary, live table rows)"
```

---

### Task 3: Browser verification (the spec's checklist)

**Files:** none created; fixes land in `index.html` if checks fail.

**Interfaces:**
- Consumes: everything from Tasks 1-2, a locally running server, the browser preview pane.

Cost note: exactly ONE fresh search is billed (~$0.36); every other check uses cache hits or free paths. The embedded preview pane cannot exercise html2canvas in this app (known quirk); check 7's PNG half needs real Chrome or gets deferred to the owner.

- [ ] **Step 1: Fresh search assembles.** Start the server, search a never-searched address (pick a new city to dodge the cache). Expect: loading card slims when the first event lands, results section appears with hero placeholder (dashes + counts line, no dollars), summary prose fills, table rows accrue with the row-in fade, comp count chip ticks. Final report replaces everything; compare against a control (same address re-searched, which is now a cache hit rendering identically minus assembly).
- [ ] **Step 2: Cache hit stays instant.** Re-run the same search: plain JSON, no assembly flash, report renders as today.
- [ ] **Step 3: Free-tier gating.** Click "View as a free user" (plan card) and search a cached-but-gated address at 12 comps. During assembly (only on a fresh address; if all free checks hit cache, skip the stream part) the lock line reads "+ N more found · unlock with Pro"; the final gated report renders normally.
- [ ] **Step 4: Mid-write kill.** Start a fresh search on a SECOND new address, kill the server process mid-write. Expect: error card, `#results` hidden, no half-report residue (check `document.querySelectorAll('.asm-hidden').length === 0` in the console). Restart the server.
- [ ] **Step 5: Re-search over an on-screen report.** With a report showing, search a different cached address, then a fresh one: no stale content bleeds into the assembling state (hero counts start at zero, summary empties, table empties).
- [ ] **Step 6: Mobile width.** Resize preview to 375px during a fresh assembly (or replay Step 1 at mobile width if no budget for another billed search: acceptable to verify card mirror by temporarily calling `assemblyComp({n:1,address:"1 Test St, Boise, ID",price:"$1,000,000",size_sqft:"10,000",date:"2026-05-01",transaction:"sale"})` from the console after `beginAssembly()`, then `resetAssembly()`). Card list shows the mirror entries.
- [ ] **Step 7: Exports unchanged.** After a final render: Print preview shows the full report (no asm-hidden residue); PNG export via real Chrome if available, else note for the owner.
- [ ] **Step 8: Console sweep.** Zero errors across all of the above.
- [ ] **Step 9: Commit any fixes** (filtered patch rules apply).

---

### Task 4: Docs + devlog

**Files:**
- Modify: `CLAUDE.md` (the "Live search progress" bullet's front-end sentence)
- Modify: `devlog.json` (append one entry; rebuild-not-patch per shared-checkout)

**Interfaces:**
- Consumes: shipped behavior from Tasks 1-3.

- [ ] **Step 1: Update CLAUDE.md**

In the "Live search progress" section, replace the sentence beginning "Front-end: `readProgressStream` +`applyProgress` in index.html, driving the existing loading card; `comp` events render as plain text lines via `addLoadingCompLine` (5 most recent + a "+N more" lock line)." with:

> Front-end: `readProgressStream` + `applyProgress` in index.html. Since 2026-08-09 the streamed events assemble the REAL report surfaces (`beginAssembly` / `assemblyComp` / `assemblySummary` / `resetAssembly`): the first `comp` or summary `field` event reveals `#results` with only the `data-assemble` cards visible (hero as a counts-only placeholder, never a dollar figure; summary; core-column comp table + "+N more · unlock with Pro" lock line), everything else hidden under `.asm-hidden` until `renderResults` repaints wholesale. Assembly never touches the `hidden` class except on `#results`/`#ownerHero`; every exit (result, error, `retry`) funnels through `resetAssembly` riding on `hideLoadingCard`.

Keep the surrounding fallback-layers sentence; it is still true (the wall-clock simulation, the non-SSE fallback, and the 8s watchdog all mean assembly simply never begins).

- [ ] **Step 2: Append the devlog entry**

Rebuild the staged file per the shared-checkout skill (take `git show HEAD:devlog.json`, fold in any entries present in the working file that HEAD lacks, add this one; clean UTF-8, raw em dashes fine here):

```json
{ "date": "2026-08-09", "type": "improvement",
  "title": "Reports assemble on screen while the model writes",
  "details": "The 40-70s write phase now fills the real report: value hero as a counts-only placeholder, market summary, and comp table rows appearing as each comp streams. No dollar figures until the final render; cache hits and buffered streams behave exactly as before." }
```

- [ ] **Step 3: Verify + commit**

`npm test`, then commit CLAUDE.md + devlog.json (explicit paths, verify no foreign devlog entry was dropped: `git show :devlog.json` contains every title the working file had).

---

## Self-review notes

- Spec coverage: trigger events (Task 2 Step 1: `assemblyComp`/`assemblySummary` both call `beginAssembly`), allowlist (`hideOthers`), hero placeholder (counts only), lock line, retry/error/cache/buffered fallbacks (rewiring + resetAssembly), mobile mirror, aria-busy, calm fade, CLAUDE.md + devlog (Task 4), manual verification (Task 3). Toolbar/map/chart/tiles hidden: they carry no `data-assemble`, so the walk covers them.
- Type consistency: `asm` fields (`comps`, `priced`, `lockedN`) used identically across `beginAssembly`/`assemblyComp`/`updateAsmHero`; ids match index.html as read on 2026-08-09.
- The old functions null-guard `#loadingComps`, so Task 1 ships safely alone.
