# CompNinja Landing Redesign ("Research Desk") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the landing chrome of `index.html` (header, hero, form presentation, marketing sections, footer) and swap the logo sitewide to the approved "Research Desk" design — with zero functional changes.

**Architecture:** One file (`index.html`) served from disk on every request (no restart needed). New landing look is implemented with a small bespoke CSS block (`rd-*` classes) in the existing inline `<style>`, plus Tailwind utilities for layout. All JS hooks and element IDs are preserved; the only JS change is deleting the skyline-ninja easter-egg block. `tailwind.css` regenerates via the local auto-regen hook on edit (do NOT regenerate manually).

**Tech Stack:** Plain HTML + vendored Tailwind + inline CSS/JS. No new dependencies. Spec: `docs/superpowers/specs/2026-07-14-landing-redesign-design.md`. Approved mockup: claude.ai artifact `c992bcb8` (scratchpad file `compninja-a-fullpage.html`).

**Design tokens (use these values exactly):**
paper `#FBFBF9` · ink `#1A2433` · red `#B91C1C` · hairline `#E4E2DA` · strong border `#D8D4C9` · alt ground `#F5F4EF` · muted `#5A6473` / `#4C5665` / `#8A93A0` · display face `Georgia, 'Times New Roman', serif` · UI face Inter (already loaded).

**Verification environment:** dev server via the Browser pane (`preview_start` with launch.json name, or `node server.js` equivalent). The embedded pane cannot screenshot this app — verify with `read_page`, `read_console_messages`, and `javascript_tool` (computed styles), not screenshots.

---

### Task 1: CSS foundation — remove the old hero look, add the `rd-*` system

**Files:**
- Modify: `index.html:82` (fonts link), `index.html:106` (body font note), `index.html:130-166` (hero/glow/drift CSS), `index.html:178-194` + `index.html:272-276` (selection + skyline CSS), `index.html:374` (body class)

- [ ] **Step 1: Drop Oswald from the Google Fonts link** (line 82). Replace:

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Oswald:wght@500;600;700&display=swap" rel="stylesheet" />
```

with:

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
```

- [ ] **Step 2: Retarget `.font-brand` to the serif display face** (line 146). The report-body headings keep their markup and inherit the new face. Replace:

```css
.font-brand { font-family: 'Oswald', 'Inter', sans-serif; }
```

with:

```css
/* Display face — serif, Research Desk. Report headings inherit it too. */
.font-brand { font-family: Georgia, 'Times New Roman', serif; font-weight: 500; }
```

- [ ] **Step 3: Delete the old hero CSS.** Remove these blocks entirely:
  - `#hero { ... }` gradient + `border-bottom` (lines ~130-137)
  - `.hero-glow { ... }` (lines ~138-144)
  - `@keyframes brandDrift { ... }` (lines ~163-166)
  - `.skyline-ninja` blocks (lines ~181-194 and ~272-276, incl. the media query)

- [ ] **Step 4: Recolor text selection** (line ~179):

```css
::selection { background: #B91C1C; color: #fff; }
```

- [ ] **Step 5: Add the `rd-*` landing system** at the end of the inline `<style>` block (before `</style>`):

```css
/* ---------------- Research Desk landing system ---------------- */
.rd-kicker { font-size: 11.5px; letter-spacing: 0.16em; text-transform: uppercase; color: #B91C1C; font-weight: 600; }
.rd-h { font-family: Georgia, 'Times New Roman', serif; font-weight: 500; letter-spacing: -0.005em; color: #1A2433; }
.rd-hairline { border-color: #E4E2DA; }
.rd-wordmark { font-size: 15px; font-weight: 600; letter-spacing: 0.14em; color: #1A2433; }
.rd-wordmark b { color: #B91C1C; font-weight: 600; }
/* Form-as-unit: bordered cells, micro labels, borderless inputs */
.rd-form { border: 1px solid #D8D4C9; background: #fff; border-radius: 6px; }
.rd-cell { padding: 11px 16px; border-right: 1px solid #ECEAE3; }
.rd-cell:last-child { border-right: 0; }
.rd-row { border-bottom: 1px solid #ECEAE3; }
.rd-lab { display: block; font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #8A93A0; font-weight: 600; margin-bottom: 2px; }
.rd-in { width: 100%; border: 0; outline: 0; padding: 0; font-size: 14.5px; color: #1A2433; background: transparent; }
.rd-in::placeholder { color: #9AA2AD; }
select.rd-in { appearance: auto; }
/* Keyboard focus: the whole cell rings when its bare input has focus (WCAG 2.4.7). */
.rd-cell:focus-within { box-shadow: inset 0 0 0 2px #B91C1C; }
@media (max-width: 639.98px) { .rd-cell { border-right: 0; border-bottom: 1px solid #ECEAE3; } .rd-row { border-bottom: 0; } }
/* Stat strip */
.rd-stat .n { font-size: 22px; font-weight: 600; color: #1A2433; font-variant-numeric: tabular-nums; }
.rd-stat .l { font-size: 11.5px; color: #8A93A0; letter-spacing: 0.06em; text-transform: uppercase; margin-top: 2px; }
/* Exhibit (sample report) */
.rd-exhibit { border: 1px solid #D8D4C9; background: #fff; border-radius: 6px; overflow: hidden; }
.rd-cap { padding: 12px 20px; border-bottom: 1px solid #ECEAE3; font-size: 11.5px; color: #8A93A0; letter-spacing: 0.06em; text-transform: uppercase; }
.rd-comps { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.rd-comps th { text-align: left; color: #8A93A0; font-weight: 600; padding: 7px 8px 7px 0; border-bottom: 1px solid #D8D4C9; font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase; }
.rd-comps td { padding: 9px 8px 9px 0; border-bottom: 1px solid #F0EFE9; }
.rd-badge { display: inline-block; font-size: 10.5px; font-weight: 600; border-radius: 3px; padding: 1.5px 7px; white-space: nowrap; }
.rd-badge.v { color: #06603A; background: #E3F2EA; }
.rd-badge.p { color: #46536A; background: #EAEEF4; }
.rd-badge.li { color: #7A5B12; background: #F7EFDC; }
.rd-drv { font-size: 13px; color: #374253; padding: 7px 0; border-top: 1px solid #F0EFE9; display: flex; gap: 8px; }
.rd-drv b { color: #B91C1C; font-weight: 700; }
/* Method steps + broker cards */
.rd-steps { border: 1px solid #D8D4C9; border-radius: 6px; overflow: hidden; background: #fff; }
.rd-step { padding: 22px 24px; border-right: 1px solid #ECEAE3; }
.rd-step:last-child { border-right: 0; }
.rd-num { font-family: Georgia, serif; font-size: 13px; color: #B91C1C; margin-bottom: 8px; }
.rd-bcard { border: 1px solid #D8D4C9; background: #fff; border-radius: 6px; padding: 24px; }
@media (max-width: 639.98px) { .rd-step { border-right: 0; border-bottom: 1px solid #ECEAE3; } .rd-step:last-child { border-bottom: 0; } }
```

- [ ] **Step 6: Body ground** (line 374). Replace:

```html
<body class="bg-slate-100 text-slate-800 min-h-screen">
```

with:

```html
<body class="bg-[#FBFBF9] text-slate-800 min-h-screen">
```

- [ ] **Step 7: Verify + commit.** Open the preview (`preview_start`), reload, check `read_console_messages` for errors and `javascript_tool`: `getComputedStyle(document.body).backgroundColor` → `rgb(251, 251, 249)`. `Grep` for `Oswald`, `hero-glow`, `brandDrift`, `skyline-ninja` in index.html → 0 matches (except the HTML div removed in Task 3; that one match is expected until Task 3).

```bash
git add index.html tailwind.css
git commit -m "Landing redesign 1/6: retire dark-hero CSS, add Research Desk token system"
```

---

### Task 2: Logo swap — favicon, print letterhead, report lockup (sitewide brand assets)

The cut-card mark (navy comp card sliced by a red diagonal), used everywhere the old headband-glyph appears.

**Canonical mark SVG (26px reference; scale via width/height/class):**

```html
<svg class="h-7 w-7 shrink-0" viewBox="0 0 30 30" aria-hidden="true">
  <rect x="2" y="4" width="26" height="22" rx="2" fill="#1A2433"/>
  <polygon points="2,26 28,4 28,10 8,26" fill="#B91C1C"/>
</svg>
```

**Canonical wordmark markup (ink-on-light; on dark grounds swap `rd-wordmark` color via a `text-white`-style override shown in Task 5):**

```html
<span class="rd-wordmark uppercase">COMP<b>NINJA</b></span>
```

**Files:**
- Modify: `index.html:77-78` (favicon), `index.html:776-782` (print letterhead), `index.html:798-806` (report lockup)

- [ ] **Step 1: Favicon** (lines 77-78). Replace comment + link with:

```html
<!-- Favicon: CompNinja cut-card mark (navy comp card, red diagonal slice) -->
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 30 30'%3E%3Crect x='2' y='4' width='26' height='22' rx='2' fill='%231A2433'/%3E%3Cpolygon points='2,26 28,4 28,10 8,26' fill='%23B91C1C'/%3E%3C/svg%3E" />
```

- [ ] **Step 2: Print letterhead** (lines ~773-789). Replace the old 44-viewBox SVG + `font-brand` wordmark span with the canonical mark (class `h-7 w-7 shrink-0`) and:

```html
<span class="rd-wordmark uppercase text-slate-900">COMP<b>NINJA</b></span>
```

Keep the surrounding letterhead structure (email + `printDate`) untouched.

- [ ] **Step 3: Report-header lockup** (lines ~797-806): same replacement — canonical mark + the same wordmark span. Keep the `report-lockup` wrapper class and layout.

- [ ] **Step 4: Verify + commit.** Grep `viewBox="0 0 44 44"` → remaining matches only at the old hero (line ~527) and footer (line ~1139), which Tasks 3/5 replace. Reload preview; no console errors; browser-tab icon shows the new mark.

```bash
git add index.html tailwind.css
git commit -m "Landing redesign 2/6: cut-card logo — favicon, letterhead, report lockup"
```

---

### Task 3: Header + hero + search form rebuild

**Files:**
- Modify: `index.html:505-667` (everything from `<!-- Hero -->` through the end of the form card `</div>`)

**Preserve these IDs/elements exactly (JS depends on them):** `compForm`, `address`, `propertyType` (options unchanged), `marketNote`, `lookback` (option values unchanged), `lookbackCustomWrap`, `lookbackCustom`, `txFocusWrap`, `txFocus`, `subjectDetails`, `subjectSummary`, `subjectHint`, `targetSizeLabel`, `targetSize`, `targetSizeMax`, `targetPriceLabel`, `targetPrice`, `targetPriceMax`, `noiWrap`, `noi`, `submitBtn`, `btnLabel`, `sampleBtn`.

- [ ] **Step 1: Replace lines 505-667** (old dark hero incl. skyline SVG, `skylineNinja` div, brand row, hero copy, pills, and the floating form card) with:

```html
  <!-- Header -->
  <header class="no-print border-b rd-hairline bg-[#FBFBF9]">
    <div class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <svg class="h-7 w-7 shrink-0" viewBox="0 0 30 30" aria-hidden="true">
          <rect x="2" y="4" width="26" height="22" rx="2" fill="#1A2433"/>
          <polygon points="2,26 28,4 28,10 8,26" fill="#B91C1C"/>
        </svg>
        <span class="rd-wordmark uppercase">COMP<b>NINJA</b></span>
      </div>
      <nav class="flex items-center gap-6 text-[13.5px] text-[#5A6473]">
        <a href="/markets" class="hover:text-[#1A2433]">Markets</a>
        <button type="button" data-scroll-to="for-brokers" class="hover:text-[#1A2433]">For Brokers</button>
        <button type="button" data-scroll-to="method" class="hover:text-[#1A2433] hidden sm:inline">Methodology</button>
      </nav>
    </div>
  </header>

  <!-- Hero -->
  <div id="hero" class="no-print bg-[#FBFBF9]">
    <div class="max-w-5xl mx-auto px-4 pt-12 sm:pt-14 pb-4">
      <div class="rd-kicker enter enter-1">Commercial Comp Reports</div>
      <h1 class="rd-h text-4xl sm:text-[42px] leading-[1.1] mt-3 max-w-[22ch] enter enter-1">Know what the building is worth before you make the call.</h1>
      <p class="text-[#4C5665] mt-4 text-[16.5px] max-w-[58ch] enter enter-1">Recent sale and lease comparables for any U.S. commercial property — searched live from public records and listings, every comp cited, delivered in about a minute.</p>
    </div>
  </div>

  <div class="max-w-5xl mx-auto px-4 pb-8">

    <!-- Search form — one bordered unit -->
    <div class="relative z-10 mt-4 no-print enter enter-2">
      <form id="compForm" class="rd-form">
        <div class="rd-row grid grid-cols-1 sm:grid-cols-[2.2fr_1fr]">
          <div class="rd-cell">
            <label class="rd-lab" for="address">Property address</label>
            <input id="address" type="text" required placeholder="e.g. 1200 W Industrial Blvd, Dallas, TX" class="rd-in" />
          </div>
          <div class="rd-cell">
            <label class="rd-lab" for="propertyType">Property type</label>
            <select id="propertyType" class="rd-in">
              <option>Industrial</option>
              <option>Office</option>
              <option>Retail</option>
              <option>Multifamily</option>
              <option>Land</option>
              <option>Residential</option>
            </select>
          </div>
        </div>
        <div class="rd-row grid grid-cols-1 sm:grid-cols-[1fr_1fr_1.4fr]">
          <div class="rd-cell">
            <label class="rd-lab" for="lookback">Lookback</label>
            <select id="lookback" class="rd-in">
              <option value="6">Last 6 months</option>
              <option value="12">Last 12 months</option>
              <option value="24" selected>Last 24 months</option>
              <option value="36">Last 36 months</option>
              <option value="custom">Custom…</option>
            </select>
            <div id="lookbackCustomWrap" class="hidden mt-2 flex items-center gap-2">
              <input id="lookbackCustom" type="number" min="1" max="120" step="1" placeholder="e.g. 18" class="w-24 rounded border border-slate-300 px-2 py-1 text-sm text-[#1A2433] focus:border-[#B91C1C] focus:ring-1 focus:ring-[#B91C1C] outline-none" />
              <span class="text-sm text-slate-500 shrink-0">months</span>
            </div>
          </div>
          <div class="rd-cell" id="txFocusWrap">
            <label class="rd-lab" for="txFocus">Focus</label>
            <select id="txFocus" class="rd-in">
              <option value="both" selected>Sales &amp; leases</option>
              <option value="sales">Sales only</option>
              <option value="leases">Leases only</option>
            </select>
          </div>
          <div class="rd-cell">
            <label class="rd-lab" for="marketNote">Market note <span style="text-transform:none;letter-spacing:0;font-weight:400">(optional)</span></label>
            <input id="marketNote" type="text" placeholder="e.g. within 5 miles, submarket: North Dallas" class="rd-in" />
          </div>
        </div>

        <!-- Subject property (optional; size auto-pulled from public records when blank) -->
        <details id="subjectDetails" class="rd-row group">
          <summary class="cursor-pointer select-none px-4 py-3 text-sm font-medium text-[#5A6473] hover:text-[#1A2433]">
            <span id="subjectSummary">+ Your property details <span class="text-[#8A93A0] font-normal">(size, price, NOI — optional, sharpens the estimate)</span></span>
          </summary>
          <div class="px-4 pb-4 pt-1">
            <p id="subjectHint" class="text-xs text-[#8A93A0] mb-3">Size is pulled from public records automatically when left blank; enter it to override. Add a price to compare against the comp average, or NOI for an income-approach cross-check.</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label id="targetSizeLabel" class="rd-lab">Building size (SF)</label>
                <div class="flex items-center gap-2">
                  <input id="targetSize" type="number" min="0" step="any" placeholder="e.g. 25000" class="w-full min-w-0 rounded border border-slate-300 px-2.5 py-1.5 text-sm text-[#1A2433] focus:border-[#B91C1C] focus:ring-1 focus:ring-[#B91C1C] outline-none" />
                  <span class="text-sm text-slate-400 shrink-0">to</span>
                  <input id="targetSizeMax" type="number" min="0" step="any" placeholder="max (optional)" class="w-full min-w-0 rounded border border-slate-300 px-2.5 py-1.5 text-sm text-[#1A2433] focus:border-[#B91C1C] focus:ring-1 focus:ring-[#B91C1C] outline-none" />
                </div>
              </div>
              <div>
                <label id="targetPriceLabel" class="rd-lab">Asking / expected price ($)</label>
                <div class="flex items-center gap-2">
                  <input id="targetPrice" type="number" min="0" step="any" placeholder="e.g. 3125000" class="w-full min-w-0 rounded border border-slate-300 px-2.5 py-1.5 text-sm text-[#1A2433] focus:border-[#B91C1C] focus:ring-1 focus:ring-[#B91C1C] outline-none" />
                  <span class="text-sm text-slate-400 shrink-0">to</span>
                  <input id="targetPriceMax" type="number" min="0" step="any" placeholder="max (optional)" class="w-full min-w-0 rounded border border-slate-300 px-2.5 py-1.5 text-sm text-[#1A2433] focus:border-[#B91C1C] focus:ring-1 focus:ring-[#B91C1C] outline-none" />
                </div>
              </div>
              <div id="noiWrap">
                <label class="rd-lab" for="noi">Net operating income ($/yr)</label>
                <input id="noi" type="number" min="0" step="any" placeholder="e.g. 210000" class="w-full min-w-0 rounded border border-slate-300 px-2.5 py-1.5 text-sm text-[#1A2433] focus:border-[#B91C1C] focus:ring-1 focus:ring-[#B91C1C] outline-none" />
                <p class="text-xs text-[#8A93A0] mt-1">Used only in your browser for the income-approach estimate. Never sent to our server.</p>
              </div>
            </div>
          </div>
        </details>

        <!-- Submit row; docks to the bottom of the screen on phones -->
        <div class="sticky bottom-0 px-4 py-3.5 bg-white rounded-b-md border-t border-[#ECEAE3] flex flex-col sm:flex-row sm:items-center gap-3 sm:static">
          <button id="submitBtn" type="submit"
            class="btn-live w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#B91C1C] hover:bg-[#991B1B] text-white font-semibold px-7 py-2.5 rounded disabled:opacity-60 disabled:cursor-not-allowed">
            <span id="btnLabel">Run a report</span>
          </button>
          <button id="sampleBtn" type="button"
            class="btn-live w-full sm:w-auto inline-flex items-center justify-center text-sm font-medium text-[#5A6473] hover:text-[#1A2433] px-3 py-2.5">
            View a sample report
          </button>
          <span class="sm:ml-auto text-[12.5px] text-[#8A8577]">Free · No account required · An automated estimate, not an appraisal</span>
        </div>
      </form>
    </div>
```

Note: the old container opened `<div class="max-w-7xl mx-auto px-4 pb-8">` at line 557 — the replacement above opens `max-w-5xl` instead; do NOT close it here (recent chips, status, loading, results, homeInfo all stay inside it; its closing `</div>` at line ~1131 stays).

- [ ] **Step 2: Update `btnLabel` JS strings if any reset to "Generate Report".** Grep `Generate Report` in index.html; every occurrence in JS (e.g. restoring the button after a search) must become `Run a report`.

- [ ] **Step 3: Verify.** Reload preview. `read_page`: header nav present, one submit button labeled "Run a report", form fields all present. `read_console_messages` → no errors. Run a real search (sample button) → report renders. Check `#owner` deep link: navigate to `/#owner` → `subjectDetails` opens (JS uses that id). Mobile check: `resize_window` 375px → form cells stack, submit row docks.

- [ ] **Step 4: Commit.**

```bash
git add index.html tailwind.css
git commit -m "Landing redesign 3/6: light header + serif hero + form-as-unit, single Run-a-report CTA"
```

---

### Task 4: homeInfo sections — stat strip, exhibit, method, broker cards, markets, FAQ restyle

**Files:**
- Modify: `index.html:987-1129` (`#homeInfo` contents)

All sections stay inside `<div id="homeInfo" class="no-print">` (JS hides it when a report is shown). Keep the `reveal` class on each section (scroll-reveal JS stays).

- [ ] **Step 1: Replace the trust strip (lines ~990-1013)** with the stat strip:

```html
      <!-- Stat strip: true claims only — keep "27" in sync with market-seed.json -->
      <div class="mt-12 reveal border-y rd-hairline grid grid-cols-2 sm:grid-cols-4">
        <div class="rd-stat p-4 sm:p-5 border-r rd-hairline"><div class="n">27</div><div class="l">Markets covered</div></div>
        <div class="rd-stat p-4 sm:p-5 sm:border-r rd-hairline"><div class="n">3–6</div><div class="l">Cited comps per report</div></div>
        <div class="rd-stat p-4 sm:p-5 border-r rd-hairline"><div class="n">~60s</div><div class="l">Search to report</div></div>
        <div class="rd-stat p-4 sm:p-5"><div class="n">100%</div><div class="l">Sources disclosed</div></div>
      </div>
```

- [ ] **Step 2: Replace "What you get" (lines ~1046-1080)** with the Report exhibit (static sample; clearly captioned):

```html
      <!-- The Report — sample exhibit -->
      <section class="mt-14 reveal">
        <div class="rd-kicker">The Report</div>
        <h2 class="rd-h text-[27px] mt-2">One page that answers, then proves.</h2>
        <p class="text-sm text-[#4C5665] mt-1 mb-5 max-w-[60ch]">A value range for the subject, what's driving prices in the market, and the comp table behind both — with a confidence badge on every source.</p>
        <div class="rd-exhibit">
          <div class="rd-cap flex justify-between"><span>Sample report · Industrial · Rancho Cucamonga, CA</span><span class="hidden sm:inline">Exported Jul 2026</span></div>
          <div class="flex flex-col lg:flex-row">
            <div class="p-6 lg:border-r border-b lg:border-b-0 border-[#ECEAE3] lg:w-[38%]">
              <div class="rd-lab">Estimated value</div>
              <div class="rd-h text-[32px] mt-0.5" style="font-variant-numeric:tabular-nums">$4.6M–$5.3M</div>
              <div class="text-[13px] text-[#5A6473] mb-4">$212–$245 / SF · 21,600 SF (public record)</div>
              <div class="rd-lab mb-1">What's driving prices</div>
              <div class="rd-drv"><b>▲</b> Inland Empire vacancy tightening near the I-15 corridor</div>
              <div class="rd-drv"><b>▲</b> Sub-25K SF buildings trade at a premium — scarce supply</div>
              <div class="rd-drv"><b>–</b> Rate environment holding cap rates near 5.9–6.4%</div>
            </div>
            <div class="p-6 flex-1 overflow-x-auto">
              <table class="rd-comps">
                <thead><tr><th>Address</th><th>Sold</th><th>SF</th><th>$/SF</th><th>Source</th></tr></thead>
                <tbody>
                  <tr><td>9020 Center Ave</td><td>May 26</td><td>21,400</td><td>$238</td><td><span class="rd-badge v">Verified · via Lee &amp; Assoc.</span></td></tr>
                  <tr><td>11215 4th St</td><td>Mar 26</td><td>18,750</td><td>$226</td><td><span class="rd-badge p">Public record</span></td></tr>
                  <tr><td>8933 Utica Ave</td><td>Feb 26</td><td>24,100</td><td>$219</td><td><span class="rd-badge li">Listing</span></td></tr>
                  <tr><td>10722 Arrow Route</td><td>Dec 25</td><td>19,900</td><td>$214</td><td><span class="rd-badge p">Public record</span></td></tr>
                  <tr><td>12190 6th St</td><td>Nov 25</td><td>26,300</td><td>$208</td><td><span class="rd-badge li">Listing</span></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-[13px] text-[#4C5665]">
          <span class="flex items-center gap-2"><span class="rd-badge v">Verified</span> confirmed by a local broker</span>
          <span class="flex items-center gap-2"><span class="rd-badge p">Public record</span> county recorder / assessor</span>
          <span class="flex items-center gap-2"><span class="rd-badge li">Listing</span> active or closed listing</span>
          <span class="text-[#8A93A0]">Badges under-claim, never over-claim.</span>
        </div>
      </section>
```

- [ ] **Step 3: Replace "How it works" (lines ~1016-1043)** with Method (keep `id="how-it-works"` on the section — the footer scroll link uses it; also add `id="method"` for the header nav):

```html
      <!-- Method -->
      <section id="how-it-works" class="mt-14 reveal"><span id="method"></span>
        <div class="rd-kicker">Method</div>
        <h2 class="rd-h text-[27px] mt-2 mb-5">How a report comes together.</h2>
        <div class="rd-steps grid grid-cols-1 sm:grid-cols-3">
          <div class="rd-step"><div class="rd-num">I.</div><h3 class="font-semibold text-[15px] text-[#1A2433] mb-1.5">Search live</h3><p class="text-[13.5px] text-[#5A6473]">Public records, listings, and news are searched at request time — not read from a stale database.</p></div>
          <div class="rd-step"><div class="rd-num">II.</div><h3 class="font-semibold text-[15px] text-[#1A2433] mb-1.5">Cite everything</h3><p class="text-[13.5px] text-[#5A6473]">Each comp carries its source and a confidence badge. Unknown provenance is labeled an estimate, never dressed up.</p></div>
          <div class="rd-step"><div class="rd-num">III.</div><h3 class="font-semibold text-[15px] text-[#1A2433] mb-1.5">Value the subject</h3><p class="text-[13.5px] text-[#5A6473]">Building size comes from public records; the range comes from sale comps. Your price and NOI stay in your browser.</p></div>
        </div>
      </section>
```

- [ ] **Step 4: Replace the broker gradient banner (lines ~1082-1095)** with the two-card section (keep `brokerCtaBtn` id — JS opens the submission modal):

```html
      <!-- For Brokers -->
      <section id="for-brokers" class="mt-14 reveal">
        <div class="rd-kicker">For Brokers</div>
        <h2 class="rd-h text-[27px] mt-2 mb-5">The comps get better because brokers make them better.</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div class="rd-bcard">
            <div class="rd-lab">Contribute</div>
            <h3 class="rd-h text-[19px] mt-1.5 mb-2">Submit a comp, get the credit.</h3>
            <p class="text-sm text-[#4C5665] mb-4">Approved comps appear with a green Verified badge and your firm's name on every report that uses them — visible proof you know your market.</p>
            <button id="brokerCtaBtn" type="button" class="btn-live text-[13.5px] font-semibold text-[#B91C1C] hover:text-[#991B1B]">Submit a comp →</button>
          </div>
          <div class="rd-bcard">
            <div class="rd-lab">Connect</div>
            <h3 class="rd-h text-[19px] mt-1.5 mb-2">Meet owners already asking about value.</h3>
            <p class="text-sm text-[#4C5665] mb-4">Owners requesting a Broker Opinion of Value are matched with brokers active in that market. No cold lists — people mid-decision.</p>
            <a href="mailto:agouraninja@gmail.com?subject=Broker%20introduction%20—%20CompNinja" class="text-[13.5px] font-semibold text-[#B91C1C] hover:text-[#991B1B]">Get introduced →</a>
          </div>
        </div>
      </section>

      <!-- Markets -->
      <section class="mt-14 reveal">
        <div class="rd-kicker">Coverage</div>
        <h2 class="rd-h text-[27px] mt-2 mb-5">Market pages, updated as reports run.</h2>
        <div class="columns-2 sm:columns-4 gap-8 text-[13.5px] leading-8 text-[#46536A]">
          <a href="/market/industrial-ontario-ca" class="block hover:text-[#1A2433]">Industrial · Ontario, CA</a>
          <a href="/market/industrial-fontana-ca" class="block hover:text-[#1A2433]">Industrial · Fontana, CA</a>
          <a href="/market/industrial-dallas-tx" class="block hover:text-[#1A2433]">Industrial · Dallas, TX</a>
          <a href="/market/industrial-phoenix-az" class="block hover:text-[#1A2433]">Industrial · Phoenix, AZ</a>
          <a href="/market/industrial-las-vegas-nv" class="block hover:text-[#1A2433]">Industrial · Las Vegas, NV</a>
          <a href="/market/office-austin-tx" class="block hover:text-[#1A2433]">Office · Austin, TX</a>
          <a href="/market/office-nashville-tn" class="block hover:text-[#1A2433]">Office · Nashville, TN</a>
          <a href="/market/office-denver-co" class="block hover:text-[#1A2433]">Office · Denver, CO</a>
          <a href="/market/industrial-savannah-ga" class="block hover:text-[#1A2433]">Industrial · Savannah, GA</a>
          <a href="/market/multifamily-atlanta-ga" class="block hover:text-[#1A2433]">Multifamily · Atlanta, GA</a>
          <a href="/market/retail-orlando-fl" class="block hover:text-[#1A2433]">Retail · Orlando, FL</a>
          <a href="/markets" class="block font-semibold text-[#B91C1C] hover:text-[#991B1B]">All 27 markets →</a>
        </div>
      </section>
```

- [ ] **Step 5: FAQ restyle (lines ~1098-1128).** Keep every `<details>` and its copy verbatim (it mirrors the FAQPage JSON-LD). Only restyle the section header to match:

```html
        <div class="rd-kicker">Questions</div>
        <h2 class="rd-h text-[27px] mt-2 mb-5">FAQ</h2>
```

(delete the old eyebrow div, `text-2xl font-bold` h2, and the "Quick answers…" p). On each `details`, swap `rounded-xl shadow-sm border border-slate-200` for `rounded-md border border-[#D8D4C9]`.

- [ ] **Step 6: Verify + commit.** Reload; `read_page` shows all five sections; `brokerCtaBtn` opens the comp-submission modal; market links navigate; footer `data-scroll-to="how-it-works"` still scrolls.

```bash
git add index.html tailwind.css
git commit -m "Landing redesign 4/6: stat strip, report exhibit, method, broker cards, markets"
```

---

### Task 5: Footer rebuild

**Files:**
- Modify: `index.html:1133-1171`

- [ ] **Step 1: Replace the footer** with:

```html
  <!-- Site footer — navy ink, plain-English disclosure -->
  <footer class="mt-14 no-print" style="background:#1A2433">
    <div class="max-w-5xl mx-auto px-4 py-10 text-[13px] text-[#B8C0CC]">
      <div class="flex flex-col sm:flex-row justify-between gap-8">
        <div class="max-w-[68ch]">
          <div class="flex items-center gap-2.5">
            <svg class="h-6 w-6 shrink-0" viewBox="0 0 30 30" aria-hidden="true">
              <rect x="2" y="4" width="26" height="22" rx="2" fill="#FFFFFF"/>
              <polygon points="2,26 28,4 28,10 8,26" fill="#B91C1C"/>
            </svg>
            <span class="rd-wordmark uppercase" style="color:#fff">COMP<b>NINJA</b></span>
          </div>
          <p class="mt-3 leading-relaxed text-[#8F99A8]">Every valuation is an automated estimate, not an appraisal. CompNinja is not a licensed brokerage — we connect you with local brokers for opinions of value. Comparables derive from publicly available data; verify independently before underwriting.</p>
          <p class="mt-3 text-[#8F99A8]">© 2026 CompNinja</p>
        </div>
        <div class="sm:text-right shrink-0">
          <a href="mailto:agouraninja@gmail.com" class="text-[#D5DAE2] hover:text-white underline decoration-[#46536A]">agouraninja@gmail.com</a>
          <ul class="mt-3 space-y-2">
            <li><a href="/markets" class="hover:text-white">Markets</a></li>
            <li><button type="button" data-scroll-to="how-it-works" class="hover:text-white">How it works</button></li>
            <li><button type="button" data-scroll-to="faq" class="hover:text-white">FAQ</button></li>
            <li><button type="button" id="footerSubmitComp" class="hover:text-white">Submit a comp (brokers)</button></li>
          </ul>
        </div>
      </div>
    </div>
  </footer>
```

(Keeps `footerSubmitComp` and both `data-scroll-to` hooks.)

- [ ] **Step 2: Verify + commit.** Footer renders navy; links/buttons work; no `viewBox="0 0 44 44"` matches remain anywhere in the file.

```bash
git add index.html tailwind.css
git commit -m "Landing redesign 5/6: navy footer with plain-English disclosure"
```

---

### Task 6: Remove the skyline-ninja JS + final sweep

**Files:**
- Modify: `index.html:2556-2679` (easter-egg block; line numbers will have shifted — locate by the comment `// Easter egg: the skyline ninja`)

- [ ] **Step 1: Delete the whole block** from the comment `// Easter egg: the skyline ninja parkours…` through the closing `}` of `if (ninjaEl) { … }` (ends just before `function renderTableHead()`).

- [ ] **Step 2: Sweep.** Grep index.html for `skylineNinja`, `skyline-ninja`, `hero-glow`, `brandDrift`, `Oswald` → 0 matches each. Grep `font-brand` → only the CSS definition and report-body headings remain (expected). Grep `Generate Report` → 0 matches.

- [ ] **Step 3: Full verification pass (per spec):**
  - Search end-to-end (Industrial + one other type) → report renders, badges show.
  - Exports: CSV downloads; Print preview shows letterhead with new mark; (PNG export can't render in the embedded pane — skip, known quirk).
  - `subjectDetails` expander, `#owner` deep link, `/r/<id>` shared view, saved-report chips.
  - 375px pass; `read_console_messages` clean; `preview_logs` clean.
  - Confirm the tailwind hook regenerated `tailwind.css` (git status shows it modified alongside index.html; if not, classes like `bg-[#FBFBF9]` won't style — investigate the hook before committing).

- [ ] **Step 4: Commit.**

```bash
git add index.html tailwind.css
git commit -m "Landing redesign 6/6: retire skyline-ninja easter egg, final sweep"
```

---

## Self-review notes

- **Spec coverage:** header/hero/form (Task 3), stat strip + exhibit + method + brokers + markets + FAQ (Task 4), footer (Task 5), logo/favicon sitewide (Task 2), CSS tokens + easter-egg removal (Tasks 1, 6). Print letterhead covered (Task 2). Market pages intentionally untouched (spec: out of scope).
- **Risky seams called out:** the container div swap in Task 3 (open tag changes, close tag stays), `btnLabel` reset strings (Task 3 Step 2), `how-it-works`/`faq` scroll anchors, `brokerCtaBtn`/`footerSubmitComp` ids, sticky mobile submit row.
- **`sampleBtn` behavior unchanged** — verify it still points at the sample-report JS after Task 3.
