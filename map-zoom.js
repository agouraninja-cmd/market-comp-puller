// Scroll zoom for a map that sits in a scrolling page (2026-11-20; the
// owner, once the +/- buttons were gone from every map: "add the scroll zoom
// for the other maps as well", then "remove the scroll hint on the maps and
// make it so you can scroll without pressing control if your cursor is on
// the map for 2 seconds").
//
// Every map but Home's is made with `scrollWheelZoom: false`, because it sits
// in a page that scrolls (the report, a market page, /markets, /comps,
// /permits, the address dialog) and a wheel that zoomed it at once would trap
// the page's own scroll the moment the pointer crossed the map. Now:
//   - A wheel with Ctrl held (Cmd on a Mac) zooms the map at once, through
//     Leaflet's own ScrollWheelZoom, so the feel is Home's. A trackpad pinch
//     arrives as a wheel with ctrlKey set, so a pinch zooms the map.
//   - A plain wheel zooms the map once the pointer has RESTED on it for
//     `DWELL_MS` (2 s). Rested means: on the map, with no page-scrolling wheel
//     in those 2 s. Every plain wheel that scrolls the page restarts the
//     clock, so scrolling past a map never turns into zooming it halfway
//     down, however slowly the page goes by; stop on the map, wait, and the
//     next scroll zooms. Leaving the map starts it over.
//   - Before that, a plain wheel scrolls the page, as it always did. No hint
//     is drawn (the owner removed it).
//
// How: the hook turns Leaflet's ScrollWheelZoom ON for those maps and marks
// the container. One wheel listener on the window, in the CAPTURE phase, runs
// before Leaflet's listener on the container; for a plain wheel over a marked
// map that has not been rested on, it stops the event there
// (`stopPropagation`, never `preventDefault`), so Leaflet never sees it and
// the browser scrolls the page. Otherwise the wheel goes on to Leaflet, which
// zooms and stops the page from moving.
//
// Which maps: one made with `scrollWheelZoom: false` whose dragging is on.
// A map that zooms on a plain wheel already (Home) is left alone, and so is a
// still picture of a map (`dragging: false`, /comps' empty map), and any map
// made with `keyWheelZoom: false`. If this file fails to load, those maps are
// what they were: no wheel zoom, never a trapped page.
//
// How it reaches every map: `hook(L)` adds one Leaflet init hook, like
// map-credit.js. index.html and server.js's LEAFLET_HEAD load it right after
// leaflet.js, and it hooks itself when it finds `window.L`; /permits loads
// Leaflet only when a map opens, so its withLeaflet calls `MAPZOOM.hook(L)`.
//
// Writes nothing (no fetch, no storage), so it is safe on a page built
// before anyone sees it (CLAUDE.md rule 15).
//
// Dual-exported: the browser global MAPZOOM, and module.exports so
// test/map-zoom.test.js can run it against stand-ins.
(function (root) {
  "use strict";

  var DWELL_MS = 2000;
  var FLAG = "cnKeyWheel";

  // Does this map take the gated wheel?
  function wants(map) {
    var o = (map && map.options) || {};
    return o.scrollWheelZoom === false && o.dragging !== false && o.keyWheelZoom !== false;
  }

  // The marked map container a wheel landed in, if any.
  function markedFrom(node) {
    for (var n = node; n && n.nodeType === 1; n = n.parentNode) {
      if (n[FLAG]) return n;
    }
    return null;
  }

  // Has the pointer rested on this map long enough for a plain wheel to zoom?
  function rested(c, now) {
    return !!(c.cnHover && now - c.cnSince >= DWELL_MS);
  }

  // `env` is for the tests: { win, now }.
  function envOf(env) {
    env = env || {};
    return {
      win: env.win || root,
      now: env.now || function () { return Date.now(); },
    };
  }

  // The one window listener, added once per window.
  function listen(env) {
    var win = env.win;
    if (!win || !win.addEventListener || win.__cnKeyWheel) return false;
    win.__cnKeyWheel = true;
    win.addEventListener("wheel", function (e) {
      var c = markedFrom(e.target);
      if (!c) return;
      if (e.ctrlKey || e.metaKey) return;   // Leaflet's: it zooms
      var now = env.now();
      if (rested(c, now)) return;           // rested on: Leaflet zooms
      // Not yet: the page scrolls, and a page-scrolling wheel restarts the
      // clock (a wheel over a map no enter was seen for counts as arriving).
      c.cnHover = true;
      c.cnSince = now;
      e.stopPropagation();
    }, { capture: true, passive: true });
    return true;
  }

  function attach(map, env) {
    if (!wants(map) || !map.scrollWheelZoom || !map.getContainer) return false;
    var c = map.getContainer();
    if (!c) return false;
    env = envOf(env);
    listen(env);
    c[FLAG] = true;
    c.cnHover = false;
    c.cnSince = 0;
    if (c.addEventListener && !c.cnZoomHover) {
      c.cnZoomHover = true;   // once per element: /permits and the report rebuild maps on the same one
      c.addEventListener("mouseenter", function () { c.cnHover = true; c.cnSince = env.now(); });
      c.addEventListener("mouseleave", function () { c.cnHover = false; });
    }
    map.scrollWheelZoom.enable();
    // The old map's unload clears the mark; a new map on the element sets it again.
    if (map.on) map.on("unload", function () { c[FLAG] = false; c.cnHover = false; });
    return true;
  }

  function hook(L) {
    if (!L || !L.Map || !L.Map.addInitHook || L.__cnKeyWheel) return false;
    L.__cnKeyWheel = true;
    L.Map.addInitHook(function () {
      try { attach(this); } catch (_) { /* a map without wheel zoom is still a map */ }
    });
    return true;
  }

  var api = { DWELL_MS: DWELL_MS, wants: wants, rested: rested, attach: attach, hook: hook, listen: listen, markedFrom: markedFrom };
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.MAPZOOM = api;
    if (root.L) hook(root.L);
  }
})(typeof window !== "undefined" ? window : this);
