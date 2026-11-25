// Home's map heals its own holes (2026-11-25). The owner, with two pictures
// from an iPhone: on a first load the map strip showed one or two tiles and
// the paper colour everywhere else. A tile Leaflet asks for once and never
// gets stays blank until somebody drags the map. These RUN hmHealing and
// hmHealTiles from index.html against stand-ins for Leaflet and the page,
// and pin the wiring that calls them.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const fnOf = (sig) => {
  const at = html.indexOf(sig);
  assert.ok(at > 0, `index.html must define ${sig}`);
  return html.slice(at, html.indexOf("\n  }\n", at) + 4);
};

function harness() {
  const timers = [];
  const ctx = {
    HM_HEAL_MS: 2500, HM_TILE_RETRIES: 2, HM_HEAL_ROUNDS: 3,
    hmHealTimer: null, hmHealRound: 0, hmMap: null, hmBaseLayers: null,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    document: { visibilityState: "visible" },
  };
  const src = [fnOf("function hmHealing("), fnOf("function hmHealSoon("), fnOf("function hmHealTiles(")].join("\n");
  const api = new Function("ctx", `with (ctx) { ${src}; return { hmHealing, hmHealSoon, hmHealTiles }; }`)(ctx);
  return { ctx, api, timers };
}

const rect = (l, t, w, h) => ({ left: l, top: t, right: l + w, bottom: t + h });

test("a tile whose request fails is asked for again, twice, then left alone", () => {
  const { api, timers } = harness();
  const handlers = {};
  const layer = { on: (n, fn) => { handlers[n] = fn; }, getTileUrl: (c) => `https://t/tile/${c.z}/${c.y}/${c.x}` };
  assert.equal(api.hmHealing(layer), layer);
  const img = { isConnected: true, src: "" };
  for (let i = 0; i < 3; i++) handlers.tileerror({ tile: img, coords: { z: 3, y: 2, x: 1 } });
  assert.equal(timers.length, 2, "a failed tile is retried twice and no more");
  timers.forEach((t) => t.fn());
  assert.equal(img.src, "https://t/tile/3/2/1?r=2", "the retry is a fresh request for the same tile");
});

test("once the map settles, an unfinished tile in view is asked for again and the view is filled", () => {
  const { ctx, api, timers } = harness();
  const imgs = [
    { complete: true, naturalWidth: 256, rect: rect(0, 0, 256, 256), src: "https://t/a" },          // fine
    { complete: true, naturalWidth: 0, rect: rect(256, 0, 256, 256), src: "https://t/b?r=h12" },    // a hole
    { complete: false, naturalWidth: 0, rect: rect(900, 0, 256, 256), src: "https://t/c" },         // out of view
  ].map((i) => Object.assign(i, { getBoundingClientRect: () => i.rect, getAttribute: () => i.src }));
  let invalidated = 0, filled = 0;
  const container = { offsetWidth: 390, offsetHeight: 300, getBoundingClientRect: () => rect(0, 0, 390, 300),
    querySelectorAll: () => imgs };
  ctx.hmMap = { getContainer: () => container, invalidateSize: () => { invalidated++; } };
  const tl = { _map: ctx.hmMap, _update: () => { filled++; } };
  ctx.hmBaseLayers = { eachLayer: (fn) => [tl, tl].forEach(fn) };
  api.hmHealTiles();
  assert.equal(invalidated, 1, "the map re-reads its size first");
  assert.equal(filled, 2, "each tile layer is told to fill the view");
  assert.equal(imgs[0].src, "https://t/a", "a finished tile is left alone");
  assert.match(imgs[1].src, /^https:\/\/t\/b\?r=h\d+$/, "the hole is asked for again, without piling up markers");
  assert.equal(imgs[2].src, "https://t/c", "a tile out of view is left alone");
  // It looks again while holes stay, but not forever.
  for (let i = 0; i < 10 && timers.length > i; i++) timers[i].fn();
  assert.equal(timers.length, 2, "at most three looks in a row");
});

test("a hidden page or an unlaid map is not touched", () => {
  const { ctx, api } = harness();
  let n = 0;
  ctx.hmMap = { getContainer: () => ({ offsetWidth: 0, offsetHeight: 0 }), invalidateSize: () => { n++; } };
  ctx.hmBaseLayers = { eachLayer: () => { n++; } };
  api.hmHealTiles();
  ctx.document.visibilityState = "hidden";
  ctx.hmMap.getContainer = () => { throw new Error("read while hidden"); };
  api.hmHealTiles();
  assert.equal(n, 0);
});

test("both basemap layers heal, and the map looks again whenever it settles or is shown", () => {
  const base = fnOf("function hmBasemap(");
  assert.equal((base.match(/hmHealing\(L\.tileLayer\(/g) || []).length, 2, "every tile layer of Home's basemap is wrapped");
  const ensure = fnOf("function hmEnsureMap(");
  assert.match(ensure, /hmMap\.on\("moveend", hmHealSoon\)/);
  assert.match(ensure, /addEventListener\("pageshow"/);
  assert.match(ensure, /addEventListener\("visibilitychange"/);
  // Declared with Home's other map state, ahead of every function the boot
  // path calls (a const below them is a temporal dead zone throw).
  const decl = html.indexOf("const HM_HEAL_MS");
  assert.ok(decl > 0 && decl < html.indexOf("function hmEnsureMap("));
});
