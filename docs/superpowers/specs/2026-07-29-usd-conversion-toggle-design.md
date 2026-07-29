# Convert-to-USD Toggle for International Comp Searches — Design

Date: 2026-07-29
Status: Approved by owner

## Problem

CompNinja's report JSON has no notion of currency. Every price field
(`price_or_rate`, `price_per_sqft`, `avg_price_per_sqft`, per-unit/per-acre
type fields) is a string everyone assumes is USD. A search on a non-US
address (Canada, Mexico, etc.) returns local-currency figures with nothing
marking them as such — they read as USD and would be harvested into the comp
corpus as if they were.

## Decisions (owner-approved)

- **Display toggle, not a search option.** The model always reports prices
  in the property's local currency; a switch in the report flips display
  between local currency and USD. No re-search needed, works with cached
  results, both views available.
- **The model supplies the exchange rate** (via its web search) rather than
  a live FX API. Zero new dependencies; the rate is frozen with the report
  and labeled "as of report date." Comp-level precision doesn't need
  tick-level FX.

## 1. Model contract (`server.js` → `buildPrompt`)

Two new top-level fields in the report JSON shape:

- `"currency"` — ISO 4217 code of the currency prices are quoted in.
  `"USD"` for US properties.
- `"usd_rate"` — the current value of **1 unit of that currency in USD**
  (e.g. `"0.73"` for CAD), as a plain number string. Empty for USD.

Prompt rule: if the target property is outside the United States, report
ALL prices (comps, avg $/SF, cap rates excepted — they're percentages) in
the local currency, set `currency` to its ISO code, and set `usd_rate` to
the current exchange rate found via search. For US targets: `"USD"` / `""`.

Server-side normalization on the way out: missing/blank `currency` →
`"USD"`; `usd_rate` that doesn't parse to a positive finite number → null.
The front-end only shows the toggle when currency ≠ USD **and** the rate is
usable.

**Cache:** no `cacheKeyFor` change — this is an additive shape change.
Cached foreign reports predating the feature simply render without the
toggle until the 7-day TTL rolls them out.

## 2. Corpus safety

Corpus rows have no currency column; harvesting a foreign report would
store local-currency prices indistinguishable from USD. Rather than an
`ALTER TABLE` for a rare case (the missing-column class of outage is a
known footgun — see CLAUDE.md corpus health), `harvestComps()` **skips the
whole report when `currency !== "USD"`**, logging one line
(`Comp corpus skipped (non-USD report: CAD)`). Corpus-first retrieval is
untouched: foreign markets never accumulate corpus rows, so they always
take the normal full-search path.

## 3. Front-end toggle (`index.html`)

- Report state carries `data.currency` / `data.usd_rate`.
- When `currency !== "USD"` and the rate is a positive number, the report
  header renders a switch: **"Show in USD"**, default off (local currency).
- All displayed prices route through one formatting helper that honors the
  toggle: comp table (`price_or_rate`, `$/SF` column, per-unit / per-acre
  type columns), the value hero range, the avg-$/SF stat tile, the market
  position chart, and the CSV / PNG / print exports (exports reflect the
  current toggle state).
- Local mode formats with the currency code (`Intl.NumberFormat` with
  `style: "currency"`); USD mode multiplies the parsed numeric by
  `usd_rate` and formats as USD, with a footnote near the toggle:
  *"Converted at 1 CAD ≈ $0.73 USD, rate as of report date."*
- **Valuation math stays in local currency internally** — only the
  formatting layer converts, so nothing double-converts and toggling is
  pure re-render.
- Shared (`/api/share`) and saved (portfolio) reports carry
  `currency`/`usd_rate` inside the report data automatically, so shared-link
  viewers get the same toggle. No share-strip changes: currency is market
  data, not private finances.

## 4. Error handling

- A price string that doesn't parse renders as-is and is never converted.
- Missing/invalid rate → no toggle; prices display in local currency with
  the code visible, so nothing masquerades as USD.
- US searches: zero behavioral change anywhere.

## 5. Verification

No test suite exists (by design). Manual verification:

1. Search one Canadian address (one billed Anthropic search) — confirm
   local-currency display, toggle appears, USD mode converts table, hero,
   tile, chart, and exports; footnote shows the rate.
2. Confirm the server log shows the corpus-skip line for that report.
3. Search a US address — confirm no toggle and unchanged rendering.
