// Swiping a page on a phone (2026-11-18, the owner: "When swiping up and down
// on mobile it looks like it freezes for a split second or glitches").
//
// Two causes were measured in Playwright with iPhone 13 emulation:
//
//   1. A swipe that STARTED on a map moved the page 0px. A helper
//      (touchPanMap / CNBASE.touchPan) turned dragging off on phones so one
//      finger scrolled the page and two moved the map. REMOVED 2026-11-20,
//      the owner's call: "remove the feature that makes it so you have to use
//      two fingers on the map ... you can move up right left or down with one
//      finger as well just not zoom". Every map keeps Leaflet's defaults now:
//      one finger pans, two fingers pinch to zoom (and pan).
//   2. The report's printable map raster (drawStaticMap) stitched and encoded
//      a 2000x920 canvas in the last tile's load event, a 470ms task in the
//      middle of a swipe at a phone's CPU. It now waits for the page to be
//      still, decodes tiles off the main thread and encodes with toBlob.

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

test("one finger moves every map on a phone (no two-finger rule)", () => {
  for (const [name, src] of [["index.html", HTML], ["server.js", SERVER], ["vault-page.js", VAULT], ["permits-page.js", PERMITS]]) {
    assert.doesNotMatch(src, /touchPan/, name + " still carries the two-finger touch helper");
    assert.doesNotMatch(src, /Use two fingers to move the map/, name + " still tells people to use two fingers");
  }
  assert.match(constSource("BASEMAP_JS"), /return \{ add: add, isDark: isDark \};/);
  // The maps that sit in a scrolling page keep Leaflet's dragging on.
  assert.doesNotMatch(HTML, /L\.map\("(compMap|confirmMap)"[^\n]*dragging:\s*false/);
  assert.doesNotMatch(HTML, /hmMap = L\.map\([^\n]*dragging:\s*false/);
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

// ---------------------------------------------------------------------------
// The report's jump bar and Safari's toolbar (2026-11-20, the owner: "When
// swiping up on mobile in CompNinja it still glitches"). On an iPhone a swipe
// slides the address bar away, which fires one resize per frame; the bar was
// torn down and rebuilt on each (27 times in one swipe up and down, measured
// by imitating the toolbar in Chromium), flashing it and throwing its
// sideways scroll back to the first link.
// ---------------------------------------------------------------------------
function reportNavHarness() {
  const start = HTML.indexOf("  const REPORT_NAV_MIN_SCREENS = 2;");
  const end = HTML.indexOf("  // Bring one report card to the top of the screen.");
  assert.ok(start !== -1 && end > start, "syncReportNav moved or was renamed");
  const listeners = HTML.slice(HTML.indexOf("  const REPORT_NAV_RESIZE_SETTLE_MS"), HTML.indexOf("  function setReportTab(which)"));
  assert.ok(listeners.includes('window.addEventListener("resize"'), "the jump bar's resize listener moved");
  const els = {};
  const mk = (id) => (els[id] = {
    id, hidden: false, offsetParent: {}, offsetHeight: 40, children: [], builds: 0,
    classList: { add: (c) => { if (c === "hidden") els[id].hidden = true; }, remove: (c) => { if (c === "hidden") els[id].hidden = false; }, contains: (c) => c === "hidden" && els[id].hidden },
    getBoundingClientRect: () => ({ top: 0, height: 5000 }),
    appendChild(ch) { this.children.push(ch); },
    set innerHTML(v) { this.children = []; this.builds++; },
  });
  ["reportNav", "reportNavInner", "results"].forEach(mk);
  const timers = [];
  const ctx = {
    els, timers, resize: null,
    window: { innerWidth: 390, innerHeight: 664, addEventListener: (t, fn) => { if (t === "resize") ctx.resize = fn; } },
    document: {
      getElementById: (id) => els[id] || null,
      createElement: () => ({ dataset: {}, addEventListener() {}, setAttribute() {}, removeAttribute() {} }),
      querySelectorAll: () => [],
    },
    requestAnimationFrame: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (n) => { if (timers[n - 1]) timers[n - 1].fn = () => {}; },
    scrollToReportCard: () => {},
    markReportNavPosition: () => {},
  };
  vm.createContext(ctx);
  const sections = HTML.slice(HTML.indexOf("const REPORT_NAV_SECTIONS"), HTML.indexOf("  const REPORT_NAV_MIN_SCREENS = 2;"));
  vm.runInContext(sections + HTML.slice(start, end) + listeners + "\nthis.syncReportNav = syncReportNav; this.REPORT_NAV_SECTIONS = REPORT_NAV_SECTIONS;", ctx);
  ctx.REPORT_NAV_SECTIONS.forEach((s) => mk(s.id));
  return ctx;
}

test("the jump bar is built once, not on every resize of a swipe", () => {
  const ctx = reportNavHarness();
  ctx.syncReportNav();
  const inner = ctx.els.reportNavInner;
  assert.equal(inner.builds, 1);
  assert.ok(inner.children.length >= 3);
  // The same links again: nothing is torn down.
  ctx.syncReportNav();
  assert.equal(inner.builds, 1, "a re-sync with the same links must keep the bar as it is");
  // Safari's toolbar sliding away: height-only resizes, one per frame.
  for (let h = 664; h <= 746; h += 6) { ctx.window.innerHeight = h; ctx.resize(); }
  assert.equal(inner.builds, 1, "nothing is rebuilt mid-swipe");
  // They are answered once, after the swipe settles, and still rebuild nothing.
  const live = ctx.timers.filter((t) => t.fn.toString() !== "() => {}");
  assert.equal(live.length, 1, "one settle check, not one per frame");
  live[0].fn();
  assert.equal(inner.builds, 1);
  // A rotation (width) is answered at once.
  ctx.window.innerWidth = 844;
  const before = ctx.timers.length;
  ctx.resize();
  assert.equal(ctx.timers.length, before, "a width change does not wait");
  // A card going away changes the links, which does rebuild.
  ctx.els[ctx.REPORT_NAV_SECTIONS[0].id].offsetParent = null;
  ctx.syncReportNav();
  assert.equal(inner.builds, 2);
});
