# Outlier markers in the report comp table (design)

Date: 2026-08-09
Status: AGREED

## Problem

The valuation quietly resists freak comps (the hero band is a weighted
interquartile range once four or more sale comps exist), and the vault gut
check marks a broker's own comps that sit more than 25% outside a band, but
a public report shows an outlier comp with nothing saying so. The honesty
display is passive where it could be active: the visitor who is best placed
to judge a freak comp (the person curating the report) gets no signal, and
the one-click Exclude sits right there unused.

## Decision (owner call, 2026-08-09)

Mark outlier sale comps in the report table with a calm, screen-only chip.
The chip is a curation aid, not a report claim: it never travels into
prints, PNG exports, or shared reports. If the user excludes the comp, that
decision travels instead, through the existing curation audit note.

## Mechanics

### The rule: `outlierOf(ppsf, band)` in valuation.js

- Returns `null`, or `{ dir: "above" | "below", pct }` where `pct` is the
  integer percent distance from the NEAREST band edge (the gut check's
  delta semantics: +38 means 38% above the band top).
- Threshold 25%, the same product rule as `gut-check.js`'s `OUTLIER_PCT`.
  Both constants carry a keep-in-step `⚠` comment naming the other (the
  compWeight / exportReportKey precedent); they express one rule and must
  change together.
- Lives in valuation.js because that module is already dual-export, already
  loaded by the report page with `max-age: 0`, and already owns `ppsfOf`
  and `robustPpsfRange`. Reusing gut-check.js would cost the report page a
  second script tag for six lines.
- Pure; covered by the valuation tests in `npm test`.

### The band: computed once, read twice

Markers compare each sale comp's displayed $/SF (`ppsfOf`) against the SAME
per-SF Low-High band the hero displays. `renderOwnerHero` stashes the band
it rendered (module-level, cleared when no estimate exists); the table and
card renderers read the stash. One computation, so the hero and the markers
cannot disagree, and the arithmetic is verifiable from numbers visible on
the page. The comparison uses displayed (untrended, unweighted) $/SF on
both sides, deliberately: the marker must be checkable by a reader with a
calculator, not an artifact of internal weighting.

Consequences, all deliberate:

- **Leases never flag.** The band is sales-only; a lease's $/SF/yr is not
  comparable to it.
- **Below 4 sale comps, markers never fire.** The band is then the full
  observed spread (`trimmed: false`), so no comp can sit outside it. This
  reproduces the gut check's 4-comp floor with no special case.
- **Exclusions cascade honestly.** Excluding a comp recomputes the band on
  repaint, so a second comp can newly flag once the first is gone. Each
  render is self-consistent.
- **Comps with no parseable $/SF get no marker.** `ppsfOf` returning NaN
  means there is nothing to compare.
- **Excluded (grayed) rows drop their chip.** The information is spent; the
  Restore control remains.
- **Free-tier locked rows are untouched** (redacted placeholders carry no
  rendered $/SF and no curation controls).

### The chip

- Copy: `{pct}% above the range` / `{pct}% below the range`. Muted
  gray styling consistent with the existing chips; no red, no animation
  (calm-UI rule). A `title` tooltip carries the sentence: "This sale sits
  {pct}% {dir} the {low}-{high}/SF range the estimate uses. Worth a look;
  Exclude removes it from the math."
- Renders on the desktop row and the mobile card, ONLY when
  `curationControlsAllowed()` is true, which is what already distinguishes
  "the person curating this report" from a shared-report viewer. Belt and
  suspenders: the chip also carries `no-print no-capture`, so even the
  owner's own print or PNG never includes it.
- Nothing is stored. Markers derive at render time from the current comps
  and band; `meta`, saved reports, shares, the cache, and the corpus are
  byte-identical to before this feature.
- The chip is informational. Exclude/Restore remains the single action,
  and the existing button is directly adjacent.

## Out of scope

- Markers on lease comps, on the market-position chart, or in any export.
- Auto-exclusion or default-off weighting of flagged comps (the valuation
  already down-weights via the IQR trim; a second automatic penalty would
  double-count).
- Any server or storage change.

## Testing

- `outlierOf` decision table in the valuation test file: inside band,
  exactly at an edge, just under/over the 25% threshold both directions,
  pct rounding, NaN/zero/negative ppsf, degenerate band (low === high).
- Browser verification on a locally served report: sample report renders
  without markers if none qualify; a console-synthesized comp 30% above the
  band flags "above"; excluding it removes the chip and may re-flag another
  comp; print preview and PNG capture contain no chip; a shared report
  view (`/r/` path or `meta.shared`) shows no chips.

Ship with a devlog entry and a one-line mention in CLAUDE.md's flow 3
(valuation/curation notes), since the marker is part of the curation story.
