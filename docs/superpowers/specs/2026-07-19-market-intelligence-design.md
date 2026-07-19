# Market Intelligence (Ecosystem direction #4) — Design

Date: 2026-07-19
Status: approved by owner (this doc records the design conversation)

## Goal

Turn the comp corpus (harvesting since 2026-07-17) into visible market
intelligence: trend lines and live stats on the programmatic-SEO market
pages, an on-page quarterly recap, and trend direction in the watchlist
feed. The corpus becomes a moat users can see compounding.

## Ground truth that shaped the design

- Corpus rows carry freeform `deal_date` strings; the observed formats are
  100% parseable ("2025", "Q1 2025", "Apr 2026"; ISO and MM/YYYY also
  handled). Harvest `ts` is useless for trends (collection started
  2026-07-17) — **trends key on parsed deal dates**, which already span
  18+ months.
- Most markets are thin today. Honest degradation is a feature: thin
  markets show a "tracking since …" stats line, never a fake trend.

## Decisions already made (owner-approved)

- Quarterly digest = an **on-page block** ("This quarter in <market>") on
  the existing market pages. No standalone digest URLs (revisit at 2+ real
  quarters of corpus depth), no email anything.
- Watchlist feed **does** gain a direction suffix on its median line.
- No DDL, no new routes; the feed response gains one optional field.

## 1. Corpus-intelligence layer (server.js)

- `parseDealDate(s)` → fractional year (e.g. 2025.42) or null. Formats:
  `YYYY` (mid-year), `Q[1-4] YYYY` (quarter midpoint), `Mon(th) YYYY`
  (3-letter or full month names), `MM/YYYY`, ISO `YYYY-MM(-DD)`.
  Case-insensitive, tolerant of surrounding whitespace. Null for anything
  else — unparseable comps drop out of trends but stay in counts.
- `MARKET_INTEL` cache, cloned from the `MARKET_CREDIT` pattern:
  `{ byKey: {}, fetchedAt: 0, refreshing: false }`, 10-min TTL,
  stale-while-revalidate (kicked from the market-page route, the feed
  route, and warmed at `server.listen`). One query per refresh:
  `comp_corpus` select `market, property_type, transaction, deal_date,
  price_per_sqft, ts` order `ts.desc` limit 5000 (headroom note: revisit
  when the corpus approaches that; file fallback reads
  `comp-corpus.jsonl`). Grouped into slim row arrays under
  `"<market lowercase>|<property_type>"` keys.
- Pure helpers over a row array (used by pages AND feed so they can't
  drift):
  - `saleRowsWithDates(rows)` → `{yearFrac, psf}` list (sale transactions,
    numeric psf, parseable date).
  - `halfYearBuckets(datedRows)` → ordered buckets `{label: "2025 H2",
    count, medianPsf}`.
  - `medianOf(nums)` (upper-middle, matching the feed's existing formula).

## 2. Market Intelligence card on /market/<slug> (renderMarketPageHTML)

Rendered between the summary card and the comps table, built from
`MARKET_INTEL` rows for the page's key **plus the page's own seeded comps**
(`p.comps`, mapped to the same slim shape and deduped by normalized
address+date before bucketing).

- **Trend strip** (only when ≥6 dated sale comps spanning ≥2 half-year
  buckets): self-contained inline SVG — polyline of bucket medians, a
  labeled point per bucket ("$184" above, "2025 H2 · 9 comps" below),
  calm palette (ink line, red current-bucket dot), fixed viewBox scaled by
  CSS, no external libs. All numbers server-computed; all text through
  `escHtml`.
- **Live stats line** (always): "Tracking this market since <Mon YYYY of
  oldest harvest ts> · <N> comps · 12-month median $<X>/SF · latest deal
  <best-effort deal_date text>". 12-month median = dated sale comps with
  yearFrac within 1.0 of now; omitted when <3 such comps.
- **"This quarter" block** (two honestly-labeled axes):
  - Collection: "<N> comps added to our corpus in Q<q> <year>" (harvest
    `ts` in the current calendar quarter; always shown, even 0).
  - Movement: "Deals closed in Q<q>: median $<X>/SF vs $<Y> in Q<q-1>"
    with a muted ▲/▼ — only when BOTH deal-date quarters have ≥3 priced
    sale comps; otherwise omitted entirely.
- Applies to seeded, dynamic, and preview pages (same renderer). Page
  cache-control stays 3600; the card's freshness rides the 10-min intel
  cache behind it.

## 3. Watchlist feed direction (server + index.html)

- Server: `/api/watchlist/feed` items gain optional
  `median_trend: { current, prior }` — deal-date medians of sale comps in
  the last 6 months vs the 6 months before (yearFrac windows), each side
  requiring ≥3 comps, else the field is absent. The existing `median_psf`
  (harvest-window, "recently collected") keeps its exact semantics and
  label.
- Front-end: the feed box's median line gains a suffix when present:
  "▲ from $244 (deals 6–12 mo ago)" — muted green when current ≥ prior,
  calm amber when lower, textContent-only.

## Explicitly out of scope

- Standalone digest pages/URLs; email digests (owner ruled out email).
- Trend charts on the app's report page (market pages + feed only).
- DDL, new routes, per-request corpus queries.

## Verification plan (no billed searches)

1. `parseDealDate`: standalone node run over every observed format +
   garbage ("soon", "", "13/2026", "Q5 2025") → correct fracs / nulls.
2. Seed `comp-corpus.jsonl` (git-ignored) with dated Ontario Industrial
   sale rows across 3 half-years (≥6 comps) + a thin market (2 rows):
   local `/market/industrial-ontario-ca` shows the SVG trend + stats +
   quarter block with hand-checked medians; the thin market's page shows
   only the stats line; a market with zero corpus rows still renders (card
   shows the seeded-comps-only or tracking line).
3. Feed: watched market with ≥3 sale comps in each 6-mo deal window →
   `median_trend` present, arrow direction matches hand math (test both
   directions); thin → field absent and the box renders exactly as today.
4. Print/PNG unaffected (market pages aren't in the app's report exports).
5. Cleanup seeds; zero console errors; deploy; prod spot-checks: a live
   market page shows the tracking line (degraded state expected today) and
   the quarter collection count; feed unchanged for thin markets.
