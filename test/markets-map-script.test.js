// The /markets momentum map, as it actually runs in a visitor's browser.
//
// MARKETS_DIR_MAP_JS is ~180 lines of browser JavaScript living inside a
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
// literal reproduces the served bytes exactly — safe because this string
// deliberately carries no ${} interpolation, which is pinned here.
function mapSource() {
  const open = "const MARKETS_DIR_MAP_JS = `";
  const i = SERVER.indexOf(open);
  assert.notEqual(i, -1, "MARKETS_DIR_MAP_JS is gone or renamed — this file exercises it by name");
  const start = i + open.length;
  const raw = SERVER.slice(start, SERVER.indexOf("`;", start));
  assert.ok(!/\$\{/.test(raw),
    "MARKETS_DIR_MAP_JS grew a ${} interpolation — it is emitted into a <script> and must stay literal");
  return new Function("return `" + raw + "`")();
}

const PINS = [
  { slug: "industrial-ontario-ca", type: "Industrial", city: "Ontario", state: "CA", key: "ontario, ca", lat: 34.06, lng: -117.6, median: 259, dir: "contracting" },
  { slug: "industrial-phoenix-az", type: "Industrial", city: "Phoenix", state: "AZ", key: "phoenix, az", lat: 33.45, lng: -112.07, median: 117, dir: "expanding" },
  { slug: "multifamily-phoenix-az", type: "Multifamily", city: "Phoenix", state: "AZ", key: "phoenix, az", lat: 33.45, lng: -112.07, median: 339, dir: "contracting" },
  // A city with no boundary in the stub file: its click must still answer.
  { slug: "office-nowhere-xx", type: "Office", city: "Nowhere", state: "XX", key: "nowhere, xx", lat: 40, lng: -100, median: 90 },
];
const AREAS = [
  { key: "ontario, ca", city: "Ontario", state: "CA", momentum: "contracting", markets: [{ slug: "industrial-ontario-ca", type: "Industrial", median: 259, dir: "contracting" }] },
  { key: "phoenix, az", city: "Phoenix", state: "AZ", momentum: "mixed", markets: [
    { slug: "industrial-phoenix-az", type: "Industrial", median: 117, dir: "expanding" },
    { slug: "multifamily-phoenix-az", type: "Multifamily", median: 339, dir: "contracting" },
  ] },
  { key: "nowhere, xx", city: "Nowhere", state: "XX", momentum: "none", markets: [{ slug: "office-nowhere-xx", type: "Office", median: 90 }] },
];
const SQUARE = { type: "Polygon", coordinates: [[[-117.7, 34.0], [-117.5, 34.0], [-117.5, 34.1], [-117.7, 34.1], [-117.7, 34.0]]] };
const BOUNDS = {
  "ontario, ca": { city: "Ontario", state: "CA", geometry: SQUARE },
  "phoenix, az": { city: "Phoenix", state: "AZ", geometry: SQUARE },
  // "nowhere, xx" deliberately absent.
};

// opts: { bounds, fetchFails, theme }
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
      getBounds() { return { _of: rec }; },
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
        const rec = { ll, html: o2.icon.html, kind: "marker" };
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
      if (o.fetchFails) return Promise.reject(new Error("offline"));
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

  await t.test("a failed boundary fetch degrades to the card, not to nothing", async () => {
    const s = await runMap({ fetchFails: true });
    await s.clickPin("industrial-ontario-ca");
    assert.equal(s.areasOnMap().length, 0);
    assert.equal(s.made.popups.length, 1, "the click must still answer");
    assert.match(s.made.popups[0].content, /industrial-ontario-ca/);
    assert.equal(s.markersOnMap(), 4, "and every pin stays");
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
