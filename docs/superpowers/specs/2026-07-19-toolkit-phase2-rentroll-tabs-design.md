# Pro Analysis Toolkit phase 2: Rent-Roll + Report | Analysis Tabs — Design

Date: 2026-07-19
Status: approved by owner (this doc records the design conversation)

## Goal

Finish the toolkit's v1 deferrals: a rent-roll / lease-rollover card (the
Director-of-Asset-Management risk view) and the Report | Analysis tab split
the report page now needs — four analysis cards is past the "strain" point
the owner set for restructuring. All math stays client-side.

## Decisions already made (owner-approved)

- **Rent-roll is a standalone risk view.** It reports WALT, occupancy, and a
  rollover schedule; the DCF keeps using the single NOI + growth rate. No
  renewal-probability / market-rent / downtime modeling (that would add 4-5
  opinionated assumptions per lease and fake precision).
- **Hero above tabs; Market Report is the default tab.** Print ignores tabs
  (both panels forced visible); the PNG export captures the active tab.
- Rent-roll sits behind the same free-account gate as debt/sensitivity, in
  the same lock card.

## 1. Tabs (index.html)

- Markup: after `#ownerHero`, a no-print tab bar `#reportTabs` with two
  buttons ("Market Report", "Analysis") in the calm rd idiom (hairline
  underline for the active tab). Two wrappers re-parent the existing cards
  **without changing any card's internals**:
  - `#tabAnalysis`: `#dcfCard`, `#analysisLockCard`, `#debtCard`,
    `#sensCard`, new `#rentRollCard`, plus `#analysisEmpty` — a one-line
    muted hint ("Enter an NOI in Property details to unlock the analysis
    tools.") shown only when the report has no NOI.
  - `#tabReport`: `#statTiles`, summary card, `#driversCard`, `#mapCard`,
    `#compareCard`, `#chartCard`, `#compsCard`.
  - Disclaimer + print footer stay outside both wrappers.
- Behavior: pure class toggling (`hidden` on the inactive wrapper), default
  Market Report on every render; no persistence of tab choice (YAGNI).
  Switching to the Analysis tab re-runs `renderAnalysisCluster` (cheap,
  keeps cards fresh after subject edits made on the other tab).
- Print: `@media print { #tabReport, #tabAnalysis { display: block
  !important } }` and the tab bar is `no-print` — PDFs keep the whole
  document in DOM order (analysis after the market sections).
- Map caveat: Leaflet needs `invalidateSize()` after its container becomes
  visible — switching back to Market Report calls it if the map exists
  (known Leaflet-in-tabs behavior; without it the map tiles render blank
  after a tab round-trip).

## 2. Rent-roll card (`#rentRollCard`, index.html)

- Gating: rendered when NOI present AND signed in (same trigger as debt);
  covered by the existing `#analysisLockCard` when signed out.
- **Input**: dynamic lease rows (max 12): `label` (suite/tenant, optional,
  ≤60 chars), `sf` (number), `rent` (annual base rent $), `endYear`
  (expiration year, clamped current−1 … current+30). Add-row / remove-row
  buttons, calm styling. All rendering via createElement/textContent
  (labels are user text).
- **Data**: `meta.assumptions.rentRoll = [{label, sf, rent, endYear}, …]` —
  rides the existing `persistAssumptions()` pipeline unchanged (debounced
  localStorage + portfolio PATCH). Rows with no rent AND no sf are dropped
  on write.
- **Outputs** (tiles + table):
  - **WALT**: rent-weighted years to expiration, 1 decimal, as of today
    (year fractions from calendar year deltas; expired leases count as 0).
  - **Occupancy**: leased SF ÷ subject SF (only when subject SF known),
    capped display at 100%+ ("overleased vs. entered SF" note if above).
  - **Total base rent** + muted reconciliation vs. NOI when present ("base
    rent before expenses and vacancy — your NOI is $X").
  - **Rollover schedule**: rows for the next 10 calendar years + "later":
    lease count, SF, % of total rent expiring. Row tint: >30% of rent =
    amber, >50% = red (calm palette, same hues as the DSCR chip).
- **XLSX**: when `rentRoll` has rows, a fourth sheet "Rent Roll" — the
  lease list plus WALT/occupancy/rollover summary rows.

## 3. Server + docs (~5 lines)

- `/api/share` strip: also `delete safeMeta.assumptions.rentRoll` (tenant
  rents are private finances, same class as NOI/debt).
- CLAUDE.md: extend the debt-terms sentence to include the rent roll.

## Explicitly out of scope

- Leases driving DCF cash flows (renewals, market rent, downtime) — future.
- Per-lease escalations, options, recovery structures; tab-choice memory;
  equity display on My Desk cards (still deferred from v1).

## Verification plan (browser-driven, no billed searches)

1. Tabs: default Market Report; switch → Analysis shows the cluster; back →
   map still renders (invalidateSize); no-NOI report → Analysis shows only
   the hint line; print stylesheet forces both wrappers visible (assert the
   CSS rule + both wrappers lack inline display:none in print media).
2. Rent-roll math hand-check: three leases (e.g. 4,000 SF @ $60k ending
   2028; 3,000 @ $45k ending 2027; 2,000 @ $30k ending 2033) → WALT =
   (60k×2 + 45k×1 + 30k×7) / 135k ≈ 2.8 yrs; occupancy 9,000/10,000 = 90%;
   2027 row = 33.3% of rent (amber), rollover %s sum to 100.
3. Persistence: leases survive saved-chip reopen + portfolio PATCH
   round-trip (GET the item, assert rentRoll array).
4. Share strip: publish with rentRoll present → shared payload has no
   rentRoll (and still no noi/debt).
5. XLSX: four sheets when leases exist; three when not.
6. Signed-out: lock card covers rent-roll too; zero console errors.
