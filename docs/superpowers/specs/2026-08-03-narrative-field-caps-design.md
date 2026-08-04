# Notes-style caps for the four narrative fields

Date: 2026-08-03
Status: approved (owner, in-session)

## Problem

Report wall-clock is dominated by the model WRITING the output (~78 tokens/sec),
so output size is the speed lever. The notes cap (avg note 139 -> 104 chars,
report 13% shorter) proved the recipe: a hard character bound plus the observed
bloat patterns banned by name, with the honesty content explicitly protected.
The four narrative fields never got that treatment. Measured on a real report
(6700 W Gowen Rd, Boise, 2026-08-03, 6,417 chars of JSON):

- `summary` 941 chars (14.7% of the report). Contains both notes-bloat
  patterns: restates individual comps' figures ("transacted at $116/SF
  (239,684 SF, Jul 2026)", names "873 E Citation Ct") which the comp table
  already carries, and narrates search methodology ("the radius was widened to
  include Canyon County...") which the `search_radius` field already carries.
- `value_drivers` 499 chars; entries up to 172 chars, written as explained
  mini-paragraphs with tenant name lists.
- `market_trend` 326 chars for what the prompt asks as "one sentence".
- `price_discovery` 388 chars.

Together 2,154 chars = 33% of that report.

## Goal

Cap all four fields in the prompt, notes-style. Expected: roughly 1,000 fewer
chars per report (~16% on the sample), a few seconds off every billed search's
write phase, marginally lower cost. No information the reader needs is lost:
everything banned already lives in another field or column.

## Non-goals

- No `max_tokens` change (the cap stays a QUALITY instruction; a low token cap
  would sever the JSON mid-array).
- No parsing, normalization, client, or cache-key changes. Old cached reports
  keep their longer narratives and render unchanged.
- No change to the honesty rules that REQUIRE caveats in summary (comps
  outside the window, widened radius, size mismatch); the cap gives them a
  designated compact slot instead.

## Design (all in `buildPrompt`, server.js)

1. `summary`: at most THREE short sentences, under about 450 characters
   total, structured: (1) the single thing an owner most needs to know,
   (2) the market-level read the comps support, (3) any required caveats
   compressed into one clause. Banned by name: any individual comp's address,
   price, size, or date (the comp table and its notes carry those); tenant or
   company name lists; narrating the search beyond the single required caveat
   clause. Market-level figures (a $/SF spread, a vacancy rate) remain
   welcome. The schema line's inline description is updated to match.

2. `value_drivers`: keep 2 to 3 entries, each under about 80 characters,
   phrased as a named factor plus its direction; no explanations, tenant
   lists, or parentheticals.

3. `market_trend`: one SHORT sentence, under about 140 characters.

4. `price_discovery.note`: 1 to 2 short sentences, under about 200 characters.

## Side effects considered

- Market pages / snapshots inherit tighter narrative copy; 3 real sentences
  is still substance. Acceptable.
- The prompt grows slightly, staying far above the 1,024-token prompt-caching
  floor.
- The live preview (shipped earlier today) shows the summary on the loading
  card, where shorter reads better.
- CLAUDE.md's output-composition paragraph currently says summary and
  value_drivers are "still uncut if more is ever needed"; it must be updated.

## Verification

One real billed search (~$0.36) on a fresh address. Assert: summary <= ~500
chars, each value_driver <= ~90, market_trend <= ~160, price_discovery.note
<= ~220; any required caveat survives; total report size compared against the
6,417-char Boise baseline. Devlog entry ships in the same commit.
