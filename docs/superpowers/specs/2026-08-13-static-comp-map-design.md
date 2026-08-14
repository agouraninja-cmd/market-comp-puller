# Static comp map (the map reaching the PDF and the PNG)

Date: 2026-08-13
Status: SHIPPED 2026-08-14 (PR #71), verified live. Owner reviewed the three
open calls the same day: **eager build CONFIRMED**, **page-2 placement
CONFIRMED**, and the **light street basemap TABLED** — keep what ships, revisit
when there is a reason to. Tabled is not settled; see the section below for what
would reopen it.

## The problem

The comp map is the most visual exhibit in the report and it exists only on
screen. It is dropped from print (`#mapCard { display: none !important }` in
the `@media print` block) and skipped by the PNG export
(`ignoreElements: (el) => el.id === "mapCard"` in `downloadImage`). Both
exclusions are correct as written: Leaflet's tiles are lazy-loaded
cross-origin images that print blank, and capturing a live Leaflet pane with
html2canvas is unreliable.

So every PDF and PNG a broker sends a client has a comp table and no map. The
one artifact that answers "where are these comps" at a glance never leaves
the browser.

## The change

Build our own raster of the map — tiles stitched onto a `<canvas>` with the
pins drawn on top — and hand the resulting data URI to both export paths as
an ordinary `<img>`. One artifact, two consumers, no live Leaflet involved.

`aerialThumb()` already does the slippy-tile math for the popup photo
(project lat/lng to global pixels, floor to tile indices, offset each tile
against a crop origin). This is that function widened from a fixed-zoom
thumbnail to a bounds-fitted map, drawn to a canvas instead of positioned
`<img>` tags.

## Why a canvas we composite, not html2canvas over Leaflet

Three reasons, in order of weight:

- **Print is not html2canvas.** `window.print()` is a browser-native path
  that no capture library touches. Fixing only the PNG would leave the PDF —
  the format a broker actually sends — still mapless. A static image is the
  only artifact both paths can consume.
- **No taint risk by construction.** Every tile loads through an `Image` with
  `crossOrigin = "anonymous"`. A host that does not send CORS headers fails
  the load and fires `onerror`; it never taints the canvas. So
  `toDataURL()` cannot throw here, which is what makes the fallback below
  honest rather than theoretical.
- **Determinism.** The output does not depend on which tiles Leaflet happened
  to have loaded, what the popup was doing, or whether the map was scrolled.

## It is always the light street basemap

The on-screen map defaults to satellite and remembers the reader's choice.
The static map ignores both and always renders Carto Positron, light.

- Esri imagery prints as a dark, ink-heavy rectangle and the numbered pins
  lose their contrast against it. Street geometry with place labels is what
  makes "these comps are all north of the highway" readable on paper.
- It follows the precedent the PNG export already sets: `onclone` strips
  `data-theme` so every export is light regardless of what the sender is
  looking at, because a dark image pasted into a client's light deck reads as
  broken.

This is the decision most worth arguing with, because it means the printed
map does not match the screen for anyone on the default view. It is one
constant (`SMAP_TILE`) if you want it reversed.

**TABLED by the owner 2026-08-14**, not settled: keep the light basemap for
now and revisit when there is evidence rather than an argument. What would
reopen it is somebody actually sending a report and minding — a broker saying
the PDF looks nothing like what they were looking at, or a client asking to
see the roofs. Neither can happen yet, because nobody outside has sent one.
Until then this is a question about a deliverable no real customer has
produced, which is the wrong kind of question to spend a decision on.

Tiles are requested at `@2x`, so the raster is ~330 dpi at the printed width.

## What it draws

At 1000 x 460 logical pixels, 2x device pixels:

- the light basemap, zoomed to fit every pin with 40px of padding, capped at
  z16 so a single-block comp set does not fill the frame with one rooftop,
- one dark roundel per comp carrying its report-wide number, matching the
  table exactly as the screen pins do,
- a red teardrop for the subject,
- `© OpenStreetMap © CARTO` bottom-right. Not optional, and the reason the
  attribution is drawn into the raster rather than left to the caption: the
  image travels on its own once it is in a PDF.

The existing caption below the map already explains the pins and prints
today; its "Click a pin for details" sentence becomes `no-print no-capture`,
because it is an instruction to somebody holding paper.

## It reads exportableComps(), never includedComps()

This is the rule that matters most in the whole change. A broker's private
vault comps must not reach an export — the table drops them, the CSV drops
them, `/api/share` strips them server-side. A map stitched from the live
marker set would put a private comp's *location* into a PNG emailed to a
client, which is the same leak in a form nobody would think to check.

So the builder iterates `exportableComps()` and reads each comp's final
`lat`/`lng` (the values `refinePins` writes back after geocoding), rather
than reusing the Leaflet markers. Numbering keeps `_num`, so a private comp
leaves a gap in the sequence exactly as it does in the exported table.

`renderPrivateNotice()` already discloses the gap in words, and is
deliberately not `no-print`/`no-capture`, so it survives into the very
exports that dropped the rows. That covers the map too.

## When it is built

Eagerly, deferred to idle, once the pins settle — the same moment
`reportUnplacedComps()` and `refreshDistances()` already run, which is the
only point at which the coordinates are final.

Lazy-on-demand was the first design and it cannot serve Ctrl+P: the native
print path fires synchronously and `onbeforeprint` cannot await a tile fetch.
The print CSS explicitly accommodates a fast Ctrl+P today, so a map that only
appears when the toolbar button is used would be a map that appears
unpredictably.

The cost is ~12-20 small tile fetches per report that nobody may ever export.
Two things keep that proportionate: the build is keyed by a signature of the
pin set and its size, so a theme toggle (which cannot change a map that is
always light) is a cache hit and does nothing, and a curation change rebuilds
only because the pins genuinely changed. Both export handlers await an
in-flight build rather than racing it.

## Failure is silent and lands exactly where we are today

Any failure — tiles blocked, an offline browser, the 4s budget expiring — is
caught, and `#mapCard` keeps the `display: none` it has in print now and
stays in the PNG's ignore list. The export still succeeds, without a map.

That is the whole point of gating on a `map-static-ready` class rather than
on the image element existing: a half-built raster or an empty card with a
caption under it is worse than the absence this change is fixing.

## Not in scope

The map's other gaps are separate work and this change deliberately inherits
them rather than growing: coincident pins still overlap, excluded comps are
still absent rather than greyed, and locked comps on a free report still have
no presence on the map. The static raster shows what the live map shows,
minus private comps.
