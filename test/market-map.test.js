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
  const els = {
    mktMapData: { textContent: JSON.stringify({
      city: "Boise, ID",
      comps: [{ a: "9 Example St, Boise, ID", d: "2026-01", t: "Sale", pr: "$1M" }],
    }) },
    mktMapCard: card,
  };
  const mapObj = { setView() { return this; }, fitBounds() {} };
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
    },
    fetch: (url, init) => {
      requests.push({ url: String(url), method: (init && init.method) || "GET", body: init && init.body });
      return Promise.resolve({ json: () => Promise.resolve(
        o.answer || { lat: 43.61, lng: -116.20, matchedAddress: "9 Example St" }
      ) });
    },
    console, setTimeout, clearTimeout, Promise, JSON, Math,
    String, Object, Array, isFinite, parseFloat, Error,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(marketMapSource(), ctx, { timeout: 5000 });
  // The script geocodes the city then chains the comps, all through resolved
  // promises here, so a macrotask tick is enough for it to settle.
  return new Promise((resolve) => setTimeout(
    () => resolve({
      store, pins, requests, card, tileUrls, observers,
      setTheme: (t) => { theme = t; },
    }), 50
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
