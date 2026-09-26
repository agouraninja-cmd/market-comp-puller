"use strict";

// The desktop shell's tab pool, minus Electron: the decisions main.js makes
// about pages it builds ahead, kept pure so the root suite can test them
// (test/desktop-app.test.js). Requiring this file starts nothing and needs no
// electron — main.js is the only place that touches a window or a view.
//
// Why the shell builds tabs at all: Electron has no prerendering (measured on
// Electron 43 — a speculation rule fetches the HTML and stops), so the site's
// instant tab switching could only ever give the app a head start. The page
// asks for a tab exactly as it does in Safari, by POSTing {path, warm} to
// WARM_PATH; the shell intercepts that ask, loads the tab in a hidden view,
// and swaps the view in when the page navigates there. instant-nav.js (THE
// DESKTOP APP) is the site's half of the contract.

// ⚠ Both spellings are the site's: WARM_PATH is instant-nav.js's WARM_PATH,
// PRELOAD_HEADER its DESKTOP_PRELOAD_HEADER. test/desktop-app.test.js fails
// the build if either drifts — a rename on one side alone breaks nothing
// loudly, the app simply stops being instant.
const WARM_PATH = "/api/warm";
const PRELOAD_HEADER = "x-cn-desktop-preload";

// The page's own lifetimes for what it asked for (instant-nav.js TTL_MS and
// WARM_TTL_MS): a tab the pointer rested on, and the likely next tab.
const TTL_MS = 30 * 1000;
const WARM_TTL_MS = 60 * 1000;
// Hidden views held at once. The page asks for at most two tabs it was
// pointed at plus its warm one, and each view is a renderer process.
const MAX_VIEWS = 3;
// How long a click waits for a hidden view still loading before it gives up
// on it and navigates normally. The old page stays on screen meanwhile, as it
// would during any navigation.
const READY_WAIT_MS = 5000;

// A tab path the page may ask for: a lowercase path with no query, no
// fragment and nothing that could leave the origin. The server re-checks
// against its own tab list and answers anything else with an empty 204.
const PATH_RE = /^\/[a-z0-9-]{0,40}$/;

// What one POST to WARM_PATH asks the shell to do: {drop: true} after a write
// on the page (throw away everything built), {path, warm} to build a tab, or
// null for anything else.
function parseSignal(text) {
  let o;
  try { o = JSON.parse(String(text || "")); } catch (_) { return null; }
  if (!o || typeof o !== "object") return null;
  if (o.drop === true) return { drop: true };
  if (typeof o.path !== "string" || !PATH_RE.test(o.path)) return null;
  return { path: o.path, warm: o.warm === true };
}

// The tab a navigation is heading to, if a built tab could stand in for it:
// same origin, a plain path, no query and no fragment (/desk?settings=1 opens
// a panel; that is not the tab that was built). Null otherwise.
function swapPath(rawUrl, origin) {
  let u;
  try { u = new URL(rawUrl); } catch (_) { return null; }
  if (u.origin !== origin || u.search || u.hash) return null;
  return PATH_RE.test(u.pathname) ? u.pathname : null;
}

// The views held, by path. Adding past `max` evicts a tab the pointer rested
// on before the warm one — the warm tab is the one most likely to be opened —
// and never the entry being added. Entries are the caller's objects
// ({ path, warm, ... }); the pool only decides which to keep.
function createPool(opts) {
  const max = (opts && opts.max) || MAX_VIEWS;
  const held = new Map();
  return {
    get(path) { return held.get(path) || null; },
    add(entry) {
      held.delete(entry.path);
      held.set(entry.path, entry);
      const evicted = [];
      while (held.size > max) {
        let victim = null;
        for (const [k, e] of held) {
          if (k === entry.path) continue;
          if (!e.warm) { victim = k; break; }
          if (!victim) victim = k;
        }
        if (!victim) break;
        evicted.push(held.get(victim));
        held.delete(victim);
      }
      return evicted;
    },
    // Removes `entry` only if it is still the one held for its path, so a
    // late cleanup of a replaced view never removes its replacement.
    remove(entry) {
      if (!entry || held.get(entry.path) !== entry) return false;
      held.delete(entry.path);
      return true;
    },
    values() { return [...held.values()]; },
    get size() { return held.size; },
  };
}

module.exports = {
  WARM_PATH, PRELOAD_HEADER, TTL_MS, WARM_TTL_MS, MAX_VIEWS, READY_WAIT_MS,
  parseSignal, swapPath, createPool,
};
