# Extraction test — final verdict (post-fix)

> **STATUS: FINAL.** 16 documents, 144 hand-keyed deals, run against
> production on 2026-08-28 with the two prompt fixes live (commit
> `2402ca3`, confirmed via `/healthz` before the run).
>
> **Both defects the 2026-08-27 verdict found are fixed and verified.**
> Cap rates went from **0 of 8 correct to 8 of 8**. Invented sale dates went
> from **3 to 0**. Field precision rose to **99.6%**.
>
> Supersedes `extract-2026-08-27-verdict.md`, which remains the record of
> what the defects were and how they were found.
>
> One condition of spec §9 remains unmeasured — correction time. See "The
> other half".

Raw responses: `eval-runs/extract-2026-08-28T05-14-45.json` ·
harness scorecard: `extract-2026-08-28T05-14-45.md`

## Before and after

| Measure | 2026-08-27 (pre-fix) | 2026-08-28 (post-fix) |
|---|---|---|
| Field precision | 98.7% (768/778) | **99.6% (764/767)** |
| cap_rate correct | **0 of 8** | **8 of 8** |
| deal_date fabricated | 3 | **0** |
| Fabricated fields | 6 | **1** |
| Recall (raw) | 85.6% | 76.4% — see below |
| Refused rows | 23 | 27 |

The recall figure fell and that is **mostly the fixes working**. It is the
one number in this test that punishes correct behaviour, so it has to be
read in parts rather than as a headline.

## Fix 1 — cap rates: verified

Every cap rate in the set now comes back as the percent string the page
shows, across both brokerages that exposed the bug:

- `d01` (Neil Walter): `5.10%`, `6.29%`, `5.5%`, `5.24%`, `5.5%`
- `d07` (CBRE): `7.4%`, `7.3%`, `8.0%`, `8.3%`, `7.7%`

Previously every one of these was a decimal fraction (`0.051`, `0.073`)
that `parsePercent` would have accepted and stored as a cap rate a hundred
times too small. **0 of 8 correct before, 8 of 8 after** — and the run
returned two more cap rates than before, both correct.

## Fix 2 — listings: verified

On `c04`, the lender BOV, the three Listing columns now return with
`transaction` and `deal_date` **omitted**, while the three genuine Sale
columns keep theirs:

| Row | Before | After |
|---|---|---|
| 321 S Highland Ave (Sale 1) | sale / 2014-10-03 | sale / 2014-10-03 |
| 11006 Santa Gertrudes Ave (Sale 2) | sale / 2014-09-03 | sale / 2014-09-03 |
| 339 N Harbor Blvd (Sale 3) | sale / 2014-02-12 | sale / 2014-02-12 |
| 240 W Whittier Blvd (**Listing 1**) | sale / 2014-04-15 | **omitted** |
| 731 W Whittier Blvd (**Listing 2**) | sale / 2014-10-10 | **omitted** |
| 13514 Telegraph Rd (**Listing 3**) | sale / 2014-12-15 | **omitted** |

The three listings are now refused by `normalizeRow` ("transaction is
required; deal_date is required") and shown to the broker with that reason,
which is the intended outcome: the vault cannot store a dateless deal, and
a visible skip beats a sale that never happened. It costs 3 deals of recall
and removes 3 fabrications.

## Reading the recall drop

34 deals were not matched. They divide into three groups, and only one is a
failure:

| Group | Count | What it is |
|---|---|---|
| Address-form artifacts | **11** | The model's data is correct; the address string differs from truth, so the match key misses |
| Correct refusals by doctrine | **16** | The vault refused a row it is designed to refuse |
| Real failure | **7** | The degraded `e02` image returned nothing at all |

**Adjusted recall, counting the address artifacts as the correct reads they
are: 121/144 = 84.0%.** Counting only the deals the vault would ever accept
(excluding the 16 doctrine refusals): **121/128 = 94.5%**.

### The address artifacts (11)

Two behaviours, both benign in themselves:

- `c02`/`c19` (3+3): the CoStar page truncates addresses for display
  ("4647 International...") and the model completes them ("4647
  International Blvd"). Known since the pilot.
- `d03` (5): **new this run.** The Bull Realty sheet prints "Atlanta" with
  no state and the model returned "Atlanta, GA" on every row. Dates and
  prices are byte-identical to the previous run; only the address string
  changed. The completion is correct — it is an Atlanta brokerage's Atlanta
  comp sheet — but it is an inference, not a reading.

**This is worth a product decision even though it is not an extraction
error.** `rowKey` here is `addressKey + deal_date`, and the vault's own
dedupe uses the same `addressKey`. So "5180 Roswell Rd., Atlanta" and
"5180 Roswell Rd., Atlanta, GA" are two different properties to the vault:
a broker re-importing the same sheet twice, once before this behaviour and
once after, gets duplicate rows. Nothing in this run tests that, and it is
not this verdict's call to make.

### The doctrine refusals (16)

Unchanged in character from the pre-fix run: 9 on `d04` (a capital-markets
report whose transactions table has no date column at all), 3 on `d08` and
1 on `d07` (lease sheets stating a rate but never "annual" or "monthly"),
3 on `c04` (the listings, above). All correct; all costly. The `deal_date`
and `rent_basis` questions raised in the previous verdict stand unchanged
and are still worth deciding before ingestion ships.

## The degradation probe answered, and the answer is not comfortable

`e01` and `e02` are page 1 of `c01` and `c02` re-rendered at 60 dpi,
grayscale, JPEG quality 28 — poor but legible, roughly a mediocre scan.
They are **synthetic degradation, not photographs** (no printer or camera
was available; see `extract-eval/candidates/MANIFEST.md`). The manifest's
reporting rule was fixed before the run: *a failure here is decisive; a
pass is weak evidence.*

It failed, twice over, in two different ways:

- **`e02` returned nothing at all** — "We couldn't find a deals table in
  that file." Seven deals lost. The identical page at full resolution
  (`c02`) and as a clean render (`c19`) both returned 7 rows. The only
  variable is image quality.
- **`e01` returned all 5 rows and silently misread a digit.** `566,000`
  became `560,000`, and the derived `price_per_unit` followed it to
  `186,667` instead of `188,667`. Every other field on every other row was
  correct.

That second one is the important result. It is the **same failure class as
the original cap-rate defect** — a well-formed, plausible, wrong number
that `normalizeRow` cannot object to and no reviewer catches without the
source page. The two defects this round fixed were prompt bugs; this one is
not fixable by prompt. It is what image quality costs.

**What this does and does not license saying.** It does not close the
true-scan gap — a real photograph adds perspective skew, uneven lighting,
shadow and focus falloff on top of the resolution loss these files test.
But it removes the optimistic reading: extraction was already fragile at
one axis of degradation, before any of the harder ones were applied. The
missing scan class is no longer a hypothetical caveat, and **a real
photograph should be expected to do worse than this, not better.**

## Full detail

| Measure | Value |
|---|---|
| Recall (deals found) | 76.4% (110/144) |
| Field precision | 99.6% (764/767) |
| **Fabrication rate** | **1.4%** (1 field(s) + 11 row(s)) |
| Omitted fields | 0 |
| Refused rows | 27 |

## Per field
| Field | Correct | Compared | Fabricated |
|---|---|---|---|
| property_type | 110 | 110 | 0 |
| transaction | 110 | 110 | 0 |
| deal_date | 110 | 110 | 0 |
| price | 109 | 110 | 0 |
| size_sqft | 80 | 80 | 0 |
| units | 23 | 23 | 0 |
| price_per_unit | 22 | 23 | 0 |
| year_built | 57 | 57 | 1 |
| lot_acres | 73 | 73 | 0 |
| price_per_acre | 31 | 31 | 0 |
| zoning | 31 | 31 | 0 |
| cap_rate | 8 | 8 | 0 |
| building_class | 0 | 1 | 0 |

## Wrong values (the model read something, and it was not what the page says)
- d07-cbre-sale-comps.pdf: 39475 Lewis Drive, Novi, MI · building_class: got `Class B+`, source says `B+`
- e01-lowres-benfrederick.jpg: 5021 Roland Ave · price: got `560000`, source says `566000`
- e01-lowres-benfrederick.jpg: 5021 Roland Ave · price_per_unit: got `186667`, source says `188667`


The three remaining wrong values are worth naming individually, because
after the fixes there are few enough to audit by hand:

- `d07` · building_class: got `"Class B+"`, truth `"B+"`. The page reads
  "considered a Class B+ property". This is a truth-formatting quibble, not
  an error — the model quoted the page.
- `e01` · price: `560000` vs `566000`, and its derived `price_per_unit`.
  The degradation misread, above. **The only genuine wrong value in the
  entire run.**

## Scope, unchanged and still stated

1. **No proprietary broker files.** Every document is published on the open
   web and therefore typeset. 16 documents, not §9's 20.
2. **No true scans.** The two `e` files are synthetic degradation, not
   photographs. See above for what they did and did not establish.
3. **Body-text-only emails untested** (§9's open question 3) — still open
   against the ingestion spec, not dropped.

Month-only dates are keyed as the first of the month and score as correct,
per `extract-eval/NOTE.txt`, decided before truth was keyed.

## The other half, by hand

- **Correction time (a person, a stopwatch, per ~10-comp file): 4m 51s
  for 12 rows** — 24.3 s/row, so about **4m 03s for a 10-comp file**.
  Measured 2026-08-28 by Jacob against `c17` (Chaffee County commercial
  sales book, one property per page across 12 pages) with the correction
  exercise beside the source PDF. **Zero corrections were needed** — this run
  read all 12 rows correctly — so the figure is pure *verification* cost, not
  correction cost.

  Two exercises are staged and waiting, generated by
  `node scripts/make-correction-exercise.js`. They hold **only** what the
  extractor returned — the errors are not marked, because finding them is
  the thing being measured:
  - `extract-eval/correction-exercise-c17.html` — 12 rows, the §9 file size,
    and clean in this run. Measures the common case: how long to *verify* a
    correct file. This is the number that answers "is this faster than
    typing?"
  - `extract-eval/correction-exercise-e01.html` — 5 rows containing the one
    silent digit error. Measures the harder question: is a wrong number of
    that kind *findable* at all?

- **Verdict against §9's three conditions:**
  1. *Under 60 seconds to review* — **FAIL as written: 4x over.** Measured
     4m 03s for a 10-comp equivalent against a 60-second bar. See below for
     why this does not mean what it first appears to.
  2. *Recall high enough not to re-read the PDF* — **PASS.** 94.5% of the
     deals the vault would accept; every miss traced to a named cause.
  3. *Fabrication at or near zero* — **PASS.** One fabricated field in 767
     (a truth-formatting quibble), zero invented dates, zero invented
     prices or sizes. The 11 fabricated *rows* are all address-completion
     artifacts of correct data.

**Recommendation: extraction is good enough to build the archive on, for
typeset documents.** Both blocking defects are fixed and verified against a
real measurement. Two things should be settled before ingestion ships, and
neither is an extraction problem:

1. **The `deal_date` and `rent_basis` refusals** cost 13 real deals here.
   A dateless-deal sentinel and a per-import rent basis are the honest
   options; guessing is not.
2. **Address completion vs. the dedupe key** — see the artifacts section.
   A broker importing the same sheet twice across this behaviour change
   gets duplicate properties.

And one thing that is not fixable by prompt: **image quality produces
silent wrong numbers**, demonstrated here on synthetic degradation alone. A
confirm step a broker actually reads is not optional for photographed
input.

## What the stopwatch actually measured (2026-08-28)

**4m 51s for 12 rows, zero corrections needed.** Against §9's 60-second bar
that is a 4x failure, and it would be easy to read it as "extraction is too
slow to build on". That reading is wrong, and the reviewer's own notes say
why: **every cause he named is a defect in the confirm table, not in the
extraction.** The rows were right. Reading them was slow.

Four findings, verbatim in substance, in the order he gave them:

1. **"Order the properties in the exact order of the sheet."** The rows do
   not follow the source document, so verifying row 4 means hunting page by
   page for the property it names. On a document like `c17` — one property
   per page across 12 pages — this is most of the elapsed time. Nothing
   about extraction requires reordering; the fix is to preserve source
   order, and it is probably the single biggest lever on this number.
2. **"Add commas and decimals."** Figures render raw (`410000`), and the
   source prints `$410,000.00`. Comparing the two is a digit-counting
   exercise, done twelve times. `/vault`'s own comps table already solved
   this — formatted for reading, raw on focus for editing (`cellDisplay` /
   `data-raw`) — and the confirm table should do the same rather than
   inventing a second convention.
3. **"Next to property type, add the actual title of the property — on
   retail it would be supermarket."** The row says `Retail`; the page says
   *Altitude Tire and Alignment*. The business name is how a person
   recognises which property a row is, and without it every row must be
   matched by address alone. The extractor already returns this material in
   `tenancy`/`notes` on many documents; the confirm table simply does not
   surface it.
4. **"Add the line items based on the sheet we got, not the exact same for
   every one."** The table shows a fixed column set regardless of what the
   document contains, so reviewers scan past columns the source never had.
   Columns should reflect the document in hand.

### What this does and does not settle

**It does not answer §9's real question.** The roadmap's framing is whether
a broker can key 12 comps faster than they can correct 12 extracted ones —
and **the typing half was never timed.** 4m 51s to verify 12 comps against
a 12-page PDF is very likely faster than keying 96 fields by hand, but that
is inference, not measurement, and it should not be written down as though
it were the latter. **Timing a hand-keyed file is now the cheapest
outstanding measurement in this whole exercise**, and it is the one that
actually decides the archive.

**It does settle where the remaining cost lives.** Extraction produced 12
correct rows in 9.9 seconds. A person then spent 291 seconds confirming
them, and four fixable presentation problems account for that gap. Whatever
the 60-second bar was protecting against, it was not this: the number is
bounded by the review UI, and the review UI has not been designed yet.

**Caveat on the document.** `c17` is the slowest layout in the set — one
property per page, no table to scan. A tabular sheet (`d02`, `d01`) would
almost certainly measure faster, and re-timing one after the four fixes
would say how much of the 4x was layout and how much was the table.
