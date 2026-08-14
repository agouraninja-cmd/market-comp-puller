# Tax-assessed value as a hero cross-check

**Date:** 2026-08-14
**Status:** agreed (Jacob, 2026-08-14)
**Audience pick:** first-session owner. The 2026-08-14 usefulness ranking put
trust in the first report above returning-member loops and the unused vault.
**Single idea:** the county's assessed value as a labeled cross-check in the
hero's approaches table. Not bundled with the one-page owner letter, hero
next-steps, listing-URL paste, portfolio rollup, or the license-to-publish
gate.

Source: usefulness ranking against [docs/ROADMAP.md](../../ROADMAP.md)
principles (daily-use tool, client-side math, automated estimate never an
appraisal). Sibling to `subject_last_sale` (2026-08-10).

## Why

The hero already states a sales-comparison range and, when the owner typed an
NOI, an income line. The third classic method — cost — is honestly "not
modeled." What the first-session owner is missing is a **public-record number
about this exact address** they can read against that range.

County assessor pages are already opened for the subject-size lookup. Those
pages carry an assessed (taxable) value. The Boise trailer that came back at
$795,000 because the size box measured a bike shop is the concrete failure:
the comps were right, the size was wrong, and nothing on the page was a
number from the subject's own public record. An assessed value of ~$50k
sitting next to a $795k sales range would have named the figure to doubt.
`subject_last_sale` is the same class of evidence and already rides those
pages; assessed value is the other number they almost always print.

This is a cross-check, not a fourth headline. An old or lagged assessment
shown as Low/Likely/High would be mistaken for a current valuation, which is
the one thing it must never be.

## What it is not

- **Not the cost approach.** Cost is land + rebuild − depreciation. Assessed
  value is the county's opinion for tax. `#ownerApproaches` keeps the muted
  "Cost approach: not modeled" row. The new row is labeled **County
  assessment**.
- **Not a comp, not harvested.** `comp_corpus` holds comps. The subject's own
  tax figure is not a comparable sale of itself. Same rule as
  `subject_last_sale`.
- **Not in the ledger.** Low / Likely / High stay sales-comp (or income)
  math. Assessed never becomes the headline, including when sales comps are
  thin.
- **Not a required summary mention.** `subject_last_sale` earned a protected
  summary slot because a recent sale of the subject is the most important
  single fact. Forcing assessed into the three-sentence summary would crowd
  the honesty caveats. It lives in the approaches table only.
- **Not an extra search.** It rides the SUBJECT SIZE step the way last-sale
  does. When `wantsSize` is false, it is opportunistic: record it if the
  pages already open show it; do not spend a search on it.

## The field

Top-level on the parsed report, parallel to `subject_last_sale`:

```json
"subject_assessed": {
  "value": "$412,000",
  "year": "2025",
  "source_url": "https://example-county.gov/parcel/…"
}
```

| Field | Rule |
|---|---|
| `value` | Required. The county's total assessed (or taxable) value as one money string like `"$412,000"`. Land-only or improvements-only figures are refused — the row has to be the whole parcel or it is not comparable to the hero's total. |
| `year` | Optional. Four-digit tax year (`1990` … current calendar year + 1). A missing year still shows; a stale year is information. |
| `source_url` | Optional. Kept only when it is `http(s)`. Rendered as a "Source" link, same as last-sale. |

Leave all three `""` when nothing findable. Never infer from a neighboring
parcel. Never use a listing ask, a Zestimate, or a "market value" the
assessor printed as a separate opinion — only the assessed/taxable number
the county uses to tax the parcel.

## Normalization (server, once)

New pure function `normalizeSubjectAssessed` in [`report-parse.js`](../../../report-parse.js)
— new pipeline steps belong there, not in `server.js`.
`normalizeSubjectLastSale` stays where it is; migrating it is out of scope.

Rules, all tested in `test/report-parse.test.js`:

1. Missing, non-object, or array → delete the key.
2. `value` must parse to a number **> 0** (`numericValue` / the same money
   scrape last-sale's display uses). No value → delete the key. A year with
   no value is unusable.
3. `year` kept only as a 4-digit string in `1990` … `currentYear + 1`. The
   caller passes `now` (no clock read inside the module). Anything else,
   including `"2025/26"` after a failed extract, becomes `""`.
4. `source_url` kept only when it matches `/^https?:\/\//i`; otherwise `""`.
5. Clip, do not reject on length: `value` 40 chars, `year` 4, `source_url`
   500. Same as last-sale.
6. Returns the same object it was given (pipeline style).

`finishReport` in [`server.js`](../../../server.js) wraps it next to
`normalizeSubjectLastSale`. `mergeLaneReports` copies the records lane's
assessed value when the primary has none, same as last-sale — the records
lane is the one opening assessor pages.

## Prompt

Extend the existing SUBJECT SIZE paragraph (the "while you are on those
pages, also read off…" sentence) to also read assessed/taxable value for
`subject_assessed`. Add the JSON shape next to `subject_last_sale`, gated
the same way: `wantsSize || !compsOnly`.

The field description must say, in this order:

- the TARGET parcel's total assessed or taxable value, not a neighbor's;
- do not spend an additional search (`wantsSize` branch) / only if you come
  across it (`!wantsSize` branch);
- `value` / `year` / `source_url` as above;
- land-only or improvements-only → leave `""` rather than report a partial;
- this is not a comp and must not appear in `comps`;
- do **not** put it in `summary`.

Do not mention "verified." Do not call it an appraisal or a CompNinja
valuation.

## Where it renders

One new row in the existing `#ownerApproaches` table, built by a single
helper `assessedApproachEntry(parsed, salesLo, salesHi)` so every hero
branch cannot drift.

- **Label:** `County assessment`
- **Value column:** `displayMoney(value)` — one figure, never widened into
  a band.
- **Text:** `the county's assessed value` + optional ` for tax year {year}`
  + `. Counties often lag the market; this is a public-record cross-check,
  not a third valuation method.`
- **Disagreement sentence** (only when the hero is quoting a **dollar**
  range, not a $/SF-only headline): call `VALUATION.outlierOf(assessedNum,
  { low: salesLo, high: salesHi })`. That is the same 25% nearest-edge rule
  the table's outlier chips and the vault gut check use, so the three
  cannot disagree. If it fires, append
  `{pct}% {above|below} the range above — the size box or the comps deserve
  a second look.` The Boise class of bug is exactly "assessed far below a
  size-inflated range."
- **Source link:** same DOM pattern as `renderSubjectLastSale` (create
  `<a>`, never innerHTML). The approaches builder today uses `textContent`;
  the helper may return a `{ label, value, text, href }` and
  `renderApproaches` grows an optional link on the evidence cell. Do not
  switch the table to innerHTML.
- **Placement:** after the sales-comparison line (and its per-unit /
  per-acre sibling) and after the income line(s), **before** the muted cost
  row. Public-record evidence sits with the other numbers; cost stays the
  last, honest "not modeled."
- **Every dollar-headline branch spreads it.** The $/SF-only branch (no
  subject size) still shows the assessed figure **without** the
  disagreement sentence — there is no total to compare. The dashes branch
  shows it too when present: a report that cannot value the building can
  still show what the county says.
- **Hidden when the key is absent** after normalize. No empty row.

It prints and it captures (`#ownerApproaches` already does). Assembly
already lists `ownerApproaches` in `beginAssembly`'s `asm-hidden` list, so
the previous report's row cannot hang under the next placeholder.

## What it does not touch

- `valuation.js` math (`valueFromComps`, `robustPpsfRange`, the ledger).
  `outlierOf` is called, not changed.
- `cacheKeyFor` — the field is a search output, not an input.
- `/api/share` — public record, kept. Not NOI-class.
- Harvest, corpus retrieval, market snapshots, market-page HTML.
- Comp gating / `locked_basis`.
- The cost-approach copy.
- `eval-score.js` in v1. Presence rate can join the scorecard later; do not
  invent a pass/fail.

## Exports

One row on the XLSX Valuation sheet, next to Size:

`["County assessed value", money]` and, when `year` is set, the label
includes `(tax year {year})`.

CSV is unchanged. Last-sale is not in the CSV today; assessed follows that.

## Copy and compliance

- "County assessment" / "the county's assessed value" — never "appraised,"
  never "CompNinja's assessed value," never "verified."
- The lag sentence is load-bearing. Without it, a lagged assessment reads
  as our number being wrong or the county's being current.
- Shared reports use the same copy ("the county's", not "your county's").

## Constraints a future editor will otherwise break

1. **Value is required, year is not** — the opposite of last-sale (date
   required, price not). A price with no date is an unplaceable current
   valuation; an assessment with no year is still a public number.
2. **Whole parcel or nothing.** A land-only figure next to a building
   valuation is the bike-shop bug in reverse.
3. **Reuse `outlierOf`, do not copy 25%.** A second constant will drift
   from the chips and the gut check.
4. **Never the headline.** Thin sales + a fat assessed number is still not
   a reason to put assessed in Low/Likely/High.
5. **Records-lane merge.** `PARALLEL_SEARCH` is off, but `mergeLaneReports`
   already special-cases last-sale; assessed needs the same or a records
   lane that found it will lose it on fold-in.

## Implementation (when this is built)

Shipped on this branch. Tests first in `test/report-parse.test.js`;
`normalizeSubjectAssessed` in `report-parse.js`; wired into `finishReport`
and `mergeLaneReports`; prompt gated like last-sale; `assessedApproachEntry`
+ `withAssessed` on every hero branch; XLSX row; CLAUDE.md flow 3d.
Roadmap Next was not reordered.

## Out of scope (rejected for this spec, not forgotten)

The usefulness ranking's other first-session ideas — one-page owner letter,
hero next-steps, listing-URL paste — and the returning-member / vault
ideas. Build those as their own specs. This one is the public-record
number next to the range.
