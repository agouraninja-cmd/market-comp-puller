// Swiping a page on a phone (2026-11-18, the owner: "When swiping up and down
// on mobile it looks like it freezes for a split second or glitches").
//
// Two causes were measured in Playwright with iPhone 13 emulation and fixed:
//
//   1. A swipe that STARTED on a map moved the page 0px. Leaflet with dragging
//      on makes its container touch-action: none, and Home's map is the top
//      45% of a phone screen. touchPanMap (index.html) and its mirror
//      CNBASE.touchPan (server.js's BASEMAP_JS) turn dragging off on a
//      touch-only screen while the page around the map scrolls, so one finger
//      scrolls the page and two move the map (Leaflet's pinch).
//   2. The report's printable map raster (drawStaticMap) stitched and encoded
//      a 2000x920 canvas in the last tile's load event, a 470ms task in the
//      middle of a swipe at a phone's CPU. It now waits for the page to be
//      still, decodes tiles off the main thread and encodes with toBlob.
//
// The bodies are run here against stand-ins, and the two copies of the touch
// helper are held to one text.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const SERVER = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const VAULT = fs.readFileSync(path.join(ROOT, "vault-page.js"), "utf8");
const PERMITS = fs.readFileSync(path.join(ROOT, "permits-page.js"), "utf8");

function constSource(name) {
  const open = "const " + name + " = `";
  const i = SERVER.indexOf(open);
  assert.notEqual(i, -1, name + " is gone or renamed");
  const start = i + open.length;
  return SERVER.slice(start, SERVER.indexOf("`;", start));
}

// The text between a function's opening brace and its matching close.
function bodyOf(src, signature) {
  const at = src.indexOf(signature);
  assert.notEqual(at, -1, signature + " is gone or renamed");
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error("unbalanced " + signature);
}

test("the two touch helpers are one text", () => {
  const app = bodyOf(HTML, "function touchPanMap(map, scrolls)");
  const shared = bodyOf(constSource("BASEMAP_JS"), "function touchPan(map, scrolls)");
  assert.equal(app, shared, "index.html's touchPanMap and CNBASE.touchPan have drifted: change both");
  assert.match(constSource("BASEMAP_JS"), /return \{ add: add, isDark: isDark, touchPan: touchPan \};/);
});

// A stand-in Leaflet map and container, and a window whose matchMedia answers
// the touch-only question as asked.
function setup({ coarse = true } = {}) {
  const listeners = {};
  const classes = new Set(["leaflet-container", "leaflet-touch-zoom", "leaflet-touch-drag"]);
  const children = [];
  const el = {
    classList: { contains: (c) => classes.has(c) },
    addEventListener(type, fn, opts) {
      (listeners[type] = listeners[type] || []).push({ fn, opts });
    },
    appendChild(c) { children.push(c); },
  };
  const calls = [];
  const map = {
    getContainer: () => el,
    dragging: {
      disable() { calls.push("disable"); classes.delete("leaflet-touch-drag"); },
      enable() { calls.push("enable"); classes.add("leaflet-touch-drag"); },
    },
  };
  const timers = [];
  const ctx = {
    window: { matchMedia: (q) => ({ matches: coarse && q === "(hover: none) and (pointer: coarse)" }) },
    document: {
      createElement: () => ({ style: {}, setAttribute() {}, textContent: "", offsetWidth: 0 }),
    },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(constSource("BASEMAP_JS"), ctx);
  const touch = (type, pts) => (listeners[type] || []).forEach((l) => l.fn({ touches: pts.map(([x, y]) => ({ clientX: x, clientY: y })) }));
  return { ctx, map, el, calls, listeners, children, timers, touch, CNBASE: vm.runInContext("CNBASE", ctx) };
}

test("on a touch-only screen one finger scrolls the page past a map", () => {
  const s = setup();
  const sync = s.CNBASE.touchPan(s.map);
  assert.deepEqual(s.calls, ["disable"], "dragging is turned off, so the container is touch-action: pan-x pan-y");
  assert.equal(typeof sync, "function");
  for (const type of ["touchstart", "touchmove"]) {
    assert.equal(s.listeners[type].length, 1);
    assert.equal(s.listeners[type][0].opts.passive, true, "a passive listener never holds a scroll up");
  }
});

test("a mouse keeps dragging the map, whatever the window's width", () => {
  const s = setup({ coarse: false });
  const sync = s.CNBASE.touchPan(s.map);
  assert.deepEqual(s.calls, [], "nothing changes for a mouse or a laptop's touch screen");
  assert.equal(s.listeners.touchstart, undefined);
  sync();
  assert.deepEqual(s.calls, []);
});

test("where the map is the page, one finger drags it again", () => {
  const s = setup();
  let scrolls = true;
  const sync = s.CNBASE.touchPan(s.map, () => scrolls);
  scrolls = false; sync();
  scrolls = true; sync();
  assert.deepEqual(s.calls, ["disable", "enable", "disable"]);
});

test("a map built again on the same element does not stack its listeners", () => {
  const s = setup();
  s.CNBASE.touchPan(s.map);
  s.CNBASE.touchPan(s.map);
  assert.equal(s.listeners.touchstart.length, 1);
  assert.equal(s.listeners.touchmove.length, 1);
});

test("a sideways one-finger drag on the map says how to move it; a swipe up does not", () => {
  const s = setup();
  s.CNBASE.touchPan(s.map);
  s.touch("touchstart", [[100, 100]]);
  s.touch("touchmove", [[104, 160]]);
  assert.equal(s.children.length, 0, "a swipe up the page is scrolling, not a question");
  s.touch("touchmove", [[160, 104]]);
  assert.equal(s.children.length, 1);
  assert.equal(s.el.cnTip.textContent, "Use two fingers to move the map");
  assert.equal(s.el.cnTip.style.opacity, ".88");
  assert.match(s.el.cnTip.style.cssText, /background:var\(--slab\);color:#ffffff/, "white on --slab, dark in both themes");
  assert.match(s.el.cnTip.style.cssText, /pointer-events:none/, "the hint never takes a tap");
  s.timers.forEach((fn) => fn());
  assert.equal(s.el.cnTip.style.opacity, "0", "and it goes away by itself");
  // A second finger puts it away at once; dragging on means no hint at all.
  s.touch("touchstart", [[100, 100]]);
  s.touch("touchmove", [[160, 100]]);
  s.touch("touchstart", [[100, 100], [140, 100]]);
  assert.equal(s.el.cnTip.style.opacity, "0");
  s.map.dragging.enable();
  s.el.cnTip.style.opacity = "0";
  s.touch("touchstart", [[100, 100]]);
  s.touch("touchmove", [[180, 100]]);
  assert.equal(s.el.cnTip.style.opacity, "0", "a map that drags with one finger needs no hint");
});

test("every map that sits in a scrolling page takes the touch rule", () => {
  // The report's map, fullscreen giving it back its one-finger drag.
  assert.match(HTML, /mapInstance = L\.map\("compMap"[^\n]*\n[^\n]*\n[^\n]*\n\s*const syncMapTouch = touchPanMap\(mapInstance, \(\) => !document\.getElementById\("compMap"\)\.classList\.contains\("map-fullscreen"\)\);/);
  const fs = HTML.match(/const setMapFullscreen = \(on\) => \{[\s\S]*?\n    \};/);
  assert.ok(fs, "setMapFullscreen is gone or renamed");
  assert.match(fs[0], /syncMapTouch\(\);/, "going fullscreen must hand one-finger drag back to the map");
  // The address dialog's map.
  assert.match(HTML, /confirmMapInstance = L\.map\("confirmMap"[^\n]*\n[^\n]*\n\s*touchPanMap\(confirmMapInstance\);/);
  // Home's map: a strip in a scrolling page below 900px, its own pane beside the rail.
  const ensure = HTML.match(/function hmEnsureMap\(\) \{[\s\S]*?\n  \}/);
  assert.ok(ensure, "hmEnsureMap is gone or renamed");
  assert.match(ensure[0], /touchPanMap\(hmMap, \(\) => !\(document\.documentElement\.classList\.contains\("nav-rail"\) && window\.matchMedia\("\(min-width: 900px\)"\)\.matches\)\)/);
  assert.match(ensure[0], /window\.matchMedia\("\(min-width: 900px\)"\)\.addEventListener\("change", hmTouch\)/);
  // The server-rendered maps, through CNBASE.
  assert.match(constSource("MARKET_MAP_JS"), /tiles = CNBASE\.add\(map\);\n[^\n]*\n\s*CNBASE\.touchPan\(map\);/);
  assert.match(constSource("MARKETS_DIR_MAP_JS"), /var tiles = CNBASE\.add\(map\);\n[^\n]*\n\s*CNBASE\.touchPan\(map\);/);
  assert.match(VAULT, /window\.CNBASE\.add\(bmMap\);\n[^\n]*\n\s*if\(window\.CNBASE\.touchPan\)window\.CNBASE\.touchPan\(bmMap\);/);
  assert.match(PERMITS, /if\(window\.CNBASE\)CNBASE\.add\(map\);\n[^\n]*\n\s*if\(window\.CNBASE&&CNBASE\.touchPan\)CNBASE\.touchPan\(map\);/);
});

// ---------------------------------------------------------------------------
// The printable map raster.
// ---------------------------------------------------------------------------
function staticMapHelpers({ now = 0 } = {}) {
  const src = HTML.slice(HTML.indexOf("  const SMAP_STILL_MS = 300;"), HTML.indexOf("  function smapTile(url, deadline)"));
  assert.ok(src.includes("function smapWhenStill()") && src.includes("function smapEncode(canvas)"));
  const timers = [];
  const ctx = {
    clock: now,
    performance: { now: () => ctx.clock },
    window: { addEventListener: (type, fn) => { if (type === "scroll") ctx.onScroll = fn; } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); },
    FileReader: function () {
      this.readAsDataURL = (blob) => { this.result = "data:" + blob.type + ";base64,AAAA"; this.onload(); };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src + "\nthis.smapWhenStill = smapWhenStill; this.smapEncode = smapEncode;", ctx);
  return { ctx, timers };
}

test("the raster waits for the page to be still before the canvas work", async () => {
  const { ctx, timers } = staticMapHelpers({ now: 10000 });
  let done = false;
  ctx.onScroll();                       // a swipe, just now
  ctx.smapWhenStill().then(() => { done = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(done, false, "nothing is drawn while the page is moving");
  assert.equal(timers.length, 1);
  ctx.clock += 320;
  timers.shift().fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(done, true, "and it goes ahead once the page has been still for 300ms");
  // An export button is pressed on a page that is not moving: no wait at all.
  let now = false;
  ctx.clock += 5000;
  await ctx.smapWhenStill().then(() => { now = true; });
  assert.equal(now, true);
});

test("the raster is encoded with toBlob and is still a data URI", async () => {
  const { ctx } = staticMapHelpers();
  let asked;
  const canvas = { toBlob: (cb, type, q) => { asked = [type, q]; cb({ type: "image/webp" }); }, toDataURL: () => { throw new Error("toDataURL holds the main thread for the whole encode"); } };
  assert.equal(await ctx.smapEncode(canvas), "data:image/webp;base64,AAAA");
  assert.deepEqual(asked, ["image/webp", 0.92]);
  // An engine that cannot write WebP answers PNG, and that is what is kept.
  const png = { toBlob: (cb) => cb({ type: "image/png" }) };
  assert.equal(await ctx.smapEncode(png), "data:image/png;base64,AAAA");
  // No toBlob at all: the old path, with its PNG fallback.
  const old = { toDataURL: (t) => (t === "image/webp" ? "data:image/png;base64,BBBB" : "data:image/png;base64,CCCC") };
  assert.equal(await ctx.smapEncode(old), "data:image/png;base64,CCCC");
});

test("drawStaticMap waits, then draws decoded tiles, then encodes off the main thread", () => {
  const fn = HTML.match(/async function drawStaticMap\(pts\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fn, "drawStaticMap is gone or renamed");
  const wait = fn[0].indexOf("await smapWhenStill();");
  const canvas = fn[0].indexOf('document.createElement("canvas")');
  assert.ok(wait !== -1 && wait < canvas, "the still-wait must come before any canvas work");
  assert.match(fn[0], /return smapEncode\(canvas\);/);
  assert.doesNotMatch(fn[0], /toDataURL/, "a synchronous encode is the 470ms freeze this replaced");
  const tile = HTML.match(/function smapTile\(url, deadline\)[\s\S]*?\n  \}/);
  assert.match(tile[0], /img\.decode\(\)\.then\(\(\) => finish\(img\), \(\) => finish\(img\)\)/,
    "a tile that cannot decode early is still drawn");
});
