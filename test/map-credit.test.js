// map-credit.js: on a phone, a map's credit line folds into an "i" in the
// corner once it has been seen. The module's header states its rules; this
// holds them, runs attach() against stand-ins for Leaflet and the page, and
// checks that every page that draws a map loads it.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const MC = require("../map-credit");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const LEAFLET_PREFIX = '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>';

// ---- stand-ins ---------------------------------------------------------------
function classList() {
  const s = new Set();
  return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c), toString: () => [...s].join(" ") };
}
function node(sel, parent) {
  const attrs = {};
  return { nodeType: 1, parentNode: parent, attrs, matches: (q) => q === sel, setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: (k) => attrs[k] };
}
// A Leaflet attribution control: setPrefix re-renders the container from the
// prefix string, as Leaflet's _update rewrites innerHTML, so a new button
// element replaces the old one on every render.
function world({ phone = true, prerendering = false, hidden = false, io = true, prefix = LEAFLET_PREFIX } = {}) {
  const listeners = [];
  const L = {
    DomEvent: {
      on: (el, types, fn) => types.split(" ").forEach((t) => listeners.push({ el, t, fn })),
      off: (el, types, fn) => types.split(" ").forEach((t) => {
        const i = listeners.findIndex((x) => x.el === el && x.t === t && x.fn === fn);
        if (i >= 0) listeners.splice(i, 1);
      }),
    },
    Map: { hooks: [], addInitHook(fn) { this.hooks.push(fn); } },
  };
  const c = { classList: classList(), button: null, link: null, renders: 0 };
  c.querySelector = (q) => (q === ".cn-credit-i" ? c.button : null);
  c.contains = (n) => { for (let x = n; x; x = x.parentNode) if (x === c) return true; return false; };
  const ctl = {
    options: { prefix },
    getContainer: () => c,
    setPrefix(p) { this.options.prefix = p; this._update(); return this; },
    _update() {
      c.renders++;
      const html = this.options.prefix || "";
      c.button = /cn-credit-i/.test(html) ? node(".cn-credit-i", c) : null;
      if (c.button) {
        c.button.attrs["aria-expanded"] = /aria-expanded="true"/.test(html) ? "true" : "false";
        c.button.attrs["aria-label"] = (html.match(/aria-label="([^"]*)"/) || [])[1];
      }
      c.link = node("a", c);
    },
  };
  const mapEl = { id: "map" };
  const mapHandlers = {};
  const map = {
    attributionControl: ctl,
    getContainer: () => mapEl,
    on: (t, fn) => { (mapHandlers[t] = mapHandlers[t] || []).push(fn); },
    fire: (t) => (mapHandlers[t] || []).forEach((fn) => fn()),
  };
  const docListeners = {};
  const head = { children: [], appendChild(n) { this.children.push(n); } };
  const doc = {
    head, prerendering, visibilityState: hidden ? "hidden" : "visible",
    getElementById: (id) => head.children.find((n) => n.id === id) || null,
    createElement: () => ({}),
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => { docListeners[t] = (docListeners[t] || []).filter((f) => f !== fn); },
    fire: (t) => (docListeners[t] || []).slice().forEach((fn) => fn()),
  };
  const timers = [];
  const observers = [];
  class IO {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.els = []; this.off = false; observers.push(this); }
    observe(el) { this.els.push(el); }
    disconnect() { this.off = true; }
    see(ratio = 1) { this.cb([{ isIntersecting: ratio > 0, intersectionRatio: ratio, target: this.els[0] }]); }
  }
  const env = {
    L, doc,
    win: { matchMedia: (q) => ({ matches: phone && q === MC.PHONE }) },
    IO: io ? IO : undefined,
    setTimeout: (fn, ms) => { const t = { fn, ms, cancelled: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cancelled = true; },
  };
  const fire = (el, t, target) => listeners.filter((x) => x.el === el && x.t === t).forEach((x) => x.fn({ target }));
  return { L, c, ctl, map, mapEl, doc, env, timers, observers, listeners, fire };
}
const isOpen = (w) => !w.c.classList.contains("cn-credit-closed");

// ---- the rules -----------------------------------------------------------------
test("the 'i' rides in the prefix, ahead of Leaflet's own, and it starts open", () => {
  const w = world();
  const state = MC.attach(w.map, w.env);
  assert.ok(state, "attached");
  assert.ok(w.c.classList.contains("cn-credit"));
  assert.ok(w.ctl.options.prefix.startsWith('<button type="button" class="cn-credit-i" aria-expanded="true"'));
  assert.ok(w.ctl.options.prefix.endsWith(LEAFLET_PREFIX), "Leaflet's own credit is kept, after the button");
  assert.equal(w.c.button.getAttribute("aria-expanded"), "true");
  assert.ok(isOpen(w), "a credit that started folded would be one nobody saw");
  // The style sheet goes in once per page, however many maps there are.
  MC.attach(world().map, w.env);
  assert.equal(w.doc.head.children.filter((n) => n.id === "cnMapCreditCss").length, 1);
});

test("it folds by itself only after the whole line has been on screen for SHOW_MS", () => {
  const w = world();
  MC.attach(w.map, w.env);
  assert.equal(w.timers.length, 0, "no clock before it is seen");
  const io = w.observers[0];
  assert.equal(io.els[0], w.c, "it watches the credit line itself, not the map");
  io.see(0.4);
  assert.equal(w.timers.length, 0, "half on screen is not seen");
  io.see(1);
  assert.ok(io.off, "seen once is enough");
  assert.equal(w.timers.length, 1);
  assert.equal(w.timers[0].ms, MC.SHOW_MS);
  assert.ok(MC.SHOW_MS >= 5000, "long enough to read");
  assert.ok(isOpen(w));
  w.timers[0].fn();
  assert.ok(!isOpen(w), "folded");
  assert.equal(w.c.button.getAttribute("aria-expanded"), "false");
  assert.equal(w.c.button.getAttribute("aria-label"), "Show map credits");
  // Leaflet re-renders the control when a layer's credit comes or goes (the
  // theme swap, Satellite, labels at zoom 6): the fold must survive it.
  w.ctl._update();
  assert.equal(w.c.button.getAttribute("aria-expanded"), "false", "the prefix string carries the state");
});

test("a page built before anyone sees it starts no clock (rule 15)", () => {
  const pre = world({ prerendering: true });
  MC.attach(pre.map, pre.env);
  assert.equal(pre.observers.length, 0);
  pre.doc.prerendering = false;
  pre.doc.fire("prerenderingchange");
  assert.equal(pre.observers.length, 1, "watched once it is shown");

  const hid = world({ hidden: true });
  MC.attach(hid.map, hid.env);
  assert.equal(hid.observers.length, 0);
  hid.doc.visibilityState = "visible";
  hid.doc.fire("visibilitychange");
  assert.equal(hid.observers.length, 1);
});

test("without IntersectionObserver the clock starts when the page is shown", () => {
  const w = world({ io: false });
  MC.attach(w.map, w.env);
  assert.equal(w.timers.length, 1);
});

test("a press on the map folds it at once; a press on the credit itself does not", () => {
  const w = world();
  MC.attach(w.map, w.env);
  w.fire(w.mapEl, "pointerdown", w.c.button);
  assert.ok(isOpen(w), "the press that taps the 'i' is the click's, not the map's");
  w.fire(w.mapEl, "pointerdown", w.mapEl);
  assert.ok(!isOpen(w));
});

test("the 'i' opens and folds it, a link stays a link, and a hand-opened credit is not folded by the clock", () => {
  const w = world();
  MC.attach(w.map, w.env);
  w.fire(w.c, "click", w.c.button);
  assert.ok(!isOpen(w), "tapping the 'i' while open folds it");
  w.fire(w.c, "click", w.c.button);
  assert.ok(isOpen(w), "and opens it again");
  assert.equal(w.c.button.getAttribute("aria-label"), "Hide map credits");
  w.fire(w.c, "click", w.c.link);
  assert.ok(isOpen(w), "a tap on Esri or OpenStreetMap follows the link");
  w.observers[0].see(1);
  w.timers.forEach((t) => t.fn());
  assert.ok(isOpen(w), "opened by hand, it stays open until the member folds it");
  // Toggling never re-renders: the button the keyboard is on stays the same element.
  const renders = w.c.renders;
  w.fire(w.c, "click", w.c.button);
  assert.equal(w.c.renders, renders);
});

test("on a desktop a tap or a press changes nothing", () => {
  const w = world({ phone: false });
  MC.attach(w.map, w.env);
  w.fire(w.c, "click", w.c.button);
  w.fire(w.mapEl, "pointerdown", w.mapEl);
  assert.ok(isOpen(w));
});

test("a map that goes away takes its listeners and its clock with it", () => {
  const w = world();
  MC.attach(w.map, w.env);
  w.observers[0].see(1);
  const before = w.listeners.length;
  assert.ok(before >= 3);
  w.map.fire("unload");
  assert.equal(w.listeners.length, 0, "the report's map is rebuilt in the same element");
  assert.ok(w.timers[0].cancelled);
  const w2 = world();
  MC.attach(w2.map, w2.env);
  w2.map.fire("unload");
  w2.observers.length && assert.ok(w2.observers[0].off);
});

test("a map with no credit control, or one already folded once, is left alone", () => {
  const w = world();
  w.map.attributionControl = null;
  assert.equal(MC.attach(w.map, w.env), null);
  const again = world();
  MC.attach(again.map, again.env);
  const prefix = again.ctl.options.prefix;
  assert.equal(MC.attach(again.map, again.env), null);
  assert.equal(again.ctl.options.prefix, prefix, "no second button");
});

test("hook() adds one init hook per Leaflet, and that hook attaches", () => {
  const w = world();
  assert.equal(MC.hook(w.L), true);
  assert.equal(MC.hook(w.L), false);
  assert.equal(w.L.Map.hooks.length, 1);
  assert.equal(MC.hook(null), false);
});

test("the style changes nothing outside a phone screen, and keeps every word", () => {
  const css = MC.CSS;
  const media = "@media " + MC.PHONE + "{";
  assert.equal(MC.PHONE, "screen and (max-width: 639.98px)", "the report's own phone width; screen, so print is untouched");
  const outside = css.slice(0, css.indexOf(media));
  assert.equal(outside, ".cn-credit-i{display:none}", "a desktop never draws the 'i'");
  assert.ok(css.endsWith("}"));
  // Folded: hidden from sight, from the tab order and from a screen reader
  // alike (visibility, inherited by the text), with the 'i' alone visible.
  assert.match(css, /\.cn-credit-closed\{visibility:hidden;/);
  assert.match(css, /\.cn-credit\.cn-credit-closed \.cn-credit-i\{visibility:visible;/);
  // Quiet, not blue, no flag.
  assert.match(css, /\.cn-credit a\{color:inherit;/);
  assert.match(css, /\.leaflet-attribution-flag\{display:none!important\}/);
  // A thumb-sized target around a small circle.
  assert.match(css, /\.cn-credit-i::after\{content:"";position:absolute;inset:-8px\}/);
  assert.match(css, /\.cn-credit-i:focus-visible\{outline:/);
  // Nothing here removes or rewrites the credit's words.
  assert.doesNotMatch(read("map-credit.js"), /removeAttribution|addAttribution|attributionControl\s*=\s*false/);
});

test("it writes nothing: no fetch, no storage (rule 15)", () => {
  const src = read("map-credit.js");
  assert.doesNotMatch(src, /fetch\(|sendBeacon|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/);
});

// ---- every page that draws a map loads it ---------------------------------------
test("index.html loads it right after Leaflet, ahead of the app's own script", () => {
  const html = read("index.html");
  const leaflet = html.indexOf('<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>');
  const credit = html.indexOf('<script src="/map-credit.js"></script>');
  assert.ok(leaflet > 0 && credit > leaflet, "after leaflet.js, so window.L is there to hook");
  assert.ok(credit < html.indexOf("</head>"), "in the head, before any map is made");
});

test("the server-rendered pages load it: LEAFLET_HEAD, and /permits for its lazy maps", () => {
  const server = read("server.js");
  const head = server.slice(server.indexOf("const LEAFLET_HEAD ="));
  const end = head.indexOf("`;\n");
  const block = head.slice(0, end);
  assert.ok(block.indexOf("leaflet.js") > 0 && block.indexOf('<script src="/map-credit.js"></script>') > block.indexOf("leaflet.js"));
  assert.ok(server.includes('"/map-credit.js": { file: "map-credit.js", type: "text/javascript; charset=utf-8", maxAge: 0 }'));
  assert.match(server, /head: INTER_FONT_HEAD \+ `<style>\$\{LEAFLET_DARK_CSS\}<\/style><script>\$\{BASEMAP_JS\}<\/script><script src="\/map-credit\.js"><\/script><script src="\/map-zoom\.js"><\/script>`/);
  const permits = read("permits-page.js");
  assert.match(permits, /sc\.onload=function\(\)\{[^\n]*if\(window\.MAPCREDIT\)MAPCREDIT\.hook\(L\);[^\n]* cb\(\);/,
    "/permits loads Leaflet only when a map opens, so it hooks it then");
});
