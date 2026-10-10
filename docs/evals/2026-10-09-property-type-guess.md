# Can AI pick the property type from the address? (2026-10-09)

> **Follow-up, same day:** a second, deeper lookup run only on the answers
> that were not "high confidence" took this to 97 of 100 on two fresh sets
> of addresses (`docs/superpowers/specs/2026-10-09-auto-property-type-design.md`).
> That is the draft for removing the picker entirely.

**Short answer: yes when it finds the building, no when it doesn't, and it
knows which is which.** With web search, the AI got 72 of 85 real addresses
right (85%). Every one of its 56 "high confidence" answers was right. All 13
mistakes were answers where it had not found the address itself and
guessed from the neighbours. Without web search it was a coin flip (51%).

## Gemini check (2026-10-10)

The design doc's gate, run on the production model: `gemini-3.7-flash` (the
provider default; no `MODEL` or `THINKING_LEVEL` set) with Google Search,
prompt version 2, two-step with the deep pass at medium thinking. The
commands are the two under "Gate before building" in
`docs/superpowers/specs/2026-10-09-auto-property-type-design.md`.

| | holdout2 (the clean test) | holdout |
|---|---:|---:|
| Quick + deep | **38/40 (95%)**, pass (needs 36) | **60/60 (100%)**, pass (needs 54) |
| "high" confidence answers | 38/40 right (95%) | 60/60 right (100%) |
| Seconds per call | 17.5 to 25.4, mean 20.6 (10 addresses a call) | 21.6 to 38.1, mean 26.5 (12 addresses a call) |

Three things the scores hide:

- **Gemini said `high` on all 100 answers**, so the deep pass never ran (0
  unsure on both sets). The score is the quick lookup alone, and the deep
  pass is still unmeasured on Gemini.
- **Both misses were `high`.** On Haiku every `high` answer was right
  (56/56); on Gemini 98 of 100 were. Auto-picking only on `high` filters
  nothing here, so a confident wrong type reaches the report about 2 times
  in 100. "Wrong type?" and the `/admin` Type lookup tile are what catch it.
- **A call here is a batch** of 10 or 12 addresses, about 2 seconds of batch
  time per address. The design makes one call per address, and this script
  does not time that.

Both misses are on holdout2:

| id | Address | Label | Gemini said | Gemini's evidence |
|---|---|---|---|---|
| g010 | 390 E Corporate Dr, Meridian ID | Industrial | Office (high) | "LoopNet classifies this multi-tenant commercial property as an office building." |
| g032 | 7001 Lyons Ave, Houston TX 77020 | Retail | Industrial (high) | "Commercial listings on LoopNet and Showcase designate the site as an industrial and logistics facility." |

Both are mixed buildings where the earlier Sonnet deep run gave the same
answer as Gemini: g010 is a two-story multi-tenant office building with some
warehouse space, and g032 is a 1950 building listed as both Retail and
Industrial and marketed for warehousing. Neither was rechecked by hand
against its deal record this time. Answers are in `guesses-gemini-v2.json`
(and an empty `guesses-gemini-v2-deep.json`) under `holdout/` and
`holdout2/`.

## Why this was asked

The owner wants the property-type picker gone: people forget to set it, and
the report is then built for the wrong kind of building. The forgetting is
worst on the Comp report page (`/bulk`, the rail's Comp report row since
2026-10-08). Its `#bulkType` select has no empty option, so it **silently
starts on Industrial**. A run nobody touched values an office tower, a strip
center or an apartment complex against warehouse comps, with no error
anywhere. (The single-address form on `/` does not have this problem: the
type is resolved by OSM tags, by per-address memory, or by a required pick in
the confirm dialog. See `report-and-valuation.md`, flow 4.)

## What was measured

- **Addresses:** 85 real deals from `market-seed.json`: 20 Industrial, 20
  Office, 20 Retail, 20 Multifamily and 5 Land, spread round-robin over 40
  market pages in 25 cities. Each was found by a search *for* that type, and
  80 of the 85 carry that type's own fields (clear height and dock doors,
  unit counts, anchor tenants, acreage), so the labels are real deals and not
  guesses. Submarket rows with no street number were left out, since a person
  types a street address. **Residential is not covered**: the seed has no
  house comps.
- **The guesser saw only the address.** The addresses were shuffled across
  types and cities into 8 blind batches. The prompt (`guessPrompt` in
  `scripts/type-guess-eval.js`) uses the app's own type definitions and asks
  for a confidence level: `high` only if the guesser found or knows that exact
  address.
- **Model:** Claude Haiku, a small, cheap model, used as a stand-in for a
  cheap production call. It ran in two arms: with web search (at most 2
  searches per address) and with no lookup at all. **Production runs Gemini
  Flash, and this container had no Gemini key**, so Gemini itself is not
  measured here. The `run` command below runs this same test on Gemini.
- **Every miss was checked by hand** against its deal record, to see whether
  the label or the AI was wrong.

## Results

| | No lookup | With web search |
|---|---:|---:|
| Overall | 43/85 (51%) | **72/85 (85%)** |
| Industrial | 14/20 | 14/20 |
| Office | 15/20 | **20/20** |
| Retail | 12/20 | 16/20 |
| Multifamily | 2/20 | 17/20 |
| Land | 0/5 | **5/5** |
| "high" confidence answers | 2/2 | **56/56 (100%)** |
| "medium" | 14/14 | 8/11 (73%) |
| "low" | 27/69 (39%) | 8/18 (44%) |

**With search, confidence is the whole story.** It said `high` on 56
addresses (66%) and was right on all 56. Below `high` it was right on 16 of
29 (55%). Split another way, by what the guesser *said* it found: on the 64
addresses where it found the address itself it was right on 63 (98%), and on
the 21 where it wrote "no record found, but nearby is…" it was right on 9
(43%).

**Without search it cannot tell an apartment complex from a street**: 2 of
20 Multifamily right. Apartment addresses look like any other address
("1470 Sheridan Rd NE", "2421 W Slaughter Ln"), so it called them houses,
shops or warehouses.

## Every miss, checked

All 13 web-search misses were the AI's mistake, not the label's. Each record
has a deal page naming the type and that type's own details:

| id | Address | Really | AI said | What the record shows |
|---|---|---|---|---|
| t004 | 2501 Avenue J, Arlington TX | Industrial | Office (medium) | traded.co industrial sale, 84,469 SF multi-tenant; the AI used a doctor's suite listing |
| t007 | 1058 S Ewing St, Indianapolis IN | Industrial | Residential (low) | 2,400 SF owner-user shop, 12 ft clear, grade-level door; small enough to read as a house |
| t008 | 4080 N Pecos Rd, Las Vegas NV | Industrial | Retail (medium) | 33,075 SF, 24 ft clear, dock doors, leased to Aloha Shoyu; the AI used an exit guide naming a nearby restaurant |
| t014 | 2078 Rustin Ave, Riverside CA | Industrial | Office (low) | 44,609 SF warehouse bought by Hyundai Rotem (LA Times) |
| t015 | 125 Feldspar Dr, Savannah GA | Industrial | Land (low) | 2023 distribution building, 183 dock doors; the AI found the vacant parcel next door |
| t020 | 13201 Dahlia St, Fontana CA | Industrial | Residential (low) | 278,650 SF, leased to Eaton (JLL); the AI guessed from another street's name |
| t029 | 58-64 W Neff Ave, Columbus OH | Multifamily | Residential (low) | 22 units |
| t031 | 2751 E Bonanza Rd, Las Vegas NV | Multifamily | Retail (low) | Bonanza Gardens Apartments, 171 units |
| t044 | 10525 Steele Creek Rd, Charlotte NC | Multifamily | Residential (low) | Steele Creek Apartments, 36 units (Northmarq) |
| t068 | 13606 Kuykendahl Rd, Houston TX | Retail | Industrial (low) | former Walgreens, sold for new retail use |
| t073 | 5435 N Loop 1604 W, San Antonio TX | Retail | Office (low) | single-tenant net-lease Carvana |
| t076 | 1344 Yale St, Houston TX | Retail | Multifamily (medium) | 1930 urban storefront; the AI used the apartments across the street |
| t085 | 8671 W Charleston Blvd, Las Vegas NV | Retail | Office (low) | Kohl's- and Walgreens-anchored community center |

The pattern is the finding. The AI goes wrong in exactly one way: it can't
find the building, so it describes the neighbourhood. When it does find the
building it is right. And it says which case it is in, both in its
confidence and in its own evidence sentence.

## What this means for removing the picker

1. **Set the type automatically only on a `high` answer, and ask otherwise.**
   On this set that fills the type for about two out of three addresses with
   no errors. The other third gets a required question with **no
   default**. A silent wrong guess is the failure we are trying to remove,
   so trading the silent Industrial default for a silent AI guess at 44%
   would be no fix.
2. **Fix the `/bulk` default now, whatever happens with AI.** Starting the
   select on an empty "Choose a property type…" option that blocks the run,
   the way `#bkListType` on `/` already does, ends the silent-Industrial
   runs today at no cost. That is the bug behind the request.
3. **Bulk runs need one type per row** before AI can fill them in. Today a
   whole run carries one `property_type`, so a mixed upload has nowhere to
   put a different guess for each row.
4. **Run it on the production model before building.** Haiku is not Gemini
   Flash. The command below asks Gemini the same 85 questions in 8 calls.
   Search grounding is inside Gemini's free monthly allowance at this volume
   (see `search-provider-gemini.js`), so it costs a few cents.
5. **Not covered here:** houses (no Residential ground truth), mixed-use
   buildings, and how fast a single call is. A batch of 11 took 1 to 2.5
   minutes in the test harness, but that includes agent overhead and is not
   a production timing. Note that 4 of the 13 misses guessed Residential, so
   test houses before trusting a Residential guess.

## Reproduce

```bash
node scripts/type-guess-eval.js build                       # rewrites docs/evals/type-guess/{set,blind-batches}.json (deterministic)
node scripts/type-guess-eval.js run --provider gemini       # needs GEMINI_API_KEY; billed
node scripts/type-guess-eval.js run --provider gemini --no-search
node scripts/type-guess-eval.js score docs/evals/type-guess/set.json docs/evals/type-guess/guesses-haiku-web.json
```

Files in `docs/evals/type-guess/`: `set.json` holds the labels and the
guesser never saw it; `blind-batches.json` is what the guesser saw;
`guesses-haiku-web.json` and `guesses-haiku-nosearch.json` are this run's
answers, each with its evidence sentence.
