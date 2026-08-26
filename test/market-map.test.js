// The market pages' comp map, as it actually runs in a visitor's browser.
//
// MARKET_MAP_JS is ~90 lines of browser JavaScript living inside a template
// literal in server.js, and until this file nothing executed it. That is the
// same gap test/vault-page.test.js and test/index-html.test.js were written
// to close, and it hid a real fault for two weeks: the map cached its
// geocodes under `geoCache.v1`, the key index.html abandoned on 2026-08-04
// when it moved to `geoCache.v2` to retire wrong-street entries. The app
// retired them; this script kept reading them, so a returning visitor's stale
// coordinates went on placing pins — or, once the ~100-mile sanity gate threw
// the bad point out, hid the map card entirely on a page whose comps were
// all perfectly geocodable.
//
// The script is extracted and run in a vm with a fake localStorage, a fake
// Leaflet and a stub fetch, which is enough to observe the only two things
// worth asserting from outside: which storage keys it touches, and whether a
// pin survives to the map.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

function marketMapSource() {
  const open = "const MARKET_MAP_JS = `";
  const i = SERVER.indexOf(open);
  assert.notEqual(i, -1, "MARKET_MAP_JS is gone or renamed — this file exercises it by name");
  const start = i + open.length;
  return SERVER.slice(start, SERVER.indexOf("`;", start));
}

// Runs the map script against one comp and returns what it touched. `seed` is
// the localStorage the visitor arrives with.
function runMap(seed, opts) {
  const o = opts || {};
  const store = Object.assign({}, seed);
  const pins = [];
  const requests = [];
  const card = { style: {} };
  const shapes = [];
  const fits = [];
  const head = { textContent: "Where these comps are", style: {} };
  const pinsDisc = { textContent: "Pins are geocoded…", style: {} };
  const els = {
    mktMapData: { textContent: JSON.stringify({
      city: "Boise, ID",
      comps: o.comps === undefined
        ? [{ a: "9 Example St, Boise, ID", d: "2026-01", t: "Sale", pr: "$1M" }]
        : o.comps,
      ...(o.dir ? { dir: o.dir } : {}),
      ...(o.boundary ? { boundary: o.boundary } : {}),
    }) },
    mktMapCard: card,
    mktMapHead: head,
    mktMapPinsDisc: pinsDisc,
  };
  const mapObj = { setView() { return this; }, fitBounds(b) { fits.push(b); } };
  const tileUrls = [];
  const observers = [];
  // Mutable, because the theme toggle fires AFTER the page has loaded and the
  // point of the observer is to notice that.
  let theme = o.theme || null;
  const ctx = {
    // documentElement carries the theme: the basemap follows it, so a stub
    // without one both crashes the script and would silently test only the
    // light path. `theme` defaults to light, matching a visitor with no
    // preference stored.
    document: {
      getElementById: (id) => els[id] || { style: {}, textContent: "{}" },
      documentElement: { getAttribute: (k) => (k === "data-theme" ? theme : null) },
    },
    MutationObserver: function (fn) { observers.push(fn); this.observe = () => {}; },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
    },
    L: {
      map: () => mapObj,
      // addTo returns the layer, as real Leaflet's does; a stub that returned
      // undefined would pass code that cannot work in a browser.
      tileLayer: (url) => {
        tileUrls.push(url);
        const layer = { setUrl: (u) => { tileUrls.push(u); return layer; } };
        layer.addTo = () => layer;
        return layer;
      },
      marker: (ll) => ({ addTo: () => ({ bindPopup: () => { pins.push(ll); } }) }),
      geoJSON: (geometry, o2) => {
        const rec = { geometry, style: o2.style, added: false };
        shapes.push(rec);
        const bounds = {
          _bounds: true,
          getCenter: () => [43.6, -116.2],
          extend(ll) { rec.extended = (rec.extended || 0) + 1; return bounds; },
        };
        const layer = {
          addTo() { rec.added = true; return layer; },
          getBounds: () => {
            // Real Leaflet throws "Bounds are not valid" here for a shape
            // with no coordinates — the degenerate-geometry canary.
            if (geometry && Array.isArray(geometry.coordinates) && !geometry.coordinates.length) {
              throw new Error("Bounds are not valid.");
            }
            return bounds;
          },
          setStyle(s) { rec.style = s; return layer; },
        };
        return layer;
      },
    },
    // tok() reads theme tokens off :root; the real values do not matter, only
    // that a colour arrives and that a theme flip produces a different one.
    getComputedStyle: () => ({
      getPropertyValue: (n) => ({
        "--green": theme === "dark" ? "#34D399" : "#15803D",
        "--red-fill": theme === "dark" ? "#DC2626" : "#B91C1C",
        "--ink-mute": "#5B6472", "--ink-3": "#64748B",
      }[n] || ""),
    }),
    fetch: (url, init) => {
      requests.push({ url: String(url), method: (init && init.method) || "GET", body: init && init.body });
      return Promise.resolve({ json: () => Promise.resolve(
        o.answer || { lat: 43.61, lng: -116.20, matchedAddress: "9 Example St" }
      ) });
    },
    console, setTimeout, clearTimeout, Promise, JSON, Math,
    String, Object, Array, isFinite, parseFloat, Error,
  };
  if (o.noLeaflet) delete ctx.L;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(marketMapSource(), ctx, { timeout: 5000 });
  // The script geocodes the city then chains the comps, all through resolved
  // promises here, so a macrotask tick is enough for it to settle.
  // 50ms settles the ordinary path (resolved promises all the way down). A
  // run whose geocodes all MISS falls through to the Nominatim fallback,
  // which paces itself 1.1s apart on purpose, so those tests ask for longer.
  return new Promise((resolve) => setTimeout(
    () => resolve({
      store, pins, requests, card, tileUrls, observers, shapes, fits, head, pinsDisc,
      setTheme: (t) => { theme = t; },
    }), o.settle || 50
  ));
}

// The basemap was pinned to CARTO's light_all, so a dark market page rendered
// a white rectangle in the middle of it. It follows the theme now.
test("the market map's basemap follows the theme", async (t) => {
  await t.test("a light visitor gets the light basemap", async () => {
    const { tileUrls } = await runMap({});
    assert.equal(tileUrls.length, 1);
    assert.match(tileUrls[0], /light_all/);
  });

  await t.test("a dark visitor gets the dark basemap", async () => {
    const { tileUrls } = await runMap({}, { theme: "dark" });
    assert.equal(tileUrls.length, 1);
    assert.match(tileUrls[0], /dark_all/);
  });

  // The toggle lives in the shared header and can fire long after the pins
  // are placed, so the layer's URL is swapped rather than the layer rebuilt —
  // re-adding it would drop every pin already on the map.
  await t.test("a theme change swaps the URL without rebuilding the layer", async () => {
    const { tileUrls, observers, pins, setTheme } = await runMap({});
    assert.equal(observers.length, 1, "the map must watch for a theme change");
    const pinsBefore = pins.length;
    setTheme("dark");
    observers[0]();
    assert.equal(tileUrls.length, 2, "expected a setUrl, not a second tileLayer");
    assert.match(tileUrls[1], /dark_all/);
    assert.equal(pins.length, pinsBefore, "pins must survive a theme change");
  });
});

// The city's carved boundary, washed in the market's momentum — the same read
// the badge above the map states. It rides in the page's own blob (this page
// needs one city's shape, not the whole 107KB file), so it needs no geocoding
// and no fetch, and a page without one must behave exactly as it did before
// boundaries existed.
const SQUARE = { type: "Polygon", coordinates: [[[-116.3, 43.5], [-116.1, 43.5], [-116.1, 43.7], [-116.3, 43.7], [-116.3, 43.5]]] };
// Parses as GeoJSON, draws as nothing: real Leaflet throws "Bounds are not
// valid" the first time anything asks where it is.
const DEGENERATE = { type: "Polygon", coordinates: [] };

test("the market map draws its city's carved boundary", async (t) => {
  await t.test("a page with no boundary touches no geometry at all", async () => {
    const { shapes } = await runMap({});
    assert.equal(shapes.length, 0,
      "a market page with no stored boundary must render exactly as it did before this existed");
  });

  await t.test("a read market is shaded in its momentum colour", async () => {
    const { shapes } = await runMap({}, { boundary: SQUARE, dir: "contracting" });
    assert.equal(shapes.length, 1, "the boundary must be drawn");
    assert.equal(shapes[0].added, true, "and actually added to the map");
    assert.equal(shapes[0].style.fillColor, "#B91C1C", "a contracting market takes the red token");
    assert.ok(shapes[0].style.fillOpacity > 0.1, "a read market is SHADED, not merely outlined");
    assert.equal(shapes[0].style.dashArray, undefined, "and its edge is solid");
  });

  await t.test("an unread market is outlined, never shaded — the wash is a claim", async () => {
    const { shapes } = await runMap({}, { boundary: SQUARE });
    assert.equal(shapes.length, 1);
    assert.equal(shapes[0].style.dashArray, "4 4", "no momentum read means a dashed outline");
    assert.ok(shapes[0].style.fillOpacity < 0.1,
      "an unread market must not be shaded — there is nothing to claim");
  });

  // The old rule was "no pins, no map card". A market whose comps are all
  // quoted at the submarket level then got no map at all, which said nothing
  // about where the market even is.
  await t.test("a boundary alone keeps the map card", async () => {
    const { card, shapes } = await runMap({}, { boundary: SQUARE, dir: "expanding", comps: [] });
    assert.equal(shapes.length, 1);
    assert.notEqual(card.style.display, "none",
      "a card with a real boundary on it must not hide itself for want of pins");
  });

  await t.test("with neither pins nor boundary the card still hides", async () => {
    const { card } = await runMap({}, { comps: [] });
    assert.equal(card.style.display, "none");
  });

  // A comp just outside the city limit is ordinary, and fitting the pins
  // alone would crop the shape the card is describing.
  await t.test("the view holds the boundary and the pins together", async () => {
    const { shapes, fits } = await runMap({}, { boundary: SQUARE, dir: "flat" });
    assert.ok(fits.length >= 2, "expected a fit for the boundary and again once a pin arrived");
    assert.ok(shapes[0].extended >= 1, "the pin must EXTEND the boundary's bounds, not replace them");
  });

  await t.test("a theme change restyles the boundary, not just the tiles", async () => {
    const { shapes, observers, setTheme, tileUrls } = await runMap({}, { boundary: SQUARE, dir: "expanding" });
    const before = shapes[0].style.fillColor;
    setTheme("dark");
    observers[0]();
    assert.match(tileUrls[tileUrls.length - 1], /dark_all/, "the basemap must swap");
    assert.notEqual(shapes[0].style.fillColor, before,
      "the boundary holds a computed colour, so a theme flip must restyle it explicitly");
  });

  // The pre-ship review's findings, pinned so they stay fixed.
  await t.test("a boundary-only page makes no geocoder calls at all", async () => {
    const { requests, card } = await runMap({}, { boundary: SQUARE, dir: "expanding", comps: [] });
    assert.deepEqual(requests, [],
      "a page with zero comps paid a geocode round trip to sanity-gate zero pins");
    assert.notEqual(card.style.display, "none");
  });

  await t.test("with Leaflet blocked, the card hides instead of standing empty", async () => {
    const { card, shapes } = await runMap({}, { boundary: SQUARE, dir: "expanding", comps: [], noLeaflet: true });
    assert.equal(card.style.display, "none",
      "an ad-blocked CDN must not leave a permanent empty rectangle on a boundary-only page");
    assert.equal(shapes.length, 0);
  });

  await t.test("a degenerate stored geometry costs the shape, never the pins", async () => {
    const { pins, shapes, card } = await runMap({}, { boundary: DEGENERATE, dir: "contracting" });
    assert.equal(shapes.length && shapes[0].added, false, "the broken shape must not reach the map");
    assert.equal(pins.length, 1,
      "comp pins always drew before boundaries existed and must keep drawing whatever the file holds");
    assert.notEqual(card.style.display, "none");
  });

  await t.test("when every comp fails to geocode, the card retracts its pins copy", async () => {
    // The server wrote "Where these comps are" and the pins sentence
    // believing the comps would pin; if none survive geocoding and the card
    // stands on its boundary, both must be retracted — copy asserting pins
    // over a map that has none is a false statement.
    const { pins, head, pinsDisc, card } = await runMap({}, {
      boundary: SQUARE, dir: "flat", answer: {}, settle: 1400,
    });
    assert.equal(pins.length, 0, "the fixture's geocoder answers junk, so no pin should place");
    assert.notEqual(card.style.display, "none", "the boundary keeps the card standing");
    assert.equal(head.textContent, "Where this market is", "the heading must stop claiming comps");
    assert.equal(pinsDisc.style.display, "none", "the pins sentence must be retracted");
  });
});

const APP_KEY = "geoCache.v2";
const LEGACY_KEY = "geoCache.v1";

test("the market map caches in its own store, never the app's", async (t) => {
  await t.test("it writes only its own key", async () => {
    const { store } = await runMap({});
    const written = Object.keys(store);
    assert.deepEqual(written, ["mktGeoCache.v1"],
      "the market map wrote " + JSON.stringify(written) + " — it owns exactly one store");
  });

  await t.test("an app cache entry is neither read nor overwritten", async () => {
    const app = { "9 example st, boise, id": { lat: 43.6, lng: -116.2, label: "9 Example St" } };
    const { store, requests } = await runMap({ [APP_KEY]: JSON.stringify(app) });

    assert.deepEqual(JSON.parse(store[APP_KEY]), app,
      "the app's store was modified — a label-less entry written here fails geoLabelMatches "
        + "in index.html, which costs that address its subject photo and footprint size");
    assert.equal(requests.length, 2,
      "the map should geocode the city and the comp itself rather than reading the app's hits");
  });

  // The fault this file was written for. A browser that used the app before
  // 2026-08-04 still holds geoCache.v1, including the wrong-street entries
  // that the v2 bump existed to retire.
  await t.test("a retired v1 entry cannot place — or suppress — a pin", async () => {
    const poisoned = { "9 example st, boise, id": { lat: 99, lng: 99 } };
    const { pins, card, requests } = await runMap({ [LEGACY_KEY]: JSON.stringify(poisoned) });

    assert.equal(requests.length, 2, "the retired entry was read instead of re-geocoded");
    assert.equal(pins.length, 1, "the comp lost its pin to a cache entry the app retired");
    assert.notEqual(card.style.display, "none",
      "the whole map card hid because a stale coordinate failed the distance gate");
  });
});

// Not about caching, but this script is now executable and the check is free:
// the address must not reappear in a URL here, the way it did before
// 2026-08-17. The source scan in routes.test.js asserts the same thing
// statically; this one watches the call actually go out.
test("the market map sends addresses in a POST body, not a query string", async () => {
  const { requests } = await runMap({});
  const ours = requests.filter((r) => r.url.startsWith("/api/geocode"));
  assert.equal(ours.length, 2);
  for (const r of ours) {
    assert.equal(r.method, "POST", "the geocode call left as a " + r.method);
    assert.ok(!r.url.includes("?"), "the address rode in the URL: " + r.url);
    assert.match(String(r.body), /"address":/);
  }
});
