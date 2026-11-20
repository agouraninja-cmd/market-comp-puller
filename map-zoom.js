// Ctrl + scroll zooms a map that sits in a scrolling page (2026-11-20; the
// owner, once the +/- buttons were gone from every map: "add the scroll zoom
// for the other maps as well").
//
// Every map but Home's is made with `scrollWheelZoom: false`, because it sits
// in a page that scrolls (the report, a market page, /markets, /comps,
// /permits, the address dialog) and a wheel that zoomed it would trap the
// page's own scroll the moment the pointer crossed the map. With the buttons
// gone, a desktop could zoom those maps only by double-clicking. Now:
//   - A wheel with Ctrl held (Cmd on a Mac) zooms the map, through Leaflet's
//     own ScrollWheelZoom, so the feel is Home's. A trackpad pinch arrives as
//     a wheel with ctrlKey set, so a pinch zooms the map, not the page.
//   - A plain wheel scrolls the page, as before, and says on the map "Hold
//     Ctrl and scroll to zoom the map" for a moment (Google's own maps do the
//     same), so the way to zoom can be found.
//
// How: the hook turns Leaflet's ScrollWheelZoom ON for those maps and marks
// the container. One wheel listener on the window, in the CAPTURE phase, runs
// before Leaflet's listener on the container; for a plain wheel over a marked
// map it stops the event there (`stopPropagation`, never `preventDefault`),
// so Leaflet never sees it and the browser scrolls the page. A wheel with the
// key goes on to Leaflet, which zooms and stops the browser's page zoom.
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

  var TIP_MS = 1200;
  var FLAG = "cnKeyWheel";

  function isMac(nav) {
    try {
      var p = (nav && ((nav.userAgentData && nav.userAgentData.platform) || nav.platform)) || "";
      return /mac|iphone|ipad/i.test(p);
    } catch (_) { return false; }
  }

  function tipText(nav) {
    return isMac(nav) ? "Hold ⌘ and scroll to zoom the map" : "Hold Ctrl and scroll to zoom the map";
  }

  // Does this map take the key-held wheel?
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

  function showTip(c, env) {
    var doc = env.doc, later = env.setTimeout, cancel = env.clearTimeout;
    var t = c.cnWheelTip;
    if (!t) {
      t = doc.createElement("div");
      t.setAttribute("aria-hidden", "true");
      t.textContent = tipText(env.nav);
      t.style.cssText = "position:absolute;top:0;right:0;bottom:0;left:0;z-index:1000;display:flex;align-items:center;" +
        "justify-content:center;padding:0 24px;text-align:center;background:color-mix(in srgb,var(--slab,#1d232c) 55%,transparent);" +
        "color:#ffffff;font:600 15px/1.4 Inter,system-ui,-apple-system,sans-serif;pointer-events:none;opacity:0;transition:opacity .2s";
      c.appendChild(t);
      c.cnWheelTip = t;
      void t.offsetWidth;
    }
    t.style.opacity = "1";
    if (c.cnWheelTimer) cancel(c.cnWheelTimer);
    c.cnWheelTimer = later(function () { t.style.opacity = "0"; c.cnWheelTimer = 0; }, TIP_MS);
  }

  // `env` is for the tests: { win, doc, nav, setTimeout, clearTimeout }.
  function envOf(env) {
    env = env || {};
    return {
      win: env.win || root,
      doc: env.doc || root.document,
      nav: "nav" in env ? env.nav : root.navigator,
      setTimeout: env.setTimeout || root.setTimeout,
      clearTimeout: env.clearTimeout || root.clearTimeout,
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
      e.stopPropagation();                  // not Leaflet's: the page scrolls
      try { showTip(c, env); } catch (_) { /* a missing tip still scrolls */ }
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
    map.scrollWheelZoom.enable();
    // /permits and the report rebuild a map on the same element: the old
    // map's unload clears the mark, and the new map sets it again.
    if (map.on) map.on("unload", function () { c[FLAG] = false; });
    return true;
  }

  function hook(L) {
    if (!L || !L.Map || !L.Map.addInitHook || L.__cnKeyWheel) return false;
    L.__cnKeyWheel = true;
    L.Map.addInitHook(function () {
      try { attach(this); } catch (_) { /* a map without key zoom is still a map */ }
    });
    return true;
  }

  var api = { TIP_MS: TIP_MS, tipText: tipText, wants: wants, attach: attach, hook: hook, listen: listen, markedFrom: markedFrom };
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.MAPZOOM = api;
    if (root.L) hook(root.L);
  }
})(typeof window !== "undefined" ? window : this);
