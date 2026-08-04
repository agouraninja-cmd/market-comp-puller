# CompNinja Roadmap

The one place the product direction lives in the repo. Before this file,
the roadmap was split across Claude session memories, the Ecosystem Plan
docx in OneDrive, and the owner's head; now anyone (including any Claude
session) reads it here. The `/dev` ideas list remains the owner's personal
notepad and is deliberately not mirrored here.

Update rule: when something ships, move its line to the Shipped log at the
bottom with the date. When priorities change, reorder; this file states
intent, the devlog states history.

## Now

- **Broker tier v1: private data vault + dashboard** (from the 2026-07-31
  Chuck plan; read "CompNinja Ecosystem Plan.docx" in OneDrive Documents
  before designing). CSV/PDF comp upload into a private vault plus a
  sortable dashboard by property/market. The privacy wall is the product:
  broker private data is never read into the public corpus; the only door
  is per-comp opt-in publishing for Verified credit. Brokers bring their
  own MLS-sourced data under their own license. New tables get the star
  schema; existing tables are not rebuilt.
- **Report branding UI.** The last unbuilt Pro entitlement: `canBrand` and
  `findBrandingProfile()` exist server-side with no UI at all. Shipping it
  lets the pricing tile finally advertise branded reports.
- **Address Explorer follow-ups**: the "instant report" badge on addresses
  whose report is already cached, and wiring the existing
  `/?explore=City,%20ST&type=X` deep link into the market pages.

## Next

- **Corpus browse page** (the deferred half of friend-feedback #9). Gated
  on the density milestone: 10+ market/type buckets holding 8+
  provenance-good comps from organic traffic; the `corpus_offer` events on
  /admin are the gauge.
- **Rent-roll-drives-DCF**: renewal, market-rent and downtime modeling so
  the rent roll feeds the DCF cash flows instead of sitting beside them.
- **White-label exports**, riding on the branding profile once its UI
  exists.
- **Market digest pages**, once the corpus holds 2+ quarters of history.

## Later (broker-tier phases, in order)

v2 blended reports (private comps enrich the broker's own valuations
only) → v3 client sharing with per-report viewer lists → v4 gut-check vs
market data, BOV tracking, 1031 workflow education → hub ratings last.
Hub monetization is gated on the attorney's referral-fee answer; the
fallback if fees are barred is lead visibility as a subscription benefit.

## Engineering track (no product decisions needed)

- Deploy-checklist project skill (tests → tailwind regen if needed →
  pending migrations → push → verify live → devlog).
- Extract tested pure modules out of server.js as they're touched
  (`marketOf`, `normalizeCurrency`, `parseCompJson`/`expandCompKeys`,
  `reportIdFor` pinned against `exportReportKey`).
- Branch protection on main once PR flow feels routine (CI is live but
  advisory today).
- Market pages restyle onto the `rd-*` Research Desk tokens; regenerate
  og-image.png from the cut-card logo.
- Re-measure `PARALLEL_SEARCH` on real traffic before ever flipping it on.
- Fix `marketOf()` yielding "Canada" for Canadian addresses before
  non-USD reports are ever harvested.

## Open business questions (not code)

For the attorney: referral fees, MLS re-share terms, broker-data privacy
policy. For Chuck: the gut-check benchmark, pricing, day-one dashboard
views. Details in Section 8 of the Ecosystem Plan docx.

## Parked (decided, not forgotten)

- `origin/ledger` branch: Owen's in-repo financial ledger tooling. Parked
  2026-08-04 by the owner; its data files are already protected on main.
- Per-type recommended lookbacks: Industrial moved to 24 months on
  measurement 2026-08-04; the others stay until measured the same way
  (count priced SALE comps per window, not total comps).
- Explorer/seed pipeline stays pinned at 8 comps.
- Plus-tier packaging ideas from the 2026-07-16 tiering draft.

## Principles that bind everything above

Customer-first, daily-use tool growing toward
Director-of-Asset-Management-level analysis. Favor client-side
deterministic finance math ($0 marginal cost) and recurring-engagement
loops. Calm UI; brand-identity changes need an explicit named yes. The
brand is CompNinja, never Adler. The owner is not a licensed broker:
"connect you with a local broker," never brokerage. Don't market
"analyst-grade" before the comp audit scores 90%+.

## Shipped log (roadmap-level items only)

- 2026-08-04: migrations/ folder + CI on every push; upstream-error leak
  fixed (PR #9); ledger data protected on public main (PR #10).
- 2026-08-03: Pro tier public launch, $39 single-report unlock, guest
  search cap, Address Explorer, live report preview, compact comp
  encoding + narrative caps.
- 2026-07-19: all four ecosystem directions (accounts/My Desk, broker
  network, pro analysis toolkit + phase 2, market intelligence).
- 2026-07-14: Research Desk landing redesign; compninja.co live.
