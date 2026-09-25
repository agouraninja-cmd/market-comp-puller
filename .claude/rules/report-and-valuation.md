---
paths:
  - "index.html"
  - "valuation.js"
  - "comp-gate.js"
  - "market-snapshot.js"
  - "report-id.js"
  - "test/index-html.test.js"
  - "test/valuation.test.js"
  - "test/comp-gate.test.js"
  - "test/market-snapshot.test.js"
  - "test/report-id.test.js"
---
# The report front end and valuation

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Architecture

**`index.html`** — the entire front-end (Tailwind vendored as `tailwind.css`,
html2canvas via CDN).
Holds the form, password gate, results rendering, sortable table, and the
CSV / PNG / Print-to-PDF exporters. The main form's controls row is **three
cells on one line** (`sm:grid-cols-3`): Focus, Lookback and **Property SF**.
Since 2026-08-23 that row sits **inside `<details id="searchSettings">`,
behind a line stating its current values** ("Sales & leases · last 24 months ·
size from public records", with a `Change` affordance), so the form asks for
an address and nothing else. The app already held an answer to all three: two
have defaults, the window's own caption says "Recommended for Industrial", and
the size is looked up from public records or the footprint on most searches —
asking is now stating. **The line is DERIVED, never written once**
(`refreshSearchSettingsLine`), and that is the whole cost of the change: three
visible controls explain themselves, while a stale summary describes a search
that is not the one about to run, with the controls it describes hidden. Only
the lookback has a funnel (`setLookbackControls`); focus and size are assigned
directly by `rerunHistory`, the shared-report restore, the record-backed size
autofill and `dropMachineSize`, none of which fire an event, so each calls the
refresh itself. The footprint estimate is the one machine write that needs no
call of its own, because it dispatches `input` on `#targetSize`. A test pins
every one of those seams and another executes the function, because the
failure is invisible on screen. Every field id is unchanged, so
`targetRange()`, the footprint estimate and every report restore are
untouched.
The row was briefly a 2x2 grid (2026-08-16) carrying the asking price as a
fourth cell; the price moved down into "Details for comps" on 2026-08-17
(owner's call) and the row went back to one line, so `.rd-row-2up` and its
wrapped-grid border rules are gone from the style block rather than left
sitting unused. Three is still the ceiling: the build chamber is ~552px, so a
fourth cell leaves ~106px of content and `.rd-lab`'s tracking wraps the label
to two lines — and `.rd-cell:last-child` cannot see a wrapped grid, which is
what the deleted rules existed to patch. **Asking price is a Refine field
now**, sitting immediately before `#subjectTypeFields` so it reads beside the
per-type facts about the subject (beds/baths on a house, unit count on a
multifamily) — same id, same single input, so `targetRange()`,
`askingRangeFrom` and every report restore are untouched; only its parent
element and its styling changed. The property
type is chosen at the verification step, and the confirm dialog blocks the run
until a type is resolved. Contains **no secrets**.
**The size field is one figure, not a range** (2026-08-16, owner's call).
`#targetSizeMax` no longer exists; `targetRange()` is called with a null
`maxId` for both size and price, so `meta.subject.sizeMax` now always equals
`sizeMin` on a new report. The key it is stored under is deliberately kept:
`sizeMax` survives in `meta.subject` exactly as `priceMax` has since
2026-08-10, so reports saved while the range existed still render it on the
subject row and in exports — the two restore paths (`loadSharedReport`,
`rerunHistory`) simply no longer write it into an input. Do not add a second
size box to Refine "to bring the range back": `#targetSize` is a single id
read by the footprint estimate, `targetRange()` and every report restore, and
a duplicate would either break those or silently disagree with the figure the
search actually sends.

**Private comps in the front end** (the display half of blended comps, 2026-08-06;
server half and spec are under the broker vault above). A comp the server flags
`private: true` renders as an ordinary comp everywhere — table, cards, map,
chart, tiles, curation and the valuation all read it without special-casing,
which is exactly what the one-flagged-array contract bought. It carries the
`broker_vault` tier in `SOURCE_TIERS`, badged **"From your vault"**: an
ownership statement, never the green Verified badge, which is a public claim a
private row has not earned. Two rules matter when editing anything down here:
- **Exports read `exportableComps()`, never `includedComps()`.** That is the
  only difference between the two, and it is the difference between a broker's
  private book staying private and being emailed to a client. Rows and cards
  also carry `no-print no-capture`, which drops them from the printed page and
  from the html2canvas PNG. `/api/share` strips them **server-side** and does
  not trust this file.
- **The valuation still counts them, so every export discloses the gap.** The
  file is short by N rows while the value above it is not, and an unexplained
  difference reads as lost data. `renderPrivateNotice()` says so on screen (and
  is deliberately NOT `no-print`/`no-capture`, so it survives into the very
  exports that dropped the rows); the CSV title row and the XLSX Valuation
  sheet repeat it. Change the filter and you have to change all four.
- **A private comp's ADDRESS is never sent to a third party** (2026-08-06; spec
  and Owen's §7 decision in
  `docs/superpowers/specs/2026-08-06-private-comp-geocoding.md`). Two guards,
  both in `renderMap()`'s geocoding, and both applied in **two** places — the
  main pass and the no-coordinates rescue loop above it, which is otherwise a
  second door straight past them:
  - **Skip.** A private comp with finite `lat`/`lng` is not geocoded at all.
    That pass otherwise geocodes EVERY comp unconditionally, treating supplied
    coordinates as a first-paint guess for the geocoder to refine — right for a
    public comp, wrong for a vault one. Without this guard, coordinates in a
    broker's upload would buy nothing.
  - **No third party.** `geocodeAddress(addr, { noThirdParty: true })` stops at
    our own `/api/geocode` proxy (US Census behind it) and never falls through
    to Nominatim, which is browser-direct and so would receive the address
    **and the broker's IP**. On a miss the comp gets no pin, deliberately —
    same rule as Street View's "the actual property or nothing".
  A refused lookup is **not cached**: `geoCache` is keyed by address alone, so
  storing that miss would deny the Nominatim fallback to the public callers
  still entitled to it. Public comps are untouched by all of this.
  Owen owns the other half (migration 017, `lat`/`lng` in the vault CSV,
  `toApiComp` lifting them onto the comp); **import-time geocoding shipped
  2026-08-29** — the rules live in the Private-comp coordinates bullet under
  the broker vault above. Moving `/api/geocode` to POST ranked above it and
  **shipped 2026-08-17** — see that route's entry above; the address a private
  comp sends to our own proxy no longer lands in a URL.

**PowerPoint export** (2026-09-02; `exportPptx` in index.html). One more
format of the same report, for the reason the others could not serve: the
PNG is one flat picture, the PDF is a print of the web page and the XLSX is
data with no story, and a broker who needed a deck screenshotted the hero into
one by hand. Five slides of NATIVE text and tables — value (the hero's
ledger, basis, trust line and approaches), market summary and drivers, the
comp table paginated ten rows a slide, the comp map and market-position chart
as images, and sources & method. Built in the browser by **PptxGenJS 4.0.1,
lazy-loaded from jsdelivr** on first click exactly as the Excel export loads
SheetJS from cdnjs (it is not on cdnjs; jsdelivr is named beside cdnjs in the
privacy policy's third-parties list, and `test/public-pages.test.js` pins
that line). The button is `#pptxBtn`, revealed for signed-in members only
with the Excel button. Five rules, all pinned in `test/index-html.test.js`:
it goes through `gatedExport` and so costs the same allowance slot as the
CSV of that report (`POST /api/export` takes no format); rows come from
`exportableComps()`, never the included set, and the deck says how many
private comps it left out with the CSV's reader-vs-owner wording; branding
rides `activeBrand()` and every slide's footer carries the CompNinja
attribution from `pptxFrame`, so no slide can omit it; the ledger is READ
OFF THE HERO'S DOM rather than recomputed, because `renderOwnerHero` already
resolved every branch (per-unit, income-only, the leases-only rent range, the
dashes) and a second computation would be a second answer; and it is always
light — `PPTX_CHART_VARS` mirrors theme.js's light tokens for the chart's
`var()` colours and a test holds the two together. The map slide is the
print/PNG raster (`ensureStaticMap`) re-encoded to PNG because PowerPoint
does not render WebP; building it is how the pinless-raster bug below was
found. Verified by opening the file in PowerPoint through its COM interface
and exporting each slide to PNG (a PowerShell one-liner, no dependency).

### Non-obvious flows to know before editing

## Non-obvious flows

2. **Property-type-aware reporting is split across both files.** `buildPrompt` in
   `server.js` switches guidance per type (Industrial/Office/Retail/Multifamily/
   Land/Residential). **Every type also requests its own extra per-comp fields**,
   declared once in the `TYPE_COMP_FIELDS` map above `buildPrompt` (field keys +
   the prompt sentence describing them), which widens that type's JSON comp
   shape: Industrial `clear_height`/`dock_doors`, Office `building_class`/
   `floor_plate`, Retail `center_type`/`anchor_tenant`, Multifamily `units`/
   `price_per_unit`, Land `lot_acres`/`price_per_acre`/`zoning`, Residential
   `beds_baths` (a paired `lot_size` field was tried and dropped — the model's
   search budget doesn't stretch to a per-comp assessor lookup, so it came back
   empty on every test comp; see the note above `TYPE_COMP_FIELDS.Residential`).
   The front-end mirrors it in the `TYPE_COLUMNS` map
   feeding `columnsForType()` in `index.html`, where each column's `after` key
   names the column it sits behind (specs follow **Size**, per-unit/per-acre
   pricing follows **$/SF**); the active `COLUMNS` array is rebuilt per search in
   `renderResults()`. **A per-type field now spans up to four maps** —
   `TYPE_COMP_FIELDS` (server.js, the source of truth), `TYPE_COLUMNS`
   (comp-table columns), `TYPE_SUBJECT_FIELDS` (the subject-property form
   inputs, see flow 4), and `ALT_BASIS` (only for a denominator the market
   quotes, like units or acres). **The `add-comp-field` skill is the checklist
   — use it rather than working from memory.**
   A further place matters for durability: `harvestComps()` writes one flat corpus
   row per comp using `ALL_TYPE_COMP_FIELDS`, so the Supabase `comp_corpus` table
   needs a column per field. **Write the ALTER TABLE as the next numbered file
   in `migrations/` and run it before
   deploying a new field** — PostgREST 400s on an unknown column, which makes
   harvesting fall back to the ephemeral file and quietly lose data.
   `ALL_TYPE_COMP_FIELDS` is also in the `select` of `corpusRowsForMarket()`,
   so a missing column breaks **reads** too: retrieval returns empty, every
   market looks uncovered, and the corpus hit rate pins at 0%. This has already
   happened once (2026-07-27) and went unnoticed for weeks because both paths
   swallow their errors; the corpus health alarm described under **Comp corpus**
   exists to make the next occurrence visible on `/admin` within one search.
   Verify after deploying a field:
   ```sql
   select c from unnest(array['clear_height','dock_doors','building_class',
     'floor_plate','center_type','anchor_tenant','units','price_per_unit',
     'lot_acres','price_per_acre','zoning','beds_baths']) as c
   where not exists (select 1 from information_schema.columns
                     where table_name='comp_corpus' and column_name = c);
   ```
   Zero rows means the schema is complete. Confirm harvesting actually resumed
   by watching `select count(*) from comp_corpus` rise after a search — the row
   count is the only unambiguous proof, since a fallback write still logs a
   `+N` line and still returns a normal-looking report.

3a. **Per-type vocabulary (`ASSET_NOUN` / `assetNoun` / `assetNounPlural` /
   `setHeroTitle` in index.html).** The report called every subject a
   "building", so a house got a hero reading "WHAT THIS BUILDING IS WORTH"
   and a pointer to "Building Size" beside a field labelled *Property size*
   (owner feedback 2026-08-10). Residential is a `home` (which also covers
   **condos and townhomes** — they have no type of their own, and a condo is a
   home); Land, **Multifamily** and **Retail** are a `property`; only
   Industrial and Office fall through to `building`, because only those two
   genuinely are one. Multifamily is deliberately NOT "apartment building" or
   "apartment community" (owner's call, 2026-08-10): the type spans duplexes
   and 300-unit garden communities and neither phrase is true across that
   range, while `property` is also the unit the report already prices on
   (`ALT_BASIS`). Retail is `property` for the same both-shapes reason —
   "building" fits only a single-tenant pad, "center" only an anchored center.
   Three rules: **`SIZE_LABELS` no longer names the FORM field at all**
   (changed 2026-08-16) — that input is labelled **"Property SF" for every
   type**, one term true of a warehouse, a parcel and a house alike, and
   `syncSubjectFieldsToType` deliberately does not touch `#targetSizeLabel`
   any more, so the label cannot shift under a visitor when detection resolves
   the type a moment after they start typing. `SIZE_LABELS` is NOT dead: it
   still names the hero's basis line ("Building size" / "Lot size" / "Living
   area"), which is where the per-type nuance now lives along with the hint
   under the input; adding a type still means adding its entry. Read the rest
   of this rule with that split in mind — the old wording had Multifamily and
   Retail keeping "Building size (SF)" as the field label while the asset above
   was called a property, and that reconciliation is now the basis line's job
   alone; **plurals come from
   `ASSET_NOUN_PLURAL`, never `noun + "s"`**
   (that shipped "propertys" on Land); and **the hero heading is set at TWO
   seams** — `renderOwnerHero` and `beginAssembly` — because assembly puts the
   hero on screen a minute before the real render repaints it, so without the
   second one a house sits under the previous report's noun for the whole
   search. `setHeroTitle` takes the transaction focus as well as the type for
   the same reason (2026-08-21): worded at only one seam, a leases-only search
   would read "What This Building Is Worth" for that whole minute and then
   flip to "Rents For". The basis line reads its field name from `SIZE_LABELS[meta.type]`
   and **not** from `#targetSizeLabel`, because a shared report renders
   somebody else's type into a form still labelled for whatever this visitor
   last searched.

3b. **The lookback hint is recomputed, never written once**
   (`refreshLookbackHint` in index.html). It used to be set only by
   `applyRecommendedLookback`, so moving the window off the recommendation
   left "Recommended for Industrial" under a 6-month selection — the label
   asserting that the reader's own override was our advice. It now derives
   from `selectedLookbackMonths()` and **clears entirely on any deviation**.
   A first pass reworded it instead ("24 months recommended for Industrial",
   which is at least true) and the owner rejected that: the complaint is about
   a recommendation label still sitting under a window the reader deliberately
   changed, and rewording leaves one sitting there. The note is a caption for
   the default, not standing advice. It hangs off **three** seams and needs all of them: the select's
   `change`, the custom box's `input` (which changes the window without
   touching the select), and `setLookbackControls`. It is also called from
   `syncSubjectFieldsToType`, because both startup restores (`?type=` and
   `lastPropertyType`) set the type through that function alone and would
   otherwise leave the hint naming the page-load default type. That call
   refreshes the HINT only and deliberately never applies the recommended
   WINDOW: a restore is not a fresh decision, and a deep link may carry its
   own lookback.

3c. **`subject_last_sale` — the subject's own prior sale** (2026-08-10). The
   report never looked up whether the subject itself had recently traded, so
   a Bensalem property that sold a year earlier for $12.45M got a report that
   never mentioned it. The model returns `{ date, price, source_url }` and
   `renderSubjectLastSale` draws one line under the approaches. Four rules.
   **It costs no extra search by construction**: the ask rides on the
   `SUBJECT SIZE` step, whose assessor/parcel/listing pages already carry the
   sale history, and when `wantsSize` is false the wording drops to
   opportunistic rather than buying a search out of the comp budget. **It is
   evidence, not a fourth figure** — never put it in the ledger, because a
   years-old price shown big reads as a current valuation. **It is normalized
   server-side** (`normalizeSubjectLastSale`): no date means the whole field
   is dropped (a price with no date is unplaceable in time), and a non-http
   `source_url` is discarded before it can become an anchor href. **It is not
   a comp** — the prompt forbids it appearing in `comps`, and it is never
   harvested into `comp_corpus`, which holds comps and not a property's own
   sale of itself.

3d. **`subject_assessed` — the county's assessed value** (2026-08-14). Same
   ride-along as last-sale: the SUBJECT SIZE assessor pages already print the
   taxable/assessed figure, so it costs no extra search (`wantsSize` first;
   opportunistic otherwise). The model returns `{ value, year, source_url }`.
   **It is a cross-check, never a headline** — Low/Likely/High stay sales-comp
   or income math, and it is not the cost approach (that row stays "not
   modeled"). `assessedApproachEntry` draws one **County assessment** row in
   `#ownerApproaches` before the cost row, on every hero branch including the
   dashes branch when a value is present. **Value is required, year is not**
   (the opposite of last-sale): `normalizeSubjectAssessed` in `report-parse.js`
   drops the key without a parseable positive value, keeps a 4-digit tax year
   in 1990…current+1 (caller passes `now`), and strips non-http URLs.
   **Whole parcel or nothing** — land-only or improvements-only is a prompt
   refusal, not a parser guess. Disagreement with a dollar headline uses
   `VALUATION.outlierOf` (the same 25% nearest-edge rule as the table chips
   and the vault gut check), so the three cannot drift. Not harvested, not in
   `summary`, kept in shares (public record, not NOI-class). Spec:
   `docs/superpowers/specs/2026-08-14-tax-assessed-approach-design.md`.

3e. **`subject_asking` and `subject_year_built` — the live list price and vintage**
   (2026-08-14). A 1994 Rosedale house listed at $1.25M ($454/SF, at the
   neighborhood median) was reported at $1.65M because the comps were the
   expensive tail ($486–$653/SF) and a +5.5%/yr trend was applied in a
   declining market. The listing was sitting on the same page the size was
   read from. Four rules, the last-sale pattern reused. **It costs no extra
   search**: both fields ride the SUBJECT SIZE step. **The list price is
   evidence, not a fourth figure** — `renderSubjectAsking` draws one line
   under the approaches; `askFit` (pure, in `valuation.js`, same 25% rule as
   `outlierOf`) names a gap of more than 25% on the trust line and never
   becomes a fourth ledger figure. On houses it IS a `compWeight` factor:
   more than 1.5× off the asking $/SF floors the weight, so cheaper sales
   inside a typed 2.5-mile circle cannot set a $2M home to $1M. **Vintage
   is a `compWeight` factor** — free pass
   within 15 years of `subject_year_built`, then halving per further 15
   years — so a 2024 teardown-rebuild does not price a 1994 resale at full
   weight. **Distance is the fifth** — free pass within 1 mile, then a
   4-mile half-life for CRE and a **2-mile half-life for Residential**, with
   the free pass widened to a market-note radius when one was typed (so a
   "2.5 miles" note does not then punish comps at 2.4 miles). `distance_mi`
   rides `locked_basis` (never lat/lng). `year_built` rides `locked_basis` so
   free and Pro ranges still match. When the estimate sits well below the
   ask, the trust line names a cheaper pocket (the 19-comp / $1M-vs-$2M
   failure), not an ambitious list price. **User-typed
   asking price wins** (`askingRangeFrom`); the looked-up listing is the
   fallback that lights the comparison card when the visitor never typed one.

3f. **A leases-only report headlines RENT, not a missing sale price**
   (2026-08-21). Until this, `txFocus: "leases"` produced a hero with three
   dashes, the line "No priced sale comps came back in this window", and a
   button offering to re-run the whole search as SALES. Nothing had failed —
   the comps were in the table — the report was answering a question nobody
   asked, and it cost a billed search to find that out. Five rules:
   - **The figure is `MARKETSNAP.rentFromComps`, the market pages' own
     function**, reached from the browser rather than copied. `market-snapshot.js`
     is dual-exported for this (browser global `MARKETSNAP`, `maxAge: 0`,
     exactly like `valuation.js`, `gut-check.js` and `explore-query.js`). It
     cannot be computed once on the server and shipped, because excluding a
     comp has to move it; and a second copy of `leaseRentPsfYr` would be a
     second answer to whether `$1.08/SF/month ($12.96/SF/yr)` is 1.08 or 12.96.
   - **Gated on the SEARCH being leases-only** (`meta.txFocus === "leases"`),
     not on "no sale comps came back", so a sales search that returned nothing
     usable still says so and still offers the wider re-run.
   - **Quoted in the market's own basis, off ONE annual figure.** The figure
     is always annual (`leaseRentPsfYr` normalizes on the way in,
     `rentFromComps` medians one canonical number) — that half is
     broker-vault.js 029's rule and never bends, because a book holding two
     bases quotes three rents for one lease. The DISPLAY is
     `MARKETSNAP.leaseQuoteBasis`, which reads the basis off the comps'
     own rate strings and divides by 12 for display only: California
     industrial and retail quote MONTHLY, so "$16.20/SF/yr" in Fontana is a
     number nobody there says out loud. **Evidence only, and the leading quote
     wins** — `$1.08/SF/month ($12.96/SF/yr)` is one monthly vote, not one
     each; a bare numeric `price_per_sqft` votes for neither; a tie is annual.
     Note the deliberate asymmetry with `parseRentBasis`, which REFUSES to
     default: that one writes a stored figure where a guess is 12x wrong
     forever, while this one only picks a display unit for a number that is
     already correct, so annual is at worst unidiomatic. The cost translation
     in the trust line stays a YEAR figure in both bases and says "a year".
   - **Under-claims like everything else here.** Two priced leases minimum,
     never a one-comp band. Unlike `robustPpsfRange` there is no `trimmed`
     flag to lean on — `rentFromComps` interpolates quartiles at any count —
     so below four leases the trust line says it is a rough guide itself.
   - **`lastValuation` and `currentPsfBand` stay null through this branch.**
     A rent is not a value, and everything downstream of those two (the
     asking-price check, the BOV, a portfolio save) means dollars of building.
   - **The furniture follows the noun.** The heading (`setHeroTitle`, which
     takes `txFocus` so BOTH seams word it the same), the scatter caption
     (`compNoun`), the estimate disclaimer (`#ownerEstimateNote`, reset every
     render), the no-range copy, and the widen button's re-run focus. Found by
     rendering one, not by reading the diff: the branch was right the first
     time and three pieces of furniture around it still said "sales".
   - **The mechanics half describes the math that actually ran.** The
     collapsed "How this range is calculated" explained the headline with
     `compWeight` and the trend index, and the rent range applies NEITHER —
     `rentFromComps` takes plain unweighted quartiles — so it was not odd
     phrasing but an untrue account of how the figure was reached. It is
     chosen off `leaseHero`, a flag set INSIDE the branch and never derived
     from `leaseRent` being non-null (a leases-only search where somebody
     typed an NOI and a cap rate still leads with the income approach). The
     Residential MLS sentence is **omitted rather than reworded** on a rent
     range: MLS, a CMA and an appraisal are all sale-price instruments, and
     residential rental listings are ordinarily web-visible in a way MLS sales
     are not, so there is no true lease version of that claim.
   - **Every $/SF figure on the page says which rate it is.** The hero may
     quote per MONTH while the comp table's `price_per_sqft` column and the
     Market Avg tile hold the ANNUAL figure, so an unlabelled 13.5 under a
     headline of $1.18 is the one number a reader could take for a monthly
     rate and be 12x out. `columnsForType(type, txFocus)` relabels that column
     `$/SF/yr` on a leases-only report and `renderStatTiles` does the same for
     the tile. **Label only, never convert**: that column is shared with sale
     reports and feeds sorting and the exports, and a column meaning different
     things on different reports is the two-bases hazard broker-vault.js
     refuses to take on. It relabels a COPY, or the first lease report would
     leave `$/SF/yr` on every sale report after it in the same session, and
     the test executes both column sets to prove nothing else moved.
   - **The lead ask follows the noun too, and the lead itself does not.**
     `bovCopy(meta)` gains a leases branch: "Get a free Broker Opinion of
     Value / Want a real number?" under a rent range offers a SALE price and
     reads as the report disowning the figure it just published. It is the
     Residential branch's fix one report type over, and the same rule — the
     words change, `openLeadModal("bov")` does not, so the broker inbox, the
     coverage-gated intro and the BOV tracker are untouched. **Residential is
     read FIRST**: a house that rents is a Residential report, and the trust
     line's screen-only pointer ("A local agent below can confirm it") is
     Residential-only and names that button by its noun, so a lease branch
     above it would say agent above and leasing broker below — the drift that
     block's own ⚠ warns about.

3. **All valuation math is client-side; the model only supplies market
   figures.** `renderOwnerHero()` in `index.html` computes the Low/Likely/High
   range from sale-comp $/SF (leases are excluded even on mixed searches) ×
   the subject SF — the user's entry wins over the looked-up
   `subject_size_sqft`, and a looked-up size is auto-filled into the form
   input as an editable override. Since 2026-08-04 the browser also pre-fills
   an OSM footprint-derived size estimate during the address-confirm dialog
   (`maybeEstimateSize` in index.html: shoelace area × building:levels,
   `fpSize.v2` cache, gated to verified street-numbered non-Land addresses,
   labeled by `#sizeEstimateNote` and editable) — which doubles as a
   search-budget cut, since a size that rides the request skips the model's
   2-search size lookup. An Overpass outage is deliberately NOT cached as a
   miss. The prompt's PRICED BUT UNSIZED COMPS rule is the server-side
   sibling: a priced sale comp missing its size is worth one dedicated
   search, verified to lift priced-comp counts on thin markets.
   **This is the most expensive number in the report, because the hero
   multiplies it, and it shipped for nine days willing to measure any
   building.** On 2026-08-13 a Boise mobile home listed on Zillow at $52,000
   was reported at $795,000: "biggest footprint within 120 m" chose Bob's
   Bicycles, 10,064 sq ft, 81 m up W Fairview Ave, and 10,100 SF × the comps'
   $78/SF median is $795,000 to the dollar. Nothing was wrong with the comps
   — the model returned eight manufactured homes at $61-158/SF and said so.
   Three rules now stand between that footprint and the size box, and all
   three matter because each catches a case the others miss.
   **The footprint must PROVE the address** (`addr:housenumber` +
   `addr:street`) — the same filter `detectPropertyType` has applied since
   the Phoenix "Mandarin Super Buffet" bug, which this estimate and the map
   photo simply never adopted even though the photo's own comment claimed
   they followed the same rule. **More than one proving footprint refuses**,
   which is the deliberate OPPOSITE of `detectPropertyType` preferring the
   main mass: every part of a campus shares one property TYPE, while only one
   of them is the building whose square footage the value hangs on (38
   footprints prove #6728 at Fairview). **And a unit designator refuses**
   before the query is even made (`unitDesignatorOf`, shared with the photo
   gate — see `GOOGLE_MAPS_API_KEY` above for its vocabulary and tests).
   A refusal is cheap and self-healing: the server then spends the two
   searches it saved looking the size up from public records, which is what
   it did before this estimate existed and is better data than a measurement
   of the wrong building. `fpSize` went to **v2** because entries are now
   keyed by address as well as coordinates, and the bump retires the wrong
   sizes already cached in browsers.
   The backstop for every OTHER way a wrong size arrives (a record lookup, a
   typo) is **`VALUATION.subjectSizeFit`** — pure and tested, and the single
   owner of "how does the subject's size compare to the comps'", so the trust
   line's "N comps are a different size class" count and this warning can
   never disagree. When EVERY sized comp falls outside `compWeight`'s 0.5x-2x
   window and the subject sits entirely past one end of their range, the odd
   one out is the SUBJECT SIZE, not the comps, and the trust line says which
   figure to doubt and how far the range is extrapolated. That report already
   whispered "8 comps are a different size class and count less", which reads
   as a footnote about the comps rather than a warning that the headline was
   extrapolated 6.8× past every one of them. It deliberately stays quiet when
   the comps STRADDLE the subject (one far smaller, one far larger): that is
   a scattered comp set, which the weighting already handles, not a size box
   holding a number from a different building.
   NOI **never reaches the model or any public
   surface**: the income-approach cross-check divides the browser-held NOI by
   the model's `market_cap_rate_range`, `/api/comps` never receives it, and
   `/api/share` strips it before publishing. The same rule covers **debt
   terms** (`meta.assumptions.debt` — loan amount/rate/amortization, powering
   the debt & refi card), the **rent roll** (`meta.assumptions.rentRoll` —
   tenant-level rents behind the rollover card), and the op-ex card's **gross
   income** (`meta.assumptions.opex.grossIncome` — the expense-ratio
   denominator; the market band `market_opex_range` itself is market data and
   stays): private finances, stripped from shares. The DCF's
   four assumptions (hold/growth/discount/exit cap) are opinions, not
   finances, and stay in shares. So is the owner's own **cap rate**
   (`meta.subject.capRate`, the Refine field that replaced Price max on
   2026-08-10): browser-only like the NOI it divides, never in the
   `/api/comps` body and so never in the cache key, but NOT stripped by
   `/api/share` — it discloses nothing alone, because every surface it drives
   needs the NOI that already is stripped. It adds a second income-approach
   line beside the market's (`incomeApproachEntries` — one builder, 0-2
   entries, every hero branch spreads it so the two lines cannot drift or be
   ordered differently), carries the income approach outright when the model
   returned no `market_cap_rate_range`, and seeds the DCF at seed time only.
   A single rate renders a single figure: it is deliberately never widened
   into a band, since an invented spread would be indistinguishable on
   screen from one the comps earned. The one deliberate exception for all of
   these private figures (NOI, debt, rent roll, gross income) is the
   signed-in **portfolio**: a saved report's `meta.subject`
   and `meta.assumptions` are stored in the owner's own authenticated
   `portfolio_items` row so the analysis re-renders cross-device — any future
   share-from-portfolio feature must strip them the way `/api/share` does.
   **Report curation** (`meta.curation` — excluded comp keys, user-added
   comps, the owner's price-discovery read) is the same class of opinion:
   it persists in saved reports/portfolio and stays in shares. Added comps
   live ONLY in `meta.curation.added`, never in `data.comps`, so no server
   path (share, portfolio, harvest) ever ingests a user-authored comp into
   the corpus. The valuation math reads `includedComps()`; the table shows
   excluded rows greyed as an audit trail. Since 2026-08-09 the curation cell
   also carries a screen-only outlier chip (`buildOutlierChip`): an included
   sale comp whose displayed $/SF sits more than 25% outside the hero's
   displayed band (`VALUATION.outlierOf`, the same 25% rule as the vault gut
   check, `⚠`-paired) reads "{pct}% above/below the range". Chips derive at
   render from `currentPsfBand` (stashed by `renderOwnerHero`, one computation
   for both surfaces), are never stored, never print or capture, and never
   render on shared views; below 4 sale comps the band is the full spread, so
   they cannot fire. The hero's **comp scatter** (`renderCompScatter`, shipped
   2026-08-09) reads the same stash: a hairline number line under the ledger
   with one tick per sale comp at its own displayed $/SF, a tint spanning
   Low-High and a red mark at Likely, so the agreement the trust line asserts
   in words is visible. Four rules. **The axis spans the comps, not the
   band** — the band is the weighted interquartile range, so with 4+ comps
   roughly half of them sit OUTSIDE it by construction and an axis clipped to
   Low-High would hide half the evidence; the band is drawn inside the axis as
   the tint instead. **Ticks use the DISPLAYED figure**, never the
   trend-indexed weighted one the band is computed from, which is what stops a
   tick sitting outside the tint while `buildOutlierChip` calls that same comp
   in-range. **It only draws where the ledger above quotes the same unit** (so
   the per-unit/per-acre branch passes its own values through the same generic
   renderer, and the income-approach branch draws nothing) and only when
   `band.trimmed`, the same 4-comp floor as the chips. **It prints and
   captures on purpose**, being the evidence for the figures above it: hence
   no flex gap and no transform anywhere inside it, `print-color-adjust:
   exact` (every mark on the line is a background colour, and paper drops
   those by default — the file's only use of that property), and
   `ownerScatter` in `beginAssembly`'s `asm-hidden` list so the previous
   report's line can't hang under the next report's placeholder. Spec:
   `docs/superpowers/specs/2026-08-09-hero-comp-scatter-design.md`.
   The "Avg $/SF" stat tile and the
   market comparison read the MODEL's market-level figure and deliberately
   do not change with curation. Subject inputs
   persist in each report's `meta` (saved reports re-render without the
   form), and editing size/price/NOI after a report re-renders the
   hero/comparison/chart in place — no new billed search.

4. **Per-type subject details (the user's own building).** The "Your property
   details" section adapts to the property type: `TYPE_SUBJECT_FIELDS` +
   `renderSubjectFields()` (`index.html`) rebuild the inputs whenever the type
   changes, `readSubjectDetails()` reads them into a flat object, and the
   values ride to `POST /api/comps` as `subjectDetails` and persist at
   `meta.subject.details`. Four things are easy to get wrong here:
   - **The subject keys must be a subset of that type's `TYPE_COMP_FIELDS`
     fields.** `sanitizeSubjectDetails()` whitelists against exactly that list,
     so an input whose key isn't a declared comp field is silently dropped.
   - **`cacheKeyFor` includes the details**, appended only when non-empty so
     existing cache entries keep their keys. Without this a 48-unit and a
     6-unit building at one address collide and are served each other's comps.
   - **The type dropdown is gone from the visible form** (2026-08-08): a hidden
     `#propertyType` select remains the single source of truth, and the type is
     resolved at verification — OSM detection, per-address memory
     (localStorage `addrType.v1`), or a required pick in the confirm dialog
     (`typeResolution` in index.html: null | "detected" | "remembered" |
     "explicit"). The three resolved values split on **who** decided, because
     only a human's decision may outlive the address it was made about:
     `"explicit"` (a picker, a chip, a saved or shared report) survives address
     edits, while `"detected"` (OSM tags) and `"remembered"` (recalled from
     `addrType.v1`) are machine states about ONE address and both reset to null
     on an address change, after which that address's own memory then its own
     detection are consulted. Marking a recall explicit let address A's type
     survive onto address B, suppress B's memory, and overwrite it at submit.
     Every programmatic type change must go through `setTypeProgrammatic()` (or
     call `syncSubjectFieldsToType()` and mark `typeResolution` itself), or the
     subject inputs keep the previous type's fields. That function is a
     **no-op when the type is unchanged** — it resets the lookback window and
     re-renders (i.e. empties) the subject inputs, which is right after a
     change and destructive without one; the confirm dialog's "change" door
     pre-selects the current type, so a plain confirm used to wipe a typed
     lookback and typed details moments before the billed search. The select
     fires no `change` events anymore; nothing may rely on them. The
     `lastPropertyType` restore at startup is likewise guarded on
     `typeResolution === null`: a repeat visitor's hint may not overrule a
     decision a deep link or a restored report already made.
   - **The subject-edit listener replaces `meta.subject` wholesale**, so it
     re-reads `details` from the DOM rather than merging — anything not
     re-read is lost on the next keystroke.
   Unlike NOI/debt/rent-roll these are public property attributes, so they are
   sent to the server and **kept** in shared reports. `units` and `lot_acres`
   also drive the $/unit and $/acre cross-checks via `ALT_BASIS` /
   `altBasisEntry`, which render as entries in the hero's `renderApproaches`
   list (min 3 comps carrying the metric). Land is quoted in acres but the
   valuation path is $/SF, so `renderOwnerHero` converts acres × 43,560 when no
   SF is given.
