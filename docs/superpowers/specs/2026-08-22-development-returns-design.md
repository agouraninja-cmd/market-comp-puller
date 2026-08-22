# Development returns — design

**Date:** 2026-08-22
**Status:** v1 shipped (C6 of the divide-and-conquer plan)
**Modules:** `dev-returns.js` (pure, dual-exported), the `#devCard` +
`renderDevCard()` half of `index.html`, one `STATIC_FILES` entry
**Tests:** `test/dev-returns.test.js` (18, two formulas mutation-verified),
`test/index-html.test.js` (the card's DOM contract)
**No migration.** Costs ride `meta.assumptions`, which already persists.

---

## 1. The gap this closes

A development shop got **vocabulary and nothing else**: migration 036's
`orgs.kind` changes the words on an invite email and opens the shelf on Land,
and CLAUDE.md says plainly that "nothing is gated on it and nothing is
published by it."

The reason is arithmetic, not UI. **CompNinja knows what a property is worth
and nothing about what it costs.** A development pro forma runs
cost → stabilized value → return, and the product only had the middle term.
That is why the sprint plan called IRR impossible: not hard math, but no
inputs to run it on.

So v1 is small on inputs and large on output. Five fields — land, hard, soft,
contingency %, build months — turn the valuation the report already computes
into the four numbers a development decision is actually made on.

## 2. What it computes, and why those four

| Figure | Why it is here |
|---|---|
| **Total project cost** (+ cost/SF) | The budget sanity check that happens before any return |
| **Yield on cost** | Stabilized NOI ÷ what it cost to create — *the* development metric |
| **Spread to market**, in basis points | Build-vs-buy, in the unit the decision is made in: ~100–150bps over the market cap rate is the conventional payment for building instead of buying. Coloured against that hurdle |
| **Unlevered IRR** | What the timing is worth. A 24% margin over 18 months is a different deal from the same margin over 60 |
| **Profit over cost** (headline) | The number that gets said out loud |

The stabilized value is **the report's own valuation** — `valuation.js` already
owns that number and a second opinion on the same screen would be a second
answer.

## 3. Rules a future editor will otherwise break

- **A missing number is `null`, never zero.** broker-vault.js's posture applied
  to arithmetic. Every figure is independently gated on the inputs it needs,
  and `missing` names what to type to see the rest. A 0% yield on cost is a
  real number describing a disastrous project; a reader handed one cannot tell
  it from "you have not entered an NOI".
- **Shorthand is refused, not guessed.** `"1.2M"` returns null rather than
  1.2. Reading a $1.2M land parcel as $1.20 produces a spectacular IRR nobody
  questions until far too late — the same reason the vault refuses it.
- **Contingency is a percentage of hard + soft, never of land.** Land is priced
  at closing and carries no construction risk. This is the one place the math
  could be quietly wrong in a way that *flatters* the project, so it is
  mutation-tested.
- **IRR convergence is measured on the RATE, not the NPV.** NPV is denominated
  in the project's own dollars, so an absolute tolerance tight on a $600k build
  is loose on a $600M one and the answer silently degrades as projects grow. A
  rate bracket is scale-free; the test proves the same deal at 1× and 1000×
  returns the same rate to 1e-9.
- **IRR is annualized by compounding, never by multiplying the monthly rate.**
  Multiplying understates every return here and makes short builds look worse
  than long ones, which is backwards. Mutation-tested.
- **Portfolio yield on cost is recomputed from the sums, never averaged.**
  Averaging percentages across projects of different sizes is simply the wrong
  number — the test uses a tiny project with a wild yield that would otherwise
  swing a portfolio headline from ~7% to ~28%.
- **Costs are private, like NOI and debt terms.** They live in
  `meta.assumptions`, never reach `/api/comps` (so never the cache key), and
  `/api/share` strips that block already. A test asserts `devCost` never
  appears in the search request body.

## 4. Who sees the card

Signed in, **and** one of: the report is Land (org-access.js's own reasoning —
Land is the type that names a site), the visitor is in a development shop, or
costs have already been entered. A broker running a comp set is not handed a
pro forma; a developer who used it once on an Industrial build keeps it.
`firmState` is read defensively and never forced — it is the desk's cache, so
on a report page it is often simply absent, which is why the Land door has to
work without it.

## 5. Deliberately not modeled in v1, and said on the card

Financing (construction-loan draw interest and levered IRR), lease-up between
completion and stabilization, phased or S-curve draws, and tax treatment. Each
changes the answer materially and each needs inputs nobody has been asked for.
The card states the consequence rather than burying it: **unlevered, all-cash,
straight-line draws, exit at completion** — the number developers screen deals
with before modeling a capital stack.

**Firm-wide is also out**, and that one is a privacy decision rather than a
scope one: costs and NOI are stripped from every share path today, so a
dashboard showing a firm its members' project economics is a new consent
surface — per-report, default off, disclosed like auto-share. Until that
exists, this is single-user.

## 6. What was NOT verified

The **before/after screenshot the standing design rule asks for was not
produced**: Chromium could not be kept alive in this session's container, and
`scripts/shot.js` could not reach this card anyway — it photographs
server-rendered pages anonymously, and this is an in-app card behind a
sign-in, a report, and the Analysis tab. That is a real gap in the rule's
coverage for in-app surfaces, not just this session's bad luck.

What that leaves unverified is **appearance only**: the arithmetic is covered
by 18 tests, and the DOM contract (every id the renderer writes to, every
`Sub` sibling, the script tag, the `maxAge: 0` entry) is pinned by
`test/index-html.test.js` — which is the failure that would otherwise be
silent, since a mistyped id writes into nothing and leaves a tile reading "—"
forever while the math behind it is perfectly correct.

**Look at it before demoing it:** sign in, run a Land report, open Analysis.
