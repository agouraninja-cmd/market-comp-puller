# Extraction test — the verdict

> **STATUS: VERDICT DECLARED.** 14 documents, 132 hand-keyed deals, one run
> against production on 2026-08-27. Supersedes the 5-file provisional pilot
> (`extract-2026-08-25T21-58-15.md`), which this run reproduces and extends.
>
> **The capability passes. The current prompt does not.** Two systematic
> defects put wrong numbers into a broker's records today, and both are
> prompt bugs rather than model failures. Recommendation: **do not ship
> ingestion until they are fixed and this test is re-run** — which costs
> about $1 and twelve minutes, because the harness and the keyed truth now
> exist.
>
> Correction time (§9's first condition) still needs a stopwatch — see
> "The other half" below.

Target https://compninja.co · 14 of 14 files scored · 132 hand-keyed deals ·
raw responses in `eval-runs/extract-2026-08-27T05-07-30.json`

## Headline

| Measure | Value |
|---|---|
| Recall (deals found) | 85.6% (113/132) |
| Field precision | 98.7% (768/778) |
| **Fabrication rate** | **1.3%** (6 field(s) + 6 row(s)) |
| Omitted fields | 0 |
| Refused rows | 23 |


Read those two ways. **Nothing was omitted** — every field the model was
confident about, it supplied. And **fabrication is 1.3%**, down from the
pilot's 1.8%, on a set nearly three times the size. But the composition of
the remaining errors matters more than the rate, and that is the rest of
this document.

## Defect 1 — cap rates are wrong by 100x, silently, every single time

**8 of 8 cap rates in the set were returned as a decimal fraction where the
vault stores a percent.** The source says `5.10%`; the model returns
`0.051`.

This is the worst failure shape available, and the reason §9 puts fabrication
above every other measure:

- `parsePercent` **accepts it**. `0.051` is a real number between 0 and 100,
  so `normalizeRow` — the guard that refuses `"1.2M"` and day-first dates —
  has nothing to object to. It stores 0.051, meaning a cap rate of
  **0.051%**.
- It is **not detectable downstream**. A cap rate of 0.051% is absurd to a
  human reading one row, and invisible inside a median across a book.
- It is **systematic, not occasional**: two independent brokerages' documents
  (Neil Walter, CBRE), 8 rows, 8 failures, zero successes.

The cause is that `EXTRACT_PROMPT` never states the unit. It lists the
allowed keys and says dates must be `YYYY-MM-DD`, and says nothing at all
about how a percentage should be expressed. The model chose the convention
most common in its training data; the vault chose the other one.

**Fix:** one line in `EXTRACT_PROMPT` — cap_rate as a percent number, `7.3`
or `7.3%`, never a decimal fraction. Optionally, a defensive floor in
`parsePercent` is *not* the right fix on its own: 0.051 is a legal cap rate
for a parser to accept, and it is only the extraction path that knows the
number came from a page that said 5.10%.

## Defect 2 — three active listings were reported as closed sales

In `c04-bov-sample.pdf` (a lender BOV), the comparison grid holds three
`Sale` columns and three `Listing` columns. For the three **Listings**, the
source leaves **Sale Price and Sale Date deliberately blank** — they are
on-market properties that have not traded. The model gave all three
`transaction: "sale"` and a `deal_date` taken from the **Original List
Date** row.

That is three transactions that never happened, dated to the day they were
listed, entering a broker's comparables. Unlike defect 1 it is at least
partly checkable by a person, but only by someone who reads the source
alongside the import.

The contrast with `d04-nai-top-transactions.pdf` is the interesting part:
that document's table has **no date column at all**, and there the model
correctly omitted the dates and let all 9 rows be refused. So the model does
not invent dates when there is nothing to take — it invents them when a
plausible-looking date sits nearby under a different label. The vault
already stores on-market rows (the `Active` sentinel that `parseDealDate`
deliberately refuses to parse); the prompt simply never told the extractor
that a listing is a thing that exists.

**Fix:** teach `EXTRACT_PROMPT` the difference — a row with no sale price or
sale date is a listing, not a sale; never source a `deal_date` from a list
date, an assessment date, or a photo date.

## The third real error — a dropped digit

`c03`, 816 W Main St: the page reads **$2,750,000** and the model returned
**$275,000**. One row in 113, and the only price error in the set — but the
same silent class as defect 1, since $275,000 is a perfectly legal price for
a lot. Worth stating plainly because it is the residual risk that no prompt
fix removes: at ~1 in 113, a book of 200 comps carries roughly two of these,
and only a person comparing against the source will catch them.

Cross-check available cheaply: `price_per_acre` on that row (`$1,557,191`)
times `lot_acres` (`1.766`) reconciles to $2.75M, not $275K. The vault
already does exactly this kind of reconciliation for `price_per_sqft` in the
report path (`reconcilePricePerSqft`). Applying it at import would have
caught this row.

## Refusal quality — the vault's doctrine, working

23 rows were refused by `normalizeRow` after extraction. Sorted by hand, as
§9 asks, they fall into two groups and **neither is a model failure**:

**Genuinely absent data (4 rows) — the refusal lost nothing that existed.**
Three `c15` rows the model returned with no address at all, and one `d08`
row whose "address" is *"Southwest Corner of Seven Mile and Haggerty Roads"*
— a corner, not a property. The vault stores individual properties; refusing
is correct.

**Real values the vault will not accept (19 rows) — correct by doctrine, and
expensive.** Two rules account for all of them:

- **`deal_date` is required (10 rows).** All 9 `d04` rows plus 1 `d03` row.
  `d04` is a brokerage capital-markets report whose "Top Transactions" table
  carries Type, Address, SF, Buyer, Seller, Price and $/SF — and no date
  column; the only time reference is "H1 2025" in the surrounding prose.
  Every one of those is a real, large, named transaction that cannot enter
  the vault.
- **`rent_basis` is required with a rent (9 rows).** `c04` ×5, `d07` ×1,
  `d08` ×3. These are lease comps whose sheets state a rate but never the
  word "annual" or "monthly", because within a market it is conventional and
  goes without saying. Migration 029 made this required for a good reason —
  a 12x error is worse than a missing row — but the consequence measured
  here is that **a conventionally-formatted lease comp sheet is close to
  unimportable**.

Both are product findings rather than extraction findings, and both are
worth a decision before ingestion ships. Neither should be relaxed by
guessing: the `rent_basis` rule exists precisely because guessing is 12x
wrong. The honest options are a per-import basis prompt ("this sheet quotes
annual"), or accepting a dateless deal with an explicit `Undated` sentinel
the way `Active` already works for on-market rows.

## Full detail

## Per field
| Field | Correct | Compared | Fabricated |
|---|---|---|---|
| property_type | 112 | 113 | 0 |
| transaction | 110 | 110 | 3 |
| deal_date | 110 | 110 | 3 |
| price | 112 | 113 | 0 |
| size_sqft | 83 | 83 | 0 |
| units | 21 | 21 | 0 |
| price_per_unit | 21 | 21 | 0 |
| year_built | 60 | 60 | 0 |
| lot_acres | 76 | 76 | 0 |
| price_per_acre | 31 | 31 | 0 |
| zoning | 31 | 31 | 0 |
| cap_rate | 0 | 8 | 0 |
| building_class | 1 | 1 | 0 |

## Wrong values (the model read something, and it was not what the page says)
- c17-chaffee-sales-p3-14.pdf: 102 – 104 Brookdale Ave. Buena Vista, CO. 81211 · property_type: got `Industrial`, source says `Retail`
- c03-salem-va-land-p1.pdf: 816 W Main St · price: got `275000`, source says `2750000`
- d01-neilwalter-mf-comps.pdf: 30823 18th Ave S, Federal Way, WA 98003 · cap_rate: got `0.051`, source says `5.10%`
- d01-neilwalter-mf-comps.pdf: 5211 66th Street Ct W, University Place, WA 98467 · cap_rate: got `0.0629`, source says `6.29%`
- d01-neilwalter-mf-comps.pdf: 10710 256th St, Kent, WA 98030 · cap_rate: got `0.055`, source says `5.5%`
- d01-neilwalter-mf-comps.pdf: 3320 Auburn Way S, Auburn, WA 98092 · cap_rate: got `0.0524`, source says `5.24%`
- d01-neilwalter-mf-comps.pdf: 8508-8518 Main St E, Bonney Lake, WA 98391 · cap_rate: got `0.055`, source says `5.5%`
- d07-cbre-sale-comps.pdf: 39475 Lewis Drive, Novi, MI · cap_rate: got `0.073`, source says `7.3%`
- d07-cbre-sale-comps.pdf: 46325 W 12 Mile Road, Novi, MI · cap_rate: got `0.08`, source says `8.0%`
- d07-cbre-sale-comps.pdf: 5315 Elliott Drive, Ypsilanti, MI · cap_rate: got `0.083`, source says `8.3%`

## Fabricated fields (source states nothing, model supplied a value)
- c04-bov-sample.pdf: 240 W Whittier Blvd, La Habra, CA 90631 · transaction
- c04-bov-sample.pdf: 240 W Whittier Blvd, La Habra, CA 90631 · deal_date
- c04-bov-sample.pdf: 731 W Whittier Blvd, La Habra, CA 90631 · transaction
- c04-bov-sample.pdf: 731 W Whittier Blvd, La Habra, CA 90631 · deal_date
- c04-bov-sample.pdf: 13514 Telegraph Rd, Whittier, CA 90605 · transaction
- c04-bov-sample.pdf: 13514 Telegraph Rd, Whittier, CA 90605 · deal_date

## Fabricated rows
- c02-costar-sale-comps-report.pdf: 4647 International Blvd, Oakland, CA 94601
- c02-costar-sale-comps-report.pdf: 1845-1853 International Blvd, Oakland, CA 94606
- c02-costar-sale-comps-report.pdf: 2840-2846 Chapman St, Oakland, CA 94601
- c19-costar-comps-2.png: 4647 International Blvd, Oakland, CA 94601
- c19-costar-comps-2.png: 1845-1853 International Blvd, Oakland, CA 94606
- c19-costar-comps-2.png: 2840-2846 Chapman St, Oakland, CA 94601

## Missed deals
- c02-costar-sale-comps-report.pdf: 4647 International, Oakland, CA 94601
- c02-costar-sale-comps-report.pdf: 1845-1853 International, Oakland, CA 94606
- c02-costar-sale-comps-report.pdf: 2840-2846 Chapman, Oakland, CA 94601
- c19-costar-comps-2.png: 4647 International, Oakland, CA 94601
- c19-costar-comps-2.png: 1845-1853 International, Oakland, CA 94606
- c19-costar-comps-2.png: 2840-2846 Chapman, Oakland, CA 94601
- d04-nai-top-transactions.pdf: 200 Cottontail Lane A&B, Somerset
- d04-nai-top-transactions.pdf: 1501 Cottontail Lane, Somerset
- d04-nai-top-transactions.pdf: 201 Middlesex Center Blvd., Monroe
- d04-nai-top-transactions.pdf: 750 College Road East, Princeton
- d04-nai-top-transactions.pdf: 1 Semour Street, Montclair
- d04-nai-top-transactions.pdf: 340 Mt Kemble Avenue, Morristown
- d04-nai-top-transactions.pdf: 1071-1125 Inman Ave, Edison
- d04-nai-top-transactions.pdf: 192-234 Springfield Avenue, Newark
- d04-nai-top-transactions.pdf: 191 E. Hanover Avenue, Morristown
- d07-cbre-sale-comps.pdf: 451 Health Parkway, Paw Paw, MI
- d08-cbre-rent-comps.pdf: 18100 Oakwood Boulevard, Dearborn, MI
- d08-cbre-rent-comps.pdf: 15979 Hall Road, Macomb Township, MI
- d08-cbre-rent-comps.pdf: 5701 Bow Pointe Drive, Independence Township, MI

## Refusals, by file
- c04-bov-sample.pdf: 301 N Anaheim Blvd, Anaheim, CA 92805 — deal_date is required (YYYY-MM-DD); rent_basis is required with a rent — "annual" or "monthly", because $1.35/SF means a very different deal in each
- c04-bov-sample.pdf: 510-516 Gilbert St, Fullerton, CA 92833 — deal_date is required (YYYY-MM-DD); rent_basis is required with a rent — "annual" or "monthly", because $1.35/SF means a very different deal in each
- c04-bov-sample.pdf: 7901 Greenleaf Ave, Whittier, CA 90602 — deal_date is required (YYYY-MM-DD); rent_basis is required with a rent — "annual" or "monthly", because $1.35/SF means a very different deal in each
- c04-bov-sample.pdf: 230 E La Habra Blvd, La Habra, CA 90631 — deal_date is required (YYYY-MM-DD); rent_basis is required with a rent — "annual" or "monthly", because $1.35/SF means a very different deal in each
- c04-bov-sample.pdf: 1200 W La Habra Blvd, La Habra, CA 90631 — deal_date is required (YYYY-MM-DD); rent_basis is required with a rent — "annual" or "monthly", because $1.35/SF means a very different deal in each
- c15-sibley-residential-p1.pdf: (no address) — address is required
- c15-sibley-residential-p1.pdf: (no address) — address is required; deal_date is required (YYYY-MM-DD)
- c15-sibley-residential-p1.pdf: (no address) — address is required
- d03-bullrealty-office-comps.pdf: 5180 Roswell Rd., Atlanta — deal_date is required (YYYY-MM-DD)
- d04-nai-top-transactions.pdf: 200 Cottontail Lane A&B, Somerset — deal_date is required (YYYY-MM-DD)
- d04-nai-top-transactions.pdf: 1501 Cottontail Lane, Somerset — deal_date is required (YYYY-MM-DD)
- d04-nai-top-transactions.pdf: 201 Middlesex Center Blvd., Monroe — deal_date is required (YYYY-MM-DD)
- d04-nai-top-transactions.pdf: 750 College Road East, Princeton — deal_date is required (YYYY-MM-DD)
- d04-nai-top-transactions.pdf: 1 Semour Street, Montclair — deal_date is required (YYYY-MM-DD)
- d04-nai-top-transactions.pdf: 340 Mt Kemble Avenue, Morristown — deal_date is required (YYYY-MM-DD)
- d04-nai-top-transactions.pdf: 1071-1125 Inman Ave, Edison — deal_date is required (YYYY-MM-DD)
- d04-nai-top-transactions.pdf: 192-234 Springfield Avenue, Newark — deal_date is required (YYYY-MM-DD)
- d04-nai-top-transactions.pdf: 191 E. Hanover Avenue, Morristown — deal_date is required (YYYY-MM-DD)
- d07-cbre-sale-comps.pdf: 451 Health Parkway, Paw Paw, MI — rent_basis is required with a rent — "annual" or "monthly", because $1.35/SF means a very different deal in each
- d08-cbre-rent-comps.pdf: 18100 Oakwood Boulevard, Dearborn, MI — rent_basis is required with a rent — "annual" or "monthly", because $1.35/SF means a very different deal in each
- d08-cbre-rent-comps.pdf: 15979 Hall Road, Macomb Township, MI — rent_basis is required with a rent — "annual" or "monthly", because $1.35/SF means a very different deal in each
- d08-cbre-rent-comps.pdf: Southwest Corner of Seven Mile and Haggerty Roads, Northville Township, MI — "Southwest Corner of Seven Mile and Haggerty Roads, Northville Township, MI" has no street number — the vault stores individual properties; rent_basis is required with a rent — "annual" or "monthly", because $1.35/SF means a very different deal in each
- d08-cbre-rent-comps.pdf: 5701 Bow Pointe Drive, Independence Township, MI — rent_basis is required with a rent — "annual" or "monthly", because $1.35/SF means a very different deal in each

## The truth file was wrong again, in the same direction

The first scoring of this run reported **4.2% fabrication (27 fields)**. It
is 1.3% (6 fields) above. **All 21 of the difference were errors in the
truth file, not the model** — the pilot's lesson, repeating on a bigger set:

- **18 on `c04`**: the page-5 comparison grid states `Number of Units`
  (1 for all seven), `Site Size` (the acreage), and `Price Per Unit` for
  every column. Truth had omitted all three, so 18 correct reads scored as
  inventions.
- **3 on `d07`**: `building_class` "B+" and two `lot_acres` (5.61, 13.54)
  are stated in the narrative prose column rather than the grid — "situated
  on a 5.61-acre site", "considered a Class B+ property" — and truth had
  only been keyed from the grid.

A second trap worth recording for whoever keys the next set: **`pdftotext
-layout` misaligned `c03` badly**, shifting addresses against their data
rows and making the model's correct reads look wrong. Only rendering the
page to an image (`pdftoppm`) settled it — and settled it in the model's
favour on the address, and against it on the price. **Key truth from the
rendered page, never from a text extraction, and never from a run's
output.** Corrections are recorded in `truth.json`'s own `_verify_first`
block; the pre-correction file is kept beside it.

## What this set is, and what it is not

Nine documents gathered from the public web on 2026-08-25 and five more on
2026-08-27, each vetted by reading it; keeps and rejects logged in
`extract-eval/candidates/MANIFEST.md`. Six are broker-produced (Neil Walter,
Kidder Mathews, Bull Realty, NAI, CBRE ×2), which fixes the pilot's
assessor-weighting. Two are image renders, and `c04`/`c17`/`c18` are page
ranges excerpted from larger documents that exceed the route's 4 MB cap;
content is unaltered in all of them.

Three scope limits, stated because a verdict that hides them is worth less
than no verdict:

1. **No proprietary broker files.** The owner has no access to any, so
   §9's "20 real PDFs" is met in count-of-documents spirit at 14 and not in
   provenance. Everything here is published, which means typeset.
2. **No true scans.** No photograph of a printed sheet, no fax, no phone
   snap. The image class is represented only by clean renders. **A pass here
   is an upper bound on the messy half of the real distribution.** Closing
   this needs nothing but a printer and a phone — it is the cheapest
   outstanding item.
3. **Body-text-only emails were never tested.** §9's open question 3 wanted
   five; a comp sheet pasted into an email body rather than attached is a
   different extraction problem, and this verdict says nothing about it. It
   stays open against the ingestion spec rather than being quietly dropped.

Month-only dates ("Jul-24") are keyed as the first of the month and score as
correct, per the decision recorded in `extract-eval/NOTE.txt` and taken
before this truth was keyed. The separate product question that note raises
— that the vault's reject-rather-than-guess doctrine is violated by silently
inventing a day — is unaffected by this run and still open.

## The other half, by hand

- **Correction time (a person, a stopwatch, per 10-comp file):** ______
  The pilot measured zero corrections required on a clean 12-row file, which
  beats the 60-second bar trivially and is the wrong file to measure. The
  file to time is **`c04`** or **`d07`**: both need real corrections, and
  `d07` in particular requires fixing three cap rates that look plausible.
- **Verdict against §9's three conditions:**
  1. *Under 60 seconds to review* — **UNMEASURED.** See above.
  2. *Recall high enough not to re-read the PDF* — **PASS.** 85.6%, zero
     omitted fields, and every miss traced to two named causes (CoStar
     address truncation; the rent_basis/deal_date refusals).
  3. *Fabrication at or near zero* — **FAIL AS CONFIGURED, PASS AS FIXABLE.**
     1.3%, but concentrated in three invented sales; and the cap-rate defect,
     though scored as a wrong value rather than a fabrication, is the exact
     silent-wrong-number failure this condition exists to prevent.

**Recommendation:** the extraction capability clears the bar this test was
built to measure — 98.7% field precision across 14 documents from 11
organizations, with nothing omitted and no invented prices or sizes. It
should not be shipped behind an ingestion front door until defects 1 and 2
are fixed in `EXTRACT_PROMPT` and this test is re-run. That re-run is now
cheap: the harness, the files and the corrected truth all exist, and it is
one command and about a dollar.

The archive block is **not** blocked on gathering better evidence. It is
blocked on two prompt edits and a stopwatch.
