# No property type picker: CompNinja works it out (2026-10-09)

**Status: built on 2026-10-09** (branch
`claude/property-type-ai-accuracy-xeydiv`). What was built differs from this
draft in five places:

- **Step 1 reads only the lookup's own memory** (`subject_types`, keyed like
  `subject_sizes`), not the member's reports, the corpus or `search_cache`.
  Those older rows were typed by a picker that silently started on
  Industrial, so they would hand the old mistake straight back.
- **Step 2 (the map) is unchanged** on the main form and is not used on
  `/bulk` or in the server's lookup.
- **Step 4 (the double-check field) was not built.** The report instead
  has a "Wrong type?" button beside its header that re-runs it as the type
  picked, and logs `found_retyped` (or `report_retyped` when the type was
  not the lookup's).
- **A `/bulk` run with no type is stored as `Auto`**, not "Mixed", and
  reads "type found per address"; each row stores and shows its own type.
- **The accuracy line is a "Type lookup" tile on `/admin`** (built the
  same day): the share of answers nobody overturned, with how many were
  settled on the first look, needed the second, were remembered or failed,
  and the median seconds. A correction counts only when the lookup chose
  the type (`lookup_changed`, `found_retyped`).

The Gemini gate below **passed** on 2026-10-10: 38/40 (95%) on holdout2
and 60/60 (100%) on holdout, on `gemini-3.7-flash` with Google Search.
Gemini said `high` on all 100 answers, so the deep pass never ran, and both
misses were `high` (the misses and seconds per call are in
`docs/evals/2026-10-09-property-type-guess.md`, "Gemini check"). Rules live in
`.claude/rules/search-pipeline.md`, `bulk.md` and `report-and-valuation.md`.

## The goal

Nobody ever picks a property type again. CompNinja works out what the
building is from the address alone. It has to be quick (done before the
person presses Run), free or close to it, and right at least 9 times out
of 10.

Why: people forget the picker, and the report is then built for the wrong
kind of building. The worst place is the Comp report page (`/bulk`), whose
type box silently starts on Industrial
(`docs/evals/2026-10-09-property-type-guess.md`).

## The answer in one line

**A quick AI lookup on every address, then a deeper one only when the
quick one isn't sure.** On 100 real addresses that were never used to
write the instructions, it got **97 right**. Every answer it called "high
confidence" was right (88 of 88).

## How it works: four checks, cheapest first

Each check runs only when the one before it has no answer.

1. **Already known.** Free and instant. Before looking anything up,
   CompNinja checks what it already knows about that exact address: the
   member's own earlier reports and saved properties, their firm's
   buildings, the comp corpus (every comp in it has a type, and it grows
   with every report), and earlier searches of the address (`search_cache`
   rows carry `address_key` and `prop_type` since migration 020). An
   address that has been through CompNinja once is never looked up again.
2. **The map.** Free, about 1 second. OpenStreetMap tags many buildings
   (warehouse, apartments, retail). The main form already reads these tags
   (`detectPropertyType`), and a tag only counts when its street number
   matches the address. It already runs today and logs how often people
   undo it. It was not part of this test.
3. **AI lookup, in two steps.**
   - **Quick lookup.** One small Gemini call with Google Search, up to 3
     searches, on every address that reaches this step. It answers with a
     type and how sure it is.
   - **Deep lookup.** It runs only when the quick answer is not "high". It
     is a second call that may use up to 6 searches. It looks at the
     county's parcel record (whose land-use code names the type), listing
     and deal sites for that exact street number, and the businesses
     listed at that number. That was 45 of the 100 test addresses.

   Both start the moment the address is entered, the way the map check does
   today, so they are usually done before the person presses Run. The
   answer is remembered per address, the way building sizes are
   (`subject_sizes`), so an address never costs twice.
4. **Double-check from the report.** Free. The comp search already looks
   the property itself up first, to find its size. It will also report the
   type it saw there. If that disagrees with step 3, the report says so in
   one line and offers a one-click re-run as the right type.

**On screen there is no picker anywhere.** The report already names the
type in its header. It gains one quiet line, "Valued as an office
building", with a small "Wrong type?" link that re-runs the report. The
link is a correction someone *may* use, never a question they have to
answer.

## Does it reach 90%? Measured: yes, 97 of 100

Every test address is a real deal from `market-seed.json`, labelled with
the type its deal was found as. 80 of the first 85 also carry that type's
own facts (clear height, unit count, anchor tenant). The AI saw only the
address. Every miss was checked against its deal record, and in all three
test rounds the deal record held up.

| | Quick lookup alone | Quick + deep |
|---|---:|---:|
| Fresh set A, 60 addresses | 51 (85%) | **59 (98%)** |
| Fresh set B, 40 addresses, nothing tuned on it | 37 (92.5%) | **38 (95%)** |
| **Both, 100 addresses** | **88** | **97** |
| Answers marked "high confidence" | all right | **88 of 88 right** |

Things worth knowing about those numbers:

- **Set B is the cleanest test.** I wrote the deep-lookup instructions
  after seeing the quick lookup's misses on set A, so set A's 98% may
  flatter it. Set B was built afterwards, from deals neither set had used,
  and the instructions were frozen before it ran.
- **Better wording alone did not help.** Rewritten quick-lookup
  instructions (version 2) scored the same as the originals: 36 vs 36 on
  the 41 fresh addresses both actually searched. What moved the number was
  the second, deeper look at the unsure third.
- **The 3 misses** were one building with no page of its own online,
  answered from its street, and two genuinely mixed buildings: an
  office-plus-warehouse building whose deal says Industrial, and an old
  store marketed for retail or warehouse use whose deal says Retail.
- **By type** (both sets): Office 25/25, Multifamily 25/25, Industrial
  24/25, Retail 23/25.
- **The very first test** (85 addresses, quick lookup only) scored 72
  (85%), the same as the quick lookup here.

Files: `docs/evals/type-guess/holdout/` (set A) and `holdout2/` (set B).
Each holds the labels (`set.json`), what the AI saw (`blind-batches.json`)
and every answer with its evidence sentence. Score any of them with
`node scripts/type-guess-eval.js score <set.json> <quick.json> <deep.json>`.

## Quick

- Steps 1 and 2 take under a second.
- Step 3 starts while the person is still looking at the address check.
  The quick lookup is a few words after one to three searches. Production
  Gemini at low thinking writes a whole report in about 10 seconds
  (`docs/evals/2026-08-22-thinking-level-decision.md`), so a few seconds
  is the expectation. The deep lookup adds more, but only for the unsure
  ~45%. **Neither speed is measured on Gemini yet.** The `run` command
  below prints seconds per call.
- In a Comp report run, each address already takes 40 to 70 seconds, so
  this barely changes the wait there.

## Free

- Steps 1, 2 and 4 cost nothing.
- Step 3 uses Google Search inside Gemini. That is free up to 5,000
  searches a month, an allowance the comp reports share
  (`search-provider-gemini.js`). A new address uses about 3 searches, plus
  up to 6 more when the deep lookup runs. The words themselves cost well
  under a cent.
- Past the free allowance, searches cost $14 per 1,000, which is at most
  about 8 to 13 cents for a new address that needs the deep lookup.
- An address is looked up once and remembered after that, and every
  report adds more addresses to step 1.

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

The before and after pictures rule applies to all four once built.

## What it takes to build

1. **Server.** `resolvePropertyType(address, user)` runs steps 1 to 3.
   Step 1 reads only the member's OWN private rows (never another
   account's vault, never a firm they are not in), under the privacy-wall
   rule. Answers are memoised in a new `subject_types` table shaped like
   `subject_sizes`, with one migration that runs before the deploy (rule
   9). The two prompts are `guessPrompt` versions 2 and 3, rewritten for
   one address at a time. `POST /api/property-type` lets the browser start
   it early. `/api/comps` and the bulk worker call it themselves whenever
   no type is sent, so no path can run without one.
2. **Comp report page.** A new `bulk_job_items.property_type` column (a
   migration, run first). The worker resolves each row before its search,
   and the job's type reads "Mixed" when rows differ. `#bulkType` goes.
3. **Main form and list mode.** Wire them to the route and remove the
   pickers.
4. **The double-check.** A top-level `subject_type` field from the
   search's existing subject lookup. It sits with the other subject
   lookups above `comps` (the field-order rule in `search-pipeline.md`).
   The "Valued as … / Wrong type?" line goes on the report.
5. **Keeping score.** Log every resolution (which check answered, and how
   sure it was) and every "Wrong type?" click, and show the live accuracy
   on `/admin`. That is how we know 90% holds on real users' addresses
   and not just on the test sets.

**Gate before building steps 2 and 3:** run the same test on the
production model.

```bash
node scripts/type-guess-eval.js run docs/evals/type-guess/holdout2 --provider gemini --prompt 2 --two-step --deep-thinking medium
node scripts/type-guess-eval.js run docs/evals/type-guess/holdout  --provider gemini --prompt 2 --two-step --deep-thinking medium
```

It needs `GEMINI_API_KEY` in `.env`, costs a few cents, and prints the
score and the seconds per call. Continue if it clears 90%.

## Honest limits

- **The AIs tested are Claude models standing in for Gemini**: Haiku for
  the quick lookup, Sonnet for the deep one, both on Claude's own web
  search. This workspace cannot reach Google's API. The gate above closes
  that gap before anything ships. Gemini searches with Google itself,
  which should find addresses at least as well, but that is a guess until
  the gate runs.
- **The test addresses are easier than average.** Every one is a building
  that recently sold or leased, so it is findable online by construction.
  Someone's own building may never have traded. Steps 1, 2 and 4 and the
  live accuracy line on `/admin` exist for exactly that.
- **Houses are untested** (the seed has no house deals), and **land was
  only in the first, quick-only test** (5 addresses, all right). Houses are
  the most-listed property type online (Zillow, Redfin, Realtor), but that
  is a guess until measured.
- **Mixed buildings stay hard.** Two of the three misses were flex or
  mixed-use buildings where either answer is defensible. The double-check
  and "Wrong type?" are the backstop for those.
- **One test round was thrown out.** Running 18 AI testers at once ran
  into a web-search limit, and many answers came back unsearched. Those
  were all re-run or left out of the numbers above. The partial control
  run is kept as `holdout/guesses-haiku-v1-control.json`, with 19 of its
  60 answers unsearched.
- **The other picker-shaped controls are left alone**: the add forms for a
  firm building or a vault comp, and the filters on `/vault`. They record
  a type someone already knows, or filter by one. They do not ask anyone
  to remember a setting before a report runs.
