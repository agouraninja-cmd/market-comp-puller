# Design: a broker vault template that carries its own rules

Date: 2026-08-10
Status: agreed
Touches: `broker-vault.js`, `vault-page.js`, `server.js` (one response field),
`test/broker-vault.test.js`, `devlog.json`, `CLAUDE.md`

## 1. The problem

`templateCsv()` hands a broker a header row and one example row. Everything we
need them to know is crammed into that example row's `notes` cell:

> Dates are YYYY-MM-DD. Prices are plain numbers - no $ signs, no 1.2M.

Six things are wrong with that.

1. **The guidance is deleted by the first edit.** The broker types over the
   example row, and every rule we shipped goes with it. The file they are
   actually editing, hours later, in Excel, says nothing.
2. **The guidance is inaccurate.** `parseMoney` strips `$` and commas, so
   `$1,250,000` imports fine. `parseNumber` accepts `45,000 SF`.
   `parsePercent` accepts `6.25%`. Only shorthand (`1.2M`) is genuinely
   refused. We are telling brokers to do cleanup the importer already does,
   which costs them work and costs us trust the first time they notice.
3. **The file never says which columns are required.** `/vault`'s first-run
   panel says four are; the CSV does not, and the CSV is what is open when the
   question arises.
4. **The legal values appear nowhere.** `property_type` must match one of six
   exact strings and `transaction` must resolve to sale or lease. A `Warehouse`
   row is refused with no way the broker could have known.
5. **Ten accepted columns are invisible.** Every name in
   `OPTIONAL_SPEC_COLUMNS` imports if present and is mentioned nowhere, so a
   broker whose book carries clear heights leaves them behind.
6. **One example, and it is the easy case.** A fully-populated sale. No lease,
   and no undisclosed-price row, which are the two cases the first-run copy
   goes out of its way to say are welcome.

## 2. The shape of the fix

Move the rules into the file, as lines the importer knows to ignore.

### 2.1 Comment rows

A new pure helper in `broker-vault.js`:

```js
function isCommentRow(cells) {
  return String((cells && cells[0]) == null ? "" : cells[0]).trim().startsWith("#");
}
```

A body row whose FIRST cell begins with `#` is guidance, not data. Only the
first cell is examined, so a comment may carry values in every other column —
which is what lets an example row be fully populated and still inert.

The header is row 0 and is never tested, so a file whose first column is
literally headed `#` still parses.

### 2.2 The skip is counted, never silent

`parseUpload` returns a new `commented` count. This module's stance is that a
row is either stored or explained; a new invisible drop path would break it.
The count reaches the broker (see §4).

Two details that are easy to get wrong:

- **Iterate the whole body and skip inside the loop.** Line numbers are
  `i + 2` against the raw body index, and filtering comments out first would
  renumber every error message away from what Excel shows.
- **`total` counts data rows only** — body length minus comment rows. It is
  the number the broker compares `imported` against, and "imported 3 of 16"
  on a 3-comp file would read as data loss. No existing file has comment rows,
  so nothing in the world changes meaning.

`MAX_ROWS_PER_UPLOAD` keeps checking raw body length. The difference is a
dozen lines and the limit is a runaway-file guard, not accounting.

### 2.3 The all-comments case needs a real message

An untouched template now yields zero rows, and `ok: false` with an empty
`errors` array surfaces as the route's generic fallback. So when every body
row was a comment, `parseUpload` returns one error:

> Every line in that file starts with # — those are the template's own notes.
> Type your comps in below them, or over the example rows.

`server.js` already answers `parsed.errors[0]`, so no route change is needed
for this.

### 2.4 `inspectCsv` skips them too

Comment rows are excluded from `samples` and from `rowCount`. Without this the
mapping screen offers `# Required: address, property_type, ...` as a sample
value for the address column, and reports a row count a dozen too high.
`cleanTemplate` is unaffected — it reads headers only.

## 3. The template itself

Header row unchanged: `TEMPLATE_COLUMNS` in order. The mapper's `cleanTemplate`
path and the "headers are exactly the columns we document" test both depend on
it.

Then a block of `#` lines, **each emitted as a single cell** through `csvCell`,
so a line containing commas is quoted and Excel shows it as one run of text
rather than shrapnel across twelve columns:

```
# Lines starting with # are ignored on import. Delete them or leave them.
# Required: address, property_type, transaction, deal_date. Everything else is
  optional - a deal with an undisclosed price still counts.
# property_type: one of Industrial, Office, Retail, Multifamily, Land, Residential.
# transaction: sale or lease.
# deal_date: 2025-03-14. Slash dates work too and are read month first (3/14/2025).
# price and size_sqft: $1,250,000 and 45,000 SF are both fine. 1.2M is not -
  write it out.
# cap_rate: 5.75 or 5.75%.
# lat and lng: decimal degrees, both or neither. Supplying them keeps this
  address off third-party geocoders.
# You can add any of these columns too: <OPTIONAL_SPEC_COLUMNS, comma separated>
# The rows below are examples. Type your own address over the # to use one, or
  delete them.
```

(Wrapped here for reading; each is one line in the file.)

Then three example rows, each with `#` alone in the address cell and every
other value under its correct header:

| | property_type | transaction | deal_date | price | size_sqft | cap_rate |
|---|---|---|---|---|---|---|
| `#` | Industrial | sale | 2025-03-14 | 12500000 | 84000 | 5.75 |
| `#` | Office | lease | 2025-06-01 | | 12500 | |
| `#` | Retail | sale | 2024-11-20 | | 9400 | |

A priced sale, a lease, and a sale with an undisclosed price. The lease and the
unpriced sale exist because the first-run copy promises both are welcome and
the template currently demonstrates neither.

**Nothing in the template can import.** That is the point of putting `#` in the
address cell rather than shipping live example rows: our own file can never
plant a fake comp in a broker's book of business. A broker activates a row by
typing their address over the `#`, which is the same keystroke as filling the
cell in, so the failure mode where they fill a row and forget to un-comment it
requires leaving the required address column blank — already a loud error.

## 4. What the broker sees

`vault-page.js`'s success summary gains one clause when `commented > 0`:

> Imported 12 comps · 13 note lines ignored

Honest on the normal path (our own template's notes) and, more importantly,
visible on the abnormal one — a broker whose own export has a row starting
with `#` sees that it did not import. Such a row is refused today too, by
`normalizeRow`'s "has no street number" rule; this keeps it visible rather
than trading a loud rejection for a silent drop.

`server.js` passes `commented` through in the 200 response alongside `skipped`
and `duplicates`.

## 5. Tests

In `test/broker-vault.test.js` (note: this file contains literal NUL/SOH bytes
in a garbage-input case, so tooling may treat it as binary):

- A `#` row is skipped, counted in `commented`, and excluded from `total`.
- Line numbers in error messages still match Excel when comment rows sit above
  the bad row.
- The untouched template imports zero rows and returns the §2.3 message.
- Stripping the `#` from the three example rows imports all three cleanly.
  This replaces today's "the template parses cleanly through our own importer"
  test and preserves its intent: the first thing a broker does must not fail.
- The template's headers are still exactly `TEMPLATE_COLUMNS` (unchanged test).
- `inspectCsv` neither samples comment rows nor counts them in `rowCount`, and
  still reports `cleanTemplate: true` for our template.
- **The guidance is pinned to the constants**: every value in `PROPERTY_TYPES`
  and every name in `OPTIONAL_SPEC_COLUMNS` appears in the template text. This
  is the test that keeps the file from going stale — adding a per-type field
  through the `add-comp-field` skill will now fail the build until the
  template names it.

## 6. Deliberately not doing

- **Not adding the ten optional spec columns as real headers.** A 22-column
  file reads as 22 obligations, which is the exact fear the first-run copy was
  written to remove. Naming them in a comment buys the discovery without the
  intimidation.
- **Not touching the column mapper.** A broker bringing their own export is
  already served; this is for the broker filling in ours.
- **No migration.** Nothing about storage changes.
