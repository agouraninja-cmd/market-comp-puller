// index.html has no build step and no bundler, so its one big inline
// <script> block IS the entire front end: search, modals, results
// rendering, exports. Nothing in `npm test` ever parses it, and
// `node --check` cannot read an HTML file -- so today this script has zero
// syntax coverage of any kind.
//
// The failure mode is severe and silent. Per CLAUDE.md's Restart rule, that
// script's very first statement destructures the global VALUATION, so a
// syntax error anywhere in the block throws immediately and aborts the
// whole front end -- no search form, no modals, no report rendering --
// while the page still serves its HTML and CSS untouched. It LOOKS fine and
// does nothing. Upcoming work rewrites large parts of this script, so it
// needs a net.
//
// This follows the precedent in test/vault-page.test.js, which compiles the
// browser JS vault-page.js emits, for the same class of reason: a template
// that builds JavaScript as a string has no compiler watching it until
// something actually parses the output.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const HTML_PATH = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

// A `type` attribute value that is still executable JavaScript. Absence of
// a type attribute ALSO means JavaScript (the HTML default), which is
// handled separately below -- an omitted attribute is not the same as an
// empty string.
const JS_TYPE = /^\s*(text\/javascript|application\/javascript|module)\s*$/i;

// Pulls every <script>...</script> block out of index.html, keeping the raw
// attribute string (so callers can filter on src/type) and an approximate
// starting line number, good enough to find the block by eye in a failure
// message without pretending to be exact.
function extractScriptBlocks(source) {
  const blocks = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(source)) !== null) {
    blocks.push({
      attrs: m[1],
      body: m[2],
      line: source.slice(0, m.index).split("\n").length,
    });
  }
  return blocks;
}

// Real, executable inline JS only. A <script src=...> tag (valuation.js,
// html2canvas, leaflet) has no body here to parse -- it is a reference to a
// separate file. A non-JS `type` (application/ld+json and the like) is data
// a JS parser is SUPPOSED to reject; feeding it to vm.Script would either
// fail this test for the wrong reason or, worse, get "fixed" by someone
// rewriting JSON as JavaScript to make a red test go green.
function isRealJsBlock(block) {
  if (/\bsrc\s*=/i.test(block.attrs)) return false;
  const typeMatch = block.attrs.match(/\btype\s*=\s*["']([^"']*)["']/i);
  if (typeMatch && !JS_TYPE.test(typeMatch[1])) return false;
  if (!block.body.trim()) return false;
  return true;
}

test("index.html has at least one real inline script block to check", () => {
  // A future edit to index.html's <script> tags (a new src, a stray type
  // attribute) could accidentally filter every block out, and a loop over
  // zero blocks below would pass having checked nothing -- a green test
  // that verifies nothing is worse than no test, so that has its own guard.
  const real = extractScriptBlocks(html).filter(isRealJsBlock);
  assert.ok(
    real.length > 0,
    "found zero real inline <script> blocks in index.html; the extraction filter is probably wrong"
  );
});

test("index.html's inline script blocks parse as valid JavaScript", () => {
  const real = extractScriptBlocks(html).filter(isRealJsBlock);
  for (const block of real) {
    try {
      // Parsing only, never running: new vm.Script compiles without
      // executing, so this needs none of document/window/localStorage,
      // which this Node process does not have.
      new vm.Script(block.body, { filename: "index.html" });
    } catch (err) {
      assert.fail(
        "index.html's inline <script> starting near line " + block.line +
        " failed to parse: " + err.message
      );
    }
  }
});

// --- unitDesignatorOf -------------------------------------------------------
//
// One regex now gates BOTH machine claims about a specific building: the
// footprint size estimate that the value hero multiplies, and the map popup
// photo. It exists because "6728 W Fairview Ave Trailer 51" geocodes to a
// mobile home park's entrance, where 38 footprints share the street number —
// on 2026-08-13 that report valued a $52,000 trailer at $795,000 off a bike
// shop's 10,064 sq ft footprint and showed the shop's photo.
//
// It is the kind of rule that gets "simplified" later, and both failure
// directions are silent: loosened, a wrong building's square footage becomes a
// dollar figure again; tightened, ordinary addresses quietly lose their size
// estimate and their photo. Hence a real behavioural test rather than trusting
// the parse check above.
//
// The definition is lifted out of index.html and compiled on its own, the same
// technique test/vault-page.test.js uses on the vault's emitted script: it is
// the only way to reach a function that lives inside a DOM-dependent block.
function loadUnitDesignatorOf() {
  const src = html.match(/var UNIT_KEYWORDS = [\s\S]*?function unitDesignatorOf\(address\) \{[\s\S]*?\n  \}/);
  assert.ok(src, "could not find unitDesignatorOf in index.html — was it renamed or moved?");
  const ctx = vm.createContext({});
  new vm.Script(src[0] + "\n;this.fn = unitDesignatorOf;", { filename: "index.html" }).runInContext(ctx);
  return ctx.fn;
}

test("unitDesignatorOf spots an address that names one unit of a site", () => {
  const unitOf = loadUnitDesignatorOf();
  for (const addr of [
    "6728 W Fairview Ave Trailer 51, Boise, ID 83704",   // the real report
    "7701 W Ustick Rd Trailer 100, Boise, ID 83704",     // and one of its comps
    "1234 Main St Apt 3B, Denver, CO",
    "1234 Main St #45, Denver, CO",
    "500 Market St Ste 200, San Francisco, CA",
    "42 Oak Blvd SPC 12, Mesa, AZ",
    "9 Pine Dr Unit A, Boise, ID",       // bare-letter unit ids still count
    "700 5th Ave Bldg B, Seattle, WA",
  ]) {
    assert.ok(unitOf(addr), `should have found a unit designator in: ${addr}`);
  }
});

test("unitDesignatorOf leaves whole-property addresses alone", () => {
  const unitOf = loadUnitDesignatorOf();
  for (const addr of [
    "6728 W Fairview Ave, Boise, ID 83704",   // the same park, addressed as a whole
    "1210 N 17th St, Boise, ID 83702",
    "1500 W Bethany Home Rd, Phoenix, AZ",
    "One Wilshire Blvd, Los Angeles, CA",     // no house number at all
    // A bare trailing number is a typo far more often than a space number, and
    // this rule returns a refusal, so it must not claim one.
    "6728 W Fairview Ave 51, Boise, ID",
  ]) {
    assert.equal(unitOf(addr), null, `should NOT have found a unit designator in: ${addr}`);
  }
});

test("unitDesignatorOf does not read the vocabulary out of ordinary street names", () => {
  // Every one of these contains a keyword followed by one or two letters, which
  // an earlier pass matched: "Roomy" as room + y, "Lotus" as lot + us,
  // "United" as unit + ed, and "Ste Genevieve" as suite "Genevieve". Each false
  // positive silently costs that address its size estimate and its photo
  // forever, which is why the bare-letter form requires a separator.
  const unitOf = loadUnitDesignatorOf();
  for (const addr of [
    "100 Roomy Lane, Austin, TX",
    "44 Lotus Lane, Sacramento, CA",
    "1200 United Nations Plaza, New York, NY",
    "123 Ste Genevieve Ave, St Louis, MO",
    "455 Floor Street, Toronto, ON",
    "9 Spaces Rd, Reno, NV",
    "1 Apartments Way, Tulsa, OK",
  ]) {
    assert.equal(unitOf(addr), null, `street name misread as a unit designator: ${addr}`);
  }
});

// ----------------------------------------------------------------------------
// Static comp map — the raster that carries the map into the PDF and the PNG.
// Spec: docs/superpowers/specs/2026-08-13-static-comp-map-design.md
// ----------------------------------------------------------------------------

// Same technique as loadUnitDesignatorOf above: the projection and the
// zoom-fit are pure math sitting inside a DOM-dependent block, and they are
// the half of this feature that fails silently. A wrong fit does not throw —
// it prints a map with pins off the edge, or one rooftop filling the frame.
function loadSmapFit() {
  const src = html.match(/const SMAP_W = [\s\S]*?function smapFit\(pts\) \{[\s\S]*?\n  \}/);
  assert.ok(src, "could not find smapFit in index.html — was it renamed or moved?");
  const ctx = vm.createContext({ window: {}, setTimeout });
  new vm.Script(src[0] + "\n;this.fit = smapFit; this.project = smapProject;" +
    "\n;this.W = SMAP_W; this.H = SMAP_H; this.PAD = SMAP_PAD; this.MAXZ = SMAP_MAX_Z;",
    { filename: "index.html" }).runInContext(ctx);
  return ctx;
}

// Where each pin lands inside the frame, given a fit — the same arithmetic
// drawStaticMap does (project at the chosen zoom, offset by the crop origin).
function placePins(s, pts, fit) {
  const ox = fit.cx - s.W / 2, oy = fit.cy - s.H / 2;
  return pts.map((p) => {
    const q = s.project(p.lat, p.lng, fit.z);
    return { x: q.x - ox, y: q.y - oy };
  });
}

test("the static map's zoom fit keeps every pin inside the frame", () => {
  const s = loadSmapFit();
  const sets = [
    // A tight downtown set, a few blocks apart.
    [{ lat: 43.6150, lng: -116.2023 }, { lat: 43.6178, lng: -116.1994 }, { lat: 43.6121, lng: -116.2065 }],
    // A metro-wide set: Boise out to Meridian and Nampa.
    [{ lat: 43.6150, lng: -116.2023 }, { lat: 43.6121, lng: -116.3915 }, { lat: 43.5407, lng: -116.5635 }],
    // A rural wide-radius report, most of a state apart.
    [{ lat: 43.6150, lng: -116.2023 }, { lat: 47.6588, lng: -117.4260 }],
    // Coast to coast: the zoom has to keep falling until it fits.
    [{ lat: 40.7128, lng: -74.0060 }, { lat: 34.0522, lng: -118.2437 }],
  ];
  for (const pts of sets) {
    const fit = s.fit(pts);
    assert.ok(fit, `no zoom fit found for ${JSON.stringify(pts)}`);
    assert.ok(fit.z >= 1 && fit.z <= s.MAXZ, `zoom ${fit.z} out of range`);
    for (const at of placePins(s, pts, fit)) {
      assert.ok(at.x >= s.PAD - 1 && at.x <= s.W - s.PAD + 1,
        `pin at x=${at.x} escapes the padded frame (width ${s.W})`);
      assert.ok(at.y >= s.PAD - 1 && at.y <= s.H - s.PAD + 1,
        `pin at y=${at.y} escapes the padded frame (height ${s.H})`);
    }
  }
});

test("the static map picks the tightest zoom that still fits, and caps it", () => {
  const s = loadSmapFit();
  // A single pin spans nothing, so nothing forces a zoom out. It must stop at
  // the cap rather than running to maximum: one comp on its own should print
  // as a property in its neighbourhood, not as a rooftop filling the page.
  assert.equal(s.fit([{ lat: 43.6150, lng: -116.2023 }]).z, s.MAXZ);
  // And a wider set must genuinely zoom out rather than clipping.
  const near = s.fit([{ lat: 43.6150, lng: -116.2023 }, { lat: 43.6178, lng: -116.1994 }]).z;
  const far = s.fit([{ lat: 43.6150, lng: -116.2023 }, { lat: 43.5407, lng: -116.5635 }]).z;
  assert.ok(far < near, `a wider comp set must zoom out (near ${near}, far ${far})`);
});

test("the static map is built from exportableComps, never includedComps", () => {
  // THE rule of this feature. A broker's private vault comp is kept out of
  // every file the app produces, and a pin is that comp's location — the same
  // leak in a form nobody would think to check, because the table above it
  // would correctly be missing the row.
  const fn = html.match(/function staticMapPoints\(\)[\s\S]{0,900}?\n  \}/);
  assert.ok(fn, "index.html must define staticMapPoints()");
  assert.match(fn[0], /exportableComps\(\)/);
  assert.ok(!/includedComps\(\)/.test(fn[0]),
    "staticMapPoints must not read includedComps() — that is how a private comp reaches an export");
});

test("static map tiles are requested in CORS mode, before the src is set", () => {
  // The whole no-taint argument rests on this: a host answering without CORS
  // headers must fail the LOAD rather than return a bitmap that poisons the
  // canvas and makes toDataURL throw. Setting crossOrigin after src is the
  // classic way to lose that, and it fails silently on hosts that do send the
  // headers — which is all of them, until one does not.
  const fn = html.match(/function smapTile\(url, deadline\)[\s\S]{0,800}?\n  \}/);
  assert.ok(fn, "index.html must define smapTile()");
  const co = fn[0].indexOf("crossOrigin");
  const src = fn[0].indexOf("img.src");
  assert.ok(co !== -1 && src !== -1, "smapTile must set both crossOrigin and src");
  assert.ok(co < src, "crossOrigin must be set BEFORE src or the tile loads tainted");
});

test("the collapsed approaches stay collapsed on a phone, and open on paper", () => {
  // The approaches that produced no figure hide behind a toggle, and the
  // whole thing was silently inert under 560px: the phone treatment sets
  // `.ap-stmt tbody { display: block }` at (0,1,1), which out-specifies
  // Tailwind's `.hidden` at (0,1,0), so the rows rendered anyway while a
  // desktop looked perfectly correct. Measured at 375px before this line
  // existed. Same trap as .deck.hide in vault-page.js and the
  // `.hdr nav [hidden]` line in ACCOUNT_NAV_CSS, which is why it is pinned
  // rather than trusted to survive the next tidy-up.
  assert.match(html, /\.ap-stmt tbody\.hidden \{ display: none; \}/,
    "without this the toggle does nothing on any screen under 560px");
  // An export is the copy that gets forwarded, so it carries every approach
  // whether it ran or not. Two separate reveals because html2canvas ignores
  // @media print, exactly as #ownerTrustHow already documents.
  assert.match(html, /#apOff \{ display: table-row-group !important; \}/);
  const onclone = html.match(/onclone: \(doc\) => \{[\s\S]*?doc\.head\.appendChild\(s\)/);
  assert.ok(onclone, "downloadImage's onclone must still exist");
  assert.match(onclone[0], /#apOff \{ display: table-row-group !important; \}/,
    "the PNG must not be the one copy of the report that hides the unrun approaches");
  // The control itself is navigation, not report content, in both exports.
  assert.match(html, /toggleRow\.className = "no-print no-capture ap-toggle"/);
});

test("print unhides the map card only for a ready, unhidden raster", () => {
  // Three ways this goes wrong and prints something worse than the missing map
  // it replaces: unhiding the card with no raster (an empty box under a
  // caption), leaving Leaflet's own pane visible next to the raster, and
  // printing last report's raster inside a card the current report hid for
  // having no coordinates.
  assert.match(html, /#mapCard \{ display: none !important; \}/);
  assert.match(html, /#mapCard\.map-static-ready:not\(\.hidden\) \{ display: block !important; \}/);
  assert.match(html, /#mapCard\.map-static-ready:not\(\.hidden\) #compMap \{ display: none !important; \}/);
  // The raster itself is print-only, so it can never show up on screen.
  assert.match(html, /<img id="mapStatic" class="print-only"/);
});

test("the PNG export swaps the Leaflet pane for the raster, and falls back to dropping the card", () => {
  const fn = html.match(/async function downloadImage\(\)[\s\S]{0,5000}?\n  \}/);
  assert.ok(fn, "index.html must define downloadImage()");
  // Awaited, not raced: the raster has to exist before html2canvas walks the
  // DOM looking for it.
  assert.match(fn[0], /await ensureStaticMap\(\)/);
  assert.match(fn[0], /staticReady \? el\.id === "compMap" : el\.id === "mapCard"/);
  // .print-only is display:none on screen and html2canvas honours the screen
  // stylesheet, so the clone has to reveal it or the capture shows an empty card.
  assert.match(fn[0], /getElementById\("mapStatic"\)[\s\S]{0,120}display = "block"/);
});

test("renderMap retires a raster that no longer matches its pins", () => {
  // The seconds between a new report painting and its geocodes settling are a
  // window where the previous report's raster is still marked ready. Ctrl+P in
  // that window would print the old map above the new table — worse than
  // printing none, because it looks right. Invalidation therefore happens at
  // the TOP of renderMap, not at the settle that builds the replacement.
  // Just the head of the function: the call has to be up here, not buried in
  // the settle block at the bottom.
  const fn = html.match(/function renderMap\(parsed, meta, isRetry\) \{[\s\S]{0,500}/);
  assert.ok(fn, "index.html must define renderMap()");
  assert.match(fn[0], /invalidateStaticMap\(\)/);

  const inv = html.match(/function invalidateStaticMap\(\)[\s\S]{0,700}?\n  \}/);
  assert.ok(inv, "index.html must define invalidateStaticMap()");
  // Keyed, not unconditional: a theme toggle re-renders the same pins, and
  // dropping the raster there would refetch every tile for no change (the
  // raster is always light, so the theme cannot alter it).
  assert.match(inv[0], /staticMapKeyFor\(staticMapPoints\(\)\) === staticMapKey/);
  assert.match(inv[0], /classList\.remove\("map-static-ready"\)/);
});

test("the print button waits for the raster", () => {
  const handler = html.match(/getElementById\("printBtn"\)\.addEventListener[\s\S]{0,600}?\}\)\);/);
  assert.ok(handler, "index.html must wire the print button");
  const wait = handler[0].indexOf("await ensureStaticMap()");
  const print = handler[0].indexOf("window.print()");
  assert.ok(wait !== -1, "the print button must await the raster");
  assert.ok(wait < print, "the raster must be awaited BEFORE the print dialog opens");
});

// ----------------------------------------------------------------------------
// Map pin popups — Street View is the photo. The aerial roof is a
// different tree, swapped in only after a 404. Hover waits until the
// JPEG has settled so the first paint is already the facade.
// ----------------------------------------------------------------------------

test("map pin popups show Street View without stacking the aerial underneath", () => {
  const fn = html.match(/const svPhoto = \(marker, zoom, address\) => \{[\s\S]*?\n    \};\n    \/\/ Popups must never/);
  assert.ok(fn, "index.html must define svPhoto()");
  assert.match(fn[0], /popupPhotoLL\(marker, address\)/);
  assert.match(fn[0], /streetViewThumb\(snapped,/);
  assert.match(fn[0], /aerialThumb\(snapped,/);
  assert.match(fn[0], /marker\._svStatus === "fail"/);
  assert.match(fn[0], /streetviewEnabled/);
  // The two photos must not share a tree — that is what flashed bird's-eye.
  assert.doesNotMatch(fn[0], /overlay/);
  assert.doesNotMatch(fn[0], /cn-sv-fallback/);
  assert.doesNotMatch(fn[0], /opacity:0/);
});

test("streetViewThumb has no Esri tiles, and a 404 swaps in aerialThumb", () => {
  const fn = html.match(/function streetViewThumb\([\s\S]*?\n  function cnAerialFallback/);
  assert.ok(fn, "index.html must define streetViewThumb()");
  assert.match(fn[0], /streetViewSrc\(ll\)/);
  assert.match(fn[0], /cnAerialFallback\(this\)/);
  assert.match(fn[0], /&copy; Google/);
  assert.doesNotMatch(fn[0], /arcgisonline|World_Imagery|&copy; Esri/);
  assert.match(html, /function cnAerialFallback\(img\) \{[\s\S]*?aerialThumb\(/);
});

test("popupPhotoLL refuses a pin that cannot honestly show a building", () => {
  const fn = html.match(/function popupPhotoLL\(marker, address\) \{[\s\S]*?\n  \}\n  function streetViewSrc/);
  assert.ok(fn, "index.html must define popupPhotoLL()");
  assert.match(fn[0], /marker && marker\._bldgLL/);
  assert.match(fn[0], /marker\._geoOk !== true/);
  assert.match(fn[0], /unitDesignatorOf\(address\)/);
});

test("map pin hover opens in 60ms and closes in 80ms", () => {
  const fn = html.match(/const wireHoverPreview = \(m\) => \{[\s\S]*?\n    \};\n    const addSubjMarker/);
  assert.ok(fn, "index.html must define wireHoverPreview()");
  assert.match(fn[0], /setTimeout\([\s\S]*?,\s*60\)/);
  assert.match(fn[0], /streetViewStatus/);
  assert.match(fn[0], /m\.openPopup\(\)/);
  assert.match(fn[0], /setTimeout\(\(\) => m\.closePopup\(\), 80\)/);
  assert.doesNotMatch(fn[0], /setTimeout\(\(\) => m\.openPopup\(\), 120\)/);
  assert.doesNotMatch(fn[0], /setTimeout\(\(\) => m\.closePopup\(\), 320\)/);
  // Opening before the JPEG settles is what flashed the roof.
  assert.doesNotMatch(fn[0], /setTimeout\(\(\) => m\.openPopup\(\), 60\)/);
});

test("Leaflet popup fade is disabled so hover close is the timer, not a 200ms fade", () => {
  assert.match(html, /\.leaflet-fade-anim \.leaflet-popup \{ transition: none; opacity: 1 \}/);
});

test("aerial popup tiles are prefetched after the building snap", () => {
  assert.match(html, /function prefetchAerialThumbs\(markers\)/);
  assert.match(html, /function aerialTileSpec\(/);
  const snap = html.match(/snapMarkersToBuildings\(allMarkers\(\)\)[\s\S]{0,400}/);
  assert.ok(snap, "renderMap must call snapMarkersToBuildings");
  assert.match(snap[0], /prefetchAerialThumbs\(allMarkers\(\)\)/);
});

test("Street View is prefetched for photo-eligible pins so hover is the facade", () => {
  const prefetch = html.match(/function prefetchStreetViewThumbs\(markers\) \{[\s\S]*?\n  \}/);
  assert.ok(prefetch, "index.html must define prefetchStreetViewThumbs()");
  assert.match(prefetch[0], /streetviewEnabled/);
  assert.match(prefetch[0], /popupPhotoLL\(m, m\._addr\)/);
  assert.match(prefetch[0], /streetViewStatus\(ll\)/);
  assert.match(html, /function streetViewSrc\(ll\) \{[\s\S]*?\/api\/streetview\?lat=/);
  assert.match(html, /function streetViewStatus\(ll\)/);
  const snap = html.match(/snapMarkersToBuildings\(allMarkers\(\)\)[\s\S]{0,400}/);
  assert.ok(snap, "renderMap must call snapMarkersToBuildings");
  assert.match(snap[0], /prefetchStreetViewThumbs\(allMarkers\(\)\)/);
});

test("landing address handoff fills #address from sessionStorage and drops the key", () => {
  // File search, not a browser. The landing cannot reach this script;
  // this only proves the app side of the handoff is actually wired.
  // Anchored on the READ, not on the first mention of the key. The shared
  // report card writes the same key on its way into signup, so a plain
  // first-occurrence match lands on the writer and proves nothing about the
  // handoff this test exists to pin.
  const boot = html.match(/getItem\("pendingLandingAddress\.v1"\)[\s\S]{0,900}/);
  assert.ok(boot, "index.html must read pendingLandingAddress.v1");
  assert.match(boot[0], /getElementById\("address"\)/);
  assert.match(boot[0], /removeItem\(["']pendingLandingAddress\.v1["']\)/);
  assert.ok(
    !/compForm\.submit|requestSubmit|#compForm/.test(boot[0]),
    "filling the box is the whole handoff; do not auto-run a search"
  );
});

test("hero draws county assessment as a cross-check, never a headline", () => {
  assert.match(html, /const assessedApproachEntry = /);
  assert.match(html, /label: "County assessment"/);
  assert.match(html, /Counties often lag the market/);
  assert.match(html, /outlierOf\(assessedNum/);
  assert.match(html, /withAssessed\(/);
  assert.match(html, /County assessed value/);
  assert.match(html, /e\.href && \/\^https\?:\\\/\\\//);
  assert.ok(!/innerHTML/.test(html.match(/const renderApproaches = [\s\S]*?const costApproachEntry/)[0]),
    "renderApproaches must keep using DOM nodes, not innerHTML, when adding the Source link");
  const hero = html.match(/function renderOwnerHero[\s\S]*?card\.classList\.remove\("hidden"\)/);
  assert.ok(hero, "could not bound renderOwnerHero");
  assert.equal(/lowEl\.textContent = assessed|animateValue\(midEl, assessed/.test(hero[0]), false,
    "assessed value must never be written into Low/Likely/High");
});

test("the hero has a listing line so an ask the size lookup already saw cannot stay invisible", () => {
  // The 2026-08-13 Austin Rosedale report looked up 2,752 SF from the listing
  // and never mentioned the $1,250,000 ask sitting next to it.
  assert.match(html, /id="ownerAsking"/);
  assert.match(html, /function renderSubjectAsking\(/);
  assert.match(html, /function askingRangeFrom\(/);
  assert.match(html, /Currently listed at/);
  assert.match(html, /askFit\(/);
  assert.match(html, /a cheaper pocket than this property/);
  assert.equal(/The ask may be ambitious relative to these comps/.test(html), false,
    "an estimate below the ask is the cheaper-pocket failure, not an ambitious list price");
});

test("Residential reports compare list price to Low/Likely/High without a typed Refine size", () => {
  // The CRE comparison card hid itself unless BOTH a size and a price were
  // typed. A house buyer who pasted a Zillow address never filled Refine, and
  // the useful question is ask vs this estimate, not $/SF vs market avg.
  assert.match(html, /function renderResidentialAskComparison\(/);
  const fn = html.match(/function renderResidentialAskComparison\(parsed, card\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, "could not bound renderResidentialAskComparison");
  assert.match(fn[0], /askingRangeFrom\(parsed\)/);
  assert.match(fn[0], /lastValuation/);
  assert.match(fn[0], /askFit\(/);
  assert.equal(/subjectRangeFromMeta\("size"\)/.test(fn[0]), false,
    "the house-buyer card is dollars vs dollars; a missing Refine size must not hide it");
  const gate = html.match(/function renderComparison\(parsed\) \{[\s\S]{0,400}/);
  assert.ok(gate, "could not bound renderComparison");
  assert.match(gate[0], /currentMeta\.type === "Residential"/);
  assert.match(gate[0], /renderResidentialAskComparison/);
});

test("the house hero passes Residential into the valuation so far comps count less", () => {
  const hero = html.match(/function renderOwnerHero[\s\S]*?card\.classList\.remove\("hidden"\)/);
  assert.ok(hero, "could not bound renderOwnerHero");
  assert.match(hero[0], /\.\.\.weightOpts\(meta, parsed\)/,
    "without weightOpts the house report would ignore the market-note radius and the asking $/SF");
  assert.match(html, /function weightOpts\(/);
  assert.match(html, /parseRadiusMiles\(meta && meta\.note\)/);
});

test("Residential size label is Living area, and the CRE toolkit stays behind Refine", () => {
  assert.match(html, /Residential: "Living area \(SF\)"/);
  assert.equal(/Residential: "Property size \(SF\)"/.test(html), false,
    "the 2026-07-27 spec's Living area label is the live one");
  const cluster = html.match(/function renderAnalysisCluster\(parsed, meta, resetAssumptions\) \{[\s\S]*?\n  \}/);
  assert.ok(cluster, "could not bound renderAnalysisCluster");
  assert.match(cluster[0], /hideResiToolkit/);
  assert.match(cluster[0], /type === "Residential" && !hasNoi/);
  assert.match(cluster[0], /reportTabs[\s\S]{0,80}hidden/);
});

test("a house report's CTA says talk to a local agent and still stores source bov", () => {
  const src = html.match(/function bovCopy\(meta\) \{[\s\S]*?\n  \}/);
  assert.ok(src, "could not find bovCopy in index.html — was it renamed or moved?");
  const ctx = vm.createContext({});
  new vm.Script(src[0] + "\n;this.fn = bovCopy;", { filename: "index.html" }).runInContext(ctx);
  const house = ctx.fn({ type: "Residential" });
  const warehouse = ctx.fn({ type: "Industrial" });
  assert.equal(house.button, "Talk to a local agent");
  assert.match(house.helper, /not a brokerage/);
  assert.equal(warehouse.button, "Get a free Broker Opinion of Value");
  assert.match(html, /openLeadModal\("bov"\)/,
    "the click still stores source bov; only the label changed");
  assert.match(html, /id="ownerYearBuilt"/);
  assert.match(html, /function renderSubjectYearBuilt\(/);
  assert.match(html, /renderSubjectYearBuilt\(parsed, meta\)/);
});

test("Residential comps table drops tenancy and keeps year built", () => {
  const start = html.indexOf("  const BASE_COLUMNS = [");
  const fn = html.indexOf("  function columnsForType(type, txFocus) {", start);
  const end = html.indexOf("\n  }", fn);
  assert.ok(start >= 0 && fn > start && end > fn, "could not bound columnsForType");
  const src = html.slice(start, end + 4);
  const ctx = vm.createContext({});
  new vm.Script(src + "\n;this.columnsForType = columnsForType;", { filename: "index.html" }).runInContext(ctx);
  const house = ctx.columnsForType("Residential").map((c) => c.key);
  assert.equal(house.includes("tenancy"), false,
    "tenancy is a CRE occupancy column; on a house report it was a wide gap before Year Built");
  assert.ok(house.includes("year_built"));
  assert.ok(house.includes("beds_baths"));
  const warehouse = ctx.columnsForType("Industrial").map((c) => c.key);
  assert.ok(warehouse.includes("tenancy"));
  assert.ok(warehouse.includes("year_built"));
  const land = ctx.columnsForType("Land").map((c) => c.key);
  assert.equal(land.includes("tenancy"), false);
  assert.equal(land.includes("year_built"), false);
});

test("comps table rows are compact throughout, and notes stay on one line", () => {
  assert.match(html, /#compsTable td,\s*#compsTable thead th button \{ padding: 6px 12px; \}/);
  assert.match(html, /td\.comp-notes/);
  assert.match(html, /col\.key === "notes" \? "comp-notes/);
});

test("a glued street number still counts as a house, so the value hero shows", () => {
  // 1210N17th st (Boise North End) is a real address people type without a
  // space after the number. The hero used /^\s*\d+\s/, which hid
  // Low/Likely/High and treated it as a city-only search.
  const src = html.match(/function houseNumberOf\(address\) \{[\s\S]*?\n  \}/);
  assert.ok(src, "could not find houseNumberOf — was it renamed or moved?");
  const ctx = vm.createContext({});
  new vm.Script(src[0] + "\n;this.fn = houseNumberOf;", { filename: "index.html" }).runInContext(ctx);
  assert.equal(ctx.fn("1210N17th st"), "1210");
  assert.equal(ctx.fn("1210 N 17th St, Boise, ID"), "1210");
  assert.equal(ctx.fn("Boise ID"), null);
  assert.equal(ctx.fn("One Wilshire Blvd"), null);
  const hero = html.match(/function renderOwnerHero\(parsed, meta\) \{[\s\S]{0,1200}/);
  assert.ok(hero, "could not bound renderOwnerHero");
  assert.match(hero[0], /houseNumberOf\(meta\.address\)/);
  assert.equal(/hasStreetNumber = \/\^\\s\*\\d\+\\s\//.test(hero[0]), false,
    "the hero must not still require a space after the house number");
});

// ---------------------------------------------------------------------------
// The shared-report lock card. A stranger holding a forwarded link is the one
// visitor who reaches this app without choosing to, and /r/<id> is the only
// path the account wall lets through — so this card is the whole conversion
// surface for the only feature that reaches people who have never heard of us.
// ---------------------------------------------------------------------------

test("the shared-report card ships hidden and is swapped in by applySharedLock", () => {
  assert.match(html, /id="lockShared" class="hidden"/,
    "the shared variant must be hidden until a shared report is actually on screen");
  assert.match(html, /id="lockDefault"/, "the generic card needs its own wrapper to hide");
  assert.match(html, /function applySharedLock\(meta\)/, "one function owns the swap");
  // applySearchLock stays the only thing that decides whether the CARD shows.
  const swap = html.match(/function applySharedLock\(meta\)[\s\S]{0,1400}/)[0];
  assert.equal(/classList\.toggle\("hidden", !locked\)/.test(swap), false,
    "applySharedLock must not take over visibility from applySearchLock");
});

test("the shared status line matches what the reader can actually see", () => {
  // The bug this replaced: one line told every reader to "enter an address
  // above", while a locked reader had the signup card standing where that
  // field would be.
  const fn = html.match(/function showSharedStatus\(\)[\s\S]{0,700}/);
  assert.ok(fn, "showSharedStatus should exist");
  // Through looksSignedIn(), not currentUser: this line is drawn from
  // applySearchLock, which can run before /api/account/me answers, and a
  // signed-in member opening a shared link was told to create an account for
  // the length of that fetch. Same question, one answer (see auth-boot.test.js).
  assert.match(fn[0], /accountWall && !looksSignedIn()/, "it must branch on the lock state");
  assert.match(fn[0], /Create a free account below/, "the locked wording points at the card");
  assert.match(fn[0], /Enter an address above/, "the unlocked wording points at the form");
  assert.match(html, /applySearchLock[\s\S]{0,400}showSharedStatus\(\)/,
    "it must be driven by applySearchLock, since the report renders before /api/config answers");
});

test("an address typed on a shared report survives signup and is never auto-run", () => {
  const fire = html.match(/if \(fireSharedAddress\)[\s\S]{0,600}/);
  assert.ok(fire, "the post-signup consumption should exist");
  assert.match(fire[0], /getElementById\("address"\)/, "it fills the real search box");
  assert.ok(!/requestSubmit|compForm\.submit|runSearch\(/.test(fire[0]),
    "a signup is not consent to spend: prefill and focus, never submit");
  assert.match(html, /pendingSharedAddress = "";\s*\/\/ \.\.\.and must not prefill/,
    "a cancelled signup must not resurrect the address later, like every other pending flag");
});

// ----------------------------------------------------------------------------
// The messaging hub's two client surfaces on My Desk (slice 1, 2026-08-13).
// Spec: docs/superpowers/specs/2026-08-13-messaging-hub-design.md
// NOT the connection hub at /brokers.
// ----------------------------------------------------------------------------

test("the desk's hub gate reads proConfig.canUseVault, not proConfig.pro.canUseVault", () => {
  // proConfig IS the pro block (`proConfig = cfg.pro || …`), not a wrapper
  // around one. The first draft of this button read proConfig.pro.canUseVault,
  // which is undefined for everyone, so "Start a hub" would never have
  // rendered for anybody and nothing would have failed.
  const fn = html.match(/function hubCreationAllowed\(\)[\s\S]{0,400}?\n  \}/);
  assert.ok(fn, "index.html must define hubCreationAllowed()");
  assert.match(fn[0], /proConfig\s*&&\s*proConfig\.canUseVault/);
  assert.ok(!/proConfig\.pro\b/.test(fn[0]), "proConfig is the pro block already");
  // It is a `let` declared thousands of lines below, so reading it needs the
  // same TDZ guard addressExplorerAllowed() carries — and this one must fail
  // CLOSED, because a button that 403s is worse than a button withheld.
  assert.match(fn[0], /try\s*\{[\s\S]*catch[\s\S]*return false/);
});

test("the desk hub list has no empty state, and never shows one", () => {
  // A member who has never been invited into a hub cannot start one from this
  // page, so an empty section would advertise a door with no handle. Contrast
  // the two share lists, which teach a feature this member can use.
  assert.match(html, /id="deskHubs"/);
  assert.match(html, /id="deskHubRows"/);
  assert.ok(!/id="deskHubsEmpty"/.test(html), "the hub list is hidden when empty, not emptied");
  const fn = html.match(/async function renderDeskHubs\(\)[\s\S]{0,4000}?\n  \}/);
  assert.ok(fn, "index.html must define renderDeskHubs()");
  assert.match(fn[0], /if \(!rows\.length\) return;/);
  // Every failure is silent here: this is an extra list at the bottom of a
  // page that already works, and a hub outage must not put an error on the
  // desk of somebody who came for their portfolio.
  assert.ok(!/deskHubsLoadError|classList\.remove\("hidden"\)[\s\S]{0,40}rr/.test(fn[0]),
    "renderDeskHubs must fail silently");
  // theirs, never mine: a broker's own hubs live on /vault.
  assert.match(fn[0], /data\.theirs/);
  assert.ok(!/data\.mine/.test(fn[0]), "the desk shows the tenant side only");
});

test("hub rows render user-authored text through textContent, never innerHTML", () => {
  // A hub title is typed by the broker who created it, so it is user-authored
  // text like an address or a viewer email — the rule the rest of this desk
  // already follows.
  const fn = html.match(/async function renderDeskHubs\(\)[\s\S]{0,4000}?\n  \}/)[0];
  assert.match(fn, /link\.textContent = h\.title/);
  assert.ok(!/innerHTML\s*=\s*[^"']/.test(fn.replace(/innerHTML = "";/g, "")),
    "no interpolated innerHTML in the hub list");
});

test("every Tailwind class the hub surfaces use is in the vendored stylesheet", () => {
  // The vendored tailwind.css is generated, and a class missing from it
  // silently does not style — CLAUDE.md's standing trap. Three of these
  // (min-w-[220px], border-[#E7E3D9], inline-block) were missing on the first
  // pass and were swapped for vendored equivalents rather than regenerated.
  const css = fs.readFileSync(path.join(__dirname, "..", "tailwind.css"), "utf8");
  for (const cls of ["min-w-0", "inline-flex", "flex-1", "border-t", "pt-2", "gap-2"]) {
    assert.ok(css.includes("." + cls), `tailwind.css is missing .${cls}`);
  }
  for (const hex of ["ECEAE3", "D8D4C9", "4C5665", "B91C1C", "1A2433", "68707E", "5A6473"]) {
    assert.ok(css.includes(hex), `tailwind.css is missing the ${hex} colour utilities`);
  }
});

test("empty desk copy names the way properties actually get there", () => {
  // THIS TEST'S PREMISE REVERSED ON 2026-08-31, and the reversal is the point.
  //
  // It used to assert that the copy did NOT mention Save, because every
  // signed-in search auto-saved itself and telling somebody to press a button
  // that had already fired was the bug. The portfolio is opt-in now — it holds
  // what a member says they OWN — so Save IS the mechanism and naming it is
  // correct. "Run a report and it will show up here" became untrue the same
  // day, which is why the old wording is pinned as FORBIDDEN rather than
  // simply dropped: it reads perfectly well and would quietly promise the old
  // behaviour back.
  assert.doesNotMatch(html, /Run a report and it will show up here/,
    "a report does not land on the desk by itself any more");
  const m = html.match(/id="deskEmpty"[^>]*>([\s\S]*?)<\/p>/);
  assert.ok(m, "#deskEmpty must still exist");
  const copy = m[1];
  assert.match(copy, /Save to portfolio/, "it has to name the control that does it");
  assert.match(copy, /recent searches/i, "and the other door, for a report already run");
  // Owner's standing copy rule (2026-08-22): no em dashes in copy.
  assert.ok(!copy.includes("\u2014"), "no em dashes in copy");
});

test("a failed desk read says nothing has been lost, not just that it failed", () => {
  // Both lines cover sections holding saved work — one the member's own
  // portfolio, one the reports colleagues shared with them — and a bare
  // "couldn't load" there reads as data loss to exactly the person most
  // likely to be looking at it. The shares line said only that it failed
  // until 2026-08-22. Neither may go back to one sentence.
  for (const id of ["deskLoadError", "deskSharesLoadError"]) {
    const m = html.match(new RegExp('id="' + id + '"[^>]*>([^<]+)<'));
    assert.ok(m, `${id} is gone`);
    assert.match(m[1], /Couldn't load/, `${id} must name the failure`);
    assert.match(m[1], /Nothing has been lost/, `${id} must say nothing is gone`);
  }
});

test("auto-save lives inside saveHistory, behind the same three guards", () => {
  const start = html.indexOf("function saveHistory(");
  const end = html.indexOf("function dropLegacyHistoryKeys");
  assert.ok(start >= 0 && end > start, "saveHistory / dropLegacyHistoryKeys moved");
  const fn = html.slice(start, end);
  assert.match(fn, /pendingPortfolioRefresh/);
  assert.match(fn, /else if \(currentUser\)/);
  assert.match(fn, /acctApi\("POST", "\/api\/portfolio"/);

  const guarded = html.match(/if \(!\w+\.sample && !\w+\.fromHistory && !\w+\.shared\)[\s\S]{0,80}saveHistory/g) || [];
  assert.ok(guarded.length >= 2, "every renderResults saveHistory call must keep the sample/fromHistory/shared guard");
});

test("the desk branches on portfolioValues, not a raw isPro", () => {
  const start = html.indexOf("async function renderMyDesk");
  const end = html.indexOf("// /desk — My Desk lives on its own URL");
  assert.ok(start >= 0 && end > start);
  const fn = html.slice(start, end);
  assert.match(fn, /portfolioValuesOn\(\)/);
  assert.match(fn, /History/);
  assert.match(fn, /Likely value/);
  // Free path: the value columns are gated, not deleted from the file.
  assert.match(fn, /if \(showValues\)/);
  // movement.line is market median $/SF — a dollar figure. Gate it with the
  // rest of the book; do not strip it from the GET.
  assert.match(fn, /if \(showValues && item\.movement && item\.movement\.line\)/);
});

test("portfolioValuesOn falls back so a missing field cannot blank a Pro-off desk", () => {
  // An old /api/config (or the boot-time { enabled: false } default) has no
  // portfolioValues key. Keying the desk on isPro alone would hide dollars
  // from everyone while PRO_ENABLED is off — today's desk already shows them.
  const fn = html.match(/function portfolioValuesOn\(\)[\s\S]{0,400}?\n  \}/);
  assert.ok(fn, "index.html must define portfolioValuesOn()");
  assert.match(fn[0], /typeof proConfig\.portfolioValues === "boolean"/);
  assert.match(fn[0], /!proConfig\.enabled \|\| Boolean\(proConfig\.isPro\)/);
});

test("pricing states the Portfolio split in the compare table", () => {
  assert.match(html, /<tr><td>Portfolio<\/td><td class="c">Saved reports, address list<\/td><td class="c">Saved reports, with estimated values<\/td><\/tr>/);
  assert.doesNotMatch(html, /unlimited saved reports/i);
});

test("signed-in desk is Mock A: split rd-form, explorer outside #compForm", () => {
  // Owner signed off on composition A (2026-08-14). This is the signed-in
  // app, not renderHowItWorksHTML. A future edit that puts #marketSearch
  // back inside #compForm would make Enter on a market submit a report.
  assert.match(html, /<div class="rd-kicker enter enter-1">Commercial Comp Reports<\/div>/);
  assert.match(html, /Find out what a property is worth, with comparables to prove it/);
  assert.ok(!html.includes("3–6 cited"), "stale 3–6 cited comps copy must not return");
  assert.ok(!html.includes("3-6 cited"));
  assert.ok(!html.includes("Up to 12"), "a 12-comp cap is a lie once nearby deals join the table");
  assert.match(html, /Cited comps · about a minute · every source disclosed/);
  assert.match(html, /No address\? Find one/);
  assert.ok(!html.includes("No address? Explore a market"));

  const form = html.match(/<form id="compForm"[^>]*>[\s\S]*?<\/form>/);
  assert.ok(form, "compForm is present");
  assert.ok(!/id="marketSearch"/.test(form[0]), "Market Explorer must not live inside #compForm");
  assert.match(form[0], /id="address"/);
  assert.match(form[0], /id="exploreAddrLink"/);
  assert.match(form[0], /id="sampleBtn"/);
  assert.match(form[0], /Value a building/);
  assert.match(form[0], /rd-chamber-head/);
  // Hidden type select is a form sibling of the address row, not a child of
  // it. Inside the row it stopped .rd-cell:last-child matching and doubled
  // the chamber divider on that one row.
  const addrToSelect = form[0].slice(
    form[0].indexOf('for="address"'),
    form[0].indexOf('<select id="propertyType"')
  );
  assert.match(
    addrToSelect,
    /<\/div>\s*<\/div>\s*(?:<!--[\s\S]*?-->\s*)?$/,
    "propertyType must sit after the address rd-row has closed"
  );

  const desk = html.match(/class="rd-form rd-desk"[\s\S]*?id="guestSearchHint"/);
  assert.ok(desk, "desk wraps the form and explorer");
  assert.match(desk[0], /id="marketSearch"/);
  assert.match(desk[0], /id="marketSearchResults"/);
  assert.match(desk[0], /Or read a market/);
  // The chamber is the narrow 1fr column of a max-w-5xl desk. The old
  // "Try any market, e.g. industrial Boise ID" ran past the input's
  // inner width and clipped the state. The note above already says
  // search any market; the placeholder is only the example, with the
  // comma the rest of the product uses. appearance:none drops the
  // searchfield cancel gutter that ate the last letters on top of that.
  // This exact string is ALSO server.js's MARKET_EXAMPLE_MARKER, which the `/`
  // handler swaps for a rotating example; test/routes.test.js pins the two
  // together. What stands here is the fallback, and it names a SEEDED market
  // on purpose — Tab types the example in, and a market with no standing page
  // would make Tab-then-Enter a billed 30-60s build. "industrial Boise, ID"
  // stood here until 2026-08-24 and was never seeded.
  assert.match(desk[0], /placeholder="e\.g\. industrial Ontario, CA"/);
  assert.doesNotMatch(desk[0], /Try any market, e\.g\./);
  // Tab on an empty box types that example in. It is READ off the
  // placeholder rather than kept as a second copy, so the assertion above is
  // also the assertion about what Tab types. The second check is the guard
  // without which Tab would stop moving focus for anyone mid-query.
  assert.match(
    html,
    /getAttribute\("placeholder"\)[\s\S]{0,200}?replace\(\/\^\\s\*e\\\.g\\\.\\s\*\//,
    "the Explorer's Tab example is read off the placeholder, never a second copy"
  );
  assert.match(
    html,
    /e\.key === "Tab" && !e\.shiftKey[\s\S]{0,240}?!input\.value/,
    "Tab only fills the Explorer box while it is empty and unmodified"
  );
  assert.match(html, /\.rd-desk-market-in \{[^}]*appearance:\s*none/);
  assert.equal((desk[0].match(/class="rd-chamber-head"/g) || []).length, 2,
    "both chambers share a rd-chamber-head so the title hairline is one rule");

  assert.match(html, /\.rd-desk \{/);
  assert.match(html, /\.rd-chamber-head \{/);
  assert.match(html, /\.rd-chamber-head \{[^}]*padding:\s*11px 16px/);
  assert.match(html, /\.rd-chamber-lab \{[^}]*line-height:\s*1\.5/);
  assert.ok(
    !/\.rd-desk \{[^}]*overflow:\s*hidden/.test(html),
    "overflow:hidden on .rd-desk would clip the explorer dropdown"
  );
  assert.ok(
    !/\.rd-desk-market \{[^}]*overflow:\s*hidden/.test(html),
    "overflow:hidden on .rd-desk-market would clip the explorer dropdown"
  );
  // Square heads would poke past the 6px card; the desk cannot clip them.
  assert.match(html, /\.rd-desk-build > \.rd-chamber-head \{[^}]*border-radius:\s*6px 0 0 0/);
  assert.match(html, /\.rd-desk-market > \.rd-chamber-head \{[^}]*border-radius:\s*0 6px 0 0/);

  // Focus/Lookback: one site chevron. The background shorthand wiped the SVG
  // and appearance:auto put the native widget back on top of it (three or four
  // arrows in dark mode, where color-scheme:dark adds Chrome's own).
  assert.match(html, /\.rd-in \{[^}]*background-color:\s*transparent/);
  assert.doesNotMatch(html, /\.rd-in \{[^}]*background:\s*transparent/);
  assert.doesNotMatch(html, /^\s*select\.rd-in \{[^}]*appearance:\s*auto/m);
  assert.match(html, /^\s*select\.rd-in \{[^}]*appearance:\s*none/m);

  const home = html.slice(html.indexOf('id="homeInfo"'), html.indexOf("Site footer"));
  assert.match(home, /href="\/how-it-works"/);
  assert.match(home, /href="\/brokers"/);
  // gap-x-3 was never in the vendored tailwind.css, so the middle dot sat
  // on the F in "For brokers". gap-x-4 is already generated.
  assert.match(home, /gap-x-4/);
  assert.doesNotMatch(home, /gap-x-3/);
  assert.ok(!/id="marketSearch"/.test(home), "explorer moved out of homeInfo");
});

// ----------------------------------------------------------------------------
// The workspace leads (2026-08-29). The owner's instruction was that the
// search chamber and the market explorer stop being the top of the signed-in
// home; before this, #searchSection sat above #deskView in document order and
// nothing pinned it, so nothing stopped it drifting back.
// ----------------------------------------------------------------------------
test("the workspace leads and the chamber follows, in DOM order", () => {
  const iLock = html.indexOf('id="searchLock"');
  const iDesk = html.indexOf('id="deskView"');
  const iChamber = html.indexOf('id="searchSection"');
  const iStatus = html.indexOf('id="statusBox"');
  assert.ok(iLock > -1 && iDesk > -1 && iChamber > -1 && iStatus > -1, "an id vanished");
  assert.ok(iLock < iDesk, "the wall card stays above the workspace");
  assert.ok(iDesk < iChamber, "the workspace opens the page; the chamber follows it");
  assert.ok(iChamber < iStatus, "the chamber still sits above status, loading and results");
});

test("the chamber wears its desk header only while the workspace is on screen", () => {
  // The header sits inside #searchSection (so the wall's boot CSS hides it
  // with its parent) but BEFORE the rd-form span the Mock-A test measures,
  // and it is dk-deck-h, never rd-chamber-head — that count must stay two.
  const head = html.slice(html.indexOf('id="searchSection"'), html.indexOf('class="rd-form rd-desk"'));
  assert.match(head, /id="searchDeckHead"[^>]*class="hidden dk-deck-h"/);
  assert.match(head, /Run a report/);
  // dk-deck-h sets display:flex in the style block, which loads AFTER
  // tailwind.css, so at equal specificity it beats Tailwind's .hidden — the
  // header rendered on the signed-out home until this override existed
  // (caught by a byte-compare screenshot, the vault's ".deck.hide" trap).
  assert.ok(html.includes("#searchDeckHead.hidden { display: none; }"),
    "the hidden state needs its own higher-specificity rule or the header shows signed out");
  // Plain-string pins (not regexes): the needles are full of ")(. characters,
  // and an escaping slip here would pin nothing while looking like it did.
  const reveal = 'getElementById("searchDeckHead").classList.remove("hidden")';
  const retire = 'getElementById("searchDeckHead").classList.add("hidden")';
  const show = html.slice(html.indexOf("function showDeskView"), html.indexOf("function showHomeView"));
  assert.ok(show.includes(reveal), "desk view reveals the chamber's workspace rule");
  const homeFn = html.slice(html.indexOf("function showHomeView"), html.indexOf("function showHomeView") + 1200);
  assert.ok(homeFn.includes(retire), "plain home must not carry a workspace heading over the form");
  // A rendering report yields the workspace at BOTH seams; the stray rule
  // would otherwise float over the chamber while comps stream in.
  for (const fn of ["function beginAssembly", "renderMap(parsed, meta)"]) {
    const at = html.indexOf(fn);
    assert.ok(at > -1, fn + " not found");
    const windowTxt = fn === "function beginAssembly" ? html.slice(at, at + 6000) : html.slice(at - 2000, at);
    assert.ok(windowTxt.includes(retire), fn + " must retire the chamber's workspace rule");
  }
});

test("Run a report jumps to the chamber and seats the caret, deterministically", () => {
  const at = html.indexOf('id="deskRunReport"');
  assert.ok(at > -1, "the workspace header offers the shortcut");
  const listener = html.slice(html.indexOf('deskRunReport").addEventListener'));
  const body = listener.slice(0, 600);
  assert.ok(body.includes('getElementById("searchSection").scrollIntoView'), "the shortcut goes to the chamber");
  // Instant on purpose: a smooth scroll paired with a focus proved able to
  // silently go nowhere, and a shortcut that half-works is worse than one
  // that jumps. No smooth here also satisfies prefers-reduced-motion.
  assert.ok(!body.includes("smooth"), "the jump is instant, never a glide that can half-happen");
  assert.ok(body.includes('getElementById("address").focus({ preventScroll: true })'),
    "the caret lands in the address field without fighting the jump");
  // Red, on the owner's call (2026-08-29): with the profile cluster gone from
  // that row it is the only control on it, and it starts the same act as the
  // red button at the foot of the chamber. The classes have to be ones the
  // file already uses somewhere else -- tailwind.css is a purged vendored
  // build, so a colour that appears only here would silently not paint.
  const runBtn = html.slice(at, html.indexOf(">", html.indexOf("Run a report", at)));
  assert.match(runBtn, /bg-brand-600/, "the workspace shortcut is red");
  assert.match(runBtn, /hover:bg-brand-700/, "and it has the matching hover");
  for (const cls of ["bg-brand-600", "hover:bg-brand-700"]) {
    const uses = html.split(cls).length - 1;
    assert.ok(uses > 1, cls + " must be used elsewhere too, or the purge drops it");
  }
});

test("the vault is a nav item, not a row inside the account menu", () => {
  // It sat in the account dropdown until 2026-08-29. Under NAV_SHELL=rail that
  // dropdown is pinned to the FOOT of a 224px sidebar and opens upward, so a
  // broker's daily workspace was two clicks down a menu -- while "Workspace"
  // itself sat one click away in the rail. The gate is unchanged; only the
  // position moved.
  const nav = html.slice(html.indexOf('id="myDeskLink"'), html.indexOf('id="acctMenuWrap"'));
  assert.match(nav, /id="menuVaultLink"/, "the vault link is a sibling of Workspace in the rail nav");
  assert.match(nav, /href="\/vault"/, "and still points at its own server-rendered page");
  const menu = html.slice(html.indexOf('id="acctMenu"'), html.indexOf('id="signOutBtn"'));
  assert.ok(!menu.includes("menuVaultLink"), "and it is no longer a row in the account menu");
  // One link, one toggle: refreshBillingUI still owns it off canUseVault, so
  // moving it cannot have widened who sees it.
  assert.equal(html.split('id="menuVaultLink"').length - 1, 1, "exactly one vault link");
  assert.ok(html.includes(`getElementById("menuVaultLink").classList.toggle("hidden", !canVault)`),
    "still shown from canUseVault and nothing else");
});

// The workspace header's profile cluster is pinned by "the workspace header
// does not say who you are at all" further down -- it started life as that
// pass's own test and absorbed this one, rather than two tests asserting the
// same removals under different names.

test("the between-checks cell names its sample and cannot read as a return", () => {
  // "Since last checks" read as a portfolio return, and the figure is not
  // one: it compares each property's last two check-ins, over only the
  // properties checked at least twice, with no time window at all. The
  // arithmetic stays; the caption stops over-claiming.
  const start = html.indexOf("async function renderMyDesk");
  const end = html.indexOf("// /desk — My Desk lives on its own URL");
  assert.ok(start > -1 && end > start, "renderMyDesk slice anchors moved");
  const fn = html.slice(start, end);
  assert.ok(fn.includes("Between checks"), "the cell is labelled Between checks");
  assert.ok(fn.includes("last check vs the check before"), "the note names the basis");
  assert.ok(fn.includes("of ${items.length} properties"), "the note names its sample");
  // The old label survives in a comment explaining WHY it went; the pin is on
  // the cell() call, so history stays readable while the label cannot return.
  assert.ok(!fn.includes('cell("Since last checks"'), "the return-shaped label must not come back");
  assert.ok(!fn.includes("across properties checked twice"), "nor its old under-disclosing note");
  assert.ok(fn.includes("not a return over any period of time"),
    "the title says outright what the figure is not");
  // One figure, computed once: the same bookPct feeds the ledger cell and the
  // statement's tfoot, so the two can never disagree.
  assert.ok((fn.match(/bookPct/g) || []).length >= 4, "bookPct must feed both surfaces");
});

test("both writers of the markets cell emit the same anatomy", () => {
  // renderMyDesk renders #deskLedgerMarkets as a placeholder; renderWatchFeed
  // fills it in later. If the two emit different markup the cell visibly
  // changes shape when the feed lands, which reads as a glitch.
  for (const fnName of ["async function renderMyDesk", "async function renderWatchFeed"]) {
    const at = html.indexOf(fnName);
    assert.ok(at > -1, fnName + " not found");
    const seg = html.slice(at, at + 30000);
    const cellAt = seg.indexOf("deskLedgerMarkets");
    assert.ok(cellAt > -1, fnName + " must write the markets cell");
    // Wide enough to clear the explanatory comment above the feed's writer.
    const cell = seg.slice(cellAt, cellAt + 1600);
    assert.ok(cell.includes("dk-lfig"), fnName + " must use the promoted figure class");
    assert.ok(cell.includes("dk-lnote"), fnName + " must use the promoted note class");
    // Both must also agree on the LABEL, or the cell renames itself when the
    // feed lands a moment after first paint.
    assert.ok(cell.includes(">New comps<"), fnName + " must label the cell New comps");
  }
});

test("the fourth ledger cell counts new comps, not watched markets", () => {
  // The other three cells are facts about the book. This one was a count of a
  // preference, with the only live thing on the strip ("N new comps waiting")
  // demoted to the 11px note under it. The signal is the figure now.
  const at = html.indexOf("async function renderWatchFeed");
  const seg = html.slice(at, at + 30000);
  const cellAt = seg.indexOf("const mk = document.getElementById");
  assert.ok(cellAt > -1, "the feed still writes the cell");
  const blk = seg.slice(cellAt, cellAt + 1400);
  assert.ok(blk.includes('<span class="rd-lab">New comps</span>'), "the label names what the figure counts");
  assert.ok(blk.includes("mkts ? totalNew"), "the figure is the new-comp count");
  // Three honest notes, and an em dash rather than a 0 when there is nothing
  // to count yet: "0 new comps" over an empty watchlist states a fact about
  // markets the member never asked about.
  assert.ok(blk.includes("watch a market to see new comps here"), "no markets: an invitation");
  assert.ok(blk.includes("you watch"), "with news: the markets are the context");
  assert.ok(blk.includes("watched · quiet"), "no news: says so plainly");
  assert.ok(!blk.includes("new comps waiting"), "the old buried note is gone");
});

// ----------------------------------------------------------------------------
// The attention line (2026-08-29). The workspace opened with numbers and lists
// and nothing that was waiting on the member. It names ONE thing, because one
// thing is what the data honestly supports: new comps are already the ledger's
// fourth cell a line above, a pending firm invitation is already the first
// deck a line below, and lease expiries never reach this surface at all.
// ----------------------------------------------------------------------------
test("the attention line says nothing when nothing is waiting", () => {
  const at = html.indexOf('id="deskAttention"');
  assert.ok(at > -1, "the line exists");
  assert.match(html.slice(at - 60, at + 60), /class="hidden dk-attn"/,
    "it ships hidden; a standing all-caught-up banner is the vault's 0-0 scoreboard");
  const fn = html.slice(html.indexOf("async function renderMyDesk"),
                        html.indexOf("// /desk — My Desk lives on its own URL"));
  assert.ok(fn.includes("const showAttn = showValues && staleN > 0"),
    "shown only when something is actually stale, and never on a values-free free desk");
  // Sign-out must drop it for the same reason the ledger beside it is dropped:
  // it is a statement about one person's own properties.
  assert.ok(fn.includes('getElementById("deskAttention").classList.add("hidden")'),
    "sign-out drops the line");
  assert.ok(fn.includes("1 property was last checked over a year ago"), "singular copy");
  assert.ok(fn.includes("properties were last checked over a year ago"), "plural copy");
  assert.ok(!/deskAttention[\s\S]{0,400}innerHTML/.test(fn), "textContent only");
});

test("stale is a year, and it is not a number invented here", () => {
  const fn = html.slice(html.indexOf("async function renderMyDesk"),
                        html.indexOf("// /desk — My Desk lives on its own URL"));
  assert.ok(fn.includes("const STALE_MS = 365 * 24 * 60 * 60 * 1000"), "one year");
  // portfolio-delta.js already draws this line, and says why: past a year a
  // window "stops being 'since you last looked' and becomes market history".
  // It is a server module and cannot be required here, so the mirror is
  // marked — the same treatment compWeight and SHOP_COPY get.
  assert.ok(fn.includes("portfolio-delta.js"), "the source of the threshold is named");
  assert.ok(fn.includes("MIRRORED CONSTANT"), "the duplication is flagged, not silent");
  const delta = fs.readFileSync(path.join(__dirname, "..", "portfolio-delta.js"), "utf8");
  assert.match(delta, /MAX_WINDOW_YEARS = 1/, "the constant this mirrors still says a year");
});

test("the checked date and the attention line count the same fact", () => {
  // The table said "checked {updated_at}" — when the ROW was last written by
  // anything — while the line counts the last time a value was produced. Two
  // dates for one word, thirty pixels apart, contradicted each other on screen
  // (caught in a browser against an aged store, not by reading).
  const fn = html.slice(html.indexOf("async function renderMyDesk"),
                        html.indexOf("// /desk — My Desk lives on its own URL"));
  assert.ok(fn.includes("const lastTs = last && last.ts ? last.ts : item.updated_at"),
    "the row reads the last snapshot, falling back only when there is none");
  assert.ok(!fn.includes("checked ${new Date(item.updated_at)"),
    "the row must not go back to the row-written date");
  assert.ok(fn.includes("const ts = last && last.ts ? Date.parse(last.ts) : NaN"),
    "the count reads the same field");
});

test("the workspace header does not say who you are at all", () => {
  // The row carried the circle, "Signed in as {name}" and "Add a photo",
  // beside a nav that already shows the same photo and account menu. It came
  // down in two passes on 2026-08-29. The first took the greeting and the
  // labelled button and KEPT the circle, because the circle is itself the
  // upload trigger and because the settings panel had no Remove -- so dropping
  // the cluster would have deleted the only way to take a photo off an
  // account. Both were true, and the second pass removed that blocker instead
  // of arguing with it: #settingsAvatarRemove carries Remove now, so the whole
  // cluster could go. Under NAV_SHELL=rail that is the point -- the account
  // circle is pinned bottom-left in the sidebar, so a second one top-right is
  // the same face twice on one screen.
  const at = html.indexOf('id="deskView"');
  const head = html.slice(at, html.indexOf('id="checkoutNotice"'));
  const gone = ["deskAvatarBtn", "deskAvatarPhoto", "deskAvatarInitial",
                "deskHello", "deskAvatarChange", "deskAvatarRemove", "deskAvatarMsg"];
  for (const id of gone) {
    assert.ok(!head.includes('id="' + id + '"'), id + " is gone from the workspace header");
    // Nothing may still REACH one either: several were unguarded reads, and an
    // unguarded getElementById on a deleted node throws and takes the desk
    // down with it. This is the half a comment cannot enforce.
    assert.ok(!html.includes('getElementById("' + id + '")'), "no live reference to " + id);
  }
  // The capability has to survive the move in BOTH directions. A panel that can
  // add a photo and never take one off is the loss the first pass refused to
  // take, and it would be just as real now.
  assert.ok(html.includes('id="settingsAvatarBtn"'), "settings adds and changes");
  assert.ok(html.includes('id="settingsAvatarRemove"'), "settings removes");
  assert.ok(html.includes(`getElementById("settingsAvatarRemove").addEventListener`),
    "and Remove is wired, not merely drawn");
  // The picker stays where it is: #settingsAvatarBtn clicks it, so the photo
  // pipeline still has exactly one entry.
  assert.ok(html.includes('id="deskAvatarFile"'), "the one hidden input stays");
});

// ----------------------------------------------------------------------------
// Workspace polish, 2026-08-29. Report branding was a permanently-expanded
// form on the daily workspace: measured at 629px against 568px for the whole
// portfolio deck, i.e. a set-once setting taking more of the page than
// everything the member owns. Collapsing it took the page from 2371px to
// 1859px. None of this surface was pinned before.
// ----------------------------------------------------------------------------
test("report branding is collapsed behind a summary that states what is saved", () => {
  const at = html.indexOf('id="deskBranding"');
  assert.ok(at > -1, "the branding section is still there");
  const sec = html.slice(at, html.indexOf('id="billingCard"'));
  assert.ok(sec.includes('<details id="brandBox"'), "the form collapses");
  assert.ok(sec.includes('id="brandSummary"'), "the collapsed row carries a state line");
  // The rule and the explanation stay OUTSIDE the details, so the deck still
  // reads as furnished rather than as a lone twisty.
  assert.ok(sec.indexOf("Report branding") < sec.indexOf("<details"),
    "the section rule stays above the collapse");
  // Every control the save/delete/preview handlers reach by id must still be
  // inside it — collapsing must not have dropped one.
  for (const id of ["brandLogoPreview", "brandLogo", "brandLogoRemove", "brandLogoFile",
                    "brandFirm", "brandPreparer", "brandPhone", "brandEmail", "brandLicense",
                    "brandDisclaimer", "brandMsg", "brandSave", "brandDelete", "brandPreview"]) {
    assert.ok(sec.includes('id="' + id + '"'), id + " must survive the collapse");
  }
  // The summary is written from the live form by renderBrandPreview, which
  // already runs on load, save, delete, logo change and every keystroke — so
  // the line cannot drift from the form the way a separate updater would.
  const prev = html.slice(html.indexOf("function renderBrandPreview"), html.indexOf("function renderBrandPreview") + 400);
  assert.ok(prev.includes("renderBrandSummary("), "the summary rides the function that already tracks state");
  // #brandMsg lives inside the collapsed box, so a FAILED LOAD would report
  // into something nobody can see. Both load-failure paths open it.
  const loadAt = html.indexOf("function loadBranding");
  const load = html.slice(loadAt, html.indexOf("brandingLoadPromise = null", loadAt));
  assert.equal((load.match(/openBrandBox\(\)/g) || []).length, 2,
    "both load-failure paths must open the box so the message is visible");
});

test("the workspace subtitle describes the page it introduces", () => {
  assert.ok(html.includes("Your properties, your firm's shelf, and everything you have shared."),
    "the subtitle names what the workspace actually holds");
  assert.ok(!html.includes("Your recent searches and tracked properties."),
    "the old line described about a fifth of the page and must not come back");
});

test("the workspace ledger goes 2x2 on a phone instead of four deep", () => {
  // At 375px the single column filled the entire first screen, so a member
  // scrolled past a phone-full of statistics before reaching a property.
  // Scoped to .dk-ledger: every other .rd-ledger is a 2-3 cell strip that
  // stacks fine.
  // Anchored on the ledger's own stacking rule: index.html has several
  // 639.98px blocks and the first one is about form cells, not the ledger.
  const at = html.indexOf(".rd-ledger { flex-direction: column; }");
  assert.ok(at > -1, "the generic ledger stack rule moved");
  const block = html.slice(at, at + 1400);
  assert.ok(block.includes(".dk-ledger { flex-direction: row; flex-wrap: wrap; }"),
    "the workspace ledger wraps rather than stacking");
  assert.ok(block.includes("flex: 1 1 50%"), "two cells per row");
  assert.ok(block.includes(":nth-last-child(-n+2) { border-bottom: 0; }"),
    "the bottom ROW owns the last rule; :last-child alone leaves a stray hairline");
});

// ----------------------------------------------------------------------------
// Tab fills the rotating "e.g." address. The placeholder is a real building
// someone can try, but it used to be display-only: Tab jumped to the next
// field and left the box empty. The strip and the "should Tab accept?"
// decision are pure so they can be tested without a DOM; the listener is
// pinned as wiring so a later edit cannot keep the helper and drop the Tab.
// ----------------------------------------------------------------------------

function loadTabFillExample() {
  const fromPh = html.match(/function exampleValueFromPlaceholder\(placeholder\) \{[\s\S]*?\n  \}/);
  const tabFill = html.match(/function tabFillExample\(e, currentValue, placeholder\) \{[\s\S]*?\n  \}/);
  assert.ok(fromPh, "could not find exampleValueFromPlaceholder in index.html");
  assert.ok(tabFill, "could not find tabFillExample in index.html");
  const ctx = vm.createContext({});
  new vm.Script(fromPh[0] + "\n" + tabFill[0] +
    "\n;this.fromPh = exampleValueFromPlaceholder; this.tabFill = tabFillExample;",
    { filename: "index.html" }).runInContext(ctx);
  return ctx;
}

test("exampleValueFromPlaceholder strips the e.g. prefix off a real address", () => {
  const { fromPh } = loadTabFillExample();
  assert.equal(fromPh("e.g. 1200 W Industrial Blvd, Dallas, TX"), "1200 W Industrial Blvd, Dallas, TX");
  assert.equal(fromPh("E.G. 4500 Commerce St, Phoenix, AZ"), "4500 Commerce St, Phoenix, AZ");
  assert.equal(fromPh("  e.g.  15 Enterprise Pkwy, Columbus, OH"), "15 Enterprise Pkwy, Columbus, OH");
});

test("exampleValueFromPlaceholder refuses a placeholder that is not an example", () => {
  const { fromPh } = loadTabFillExample();
  assert.equal(fromPh("Property address"), "");
  assert.equal(fromPh("City, ST or 5-digit zip"), "");
  assert.equal(fromPh(""), "");
  assert.equal(fromPh(null), "");
});

test("Tab on an empty field accepts the current example; anything else leaves Tab alone", () => {
  const { tabFill } = loadTabFillExample();
  const ph = "e.g. 1200 W Industrial Blvd, Dallas, TX";
  const addr = "1200 W Industrial Blvd, Dallas, TX";
  assert.equal(tabFill({ key: "Tab" }, "", ph), addr);
  assert.equal(tabFill({ key: "Tab" }, "   ", ph), addr, "whitespace-only is still empty");
  assert.equal(tabFill({ key: "Tab" }, "12", ph), "", "already typing: Tab must move on");
  assert.equal(tabFill({ key: "Tab", shiftKey: true }, "", ph), "", "Shift+Tab is back, not accept");
  assert.equal(tabFill({ key: "Enter" }, "", ph), "");
  assert.equal(tabFill({ key: "Tab" }, "", "Property address"), "", "non-example placeholder is not a fill");
});

test("the address field and the shared-report lock field both wire Tab-to-fill", () => {
  const fn = html.match(/function bindTabFillExample\(input\)[\s\S]*?\n  \}/);
  assert.ok(fn, "index.html must define bindTabFillExample()");
  assert.match(fn[0], /preventDefault\(\)/);
  assert.match(fn[0], /tabFillExample\(/);
  assert.match(fn[0], /dispatchEvent\(new Event\("change"/);
  assert.match(html, /bindTabFillExample\(document\.getElementById\("address"\)\)/);
  assert.match(html, /bindTabFillExample\(document\.getElementById\("lockAddress"\)\)/);
  // Tab-fill of a rotating example must also set that building's type, or
  // the hidden select stays Industrial and the visitor cannot tell.
  assert.match(fn[0], /exampleTypeForPlaceholder/);
  assert.match(fn[0], /input\.id === "address"/);
  assert.match(fn[0], /typeResolution = "explicit"/);
});

test("every rotating address example names a real property type", () => {
  const m = html.match(/const ADDRESS_EXAMPLES = \[([\s\S]*?)\];/);
  assert.ok(m, "ADDRESS_EXAMPLES must still be a list");
  const types = [...m[1].matchAll(/type:\s*"([^"]+)"/g)].map((x) => x[1]);
  assert.ok(types.length >= 5, "each example needs a type; found " + types.length);
  const allowed = new Set(["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"]);
  for (const t of types) assert.ok(allowed.has(t), t + " is not a property type");
  assert.ok(new Set(types).size >= 2, "examples must not all be the same class");
});

test("exampleTypeForPlaceholder maps a rotating placeholder to its type", () => {
  const fromPh = html.match(/function exampleValueFromPlaceholder\(placeholder\) \{[\s\S]*?\n  \}/);
  const typeFor = html.match(/function exampleTypeForPlaceholder\(placeholder, examples\) \{[\s\S]*?\n  \}/);
  assert.ok(fromPh && typeFor, "could not find example helpers in index.html");
  const ctx = vm.createContext({});
  new vm.Script(typeFor[0] + "\n;this.typeFor = exampleTypeForPlaceholder;",
    { filename: "index.html" }).runInContext(ctx);
  const examples = [
    { ph: "e.g. 1200 W Industrial Blvd, Dallas, TX", type: "Industrial" },
    { ph: "e.g. 2300 Peachtree Rd NE, Atlanta, GA", type: "Office" },
  ];
  assert.equal(ctx.typeFor("e.g. 2300 Peachtree Rd NE, Atlanta, GA", examples), "Office");
  assert.equal(ctx.typeFor("E.G. 1200 W Industrial Blvd, Dallas, TX", examples), "Industrial");
  assert.equal(ctx.typeFor("Property address", examples), "");
});

test("Address Explorer chips show a type and Find addresses does not send the form's", () => {
  const start = html.indexOf("async function findAddresses");
  const end = html.indexOf("link.addEventListener(\"click\"", start);
  assert.ok(start >= 0 && end > start, "findAddresses / explore link click moved");
  const fn = html.slice(start, end);
  assert.match(fn, /URLSearchParams/);
  assert.match(fn, /typeof opts\.type === "string"/);
  assert.match(fn, /if \(typeFilter\) qs\.set\("type", typeFilter\)/);
  assert.doesNotMatch(fn, /propertyType"\)\.value/);
  assert.match(html, /typeTag\.textContent = a\.type/);
  assert.match(html, /addrExplore\.v3/);
  assert.match(html, /findAddresses\(deepType \? \{ type: deepType \} : undefined\)/);
  assert.match(html, /btn\.addEventListener\("click", \(\) => findAddresses\(\)\)/);
});

test("the form does not ask you to pick a property type before you have an address", () => {
  const start = html.indexOf("function renderTypeStatus");
  const end = html.indexOf("function addrTypeStore");
  assert.ok(start >= 0 && end > start, "renderTypeStatus / addrTypeStore moved");
  const fn = html.slice(start, end);
  assert.match(fn, /if \(typeResolution === null\) return;/);
  assert.doesNotMatch(fn, /chosen when you run the report/);
  assert.doesNotMatch(fn, /pick it now/);
  assert.match(fn, /makeTypeChangeButton\(\)/);
  // The confirm dialog is still the place an unresolved type is asked.
  assert.match(html, /if \(typeResolution === null\) \{\s*showConfirmTypeButtons\(null\);/);
});

test("once pins settle, the hero re-runs so distance weighting actually moves the range", () => {
  const fn = html.match(/function refreshDistances\(\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, "index.html must define refreshDistances()");
  assert.match(fn[0], /renderOwnerHero\(currentParsed, currentMeta\)/);
  assert.match(html, /farther away/);
  assert.match(html, /nearby/);
});

test("comp table marks are words, not gray footnote glyphs", () => {
  assert.match(html, /\.comp-mark \{/);
  assert.match(html, /function appendCompMark\(/);
  assert.match(html, /id="compMarksLegend"/);
  assert.match(html, /appendCompMark\(cell, "calc"/);
  assert.match(html, /appendCompMark\(cell, "size"/);
  assert.match(html, /appendCompMark\(cell, "adj"/);
  assert.match(html, /appendCompMark\(dd, "calc"/);
  assert.match(html, /appendCompMark\(dd, "size"/);
  assert.match(html, /appendCompMark\(dd, "adj"/);
  assert.doesNotMatch(html, /sup\.textContent = "[†‡§]"/);
  assert.match(html, /adj in the table shows each indexed figure/);
  assert.match(html, /less \(size in the table\)/);
});

test("the type chip is followed by the table's own comp count, never a bare digit", () => {
  const start = html.indexOf("function metaParts(meta)");
  const end = html.indexOf("function selectedLookbackMonths");
  assert.ok(start >= 0 && end > start, "metaParts / selectedLookbackMonths moved");
  const fn = html.slice(start, end);
  assert.match(fn, /currentComps\.length/);
  assert.match(fn, /n \+ " comps"/);
  assert.match(fn, /"Note: " \+ note/);
  assert.match(html, /function renderReportMeta\(/);
  assert.match(html, /renderReportMeta\(currentMeta\)/);
});

test("the settings panel has a place to put a profile photo", () => {
  assert.match(html, /id="acctMenuPhoto"/);
  assert.match(html, /id="acctMenuInitial"/);
  assert.match(html, /id="deskAvatarFile"/);
  // Change photo moved from the account dropdown into the settings panel
  // (2026-08-23) and Remove followed it there when the workspace header's
  // profile cluster went (2026-08-29); both drive the same hidden
  // #deskAvatarFile input and the same pipeline.
  assert.match(html, /id="settingsAvatarBtn"/);
  assert.match(html, /id="settingsAvatarRemove"/);
  assert.match(html, /function applyAvatarUI\(/);
  assert.match(html, /function readAvatarFile\(/);
  assert.match(html, /\/api\/account\/avatar/);
});

test("the loading ninja is a two-frame runner that freezes for reduced motion and on done", () => {
  // The 20-60s wait used to show an 18px blob hopping 2.5px on the bar.
  // The replacement has to keep reading as a ninja (body + red band classes,
  // still the only mascot on the site) and must not keep jogging after
  // "Report ready!" or under prefers-reduced-motion.
  assert.match(html, /id="loadingNinja"/);
  assert.match(html, /class="ninja-run-a"/);
  assert.match(html, /class="ninja-run-b"/);
  assert.match(html, /class="ninja-body"/);
  assert.match(html, /class="ninja-band"/);

  const cssStart = html.indexOf("/* Loading card:");
  const cssEnd = html.indexOf("#loadingHeadline");
  assert.ok(cssStart !== -1 && cssEnd > cssStart, "loading-ninja CSS block moved");
  const css = html.slice(cssStart, cssEnd);
  assert.match(css, /translateX\(-85%\)/);
  assert.match(css, /translateY\(-1px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /animation:\s*none\s*!important/);
  assert.match(css, /\.loading-ninja\.done/);
  assert.ok(!/ninjaJog/.test(css), "old ninjaJog bounce must not remain");
  assert.ok(!/translateY\(-2\.5px\)/.test(css), "old 2.5px hop must not remain");

  const show = html.match(/function showLoadingCard\([\s\S]*?\n  \}/)[0];
  const complete = html.match(/function completeLoadingCard\(\) \{[\s\S]*?\n  \}/)[0];
  const hide = html.match(/function hideLoadingCard\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(complete, /classList\.add\("done"\)/);
  assert.match(show, /classList\.remove\("done"\)/);
  assert.match(hide, /classList\.remove\("done"\)/);
});

// ---------------------------------------------------------------------------
// The two lines that tell a reader what the number can't see: the unexplained
// gain since the subject's own last sale, and the condition spread the
// weighting can't explain away. Both are copy over VALUATION math, so these
// pin the wiring and the wording, not the arithmetic (valuation.test.js owns
// that).
// ---------------------------------------------------------------------------

test("the unexplained-gain line is present and wired into the hero", () => {
  assert.match(html, /id="ownerImproved"/);
  assert.match(html, /function renderSubjectImproved\(/);
  assert.match(html, /renderSubjectImproved\(parsed, meta\)/);
});

test("the unexplained-gain line names physical work only on a house", () => {
  const src = html.match(/  function renderSubjectImproved\(parsed, meta\) \{[\s\S]*?\n  \}/);
  assert.ok(src, "could not find renderSubjectImproved in index.html — was it renamed?");
  const V = require("../valuation");
  const made = {};
  const stubEl = () => ({
    textContent: "", classList: { add() {}, remove() {} },
    appendChild(n) { this.textContent += n.text; },
  });
  const ctx = vm.createContext({
    document: {
      getElementById(id) { return (made[id] = made[id] || stubEl()); },
      createTextNode: (text) => ({ text }),
    },
    askingRangeFrom: () => ({ min: 700000, max: 700000 }),
    unexplainedGain: V.unexplainedGain,
    numericValue: V.numericValue,
    trendPctOf: () => 6,
    asOfOf: () => Date.parse("2026-08-16"),
    formatUsd: (v) => "$" + Math.round(v).toLocaleString("en-US"),
  });
  new vm.Script(src[0] + "\n;this.fn = renderSubjectImproved;", { filename: "index.html" }).runInContext(ctx);
  const parsed = { subject_last_sale: { date: "June 2021", price: "$400,000" } };

  ctx.fn(parsed, { type: "Residential" });
  const house = made.ownerImproved.textContent;
  assert.match(house, /\$540,000 today/);
  assert.match(house, /\$160,000 above that \(30%\)/);
  assert.match(house, /work was done since/);
  // The disclaimer is the point of the line: a dollar figure under a valuation
  // reads as part of it unless this says otherwise.
  assert.match(house, /not in the range above/);

  made.ownerImproved = null;
  ctx.fn(parsed, { type: "Office" });
  const office = made.ownerImproved.textContent;
  // On commercial the same gap is as often lease-up as renovation, so the
  // sentence must not assert physical work.
  assert.match(office, /improved or its income grew since/);
  assert.doesNotMatch(office, /work was done since/);
});

test("the condition-spread clause rides the Residential trust line", () => {
  const i = html.indexOf('Residential sales mostly live in the MLS');
  assert.ok(i > 0, "could not find the Residential trust-line block");
  const block = html.slice(i, i + 2600);
  assert.match(block, /conditionSpread\(currentPsfBand, subjSFMid\)/);
  assert.match(block, /mostly condition and finish, which this estimate can't see/);
  // It reads the band the chips and scatter read, never a hardcoded percentage
  // standing in for one — that constant would be the only figure in the hero
  // with no source behind it.
  assert.doesNotMatch(block, /10-20%|10 to 20%/);
});

test("the unexplained-gain line is hidden during streaming assembly", () => {
  // Same trap ownerScatter carries: assembly puts a counts-only hero on screen
  // a minute before renderResults repaints, so a line left out of this list
  // hangs the PREVIOUS report's dollar figure under the next report's
  // placeholder.
  const i = html.indexOf('["widenSearchWrap", "ownerScatter"');
  assert.ok(i > 0, "could not find beginAssembly's hidden list");
  const list = html.slice(i, i + 260);
  assert.match(list, /"ownerImproved"/);
  // The mechanics panel carries the same hazard: left out, the previous
  // report's "How this range is calculated" hangs under the next report's
  // placeholder hero.
  assert.match(list, /"ownerTrustHowWrap"/);
});

// ---------------------------------------------------------------------------
// The trust line is two halves: property-specific warnings stay visible,
// mechanics collapse. Measured 2026-08-16, the combined line ran 1,034
// characters of 12px grey and buried the condition sentence ninth of nine.
// ---------------------------------------------------------------------------

test("mechanics are routed to the collapsed half, not the visible line", () => {
  assert.match(html, /id="ownerTrustHowWrap"/);
  assert.match(html, /id="ownerTrustHow"/);
  assert.match(html, /id="ownerTrustHowBtn"/);
  // The weighting note and the MLS caveat are the two mechanics. Neither may
  // be concatenated into #ownerTrust: the visible half is for notes specific
  // to THIS property, and the MLS sentence is identical on every house report.
  const body = html.slice(html.indexOf("function renderOwnerHero("), html.indexOf("function sellTodayEstimate("));
  // Assignment or append only — `if (trustEl.textContent) mechanics.push(...)`
  // is the correct routing and must not trip this.
  assert.doesNotMatch(body, /trustEl\.textContent\s*\+?=[^;]*weighNote/);
  assert.doesNotMatch(body, /trustEl\.textContent\s*\+?=[^;]*Residential sales mostly live in the MLS/);
  assert.match(body, /mechanics\.push\("Residential sales mostly live in the MLS/);
  // Routed into the mechanics array, and only when a trust line actually
  // rendered — an explanation of the weighting with no range above it explains
  // nothing. (unshift vs push is ordering, not routing; don't pin the method.)
  assert.match(body, /if \(trustEl\.textContent\) mechanics\.(un)?shift\([^)]*weighNote[^)]*\)/,
    "routing, not wording: the note may now be chosen per branch, but it still "
    + "goes to the mechanics array and still only when a trust line rendered");
});

test("the collapsed half is forced open on paper and in the PNG", () => {
  // An export is the copy that gets forwarded to a client, so it must not be
  // the one version of the report whose weighting is unexplained. Two separate
  // mechanisms because html2canvas ignores @media print.
  const printBlock = html.slice(html.indexOf("@media print {"), html.indexOf("@media print {") + 2000);
  assert.match(printBlock, /#ownerTrustHow \{ display: block !important; \}/);
  const clone = html.slice(html.indexOf("onclone: (doc) =>"), html.indexOf("onclone: (doc) =>") + 1400);
  assert.match(clone, /#ownerTrustHow \{ display: block !important; \}/);
  // The toggle itself must NOT survive into either — a button in a PNG is
  // furniture that cannot be clicked.
  assert.match(html, /id="ownerTrustHowBtn"[\s\S]{0,200}?no-print no-capture/);
});

test("the agent-intro pointer is screen-only", () => {
  // #bovCtaWrap is no-print and is dropped by html2canvas's ignoreElements, so
  // a printed or captured report carrying "the button below" would point at a
  // button that is not on the page.
  const i = html.indexOf('cta.className = "no-print no-capture"');
  assert.ok(i > 0, "the CTA pointer must carry no-print no-capture");
  // Pin that it POINTS at the on-page control, not the exact phrasing.
  assert.match(html.slice(i, i + 400), /cta\.textContent = " A local agent below/);
  // The sentences that stay in both media make no reference to a control.
  assert.match(html, /can't see without someone walking the property/);
  assert.match(html, /half of the range is the fairer read/);
});

// ---------------------------------------------------------------------------
// A leases-only report answers a lease question (2026-08-21).
//
// Before this, a "Leases only" search put three dashes under Low / Likely /
// High, said "No priced sale comps came back in this window", and offered a
// button to re-run the whole thing as SALES. Every part of that was the
// product telling somebody their question was the wrong one, and it cost a
// billed search to find out.
// ---------------------------------------------------------------------------
test("a leases-only report headlines the rent range, from the market pages' own function", () => {
  const body = html.slice(html.indexOf("function renderOwnerHero("), html.indexOf("function sellTodayEstimate("));
  // Reached, not re-implemented. The whole point of serving the module to the
  // browser is that this stays the only copy of the parse.
  assert.match(body, /MARKETSNAP\.rentFromComps\(leaseComps\)/);
  assert.match(body, /MARKETSNAP\.leaseRentPsfYr\(c\)/);
  assert.match(body, /MARKETSNAP\.isLease\(c\)/);
  // A second copy would look exactly like this.
  assert.doesNotMatch(body, /\/\s*sf\s*\?\/\s*yr\/i/i,
    "a rate parse in the hero is a second answer to monthly-vs-annual");

  // Gated on the SEARCH, so a sales report that came back empty still says so
  // and still offers the wider re-run.
  assert.match(body, /meta\.txFocus === "leases"/);
  // Curated like the sale side: excluding a comp has to move this range too.
  assert.match(body, /valuationComps\(\)\.filter\(\(c\) => MARKETSNAP\.isLease\(c\)\)/);

  // A rent is not a value. lastValuation feeds the asking-price check, the BOV
  // and a portfolio save, all of which mean dollars of building.
  // Bounded from the branch to the give-up branch that follows it. An
  // indexOf on the dashes would find the NOI branch's copy, further up.
  const start = body.indexOf("} else if (leaseRent) {");
  const branch = body.slice(start, body.indexOf("\n    } else {", start));
  assert.ok(branch.length > 200, "could not bound the lease branch");
  assert.doesNotMatch(branch, /lastValuation\s*=/,
    "a $/SF/yr rent written into lastValuation would be read downstream as a price");
  assert.doesNotMatch(branch, /currentPsfBand\s*=/);
  // And the sales-only rescue button belongs to the branch below this one.
  assert.doesNotMatch(branch, /widenWrap\.classList\.remove/);
  assert.doesNotMatch(branch, /txFocus: "sales"/);

  // The unit is on the tiles. "$12.50" under a label reading "Likely", with
  // the unit only in grey at the top right, is a number that travels.
  assert.match(branch, /per SF\/yr/);
  // Cents, not whole dollars: heroRound would flatten a real spread to none.
  assert.match(branch, /minimumFractionDigits: 2/);
  assert.doesNotMatch(branch, /fmtTotal\(leaseRent\.median\)/);
  // Under-claiming below four, since rentFromComps interpolates quartiles at
  // any count and has no `trimmed` flag to lean on.
  assert.match(branch, /n < 4/);
});

test("the hero quotes the market's own basis, off one annual figure", () => {
  // The plan's acceptance clause: "$/SF/yr, or /mo where the market quotes
  // monthly - the vault's rent_basis lesson". The lesson is BOTH halves: one
  // canonical annual figure (broker-vault 029, because a book holding two
  // bases quotes three rents for one lease), displayed in the basis the market
  // actually uses.
  const body = html.slice(html.indexOf("function renderOwnerHero("), html.indexOf("function sellTodayEstimate("));
  const start = body.indexOf("} else if (leaseRent) {");
  const branch = body.slice(start, body.indexOf("\n    } else {", start));

  assert.match(branch, /MARKETSNAP\.leaseQuoteBasis\(leaseComps\) === "monthly"/,
    "the basis is read off the comps, not guessed and not taken from the address");
  // Divided for DISPLAY only. The band, the scatter and the annual translation
  // all still read the same annual figure.
  assert.match(branch, /formatUsd\(v \/ perDiv/);
  assert.doesNotMatch(branch, /leaseRent\.(low|median|high)\s*\/\s*12/,
    "dividing the band itself would leave two canonical figures");
  assert.doesNotMatch(branch, /rentFromComps[^\n]*12/);

  // Unit follows the basis everywhere it appears: tiles, chart, chart legend.
  assert.match(branch, /monthlyBasis \? "per SF\/mo" : "per SF\/yr"/);
  assert.match(branch, /monthlyBasis \? "\/SF\/mo" : "\/SF\/yr"/);
  assert.match(branch, /fmt: \(v\) => rate\(v\) \+ unitSuffix/);
  assert.doesNotMatch(branch, /"\$\/SF\/yr"/,
    "a hardcoded annual unit anywhere in this branch is the monthly market reading a number nobody says");

  // The cost translation stays a YEAR figure in both bases — it is the cost of
  // a lease year and it says so, so it cannot be read as a monthly bill.
  assert.match(branch, /a year, before any pass-throughs/);
});

test("a leases-only report says so at both heading seams, and when it has no range", () => {
  // The heading is set TWICE — once by beginAssembly when the search starts,
  // once by renderOwnerHero when it lands — because assembly puts the hero on
  // screen a minute before the real render repaints it. Worded in one place or
  // a leases-only search sits under "What This Building Is Worth" for that
  // whole minute and then flips.
  const fn = html.match(/function setHeroTitle\(type, txFocus\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, "could not bound setHeroTitle");
  assert.match(fn[0], /txFocus === "leases" \? "Rents For" : "Is Worth"/);
  assert.match(html, /setHeroTitle\(propertyTypeSel\.value, document\.getElementById\("txFocus"\)\.value\)/);
  assert.match(html, /setHeroTitle\(meta\.type, meta\.txFocus\)/);

  // And the branch that CANNOT build a range is the other half of the same
  // bug: one priced lease used to be reported as "No priced sale comps came
  // back in this window" with a button offering a sales-only re-run.
  const body = html.slice(html.indexOf("function renderOwnerHero("), html.indexOf("function sellTodayEstimate("));
  assert.match(body, /basisEl\.textContent = wantLeases/,
    "the lease case has to be read before the sale-flavoured answers, which are all 0 here");
  assert.match(body, /no rent range to build/);
  assert.match(body, /a rent range needs at least two/);
  assert.match(body, /Not enough included lease comps/);
  // The re-run keeps the question and widens the window.
  assert.match(body, /const focus = wantLeases \? "leases" : "sales"/);
  assert.match(body, /txFocus: focus/);
  assert.doesNotMatch(body, /txFocus: "sales"/,
    "offering a leases-only search a sales-only re-run is the wrong-question failure again");
});

test("nothing under a rent range still says 'sales'", () => {
  // Found by rendering one, not by reading the diff. The rent branch was
  // correct and the furniture around it was not: the scatter caption said
  // "5 sale comps" and the disclaimer said "from recent comparable sales",
  // both directly under a $/SF/yr band.
  const body = html.slice(html.indexOf("function renderOwnerHero("), html.indexOf("function sellTodayEstimate("));
  const start = body.indexOf("} else if (leaseRent) {");
  const branch = body.slice(start, body.indexOf("\n    } else {", start));
  assert.match(branch, /compNoun: "lease comps"/);
  assert.match(branch, /comparable leases/);

  // The noun is a parameter with the sale wording as its default, so every
  // existing caller keeps its copy without being touched.
  assert.match(html, /\$\{o\.compNoun \|\| "sale comps"\}/);

  // And it is reset on EVERY render, not just set by the branch that needs it.
  // renderOwnerHero runs again on every subject-field edit, so a report that
  // switched branches would otherwise keep the previous branch's noun — which
  // is exactly what happened the first time, rendering a lease report and then
  // a sale one in the same tab.
  assert.match(body, /estimateNoteEl\.textContent = "Automated estimate from recent comparable sales\. "/);
  const resetAt = body.indexOf("estimateNoteEl.textContent");
  assert.ok(resetAt > 0 && resetAt < start,
    "the default has to be assigned above the branch chain, or it cannot be a reset");
  assert.match(html, /id="ownerEstimateNote"/);
});

test("a lease report says which rate its $/SF figures are", () => {
  // The hero may quote per MONTH (leaseQuoteBasis) while the table and the
  // market tile hold the annual figure, so an unlabelled 13.5 sitting under a
  // headline of $1.18 is the one number on the page a reader could take for a
  // monthly rate and be 12x out.
  const start = html.indexOf("  const BASE_COLUMNS = [");
  const at = html.indexOf("  function columnsForType(type, txFocus) {", start);
  const end = html.indexOf("\n  }", at);
  assert.ok(start >= 0 && at > start && end > at, "could not bound columnsForType");
  const ctx = vm.createContext({});
  new vm.Script(html.slice(start, end + 4) + "\n;this.columnsForType = columnsForType;",
    { filename: "index.html" }).runInContext(ctx);

  const sale = ctx.columnsForType("Industrial", "sales");
  const lease = ctx.columnsForType("Industrial", "leases");
  const labelOf = (cols) => cols.find((c) => c.key === "price_per_sqft").label;
  assert.equal(labelOf(sale), "$/SF");
  assert.equal(labelOf(lease), "$/SF/yr");

  // LABEL ONLY, and nothing else moves. The figures are deliberately not
  // converted to match the hero: this column is shared with sale reports and
  // feeds sorting and the exports, and a column meaning different things on
  // different reports is the two-bases hazard broker-vault.js refuses to take
  // on. So the two column sets must be identical in every other respect.
  assert.deepEqual(lease.map((c) => c.key), sale.map((c) => c.key),
    "the transaction focus may relabel a column, never add, drop or reorder one");
  for (let i = 0; i < sale.length; i++) {
    if (sale[i].key === "price_per_sqft") continue;
    assert.deepEqual(lease[i], sale[i], `${sale[i].key} changed on a lease report`);
  }

  // A copy is relabelled, not BASE_COLUMNS itself — otherwise the first lease
  // report would leave "$/SF/yr" on every sale report after it, in the same
  // browser session.
  assert.equal(labelOf(ctx.columnsForType("Industrial", "sales")), "$/SF",
    "a lease report leaked its label into the next sale report");

  // Every render site has to pass the focus or the label never appears. Bare
  // mentions in prose are not calls, so require a real first argument.
  const calls = (html.match(/columnsForType\([a-zA-Z][^)]*\)/g) || [])
    .filter((c) => !c.startsWith("columnsForType(type"));
  assert.ok(calls.length >= 3, `expected every render site to call it, saw ${calls.length}`);
  for (const c of calls) {
    assert.match(c, /txFocus/, `${c} does not pass the transaction focus`);
  }

  // And the market tile, which sits inches under the hero.
  assert.match(html, /meta\.txFocus === "leases" \? "Market Avg \$\/SF\/yr" : "Market Avg \$\/SF"/);
});

test("the mechanics half describes the math that actually ran", () => {
  // Worse than the wrong-noun copy bugs, and found the same way — by rendering
  // one. The mechanics line explained the headline using compWeight and the
  // trend index, and the rent range applies NEITHER: rentFromComps takes plain
  // unweighted quartiles. That is not odd phrasing, it is untrue.
  const body = html.slice(html.indexOf("function renderOwnerHero("), html.indexOf("function sellTodayEstimate("));

  // Chosen off a flag SET INSIDE the branch, never derived from leaseRent
  // being non-null: a leases-only search where somebody typed an NOI and a cap
  // rate still leads with the income approach, and would then be described by
  // the wrong sentence.
  assert.match(body, /let leaseHero = false;/);
  assert.match(body, /\} else if \(leaseRent\) \{\n      leaseHero = true;/);
  assert.match(body, /mechanics\.(un)?shift\(leaseHero \? leaseWeighNote : weighNote\)/);
  assert.doesNotMatch(body, /leaseHero = leaseRent/, "that would describe a branch that did not render");

  // The MLS sentence is a claim about SALE comp coverage (MLS, a CMA and an
  // appraisal are all sale-price instruments), so it is omitted on a rent
  // range rather than reworded — there is no true lease version of it.
  assert.match(body, /if \(!leaseHero\) mechanics\.push\("Residential sales mostly live in the MLS/);

  // And the lease sentence says what did happen, including the annualization,
  // because a reader in a monthly market is looking at a converted number.
  assert.match(body, /const leaseWeighNote = /);
  assert.match(body, /converted to a year before it is taken/);
});

test("a lease report asks for the lead in lease words, and still stores a bov", () => {
  // "Get a free Broker Opinion of Value / Want a real number?" sitting under a
  // rent range offers a SALE price and reads as the report disowning the figure
  // it just published. Same fix as the Residential branch, and the same rule:
  // the words change, the lead does not.
  const fn = html.match(/function bovCopy\(meta\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, "could not bound bovCopy");
  assert.match(fn[0], /\(meta && meta\.txFocus\) === "leases"/);
  assert.match(fn[0], /button: "Talk to a local leasing broker"/);
  // Bounded to the lease branch itself. Slicing to the end of bovCopy would
  // run straight into the DEFAULT return, which is where "Want a real number"
  // correctly still lives.
  const leaseStart = fn[0].indexOf('txFocus) === "leases"');
  const leaseBranch = fn[0].slice(leaseStart, fn[0].indexOf("\n    return {", leaseStart));
  assert.ok(leaseBranch.length > 200, "could not bound the lease branch");
  assert.doesNotMatch(leaseBranch, /Want a real number/,
    "the lease branch must not carry the sale-price line it exists to replace");
  assert.doesNotMatch(leaseBranch, /Broker Opinion of Value/,
    "a rent range must not be answered with an offer of a sale price");

  // ORDER: Residential is read FIRST. A house that rents is a Residential
  // report, and the trust line's screen-only pointer ("A local agent below can
  // confirm it") is Residential-only and names that button by its noun — so a
  // lease branch above it would say agent above and leasing broker below,
  // which is the drift that block's own ⚠ warns about.
  const resAt = fn[0].indexOf('=== "Residential"');
  const leaseAt = fn[0].indexOf('=== "leases"');
  assert.ok(resAt > 0 && leaseAt > resAt,
    "the Residential branch must be read before the leases one");
  assert.match(html, /A local agent below can confirm it/);

  // The lead is unchanged, which is the whole point: the broker inbox, the
  // coverage-gated intro and the BOV tracker all key on this string.
  assert.match(html, /bovCtaBtn"\)\.addEventListener\("click", \(\) => openLeadModal\("bov"\)\)/);
  assert.doesNotMatch(fn[0], /source:/, "bovCopy words the ask; it does not route the lead");
});

test("the browser can actually reach MARKETSNAP", () => {
  // The script tag and the allowlist entry are two halves of one thing: the
  // hero throws on a leases-only report without the tag, and the tag 404s
  // without the entry. maxAge 0 for valuation.js's reason — a cached copy
  // against a newer index.html is the failure nobody detects.
  assert.match(html, /<script src="\/market-snapshot\.js"><\/script>/);
  const serverSrc = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverSrc,
    /"\/market-snapshot\.js": \{ file: "market-snapshot\.js", type: "text\/javascript; charset=utf-8", maxAge: 0 \}/);
});

test("the mechanics toggle is registered once, not per render", () => {
  // renderOwnerHero runs on every render and every subject-field edit; an
  // addEventListener in there would stack handlers until one click fired the
  // toggle a dozen times.
  const body = html.slice(html.indexOf("function renderOwnerHero("), html.indexOf("function sellTodayEstimate("));
  assert.doesNotMatch(body, /ownerTrustHowBtn"\)\.addEventListener/);
  assert.match(html, /document\.getElementById\("ownerTrustHowBtn"\)\.addEventListener\("click"/);
});

test("the condition steer yields to a listing that disagrees with it", () => {
  // Seen only by rendering a report: listed at $700,000 against a $1,050,000
  // estimate, askFit said "50% below this estimate ... the comps are probably a
  // pricier pocket" (our number may be high) and conditionFit then said "the
  // upper half of the range is the fairer read". The paragraph argued with
  // itself. The listing is a hard fact about this property; the condition steer
  // is a comparison against comps, so the listing wins.
  const i = html.indexOf("const contradictsAsk");
  assert.ok(i > 0, "the contradiction guard is gone");
  assert.match(html.slice(i, i + 200), /askGap && askGap\.skewed && fit && askGap\.dir === fit\.dir/);
  // askGap is computed well above this line; if it ever moves below, the guard
  // silently reads undefined and stops suppressing anything.
  assert.ok(html.indexOf("const askGap = askFit(") < i, "askGap must be computed before the guard");
});

test("askFit and conditionFit share one direction vocabulary", () => {
  // The guard is `askGap.dir === fit.dir`. If either function's dir vocabulary
  // drifts — "higher"/"lower", say — the comparison silently never matches and
  // the contradiction comes back with nothing failing.
  const V = require("../valuation");
  const comp = (condition) => ({ transaction: "Sale", condition });
  const up = V.conditionFit("Renovated", [comp("Original"), comp("Original"), comp("Original")]);
  const down = V.conditionFit("Needs work", [comp("Renovated"), comp("Renovated"), comp("Renovated")]);
  assert.equal(up.dir, "above");
  assert.equal(down.dir, "below");
  assert.equal(V.askFit(1000000, 2000000).dir, "above");
  assert.equal(V.askFit(2000000, 1000000).dir, "below");
});

// --- the comp table <-> map hover link (2026-08-19) -----------------------

test("the marker index is module-scoped, so the table can reach a pin", () => {
  // It used to be `const compMarkersByNum = {}` INSIDE renderMap, which is
  // precisely why hovering a row could never do anything to the map: the only
  // handle on a marker died with the call that created it. If this regresses
  // the feature goes silently dead -- setPinLit just stops finding markers,
  // and nothing throws.
  const decl = html.match(/^\s*(const|let|var)\s+compMarkersByNum\s*=/gm) || [];
  assert.equal(decl.length, 1, "compMarkersByNum must be declared exactly once");
  const i = html.indexOf("compMarkersByNum =");
  const renderMapAt = html.indexOf("function renderMap(");
  assert.ok(i < renderMapAt,
    "compMarkersByNum must be declared BEFORE renderMap, not inside it");
});

test("every comp row carries the number its pin carries", () => {
  // data-comp-num is the handle both directions of the link use. The roundel
  // in the cell is not enough: it is inside the row, and the delegated
  // listener needs the identity ON the row it matched.
  assert.match(html, /tr\.dataset\.compNum = comp\._num/);
  assert.match(html, /tr\[data-comp-num\]/);
});

test("the row hover listener is delegated once, not re-attached per render", () => {
  // renderTableBody runs on every sort, filter, exclude and added comp. A
  // listener attached per row, or per render on the body, would stack up
  // dozens deep in one sitting and fire the handler once per copy.
  assert.match(html, /body\.dataset\.mapLinkWired/);
});

test("a re-render clears every lit pin", () => {
  // A row removed from under the cursor -- excluded, filtered out, sorted
  // away -- never fires mouseout, so its pin would stay lit for the rest of
  // the report. renderTableBody clears them all at the top.
  const at = html.indexOf("function renderTableBody(");
  const body = html.slice(at, at + 2500);
  assert.match(body, /setPinLit\(n, false\)/,
    "renderTableBody must clear lit pins before rebuilding rows");
});

test("the pin scale is on the inner dot, never on the Leaflet-positioned element", () => {
  // Leaflet owns .comp-pin's transform for positioning. Animating that makes
  // every lit pin drift off its building as the map pans.
  assert.match(html, /\.comp-pin\.lit \.comp-pin-dot \{[^}]*transform: scale/);
  assert.doesNotMatch(html, /\.comp-pin\.lit \{[^}]*transform:/);
});

test("the Explorer's momentum badge colours exactly the three directions", () => {
  const src = html.match(/const DIR_COLOR = \{[\s\S]*?const dirBadge = \(d\) => \{[\s\S]*?\n      \};/);
  assert.ok(src, "could not find the Explorer's dirBadge — was it renamed or moved?");
  const ctx = vm.createContext({
    escq: (s) => String(s ?? "").replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])),
  });
  new vm.Script(src[0] + "\n;this.fn = dirBadge;", { filename: "index.html" }).runInContext(ctx);
  // Tokens, not literals: --green and --red invert in dark mode, so a badge
  // pinned to the light shades would go unreadable on the dark dropdown.
  assert.match(ctx.fn("expanding"), /var\(--green\)[\s\S]*Expanding/);
  assert.match(ctx.fn("flat"), /var\(--ink-mute\)[\s\S]*Flat/);
  assert.match(ctx.fn("contracting"), /var\(--red\)[\s\S]*Contracting/);
  // A market page with no stored read shows nothing at all — most of the pages
  // standing today predate the field, and a fourth "unknown" chip on every one
  // of them would be the loudest thing in the dropdown.
  assert.equal(ctx.fn(undefined), "");
  assert.equal(ctx.fn(""), "");
  assert.equal(ctx.fn("booming"), "");
  // A bare DIR_COLOR[d] lookup would let an inherited key through as a truthy
  // "colour" and print the word into the row.
  assert.equal(ctx.fn("constructor"), "");
  assert.equal(ctx.fn("toString"), "");
});

test("the Explorer badge uses only classes the vendored tailwind.css actually has", () => {
  // index.html has no build step: a utility class missing from the committed
  // tailwind.css silently does nothing, so the badge would render unstyled
  // rather than fail. text-[11.5px], ml-2 and capitalize are all absent from
  // that build today, which is why the badge's size and colour ride in a
  // style attribute instead.
  const css = fs.readFileSync(path.join(__dirname, "..", "tailwind.css"), "utf8");
  const row = html.match(/<a href="\/market\/\$\{escq\(m\.slug\)\}" class="([^"]+)"/);
  assert.ok(row, "could not find the Explorer's covered-market row");
  const badge = html.match(/<span class="(shrink-0[^"]*)" style="color:/);
  assert.ok(badge, "could not find the Explorer's momentum badge span");
  const used = (row[1] + " " + badge[1]).split(/\s+/).filter(Boolean)
    // Interactive variants and the arbitrary text/bg colours already in the
    // row are checked by the same escaped-selector rule below.
    .filter((c) => !c.startsWith("hover:"));
  for (const cls of used) {
    const selector = "." + cls.replace(/([:[\]().%#/,])/g, "\\$1");
    assert.ok(css.includes(selector),
      `class "${cls}" is not in the vendored tailwind.css — regenerate it (see tailwind.config.js) or use an inline style`);
  }
});

test("the nav links server.js injects into the app are styled by the vendored tailwind.css", () => {
  // APP_NAV_LINK_CLASS is a Tailwind class string that lives in server.js and
  // is injected into index.html at the <!--NAV_LINKS--> marker. tailwind.css
  // is purged against index.html ALONE, so those utilities survive only while
  // index.html happens to use them elsewhere — the moment it stops, the
  // Explore menu's links render unstyled and nothing fails.
  //
  // server.js says "#pricingLink, one line above the marker, carries this
  // identical set", and that has ALREADY drifted: Pricing moved out of the
  // dropdown on 2026-08-21 and now carries "hidden hover:text-[#1A2433]".
  // The invariant was prose-only until this test, which is why it went stale
  // without anybody noticing. Checked against the CSS rather than against
  // #pricingLink, because the CSS is what the invariant is actually for.
  const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const m = serverSrc.match(/const APP_NAV_LINK_CLASS = "([^"]+)"/);
  assert.ok(m, "could not find APP_NAV_LINK_CLASS in server.js");

  const css = fs.readFileSync(path.join(__dirname, "..", "tailwind.css"), "utf8");
  for (const cls of m[1].split(/\s+/).filter(Boolean)) {
    const selector = "." + cls.replace(/([:[\]().%#/,])/g, "\\$1");
    assert.ok(
      css.includes(selector),
      `APP_NAV_LINK_CLASS uses "${cls}", which is not in the vendored tailwind.css. ` +
        `Either index.html no longer uses it (regenerate tailwind.css) or the class string ` +
        `needs changing — a server-injected class index.html never mentions is invisible to the purge.`,
    );
  }
});

// ---------------------------------------------------------------------------
// The shop nouns, mirrored (migration 036)
//
// index.html cannot require org-access.js, so the two shops' words exist
// twice: once in the module the server writes emails from, once in the script
// that writes the desk. That is a mirrored constant, which CLAUDE.md and
// Chuck's own trap list name as the way this codebase breaks quietly -- so it
// is mirrored deliberately and pinned here, the way exportReportKey and
// PRO-BILLING-SETUP.md are.
//
// What drift would look like without this: a firm invited as a development
// shop, told by email that its shelf holds land comps, opening a desk that
// says comp sets and BOVs.
// ---------------------------------------------------------------------------
test("index.html's SHOP_COPY is the same map as org-access.js's", () => {
  const ORG = require("../org-access.js");
  const src = html.match(/  const SHOP_COPY = \{[\s\S]*?\n  \};/);
  assert.ok(src, "index.html's SHOP_COPY block is gone or renamed — the mirror is unpinned");
  const ctx = vm.createContext({});
  new vm.Script(src[0] + "\nthis.copy = SHOP_COPY;", { filename: "index.html" }).runInContext(ctx);
  assert.deepEqual(ctx.copy, ORG.SHOP_COPY,
    "the desk and the invite email would describe the same firm differently");
  // Both halves read an unknown kind as broker; SHOP_COPY having a `broker`
  // key is what makes that fallback a value rather than undefined.
  assert.ok(ctx.copy.broker, "the fallback both halves use is missing from the page's map");
});

// --- The seat minimum is mirrored into the buy prompt -----------------------
//
// The same hazard as SHOP_COPY above, with money on it. The seats prompt
// defaults and validates against its own copy of ORG.MIN_SEATS, because
// index.html cannot require the module. Drift is bad in both directions and
// loud in neither: a page minimum BELOW the module's offers a number the
// route then refuses, which reads as a broken Buy button; a page minimum
// ABOVE it quietly stops selling the smallest firm plan that exists.
// ---------------------------------------------------------------------------
test("index.html's seat minimum is org-access.js's MIN_SEATS", () => {
  const ORG = require("../org-access.js");
  const m = html.match(/const MIN_SEATS = (\d+);/);
  assert.ok(m, "index.html's MIN_SEATS is gone or renamed — the mirror is unpinned");
  assert.equal(Number(m[1]), ORG.MIN_SEATS,
    "the seats prompt and the checkout route disagree about the smallest firm plan");
});

// --- Development returns card (C6) ------------------------------------------
// renderDevCard is straight-line DOM code: every figure is written with
// getElementById(...).textContent, so a mistyped or renamed id does not throw
// anywhere a person would see — it writes into nothing, and the tile silently
// keeps its "—" forever while the arithmetic behind it is perfectly correct.
// That is the failure this pins.

test("every element renderDevCard writes to exists in the markup", () => {
  const ids = [
    "devCard", "devBasis",
    "devLand", "devHard", "devSoft", "devCont", "devMonths",
    "devTotal", "devTotalSub",
    "devYoc", "devYocSub",
    "devSpread", "devSpreadSub",
    "devIrr", "devIrrSub",
    "devProfit", "devProfitSub",
  ];
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `renderDevCard writes to #${id}, which index.html does not contain`);
  }
});

test("the dev card's set() helper convention holds: every tile has its Sub sibling", () => {
  // set(id, txt, sub) writes to `id` AND `id + "Sub"`. A tile added without
  // its Sub element loses its explanatory line with no error.
  for (const base of ["devTotal", "devYoc", "devSpread", "devIrr"]) {
    assert.ok(html.includes(`id="${base}"`) && html.includes(`id="${base}Sub"`),
      `${base} is missing its ${base}Sub sibling`);
  }
});

test("dev-returns.js is loaded by the page and served with no caching", () => {
  assert.ok(/<script src="\/dev-returns\.js"><\/script>/.test(html),
    "index.html must load /dev-returns.js — the inline script calls DEVRETURNS");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  // Same rule as /valuation.js: a stale copy against fresh HTML throws where
  // the card renders. The STATIC_FILES entry must carry maxAge: 0.
  const entry = server.match(/"\/dev-returns\.js":\s*\{[^}]*\}/);
  assert.ok(entry, "server.js does not serve /dev-returns.js");
  assert.match(entry[0], /maxAge:\s*0\b/,
    "/dev-returns.js must be served with maxAge: 0, like /valuation.js");
});

test("development costs are private: never sent to the server's search", () => {
  // devCost lives in meta.assumptions beside debt/opex/rentRoll, which
  // /api/share strips and the search body never carries. If a future edit
  // ever puts it in the /api/comps body it would enter the cache key and a
  // stranger's report would be keyed on somebody's construction budget.
  const body = html.match(/JSON\.stringify\(\{\s*address[\s\S]{0,600}?\}\)/g) || [];
  for (const b of body) {
    assert.ok(!/devCost/.test(b), "a development cost reached the /api/comps request body");
  }
});

// The SECOND mirrored string of the firm panel, and the one with no map to
// hide behind. The browser refuses an unanswered shop question itself rather
// than spending a round trip on it, so the sentence exists twice; the sentence
// also enumerates the shops, so it goes stale the day a kind is added. Pinning
// it to the module's own words is what turns that from a silent drift into a
// failing test (037 is the migration that proved it can happen).
test("index.html refuses the shop question in org-access.js's own words", () => {
  const ORG = require("../org-access.js");
  const expected = ORG.validateShopKind("").error;
  assert.ok(html.includes(`"${expected}"`),
    `the page's refusal has drifted from validateShopKind's: ${expected}`);
});

// ---------------------------------------------------------------------------
// The collapsed search settings (2026-08-23). Focus, Lookback and Property SF
// moved behind a line that states their current values, so the form's only
// open question is the address. The trade is that the line IS the only thing
// on screen saying what the search will do — three controls the reader can
// see explain themselves, and a summary that has gone stale does not.
// ---------------------------------------------------------------------------

test("the collapsed settings line states what the search will actually do", () => {
  const words = html.match(/const TX_FOCUS_WORDS = \{[^}]*\};/);
  const fn = html.match(/function refreshSearchSettingsLine\(\) \{[\s\S]*?\n  \}/);
  assert.ok(words && fn, "could not bound refreshSearchSettingsLine — renamed or moved?");

  const line = { textContent: "" };
  const focus = { value: "both" };
  const size = { value: "" };
  let months = 24;
  const ctx = vm.createContext({
    searchSettingsLine: line,
    txFocusSel: focus,
    targetSizeInput: size,
    selectedLookbackMonths: () => months,
    // valuation.js's, copied rather than required: the browser reads it off
    // the VALUATION global, which this extraction has no way to destructure.
    numericValue: (str) => {
      if (str == null) return NaN;
      const m = String(str).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
      return m ? parseFloat(m[0]) : NaN;
    },
  });
  new vm.Script(`${words[0]}\n${fn[0]}\n;this.refresh = refreshSearchSettingsLine;`,
    { filename: "index.html" }).runInContext(ctx);

  // The defaults, which is what nearly every visitor will read. Naming the
  // size default is the point: somebody who leaves the box empty should learn
  // it gets looked up, not wonder whether they have cost themselves the
  // number the hero multiplies.
  ctx.refresh();
  assert.equal(line.textContent, "Sales & leases · last 24 months · size from public records");

  focus.value = "leases";
  months = 6;
  ctx.refresh();
  assert.equal(line.textContent, "Leases only · last 6 months · size from public records");

  // A size that IS set replaces the promise to look one up.
  focus.value = "sales";
  months = 36;
  size.value = "24800";
  ctx.refresh();
  assert.equal(line.textContent, `Sales only · last 36 months · ${(24800).toLocaleString()} SF`);
  assert.match(line.textContent, / SF$/);

  // A half-typed custom window. Submit refuses this state, and while the
  // control is collapsed this line is the only thing that can say why — so it
  // must not quietly name a window that is not set.
  months = null;
  ctx.refresh();
  assert.match(line.textContent, /lookback not set/);
});

test("every seam that moves focus, window or size refreshes the settings line", () => {
  // The failure this guards is invisible on screen: the line keeps describing
  // the previous search while the controls it describes are collapsed. Only
  // the lookback has a funnel (setLookbackControls); focus and size are
  // assigned directly at the restore paths, so each of those needs the call.
  const seams = [
    // The user-facing controls.
    [/txFocusSel\.addEventListener\("change", refreshSearchSettingsLine\)/, "the focus select"],
    [/function setLookbackControls\(months\) \{[\s\S]*?refreshSearchSettingsLine\(\)/, "setLookbackControls"],
    // Machine writes that fire no "input" event of their own.
    [/function dropMachineSize\(\) \{[\s\S]*?refreshSearchSettingsLine\(\)/, "dropMachineSize"],
    [/noteMachineSize\(meta\.address, Math\.round\(found\)\);\s*\n\s*\/\/[\s\S]{0,220}?refreshSearchSettingsLine\(\)/,
      "the record-backed size autofill"],
    // Restores, which assign every one of the three without an event.
    // The restore seam. rerunHistory used to carry this call inline; it now
    // delegates to restoreFormFromMeta, which the two REOPEN paths call too —
    // they assign the same three values and never refreshed the line at all.
    [/function restoreFormFromMeta\(m\) \{[\s\S]*?refreshSearchSettingsLine\(\)/, "restoreFormFromMeta"],
    [/function rerunHistory\(m\) \{[\s\S]*?restoreFormFromMeta\(m\)[\s\S]*?requestSubmit\(\)/, "rerunHistory"],
    [/function syncSubjectFieldsToType\(\) \{[\s\S]*?refreshSearchSettingsLine\(\)/, "syncSubjectFieldsToType"],
  ];
  for (const [re, what] of seams) {
    assert.match(html, re, `${what} can move a settings value without refreshing the line`);
  }
  // The footprint estimate is the one machine write that needs no call of its
  // own: it dispatches "input" on #targetSize, and that listener refreshes.
  assert.match(html,
    /getElementById\("targetSize"\)\.addEventListener\("input", \(e\) => \{[\s\S]*?refreshSearchSettingsLine\(\)/,
    "the size input listener no longer refreshes the line, which also covers the footprint estimate");
});

test("the three controls are behind the settings summary, and keep their ids", () => {
  const open = html.indexOf('<details id="searchSettings"');
  const close = html.indexOf("</details>", open);
  assert.ok(open > 0 && close > open, "the search-settings disclosure is gone");
  const inside = html.slice(open, close);
  for (const id of ["txFocus", "lookback", "lookbackCustom", "targetSize", "lookbackHint", "targetSizeHint"]) {
    assert.ok(inside.includes(`id="${id}"`), `#${id} left the settings disclosure`);
  }
  // The summary has to carry the line and a word saying it can be opened: a
  // row of values with only a chevron reads as a status line, not a control.
  assert.match(inside, /<summary[\s\S]*?id="searchSettingsLine"[\s\S]*?rd-sum-act[\s\S]*?<\/summary>/);
});

test("the footprint estimate points at where the size actually is", () => {
  // It said "edit it under Details for comps", which had been wrong since the
  // size moved back onto the form (2026-08-16): it sent anyone correcting an
  // estimate to a drawer that does not contain the field.
  const note = html.match(/estNote\.textContent = `[^`]*`/);
  assert.ok(note, "could not find the footprint estimate's note");
  assert.ok(!/Details for comps/.test(note[0]),
    "the estimate note points at Details for comps, which has not held the size since 2026-08-16");
  assert.match(note[0], /change it below/);
});

// ---------------------------------------------------------------------------
// Two labels that credited the wrong thing (2026-08-23). Both were found by
// running the app and reading the screen, which is the only way this class
// shows up: each sentence is fine in isolation and wrong beside its neighbour.
// ---------------------------------------------------------------------------

test("the market-average card does not credit the comps it ignores", () => {
  // #compareMidSub sits under parsed.avg_price_per_sqft, which is deliberately
  // NOT recomputed when the reader excludes a comp. Measured on the sample:
  // excluding one moved the hero to $7,775,000-$8,500,000, the footer to
  // "MEDIAN OF 3 SALE COMPS - $110/SF" and the trust line to "1 excluded by
  // you", while this card held $113 under a label crediting those same comps.
  //
  // The markup default paints before renderComparison runs, so the two have to
  // agree or the honest label is preceded by a flash of the misleading one.
  const markup = html.match(/id="compareMidSub"[^>]*>([^<]*)</);
  assert.ok(markup, "could not find the #compareMidSub default");
  const call = html.match(/setCompareLabels\(\s*"Your Property vs\. Market",[\s\S]*?\n\s*\);/);
  assert.ok(call, "could not find the CRE comparison's setCompareLabels call");
  assert.ok(call[0].includes('"' + markup[1] + '"'),
    "#compareMidSub's default has drifted from the label renderComparison paints: " + markup[1]);

  // Scoped to the two sites that actually reach a screen rather than the whole
  // file: the comment at the call site quotes the old wording on purpose, and
  // a blanket search would forbid explaining the very bug being fixed.
  for (const [where, text] of [["the markup default", markup[1]], ["renderComparison", call[0]]]) {
    assert.ok(!/from pulled comps/.test(text),
      where + " credits the pulled comps for a figure that ignores the reader's exclusions");
  }

  // Whatever the wording becomes, it has to place the figure at the market
  // rather than at this reader's comp set — that is the whole correction.
  assert.match(markup[1], /market/i);

  // The Residential branch compares the ask against lastValuation, which DOES
  // track curation, so it must never inherit this caveat.
  const res = html.match(/function renderResidentialAskComparison\([\s\S]*?setCompareLabels\([\s\S]*?\);/);
  assert.ok(res, "could not bound the Residential comparison");
  assert.ok(!/not just these comps/.test(res[0]),
    "the Residential card compares against the live estimate; it has no stale-average caveat to make");
});

test("the analysis gate names a section that is actually on the form", () => {
  // It said "Property details", which the form has not been called since the
  // owner retitled it "Details for comps" on 2026-08-08 — so the one
  // instruction for unlocking the analysis tools named nothing on screen.
  const gate = html.match(/id="analysisEmpty"[^>]*>([^<]*)</);
  assert.ok(gate, "could not find the analysis gate copy");
  assert.ok(!/Property details/.test(gate[1]),
    "the analysis gate points at 'Property details', a section name the form does not use");
  const named = gate[1].match(/Enter an NOI in (.+?) above/);
  assert.ok(named, "the analysis gate no longer names where the NOI field is: " + gate[1]);
  // Pinned against the summary the form actually renders, so a future retitle
  // fails the build here rather than stranding this sentence again.
  assert.ok(html.includes("+ " + named[1] + " <span"),
    'the analysis gate sends the reader to "' + named[1] + '", which is not the form\'s own summary label');
});

// The sample report is the one CompNinja a prospect reads before signing up,
// so its illustrative data has to survive the product's own honesty checks.
test("the sample report's stated search radius covers its own comps", () => {
  const V = require("../valuation.js");
  const i = html.indexOf("const SAMPLE_REPORT");
  assert.ok(i > 0, "could not find SAMPLE_REPORT");
  const src = html.slice(i, html.indexOf("\n  };", i) + 5);
  const ctx = vm.createContext({});
  new vm.Script(src + "\n;this.S = SAMPLE_REPORT;", { filename: "index.html" }).runInContext(ctx);
  const S = ctx.S;

  const R = 3958.8, rad = (d) => (d * Math.PI) / 180;
  const miles = (a, b, c, d) => {
    const dLat = rad(c - a), dLon = rad(d - b);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };
  const sLat = Number(S.subject_lat), sLng = Number(S.subject_lng);
  const dists = S.comps
    .filter((c) => isFinite(Number(c.lat)) && isFinite(Number(c.lng)))
    .map((c) => miles(sLat, sLng, Number(c.lat), Number(c.lng)));
  assert.ok(dists.length >= 3, "the sample's comps lost their coordinates");
  const farthest = Math.max(...dists);

  const claimed = V.parseRadiusMiles(S.search_radius);
  assert.ok(claimed != null, `the sample's search_radius states no distance: ${S.search_radius}`);

  // The claim said "~5 miles" against comps 8-17 miles out until 2026-08-23.
  // Nothing wrong reached the screen — reconcileRadiusClaim suppressed the
  // line once the real distances arrived (that is what #166 shipped) — but
  // the demo therefore showed no search radius at all, and the fixture was
  // relying on the product papering over it on every render.
  assert.ok(!V.radiusClaimContradicted(S.search_radius, farthest),
    `the sample claims ${claimed} mi but its own comps reach ${farthest.toFixed(1)} mi, so the report suppresses the line`);

  // Stricter than radiusClaimContradicted on purpose: that function allows a
  // 25% slack because a real search's radius is approximate. This fixture is
  // written by us, so it should cover its comps outright rather than survive
  // on the tolerance — otherwise a later comp edit silently spends the slack.
  assert.ok(claimed >= farthest,
    `the sample's radius (${claimed} mi) only clears its farthest comp (${farthest.toFixed(1)} mi) on slack`);
});

// ---------------------------------------------------------------------------
// "Continue with Google" (2026-08-25). The button is a plain anchor into
// GET /auth/google, shipped hidden and revealed only by /api/config's
// googleAuth flag — the Buy-button rule, because most deployments (and every
// local dev run) have no OAuth client and the anchor would 404. These pin the
// three pieces that have to agree: the markup ships dark, the reveal reads
// the config flag, and the callback's failure exit (?gerr=1) has a message
// waiting for it.
test("the Google button ships hidden and is revealed only by config", () => {
  assert.match(html, /<div id="acctGoogleRow" class="hidden">/,
    "the button must ship hidden — a control that can only fail never renders");
  assert.match(html, /id="acctGoogle" href="\/auth\/google"/,
    "the button is an anchor into the server's OAuth door, not a JS submit");
  assert.match(html, /googleAuthLive = Boolean\(cfg\.googleAuth\)/,
    "the reveal must read /api/config's flag, never assume");
  assert.match(html, /acctMode === "signin" \|\| acctMode === "signup"/,
    "the button belongs to the two sign-in tabs, not the reset/forgot forms");
  assert.match(html, /get\("gerr"\)/,
    "the callback's failure exit (?auth=signin&gerr=1) needs its message");
});

// ---------------------------------------------------------------------------
// Cancelling the /?auth=signin door returns a signed-out visitor to the
// landing page, instead of stranding them on the app
// ---------------------------------------------------------------------------
//
// Owner-reported 2026-08-29, alongside the Pricing half of the same defect.
// The account modal lives only in this file, so /?auth=signin is a full
// navigation off whatever page the visitor was reading. Nothing then pointed
// back: closeAcctModal only added `hidden`, and the visitor was left on the
// app behind the wall's lock card having never asked to see it.
//
// No DOM here, so these assert the shape in the source -- the same trade the
// pricing one-shot tests below make, and for the same reason: cheap, and they
// fail the moment somebody unpicks a guard.

test("the signin door arms the landing-page exit, and signup never does", () => {
  assert.match(html, /exitToLandingOnCancel = authParam === "signin";/,
    "the door must arm the exit for signin only");
  // The asymmetry is load-bearing, not an oversight. A signup arrival carries
  // the address typed into the landing page's own form (pendingLandingAddress
  // .v1), which is waiting in the search field by the time they cancel;
  // bouncing them back would throw it away and undo that funnel.
  assert.ok(!/exitToLandingOnCancel = true;/.test(html),
    "nothing may arm the exit unconditionally -- signup would inherit it");
  // Inside the !currentUser guard, so a member following a stale link from a
  // cached page never arms it at all.
  const door = html.match(
    /if \(!currentUser && \(authParam === "signup" \|\| authParam === "signin"\)\) \{[\s\S]{0,400}?exitToLandingOnCancel/);
  assert.ok(door, "the exit is armed outside the signed-out door block");
});

test("the landing-page exit is one-shot and never fires on a successful sign-in", () => {
  const fn = html.match(/function closeAcctModal\(\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, "closeAcctModal moved or changed shape");
  const body = fn[0];
  // Captured and cleared before anything else, like every pending flag beside
  // it: reopening the modal from the lock card, or signing out and back in on
  // this same page load, must not inherit an answered door arrival.
  assert.match(body, /const exitToLanding = exitToLandingOnCancel;\s*\n\s*exitToLandingOnCancel = false;/,
    "the exit flag must be captured and cleared at the top of the close");
  // currentUser, because both successful-auth paths close this modal too (one
  // of them twice, through the import prompt) and a member must land on the
  // app -- that is what they signed in FOR. accountWall, because with the wall
  // off `/` serves this very file and the navigation is a pointless reload.
  assert.match(body, /if \(exitToLanding && !currentUser && accountWall\) location\.href = "\/";/,
    "the exit must be guarded on both the visitor and the wall");
});

// ---------------------------------------------------------------------------
// The pricing deep link is a one-shot, so it may never act on a GUESS
// ---------------------------------------------------------------------------
//
// Reported 2026-08-29: clicking Pricing in any server-rendered header landed
// on a bare home page with no modal, and only a SECOND click opened it.
//
// refreshBillingUI() runs during bootstrap as well (refreshAccountUI calls
// it), before /api/config has answered. At that point proConfig is still the
// boot-time `{ enabled: false }` default, so billingLive() reads FALSE on a
// deployment whose billing is perfectly live. The consumption block flipped
// the one-shot on that early call, skipped the modal, and cleared ?pricing=1
// from the URL anyway -- leaving nothing for the later call that had the real
// answer.
//
// This is the identical mistake applyExplorerGating() already guards against,
// and `proConfigResolved` is the flag written for it. There is no DOM here to
// drive the race, so these assert the guard is present in the source: cheap,
// and they fail the moment someone removes it.

test("the pricing deep link waits for a real config answer before consuming", () => {
  assert.match(html, /if \(pendingPricingHash && proConfigResolved\) \{/,
    "the ?pricing=1 one-shot must be gated on proConfigResolved, not consumed " +
    "on the boot-time proConfig default");
});

test("the pricing one-shot is not cleared on the same pass that skips the modal", () => {
  // The guard has to sit on the OUTER `if`. Folding it into the `live && !pro`
  // test would still flip pendingPricingHash and still rewrite the URL, which
  // is the whole bug -- the modal is not the only thing being lost.
  const block = html.match(
    /if \(pendingPricingHash && proConfigResolved\) \{[\s\S]{0,700}?\n    \}/);
  assert.ok(block, "the pricing consumption block moved or changed shape");
  assert.ok(/pendingPricingHash = false;/.test(block[0]),
    "the one-shot is still cleared inside the guarded block");
  assert.ok(/history\.replaceState/.test(block[0]),
    "the URL cleanup is still inside the guarded block, not outside it");
});

test("proConfigResolved is only ever set from a real /api/config answer", () => {
  // Two call sites (initGate and refreshProConfig), both immediately after the
  // assignment from cfg. If a third appears that guesses, both deep links --
  // pricing and ?explore= -- silently regain the bug above.
  const sets = html.match(/proConfigResolved = true/g) || [];
  assert.equal(sets.length, 2,
    "expected exactly the two config-answer call sites to set proConfigResolved");
  assert.match(html, /let proConfigResolved = false;/,
    "the flag must default to false, so nothing acts before config lands");
});

// ---------------------------------------------------------------------------
// The Date column must sort into an order that exists
//
// The comparator compared parseable pairs chronologically and everything else
// lexicographically, which is not a total order: "Sep 2025" > "Q3 2025" and
// "Q3 2025" > "Feb 2026" by string, while "Sep 2025" < "Feb 2026" by date.
// Array.sort given a contradictory comparator returns an arbitrary permutation,
// and this one put Feb 2026 first in an ASCENDING sort. comp.date is
// unconstrained model text and "Active" and "Q3 2025" are both real stored
// values, so it fired on ordinary reports.
//
// Compiled out of the page rather than restated here, so the test is exercising
// the shipped comparator and not a copy of it.
// ---------------------------------------------------------------------------

function dateComparator() {
  const start = html.indexOf("currentComps.sort((a, b) => {");
  assert.ok(start >= 0, "the comp sort should still exist");
  const from = html.indexOf("      if (col.isDate) {", start);
  const to = html.indexOf("      if (col.numeric) {", from);
  assert.ok(from > 0 && to > from, "could not bound the isDate branch");
  // The string tail is the branch this used to fall through to; keeping it
  // means the test would still see the old intransitivity if it came back.
  return new Function("av", "bv", "dir",
    "const col = { isDate: true }, sortState = { dir: dir };" +
    html.slice(from, to) +
    'return String(av || "").toLowerCase()' +
    '.localeCompare(String(bv || "").toLowerCase()) * dir;');
}

test("the Date comparator is a total order, whatever the model wrote", () => {
  const cmp = dateComparator();
  const A = "Sep 2025", B = "Feb 2026", Z = "Q3 2025";

  // The contradiction itself: if all three of these held, no order exists.
  const cyclical = cmp(A, Z, 1) > 0 && cmp(Z, B, 1) > 0 && cmp(A, B, 1) < 0;
  assert.equal(cyclical, false, "A > Z > B while A < B is a comparator with no valid answer");

  const asc = (rows) => [...rows].sort((x, y) => cmp(x, y, 1));
  assert.deepEqual(asc([B, Z, A]), asc([A, Z, B]),
    "the same three comps must sort the same however they arrived");
  assert.equal(asc([B, Z, A])[0], A, "ascending starts at the oldest real date");
});

test("an unreadable date sinks in both directions, like an unreadable number", () => {
  const cmp = dateComparator();
  const rows = ["Feb 2026", "Active", "Jan 2025"];
  const asc = [...rows].sort((x, y) => cmp(x, y, 1));
  const desc = [...rows].sort((x, y) => cmp(x, y, -1));
  assert.deepEqual(asc, ["Jan 2025", "Feb 2026", "Active"]);
  assert.deepEqual(desc, ["Feb 2026", "Jan 2025", "Active"]);
  assert.equal(asc.at(-1), "Active", "never sorted among the real dates");
  assert.equal(desc.at(-1), "Active", "and not floated to the top by reversing");
});

// ---------------------------------------------------------------------------
// Reopening a saved report must not value it with the last search's building
//
// subjectRangeFromMeta / askingRangeFrom / subjectCapRate fall back to the live
// form inputs when the report's own meta carries no figure — and the comment on
// the first of them says a reopened report "has no form inputs to read". True
// on a cold load, false after any search: renderOwnerHero auto-fills
// #targetSize with the size it looked up. So reopening a saved house after
// searching a 152,400 SF warehouse multiplied the house's $/SF by the
// warehouse's square footage. CLAUDE.md calls the subject size the most
// expensive number in the report; this is it arriving from another building.
// ---------------------------------------------------------------------------

function restoreFormFn() {
  const from = html.indexOf("  function restoreFormFromMeta(m) {");
  assert.ok(from > 0, "restoreFormFromMeta should still exist");
  const to = html.indexOf("\n  }\n", from) + 4;
  const fields = {};
  const doc = {
    getElementById: (id) => (fields[id] = fields[id] || { value: "" }),
  };
  const fn = new Function("document", "syncSubjectFieldsToType", "renderTypeStatus",
    "setLookbackControls", "writeSubjectDetails", "refreshSearchSettingsLine", "__fields",
    "let typeResolution = null;" + html.slice(from, to) +
    "return (m) => { restoreFormFromMeta(m); return __fields; };");
  const noop = () => {};
  let wroteDetails = "unset";
  return {
    fields,
    run: fn(doc, noop, noop, noop, (d) => { wroteDetails = d; }, noop, fields),
    details: () => wroteDetails,
  };
}

test("reopening a report blanks a field the new report has no figure for", () => {
  const h = restoreFormFn();
  // The previous search left the warehouse's looked-up size in the form.
  h.fields.targetSize = { value: "152400" };
  h.fields.targetPrice = { value: "8200000" };
  h.fields.capRate = { value: "6.25" };
  h.fields.noi = { value: "410000" };

  // A saved house whose owner never typed any of them.
  h.run({ address: "12 Oak St, Boise, ID", type: "Residential", subject: {} });

  assert.equal(h.fields.targetSize.value, "",
    "a blank size must be written as blank — this is the number the hero multiplies");
  assert.equal(h.fields.targetPrice.value, "");
  assert.equal(h.fields.capRate.value, "");
  assert.equal(h.fields.noi.value, "");
  assert.equal(h.fields.address.value, "12 Oak St, Boise, ID");
});

test("a report that does carry its own figures still restores them", () => {
  const h = restoreFormFn();
  h.fields.targetSize = { value: "152400" };
  h.run({
    address: "12 Oak St, Boise, ID", type: "Residential",
    subject: { sizeMin: 2100, priceMin: 615000, capRate: 5.5, noi: 33000 },
  });
  assert.equal(h.fields.targetSize.value, 2100);
  assert.equal(h.fields.targetPrice.value, 615000);
  assert.equal(h.fields.capRate.value, 5.5);
  assert.equal(h.fields.noi.value, 33000);
});

test("both reopen paths restore the form before they render", () => {
  for (const fn of ["openHistoryReport", "openPortfolioItem"]) {
    const from = html.indexOf("function " + fn + "(");
    assert.ok(from > 0, fn + " should still exist");
    // Comment lines are stripped first: the code comments at both call sites
    // name renderResults while explaining the ordering, and an index into a
    // sentence about the rule is not an index into the rule.
    const body = html.slice(from, html.indexOf("\n  }\n", from))
      .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    const restore = body.indexOf("restoreFormFromMeta(");
    const render = body.indexOf("renderResults(");
    assert.ok(restore > 0, fn + " must restore the form from the report's meta");
    assert.ok(render > 0, fn + " should still render");
    assert.ok(restore < render,
      fn + " must restore BEFORE rendering, or the hero reads the previous search's inputs");
  }
});

// ---------------------------------------------------------------------------
// "FL 33101" is a state and a ZIP, not floor 33101
//
// unitDesignatorOf gates three things: the OSM footprint size estimate, the
// Street View / aerial photo on every map pin, and the verified_key that
// migration 035's portfolio dedupe runs on. "fl" is in the keyword vocabulary
// and FL is a state abbreviation, so every Florida address matched — no size
// estimate, no pin photo, and one building typed three ways saved as three
// properties, for the whole state, with nothing anywhere reporting it.
//
// A refusal is invisible by design (the comment on the vocabulary says a false
// positive "silently costs a size estimate and a photo"), which is exactly why
// the must-PASS direction needs a test and not only the must-REFUSE one.
// ---------------------------------------------------------------------------

function unitDesignatorFn() {
  const from = html.indexOf("var UNIT_KEYWORDS =");
  const to = html.indexOf("const typeGuessCache");
  assert.ok(from > 0 && to > from, "could not bound the unit-designator block");
  return new Function(html.slice(from, to) + "; return unitDesignatorOf;")();
}

test("an ordinary address in Florida is not read as one unit of a site", () => {
  const unitOf = unitDesignatorFn();
  for (const address of [
    "873 E Citation Ct, Miami, FL 33101",
    "1450 NW 20th St, Fort Lauderdale, FL 33311",
    "900 Building Materials Way, Tampa, FL 33602",
    "12 Lotus Dr, Miami, FL 33101",
    "77 Bay St, Miami, FL 33101-4021",
  ]) {
    assert.equal(unitOf(address), null,
      address + " must keep its photo, its footprint size and its portfolio key");
  }
});

test("stripping the state and ZIP does not cost a real unit designator", () => {
  const unitOf = unitDesignatorFn();
  const units = [
    ["6728 W Fairview Ave Trailer 51, Boise, ID", "trailer 51"],
    ["123 Main St Apt 3B, Boise, ID 83702", "apt 3b"],
    ["500 Oak Ave Ste 200, Dallas, TX 75201", "ste 200"],
    ["77 Bay St #45, Miami, FL 33101", "#45"],
    // A genuine floor in Florida: the tail goes, the designator stays.
    ["500 Main St Fl 3, Miami, FL 33101", "fl 3"],
  ];
  for (const [address, want] of units) {
    assert.equal(String(unitOf(address)).toLowerCase(), want, address);
  }
  // The street names the vocabulary's own comment says it must not eat.
  for (const address of ["100 Roomy Lane, Boise, ID", "3 Ste Genevieve Ave, St Louis, MO 63101",
    "200 United Nations Plaza, New York, NY 10017", "500 Lot Ave, Dallas, TX 75201"]) {
    assert.equal(unitOf(address), null, address);
  }
});

// ---------------------------------------------------------------------------
// A portfolio holds what you OWN (2026-08-31)
//
// Every signed-in search used to auto-save itself into the portfolio, which
// made "Your properties" a log of everything the account had ever looked up.
// saveHistory() now writes to /api/recents instead, and the ONLY portfolio
// write left on that path is the pending "Refresh valuation" branch — which is
// not an exception: the member already claimed that property, and clicking
// Refresh on it is the ask.
//
// Source-scanned rather than executed, because the failure is a single line
// coming back in a 20,000-line file and it would look entirely reasonable in a
// diff. The route-level half of this rule lives in test/recents-run.test.js.
// ---------------------------------------------------------------------------
test("a search files itself under recents, never onto the desk", () => {
  const body = html.match(/function saveHistory\(meta, data\)[\s\S]*?\n  \}\n/);
  assert.ok(body, "saveHistory must still exist");
  const src = body[0];

  assert.match(src, /acctApi\("POST", "\/api\/recents"/,
    "a completed search has to be recorded somewhere the member can reach it");

  // The one surviving portfolio write, and the guard that keeps it honest.
  const portfolioWrites = src.match(/acctApi\("POST", "\/api\/portfolio"/g) || [];
  assert.equal(portfolioWrites.length, 1,
    "exactly one portfolio write may remain in saveHistory: the Refresh branch");
  assert.match(src, /pendingPortfolioRefresh &&\s*\n\s*pendingPortfolioRefresh\.address === meta\.address/,
    "and it must stay gated on the member having asked to refresh THAT property");
  assert.match(src, /id: refreshId/,
    "the Refresh branch updates an existing item by id; it never creates one");
});

test("the signup import lands in recents, not on a new member's desk", () => {
  // The worst instance of the old behaviour: whatever reports the browser
  // happened to be holding became a portfolio, before anybody had seen the
  // product or claimed anything.
  const handler = html.match(/acctImportYes"\)\.addEventListener\("click"[\s\S]*?\n  \}\);/);
  assert.ok(handler, "the import handler must still exist");
  assert.match(handler[0], /acctApi\("POST", "\/api\/recents"/);
  assert.doesNotMatch(handler[0], /\/api\/portfolio/,
    "importing browser history must never fill a desk");
});

test("clearing recent searches clears the server copy too", () => {
  // Otherwise "clear" empties this browser, leaves the list standing on the
  // member's other devices, and repopulates itself here on the next fetch.
  const handler = html.match(/clearHistoryBtn"\)\.addEventListener\("click"[\s\S]*?\n  \}\);/);
  assert.ok(handler, "the clear handler must still exist");
  assert.match(handler[0], /acctApi\("DELETE", "\/api\/recents"\)/);
});

// --- The tester code, in Settings -------------------------------------------
//
// TESTER_PASSKEY (and VAULT_PASSKEY, which shares the input) is redeemed from
// ONE box, and on 2026-08-31 that box moved out of the pricing modal's "Have
// a code?" disclosure into the Settings panel — the codes go to friends,
// family and testers, so the place to type one is the panel you open to look
// at your own account. These pin the move, because the two ways to undo it are
// both invisible on screen: a second copy put back in the modal (two inputs,
// two message elements, two visibility rules, and whichever one a person finds
// first), and a handler left pointing at an element that no longer exists —
// index.html's script aborts WHOLE on a throw, so a stale
// getElementById(...).addEventListener takes the entire front end down while
// the page still renders its HTML and CSS.

// The one big inline block — the whole front end. Picked as the longest real
// JS block rather than by index, so a new small inline script above it (an
// analytics shim, a boot guard) cannot silently point these at the wrong one.
function appScript() {
  const real = extractScriptBlocks(html).filter(isRealJsBlock);
  assert.ok(real.length > 0, "no real inline script blocks found");
  return real.reduce((a, b) => (b.body.length > a.body.length ? b : a)).body;
}

test("the tester-code box lives in the Settings panel, and only there", () => {
  const inputs = html.split('id="passkeyInput"').length - 1;
  assert.equal(inputs, 1,
    "exactly one tester-code input — a second copy is a second thing to keep in step");

  const settings = html.indexOf('id="settingsModal"');
  const close = html.indexOf('id="settingsClose"');
  const row = html.indexOf('id="passkeyRow"');
  assert.ok(settings > 0 && close > settings, "settings modal brackets not found");
  assert.ok(row > settings && row < close,
    "#passkeyRow must sit inside the settings modal, between #settingsModal and #settingsClose");

  // The pricing modal is earlier in the document and must carry no copy.
  const pricing = html.indexOf('id="pricingModal"');
  assert.ok(pricing > 0 && pricing < settings, "pricing modal is expected before the settings modal");
  const pricingMarkup = html.slice(pricing, settings);
  assert.ok(!/id="passkey/.test(pricingMarkup),
    "the pricing modal must not carry a second tester-code box");
});

test("nothing still reaches for the disclosure the settings row replaced", () => {
  // The row shows its input directly, so #passkeyToggle and #passkeyForm are
  // gone. A handler outliving its element throws on load and kills the app.
  for (const dead of ["passkeyToggle", "passkeyForm"]) {
    assert.ok(!html.includes(dead),
      dead + " is gone from the markup, so no script may still name it");
  }
});

test("every element the tester-code handlers address exists in the markup", () => {
  const script = appScript();
  for (const id of ["passkeyRow", "passkeyInput", "passkeySubmit", "passkeyMsg"]) {
    assert.ok(script.includes('"' + id + '"'), id + " must still be wired up");
    assert.ok(html.includes('id="' + id + '"'), id + " must exist in the markup");
  }
});

test("redeeming from Settings reports the outcome instead of closing a modal", () => {
  const script = appScript();
  const start = script.indexOf("async function submitPasskey");
  assert.ok(start > 0, "submitPasskey not found");
  const body = script.slice(start, start + 3000);
  assert.ok(!body.includes("closePricingModal()"),
    "the box is in Settings now; closing the pricing modal would hide the Plan row that just repainted");
  assert.ok(body.includes("refreshProConfig()"),
    "a grant must re-read /api/config so the Plan row above it updates in place");
  // The route answers a re-redemption with a 200 and `already`. Reported as
  // an error it would read as a code that stopped working.
  assert.ok(body.includes("data.already"),
    "an already-redeemed code must read as success, not failure");
});
