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

test("landing address handoff fills #address from sessionStorage and drops the key", () => {
  // File search, not a browser. The landing cannot reach this script;
  // this only proves the app side of the handoff is actually wired.
  const boot = html.match(/pendingLandingAddress\.v1[\s\S]{0,900}/);
  assert.ok(boot, "index.html must read pendingLandingAddress.v1");
  assert.match(boot[0], /getElementById\("address"\)/);
  assert.match(boot[0], /removeItem\(["']pendingLandingAddress\.v1["']\)/);
  assert.ok(
    !/compForm\.submit|requestSubmit|#compForm/.test(boot[0]),
    "filling the box is the whole handoff; do not auto-run a search"
  );
});
