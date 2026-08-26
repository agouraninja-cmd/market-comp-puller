// The /markets momentum map, as it actually runs in a visitor's browser.
//
// MARKETS_DIR_MAP_JS is ~200 lines of browser JavaScript living inside a
// template literal in server.js, and the route tests can only see what the
// page SAYS — the blob, the CSS, the legend. Everything this file is about
// happens after that: what a pin click opens, when the ~110KB of geometry is
// bought, and what is left standing when that fetch fails.
// test/market-map.test.js does the same job for the market page's comp map,
// and was written after a fault of exactly this shape sat unnoticed for two
// weeks.
//
// The script is extracted, evaluated as the template literal it is (so the
// \\uNNNN escapes collapse to the characters a browser reads), and run in a
// vm with a fake Leaflet, a fake getComputedStyle and a stub fetch.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

// The raw slice is not what the browser runs: inside the template literal a
// "\\u2014" is two characters that the literal collapses to the escape the
// browser then reads as an em dash. Evaluating the slice AS a template
// literal reproduces the served bytes exactly — safe because these strings
// deliberately carry no ${} interpolation, which is pinned here.
function scriptSource(constName) {
  const open = "const " + constName + " = `";
  const i = SERVER.indexOf(open);
  assert.notEqual(i, -1, constName + " is gone or renamed — this file exercises it by name");
  const start = i + open.length;
  const raw = SERVER.slice(start, SERVER.indexOf("`;", start));
  assert.ok(!/\$\{/.test(raw),
    constName + " grew a ${} interpolation — it is emitted into a <script> and must stay literal");
  return new Function("return `" + raw + "`")();
}
const mapSource = () => scriptSource("MARKETS_DIR_MAP_JS");

const PINS = [
  { slug: "industrial-ontario-ca", type: "Industrial", city: "Ontario", state: "CA", key: "ontario, ca", lat: 34.06, lng: -117.6, median: 259, dir: "contracting" },
  { slug: "industrial-phoenix-az", type: "Industrial", city: "Phoenix", state: "AZ", key: "phoenix, az", lat: 33.45, lng: -112.07, median: 117, dir: "expanding" },
  // Deliberately ~1km off industrial-phoenix's point: an Explorer-published
  // city's two markets can store slightly different coordinates (Wikipedia's
  // vs Zippopotam's), and the pin spread must still separate them — which is
  // why the spread groups on the city KEY, never on the coordinates.
  { slug: "multifamily-phoenix-az", type: "Multifamily", city: "Phoenix", state: "AZ", key: "phoenix, az", lat: 33.46, lng: -112.06, median: 339, dir: "contracting" },
  // A city with no boundary in the stub file: its click must still answer.
  { slug: "office-nowhere-xx", type: "Office", city: "Nowhere", state: "XX", key: "nowhere, xx", lat: 40, lng: -100, median: 90 },
];
// The slim shape the server actually ships: momentum is the only fact the
// browser cannot derive (market-area.js is server-side); everything a city
// card shows rides the pins.
const AREAS = [
  { key: "ontario, ca", city: "Ontario", state: "CA", momentum: "contracting" },
  { key: "phoenix, az", city: "Phoenix", state: "AZ", momentum: "mixed" },
  { key: "nowhere, xx", city: "Nowhere", state: "XX", momentum: "none" },
];
const SQUARE = { type: "Polygon", coordinates: [[[-117.7, 34.0], [-117.5, 34.0], [-117.5, 34.1], [-117.7, 34.1], [-117.7, 34.0]]] };
// Parses as GeoJSON, draws as nothing: the fake Leaflet throws from
// getBounds() for it, the way the real one throws "Bounds are not valid".
const DEGENERATE = { type: "Polygon", coordinates: [] };
const BOUNDS = {
  "ontario, ca": { city: "Ontario", state: "CA", geometry: SQUARE },
  "phoenix, az": { city: "Phoenix", state: "AZ", geometry: SQUARE },
  // "nowhere, xx" deliberately absent.
};

// opts: { bounds, failFetches (count of leading fetch calls to reject), theme }
function runMap(opts) {
  const o = opts || {};
  const requests = [];
  const card = { style: {} };
  const els = {
    mktsMapCard: card,
    mktsMapData: { textContent: JSON.stringify({ pins: PINS, areas: AREAS }) },
  };
  let theme = o.theme || null;
  const onMap = new Set();
  const observers = [];
  const tileUrls = [];
  const made = { markers: [], areas: [], popups: [] };
  const view = { fits: [], sets: [] };

  function layerBase(rec) {
    const l = {
      _rec: rec,
      addTo() { onMap.add(l); return l; },
      bindTooltip(t) { rec.tooltip = t; return l; },
      bindPopup(p) { rec.popup = p; return l; },
      openPopup() { rec.popupOpened = (rec.popupOpened || 0) + 1; return l; },
      setStyle(s) { rec.style = s; return l; },
      on(ev, fn) { (rec.handlers = rec.handlers || {})[ev] = fn; return l; },
      getBounds() {
        if (rec.geometry && Array.isArray(rec.geometry.coordinates) && !rec.geometry.coordinates.length) {
          throw new Error("Bounds are not valid.");
        }
        return { _of: rec };
      },
    };
    rec.layer = l;
    return l;
  }

  const map = {
    setView(ll, z) { view.sets.push({ ll, z }); return map; },
    fitBounds(b, o2) { view.fits.push({ b, o: o2 }); return map; },
    getZoom: () => 4,
    on() {},
    hasLayer: (l) => onMap.has(l),
    addLayer(l) { onMap.add(l); return map; },
    removeLayer(l) { onMap.delete(l); return map; },
  };

  let failLeft = o.failFetches || 0;
  const ctx = {
    document: {
      getElementById: (id) => els[id] || null,
      documentElement: { getAttribute: (k) => (k === "data-theme" ? theme : null) },
    },
    getComputedStyle: () => ({ getPropertyValue: (n) => ({ "--green": "#0f0", "--red-fill": "#f00", "--ink-mute": "#888", "--ink-3": "#666", "--ink": "#111", "--card": "#fff" }[n] || "") }),
    MutationObserver: function (fn) { observers.push(fn); this.observe = () => {}; },
    L: {
      map: () => map,
      tileLayer: (url) => {
        tileUrls.push(url);
        const layer = { setUrl: (u) => { tileUrls.push(u); return layer; } };
        layer.addTo = () => layer;
        return layer;
      },
      divIcon: (o2) => o2,
      marker: (ll, o2) => {
        const rec = { ll, html: o2.icon.html, anchor: o2.icon.iconAnchor, kind: "marker" };
        made.markers.push(rec);
        return layerBase(rec).addTo();
      },
      geoJSON: (geometry, o2) => {
        const rec = { geometry, style: o2.style, kind: "area" };
        made.areas.push(rec);
        return layerBase(rec);
      },
      popup: () => {
        const rec = { kind: "popup" };
        made.popups.push(rec);
        const p = {
          setLatLng(ll) { rec.ll = ll; return p; },
          setContent(c) { rec.content = c; return p; },
          openOn() { rec.opened = true; return p; },
        };
        return p;
      },
    },
    fetch: (url) => {
      requests.push(String(url));
      if (failLeft > 0) { failLeft--; return Promise.reject(new Error("offline")); }
      return Promise.resolve({ json: () => Promise.resolve(o.bounds === undefined ? BOUNDS : o.bounds) });
    },
    console, setTimeout, clearTimeout, Promise, JSON, Math, Number,
    String, Object, Array, Set, isFinite, parseFloat, Error,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(mapSource(), ctx, { timeout: 5000 });

  const state = {
    requests, card, made, tileUrls, observers, onMap, view,
    setTheme: (t) => { theme = t; },
    fireTheme: () => observers.forEach((fn) => fn()),
    markersOnMap: () => made.markers.filter((r) => onMap.has(r.layer)).length,
    areasOnMap: () => made.areas.filter((r) => onMap.has(r.layer)),
    // A pin click, as Leaflet would deliver it. Async because the handler
    // rides the boundary fetch; one macrotask settles the chain.
    clickPin: (slug) => {
      const rec = made.markers[PINS.findIndex((p) => p.slug === slug)];
      rec.handlers.click();
      return new Promise((r) => setTimeout(r, 20));
    },
  };
  return new Promise((r) => setTimeout(() => r(state), 20));
}

test("the page load costs nothing extra", async (t) => {
  await t.test("no boundary fetch until a pin is clicked", async () => {
    const s = await runMap();
    assert.deepEqual(s.requests, [],
      "~110KB of polygon was bought for a visitor who never clicked a pin");
    assert.equal(s.markersOnMap(), 4, "every market must be pinned");
    assert.equal(s.areasOnMap().length, 0, "no boundary may draw before it is asked for");
  });

  await t.test("clicking around buys the file exactly once", async () => {
    const s = await runMap();
    await s.clickPin("industrial-ontario-ca");
    await s.clickPin("industrial-phoenix-az");
    await s.clickPin("industrial-ontario-ca");
    assert.deepEqual(s.requests, ["/city-bounds.json"],
      "the boundary file was requested " + s.requests.length + " times");
  });

  await t.test("two markets of one city spread even when their stored points differ", async () => {
    // The fixture's two Phoenix pins sit ~1km apart on purpose; a spread
    // grouped on coordinates would see two singletons and leave them
    // stacked at national zoom — the exact failure the spread prevents.
    const s = await runMap();
    const phoenix = s.made.markers.filter((r) => r.html.includes("Phoenix"));
    assert.equal(phoenix.length, 2);
    assert.notDeepEqual(phoenix[0].anchor, phoenix[1].anchor,
      "the ring offsets must apply to a city whose markets stored different points");
  });
});

test("a pin click opens the city", async (t) => {
  await t.test("the carved boundary appears, colored, and the view fits it", async () => {
    const s = await runMap();
    const fitsAtLoad = s.view.fits.length; // the national fitBounds
    await s.clickPin("industrial-ontario-ca");
    const shapes = s.areasOnMap();
    assert.equal(shapes.length, 1, "Ontario's boundary should be on the map");
    assert.equal(shapes[0].style.fillColor, "#f00", "a contracting city takes the red token");
    assert.equal(s.view.fits.length, fitsAtLoad + 1, "the view must fly to the boundary");
    assert.equal(shapes[0].popupOpened, 1, "the city card must open with the shape");
  });

  await t.test("the card links every market in the city, direction beside each", async () => {
    const s = await runMap();
    await s.clickPin("industrial-phoenix-az");
    const phoenix = s.areasOnMap()[0];
    assert.match(phoenix.popup, /industrial-phoenix-az/, "each market must be a link");
    assert.match(phoenix.popup, /multifamily-phoenix-az/,
      "clicking one Phoenix pin must offer BOTH Phoenix markets — the shape is the city's, not the pin's");
    assert.match(phoenix.popup, /Expanding/);
    assert.match(phoenix.popup, /Contracting/);
  });

  await t.test("a city whose markets disagree is drawn Mixed, never a color", async () => {
    const s = await runMap();
    await s.clickPin("multifamily-phoenix-az");
    const phoenix = s.areasOnMap()[0];
    assert.notEqual(phoenix.style.fillColor, "#f00",
      "a mixed city must not claim either direction's color");
    assert.notEqual(phoenix.style.fillColor, "#0f0");
  });

  await t.test("pins survive every click — they are the navigation surface", async () => {
    const s = await runMap();
    await s.clickPin("industrial-ontario-ca");
    await s.clickPin("industrial-phoenix-az");
    assert.equal(s.markersOnMap(), 4, "no click may take a pin off the map");
  });

  await t.test("revealed cities accumulate; a repeat click reopens, not rebuilds", async () => {
    const s = await runMap();
    await s.clickPin("industrial-ontario-ca");
    await s.clickPin("industrial-phoenix-az");
    assert.equal(s.areasOnMap().length, 2, "clicking around should build up the momentum picture");
    await s.clickPin("industrial-ontario-ca");
    assert.equal(s.made.areas.length, 2, "a second click on a revealed city must not build a second shape");
    assert.equal(s.made.areas[0].popupOpened, 2, "it reopens the existing card instead");
  });
});

test("a click is never a dead end", async (t) => {
  await t.test("a city with no stored boundary still opens its card", async () => {
    const s = await runMap();
    await s.clickPin("office-nowhere-xx");
    assert.equal(s.areasOnMap().length, 0, "there is no shape to draw for it");
    assert.equal(s.made.popups.length, 1, "the card must open anchored to the pin instead");
    assert.match(s.made.popups[0].content, /office-nowhere-xx/, "with its market link");
    assert.equal(s.view.sets.length >= 2, true, "and the view still comes in close");
  });

  await t.test("a failed boundary fetch degrades to the card AND retries on the next click", async () => {
    const s = await runMap({ failFetches: 1 });
    await s.clickPin("industrial-ontario-ca");
    assert.equal(s.areasOnMap().length, 0);
    assert.equal(s.made.popups.length, 1, "the click must still answer");
    assert.match(s.made.popups[0].content, /industrial-ontario-ca/);
    assert.equal(s.markersOnMap(), 4, "and every pin stays");
    // The outage must NOT be memoized (city-check's rule): the next click
    // retries the file, and this time the boundary reveals.
    await s.clickPin("industrial-ontario-ca");
    assert.equal(s.requests.length, 2, "one blip on flaky wifi must not disable retries");
    assert.equal(s.areasOnMap().length, 1, "the boundary must reveal once the file is reachable");
  });

  await t.test("a PRESENT but undrawable boundary entry still opens the card", async () => {
    // The stored entry exists but its geometry throws out of getBounds —
    // this must fall through to the anchored card exactly like a missing
    // entry, never leave the click doing nothing.
    const s = await runMap({ bounds: { "ontario, ca": { city: "Ontario", state: "CA", geometry: DEGENERATE } } });
    await s.clickPin("industrial-ontario-ca");
    assert.equal(s.areasOnMap().length, 0, "an undrawable shape must not be left on the map");
    assert.equal(s.made.popups.length, 1, "the click must still answer with the anchored card");
    assert.match(s.made.popups[0].content, /industrial-ontario-ca/);
  });
});

test("a theme flip restyles the revealed shapes, not just the tiles", async () => {
  const s = await runMap();
  // Before any reveal the observer must be safe to fire.
  s.fireTheme();
  await s.clickPin("industrial-ontario-ca");
  const before = s.areasOnMap()[0].style;
  s.setTheme("dark");
  s.fireTheme();
  assert.match(s.tileUrls[s.tileUrls.length - 1], /dark_all/, "the basemap must swap");
  assert.notEqual(s.areasOnMap()[0].style, before,
    "revealed shapes hold computed colors, so a theme flip must restyle them explicitly");
});

// ---------------------------------------------------------------------------
// The style twins. areaStyle (this script) and boundaryStyle (MARKET_MAP_JS)
// are deliberate copies — browser strings cannot share code — and the ⚠
// MIRROR comments on both point here: a city must look the same on /markets
// and on its own market page, so the numbers and tokens may not drift.
// ---------------------------------------------------------------------------
test("areaStyle and boundaryStyle stay byte-for-byte in step", () => {
  const dir = scriptSource("MARKETS_DIR_MAP_JS");
  const page = scriptSource("MARKET_MAP_JS");
  const bodyOf = (src, name) => {
    const m = src.match(new RegExp("function " + name + "\\(\\w+\\) \\{([\\s\\S]*?)\\n  \\}"));
    assert.ok(m, name + " not found");
    // Strip comments and whitespace so only the executable text is compared.
    return m[1].replace(/\/\/[^\n]*/g, "").replace(/\s+/g, " ").trim();
  };
  const area = bodyOf(dir, "areaStyle");
  const boundary = bodyOf(page, "boundaryStyle");
  // Every line of boundaryStyle must appear inside areaStyle — the directory
  // copy carries one extra branch ("mixed") a single-market page cannot be.
  for (const piece of [
    /var fills = \{[^}]*\}/,
    /if \(fills\[\w+\]\) \{ return \{[^}]*\}; \}/,
    /var n = [^;]+; return \{[^}]*dashArray[^}]*\};/,
  ]) {
    const inBoundary = boundary.match(piece);
    assert.ok(inBoundary, "boundaryStyle lost its " + piece + " shape");
    // Normalize the momentum/dir parameter name difference before comparing.
    const wanted = inBoundary[0].replace(/\bdir\b/g, "momentum");
    assert.ok(area.replace(/\bdir\b/g, "momentum").includes(wanted),
      "areaStyle and boundaryStyle disagree around: " + wanted.slice(0, 80) +
      " — the same city would render differently on /markets vs its own page");
  }
  // The three-word vocabulary must reach every browser-side consumer: a
  // direction market-snapshot.js publishes that these maps cannot draw
  // renders as a hollow pin beside a badge stating the word.
  const MARKETSNAP = require("../market-snapshot");
  for (const word of MARKETSNAP.DIRECTIONS) {
    for (const [where, src] of [["MARKETS_DIR_MAP_JS", dir], ["MARKET_MAP_JS", page]]) {
      assert.ok(src.includes(word + ":"), where + " has no style/word entry for '" + word + "'");
    }
  }
});
