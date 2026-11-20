// map-zoom.js: Ctrl (Cmd) + scroll zooms a map in a scrolling page at once,
// and a plain scroll zooms it once the pointer has rested on it for 2 s;
// before that a plain scroll scrolls the page. Run against stand-ins for
// Leaflet, the window and the map element; the header of map-zoom.js is the
// contract.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const MZ = require("../map-zoom.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function stand() {
  const listeners = [];
  const clock = { t: 100000 };
  const win = { addEventListener: (type, fn, opts) => listeners.push({ type, fn, opts }) };
  const env = { win, now: () => clock.t };
  const onWheel = (e) => listeners.find((l) => l.type === "wheel").fn(e);
  return { listeners, clock, env, onWheel };
}

function container() {
  const on = {};
  return {
    nodeType: 1, parentNode: null, on,
    addEventListener(type, fn) { (on[type] = on[type] || []).push(fn); },
    fire(type) { (on[type] || []).forEach((fn) => fn()); },
  };
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

test("a map in a scrolling page takes the gated wheel; Home's and a still map do not", () => {
  assert.equal(MZ.wants({ options: { scrollWheelZoom: false } }), true);
  assert.equal(MZ.wants({ options: { scrollWheelZoom: true } }), false, "Home zooms on a plain wheel already");
  assert.equal(MZ.wants({ options: {} }), false, "Leaflet's default (wheel on) is left alone");
  assert.equal(MZ.wants({ options: { scrollWheelZoom: false, dragging: false } }), false, "a still picture of a map");
  assert.equal(MZ.wants({ options: { scrollWheelZoom: false, keyWheelZoom: false } }), false, "opted out");
  assert.equal(MZ.DWELL_MS, 2000, "the owner's two seconds");
});

test("attach turns Leaflet's wheel zoom on, marks the map, and listens once on the window, in capture", (t) => {
  const s = stand();
  const m1 = map({ scrollWheelZoom: false }, container());
  assert.equal(MZ.attach(m1, s.env), true);
  assert.equal(m1.enabled, true);
  assert.equal(MZ.attach(map({ scrollWheelZoom: false }, container()), s.env), true);
  const wheels = s.listeners.filter((l) => l.type === "wheel");
  assert.equal(wheels.length, 1, "one listener per window");
  assert.equal(wheels[0].opts.capture, true, "ahead of Leaflet's own listener on the map");
  assert.equal(wheels[0].opts.passive, true, "it never prevents the page's scroll");
  assert.equal(MZ.attach(map({ scrollWheelZoom: true }, container()), s.env), false);
});

test("a plain wheel scrolls the page until the pointer has rested on the map for 2 s, then zooms it", (t) => {
  const s = stand();
  const c = container();
  MZ.attach(map({ scrollWheelZoom: false }, c), s.env);
  c.fire("mouseenter");
  const inner = { nodeType: 1, parentNode: c };

  s.clock.t += 1999;
  const early = wheel(inner);
  s.onWheel(early);
  assert.equal(early.stopped, true, "1.999 s in: Leaflet never sees it, so the page scrolls");
  assert.equal(early.prevented, false, "the browser scrolls the page");

  s.clock.t += 1999;
  const stillScrolling = wheel(inner);
  s.onWheel(stillScrolling);
  assert.equal(stillScrolling.stopped, true, "the scroll before restarted the clock");

  s.clock.t += 2000;
  const rested = wheel(inner);
  s.onWheel(rested);
  assert.equal(rested.stopped, false, "rested 2 s with no page scroll: Leaflet zooms");

  s.clock.t += 50;
  const more = wheel(inner);
  s.onWheel(more);
  assert.equal(more.stopped, false, "and keeps zooming while the wheel turns");
});

test("scrolling slowly past a map never turns into zooming it", (t) => {
  const s = stand();
  const c = container();
  MZ.attach(map({ scrollWheelZoom: false }, c), s.env);
  c.fire("mouseenter");
  for (let i = 0; i < 20; i++) {
    s.clock.t += 1500;
    const e = wheel(c);
    s.onWheel(e);
    assert.equal(e.stopped, true, `wheel ${i}: still the page's`);
  }
});

test("leaving the map starts the clock over", (t) => {
  const s = stand();
  const c = container();
  MZ.attach(map({ scrollWheelZoom: false }, c), s.env);
  c.fire("mouseenter");
  s.clock.t += 5000;
  c.fire("mouseleave");
  c.fire("mouseenter");
  s.clock.t += 500;
  const e = wheel(c);
  s.onWheel(e);
  assert.equal(e.stopped, true);
});

test("a wheel over a map no enter was seen for counts as arriving, not as rested", (t) => {
  const s = stand();
  const c = container();
  MZ.attach(map({ scrollWheelZoom: false }, c), s.env);
  s.clock.t += 60000;
  const first = wheel(c);
  s.onWheel(first);
  assert.equal(first.stopped, true);
  s.clock.t += 2000;
  const later = wheel(c);
  s.onWheel(later);
  assert.equal(later.stopped, false);
});

test("Ctrl or Cmd held zooms at once (a trackpad pinch carries ctrlKey)", (t) => {
  const s = stand();
  const c = container();
  MZ.attach(map({ scrollWheelZoom: false }, c), s.env);
  c.fire("mouseenter");
  for (const keys of [{ ctrlKey: true }, { metaKey: true }]) {
    const e = wheel(c, keys);
    s.onWheel(e);
    assert.equal(e.stopped, false);
    assert.equal(e.prevented, false, "Leaflet's handler stops the page, not this one");
  }
});

test("no hint is drawn on the map", (t) => {
  const src = read("map-zoom.js");
  assert.doesNotMatch(src, /createElement|appendChild|textContent/, "the owner removed the hint");
});

test("a wheel anywhere else on the page is not touched", (t) => {
  const s = stand();
  MZ.attach(map({ scrollWheelZoom: false }, container()), s.env);
  const e = wheel({ nodeType: 1, parentNode: { nodeType: 1, parentNode: null } });
  s.onWheel(e);
  assert.equal(e.stopped, false);
});

test("a map rebuilt on the same element: unload clears the mark, hover listeners are added once", (t) => {
  const s = stand();
  const c = container();
  const m = map({ scrollWheelZoom: false }, c);
  MZ.attach(m, s.env);
  assert.equal(MZ.markedFrom(c), c);
  m.fire("unload");
  assert.equal(MZ.markedFrom(c), null);
  MZ.attach(map({ scrollWheelZoom: false }, c), s.env);
  assert.equal(c.on.mouseenter.length, 1);
  assert.equal(MZ.markedFrom(c), c);
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
