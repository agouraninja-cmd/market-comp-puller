# Harvest public listings, not guesses (design)

Date: 2026-08-13
Status: agreed (approach 1, in-session)

## Problem

`harvestComps` writes every priced, non-aggregate comp into `comp_corpus`,
including `estimate` and `news`. Retrieval then has to throw those rows
away. Meanwhile a priced listing whose date will not parse (`Active`,
`Listed Mar 2025`, `2024-2025`) is saved and then ignored: `isUsable`
requires `parseDealDate`, so the row never seeds a later search.

Measured on the live corpus, 2026-08-13 (463 rows):

| `source_type`   | rows | priced | empty `deal_date` |
|-----------------|-----:|-------:|------------------:|
| listing         |  365 |    365 |                 0 |
| estimate        |   49 |     49 |                 0 |
| news            |   44 |     44 |                 0 |
| public_record   |    5 |      5 |                 0 |

Listing is already 79% of the store, and those rows are what makes
corpus-first retrieval fire. A handful of listing dates already fail the
parser (`Active listing 2025-2026`, `2024-2025`) and sit unused. The
model's date rule today is one field for close *or* list date, so an
active listing often lands as a bare `"Mar 2025"` and counts as a closed
deal.

## Decision (owner, 2026-08-13)

1. **Stop writing guesses.** New harvests keep only `public_record` and
   `listing`. `estimate` and `news` still appear in the report that found
   them; they do not enter the permanent store. Existing estimate/news
   rows stay; retrieval already ignores them. No delete, no backfill.
2. **Keep priced listings even without a close date.** Harvest fills an
   empty listing date as `"Active"`. The prompt is what produces
   `"Listed Mon YYYY"` (e.g. `"Listed Mar 2025"`) when the page shows a
   post date — harvest does not rewrite a non-empty date. Both sentinels
   must keep `parseDealDate` returning null so they cannot masquerade as
   a close.
3. **Offer those on-market rows as extra candidates, never as coverage.**
   Dated listing and public-record comps still count toward
   `corpusIsStrong`. An unparseable listing date is handed to the model in
   its own prompt block, the same "candidates only" shape as nearby-metro
   rows. Listings alone cannot shrink the search budget.
4. **No migration.** Same table, same `deal_date` text column.

Rejected: making coverage public-record-only (five rows in the whole
corpus; corpus-first retrieval would stop). Rejected: a `list_date`
column (the sentinel strings already split closed-looking from on-market
without a schema change).

## Mechanics

### `corpus-harvest.js` (new pure module, covered by `npm test`)

No I/O, no clock, no `parseDealDate` of its own — the caller injects the
parser so harvest, retrieval, the audit, and the backtest cannot disagree
about what a date is.

- `HARVESTABLE_SOURCES`: `["public_record", "listing"]`.
- `shouldHarvest(comp)`: false when there is no address, no price
  (`price_or_rate` and `price_per_sqft` both empty), the address is
  aggregate (`isAggregateAddress` from `corpus-audit.js`, one copy), or
  `source_type` is not in `HARVESTABLE_SOURCES`. True otherwise.
  `verified` is not a back door: a verified estimate still does not
  harvest. Link-check demotion to `estimate` therefore also stops the
  write, which is intended — a dead-at-birth URL is not a public listing
  we should remember.
- `listingDateForHarvest(comp)`: if `source_type` is `listing` and `date`
  / `deal_date` is empty or whitespace, return `"Active"`. Any other
  non-empty string is stored verbatim, including already-unparseable
  junk and a well-formed `"Listed Mar 2025"`. Public-record dates are
  untouched.
- `isOnMarketListing(row, parseDealDate)`: `source_type` is `listing`,
  priced, and `parseDealDate(deal_date)` is `null`. Mutually exclusive
  with retrieval's dated usable set by construction.
- `splitRetrieved(rows, { parseDealDate, cutoffFrac, corpusNum })`: the
  one split `retrieveCorpusComps` must call. `usable` is today's bar
  (not estimate/news, priced, parseable date `>= cutoffFrac`). `listed`
  is `isOnMarketListing` with no window. A dated listing is only in
  `usable`. An `"Active"` listing is only in `listed`. Estimate/news
  are in neither.

`harvestComps` in `server.js` stays the impure writer. It already skips
non-USD reports wholesale and dedupes on `corpusKeyOf`. The new checks
run inside the per-comp loop, and `listingDateForHarvest` runs **before**
`corpusKeyOf` so an empty date and `"Active"` cannot both occupy the
store for the same address + price.

### Retrieval (`retrieveCorpusComps`)

`coverage`, `fresh`, `corpusIsStrong`, and `searchBudgetFor` are
unchanged. Dated listing comps remain coverage. That is load-bearing:
they are 79% of the live corpus.

The return shape gains two fields, exact-market only, both from
`splitRetrieved` on the exact-market rows:

- `listed` — on-market listing rows, sliced to `maxComps`, same cap as
  `nearby`.
- `listedCount` — pre-slice count, for the log.

No window filter on `listed`: an active listing is on the market now.
No sibling-metro listed rows: nearby stays dated-usable only, matching
the 2026-08-10 metro spec's "candidates from other cities" meaning.

The empty and error returns include `listed: []` and `listedCount: 0` so
callers never see `undefined`.

### The prompt

Two edits in `buildPrompt`, both required. Changing harvest without the
prompt leaves the model writing fake close months; changing the prompt
without a listed block saves `"Active"` rows and then never offers them.

1. **Date rule.** Today's single sentence (`"date" = when the sale closed
   or the lease/listing was signed or posted, as a short month-year like
   "Mar 2025"`) splits:

   - Closed sale or signed lease: short month-year, `"Mar 2025"`.
   - Active listing: `"Active"` when the page has no post date, or
     `"Listed Mar 2025"` when it does. Never a bare `"Mar 2025"` for an
     active listing — that string parses, enters coverage, and reads as
     a close.

2. **`ON-MARKET LISTINGS` block**, sibling of `NEARBY COMPS`. Own section
   so `KNOWN RECENT COMPS` can keep "inside the date window" and "never
   include one that is clearly in a different city." The block says these
   are asking prices currently on the market, not closed sales; include
   one only when it is genuinely comparable; copy `source_url` and set
   `source_type` to `listing`; keep the date string as given; the notes
   caveat that the price is asking, not closed, is already required by
   the notes rule and must fire here.

`buildPrompt` grows one argument, `corpusListed`, after `corpusNearby`.
`callAnthropicOnce` passes `corpus && corpus.listed`.

### `parseDealDate` sentinels

The split is defined by the parser. These inputs must keep returning
`null`: `"Active"`, `"Listed Mar 2025"`, `"Listed Apr 2026"`,
`"Active listing 2025-2026"`, `"2024-2025"`, `""`. `"Mar 2025"` and
`"Jul 2026"` must keep parsing.

Move `parseDealDate` (and `MONTHS_IDX`) into `deal-date.js`, a tiny pure
module. `server.js`, the audit, and the backtest already inject the
parser; they require it from the new file. The engineering track's
"extract when touched" rule is why this moves: the new harvest/retrieval
split is a property of those sentinels, and a test that does not import
the real parser cannot pin them.

### Rollback

`CORPUS_LISTED=off` drops the on-market prompt block and returns
`listed: []`, following `CORPUS_METRO`. Default ON. The harvest filter
(no estimate/news, `"Active"` fill) has no flag — writing guesses back
into the store is not a rollback worth keeping.

## What deliberately does not change

- The table, `dedupe_key`, file fallback, non-USD skip, fire-and-forget
  write, or corpus-health counters.
- `corpusIsStrong`, `searchBudgetFor`, the `source: "corpus"` analytics
  tag, or the 75-day freshness gate. Freshness still keys off newest
  harvest `ts` for the market, so a listing harvest can keep a market
  fresh; it still cannot buy a smaller budget by itself.
- Valuation math. Asking-price rows the model includes in *this* report
  already have a notes rule requiring an asking-price caveat. This spec
  does not add a client-side filter.
- `/api/corpus-comps`, the watchlist feed, the gut check, the backtest,
  or market snapshots. The offer panel already accepts priced listing
  rows without a parseable date; it will start seeing `"Active"` rows as
  they accrue, which is correct. The backtest already skips unparseable
  dates as unusable.
- Existing estimate/news/listing rows. No rewrite of `"Jul 2026"` on a
  listing that might have been a list date. Going forward only.

## Tests

`test/corpus-harvest.test.js` (new) and `test/deal-date.test.js` (new):

- `shouldHarvest` is true for priced listing and priced public_record;
  false for estimate, news, empty source, unpriced, aggregate address,
  missing address.
- `listingDateForHarvest` fills `"Active"` only for empty listing dates;
  leaves `"Mar 2025"` and `"Listed Mar 2025"` alone; does not fill a
  public-record empty date.
- `isOnMarketListing` is true for listing + price + unparseable date;
  false for dated listing (that row is coverage), estimate, unpriced.
- `parseDealDate` pins the sentinel list above in both directions.
- `retrieveCorpusComps` is impure, so the split itself is tested through
  `isOnMarketListing` plus a small `splitRetrieved(rows, { parseDealDate,
  cutoffFrac, corpusNum })` helper exported from `corpus-harvest.js`
  that returns `{ usable, listed }`. One fixture: four dated listings
  and two `"Active"` listings → `usable.length === 4`, `listed.length
  === 2`. Coverage callers keep reading `usable.length`.

Prompt: `test/routes.test.js` already greps `server.js` source. Pin that
`buildPrompt` contains `ON-MARKET LISTINGS` and `Listed Mar 2025`, and
that the old combined date sentence (`lease/listing was signed or
posted`) is gone.

## Docs

CLAUDE.md, the harvest / corpus-first retrieval paragraphs: harvest
skips estimate/news; unparseable listing dates store (`Active` /
`Listed Mon YYYY`) and come back as extra candidates, not coverage.
`deal-date.js` joins the tested-modules list. A `devlog.json` entry
ships with the implementation, not this spec.
