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
    mktsMapData: { textContent: JSON.stringify({
      pins: PINS, areas: AREAS,
      // Absent by default, so every test written before the ranked layer
      // existed still exercises the map it was written against.
      ...(o.rank ? { rank: o.rank, rankClass: o.rankClass || "industrial" } : {}),
    }) },
    mmapCount: { textContent: "" },
    // The asset-class dropdown. ONE class at a time: a circle can only be one
    // colour, so this is a value rather than a set.
    mmClass: {
      value: String(o.assetClass || "industrial"),
      listeners: [],
      addEventListener(ev, fn) { if (ev === "change") this.listeners.push(fn); },
    },
  };
  let theme = o.theme || null;
  const onMap = new Set();
  const observers = [];
  const tileUrls = [];
  const made = { markers: [], areas: [], popups: [], circles: [], groups: [] };
  const panes = {};
  // The two radio groups the map's toggles read. `o.layer` / `o.tier` set
  // which member is checked, so a test can drive the control the way a click
  // would without a DOM.
  const radios = { mmlayer: String(o.layer || "both"), mmtier: String(o.tier || "all") };
  const radioHandlers = [];
  const view = { fits: [], sets: [] };

  function layerBase(rec) {
    const l = {
      _rec: rec,
      addTo() { onMap.add(l); return l; },
      bindTooltip(t) { rec.tooltip = t; return l; },
      bindPopup(p) { rec.popup = p; return l; },
      openPopup() { rec.popupOpened = (rec.popupOpened || 0) + 1; return l; },
      setStyle(s) { rec.style = s; rec.styles = (rec.styles || []).concat([s]); return l; },
      setInteractive(v) { rec.interactive = v; return l; },
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
    // The ranked circles live in their own pane, below the markers, and the
    // "Comp coverage" toggle hides the marker pane wholesale rather than
    // unbuilding every pin. Both panes carry a real `style` object so the
    // script's writes are observable.
    createPane(name) { panes[name] = panes[name] || { style: {} }; return panes[name]; },
    getPane(name) { panes[name] = panes[name] || { style: {} }; return panes[name]; },
  };

  let failLeft = o.failFetches || 0;
  const ctx = {
    document: {
      getElementById: (id) => els[id] || null,
      documentElement: { getAttribute: (k) => (k === "data-theme" ? theme : null) },
      // input[name="X"]:checked -> the member `radios` says is selected.
      querySelector: (sel) => {
        const m = /input\[name="([a-z]+)"\]:checked/.exec(sel);
        if (!m) return null;
        const v = radios[m[1]];
        return v === undefined ? null : { value: v };
      },
      // input[name="X"] -> one fake radio per group, recording its listener so
      // a test can fire a change the way the browser would.
      querySelectorAll: (sel) => {
        const m = /input\[name="([a-z]+)"\]/.exec(sel);
        if (!m) return [];
        const name = m[1];
        return [{
          value: radios[name],
          addEventListener: (ev, fn) => { radioHandlers.push({ name, ev, fn }); },
        }];
      },
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
      circle: (ll, o2) => {
        const rec = { ll, radius: o2 && o2.radius, pane: o2 && o2.pane, kind: "circle" };
        made.circles.push(rec);
        return layerBase(rec);
      },
      layerGroup: () => {
        const rec = { kind: "group", members: [] };
        made.groups.push(rec);
        const g = layerBase(rec);
        rec.layer = g;
        return g;
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
  // The page emits CNBASE as its own <script> immediately before this one;
  // running the map script alone would test a composition no browser sees.
  vm.runInContext(scriptSource("BASEMAP_JS"), ctx, { timeout: 5000 });
  vm.runInContext(mapSource(), ctx, { timeout: 5000 });

  const state = {
    requests, card, made, tileUrls, observers, onMap, view, panes, els,
    circles: () => made.circles,
    // A circle is "shown" when it carries a visible style. The script hides by
    // restyling rather than removing, so membership of the group is not the
    // question - the stroke is.
    circlesShown: () => made.circles.filter((c) => c.style && c.style.weight > 0),
    countText: () => els.mmapCount.textContent,
    // Change the dropdown the way a person picking an option would.
    setClass: (v) => {
      els.mmClass.value = v;
      els.mmClass.listeners.forEach((fn) => fn());
    },
    // Fire the change handler the way a click on a radio would, after moving
    // the selection.
    setToggle: (name, value) => {
      radios[name] = value;
      radioHandlers.filter((h) => h.name === name && h.ev === "change")
        .forEach((h) => h.fn());
    },
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
  assert.match(s.tileUrls[s.tileUrls.length - 1], /World_Dark_Gray_/, "the basemap must swap");
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


// ---------------------------------------------------------------------------
// Ranked market areas, and the two toggles over them.
//
// The layer draws a CIRCLE per market rather than a pin, because a market is a
// place with an extent and a dot says nothing about how much ground it covers.
// Its radius is the equivalent-area one, sent down per market: pi*r^2 equals
// the metro's real land area.

// Four markets across three tiers, one of them unmeasured. Radii are the real
// equivalent-area figures for these metros, in metres.
// A read per class per market, so the dropdown can recolour every circle
// without a round trip. Phoenix reads DIFFERENTLY across classes on purpose --
// contracting for industrial, expanding for office -- which is the whole
// reason the control exists. Boise is measured for industrial only, which is
// the case that must not be confused with reading flat.
const RANK = [
  { cbsa: "40140", market: "Riverside", state: "CA", tier: "primary",
    lat: 34.0, lng: -117.0, r: 150000,
    reads: { industrial: { b: "expanding", s: 0.41 }, office: { b: "expanding", s: 0.55 } } },
  { cbsa: "38060", market: "Phoenix", state: "AZ", tier: "primary",
    lat: 33.4, lng: -112.0, r: 109000,
    reads: { industrial: { b: "contracting", s: -0.31 }, office: { b: "expanding", s: 0.30 } } },
  { cbsa: "14260", market: "Boise City", state: "ID", tier: "secondary",
    lat: 43.6, lng: -116.2, r: 62000,
    reads: { industrial: { b: "flat", s: 0.04 } } },
  // Nothing measured at all, in any class.
  { cbsa: "20580", market: "Eagle Pass", state: "TX", tier: "tertiary",
    lat: 28.7, lng: -100.5, r: 41000 },
];

test("ranked areas draw as circles, sized from each market's land area", async () => {
  const s = await runMap({ rank: RANK });
  assert.equal(s.circles().length, 4, "one circle per ranked market");
  const riverside = s.circles()[0];
  assert.equal(riverside.radius, 150000, "the radius must be the one sent, in metres");
  assert.deepEqual(riverside.ll, [34.0, -117.0]);
});

// The pins are the navigation and the keyboard surface. A translucent area
// drawn over them would swallow both.
test("circles sit in a pane below the markers", async () => {
  const s = await runMap({ rank: RANK });
  assert.ok(s.circles().every((c) => c.pane === "rankPane"),
    "every circle must be in the ranked pane");
  assert.ok(Number(s.panes.rankPane.style.zIndex) < 600,
    "the ranked pane must sit below Leaflet's markerPane (600)");
});

// THE ONE THAT MATTERS MOST HERE, and the rule the hollow pin already keeps:
// absence of a reading is not a reading of flat.
test("an unmeasured market draws a hollow ring, never flat's fill", async () => {
  const s = await runMap({ rank: RANK });
  const eagle = s.circles()[3];
  assert.equal(eagle.style.fill, false, "an unmeasured market must not be filled");
  assert.ok(eagle.style.dashArray, "and must be dashed, so it reads as absent");

  const boise = s.circles()[2];   // genuinely flat
  assert.ok(boise.style.fillOpacity > 0,
    "a market measured as flat IS filled -- the two must not look alike");
  assert.notEqual(eagle.style.color, boise.style.color,
    "and they must not share a colour either");
});

test("a measured circle opens into its ranking; an unmeasured one says why not", async () => {
  const s = await runMap({ rank: RANK, assetClass: "office" });
  const riverside = s.circles()[0].popup;
  assert.match(riverside, /Riverside, CA/);
  assert.match(riverside, /\+0\.55/, "the chosen class's score belongs in the card");
  assert.match(riverside, /Office/, "and the card must name the class it reports");
  assert.match(riverside, /\/rankings\/office\/40140/,
    "the card is the door into the ranking, for the class actually shown");

  const eagle = s.circles()[3].popup;
  assert.match(eagle, /Not measured for Office/);
  assert.ok(!/\/rankings\//.test(eagle),
    "an unmeasured market must not link to a ranking it is not in");
});

test("the tier toggle narrows to one tier and back", async () => {
  const s = await runMap({ rank: RANK });
  assert.equal(s.circlesShown().length, 4, "All must show every tier");

  s.setToggle("mmtier", "primary");
  assert.equal(s.circlesShown().length, 2, "two of these markets are primary");

  s.setToggle("mmtier", "secondary");
  assert.equal(s.circlesShown().length, 1);

  s.setToggle("mmtier", "all");
  assert.equal(s.circlesShown().length, 4, "and back");
});

// A hidden circle that still takes clicks would swallow taps meant for the
// map beneath it -- invisible and in the way is worse than visible.
test("a hidden circle stops taking clicks", async () => {
  const s = await runMap({ rank: RANK });
  s.setToggle("mmtier", "primary");
  const hidden = s.circles()[2];       // Boise, secondary
  assert.equal(hidden.style.weight, 0, "hidden means no stroke");
  assert.equal(hidden.interactive, false, "and no longer interactive");
});

test("the layer toggle switches between areas, comp coverage and both", async () => {
  const s = await runMap({ rank: RANK });
  const markerPane = s.panes.markerPane;

  // Both, the default.
  assert.equal(s.circlesShown().length, 4);
  assert.notEqual(markerPane.style.display, "none", "comp pins stay visible");

  s.setToggle("mmlayer", "areas");
  assert.equal(s.circlesShown().length, 4);
  assert.equal(markerPane.style.display, "none", "areas only hides the comp pins");

  s.setToggle("mmlayer", "points");
  assert.equal(s.circlesShown().length, 0, "comp coverage only draws no ranked areas");
  assert.notEqual(markerPane.style.display, "none");
});

// The pins are a different fact from population rank: they are the cities
// CompNinja holds comps for. Tiering them would be a claim nobody made.
test("the tier toggle does not touch the comp-coverage pins", async () => {
  const s = await runMap({ rank: RANK });
  const before = s.markersOnMap();
  s.setToggle("mmtier", "tertiary");
  assert.equal(s.markersOnMap(), before, "every comp pin must survive a tier change");
  assert.notEqual(s.panes.markerPane.style.display, "none");
});

// Circle colours are computed tokens, not CSS classes, so the theme flip has
// to repaint them -- and must not repaint a hidden tier back into view.
test("a theme flip restyles the circles without unhiding a filtered tier", async () => {
  const s = await runMap({ rank: RANK });
  s.setToggle("mmtier", "primary");
  assert.equal(s.circlesShown().length, 2);
  s.setTheme("dark");
  s.fireTheme();
  assert.equal(s.circlesShown().length, 2,
    "the hidden tier must stay hidden through a theme change");
});

// Every test written before this layer existed passes no rank data, and must
// keep exercising exactly the map it was written against.
test("with no ranked data the map behaves exactly as before", async () => {
  const s = await runMap();
  assert.equal(s.circles().length, 0, "no circles");
  assert.equal(s.markersOnMap(), 4, "and every comp pin still placed");
  assert.notEqual(s.panes.markerPane && s.panes.markerPane.style.display, "none");
});


// ---------------------------------------------------------------------------
// The asset-class dropdown.
//
// One class at a time, and that is a decision rather than a simplification.
// Multi-select was built here and taken back out (owner's call): a circle can
// only be one colour, so choosing industrial AND office needs a rule for what
// the circle then claims, and every honest answer is a worse answer -- a third
// "mixed" colour that says less than either read, or a silent pick of one
// class over the other. One class, named on the control and named in the card,
// cannot be misread.

test("the class shown is the class the control says", async () => {
  const s = await runMap({ rank: RANK, assetClass: "industrial" });
  const phoenix = s.circles()[1];          // contracting for industrial
  assert.equal(phoenix.style.color, "#f00", "industrial contracting is the red token");

  s.setClass("office");                    // expanding for office
  assert.equal(phoenix.style.color, "#0f0",
    "switching class must recolour the same market, never leave the old claim up");
});

// A market measured for one class and not another is not a market reading
// flat, and the two must not look alike.
test("a market unmeasured for the chosen class goes hollow, not grey", async () => {
  const s = await runMap({ rank: RANK, assetClass: "industrial" });
  const boise = s.circles()[2];            // flat for industrial
  assert.ok(boise.style.fillOpacity > 0, "measured as flat means filled");

  s.setClass("office");                    // Boise carries no office reading
  assert.equal(boise.style.fill, false, "unmeasured for this class means hollow");
  assert.ok(boise.style.dashArray, "and dashed, so it reads as absent");
});

test("the card names the class, so a score cannot be read against the wrong one", async () => {
  const s = await runMap({ rank: RANK, assetClass: "industrial" });
  assert.match(s.circles()[1].popup, /Industrial/);
  assert.match(s.circles()[1].popup, /\u22120\.31/);
  s.setClass("office");
  assert.match(s.circles()[1].popup, /Office/);
  assert.match(s.circles()[1].popup, /\+0\.30/);
});

// The count's second half moves with the dropdown: a market measured for
// industrial may be unmeasured for office, and the gap is the honest part.
test("the count says how many of the shown markets that class has measured", async () => {
  const s = await runMap({ rank: RANK, assetClass: "industrial" });
  assert.match(s.countText(), /4 market areas/);
  assert.match(s.countText(), /3 measured for industrial/);

  s.setClass("office");
  assert.match(s.countText(), /2 measured for office/,
    "only Riverside and Phoenix carry an office reading");
});

// Three independent controls, and a combination must not lose one of them --
// that is the whole reason they are separate controls.
test("class, tier and layer compose", async () => {
  const s = await runMap({ rank: RANK, assetClass: "office" });
  s.setToggle("mmtier", "primary");
  assert.equal(s.circlesShown().length, 2, "tier still filters");
  assert.equal(s.circles()[1].style.color, "#0f0", "and the class still colours");

  s.setToggle("mmlayer", "points");
  assert.equal(s.circlesShown().length, 0, "and the layer toggle still hides them");
});

// market-area.js answers a DIFFERENT question -- one city shape holding
// several markets -- and a second, subtly different copy of its agreement rule
// is how two surfaces start disagreeing about the same metro. Single-select
// means this layer never needs one.
test("the ranked layer holds no second copy of the agreement rule", () => {
  const src = mapSource();
  assert.ok(!/agreeBand/.test(src), "no agreement fold belongs in the ranked layer");
});
