# Subject cap rate — replacing "Price max" in Refine

**Date:** 2026-08-10
**Status:** agreed
**Surface:** `index.html` only. No server change, no migration, no cache-key change.

## Why

The Refine section's third cell held **Price max**, the upper bound that paired
with the main form's "Asking price" to make a range. It earned its slot when the
price lived down here too; since 2026-08-10 the asking price is a first-class
field on the form itself, and a lone "max" stranded in Refine is a control that
only makes sense if you remember the field it belongs to.

A cap rate is the input a commercial owner actually reaches for, and the report
already has a place to put it: the income approach currently values the owner's
NOI against **the model's** `market_cap_rate_range` and has no way to hear that
the owner disagrees. The whole income branch is also dead — the hero's
`noi && capOk` fallback at index.html:4134 renders nothing — whenever the model
returns no cap-rate range at all, which is common on thin markets.

## The field

Refine's third cell becomes:

- `id="capRate"`, `type="number"`, `min="0"`, `step="0.01"`, placeholder `e.g. 6.25`
- label **Cap rate (%)**
- hint: *"Your own cap rate. With NOI it adds an income-approach value line. Used only in your browser."*

It reuses the classes the removed input carried, so no new Tailwind utilities and
no `tailwind.css` regeneration beyond the hook's own pass.

## Where the value lives

`meta.subject.capRate`, immediately alongside `noi`, and governed by the same
rule: **it is never sent to the server.** It is not in the `/api/comps` body and
therefore not in `cacheKeyFor`.

Unlike NOI it is **not** stripped by `POST /api/share`. A cap rate is an opinion,
the same class as the DCF's hold/growth/discount/exit assumptions, which already
ride into shares. It leaks nothing on its own: every surface it drives requires
NOI, and NOI is already stripped, so a shared report carrying a `capRate` renders
exactly as it does today.

## What it drives

1. **A new reconciliation line.** `Income approach (your cap rate)` — NOI ÷ the
   owner's rate, a single figure — inserted directly after the existing
   market-cap-rate income line, so the owner's assumption reads against the
   market's rather than replacing it silently. Built by the same
   `incomeApproachEntry` sibling so the two can't drift.
2. **It revives the income-led hero.** When the model returned no
   `market_cap_rate_range` but the owner supplied one, the owner's rate becomes
   the income line, including the branch where the income approach heads the
   hero with no usable sale range. That branch is unreachable today without a
   market range.
3. **It seeds the DCF.** `ensureAssumptions` prefers the owner's rate over the
   market midpoint: `discountPct = rate + 2.0`, `exitCapPct = rate + 0.25` — the
   same two offsets the market midpoint already uses, so a report where the owner
   agrees with the market is unchanged.
4. **It exports.** One row on the XLSX Valuation sheet next to `NOI (yours)`.

`market_cap_rate_range` keeps every other job it has (the comp-table `Cap Rate`
column is the comps' own rate and is untouched).

## Removing Price max without breaking old reports

`meta.subject.priceMax` **stays in the shape.** Reports saved or shared before
today carry a real range, and the pinned subject row and comparison card must keep
rendering it.

- `targetRange(minId, maxId)` gains a guard: a `maxId` that is null or names an
  element that no longer exists contributes nothing instead of throwing.
- Its four call sites pass `null` for the price max.
- The two restore paths that wrote into `#targetPriceMax` (shared-report prefill,
  saved-report re-run) drop those writes.
- New reports carry `priceMax: null`, which the display helpers already handle:
  `range()` prints a single figure when `max` is absent.

Consequence, accepted: the asking price is no longer a range. The pinned subject
row and the comparison card's $/SF show one figure instead of a spread.

## Testing

`npm test` covers the pure modules; `index.html` has no suite. Verification is
the browser: enter NOI + a cap rate and confirm the new line appears with the
market line beside it; blank the market range and confirm the income branch still
heads the hero; reopen a pre-change saved report and confirm its price range still
renders on the subject row.
