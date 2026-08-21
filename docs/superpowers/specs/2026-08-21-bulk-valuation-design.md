# Bulk valuation — design

**Date:** 2026-08-21
**Status:** shipped
**Modules:** `bulk.js` (pure), `bulk-page.js` (the /bulk screen), migration
`035-bulk-valuations.sql`
**Touches:** `entitlements.js` (`canBulkValue`, `bulkMaxAddresses`),
`server.js` (`runCompSearch`, `finishReportForViewer`, the job store and
worker, `/api/bulk*`, `/bulk`), `index.html` (`?property=<id>`)

---

## 1. What it is

A Pro member pastes a list of addresses — or uploads a CSV with an `address`
column — picks one property type and one lookback, and gets a value on each
address, as one portfolio. Every finished valuation is also written to My Desk
as an ordinary saved property, so the evidence behind each row (comps,
weighting, trust line) is one click away and every existing desk feature works
on it with no bulk-specific branch anywhere.

The pieces already existed — the search, the portfolio, the entitlements — and
this is mostly the wiring between them plus the one thing none of them had: a
unit of work that outlives its request.

## 2. Why it is shaped the way it is

### A job is an invoice

Measured (see CLAUDE.md's live-progress note): a cold search is 40–70 seconds
of model writing and roughly $0.36. Fifty of them is half an hour and ~$18. So
the design is a spend design first:

- **`BULK.MAX_ADDRESSES = 50`**, a hard ceiling in the pure module, with the
  per-visitor half in `entitlements.js` as `bulkMaxAddresses`. The parser
  clamps the entitlement to its own ceiling, so a larger number in
  entitlements can never widen a job.
- **One live job per member**, read from the DATABASE rather than from
  in-process state, so a restart cannot let somebody start the same list
  twice and pay for it twice.
- **The count and the time are said before the button**, not after. The Run
  button is disabled while a run is going, with the reason beside it — the
  Buy-button rule.
- **Cache hits are free and common**: a member re-running last quarter's list
  pays for almost none of it, and the row says `cached` so the difference is
  visible rather than mysterious.

### It outlives the request

The POST answers in milliseconds; the worker runs for up to half an hour. So
nothing in the worker may hold `req` or `res` — which is why
`vaultCompsForReport` was changed to take a `user` (it only ever wanted
`getSessionUser(req)`), and why `orgCompsForReport` dropped the `req` it never
read.

### The process can die under it

A deploy restarts Render mid-run. There is deliberately **no timer and no boot
sweep** — migration 025's argument, restated: a timer fires at an hour nobody
chose, and a boot sweep fights a second instance. Instead the worker records a
`heartbeat_at` after every row, and a READ decides a job stalled (older than
`BULK.STALL_MS`, and not being worked by this process), marks it
`interrupted` once, and says so on screen.

Nothing is lost when that happens: every finished row was already written, and
re-running the same list serves the finished addresses from cache for free.

### One number, one place

The value in a bulk row is `VALUATION.valueFromComps`' own answer, reached
through the same `runCompSearch` and `finishReportForViewer` that `/api/comps`
uses. That is the whole reason those two came out of the handler: a portfolio
whose rows were assembled differently from the reports behind them would
disagree with every one of them, and there would be no way to see that from
either screen. A broker's own vault comps and their firm's shared comps blend
into their own bulk rows exactly as they blend into their own reports.

## 3. Reading the list

Two shapes, and the distinction is load-bearing.

**Without a header row, every line is one whole address** and nothing is split
on commas. `123 Main St, Boise, ID 83702` is one address containing two
commas; a parser that split it would search for `123 Main St` in no particular
city and read `83702` as a square footage. A pasted list is the common case
and must never need quoting.

**With a header naming an address column**, the text is parsed as CSV (through
`broker-vault.js`'s own parser — BOM, quotes, `#` note lines) and `size` and
`label` columns are read alongside. A supplied size skips the model's
two-search size lookup and, more importantly, cannot be the wrong building's
footprint.

Three refusals, all reported rather than silent:

- **A line with no digit is not an address** (`Downtown Boise`). The
  single-property flow catches this at the address-confirm dialog; fifty
  confirmations is not a workflow, so it is caught here and named. Spending a
  billed search on a submarket and printing a dollar figure under it is the
  failure `isAggregateAddress` exists to stop in the comp data.
- **Duplicates are dropped across punctuation drift** and counted.
- **A size cell that will not parse is warned about**, never silently ignored
  — the vault column mapper's rule. The row still runs; we look the size up.

Truncation past the cap is reported too. A list quietly shortened reads as a
list fully valued.

## 4. What a row says, and what it refuses to say

- The total sums only the rows that produced a dollar figure, and states how
  many. A failed lookup is **not** $0 — that would read as a cheap portfolio
  rather than an incomplete one.
- "No priced sale comps in this window" and "no building size found" are
  different answers with different fixes, and the row says which.
- The comp count shown is **sale** comps, not total comps: the band comes from
  the sales, and a lease-heavy report showing "10" would imply ten deals
  behind the number.
- Below four sale comps the band is the full observed spread rather than the
  weighted interquartile one; the row marks it "wide band".

## 5. What was deliberately not built

- **Mixed property types in one job.** A list a broker pastes is a portfolio
  or a pipeline — industrial buildings, or a fund's retail centers. A mixed
  list is two jobs, which is honest about the fact that comps for a warehouse
  and a house are found by different searches.
- **Per-address lookback, focus or subject details.** Same argument; the
  single-property form is where one building gets its own treatment.
- **Resuming an interrupted job automatically.** Re-running the list is
  already the resume: finished addresses come back from cache for free. A
  resume button would be a second, subtly different code path for something
  the cache does correctly.
- **A shareable bulk report.** `/api/share` publishes ONE report. A portfolio
  share is a different object with its own privacy questions (fifty addresses
  a member owns is a more sensitive document than any one of them) and should
  be designed as one, not fall out of this.
- **Scheduling / recurring runs.** Same reason the watchlist digest is a route
  and not a timer.

## 6. Entitlement

`canBulkValue` tracks `pro`, with three deliberate exclusions:

- **A dark deployment (`PRO_ENABLED` off) grants it to nobody.** The vault's
  asymmetry, for a sharper reason: "pre-Pro behavior" restores what visitors
  used to have free, and this did not exist — and unlike the vault it is not
  merely an access surface but a SPEND surface, so granting it on a deployment
  that has not switched Pro on yet (the default) hands out an unmetered
  invoice.
- **A beta tester (`TESTER_PASSKEY`) does not get it.** One string handed to a
  group; "try Pro's reports" is what the code is for, and a report at a time
  is what it grants.
- **The retired $20 single-report unlock does not reach it.** The Address
  Explorer's argument and then some: a one-off is scoped to one address+type,
  and a tool whose purpose is running fifty OTHER addresses cannot be scoped
  to one of them.

There is **no header-only bypass**, unlike `/api/comps`' `internal`. A bypass a
browser was never meant to have must not grow one on a spend amplifier.

## 7. Open questions

- **Is 50 the right cap?** It was chosen as "a number a person can be shown
  before committing to it" (~30 minutes, ~$18). The first real bulk run is the
  evidence; raise it deliberately, not by drift.
- **Should a firm share a run?** Migration 030's shelf holds shared reports; a
  bulk run is a natural second thing for it to hold, and is exactly the case
  the shelf's own note says makes an `org_shelf_items` table worth building.
- **Per-address property type** keeps being asked for by the mixed-list case.
  If it ships, the type belongs on the item and not the job, and the parser
  needs a `type` column with the same not-a-guess discipline as `size`.
