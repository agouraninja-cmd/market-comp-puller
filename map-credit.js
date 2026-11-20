// The map's credit line on a phone (2026-11-18; the owner: "On mobile the
// citations for the map are too noticeable and make it ugly please fix it").
//
// Every map here is Leaflet over Esri tiles, and Leaflet writes its credit
// line ("Leaflet | Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap
// contributors") as a white band along the map's foot. On a desktop that is
// one quiet line. On a phone it wrapped to two lines across the whole width
// of the map, in blue links with a flag, and on Home's 300px strip it was the
// loudest thing on the map.
//
// What this does, on a phone screen (under 640px, the report's own phone
// width) and nowhere else:
//   - The line is a small pill in the corner, in the page's quiet grey, with
//     no flag and no blue. It is the same words, every one of them.
//   - It folds into a round "i" button. A tap on the "i" opens it again, and
//     a tap on the "i", the pill or the map folds it.
//   - It folds by itself only after it has been SEEN: five seconds after the
//     whole line is on screen (`SHOW_MS`), or the first time the member
//     touches the map, whichever is first. That is the licence's half, not
//     a taste: OpenStreetMap's attribution guidelines accept a credit behind
//     an "i" in the corner once it has shown without anyone having to ask
//     for it, and Esri's own map widget folds its line the same way. A
//     credit that started folded would be one nobody ever saw. A map built
//     before it is on screen (the report's map, far down the page; a tab
//     built ahead and shown later, CLAUDE.md rule 15) waits to be seen.
//
//   - The map's +/- zoom buttons are hidden (2026-11-20, the owner's call):
//     a phone pinches or double-taps to zoom.
//
// What it does NOT touch: a desktop (the "i" is never drawn there and the
// line is Leaflet's own), the print and PNG exports (they use a raster with
// its own credit, SMAP_ATTRIB in index.html), and the credit's words (each
// page's tile layer still supplies them).
//
// How it reaches every map: `hook(L)` adds one Leaflet init hook, so a map
// made anywhere on the page gets this without its own code knowing.
// index.html and server.js's LEAFLET_HEAD load this file right after
// leaflet.js, and the file hooks itself when it finds `window.L`.
// permits-page.js loads Leaflet only when a map opens, so it calls
// `MAPCREDIT.hook(L)` from that load. `hook` is idempotent.
//
// One Leaflet detail it leans on: the control rewrites its own innerHTML
// whenever a layer's credit comes or goes (the theme swap, the report's
// Satellite switch, labels arriving at zoom 6), which would throw away any
// element put inside it. So the "i" is written into the control's PREFIX,
// the one piece of that HTML Leaflet lets a page set (`setPrefix`), and the
// open/closed state lives on the container, which Leaflet never replaces.
// Toggling writes the prefix string and the live button's attributes rather
// than calling setPrefix again, so a keyboard user's focus stays on the
// button they pressed.
//
// Writes nothing (no fetch, no storage), so it is safe on a page that is
// built before anyone sees it.
//
// Dual-exported: the browser global MAPCREDIT, and module.exports so
// test/map-credit.test.js can run it against stand-ins.
(function (root) {
  "use strict";

  var SHOW_MS = 5000;
  var PHONE = "screen and (max-width: 639.98px)";
  var STYLE_ID = "cnMapCreditCss";
  var LABEL_OPEN = "Hide map credits";
  var LABEL_CLOSED = "Show map credits";

  // Tokens are theme.js's; the literals after each comma are what a page
  // without them would show, never what a themed page shows. Every rule but
  // the first sits inside the phone query, so a desktop is untouched. The
  // selectors carry `.leaflet-container ... .leaflet-control-attribution` so
  // they outrank leaflet.css and both pages' dark-mode rules for the control.
  var C = ".leaflet-container .leaflet-control-attribution.cn-credit";
  var CSS =
    ".cn-credit-i{display:none}" +
    "@media " + PHONE + "{" +
    // 6px clear of the map's edges, the left one included: a long line
    // wraps short of it instead of running into the map's corner.
    C + "{position:relative;box-sizing:border-box;min-height:22px;margin:0 6px 6px 6px;" +
    "padding:3px 28px 3px 9px;font-size:11px;line-height:16px;color:var(--ink-3,#68707e);" +
    "background:var(--card,#fff);background:color-mix(in srgb,var(--card,#fff) 90%,transparent);" +
    "border-radius:11px;box-shadow:0 1px 3px rgba(16,20,26,.16)}" +
    C + " a{color:inherit;text-decoration:none}" +
    ".leaflet-container .cn-credit .leaflet-attribution-flag{display:none!important}" +
    ".cn-credit .cn-credit-i{display:flex;align-items:center;justify-content:center;position:absolute;right:0;bottom:0;" +
    "box-sizing:border-box;width:22px;height:22px;margin:0;padding:0;border:0;border-radius:50%;" +
    "background:transparent;color:var(--ink-3,#68707e);cursor:pointer;font:inherit;-webkit-tap-highlight-color:transparent}" +
    // A thumb gets 38px; the circle stays 22.
    ".cn-credit .cn-credit-i::after{content:\"\";position:absolute;inset:-8px}" +
    ".cn-credit .cn-credit-i:focus-visible{outline:2px solid var(--ink-2,#3d4450);outline-offset:1px}" +
    // Folded: the words take no room and are not read or tabbed to
    // (visibility is inherited, text nodes included); the "i" alone shows.
    C + ".cn-credit-closed{visibility:hidden;width:22px;height:22px;min-height:0;padding:0;" +
    "font-size:0;line-height:0;background:none;box-shadow:none}" +
    ".cn-credit.cn-credit-closed .cn-credit-i{visibility:visible;background:var(--card,#fff);" +
    "border:1px solid var(--edge,#d9dde3);box-shadow:0 1px 3px rgba(16,20,26,.16)}" +
    // No +/- buttons on a phone (2026-11-20; the owner: "Remove the plus and
    // minus feature on the compninja mobile version on the map"). A phone
    // zooms with two fingers or a double tap, and the buttons covered the
    // map's corner. Desktop keeps them.
    ".leaflet-container .leaflet-control-zoom{display:none!important}" +
    "}";

  // The "i": a dot over a stem, drawn in the text colour.
  var ICON =
    '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16">' +
    '<circle cx="8" cy="3.6" r="1.6" fill="currentColor"/>' +
    '<rect x="6.85" y="6.6" width="2.3" height="7" rx="1.15" fill="currentColor"/></svg>';

  function buttonHtml(open) {
    return '<button type="button" class="cn-credit-i" aria-expanded="' + (open ? "true" : "false") +
      '" aria-label="' + (open ? LABEL_OPEN : LABEL_CLOSED) + '">' + ICON + "</button>";
  }

  function isPhone(win) {
    try { return !!(win && win.matchMedia && win.matchMedia(PHONE).matches); } catch (_) { return false; }
  }

  function injectCss(doc) {
    if (!doc || !doc.head || doc.getElementById(STYLE_ID)) return;
    var s = doc.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    doc.head.appendChild(s);
  }

  // Runs `fn` once the page is one somebody is looking at: never while it is
  // prerendered or sitting in a hidden view (rule 15's pages built ahead).
  function whenShown(doc, fn) {
    if (!doc) return fn();
    if (doc.prerendering) {
      doc.addEventListener("prerenderingchange", function () { whenShown(doc, fn); }, { once: true });
      return;
    }
    if (doc.visibilityState === "hidden") {
      var onVis = function () {
        if (doc.visibilityState === "hidden") return;
        doc.removeEventListener("visibilitychange", onVis);
        fn();
      };
      doc.addEventListener("visibilitychange", onVis);
      return;
    }
    fn();
  }

  function closest(el, sel) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (n.matches ? n.matches(sel) : false) return n;
    }
    return null;
  }

  // `env` is for the tests: { L, win, doc, IO, setTimeout, clearTimeout }.
  function attach(map, env) {
    env = env || {};
    var L = env.L || root.L;
    var win = env.win || root;
    var doc = env.doc || root.document;
    var IO = "IO" in env ? env.IO : root.IntersectionObserver;
    var later = env.setTimeout || root.setTimeout;
    var cancel = env.clearTimeout || root.clearTimeout;
    var ctl = map && map.attributionControl;
    if (!L || !ctl || ctl._cnCredit || !ctl.getContainer) return null;
    var c = ctl.getContainer();
    if (!c) return null;
    injectCss(doc);

    var base = ctl.options.prefix || "";
    var state = { open: true, auto: true };
    var timer = null, io = null, gone = false;
    ctl._cnCredit = state;

    function sync() {
      ctl.options.prefix = buttonHtml(state.open) + base;
      var b = c.querySelector(".cn-credit-i");
      if (b) {
        b.setAttribute("aria-expanded", state.open ? "true" : "false");
        b.setAttribute("aria-label", state.open ? LABEL_OPEN : LABEL_CLOSED);
      }
      if (state.open) c.classList.remove("cn-credit-closed");
      else c.classList.add("cn-credit-closed");
    }
    function set(open) {
      state.auto = false;
      if (state.open === open) return;
      state.open = open;
      sync();
    }

    c.classList.add("cn-credit");
    ctl.setPrefix(buttonHtml(true) + base);

    // The "i" or the pill's own words fold and unfold it; a link is a link.
    function onClick(e) {
      if (!isPhone(win)) return;
      if (closest(e.target, "a")) return;
      set(!state.open);
    }
    // A press anywhere else on the map folds it. Leaflet stops a press on
    // the control from reaching the map for mousedown and touchstart, but
    // not for pointerdown, so a press inside it is let through here.
    var mapEl = map.getContainer();
    function onPress(e) {
      if (!state.open || !isPhone(win)) return;
      if (e && e.target && c.contains(e.target)) return;
      set(false);
    }
    L.DomEvent.on(c, "click", onClick);
    L.DomEvent.on(mapEl, "pointerdown keydown", onPress);

    function arm() {
      if (gone || !state.auto) return;
      timer = later(function () {
        timer = null;
        if (!gone && state.auto && state.open) set(false);
      }, SHOW_MS);
    }
    whenShown(doc, function () {
      if (gone) return;
      if (typeof IO !== "function") return arm();
      io = new IO(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting && entries[i].intersectionRatio >= 0.9) {
            io.disconnect();
            io = null;
            return arm();
          }
        }
      }, { threshold: [0.9] });
      io.observe(c);
    });

    // The report and the address check build a new map in the same element;
    // the old one's listeners and clock go with it.
    map.on("unload", function () {
      gone = true;
      if (timer) { cancel(timer); timer = null; }
      if (io) { io.disconnect(); io = null; }
      L.DomEvent.off(c, "click", onClick);
      L.DomEvent.off(mapEl, "pointerdown keydown", onPress);
    });
    return state;
  }

  function hook(L) {
    if (!L || !L.Map || !L.Map.addInitHook || L.__cnCredit) return false;
    L.__cnCredit = true;
    L.Map.addInitHook(function () {
      try { attach(this, { L: L }); } catch (_) { /* a map without its fold is still a map */ }
    });
    return true;
  }

  var api = { SHOW_MS: SHOW_MS, PHONE: PHONE, CSS: CSS, buttonHtml: buttonHtml, attach: attach, hook: hook, whenShown: whenShown };
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.MAPCREDIT = api;
    if (root.L) hook(root.L);
  }
})(typeof window !== "undefined" ? window : this);
