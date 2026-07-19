# Pro Analysis Toolkit v1 (Ecosystem direction #3) — Design

Date: 2026-07-19
Status: approved by owner (this doc records the design conversation)

## Goal

Grow the report page's analysis from "one DCF card" into a coherent toolkit an
asset manager uses daily: a shared, persisted assumptions layer, a debt/DSCR/
refi-headroom module, an exit-cap × NOI-growth sensitivity matrix, and a real
XLSX export. All valuation math stays client-side ($0 marginal cost) per the
house rule; the new modules are the account-growth hook and the future
Plus-tier sell.

## Decisions already made (owner-approved)

- **V1 scope:** shared persisted assumptions + debt module + sensitivity
  matrix + XLSX export. **Rent-roll / lease rollover is deferred to phase 2**
  (own spec; that's also when the Report/Analysis tab split gets revisited).
- **Access:** the two new cards and XLSX require a **free account** (signed-in).
  Signed-out visitors with an NOI see a quiet framed nudge to create one. The
  existing hero and DCF card stay open to everyone.
- **Placement:** analysis cluster on the report page — DCF → Debt & refi →
  Sensitivity — same calm card styling. No tab split in v1.
- **XLSX:** SheetJS from a CDN, loaded lazily on first click (html2canvas
  precedent). Signed-in only; skips the lead-capture modal (the account
  already captured the contact). Other exports keep today's rules.

## 1. Shared assumptions layer

One object owns every analysis input:

```js
meta.assumptions = {
  holdYears, noiGrowthPct, discountPct, exitCapPct,   // the DCF four (existing card)
  debt: { loanAmount, ratePct, amortYears },           // new
}
```

- The DCF card's four inputs move from DOM-only state onto this object; the
  debt card's inputs join it. Any edit → recompute ALL analysis cards in
  place + write through to `currentMeta.assumptions`. Defaults stay as today
  (keyed to the market cap-rate range) when absent.
- **Persistence (new — today assumptions reset on every render):**
  - localStorage saved report entry: updated in place, debounced (~1.5s).
  - Portfolio: `openPortfolioItem` adds the item id to the rendered meta
    (e.g. `meta.portfolioId`); when signed in AND `portfolioId` present, the
    same debounce PATCHes the item via the existing
    `POST /api/portfolio {id, payload}` (no snapshot appended — snapshots
    remain valuation-only). Fresh reports saved via "Save to portfolio"
    simply carry `meta.assumptions` in the payload.
- **Privacy:** `/api/share` currently strips `meta.subject.noi`; it now ALSO
  deletes `meta.assumptions.debt` before storing. The DCF four stay in shares
  (opinions, not finances). CLAUDE.md's NOI-invariant paragraph gets the same
  scoping note for debt fields.

## 2. Debt & refi card (`#debtCard`)

Below the DCF card; rendered when an NOI is entered (same trigger as DCF);
signed-in required (see §4). Inputs: loan amount ($), interest rate (%),
amortization (years, default 30, clamp 5–40). Computed tiles (standard
amortizing payment, monthly compounding × 12):

- **Annual debt service**
- **DSCR** = NOI / debt service — muted green ≥ 1.25, amber 1.00–1.25, red < 1.00
- **LTV** = loan / likely value (falls back to the income-approach midpoint
  when sale comps are thin — reuse `sellTodayEstimate`)
- **Debt yield** = NOI / loan
- **Refi headroom** (the headline): max supportable loan =
  `min(NOI / (1.25 × mortgage constant), 0.65 × value)`; shown as
  "room to borrow $X" / "over-levered by $X", caption states the fixed
  1.25× DSCR / 65% LTV constants. Constants are not editable in v1.

Card hides entirely when no NOI. Empty/zero loan → tiles show "—" and refi
headroom shows the max-loan figure alone ("this building supports ~$X of
debt").

## 3. Sensitivity matrix (`#sensCard`)

Below the debt card; same NOI + signed-in gating. 5×5 grid: rows = exit cap
(current ± 1.0% in 0.5 steps), columns = NOI growth (current ± 2% in 1%
steps), each cell = DCF value under those two inputs with the other
assumptions unchanged. Center cell (current assumptions) gets a hairline
outline; cells tint in two muted shades by whether the value beats the
sell-today estimate. Row/column headers show the actual percentages.

**Refactor:** extract the DCF computation out of `renderDcfCard` into a pure
`dcfValue(noi, {holdYears, noiGrowthPct, discountPct, exitCapPct})` helper
used by the card, the matrix, and any future module — single source of truth.

## 4. Account gate + XLSX export

- Signed out + NOI present: `#debtCard` / `#sensCard` render as one compact
  framed nudge (calm, no blur tricks): "Create a free account to unlock debt
  and sensitivity analysis." → `openAcctModal("signup", nudge)`. Signing in
  re-renders the real cards in place.
- **XLSX**: "Excel" button in the export toolbar, visible only when signed in.
  First click lazily injects the SheetJS script tag (CDN, pinned version);
  subsequent clicks reuse it. Skips the lead-capture unlock. Workbook:
  - *Comps* — the active `COLUMNS` set (incl. type-specific Industrial
    columns), one row per comp, source/verified columns included.
  - *Valuation* — subject inputs, low/likely/high, $/SF basis, income
    approach, market cap-rate range.
  - *Assumptions* — the DCF four + debt inputs + computed debt service /
    DSCR / LTV / debt yield / refi headroom (rows only when present).
  - Filename `compninja-<address-slug>.xlsx`.
- Analytics: `logEvent`-visible actions stay PII-free; add front-end-triggered
  events only if an existing kind fits (no new server surface in v1; the
  export can piggyback later).

## 5. Server footprint

~5 lines total: the `/api/share` strip extension (delete
`meta.assumptions.debt` alongside the existing `meta.subject.noi` strip).
No new routes, no DDL, no rate-limit changes. Everything else is index.html.

## Explicitly out of scope (v1)

- Rent-roll / lease rollover, WALT, per-lease anything (phase 2).
- Report/Analysis tab restructure (revisit with phase 2).
- Editable DSCR/LTV refi constants, interest-only periods, IRR waterfalls.
- Billing/Plus enforcement — the account gate is the placeholder.
- Equity display on My Desk portfolio cards (debt persists per property now,
  so this is a cheap later add — deliberately not rendered in v1).

## Verification plan (manual, browser-driven — no test suite by design)

1. Sample report + NOI entered, signed out: DCF renders as today; the two new
   cards show the nudge; clicking it opens the signup modal.
2. Signed in: debt card computes hand-checked values (e.g. $1M loan, 7%, 30yr
   → annual debt service ≈ $79,836; NOI $150k → DSCR ≈ 1.88); sensitivity
   center cell equals the DCF card's value exactly; refi headroom matches
   min(DSCR-cap, LTV-cap) by hand.
3. Assumptions round-trip: edit → reopen from saved chips → values retained;
   open from portfolio → edit → reload → PATCH persisted them; a second
   browser (or cleared localStorage) sees them via the portfolio.
4. Share: publish a report with NOI + debt entered; fetch the shared payload
   and prove it contains no `noi` and no `assumptions.debt`; the shared page
   renders DCF with its four assumptions, debt/sensitivity absent.
5. XLSX: signed in, export; parse the file (SheetJS in-console or Excel):
   three sheets present, comp rows match the table, assumptions sheet matches
   the cards. Signed out: no Excel button.
6. Zero console errors; no billed searches anywhere in the flow.
