// map-zoom.js: Ctrl (Cmd) + scroll zooms a map in a scrolling page, and a
// plain scroll still scrolls the page. Run against stand-ins for Leaflet,
// the window and the document; the header of map-zoom.js is the contract.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const MZ = require("../map-zoom.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function stand() {
  const listeners = [];
  const win = { addEventListener: (type, fn, opts) => listeners.push({ type, fn, opts }) };
  const made = [];
  const doc = {
    createElement: () => {
      const el = { style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, offsetWidth: 1 };
      made.push(el);
      return el;
    },
  };
  const timers = [];
  const env = {
    win, doc, nav: { platform: "Win32" },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
  };
  return { listeners, win, doc, made, timers, env };
}

function container() {
  const kids = [];
  return { nodeType: 1, parentNode: null, kids, appendChild(k) { kids.push(k); } };
}

function map(options, c) {
  const on = {};
  const m = {
    options,
    enabled: false,
    scrollWheelZoom: { enable() { m.enabled = true; } },
    getContainer: () => c,
    on: (ev, fn) => { on[ev] = fn; },
    fire: (ev) => on[ev] && on[ev](),
  };
  return m;
}

function wheel(target, keys) {
  return Object.assign({ target, stopped: false, prevented: false,
    stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } }, keys || {});
}

test("a map in a scrolling page takes the key-held wheel; Home's and a still map do not", () => {
  assert.equal(MZ.wants({ options: { scrollWheelZoom: false } }), true);
  assert.equal(MZ.wants({ options: { scrollWheelZoom: true } }), false, "Home zooms on a plain wheel already");
  assert.equal(MZ.wants({ options: {} }), false, "Leaflet's default (wheel on) is left alone");
  assert.equal(MZ.wants({ options: { scrollWheelZoom: false, dragging: false } }), false, "a still picture of a map");
  assert.equal(MZ.wants({ options: { scrollWheelZoom: false, keyWheelZoom: false } }), false, "opted out");
});

test("attach turns Leaflet's wheel zoom on, marks the map, and listens once on the window, in capture", (t) => {
  const s = stand();
  const c1 = container(), c2 = container();
  const m1 = map({ scrollWheelZoom: false }, c1);
  assert.equal(MZ.attach(m1, s.env), true);
  assert.equal(m1.enabled, true);
  assert.equal(MZ.attach(map({ scrollWheelZoom: false }, c2), s.env), true);
  const wheels = s.listeners.filter((l) => l.type === "wheel");
  assert.equal(wheels.length, 1, "one listener per window");
  assert.equal(wheels[0].opts.capture, true, "ahead of Leaflet's own listener on the map");
  assert.equal(wheels[0].opts.passive, true, "it never prevents the page's scroll");
  assert.equal(MZ.attach(map({ scrollWheelZoom: true }, container()), s.env), false);
});

test("a plain wheel over the map is stopped before Leaflet and shows the hint; the page still scrolls", (t) => {
  const s = stand();
  const c = container();
  MZ.attach(map({ scrollWheelZoom: false }, c), s.env);
  const onWheel = s.listeners.find((l) => l.type === "wheel").fn;
  const inner = { nodeType: 1, parentNode: c };
  const e = wheel(inner);
  onWheel(e);
  assert.equal(e.stopped, true, "Leaflet never sees it, so it does not zoom");
  assert.equal(e.prevented, false, "the browser scrolls the page");
  assert.equal(c.kids.length, 1);
  assert.equal(c.kids[0].textContent, "Hold Ctrl and scroll to zoom the map");
  assert.equal(c.kids[0].attrs["aria-hidden"], "true");
  assert.match(c.kids[0].style.cssText, /pointer-events:none/);
  assert.equal(c.kids[0].style.opacity, "1");
  s.timers.at(-1)();
  assert.equal(c.kids[0].style.opacity, "0", "it fades once the wheel stops");
  onWheel(wheel(inner));
  assert.equal(c.kids.length, 1, "one hint per map, reused");
});

test("Ctrl or Cmd held goes through to Leaflet, which zooms (a trackpad pinch carries ctrlKey)", (t) => {
  const s = stand();
  const c = container();
  MZ.attach(map({ scrollWheelZoom: false }, c), s.env);
  const onWheel = s.listeners.find((l) => l.type === "wheel").fn;
  for (const keys of [{ ctrlKey: true }, { metaKey: true }]) {
    const e = wheel(c, keys);
    onWheel(e);
    assert.equal(e.stopped, false);
    assert.equal(e.prevented, false, "Leaflet's handler stops the page zoom, not this one");
  }
  assert.equal(c.kids.length, 0, "no hint while zooming");
});

test("a wheel anywhere else on the page is not touched", (t) => {
  const s = stand();
  MZ.attach(map({ scrollWheelZoom: false }, container()), s.env);
  const onWheel = s.listeners.find((l) => l.type === "wheel").fn;
  const e = wheel({ nodeType: 1, parentNode: { nodeType: 1, parentNode: null } });
  onWheel(e);
  assert.equal(e.stopped, false);
});

test("a map rebuilt on the same element: the old one's unload clears the mark", (t) => {
  const s = stand();
  const c = container();
  const m = map({ scrollWheelZoom: false }, c);
  MZ.attach(m, s.env);
  assert.equal(MZ.markedFrom(c), c);
  m.fire("unload");
  assert.equal(MZ.markedFrom(c), null);
});

test("the hint names the Mac's key on a Mac", () => {
  assert.equal(MZ.tipText({ platform: "MacIntel" }), "Hold ⌘ and scroll to zoom the map");
  assert.equal(MZ.tipText({ userAgentData: { platform: "macOS" } }), "Hold ⌘ and scroll to zoom the map");
  assert.equal(MZ.tipText({ platform: "Win32" }), "Hold Ctrl and scroll to zoom the map");
  assert.equal(MZ.tipText(undefined), "Hold Ctrl and scroll to zoom the map");
});

test("hook adds one init hook, once", () => {
  const hooks = [];
  const L = { Map: { addInitHook: (fn) => hooks.push(fn) } };
  assert.equal(MZ.hook(L), true);
  assert.equal(MZ.hook(L), false);
  assert.equal(hooks.length, 1);
  assert.equal(MZ.hook(null), false);
});

test("every page that loads Leaflet loads it", () => {
  const html = read("index.html");
  const credit = html.indexOf('<script src="/map-credit.js"></script>');
  const zoom = html.indexOf('<script src="/map-zoom.js"></script>');
  assert.ok(zoom > credit && credit > 0 && zoom < html.indexOf("</head>"), "index.html: after leaflet.js, in the head");
  const server = read("server.js");
  const head = server.slice(server.indexOf("const LEAFLET_HEAD ="));
  const block = head.slice(0, head.indexOf("`;\n") + 3);
  assert.ok(block.indexOf('<script src="/map-zoom.js"></script>') > block.indexOf("leaflet.js"), "LEAFLET_HEAD");
  assert.ok(server.includes('"/map-zoom.js": { file: "map-zoom.js", type: "text/javascript; charset=utf-8", maxAge: 0 }'));
  assert.match(read("permits-page.js"), /if\(window\.MAPZOOM\)MAPZOOM\.hook\(L\); cb\(\);/, "/permits hooks it when Leaflet loads");
});

test("it writes nothing: no fetch, no storage (rule 15)", () => {
  assert.doesNotMatch(read("map-zoom.js"), /fetch\(|sendBeacon|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/);
});
