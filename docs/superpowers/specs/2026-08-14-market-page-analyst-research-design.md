# Market page as analyst research table — Design

Date: 2026-08-14
Status: implementing (first slice of the Market Explorer analyst brief)

Touches: `market-snapshot.js`, `server.js` (`renderMarketPageHTML`,
`MARKET_CSS`, `MARKET_RESEARCH_JS`), `test/market-snapshot.test.js`,
`test/public-pages.test.js`, `devlog.json`, `CLAUDE.md`

## Goal

The Market Explorer builds a `/market/<slug>` page from one billed search.
That page is an owner/SEO snapshot: median $/SF, a cap band, a 3-sentence
summary, and an 8-row teaser table. A CRE financial analyst screening a
market needs a defensible peer set they can sort, filter, cite, and export,
plus the market-level bands the same search already returned
(`market_opex_range`, `annual_price_trend_pct`) and a way to watch the
market without retyping it.

This is a render / snapshot change. No extra Anthropic call, no prompt
change, no migration, no raise of the parked 8-comp / 24-month Explorer
budget.

## Slice (what ships)

The recommended first slice of the analyst brief:

1. **Research table** — cap rate / tenancy / year built when present; link
   the address from `source_url`; Sale vs Lease filter; click-to-sort;
   CSV of the visible rows.
2. **Unused ledger fields** — op-ex band and annual price trend when the
   snapshot carries them; a rent band derived from priced leases.
3. **Signed-in chrome** — Watch this market + Download CSV, instead of the
   owner valuation CTA. Anonymous SEO traffic keeps the existing CTA.

Out of this slice (later tiers of the same brief): size-band / vintage
cuts, provenance mix line, metro siblings, Explorer `vs` queries, saved
Explorer history, side-by-side compare, digest pages, corpus browse.

## Decisions

### Public `source_url` — keep, sanitize, link the address

Market pages are the public SEO surface. The 2026-07-27 trim dropped
`source_url` as bulky and "app-only." Analysts will not quote a number they
cannot cite, and the URL is already on the in-app report.

Rules:

- **Keep** `source_url` on new snapshots. Seeded pages without one are
  unchanged (addresses stay plain text).
- **Sanitize** to `http:` / `https:` URLs with no embedded credentials.
  Anything else (empty, `javascript:`, `data:`, a bare path) stores as
  `""` and never becomes an `href`. Same refuse-rather-than-guess posture
  as `normalizeSubjectLastSale`.
- **Link the address**, do not add a Source column. The table is already
  wide; the URL is the proof for that row. `target="_blank"` +
  `rel="noopener noreferrer"`.
- **Do not fetch** these URLs from the market page. The harvest-time
  source-link check already ran; bot-walled hosts stay unlabeled rather
  than fetched, same as the report.
- **CSV** gets a Source URL column so the file is citable offline.
- `notes` and `verified` stay dropped. Notes are bulky; Verified is a
  badge only the server awards and market pages already under-claim
  provenance via `source_type`.

This is a product decision, not a security one: the comps are already
public. The sanitizer exists so a model-supplied string cannot become an
active script URL in our HTML.

### Signed-in vs SEO chrome — cookie presence, two bodies

Same cheap rule the wall already uses: `signedIn` is `cn_session`
**presence**, never `getSessionUser()`. The signed-in variant is
`no-store`; the anonymous variant stays hour-cached with `vary: cookie`.

| Visitor | Primary CTA | Secondary |
|---|---|---|
| Anonymous | "Get my free valuation" (existing `/?auth=signup&type=` door) | Address Explorer deep link (existing `/?auth=signup&explore=` door) |
| Signed-in | "Watch this market" (`POST /api/watchlist`, already exists) | Download CSV; Address Explorer without the signup door (`/?explore=&type=`) |

Do **not** rewrite the 3-sentence owner summary into jargon. The honesty
caveat in sentence 3 is load-bearing. Add an analyst strip; do not replace
the page.

Watch is a `<button class="btn">`, not an `<a class="btn">`, so the
existing public-pages assertion that signed-in `.btn` hrefs never carry
`auth=signup` stays true. A forged cookie still shows the chrome; the
watch POST 401s and the button says so. Export is the same class of gate:
the 8 comps are already in the HTML, the button is the funnel, not a
security boundary. Cap the CSV to `p.comps` (the published snapshot),
never the corpus.

### Sale vs Lease — filter, do not mix units

Sale tiles stay sales-only (`p.ppsf`). Lease `$/SF/yr` is a different
unit; those rows currently sit in the same table looking like cheap
sales.

- A Sale / Lease / All filter above the table, hidden when the snapshot
  has only one transaction kind.
- The sales-median `<tfoot>` hides on the Lease filter.
- A **Typical rent** cell (`$/SF/yr`) renders when ≥2 priced leases
  exist, derived at **render** from `p.comps` so seeded pages with leases
  (Ontario has three) gain it without regeneration. Ambiguous lease
  rates (monthly-only, no `/yr`, no `price_per_sqft`) are skipped, never
  guessed. New snapshots also store a `rent` block so a future consumer
  does not re-derive.

### Ledger extras sit on a second row

The headline strip stays two or three cells (median emphasized, typical
range, cap band). Op-ex, price trend, and rent append on a quieter
`.ledger.aux` row, each omitted rather than invented. A fourth cell on
the headline strip would punch a hole when opex is missing and crowd the
figure the page is for.

`annual_price_trend_pct` uses the same bounds as `normalizeTrendPct` in
`report-parse.js` (±30%/yr, refuse 0): a copy in `market-snapshot.js`,
not an import, so the snapshot module stays dependency-free for
`gen-market-seed.js`.

### Columns follow the report, with the empty-column drop

Cap Rate after the price columns; Tenancy and Year Built after Cap Rate
(not on Land). Drop a column whose value is empty on every comp — the
same rule that keeps pre-#5 seed pages from sprouting blanks. Labels
match `index.html` (`Cap Rate`, `Tenancy`, `Year Built`).

Sort is click-to-sort on `<th>`, everyone, cached with the anonymous
page. CSV exports the **visible** rows (the active Sale/Lease filter),
plus Source URL.

## Out of scope

- Raising 8 comps or the 24-month window.
- Size-band / vintage slices, provenance mix, metro siblings, compare.
- DCF / NOI / rent-roll on the market page.
- Vacancy / absorption / inventory tiles.
- Rewriting the owner summary.
- Publishing corpus rows onto the public table.

## Verification

1. `distillMarketSnapshot` keeps a sanitized `source_url`, drops
   `javascript:` / `notes` / `verified`, writes `market_opex_range` /
   `annual_price_trend_pct` / `rent` only when they survive the
   under-claim rules. `npm test`.
2. Seeded `/market/industrial-ontario-ca` still has no Cap Rate column
   (comps have none) and no address links (no `source_url`). It DOES
   gain a rent cell (3 priced leases) and Sale/Lease chips. Anonymous
   CTA unchanged.
3. The same page with `cn_session` present: Watch + CSV buttons, no
   signup `.btn`, no-store. Watch POSTs `{ market: "Ontario, CA",
   property_type: "Industrial" }`.
4. A distilled fixture with `source_url: "javascript:alert(1)"` stores
   `""`. One with `https://example.com/deal` keeps that URL.
