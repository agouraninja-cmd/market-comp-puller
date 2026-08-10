# Hero comp scatter (the number line under "What This Building Is Worth")

Date: 2026-08-09
Status: agreed

## The problem

The value hero states three figures (Low / Likely / High) and, below them, a
trust line that *describes* the agreement between comps in words: "The comps
agree closely", "A typical spread for this market", "The comps span a wide
range, so treat the midpoint loosely." That sentence is the only signal a
customer gets about how much the range can be trusted, and it is an
assertion. Nothing on the page shows it.

## The change

One hairline number line, directly under the ledger, plotting every sale comp
the valuation used at its own $/SF. Confidence becomes visible instead of
asserted: ticks bunched around the red mark show why a range is narrow, and a
scattered row honestly shows a soft market.

## What it draws

Left to right, over a strip about 26px tall:

- a 1px rule spanning the card,
- a light tint from the band's low to its high (the same Low-High the ledger
  cells above already state),
- a 2px red mark at Likely, labeled,
- one 1px gray tick per sale comp, at ~55% opacity so overlapping comps read
  darker,
- the cheapest and dearest comp's figure as small end labels,
- a two-sentence caption naming what the marks mean.

## Axis scale: the full comp spread, not the band

The obvious-looking design is to run the axis from Low to High. It cannot
work. The band is the weighted interquartile range (`robustPpsfRange` in
`valuation.js`), so with 4+ comps roughly **half the comps sit outside it by
construction**. An axis clipped to the band would either hide half the
evidence or pin it, misleadingly, to the edges.

So the axis spans the cheapest to the dearest plotted comp, and the band is
drawn *inside* it as a tint. The ledger's three figures still map onto the
line (tint edges = Low and High, red mark = Likely) while the comps outside
the band stay visible, which is the entire point of the feature.

No clamping of freak comps in v1. One comp at 5x the band compresses the
cluster, and that is a truthful picture of a market with one trophy sale in
it. If real reports show this reading as broken rather than informative, an
off-scale caret is the follow-up.

## Which numbers

Ticks are each comp's **displayed** $/SF (`salePsfOf`), the figure the comp
table shows. The band is `currentPsfBand`, the **displayed** band. That is
displayed-against-displayed, the same pairing `buildOutlierChip` already uses,
so a tick can never sit outside the tint while the table's outlier chip calls
the same comp in-range.

It is deliberately NOT the trend-indexed, weighted values the band is computed
from. Those are correct for the math and unrecognizable on a page: a customer
looking for the $210/SF comp they can see in the table must find it on the
line.

## When it renders

Only when the ledger above is quoting the same unit the line plots:

| hero branch                        | line                       |
| ---------------------------------- | -------------------------- |
| $/SF leads (totals)                | yes, in $/SF               |
| per-unit / per-acre leads          | yes, in that unit          |
| income approach leads              | no (no comp scatter to it) |
| no size, $/SF is the headline      | yes, in $/SF               |
| dashes (no range)                  | no                         |

The renderer is generic over (values, band, formatter, noun) so the two units
are one code path, not two.

Two further guards:

- **`band.trimmed` must be true.** That flag is exactly the "4 or more comps"
  condition. Below 4, the band IS the full observed spread, so the tint would
  cover the entire line and state nothing. It is also the same floor that
  stops the table's outlier chips firing on a thin report.
- **min must differ from max.** Otherwise the scale divides by zero.

## Constraints a future editor will otherwise break

1. **It prints and it captures.** `#ownerHero` is inside both the printed page
   and the html2canvas PNG, and this line is evidence, not chrome, so it
   carries no `no-print` / `no-capture`. Consequently it is positioned with
   absolute percentages and never flex gap, which html2canvas silently
   collapses, and it uses no CSS transforms.
2. **`beginAssembly` must hide it.** The hero is unhidden during streamed
   assembly as a counts-only placeholder; without adding `ownerScatter` to
   that function's `asm-hidden` list, the previous report's number line hangs
   under the new report's placeholder.
3. **`role="img"` with a stated label.** The meaning lives entirely in mark
   positions, so the accessible name has to state the spread, the band, and
   the likely figure in words.

## What it does not touch

Nothing is stored, sent, or computed on the server. It derives at render time
from `currentPsfBand` and the comps already on the page, exactly like the
outlier chips shipped earlier the same day. `valuation.js` is unchanged, so
the accuracy backtest and `npm test` are unaffected. Shared reports render it
like any other viewer, since it is a picture of data the share already
carries.
