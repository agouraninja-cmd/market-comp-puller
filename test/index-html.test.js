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
// Map pin popups — aerial close-up, snappy hover. Street View was both the
// wrong picture (nearest pano of a fence/neighbor) and the slow one (proxy
// round-trip after the popup opened).
// ----------------------------------------------------------------------------

test("map pin popup photos are aerial Esri tiles, never Street View", () => {
  const fn = html.match(/const svPhoto = \(marker, zoom, address\) => \{[\s\S]*?\n    \};\n    \/\/ Popups must never/);
  assert.ok(fn, "index.html must define svPhoto()");
  assert.match(fn[0], /return aerialThumb\(snapped,/);
  assert.doesNotMatch(fn[0], /\/api\/streetview/);
  assert.doesNotMatch(fn[0], /streetviewEnabled/);
  // The rest of the app page must not start a Street View fetch either —
  // the proxy stays on the server, unused by hover/click.
  const scripts = extractScriptBlocks(html).filter(isRealJsBlock).map((b) => b.body).join("\n");
  assert.doesNotMatch(scripts, /\/api\/streetview/);
});

test("map pin hover opens in 60ms and closes in 80ms", () => {
  const fn = html.match(/const wireHoverPreview = \(m\) => \{[\s\S]*?\n    \};\n    const addSubjMarker/);
  assert.ok(fn, "index.html must define wireHoverPreview()");
  assert.match(fn[0], /setTimeout\(\(\) => m\.openPopup\(\), 60\)/);
  assert.match(fn[0], /setTimeout\(\(\) => m\.closePopup\(\), 80\)/);
  assert.doesNotMatch(fn[0], /setTimeout\(\(\) => m\.openPopup\(\), 120\)/);
  assert.doesNotMatch(fn[0], /setTimeout\(\(\) => m\.closePopup\(\), 320\)/);
});

test("Leaflet popup fade is disabled so hover close is the timer, not a 200ms fade", () => {
  assert.match(html, /\.leaflet-fade-anim \.leaflet-popup \{ transition: none; opacity: 1 \}/);
});

test("aerial popup tiles are prefetched after the building snap", () => {
  assert.match(html, /function prefetchAerialThumbs\(markers\)/);
  assert.match(html, /function aerialTileSpec\(/);
  const snap = html.match(/snapMarkersToBuildings\(allMarkers\(\)\)[\s\S]{0,280}/);
  assert.ok(snap, "renderMap must call snapMarkersToBuildings");
  assert.match(snap[0], /prefetchAerialThumbs\(allMarkers\(\)\)/);
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
  const fn = html.indexOf("  function columnsForType(type) {", start);
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
  assert.match(fn[0], /accountWall && !currentUser/, "it must branch on the lock state");
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
  const fn = html.match(/async function renderDeskHubs\(\)[\s\S]{0,2000}?\n  \}/);
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
  const fn = html.match(/async function renderDeskHubs\(\)[\s\S]{0,2000}?\n  \}/)[0];
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

test("empty desk copy no longer tells them to press Save", () => {
  assert.match(html, /id="deskEmpty"[^>]*>Run a report — it will show up here\./);
  assert.doesNotMatch(html, /press "Save to portfolio"/);
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

test("the desk's portfolio delete is a trash icon, not a Remove word", () => {
  const start = html.indexOf("async function renderMyDesk");
  const end = html.indexOf("// /desk — My Desk lives on its own URL");
  assert.ok(start >= 0 && end > start);
  const fn = html.slice(start, end);
  assert.match(fn, /className = "dk-trash"/);
  assert.match(fn, /aria-label", "Remove from portfolio"/);
  assert.match(fn, /<svg /);
  assert.match(fn, /Remove \$\{item\.address\} from your portfolio/);
  assert.doesNotMatch(fn, /del\.textContent = "Remove"/);
  assert.match(html, /\.dk-trash:hover, \.dk-trash:focus \{ color: var\(--red\)/);
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

  const home = html.slice(html.indexOf('id="homeInfo"'), html.indexOf("Site footer"));
  assert.match(home, /href="\/how-it-works"/);
  assert.match(home, /href="\/brokers"/);
  assert.ok(!/id="marketSearch"/.test(home), "explorer moved out of homeInfo");
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
});

test("once pins settle, the hero re-runs so distance weighting actually moves the range", () => {
  const fn = html.match(/function refreshDistances\(\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, "index.html must define refreshDistances()");
  assert.match(fn[0], /renderOwnerHero\(currentParsed, currentMeta\)/);
  assert.match(html, /farther away/);
  assert.match(html, /nearby/);
});

test("My Desk and the account circle have a place to put a profile photo", () => {
  assert.match(html, /id="acctMenuPhoto"/);
  assert.match(html, /id="acctMenuInitial"/);
  assert.match(html, /id="deskAvatarFile"/);
  assert.match(html, /id="deskAvatarChange"/);
  assert.match(html, /id="menuAvatarBtn"/);
  assert.match(html, /function applyAvatarUI\(/);
  assert.match(html, /function readAvatarFile\(/);
  assert.match(html, /\/api\/account\/avatar/);
});
