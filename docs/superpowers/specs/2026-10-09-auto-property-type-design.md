# No property type picker: CompNinja works it out (draft, 2026-10-09)

**Status: draft for the owner to approve. Nothing here is built yet.**

## The goal

Nobody ever picks a property type again. CompNinja works out what the
building is from the address alone. It has to be quick (done before the
person presses Run), free or close to it, and right at least 9 times out
of 10.

Why: people forget the picker, and the report is then built for the wrong
kind of building. The worst place is the Comp report page (`/bulk`), whose
type box silently starts on Industrial
(`docs/evals/2026-10-09-property-type-guess.md`).

## How it works: four checks, cheapest first

Each check runs only when the one before it has no answer.

1. **Already known.** Free, instant. Before looking anything up, CompNinja
   checks what it already knows about that exact address. That means the
   member's own earlier reports and saved properties, their firm's
   buildings, the comp corpus (every comp in it has a type, and it grows
   with every report), and earlier searches of the address (`search_cache`
   rows carry `address_key` and `prop_type` since migration 020). An
   address that has been through CompNinja once is never looked up again.
2. **The map.** Free, about 1 second. OpenStreetMap tags many buildings as
   warehouse, apartments, retail and so on. The main form already reads
   these tags (`detectPropertyType`), and a tag counts only when its street
   number matches the address. This check stays as it is.
3. **AI lookup.** About a cent, a few seconds. One small Gemini call with
   Google Search, using the improved instructions measured below
   (`guessPrompt` version 2 in `scripts/type-guess-eval.js`). It starts the
   moment the address is entered, the way the map check does today, so it
   has finished by the time the person presses Run. The answer is
   remembered per address, the way building sizes are (`subject_sizes`),
   so the same address never costs twice.
4. **Double-check from the report.** Free. The comp search already looks
   the property itself up first, to find its size. It will also report the
   type it saw there. If that disagrees with step 3, the report says so in
   one line and offers a one-click re-run as the right type.

**On screen there is no picker anywhere.** The report already names the
type in its header. It gains one quiet line, "Valued as an office
building", with a small "Wrong type?" link that re-runs the report. The
link is a correction a person *may* use and is never a question they must
answer.

## Does it reach 90%? (measured)

Measured on real deals from `market-seed.json`. The guesser saw only the
address, and every miss was checked against its deal record. Version 2's
instructions were written after reading version 1's misses, so its honest
score is on the **fresh 60-address set** that neither version was written
against.

_Results pending: the version 2 runs were hit by a web-search rate limit and are being re-run._


## Quick

- Steps 1 and 2 take under a second.
- Step 3 starts while the person is still looking at the address check,
  in the same place the map check runs today. Production Gemini at low
  thinking writes a whole report in about 10 seconds
  (`docs/evals/2026-08-22-thinking-level-decision.md`), and this answer is
  a few words after one to three searches. **Its speed is not measured
  yet.** The rerun below measures it.
- In a Comp report run, each address already takes 40 to 70 seconds, so a
  few seconds more per row does not change the wait.

## Free

- Steps 1, 2 and 4 cost nothing.
- Step 3 is one small Gemini call. Google Search inside Gemini is free up
  to 5,000 searches a month, an allowance the comp reports share
  (`search-provider-gemini.js`), and this uses one to three per new
  address. The words themselves cost well under a cent per address. Past
  the free allowance, searches cost $14 per 1,000, so a lookup that uses
  all three costs about 4 cents.
- An address is looked up once and remembered after that.

## What changes on screen

- **Comp report page (`/bulk`).** The Property type box is gone. Each
  address gets its own type, so a list mixing warehouses and offices just
  works. Today one type covers a whole run (migration 036; `bulk.md` lists
  "mixed types in one job" as not built). The results table shows each
  row's type.
- **Main form (`/`).** The address check stops asking. Its six type
  buttons and the hold on the Run button (`showConfirmTypeButtons`) are
  replaced by the found type, shown as plain text.
- **List mode on `/`.** The `#bkListType` box is gone, for the same reason
  as `/bulk`.
- **Report.** "Valued as …" with "Wrong type?", plus the double-check line
  when step 4 disagrees.

The before and after pictures rule applies to all four once they are
built.

## What it takes to build

1. **Server.** `resolvePropertyType(address, user)` runs steps 1 to 3.
   Step 1 reads only the member's OWN private rows: never another
   account's vault and never a firm the member is not in, under the
   privacy-wall rule. Answers are memoised in a new `subject_types` table
   shaped like `subject_sizes`, with one migration that must run before the
   deploy (rule 9). `POST /api/property-type` lets the browser start it
   early. `/api/comps` and the bulk worker call it themselves whenever no
   type is sent, so no path can run without one.
2. **Comp report page.** A new `bulk_job_items.property_type` column (a
   migration, run first). The worker resolves each row before its search,
   and the job's type reads "Mixed" when rows differ. `#bulkType` goes.
3. **Main form and list mode.** Wire them to the route and remove the
   pickers.
4. **The double-check.** A top-level `subject_type` field returned from the
   search's existing subject lookup. It sits with the other subject
   lookups above `comps` (the field-order rule in `search-pipeline.md`).
   The "Valued as … / Wrong type?" line goes on the report.
5. **Keeping score.** Log every resolution (which check answered, and how
   sure it was) and every "Wrong type?" click, and show the live accuracy
   on `/admin`. That is how we know the 90% holds on real addresses and
   not just on the test set.

**Gate before step 2.** Run `node scripts/type-guess-eval.js run --provider
gemini --prompt 2` on both test sets (a few cents, 13 calls) and continue
only if the production model also clears 90%. If it falls short, the
fallback is a second, deeper call only for the low-confidence answers
(about one in five addresses).

## Honest limits

- **The AI tested here is Claude Haiku, standing in for Gemini Flash.**
  This workspace cannot reach Google's API. The gate above closes that gap
  before anything ships.
- **The test addresses are easier than average:** every one is a building
  that recently sold or leased, so it is findable online by construction.
  A person's own building may never have traded. Steps 1, 2 and 4 and the
  live accuracy line on `/admin` exist for exactly that.
- **Houses are untested** (no house deals in the seed) and **land has only
  5 test addresses**. Houses are the most-listed property type online
  (Zillow, Redfin, Realtor), so they should be easy to find, but that is
  a guess until it is measured.
- **The other picker-shaped controls are left alone**: the add forms for a
  firm building or a vault comp, and the filters on `/vault`. Those record
  a type a person already knows, or filter by one. They do not ask
  someone to remember a setting before a report runs.
