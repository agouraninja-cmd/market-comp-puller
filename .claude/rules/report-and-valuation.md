---
paths:
  - "index.html"
  - "valuation.js"
  - "comp-gate.js"
  - "market-snapshot.js"
  - "report-id.js"
  - "collateral-check.js"
  - "test/collateral-check.test.js"
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

- **The building's own sale leads its value (2026-11-27; the owner: "23 to
  30 Percent is not acceptable it needs to be under 10%").** Read this before
  flow 3 and flow 3c below, which it amends: where they say the value is the
  comps' $/SF times the size and nothing else, and that the subject's last
  sale is "evidence, not a fourth figure", a recent, vetted sale of the
  building itself is now WEIGHED INTO Low / Likely / High. Before and after
  pictures of the value card, seven situations, desktop and phone:
  https://claude.ai/artifact/QjKZNHRXGreNsysYKaGF9S
  - **Why.** `scripts/truth-test.js` put a number on the comps: on 45
    commercial buildings that had sold, Likely landed a typical 28 to 33%
    from the price (28% on the 30 sales a second look at the web confirmed).
    The cause is WHICH comps a building gets, not how many: an audit of each
    building found the comps were a different kind of building for 21 of
    them, and for 16 the true $/SF sat outside the whole range of the comps.
    Dropping unsold listings or duplicate rows did not help. What a building
    itself just sold for already prices in what the comps cannot see.
  - **The rule is valuation.js's, and its header comment is the
    specification** ("The building's own sale"): the formula, every constant
    and where it comes from, every refusal, the half-weight cases. In one
    line: `Likely = w x A + (1 - w) x the comps' Likely`, where A is the
    price moved to the report date by the market's trend (capped) and w is
    0.9 through the first year, a straight line to nothing at three. The
    comps are held to within 1.5x of A first. Industrial, Office and Retail,
    US dollars. Change a number there only with the evidence its header asks
    for; **never on the strength of the truth test's own-sale score, which is
    an echo** (next bullet).
  - **Two numbers, never one.** A sold building's report now lands near its
    price because it STARTS from that price. That is not accuracy and must
    never be printed, said or sold as accuracy. The accuracy figure is the
    comps-only one, and a building with no recent sale of its own is valued
    exactly as before. The truth test prints the two apart for this reason
    (corpus.md). No public page states an accuracy percentage, and the FAQ's
    "How accurate is it?" answer says which of the two a report is and quotes
    neither (`faq-page.js` has the reasoning in a comment).
  - **Nothing leans on an unstamped sale.** The server vets the sale once,
    before the report is cached, and stamps it `settled: 1` (`settleOwnSale`;
    search-pipeline.md). `VALUATION.ownSaleAnchor` refuses anything without
    the stamp, so every report cached, saved or shared before this date
    renders exactly as it did: the pictures of such a report before and after
    are the same file, byte for byte. Do not "help" an old report by reading
    its sale anyway. It was never asked for a basis, never matched to an
    address and never read.
  - **`ownSaleBlend(compRange, parsed, meta)` is the ONE wrapper**, with two
    callers: `renderOwnerHero` and `sellTodayEstimate`. It hands the rule the
    report's date, trend, type, currency and year built, every name the
    report has for the subject (`meta.address`, `meta.addressTyped`,
    `subject_address_corrected`), the size being valued and the member's
    switch. It returns null on a leases-only search (the answer is a rent)
    and in net lease mode (the answer is a cap rate). A third caller must go
    through it, or two cards quote two values.
  - **The asking price it reads is the LISTING the search found, never the
    one typed in the form.** A typed price is the member's question, and a
    question must not move the answer: typed into the form it would switch
    the sale off and drop the estimate under the reader's cursor. The typed
    price still weights the comps, as it always has (`weightOpts`).
  - **What the hero shows.** `ownSaleLeads(own)` (a weight of 0.5 or more,
    `VALUATION.OWN_SALE_LEADS_AT`) is the line the words turn on.
    Leading: the three tiles are the blend, Likely's sub-label reads "led by
    its own sale", the basis line gives the sale and its share, the trust
    line opens with the sale (`ownTrustLead`: what it was reported sold for,
    its share, what the comps alone say and how far apart the two are, in
    four tiers), the approaches table lists the sale first with its indexed
    figure and the sales comparison row says it "carries the other N%", the
    tick chart is drawn in the comps' own range and labelled "Comps"
    (`renderCompScatter`'s `compsOnly`), `#ownerLastSale` stands down (the
    trust line has said it) and the estimate note names the sale.
    Helping (under 0.5): the same, with "the comps and its own sale" and a
    trust line that says the comps lead. Alone (no priced comps, a clean
    sale in its first year): its own hero branch, and the trust line says
    nothing came back to check it against.
  - **Which addresses are one building** (`sameBuilding`, 2026-11-28
    review round): a campus sibling named as its own comma part ("Building
    Two", "Tower 2", "Pad C", "Phase II", "Lot 5", "2nd Floor") is another
    building, identifiers fold to one spelling (One = 1, II = 2); an
    address typed with no comma before the city, and Third/3rd, Saint/St,
    Center/Ctr, match. A loose match (two ZIPs in one city) only takes a
    row OUT of the comps; promoting a row to the sale needs the strict one.
  - **Half weight** also for a sale whose source the search did not classify
    as news or a public record (`unclassified`) and for a promoted comp row
    whose notes state no basis (`from_comp`); `ownSaleHalfWhy` has a clause
    for each.
  - **The 1.5x hold fades with the weight** below `OWN_SALE_LEADS_AT`, so a
    sale carrying a tenth does not pin the headline and nothing jumps when
    it ages out; the trust line says when the comps' figure was pulled
    toward the sale (`own.held`).
  - **Comps with no dollar figure still check the sale** (`opts.compPsf`,
    2026-11-28): with one priced comp, or several and no size, the sale's
    $/SF (over the subject's size or the size the sale states) is held to
    the comps' $/SF by the same 3x; with neither size the sale is refused
    `unchecked`. Only a report with no priced sale comps at all lets a sale
    stand alone. `ownSaleCompPsf` (page) and `val.psfMid` (bulk.js) feed it.
  - **Known gaps, left for the owner (2026-11-28 review):** the member's
    switch (`meta.curation.ownSaleOff`) is not written back to a bulk row or
    a saved property's value snapshot until the next Refresh / re-value;
    `OWN_SALE=off` does not re-value bulk rows already stored; an address
    written with no comma at all ("100 Main St Boise ID 83702") is read for
    its city but not its state (the report form now asks for a city, below); the sale-alone hero's Low / High sub-labels say
    the spread even when the range was widened to hold the price paid; the
    truth set's `confirmed` group still includes rows whose caveat says the
    price covered more than one building.
  - **The report form asks for the city (2026-11-28; the owner: "make it so
    they have to type in a city").** `VALUATION.missingCity(address)`: an
    address that starts with a street number and names no city (`cityKey`
    is "") stops in the submit handler, before the geocode and before
    anything is billed, with "Add the city to the address, for example:
    1200 W Industrial Blvd, Dallas, TX." and the cursor back in the box. A
    city typed without a comma counts ("100 Main Street Dallas"); a street
    and a ZIP, or a street and a state, does not. A market search has no
    street number and is never asked. Only the report form: bulk lists,
    Home's add forms and the API are not held to it.
  - **A refused sale is said, in one sentence, with its reason**
    (`ownSaleRefusal`), appended to the trust line; the value is the comps'.
    A few refusals deliberately say nothing (no price or date, too old, a
    type or currency the rule does not cover, an unstamped report): the
    last-sale line already shows those as the history they are. **A caveat is
    attributed to the search** ("the search found its price covered more
    than this one property"), never asserted as our own finding about a
    named building, and the sale is "reported", never "verified" or
    "recorded" (never-break rule 8).
  - **The member's switch** (`#ownerSaleSwitch`, `renderOwnSaleSwitch`):
    "Has it changed since that sale (renovated, expanded, re-leased,
    damaged)? Value it on comps alone", and "Use its own sale again" once
    off. It is the one guard for what no public record shows. It writes
    `meta.curation.ownSaleOff` through `ensureCuration` and `applyCuration`,
    the door every curation edit uses, so it rides a saved report and a
    share like an excluded comp. A shared report shows its owner's choice
    and offers no switch. `no-print no-capture`, and in `beginAssembly`'s
    hide list.
  - **Downstream of the hero.** `lastValuation` holds the blended figures
    when the sale is weighed, so the portfolio snapshot, the BOV modal, the
    Collateral Check and Sell Today all quote the hero's own numbers. The
    Collateral Check adds what the loan is against the comps alone. The CSV
    says so in its subject line, and the Excel Valuation sheet carries the
    basis, the sale as reported, the sale at the report date, its share and
    the comps' own Likely. The PowerPoint reads the hero's DOM, so it
    follows. **A saved property's value history can step** the first time
    its value is refreshed after this date, because the refreshed report may
    lean on a sale the earlier snapshot ignored. Nothing marks that step on
    Home yet (the owner's call to make).
  - **`OWN_SALE=off` is the rollback, and a whole one** (server.js, beside
    `settleOwnSale`; default on). This moves a report's headline figure, so
    it can be stopped from the host's settings without new code. Off: the
    search stops looking for the sale, nothing is settled or stamped, a
    report settled while it was on leaves `finishReportForViewer` without its
    stamp (a copy; the cache keeps it), the three bulk callers pass
    `ownSaleOff`, and the page is told through the boot object
    (`window.CN_AUTH_BOOT.ownSale === false`, present only when off), which
    `ownSaleBlend` reads straight off `window`. That last half is what covers
    a report rendered from a SAVED payload (a recent search, a property, a
    shared report), whose stamp the server never sees again. With the switch
    off `ownSaleBlend` answers null, "no sale was weighed": no blend, no
    refusal sentence, no switch, and the last-sale line as it always was.
    Turning it back on needs nothing re-run.
  - **Bulk rows and a firm's building sheets** value through
    `BULK.valueFromReport`, which calls the same `valueWithOwnSale` (bulk.md).
  - **The public wording moved with it**: the FAQ's two answers, the bulk
    page's footnote, the lender page's ledger sentence, the BOV
    acknowledgment email and the outreach draft no longer say a value comes
    from comps alone.
  - **Not done, each the owner's to decide.** Leaning on the asking price
    (17 audited buildings had a findable ask before they sold and the sale
    landed a median 11% under it, but an ask is the seller's opinion and an
    owner must not be handed their own listing back); a window past three
    years or a higher weight (wants a repeat-sale test: buildings that sold
    twice, the later price predicted from the earlier one, and the corpus
    holds no such pairs yet); Residential, Multifamily and Land (each needs
    its own truth-test run first, the rule `SIZE_ELASTICITY` keeps); printing
    the measured comps-only miss on a report; and a broker's own vault deal
    for the subject's address, which still arrives as an ordinary private
    comp and is not treated as the sale.
  - **Not measured yet.** How often a live search finds and vets a sale,
    above all on buildings the corpus has never held, and whether the added
    search step keeps a search under a minute (search-pipeline.md). Both need
    a slow live run after deploy.

- **The jump bar survives Safari's toolbar (2026-11-20; the owner: "When
  swiping up on mobile in CompNinja it still glitches").** On an iPhone a
  swipe slides the address bar away or back, and Safari fires a `resize`
  per frame of it. The report's resize listener called `syncReportNav()`,
  which emptied `#reportNavInner` and built every link again each time:
  imitated in Chromium (iPhone 13, viewport height stepped 664 to 746 and
  back during a scroll), 27 rebuilds in one swipe up and down, so the bar
  flashed and its sideways scroll snapped to the first link. Chromium's own
  phone emulation fires no such resizes, which is why the 2026-11-18 swipe
  measurements below never saw it. Now `syncReportNav` rebuilds only when
  the links change (`reportNavBuilt`, the ids and labels last drawn; a
  link looks its card up at the click), and the listener answers a WIDTH
  change at once but a height-only change once,
  `REPORT_NAV_RESIZE_SETTLE_MS` (250) after the last one. After: 0
  rebuilds. Held by `test/phone-scroll.test.js`, which runs the function
  and the listener and was checked against both halves broken.

- **The printable map is built while the page is still (2026-11-18; the
  owner: "When swiping up and down on mobile it looks like it freezes for a
  split second").** `smapIdle(ensureStaticMap)` only STARTS the raster at
  idle; the tiles then land whenever they land, and the stitch and the
  `toDataURL` encode of the 2000x920 canvas ran in the last tile's load
  event, a few seconds after a report opens, which is when somebody swipes
  through it. Measured on the sample report in Chromium at 4x CPU slowdown
  (iPhone 13 emulation): one 470ms task mid-swipe, every frame presented
  without the page's own updates; after, no task over 50ms. Three changes in
  `drawStaticMap` and its helpers: `await smapWhenStill()` before any canvas
  work (300ms with no `scroll` event, `SMAP_STILL_MS`; an export button's
  await is never kept waiting, since nobody scrolls while pressing one);
  `smapTile` resolves after `img.decode()` (a tile that will not decode early
  is still drawn); and `smapEncode` uses `canvas.toBlob` (Chrome encodes off
  the main thread) read back through `FileReader`, so `#mapStatic`'s src is
  still a WebP-or-PNG data URI and print, the PNG and the PowerPoint read it
  as before. Held by `test/phone-scroll.test.js`, which runs both helpers.

- **A report on a phone shows its estimate on the first screen (2026-11-14;
  the owner, of a phone audit: "yes fix both").** Under 640px the estimate's
  heading sat 578px down the report (646px at 320px wide): three rows of
  export buttons, the jump bar and the header card came first, so Low,
  Likely and High all started below the fold. One `@media (max-width:
  639.98px)` block in index.html, measured on the sample report at 390px:
  the heading is at 439px and Likely at 616px (it was 763px).
  - **The toolbar is one row that scrolls sideways**, 42px tall. It was a
    two-column grid with Share across the top (four rows, about 200px, with
    Share). The row runs to the screen's edges (the page's 16px gutter given
    back as negative margins and put inside as padding, so the PAGE never
    gets wider) and fades out on the right; 36px of end padding lets the
    last button scroll clear of the 32px fade. Share stays first.
  - **The two cards over the ledger are closed up**: the header card's
    padding, mark (22px) and address (`--text-heading`, 24px; it is 26px
    elsewhere), the value card's padding, and 4px a side in each ledger
    cell. A phone-width PNG export photographs these too; print does not
    (it has its own rules).
  - **The jump bar's links** take an `::after` overlay (41px tall) so a
    thumb gets the bar's height; nothing moves, and the current link's
    underline stays under its word.
  - **A comp card's field labels are 11px** (`.cardgrid dt`, and Sort by),
    at every width: they were `text-[10px]`, 62 of them on the sample at
    phone width, where the cards stand in for the table.
  - **In the same block, Firm settings' two dropdowns** (`#firmAutoShareSelect`,
    `#firmShopSelect`) are `max-width: 100%`: a select is as wide as its
    longest option, 358px at a phone's 16px field size, and the dialog slid
    sideways (firms.md's auto-share box).
  - Still under 11px on the report, left alone: the comp scatter's "Likely"
    label and the map pins' numbers (9.5px and 10px), which are sized to
    their marks.
  - Held by `test/phone-report.test.js`.

- **The report sets no Georgia (2026-11-14; the owner, after Home and every
  member page went to Inter: "make the comp report Inter too").** index.html
  now names no serif anywhere: `.font-brand` and `.rd-h` (the address, the
  hero's Low / Likely / High, the tile figures), `.ap-stmt td.num`,
  `.pr-fig`, `.pr-stmt tfoot .fig`, `.dk-mname`, `.dk-addr`, `.dk-gt`,
  `.mc-name`, and on Home `.hm-map-empty b`, `.hm-first-h` and
  `.hm-pop-b > b` are the page's own face at 600 (Georgia was 400 or 500,
  and Inter at 500 reads as body text). `--serif` stays defined, because the
  scale is shared with theme.js, and is used by nothing here. The sample
  report measured the same height before and after (5,522px at 1440), so
  nothing reflowed. It reaches what is the same page: a shared report at
  `/r/<id>`, the sample, and the print and PNG exports, which photograph it.
  The PowerPoint export writes its own text and was already sans. The public
  pages are other documents and keep Georgia. Held by
  `test/index-html-type.test.js`; app-shell.md ("Member page titles") has
  the member pages' half.

- **The Collateral Check card (2026-11-10; the owner's ask was to cater to an
  SBA lender, Live Oak Bank).** The Analysis tab's Debt & Refi card hides
  until an NOI is typed, and an owner-occupied building has none: the
  business repays the loan and the building is collateral. `#collCard` is the
  one card in that tab that needs no NOI. It takes a loan, an optional
  purchase price and the lender's own LTV limit, and reads the loan against
  the hero's Low / Likely / High: three LTV tiles (green inside the limit, red
  past it), "Value this loan needs" (loan over limit, the figure a lender
  carries into the appraisal), and one read sentence keyed on the verdict
  (`covered` / `depends` / `stretch` / `short`). Rules:
  - **The math is `collateral-check.js`** (pure, dual-exported, browser
    global `COLLATERAL`, `maxAge: 0`, tested in
    `test/collateral-check.test.js`). A missing number is null, never zero;
    shorthand ("1.6M") is refused, and the card says the figure could not be
    read (`collUnread`) instead of emptying the box.
  - **The words are the module's too** (`COLLATERAL.describe(summary,
    { money, whose })`, 2026-11-10): the line under the title, the three
    tiles' figures, tones and lines, "Value this loan needs" and the read
    sentences. Two pages draw this card, the report and the public lender
    page (`lenders-page.js`, public-pages.md), and with the sentences in each
    the public page would promise one wording while the product showed
    another. **A third caller since 2026-11-14:** `/comps`' loan check reads
    a loan against a comp set's own low, median and high with the same two
    functions (`whose: "this set's"`; vault.md), so a change to a sentence
    here changes it in three places at once, which is the point. `renderCollateralCard` keeps only what the report alone knows:
    its money format (a report can be in another currency), the colour a
    tone maps to, and the prompts for a box nobody has typed a figure into.
  - **Lesser of price and value.** With a purchase price the basis of each
    scenario is whichever is lower, so a tile's line says "on the $X price"
    when that is what it was measured on. `priceBinds` is the price alone
    breaking the limit: no appraisal fixes that, and both the read and the
    "Value this loan needs" line say so rather than "the appraisal decides".
  - **It quotes the hero's own figures, never a fourth.**
    `collateralValueRange` reads `lastValuation`; with none (an income-led
    hero) it ⚠ mirrors `renderOwnerHero`'s income branch through `heroRound`.
    It first read `sellTodayEstimate` alone there and said "one value, not a
    range" under a hero showing three. A report with one figure (the owner's
    own cap rate) gets a verdict on that figure and no invented spread; a
    report with no dollar value (leases only, no size) hides the card.
  - **One loan per report.** The card's loan IS
    `meta.assumptions.debt.loanAmount`, the debt card's figure, so the two
    cards cannot quote two LTVs. Each writes the other's box unless it is the
    focused one (`collBox`; the matching line in `renderDebtCard`). Because a
    focused box can lag the assumptions, `commitCollateral` reads ONLY the
    boxes typed in since the last commit (`collDirty`), and leaving a box
    commits at once. Reading every box wrote a stale, empty loan box back
    over the debt card's loan; the test executes that case.
    **The debt card follows the same rules** (`commitDebt`, `debtDirty`;
    Cursor Bugbot on PR #416, three findings, each reproduced in a browser
    before the fix). It used to read all three of its boxes on every edit,
    so a loan box that had focus while the collateral card changed the loan
    stayed stale and the next rate edit wrote the stale figure back. Both
    cards now read only typed boxes, never redraw a box holding an edit that
    is not yet committed (any card's render can land inside the 250ms
    debounce), and commit the moment a box is left. And the debt card's loan
    is parsed by `loanFigure` (`COLLATERAL.money`), not `numericValue`:
    "1.6M" there used to become a $1.60 loan, which this card then read as
    0.0% LTV and "Covered". It is refused now, the box keeps what was typed,
    and the LTV tile says to type the balance in full (`debtLoanUnread`).
    **Both cards reset before anything that can return early.** A new
    report clears each card's flags, drops its pending debounce and (the
    debt card) empties its boxes whether or not the card shows for that
    report. The debt card's reset sat below its no-NOI return for one
    commit, so a report with no NOI kept the last report's "1.6M", rate and
    flags, and showed them the moment an NOI was typed.
  - **Private, by living in `debt`.** The price (`purchasePrice`) and limit
    (`ltvLimitPct`) sit in `meta.assumptions.debt` beside the loan, so
    `/api/share`'s `delete safeMeta.assumptions.debt` covers them, they ride
    the portfolio like the other loan terms, and they never reach
    `/api/comps`. A test fails if `commitCollateral` writes anywhere else.
  - **Print and exports.** With no loan and no price the card is
    `no-print no-capture` (its boxes are no-print, so it would be an empty
    shell). `renderCollateralCard` returns whether it prints, and the
    print-only `#analysisSeam` heading shows on `hasNoi || collPrints`. The
    Excel Assumptions sheet gets a "Collateral check" block from the same
    `collateralSummary()` the card draws from. The jump bar lists it as
    "Collateral".
  - **Copy.** It is "a pre-screen against an automated estimate, not an
    appraisal and not a bank evaluation" (test-pinned). "Evaluation" is a
    regulatory term for a bank, and the Terms say estimates must not be relied
    on for lending, so the card is worded as deciding whether to ORDER an
    appraisal and never as standing in for one. 80% is only where the limit
    box starts; nothing here states or implies a lending limit.
  - **Residential with no NOI** still hides the whole Analysis tab
    (`hideResiToolkit`), and the card with it, since print forces both tab
    panels open.
  - **The door (`#collDoor`, the owner's OK the same day).** Without an NOI
    the Analysis tab held one line of text until this card, so nobody had a
    reason to open it. A line under the hero's estimate disclaimer,
    "Lending or borrowing against it? Check a loan against this estimate",
    opens the tab, brings the card to the top and puts the cursor in the
    loan box (`focus({ preventScroll: true })`). `renderAnalysisCluster` is
    its ONE writer and keys it on the card's own visibility; it is
    `no-print no-capture` (the hero is printed and photographed) and in
    `beginAssembly`'s hide list.
  - **`scrollToReportCard(el)`** is the jump bar's scroll, pulled out so the
    door shares it. It measures by LAYOUT offsets (`offsetTop` up the
    `offsetParent` chain), never `scrollIntoView` or
    `getBoundingClientRect`: a card in a tab that was just shown is at the
    start of its entrance animation, drawn 12px lower than where it rests,
    and the door's first build stopped short and let the card rise under
    the sticky bar. Test-pinned and executed.
  - **Found while building it:** `/api/share` never stripped
    `assumptions.devCost`, though the Development Returns card, a code comment
    and a test all said it did. It does now, on write AND on read (sharing.md,
    "Private finances are stripped at both ends"), and `test/routes.test.js`
    holds the first tests of any of that stripping.

- **A land report reads per acre throughout (2026-10-21).** `ALT_BASIS.Land`
  has led the hero since it was written, but only once the acreage was
  known, and it was known only when the member TYPED it; a land report whose
  lot size came from public records (or a bulk run, which stores the size it
  found as the subject's) was quoted "at $15/SF". Now, for Land with no typed
  acres, `renderOwnerHero` derives them from the lot size (`acresFromLot` =
  the size over 43,560, exact, since a parcel's size is its lot) and hands
  `altBasisRange`/`altBasisEntry` a copy of the subject carrying them
  (`sAlt`); typed acres still win, and the basis line says "(the lot size
  from public records)" or, with no source, "(from the lot size)", never
  "you entered", because a bulk run's lookup arrives looking typed. The trust
  line drops "Building size wasn't needed" for land. **The market position
  chart, the table's footer and the PowerPoint caption** read per acre when
  `isLandChart(sales)` (Land, and two or more sale comps with a
  `price_per_acre`), so all three quote the hero's unit with the same median;
  `subjectAcresOf` places the "You" marker at the asking price over the acres.
  **The comp table** orders Land as Acres, $/acre, Zoning, Price / Rate, then
  Size (SF) and $/SF (`columnsForType`), so $/acre is on screen without a
  sideways scroll; and `cellShown` writes a bare-digit size with its commas
  ("339768" → "339,768") on screen only, exports unchanged. The Board's
  land markets read per acre too (markets.md). Pinned in
  test/index-html.test.js.

- **Property vs comp in the report (2026-10-07).** A property is the building being valued; a comp is a past deal it is valued against (the wording Home uses since Draft C). The header's first chip reads "Your property" (`renderReportMeta`, styled `.rd-chip.rd-chip-subj`), matching the tag on the subject's row in the comp table, and the table is headed "Comps Used", never "Comparable Properties". PNG and print photograph the header; the PowerPoint export writes its own text, so its first slide says "Your property · …" and its comp slides are "Comps used" ("· sales" / "· leases" by focus). Pinned in test/index-html.test.js.

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

3c. **`subject_last_sale` — the subject's own prior sale** (2026-08-10).
   **Amended 2026-11-27, at the top of this file ("The building's own sale
   leads its value"):** a recent, vetted sale is now weighed into the range,
   the search looks for it on purpose, and the field carries more keys. Of
   the four rules below, the first ("costs no extra search") is no longer
   true for Industrial, Office and Retail, and the second ("evidence, not a
   fourth figure") now holds for the LINE under the approaches only. The
   other two stand.
   The report never looked up whether the subject itself had recently traded,
   so a Bensalem property that sold a year earlier for $12.45M got a report
   that never mentioned it. The model returns `{ date, price, source_url }` and
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

3e2. **`construction` and `subject_construction` — how the building is built**
   (2026-11-19, owner's call: "consider the age and structure of the
   building"). Industrial, Office, Retail and Multifamily only
   (`RPARSE.collectsConstruction`; a house is nearly always wood frame and
   Land has no building). A CLOSED vocabulary (`CONSTRUCTION_VALUES`:
   Tilt-up concrete, Concrete frame, Steel frame, Metal building, Masonry,
   Wood frame), strict like `condition`: anything off the alias list is ""
   — fix the prompt, never loosen the parser. The subject's own rides the
   SUBJECT SIZE step like `subject_year_built` and merges across lanes the
   same way. It is a `compWeight` factor in valuation.js only (x0.6 on a
   mismatch, `opts.subjectConstruction`, neutral when either side is
   unknown); comp-gate.js has no subject so it does not weigh it, but
   `basisRow` carries it so free and Pro ranges agree. The prompt's MATCH
   AGE AND CONSTRUCTION line steers which comps are CHOSEN (vintage within
   ~15 years, same construction) for the commercial types; Residential has
   its own vintage sentence. **Stored in `comp_corpus.construction`**
   (migration 064, applied 2026-11-19): harvest writes it, both corpus
   reads select it, blend-corpus.js maps it, and the KNOWN RECENT COMPS
   lines offer it to the model (`typeSpecsOf`) so a reused comp keeps it.
   Deploy order is hard (rule 9).

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

3g. **Commercial comps are restated at the subject's size (2026-11-15).**
   `valueFromComps` multiplies each Industrial, Office and Retail comp's $/SF
   by `sizeRestateFactor` before weighting it: `(subject SF / comp SF)^-0.2`,
   the ratio capped at 8x either way, so a comp twice the subject's size
   counts about 15% higher and one half its size about 13% lower. `compWeight`
   is untouched (an off-size comp still counts LESS, it just no longer counts
   at the wrong figure), so the ⚠ `compWeight` pair with comp-gate.js did not
   move, and `basisRow` already carries the size and the $/SF, so a free
   report's range still matches Pro. **It is measured, and the type list is
   the measurement**: hold-one-out over the corpus (`scripts/accuracy-lab.js`,
   corpus.md) took the median miss on 48 commercial sales from 34.1% to 25.6%
   with the market-resampled interval below zero, and moved 189 house sales by
   nothing, so `SIZE_ELASTICITY` lists three types and Residential, Multifamily
   and Land return 1. A per-unit or per-acre basis (a custom `readValue`) is
   never restated. Add a type or change -0.2 only with a lab run.
   **Four surfaces had to move with it**, and each was found by looking at the
   sample report rather than at the diff:
   - **The table shows the raw $/SF and the `adj` mark carries the counted
     one.** `indexedPsfNote` reads `VALUATION.countedPsf` (through
     `countedPsfOf`, which hands it the hero's own inputs) and names what
     moved the figure: the trend, the size, or both in the order the math
     applies them. The legend reads time-, size-, or time- and size-adjusted
     to match.
   - **The hero's tick chart and the outlier chip switch to counted figures
     together**, off one flag (`currentPsfBand.restated`). Raw ticks under a
     restated band put the whole tint past the last comp on the sample
     (74,000 SF subject, every comp larger). They stay on DISPLAYED figures
     for every report the restatement does not touch, which is the pairing
     the scatter's header has always described.
   - **Likely reads "median at your size", not "comp median"**, on screen and
     on the Excel sheet. The table's footer prints the plain median of the
     $/SF column as "Median of N sale comps", and two medians 8% apart with
     one name would have nothing saying which to believe. The Excel label
     reads the band, not `lastValuation`, because that object is posted to the
     server as a portfolio snapshot and keeps its four fields.
   - **home-page.js's sample is an Industrial building**, so its three
     figures are the restated ones (rule 4 in that file). One comp moved $2 so
     every whole-dollar $/SF times the size still lands on the total beside
     it, which `test/home-page.test.js` enforces.

3h. **Low to High is the weighted 15th-85th percentile, the middle 70%
   (2026-11-16; the owner's call).** `robustPpsfRange` took the quartiles
   until then, which hold the middle half of the comps by construction and so
   held the held-out price 48% of the time over 242 scored sales; a reader
   takes "Low" and "High" for bounds. 15-85 holds it 62% of the time (houses
   64%, commercial 54%) at a median width of 45% of Likely against 31%.
   **Likely is the median and did not move on any report.** Under four sale
   comps the band is still the full spread. Leases are untouched:
   `rentFromComps` takes plain quartiles and its copy still says "the middle
   half". `BAND_LOW_PCT` / `BAND_HIGH_PCT` are the two numbers, and three
   things are tied to them:
   - **The spread verdict's bars.** "The comps agree closely / A typical
     spread / a wide range" reads `(high - low) / mid`, and its bars (0.15,
     0.35) were set against the quartiles. The wider band runs about 1.54x as
     wide over the same comps, so the sales bars are now 0.23 and 0.54. Left
     alone, 70% of comp sets changed verdict and nearly all of them read
     "wide", which was found on the sample report's picture, not in a test.
     The lease verdict keeps 0.15 / 0.35.
   - **Every sentence that names the share.** "the middle 70% of these comps
     still spans" (the condition-spread line) and the home page's "Low and
     High bound the weighted middle 70%". `test/index-html.test.js` derives
     the 70 from the constants, so a band change fails the build until the
     copy follows. "The middle range of N sale comps" names no share and
     stands.
   - **home-page.js's sample** (rule 4 there): $4,550,000 / $4,725,000 /
     $5,000,000. No comp had to move this time.
   The outlier chip still flags a comp 25% past the nearest band edge, so a
   wider band flags fewer comps; that is the chip agreeing with the range the
   page shows, and it was left that way on purpose.

3i. **Net lease mode: a single-tenant net-leased subject is valued on cap
   rates (2026-11-23; the owner's ask, "build the net lease mode", the day
   before a demo to a net-lease investment-sales brokerage).** The first
   report run on such a property (a 3,600 SF auto shop on a 15-year absolute
   NNN lease, listed near $2.6M on a 7% cap) valued it near $800,000: it was
   priced at the $/SF of small industrial sales, and a leased pad is priced on
   its rent. Rules:
   - **The trigger is one definition, `VALUATION.isNetLease(type, details)`:**
     Retail with the center type "Single-tenant NNN", a subject field the form
     already had. The page (`netLeaseOn`), the prompt (`buildPrompt`) and the
     comp fit (`refineComps`) all call it, so they cannot disagree about which
     reports are in the mode. No new field, no column, **no migration**.
     Retail only: Industrial and Office have no field that says "net leased".
   - **The math is valuation.js** (`capRateOf`, `capRateBand`,
     `netLeaseValue`, `impliedCapRate`, tested): the comps' cap rates through
     `robustPpsfRange` (middle 70% at four or more, the full spread under
     that), UNWEIGHTED like `rentFromComps`, three sale comps with a readable
     rate at least. `capRateOf` refuses a decimal fraction, a range and
     anything outside 2-20%. Value is NOI over a rate, so the HIGHEST rate is
     the Low figure. Do not borrow `compWeight` for it without a lab run: its
     size and price-tier factors are about buildings and its trend is a price
     index.
   - **`netLeaseValuation(parsed, meta)` in index.html is the one
     computation**, and the hero, `sellTodayEstimate`, the comparison card and
     the Excel sheet all read it. It answers `{ band, source, noi, values }`:
     `source` is `"comps"` or `"market"` (fewer than three rates falls back to
     the search's `market_cap_rate_range`, and the copy says so; with neither,
     it is null and the report is an ordinary Retail one).
   - **Two hero branches, ahead of every other basis.** With an NOI: Low /
     Likely / High in dollars, sub-labels "at a 7.36% cap rate", and
     `lastValuation` set (`median_psf: null`). Without one: the three tiles
     show the cap rates themselves (lowest first, as rates are quoted), the
     basis line says what turns them into dollars, the trust line says what
     $100,000 of income is worth, and `lastValuation` stays null, the lease
     hero's rule: a rate is not a value. Both clear `currentPsfBand` (the
     outlier chips describe a $/SF range the ledger did not use) and draw the
     scatter in cap rates, only off the comps' own rates.
   - **The $/SF figure is a cross-check row, worded as one** ("Net-leased
     properties rarely trade on this"). In the no-NOI branch its dollars sit
     in the sentence, not the Indicated value column (`netLeasePsfEntry(false)`):
     `renderApproaches` leads with every row that has a figure, and it would
     have been the only number in the statement.
   - **The comparison card compares cap rates** (`renderNetLeaseComparison`):
     the rate the asking price implies against the comps' median, in basis
     points. A HIGHER rate at the ask is a LOWER price, so that is the green
     case. It needs the NOI, an ask and a band; otherwise the card hides
     rather than fall back to $/SF, which called a leased pad "66% above
     market".
   - **`netLeaseHero`** (set inside the branches, like `leaseHero`) picks the
     mechanics sentence and skips the generic ask sentence, whose "different
     vintage or a cheaper pocket" explains a $/SF gap.
   - **Private as before (rule 6).** The mode reads `meta.subject.noi`, which
     never reaches `/api/comps` and is stripped from shares, so a shared
     net-lease report shows its reader the cap rates and no dollars. A test
     fails if either function gains a request or storage.
   - **A free report's range is Pro's:** `basisRow` (comp-gate.js) now carries
     `cap_rate` on locked comps.
   - **The search half** is search-pipeline.md ("Net lease"): the NET LEASE
     prompt block and the comp fit's size exemption.
   - **Not built, and worth knowing before a demo:** the market position
     chart is still $/SF (its "You" marker sits far right on a leased pad);
     lease term, lease type and guarantor ride in the comp's `tenancy` text,
     not columns of their own (a real column spans `comp_corpus` and the
     vault's `broker_comps`, two migrations); self-storage and mobile home
     parks have no type; and **the prompt block has never been run against the
     live model** (no key in the session that wrote it), so how many comps
     come back with a cap rate is unmeasured. Run one real search and count
     before trusting it.
   - Tests: `test/valuation.test.js` (the math), `test/index-html.test.js`'s
     last four blocks (the one computation, executed, and every surface held
     to it), `test/comp-fit.test.js`, `test/comp-gate.test.js`. Rendered in
     Chromium on sample comps in all three states, desktop and phone, with no
     console errors.

3j. **An asking price is never trend-indexed (2026-11-27).** The prompt
   dates a comp that is on the market "Active", or "Listed Mar 2025" when
   its page shows a post date, and the valuation counts it as a sale comp at
   the Listing tier's weight. Two things were wrong with how its date was
   read, both in `valuation.js`:
   - **`trendFactor` indexed it from its list date.** The index answers
     "what would this past price be today", and a listing still on the
     market at its ask is already today's price. In a market rising 6% a
     year, a building listed 18 months ago and still unsold counted 9% ABOVE
     its own asking price, when sitting that long says the ask was high to
     begin with. `VALUATION.isOnMarket(c)` (a date starting "Active" or
     "Listed") now makes the factor 1, in a rising market and a falling one.
     `countedPsf` reads the same factor, so the table's `adj` mark cannot
     claim a time adjustment the range did not make.
   - **"Listed Mar 2025" was read by `Date.parse`'s guess.** V8 skips the
     word and answers March 2025; no other engine is bound to, and one that
     does not reads the comp as undated and weighs it in full. `compDateMs`
     now reads it by rule (the word, then the shapes it already knew), to
     the instant V8 gave, so no weight moved in Chrome or on the server; and
     "Listed Q2 2025" and "Listed 03/2025", which V8 could not read, age
     like any other. "Active" is NaN by rule. ⚠ comp-gate.js's `compDateMs`
     moved with it, body for body (the gate ranks by the same recency).
   The list date still ages the comp's WEIGHT (`compWeight`), which was the
   half already right: a stale ask is weaker evidence, not a cheaper
   building. **Not done, because nothing here can measure it:** discounting
   an asking price toward what such listings close at. The corpus cannot say
   what an ask is worth as a comp (corpus.md, "The answer key is weaker than
   it looks"); it needs closed sales paired with their own asks.
   `test/valuation.test.js` holds the three rules.

3. **All valuation math is client-side; the model only supplies market
   figures.** (Since 2026-11-27 the comps' range below is blended with the
   building's own recent sale when the report holds a vetted one: the note at
   the top of this file. Everything this flow says about how the COMPS'
   figure is reached still stands.) `renderOwnerHero()` in `index.html`
   computes the Low/Likely/High
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
     **The sample report is the one exception (2026-11-10)**, because it is
     the one report the form does not describe. Its size and asking price
     (`SAMPLE_SUBJECT`) go straight to `renderResults`, so the wholesale
     re-read took two empty boxes at their word: typing an NOI on the sample
     dropped its 74,000 SF, and the hero fell from the comp range ($8,325,000
     at $112/SF) to the income approach ($8,600,000), taking the asking-price
     comparison with it. The listener now calls `subjectFromForm(meta)`, which
     on a `meta.sample` report keeps the sample's own size and price until the
     visitor has TYPED in that box since the sample opened (`sampleTyped`:
     trusted `input` events only, since the detail fields and the footprint
     estimate both dispatch `input` on `#targetSize`; cleared by `#sampleBtn`),
     and puts them back when the box is emptied, which also takes the box out
     of `sampleTyped`: an emptied `#targetSize` is what the footprint estimate
     fills for the next address. Two things not to "simplify":
     **do not fill the form from the sample** the way the restore paths do.
     Those restore an address with the figures; the sample's would sit under
     whatever address is typed next, and the submit handler reads both (the
     size rides `/api/comps`, is in the cache key and multiplies the next
     hero; on a house the asking price is a `compWeight` factor). And **a
     blank-box-only rule is not enough**: `renderOwnerHero` auto-fills
     `#targetSize` on every real report, so after one search the box is never
     blank, and the last building's size would replace the sample's on the
     next keystroke. NOI, cap rate and `details` are read as on any report
     (the sample brings none of its own). Pinned in `test/index-html.test.js`
     ("Typing an NOI on the sample must not cost it its building"), which
     runs the real listener and the real `#sampleBtn` handler.
   Unlike NOI/debt/rent-roll these are public property attributes, so they are
   sent to the server and **kept** in shared reports. `units` and `lot_acres`
   also drive the $/unit and $/acre cross-checks via `ALT_BASIS` /
   `altBasisEntry`, which render as entries in the hero's `renderApproaches`
   list (min 3 comps carrying the metric). Land is quoted in acres but the
   valuation path is $/SF, so `renderOwnerHero` converts acres × 43,560 when no
   SF is given.
