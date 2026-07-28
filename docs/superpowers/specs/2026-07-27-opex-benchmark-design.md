# Operating-expense benchmark — Design

Date: 2026-07-27
Status: approved by owner (this doc records the design conversation)

## Goal

Roadmap item #8 from the friend-feedback list. The report already tells an
owner what their building is worth and what the market pays per square foot.
It says nothing about whether the building is *run* in line with its market.

This adds one card to the Analysis tab: the user's own numbers say what they
actually spend running the building, the market says what is typical for that
asset class and lease structure, and the card shows the gap.

The friend's one-line framing: "here is where you could improve" — expressed
as a benchmark, never as advice.

Companion to the existing Analysis cluster (#-series toolkit work,
`2026-07-19-pro-analysis-toolkit-design.md` and
`2026-07-19-toolkit-phase2-rentroll-tabs-design.md`), which established the
card pattern, the client-side privacy boundary, and the free-account gate this
card reuses wholesale.

## Decisions already made (owner-approved)

- **Gross income is the second input, entered on the card.** NOI alone cannot
  produce an expense ratio. Gross beats "total expenses" because the friend's
  framing is already percent-of-gross, owners know their gross collections
  cold while "total expenses" invites bookkeeping ambiguity, and gross gives a
  free validity check (gross must exceed NOI). It goes on the card, not in
  "Your property details" — so the search form does not grow at all.
- **The market range comes from the model, not a static table.** One more
  field on the existing billed search, exactly like `market_cap_rate_range`.
  A static per-type table would be generic, would go stale, is not
  market-specific, and would put CompNinja in the position of asserting the
  benchmark rather than reporting it.
- **Free-account gate, not fully free and not paid-first.** Ships in the
  locked cluster beside debt / sensitivity / rent-roll. The paid tier does not
  exist and should not be invented for one card.
- **Benchmark, never advice.** Same rule as `price_discovery`. No colored
  judgment on the ratio, no "you should".
- **Gross income is private finance.** It is NOI-class: browser-only, never
  sent to `/api/comps`, stripped by `/api/share`.

## 1. Placement

New `#opexCard` inside `#tabAnalysis`, positioned **first among the gated
cards** — after the free DCF card and the `#analysisLockCard`, before
`#debtCard`.

Rationale: this card validates the NOI that every card below it is built on,
so the reader checks the input before the leveraged math that consumes it.

Built by `renderOpexCard(parsed, meta, resetAssumptions)`, called from
`renderAnalysisCluster()` (index.html) alongside its siblings so the whole
cluster re-renders together off one set of assumptions.

The guard is a copy of the debt card's:

```js
if (!noi || !currentUser) { card.classList.add("hidden"); return; }
```

That one line delivers three requirements at once:

- **Gating** — signed-out visitors get the existing lock card instead.
- **Land exclusion** — Land hides *and clears* the NOI input
  (`hideNoi` in `renderSubjectFields`), so a Land report has no NOI and the
  card can never render. No Land-specific branch anywhere.
- **Shared-report safety** — `/api/share` nulls NOI, so a shared report
  cannot render this card even before the assumptions strip below.

## 2. The input

One new field, on the card, in a `no-print` wrapper, styled exactly like the
debt card's inputs:

| Label | Input | Notes |
|---|---|---|
| Gross annual income ($/yr) | `#opexGross`, `type="text"`, `inputmode="numeric"` | comma-formatted on render like `#debtLoan`; placeholder e.g. `e.g. 1,085,000` |

Storage: `meta.assumptions.opex = { grossIncome: null }`, initialized in
`ensureAssumptions()` beside `a.debt`. An object rather than a bare number so
a later expense breakdown can extend it without a migration.

The input listener mirrors the debt listener: debounce ~250ms, clamp
(`> 0`, `<= 2e9`, otherwise `null`), `persistAssumptions()`, then
`renderAnalysisCluster(currentParsed, currentMeta, false)`.

Living in `meta.assumptions` means:

- saved reports and portfolio items re-render the card with no extra work
  (assumptions already ride that pipeline), and
- it avoids the flow-4 trap where the subject-edit listener replaces
  `meta.subject` wholesale — `meta.assumptions` is untouched by that path.

## 3. Math (client-side only)

```
expenses = gross - NOI
ratio    = expenses / gross
```

The benchmark band parses out of `parsed.market_opex_range` with the existing
`numericValue()` helper (the same treatment `market_cap_rate_range` gets).

The card also translates the gap into dollars — pure arithmetic, no judgment:
at the market's typical band, expenses on *the user's own gross* would be
`low x gross` to `high x gross`, against their actual `expenses`.

Only the above-range state carries a dollar gap, computed against the band's
high edge (`expenses - high x gross`). Below-range stays qualitative — a
dollar figure there would read as money left on the table, which is the
advice framing this card avoids.

## 4. Card layout

Three `rd-tile`s plus one `rd-tile-hi` band — the debt card's rhythm.

| Tile | Value | Sub-line |
|---|---|---|
| Your expense ratio | `38%` | operating expenses ÷ gross income |
| Typical for this market | `28-32%` | the model's `note` (lease structure) |
| Your operating expenses | `$412,000` | gross income − NOI |

The `rd-tile-hi` band carries the read: a label
`Expense Benchmark · Above typical range` and one sentence beneath it.

**No red / amber / green on the ratio.** The debt card colors DSCR because
coverage genuinely is better or worse. An expense ratio is not: a NNN
industrial owner at 8% and a full-service office owner at 45% can both be
entirely normal. Coloring it would assert a judgment the data does not
support — the advice line we are not crossing — and it keeps the card calm.

The band label follows the `price_discovery` precedent, which renders as a
plain uppercase label with a text suffix and no colored pill.

## 5. Copy

Three states, all benchmark-framed:

- **Above:** "Your expense ratio is 38%; this market typically runs 28-32% for
  industrial. That gap is about $61,000 a year on your gross income."
- **Within:** "Your expense ratio is 30%, inside the 28-32% this market
  typically runs for industrial."
- **Below:** "Your expense ratio is 12%, below the 28-32% typical here — often
  the case where leases pass most operating costs to tenants."

Nothing recommends cutting costs, renegotiating, or calls a number good or
bad. Below-range copy is as neutral as above-range copy.

Card footer, matching sibling cards: "Automated benchmark from this search,
not an audit of your books. Your income figures stay in your browser."

Empty state (signed in, NOI present, no gross entered): the two
gross-dependent tiles read `—`, while the "Typical for this market" tile
still shows the band whenever the report carries one — it is public market
data, independent of the user's input, and showing it is the invitation to
enter a gross. The benchmark band reads "Enter your gross annual income to
compare against what this market typically spends." — the same shape as the
debt card's "enter loan terms".

## 6. Prompt change (server.js)

`buildPrompt` gains one line in the JSON skeleton, beside
`market_cap_rate_range`:

```
  "market_opex_range": { "low": "", "high": "", "note": "" },
```

and one rules sentence:

> `"market_opex_range"` = typical total operating expenses for stabilized
> {type} properties in this market, as a percent of effective gross income, as
> short percent strings like "32%". `"note"` = a few words naming the lease
> structure the range assumes (e.g. "assumes NNN, owner keeps roof and
> structure" or "full-service gross"), since expense ratios depend heavily on
> it. This is a market-level benchmark for the asset class, not a statement
> about the target property. Use "" for all three if you cannot estimate it.

`note` is load-bearing, not decoration: without it the card could benchmark a
NNN owner against a gross-lease band, which is the one way this feature could
be actively misleading rather than merely absent.

**Both lines are omitted for Land searches**, using the same conditional
spread already used for `subject_size_sqft`:

```js
...(type !== "Land" ? [ /* skeleton line */ ] : []),
```

The card cannot render for Land, so we do not spend tokens asking.

No `max_uses` change — this is one small extra output field on a search the
model is already running, not another lookup.

## 7. Degrading when the field is absent

`market_opex_range` will be missing from:

- cached payloads for up to the 7-day cache TTL,
- saved localStorage reports predating this feature,
- shared reports published before it.

The renderer treats a missing, empty, or unparseable range as normal:

- tiles 1 and 3 still compute from the user's own numbers,
- tile 2 reads `—` with sub-line "not in this report",
- the band states the ratio with no comparison and no gap sentence.

The user's own expense ratio is useful standalone, which is what makes this
graceful rather than a hole. This mirrors how the income-approach cross-check
already tolerates a missing `market_cap_rate_range`.

`SAMPLE_REPORT` is deliberately **not** updated: the sample carries
`noi: null`, so the card cannot render there regardless.

## 8. Privacy boundary

Gross income is private finance, the same class as NOI, debt terms, and the
rent roll.

- **Never sent to `/api/comps`.** It lives only in `meta.assumptions`, which
  is not part of the request body. No cache-key change, no `subjectDetails`
  involvement, no server-side computation of the ratio.
- **Stripped by `/api/share`** — one line beside the existing deletes:

  ```js
  delete safeMeta.assumptions.opex;
  ```

- **Portfolio is the one deliberate exception**, exactly as already documented
  for NOI / debt / rent-roll in CLAUDE.md flow 3: a signed-in owner's own
  authenticated `portfolio_items` row, so the analysis re-renders
  cross-device.

The market range itself (`parsed.market_opex_range`) is market-level data, not
private, and stays in shares like every other market figure.

CLAUDE.md flow 3 must be updated to name `assumptions.opex` in the private-
finance list and in the portfolio exception.

## 9. Gating and upgrade path

Signed-in free account, inside the existing locked cluster.

`#analysisLockCard` copy widens to cover the new card:

- heading: "Expense, Debt & Risk Analysis"
- body: leads with how the expense ratio compares to this market, then DSCR,
  refi headroom, the sensitivity grid, and rollover risk — "free with an
  account".

The `openAcctModal` signup string on the lock button gets the matching
update.

When a paid tier eventually exists, this cluster is the natural bundle and
each card's `!currentUser` check becomes one entitlement check — no
restructuring implied by shipping free now.

## 10. Edge cases

| Case | Behavior |
|---|---|
| Gross ≤ NOI | Neutral hint ("Gross income should be larger than NOI — worth a check"), no ratio, no gap sentence |
| Computed ratio outside 0-100% | Same hint; never print a negative or absurd ratio |
| Gross missing | Empty state (section 5) |
| Market range missing / unparseable | Ratio-only degradation (section 7) |
| Only one of low/high parses | Treat the range as unusable; degrade as in section 7 |
| Land | Card never renders (no NOI) |
| Signed out | Lock card stands in |
| Print / PDF | Input wrapper is `no-print`; the band sentence restates the figures so exports read completely |

## 11. Out of scope (deliberately)

Stated so implementation does not wander:

- No `TYPE_COMP_FIELDS` / `TYPE_COLUMNS` / `TYPE_SUBJECT_FIELDS` / `ALT_BASIS`
  changes. This is not a per-comp field, so the four-map contract and the
  `add-comp-field` skill do not apply.
- **No Supabase migration**, no `comp_corpus` column, no DDL. Nothing here is
  harvested.
- No cache-key change (`cacheKeyFor` untouched — gross income never reaches
  the server).
- No CSV / PNG export changes; the CSV is the comp table.
- No expense line-item breakdown (taxes, insurance, management). One ratio,
  one benchmark. A breakdown is a candidate for later, not this slice.

New markup reuses existing `rd-bcard`, `rd-tile`, `rd-tile-hi`, `rd-lab`, and
the shared input classes. Any genuinely new utility is covered by the tailwind
auto-regen hook.

## 12. Verification

No test suite in this repo, so manual verification against a locally-run
server. The `server.js` prompt change **requires a process restart** per the
CLAUDE.md restart rule; `index.html` edits do not.

States to walk:

1. Signed out with an NOI — lock card only, no op-ex card.
2. Signed in, NOI, no gross — empty state.
3. Signed in, NOI + gross, fresh search — all three tiles, correct band and
   gap sentence; check all three of above / within / below by varying gross.
4. Cached report lacking `market_opex_range` — graceful degradation.
5. Gross ≤ NOI — hint, no ratio.
6. Land — card absent.
7. Print preview — inputs drop, sentence carries the numbers.
8. Share the report, fetch `/api/shared?id=`, and confirm no
   `assumptions.opex` in the payload.
9. Portfolio round-trip — save, reload in another session, gross persists.

Per the verification-quirks note, use the owner's own browser rather than the
embedded pane for visual checks of this app.
