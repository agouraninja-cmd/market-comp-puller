# Market Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corpus-driven trend lines + live stats + a quarterly block on the market pages, and a direction suffix on the watchlist feed's median line.

**Architecture:** One in-process `MARKET_INTEL` cache (MARKET_CREDIT pattern, 10-min stale-while-revalidate, single 5000-row corpus query) feeds pure helpers (`parseDealDate`, `saleRowsWithDates`, `halfYearBuckets`, `medianPsfOf`) used by both `renderMarketPageHTML` and the feed route so they can't drift. Trends key on parsed DEAL dates (harvest ts is 2 days old). Spec: `docs/superpowers/specs/2026-07-19-market-intelligence-design.md`.

**Tech Stack:** server.js only for Tasks 1-2 (self-contained SSR pages, inline SVG, no libs); index.html gets ~10 lines in Task 3. No DDL, no new routes.

**Verified anchors (2026-07-19):** `renderMarketPageHTML` server.js:1775 (consts `tiles`/`drivers` :1783-1795, `compsTable` :1797-1806 — the intel card slots between `drivers` and `compsTable` in the body assembly; find the body template concatenation below the JSON-LD with `grep -n 'drivers' server.js` inside the function); feed median block :2716-2726; `MARKET_CREDIT` cache ~:1720s (place `MARKET_INTEL` after it); `corpusNum` exists (broker build); seeded page comps use field **`date`**, corpus rows use **`deal_date`**; `server.listen` warm-ups near the bottom (`refreshMarketCredit(); refreshBrokerProfiles();`).

---

### Task 1: parseDealDate + intel helpers + MARKET_INTEL cache (server.js)

**Files:** Modify `server.js` — insert the whole block after `refreshMarketCredit`'s closing brace, before the broker-profiles section.

- [ ] **Step 1: Insert:**

```js
// ---------------------------------------------------------------------------
// Market intelligence — the corpus as visible data. Trends key on parsed DEAL
// dates (harvesting only began 2026-07-17, so harvest ts can't draw a trend);
// unparseable dates drop out of trends but stay in counts. Cached in-process
// like MARKET_CREDIT: one corpus query per TTL, no per-request DB reads.
// ---------------------------------------------------------------------------
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
// Sale rows with a parseable date and numeric $/SF — the trendable subset.
function saleRowsWithDates(rows) {
  return (rows || [])
    .filter((r) => String(r.transaction || "").toLowerCase().startsWith("sale"))
    .map((r) => ({ yearFrac: parseDealDate(r.deal_date), psf: corpusNum(r.price_per_sqft), dealText: String(r.deal_date || "") }))
    .filter((r) => r.yearFrac != null && r.psf > 0);
}
function medianPsfOf(nums) { // upper-middle, matching the feed's formula
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100;
}
function halfYearBuckets(dated) {
  const by = {};
  dated.forEach((d) => {
    const y = Math.floor(d.yearFrac);
    const k = `${y} ${d.yearFrac - y < 0.5 ? "H1" : "H2"}`;
    (by[k] = by[k] || []).push(d.psf);
  });
  return Object.keys(by).sort().map((k) => ({ label: k, count: by[k].length, medianPsf: medianPsfOf(by[k]) }));
}

const MARKET_INTEL = { byKey: {}, fetchedAt: 0, refreshing: false };
const MARKET_INTEL_TTL_MS = 10 * 60 * 1000;
async function refreshMarketIntel() {
  if (MARKET_INTEL.refreshing) return;
  MARKET_INTEL.refreshing = true;
  try {
    let rows = [];
    if (DB_CONFIGURED) {
      // 5000-row headroom note: revisit when the corpus approaches it.
      rows = await sbRequest("GET",
        "comp_corpus?select=market,property_type,address,transaction,deal_date,price_per_sqft,ts&order=ts.desc&limit=5000") || [];
    } else {
      rows = await readRowsFromFile(COMP_CORPUS_FILE);
    }
    const byKey = {};
    for (const r of rows) {
      const k = `${String(r.market || "").toLowerCase()}|${r.property_type || ""}`;
      (byKey[k] = byKey[k] || []).push({
        address: r.address, transaction: r.transaction, deal_date: r.deal_date,
        price_per_sqft: r.price_per_sqft, ts: r.ts,
      });
    }
    MARKET_INTEL.byKey = byKey;
    MARKET_INTEL.fetchedAt = Date.now();
  } catch (err) {
    console.error("Market intel refresh failed; keeping previous:", err.message);
  } finally {
    MARKET_INTEL.refreshing = false;
  }
}
// Stale-while-revalidate accessor — callers get the current cache instantly.
function marketIntelRows(market, propertyType) {
  if (Date.now() - MARKET_INTEL.fetchedAt > MARKET_INTEL_TTL_MS) refreshMarketIntel();
  return MARKET_INTEL.byKey[`${String(market).toLowerCase()}|${propertyType}`] || [];
}
```

- [ ] **Step 2:** Warm at `server.listen`: add `refreshMarketIntel();  // warm the corpus-intelligence cache (market pages + feed)` next to `refreshBrokerProfiles();`.
- [ ] **Step 3:** `node --check server.js` → exit 0. Standalone parse check (paste `MONTHS_IDX` + `parseDealDate` into `node -e`): `2025`→2025.5; `Q1 2025`→2025.125; `q3 2026`→2026.625; `Apr 2026`→≈2026.29; `April 2026` same; `04/2026` same; `2026-04-15` same; `soon`/``/`13/2026`/`Q5 2025`→null.
- [ ] **Step 4:** Commit: `git add server.js && git commit -m "Add corpus market-intelligence layer: deal-date parser, trend helpers, MARKET_INTEL cache"`

### Task 2: Market Intelligence card on market pages (server.js)

**Files:** Modify `server.js` — inside `renderMarketPageHTML` (:1775): new `intelCard` const after `drivers` (:1795), inserted into the body between `${drivers}` and `${compsTable}`.

- [ ] **Step 1: Insert after the `drivers` const:**

```js
  // Market intelligence — the live corpus view (plus this page's own seeded
  // comps, deduped). Under-claim rule: a trend renders only with >=6 dated
  // sale comps across >=2 half-years; thin markets get the tracking line.
  const normAddr = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const corpusRows = marketIntelRows(`${p.city}, ${p.state}`, p.type);
  const seenKeys = new Set(corpusRows.map((r) => `${normAddr(r.address)}|${String(r.deal_date || "").toLowerCase()}`));
  const mergedRows = [
    ...corpusRows,
    ...(p.comps || [])
      .filter((c) => !seenKeys.has(`${normAddr(c.address)}|${String(c.date || "").toLowerCase()}`))
      .map((c) => ({ address: c.address, transaction: c.transaction, deal_date: c.date, price_per_sqft: c.price_per_sqft, ts: null })),
  ];
  const dated = saleRowsWithDates(mergedRows);
  const buckets = halfYearBuckets(dated).slice(-6); // label crowding cap
  let trendSvg = "";
  if (dated.length >= 6 && buckets.length >= 2) {
    const w = 640, hgt = 120, pad = 34;
    const meds = buckets.map((b) => b.medianPsf);
    const lo = Math.min(...meds), hi = Math.max(...meds);
    const x = (i) => pad + (i * (w - 2 * pad)) / Math.max(1, buckets.length - 1);
    const y = (v) => (hi === lo ? hgt / 2 : hgt - pad - ((v - lo) * (hgt - 2 * pad)) / (hi - lo));
    const pts = buckets.map((b, i) => `${Math.round(x(i))},${Math.round(y(b.medianPsf))}`).join(" ");
    trendSvg =
      `<svg viewBox="0 0 ${w} ${hgt + 30}" style="width:100%;height:auto;margin-top:6px" role="img" aria-label="Median price per square foot by half-year">` +
      `<polyline fill="none" stroke="#0f172a" stroke-width="2" points="${pts}"/>` +
      buckets.map((b, i) => {
        const cx = Math.round(x(i)), cy = Math.round(y(b.medianPsf));
        return `<circle cx="${cx}" cy="${cy}" r="4" fill="${i === buckets.length - 1 ? "#b91c1c" : "#0f172a"}"/>` +
          `<text x="${cx}" y="${cy - 10}" text-anchor="middle" font-size="12" font-weight="600" fill="#0f172a">${usd0(b.medianPsf)}</text>` +
          `<text x="${cx}" y="${hgt + 18}" text-anchor="middle" font-size="11" fill="#64748b">${escHtml(b.label)} &middot; ${b.count}</text>`;
      }).join("") +
      `</svg>`;
  }
  const nowD = new Date();
  const nowFrac = nowD.getFullYear() + (nowD.getMonth() + 0.5) / 12;
  const last12 = dated.filter((d) => nowFrac - d.yearFrac <= 1.0).map((d) => d.psf);
  const median12 = last12.length >= 3 ? medianPsfOf(last12) : null;
  const tsList = corpusRows.map((r) => Date.parse(r.ts)).filter((n) => n > 0);
  const since = tsList.length ? new Date(Math.min(...tsList)) : null;
  const latestDeal = dated.length ? dated.reduce((a, b) => (a.yearFrac >= b.yearFrac ? a : b)).dealText : null;
  const statsBits = [
    since ? `Tracking this market since ${since.toLocaleString("en-US", { month: "short", year: "numeric" })}` : `Tracking this market`,
    `${mergedRows.length} comp${mergedRows.length === 1 ? "" : "s"}`,
    median12 ? `12-month median ${usd0(median12)}/SF` : null,
    latestDeal ? `latest deal ${escHtml(latestDeal)}` : null,
  ].filter(Boolean).join(" &middot; ");
  const qNum = Math.floor(nowD.getMonth() / 3) + 1;
  const qStartTs = new Date(nowD.getFullYear(), (qNum - 1) * 3, 1).getTime();
  const addedThisQ = corpusRows.filter((r) => Date.parse(r.ts) >= qStartTs).length;
  const qLo = nowD.getFullYear() + ((qNum - 1) * 3) / 12, qHi = nowD.getFullYear() + (qNum * 3) / 12;
  const pLo = qNum === 1 ? nowD.getFullYear() - 1 + 0.75 : nowD.getFullYear() + ((qNum - 2) * 3) / 12;
  const pHi = qLo;
  const curQ = dated.filter((d) => d.yearFrac >= qLo && d.yearFrac < qHi).map((d) => d.psf);
  const priQ = dated.filter((d) => d.yearFrac >= pLo && d.yearFrac < pHi).map((d) => d.psf);
  const priorQLabel = qNum === 1 ? `Q4 ${nowD.getFullYear() - 1}` : `Q${qNum - 1}`;
  const quarterBits = [
    `${addedThisQ} comp${addedThisQ === 1 ? "" : "s"} added to our corpus in Q${qNum} ${nowD.getFullYear()}`,
    curQ.length >= 3 && priQ.length >= 3
      ? `deals closed in Q${qNum}: median ${usd0(medianPsfOf(curQ))}/SF ${medianPsfOf(curQ) >= medianPsfOf(priQ) ? "&#9650;" : "&#9660;"} vs ${usd0(medianPsfOf(priQ))} in ${priorQLabel}`
      : null,
  ].filter(Boolean).join(" &middot; ");
  const intelCard =
    `<div class="card"><h2>Market intelligence</h2>` +
    trendSvg +
    `<p${trendSvg ? ' style="margin-top:10px"' : ""}>${statsBits}.</p>` +
    `<p class="disc" style="margin-top:6px">This quarter: ${quarterBits}. Trend medians use closed-deal dates from our growing comp corpus; automated estimates, not an appraisal.</p>` +
    `</div>`;
```

- [ ] **Step 2:** Find the body assembly inside the function (the template string concatenating `${drivers}` and `${compsTable}`) and insert `${intelCard}` between them.
- [ ] **Step 3:** Verify locally: `node --check`; seed `comp-corpus.jsonl` with 7 dated Ontario, CA Industrial sale rows across "2025"/"Q1 2025"/"H2-style months 2025"/"Mar 2026"-type dates (≥3 within the last 12 months; hand-compute the expected bucket medians) + 2 rows for a thin market ("Boise, ID" Office); restart; `curl -s localhost:3000/market/industrial-ontario-ca` → contains `<svg`, the hand-checked bucket medians, the tracking line, and the quarter line ("N comps added"); a thin/zero-corpus market page (e.g. another seeded slug) → NO `<svg`, stats line present (seeded comps still count via the merge). Check escaping: no raw `<` from data in the card.
- [ ] **Step 4:** Commit: `git add server.js && git commit -m "Add Market Intelligence card to market pages: deal-date trend SVG, live stats, quarter block"`

### Task 3: Watchlist feed direction (server.js + index.html)

**Files:** Modify `server.js` feed route (:2716-2726 median block) and `index.html` `renderWatchFeed` (median span builder).

- [ ] **Step 1 (server):** after the existing `median_psf` computation, add:

```js
        // Direction: deal-date medians, last 6 months vs the 6 before —
        // >=3 comps each side or the field is omitted entirely.
        const datedSales = saleRowsWithDates(rows);
        const nowFrac = new Date().getFullYear() + (new Date().getMonth() + 0.5) / 12;
        const curWin = datedSales.filter((d) => nowFrac - d.yearFrac <= 0.5).map((d) => d.psf);
        const priWin = datedSales.filter((d) => nowFrac - d.yearFrac > 0.5 && nowFrac - d.yearFrac <= 1.0).map((d) => d.psf);
        const median_trend = curWin.length >= 3 && priWin.length >= 3
          ? { current: medianPsfOf(curWin), prior: medianPsfOf(priWin) } : null;
```

and in the `out.push({...})` object add `...(median_trend ? { median_trend } : {}),`.

- [ ] **Step 2 (index.html):** in `renderWatchFeed`, where the median span is appended (`if (w.median_psf) { ... right.appendChild(m); }`), add after it:

```js
      if (w.median_trend) {
        const up = w.median_trend.current >= w.median_trend.prior;
        const t = document.createElement("span");
        t.className = up ? "text-[#06603A]" : "text-[#8A6D1A]";
        t.textContent = `${up ? "▲" : "▼"} from $${w.median_trend.prior} (deals 6–12 mo ago)`;
        right.insertBefore(t, un);
      }
```

(`un` is the Unwatch button created just below — move the trend insert AFTER `un` is created, using `right.insertBefore(t, un)` so the order is median · trend · Unwatch.)

- [ ] **Step 3:** Verify: with the Task-2 Ontario seeds shaped so both 6-mo windows have ≥3 sale comps, signed-in feed (qa@example.com watches Ontario, CA Industrial) shows the arrow with hand-checked medians; flip the seed dates to invert direction → arrow flips + amber class; reduce a window below 3 → suffix absent, box identical to today. `node --check` + browser console clean.
- [ ] **Step 4:** Commit: `git add server.js index.html tailwind.css && git commit -m "Watchlist feed medians gain deal-date direction (last 6 months vs prior 6)"`

### Task 4: QA + deploy

- [ ] Remove all seed rows from `comp-corpus.jsonl` (restore pre-task content); full local sweep (market pages rich/thin/zero, feed with/without trend, console clean, zero billed searches); `git status` clean.
- [ ] Push `origin/main` → Render. Prod checks: a live market page (e.g. `/market/industrial-ontario-ca`) contains "Tracking this market since" + the quarter collection line (trend SVG only if prod corpus is already rich enough — degraded state expected); feed for a thin watched market unchanged; zero errors in Render logs surface (page 200s).
- [ ] Update `ecosystem-roadmap` memory (direction 4 shipped; roadmap's four directions complete) and report.

## Self-review

Spec coverage: parser+helpers+cache (T1), page card incl. seeded-comp merge/dedupe/SVG/stats/quarter two-axis (T2), feed field + UI suffix (T3), degradation + cleanup + prod (T4/inline). Placeholders: none. Consistency: `saleRowsWithDates` returns `{yearFrac, psf, dealText}` — used in T2 (dealText for "latest deal") and T3 (psf windows); `medianPsfOf` shared; seeded `date` vs corpus `deal_date` mapping handled at the merge point; `usd0` and `escHtml` are existing market-page helpers.
