"use strict";

// Instant tab switching (2026-09-26, owner's ask: "make switching between
// tabs instantaneous — e.g. Workspace to Vault").
//
// Every tab in the rail is a separate document, and each one waits on the
// database before it sends a byte: /vault reads the whole book, /desk gathers
// DESK_BOOT, and the workspace is 1.38 MB of HTML (418 KB on the wire, served
// no-store, so it is fetched and compiled fresh every time). A click was a
// blank wait for all of that. Rewriting six server-rendered pages into one
// client-side app was never the answer; the browser can do the waiting early.
//
// THE MECHANISM: Chrome's speculation rules. A one-URL `prerender` rule makes
// the browser load and RUN that page in a hidden tab, and a click on the link
// then swaps the finished page in: no request, no parse, no paint wait.
// Measured in Chromium against a local server with a seeded Pro member
// (2026-09-26): Workspace -> Vault 450-530 ms before, ~20 ms prerendered;
// Vault -> Workspace 740-850 ms before, ~20 ms prerendered. Browsers that
// cannot prerender (Safari, Firefox) take the second half of this file
// instead: the server builds the tab ahead (see SAFARI AND FIREFOX below).
//
// Two triggers, because a prerender only helps if it is FINISHED by the click,
// and these pages take the server a moment to build:
//
//   - INTENT: a pointer resting on a tab (DWELL_MS), key focus, or the press
//     itself on touch. Enough on its own for a member who hovers before
//     clicking; a quick 300 ms hover-and-click got only a head start (the same
//     measurement: ~310 ms to the vault, ~600 ms to the workspace).
//   - WARM: the tab a member is most likely to want next is prerendered once
//     the page has loaded and gone quiet — the vault from the workspace, the
//     workspace from everywhere else (it is home). That is what makes the
//     owner's own example, Workspace <-> Vault, instant on a quick click. It
//     lives WARM_TTL_MS and is re-armed only when the pointer enters the nav,
//     so it costs one background render per page view plus at most one a
//     minute while the member is actually reaching for a tab — never a
//     standing poll, and never for a link the member cannot see (the vault
//     row is hidden without the entitlement, so it is never warmed for them).

// A prerendered page is a real page that nobody has looked at yet, so three
// rules keep it from acting as though somebody had:
//
//   1. NOTHING IS WRITTEN FROM AN UNSEEN PAGE. While `document.prerendering`,
//      every non-GET fetch waits for activation. Pages do write on load — the
//      vault stamps the watchlist feed SEEN, and last_seen_at is a cutoff the
//      digest mails from, so a hover alone would have cost a member the email
//      about their own new comps. Deferring at fetch() covers every page's
//      boot without auditing each one (and without the next page having to
//      remember). The one thing it cannot see is a GET that writes, so those
//      are named: HOLD_PATHS wait too.
//   2. A VISIT IS COUNTED WHEN IT IS SEEN. The page routes log vault_visit and
//      friends on GET, and the funnel those feed is the question "does anyone
//      reach this page". A speculative GET (Sec-Purpose: prefetch…) parks the
//      event under a one-time token instead (createVisitDeferrals), and the
//      page posts the token to /api/visit on activation. A hover that never
//      became a click logs nothing. The event keeps the kind, dimensions,
//      visitor and user the ORIGINAL request resolved — the server decides
//      what is logged, the browser only says "now".
//   3. A PRERENDER NEVER OUTLIVES WHAT IT SHOWS. Rules are dropped (which
//      cancels the prerender) after TTL_MS (WARM_TTL_MS for the warm one),
//      when more than MAX_LIVE intent prerenders are held, when the page is
//      hidden, and after ANY write from the page that holds them completes —
//      a signed-out member must not click into a vault rendered with the old
//      session, and a building added on the desk must be on /buildings when
//      they get there. The next hover simply prerenders again.
//
// One thing that is NOT a bug if you are testing this: Chrome refuses every
// prerender while a DevTools client is attached (status
// PrerenderingDisabledByDevTools — Playwright, Puppeteer and scripts/shot.js
// all attach one), and cancels one whose page hits a certificate error on any
// subresource, which a TLS-intercepting proxy in front of Google Fonts or
// unpkg causes. Measure with no DevTools, on a network that trusts its certs.
//
// Member pages only (cookie presence, the rail's own rule): the tabs are the
// product's, and a stranger reading a marketing page should not cost the
// server six database-backed renders by sweeping a pointer across a header.

const TAB_PATHS = ["/", "/desk", "/vault", "/messages", "/markets", "/bulk", "/permits", "/buildings"];
// GET routes that WRITE, which the fetch guard would otherwise wave through
// from a page nobody has opened (audited 2026-09-26, every GET in server.js).
// The two that matter most treat a read as evidence somebody is looking:
// opening a thread stamps msg_thread_members.last_read_at ("READING A THREAD
// IS READING IT", on every poll, since a poll only fires from a visible tab)
// and opening a deal room runs stampHubView/stampHubSeen — both cut off
// follow-up mail, and the Messages page opens its newest conversation on load
// (Cursor security review, PR #340). The rest are housekeeping the vault and
// bulk pages trigger on load: /api/broker/me adopts a legacy profile,
// /api/broker/leads and /api/broker/bovs seed coverage and the BOV log when
// empty (coverage decides who gets lead-alert mail), and /api/bulk marks a
// stalled job interrupted. While unseen all of them wait exactly as a write
// does; once shown they are ordinary reads. A new GET that writes belongs
// here — test/instant-nav.test.js pins each against its GET route in
// server.js. (Writes a page's SERVER render makes cannot be held from the
// browser: those check isSpeculative, as /vault's backfills do.)
const HOLD_PATHS = [
  "/api/messages/thread", "/api/hub",
  "/api/broker/me", "/api/broker/leads", "/api/broker/bovs", "/api/bulk",
];
const DWELL_MS = 65;
const MAX_LIVE = 2;
const TTL_MS = 30 * 1000;
const WARM_TTL_MS = 60 * 1000;
// After `load`, so the warm-up never competes with the page being opened.
const WARM_DELAY_MS = 1500;
// Where a browser that cannot prerender asks for a page to be built early.
const WARM_PATH = "/api/warm";
// The server-side store for those pages. A workspace render is ~1.4 MB, so
// this is ~20 of them at most; the oldest go first past it.
const WARM_MAX_BYTES = 32 * 1024 * 1024;

// Does this request come from a speculation (prefetch or prerender) rather
// than a person? Chrome sends `Sec-Purpose: prefetch;prerender` for a
// prerender and `Sec-Purpose: prefetch` for a prefetch; `Purpose: prefetch` is
// the older spelling. A prefetched document that is then navigated to is
// shown with document.prerendering false, so the same deferred tag still
// fires — which is right: that one was a visit.
function isSpeculative(headers) {
  const h = headers || {};
  return /(^|[\s;,])prefetch($|[\s;,])/i.test(String(h["sec-purpose"] || h["purpose"] || ""));
}

// One-time tokens for visit events a speculative GET held back. In memory on
// purpose: losing some to a restart undercounts, which is the safe direction
// for a funnel (a hover never becomes a visit). Every entry has the same
// lifetime, so insertion order IS expiry order and the sweep stops at the
// first live one.
function createVisitDeferrals(opts) {
  const o = opts || {};
  const ttlMs = o.ttlMs || 10 * 60 * 1000;
  const max = o.max || 5000;
  const now = o.now || Date.now;
  const newToken = o.newToken || (() => require("crypto").randomBytes(16).toString("hex"));
  const held = new Map();
  function sweep() {
    const t = now();
    for (const [k, v] of held) {
      if (v.exp > t) break;
      held.delete(k);
    }
  }
  return {
    defer(record) {
      sweep();
      while (held.size >= max) held.delete(held.keys().next().value);
      const token = newToken();
      held.set(token, { record, exp: now() + ttlMs });
      return token;
    },
    // Consumed on first use: a replayed token logs nothing.
    take(token) {
      sweep();
      const k = String(token == null ? "" : token).trim();
      const v = held.get(k);
      if (!v) return null;
      held.delete(k);
      return v.record;
    },
    get size() { return held.size; },
  };
}

// SAFARI AND FIREFOX (2026-09-26, the owner's "make it work in Safari too").
// Neither can prerender: WebKit and Gecko implement no `document.prerendering`
// and no prerender rule, so the browser half above has nothing to insert. What
// they CAN be spared is the biggest part of the wait, the server building the
// page from the database. So the same triggers (a resting pointer, focus, a
// press, the warm tab after load) POST the path to WARM_PATH instead, the
// server renders that page for that visitor in the background — over
// loopback, as `Purpose: prefetch`, exactly what a prerender's own request
// would be — and holds the finished response here. The click's navigation is
// then answered from memory the moment it arrives, or joins the render still
// in flight rather than starting a second (for at most WARM_JOIN_MAX_MS in
// server.js, then it renders fresh). What is left is the network and the
// browser's own parse, which no server can do for it — measured in Chromium
// with prerendering switched off to stand in for Safari, against the same
// seeded local server: Workspace -> Vault 515-613 ms before, 199-365 ms
// after; Vault -> Workspace 800-1030 ms before, 380-500 ms after. Faster,
// not instant: only a browser that can prerender gets instant.
//
// The store's rules, all tested (the I/O lives in server.js):
//   - KEYED ON THE WHOLE COOKIE HEADER plus the path, so a response only ever
//     goes back to a request carrying exactly the cookies it was rendered
//     with (the session, and the admin unlock, which changes what renders).
//     Anything different is a miss, and a miss is simply a normal render.
//   - SINGLE USE, and short-lived: the hover TTL or the warm one, never more.
//     A second navigation to the same tab renders fresh.
//   - DROPPED BY ANY WRITE from the same cookie (server.js calls dropPrefix on
//     every non-GET and every held GET), so a page built before a save is
//     never shown after it — sign-out included.
//   - A failed or unusable render (not a 200 HTML page, or one that sets a
//     cookie) is forgotten, and the navigation renders normally.
//   - Bounded by bytes, oldest first.
function createWarmCache(opts) {
  const o = opts || {};
  const now = o.now || Date.now;
  const maxBytes = o.maxBytes || WARM_MAX_BYTES;
  const held = new Map(); // key -> { promise, exp, bytes }
  let total = 0;
  function remove(key) {
    const e = held.get(key);
    if (!e) return;
    total -= e.bytes;
    held.delete(key);
  }
  function sweep() {
    const t = now();
    for (const [k, e] of held) if (e.exp <= t) remove(k);
  }
  return {
    // Holds the promise `make()` returns (a response or null) under `key`.
    // An entry already held is kept — `make` is not called, so a second hover
    // never starts a second render — and lives the longer of the two TTLs: a
    // hover that becomes the warm tab must not expire on the hover's clock.
    start(key, make, ttlMs) {
      sweep();
      const exp = now() + ttlMs;
      const had = held.get(key);
      if (had) { had.exp = Math.max(had.exp, exp); return false; }
      const promise = Promise.resolve().then(make);
      const entry = { promise, exp, bytes: 0 };
      held.set(key, entry);
      promise.then((hit) => {
        if (held.get(key) !== entry) return;
        if (!hit || !hit.body) { remove(key); return; }
        entry.bytes = hit.body.length;
        total += entry.bytes;
        for (const [k, e] of held) {
          if (total <= maxBytes) break;
          if (k !== key && e.bytes > 0) remove(k);
        }
        if (total > maxBytes) remove(key);
      }, () => { if (held.get(key) === entry) remove(key); });
      return true;
    },
    // The held promise for `key`, removed as it is handed over; null if there
    // is none or it has expired.
    take(key) {
      sweep();
      const e = held.get(key);
      if (!e) return null;
      remove(key);
      return e.promise;
    },
    has(key) { sweep(); return held.has(key); },
    // Every entry for one cookie: `prefix` is the cookie part of the key.
    dropPrefix(prefix) {
      for (const k of [...held.keys()]) if (k.startsWith(prefix)) remove(k);
    },
    get size() { return held.size; },
    get bytes() { return total; },
  };
}

// THE DESKTOP APP (2026-09-26, the owner's "make it instant for the desktop
// app too"). desktop-app/ is Electron, and Electron has no prerendering at
// all: measured on Electron 43, a speculation rule makes it fetch the HTML
// and nothing more (never `prerendered`, even after a 1.5 s hover), so the
// app got a head start and never the instant switch. There is no switch to
// turn it on, so the shell does it itself: when the page asks for a tab (the
// warm path above, which the app always takes) the shell loads that tab in a
// hidden view, and when the page navigates there it swaps the hidden view in.
//
// The hidden view's request carries DESKTOP_PRELOAD_HEADER. The server answers
// it ONLY through the warm store (a speculative render, so the visit is parked
// and /vault skips its backfills) with desktopPreloadScript() injected first
// in <head>, and with an empty 204 for anything it cannot answer that way —
// a hidden page without the script would run unguarded. The script is the
// one piece of Chrome's prerender the page needs: `document.prerendering` is
// true until the shell calls window.__cnShow(), which fires
// `prerenderingchange`. So the fetch guard, the held reads and the visit tag
// all work in the hidden view exactly as they do in a Chrome prerender, with
// no preload script and no IPC in the app (its security posture stands).
// Nothing but the shell sends the header, and a page that sends it for
// itself only makes its own tab wait for a show that never comes.
const DESKTOP_PRELOAD_HEADER = "x-cn-desktop-preload";

function desktopPreloadBoot() {
  var unseen = true;
  try {
    Object.defineProperty(Document.prototype, "prerendering", {
      configurable: true, get: function () { return unseen; },
    });
  } catch (e) {}
  try {
    Object.defineProperty(window, "__cnShow", {
      value: function () {
        if (!unseen) return false;
        unseen = false;
        window.__cnShown = true;
        document.dispatchEvent(new Event("prerenderingchange"));
        return true;
      },
    });
  } catch (e) {}
}
function desktopPreloadScript() {
  return `<script>(${desktopPreloadBoot.toString()})();</script>`;
}
// The script goes FIRST in <head>: before THEME_BOOT, before the instant-nav
// boot and every page script, because each of them reads
// `document.prerendering` at the moment it runs. Null when there is no <head>
// to put it in — the caller then refuses to serve the page at all.
function injectFirstInHead(html) {
  const s = String(html);
  const m = /<head[^>]*>/i.exec(s);
  if (!m) return null;
  const at = m.index + m[0].length;
  return s.slice(0, at) + desktopPreloadScript() + s.slice(at);
}

// The tag a deferred visit rides down in: posts its token once the page is
// actually shown. Self-contained (it does not lean on the boot script below),
// because Chrome also prerenders from its own address bar, on pages and for
// visitors the boot script never reaches.
function visitTag(token) {
  if (!/^[0-9a-f]{32}$/.test(String(token || ""))) return "";
  return `<script>(function(t){function go(){try{fetch("/api/visit",{method:"POST",` +
    `credentials:"same-origin",headers:{"content-type":"text/plain"},body:t,keepalive:true})` +
    `.catch(function(){})}catch(e){}}` +
    `if(document.prerendering)document.addEventListener("prerenderingchange",go,{once:true});` +
    `else go();})("${token}");</script>`;
}

// THE BROWSER HALF. Serialized with Function#toString into an inline <script>
// in <head> (bootScript below), so it must reference nothing outside itself,
// and its comments live up here rather than in it: everything inside the
// braces is sent with every member page. `win` exists for the tests, which
// drive it with a stand-in window; in a page it is undefined and the real
// window is used. ES5 on purpose: it runs before anything else on the page,
// and a syntax error here would take the page's fetch with it.
//
// In order:
//   - the fetch wrapper, on EVERY page (rule 1, and the write half of rule 3):
//     a non-GET made while unseen waits for `prerenderingchange`, and so
//     does a GET to one of cfg.hold (the GETs that write); any of those
//     that LANDS drops every tab this page is holding — a held GET too,
//     because it wrote, and because the server's routeWarm drops its copies
//     on exactly the same requests: a browser still believing in a copy the
//     server threw away would never ask for it again (Cursor Bugbot,
//     PR #342: the Messages page polls a thread every 15 s). The next reach
//     for the nav asks again, so this is never a standing rebuild;
//   - isDesktop: the desktop app (its UA token, cfg.desktopToken). Electron
//     parses speculation rules and has `document.prerendering`, yet never
//     prerenders — it fetches the HTML and stops — so it takes the warm path,
//     which the app's own shell turns into a real prerender (DESKTOP APP
//     below). After a write it also tells the shell to throw away what it
//     built ({"drop":true} to cfg.warmPath: the one signal the shell can see);
//   - canPrerender: Chrome/Edge (`document.prerendering` exists AND speculation
//     rules parse, and not the desktop app). Everything below then runs the same for every browser
//     except prerender()'s one action: a speculation rule where it can,
//     otherwise warmOnServer() — a POST to cfg.warmPath with the ORIGINAL
//     fetch, so asking for a page is not a write and drops nothing, and
//     `keepalive` so the ask survives the click's navigation starting;
//   - target(): the URL worth prerendering for a link. Only a plain
//     same-origin link to a tab — never the page already showing (by path, by
//     aria-current, or a `skip` path the page handles in place: the app's own
//     Workspace row swaps views without navigating), never a query string
//     (/desk?settings=1 opens a panel), never one that opens elsewhere;
//   - prerender(): one list rule per URL, deduplicated, dropped after its TTL;
//     intent ones FIFO past maxLive, the warm one outside that count so a
//     sweep of hovers cannot evict it. Warming a URL already held for intent
//     PROMOTES that entry (warm flag, warm TTL) rather than adopting it as
//     is, or it would still sit in the FIFO (Cursor Bugbot, PR #340). No
//     `eagerness` key — a list rule
//     already defaults to immediate, and a browser that predates the key
//     would discard the whole rule over it;
//   - warm(): the first of cfg.warm with a link on the page that is actually
//     RENDERED (getClientRects — a `hidden`/display:none row has none), only
//     while the page is visible and itself not a prerender;
//   - soon(): a pointer RESTING on a tab (dwellMs), not one crossing the rail
//     on its way elsewhere. Landing on anything that is not that tab,
//     including a non-link, resets the wait, so there is no pointerout
//     bookkeeping. Keyboard focus waits the same way; a press (and on touch
//     it is the only signal there is) prerenders at once. A pointer entering
//     the nav re-arms an expired warm-up.
function instantNavBoot(cfg, win) {
  var w = win || window;
  var d = w.document;
  var live = [];
  function drop(entry) {
    w.clearTimeout(entry.timer);
    var i = live.indexOf(entry);
    if (i >= 0) live.splice(i, 1);
    if (entry.el && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
  }
  function dropAll() { while (live.length) drop(live[0]); }
  var isDesktop = !!cfg.desktopToken && String((w.navigator && w.navigator.userAgent) || "").indexOf(cfg.desktopToken) >= 0;
  function afterWrite() {
    dropAll();
    if (isDesktop) {
      try {
        F.call(w, cfg.warmPath, {
          method: "POST", credentials: "same-origin", keepalive: true,
          headers: { "content-type": "application/json" }, body: "{\"drop\":true}",
        }).catch(function () {});
      } catch (e) {}
    }
  }

  var F = w.fetch;
  if (typeof F === "function") {
    w.fetch = function (input, init) {
      var args = arguments;
      var m = String((init && init.method) || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
      var write = m !== "GET" && m !== "HEAD";
      var held = false;
      if (!write) {
        try {
          var path = new w.URL(typeof input === "string" ? input : (input && input.url) || String(input), w.location.href).pathname;
          held = cfg.hold.indexOf(path) >= 0;
        } catch (e) {}
      }
      if (!write && !held) return F.apply(w, args);
      var p = d.prerendering
        ? new Promise(function (resolve) { d.addEventListener("prerenderingchange", function () { resolve(); }, { once: true }); })
            .then(function () { return F.apply(w, args); })
        : F.apply(w, args);
      p.then(afterWrite, afterWrite);
      return p;
    };
  }

  var S = w.HTMLScriptElement;
  var canPrerender = !isDesktop && "prerendering" in d && !!S && typeof S.supports === "function" && S.supports("speculationrules");
  if (!canPrerender && typeof F !== "function") return;

  function target(el) {
    var a = el && el.closest ? el.closest("a[href]") : null;
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")
        || a.getAttribute("aria-current") === "page") return "";
    var u;
    try { u = new w.URL(a.href, w.location.href); } catch (e) { return ""; }
    if (u.origin !== w.location.origin || u.search || u.hash) return "";
    if (cfg.tabs.indexOf(u.pathname) < 0 || cfg.skip.indexOf(u.pathname) >= 0
        || u.pathname === w.location.pathname) return "";
    return u.href;
  }

  function expire(entry, ms) {
    w.clearTimeout(entry.timer);
    entry.timer = w.setTimeout(function () { drop(entry); }, ms);
  }
  function warmOnServer(url, isWarm) {
    try {
      F.call(w, cfg.warmPath, {
        method: "POST", credentials: "same-origin", keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: new w.URL(url).pathname, warm: Boolean(isWarm) }),
      }).catch(function () {});
    } catch (e) {}
  }
  function prerender(url, isWarm) {
    if (!url) return null;
    for (var i = 0; i < live.length; i++) {
      if (live[i].url !== url) continue;
      if (isWarm && !live[i].warm) {
        live[i].warm = true;
        expire(live[i], cfg.warmTtlMs);
        if (!canPrerender) warmOnServer(url, true);
      }
      return live[i];
    }
    var s = null;
    if (canPrerender) {
      s = d.createElement("script");
      s.type = "speculationrules";
      s.textContent = JSON.stringify({ prerender: [{ source: "list", urls: [url] }] });
      d.head.appendChild(s);
    } else {
      warmOnServer(url, isWarm);
    }
    var entry = { url: url, el: s, timer: 0, warm: Boolean(isWarm) };
    expire(entry, isWarm ? cfg.warmTtlMs : cfg.ttlMs);
    live.push(entry);
    var intent = [];
    for (var j = 0; j < live.length; j++) if (!live[j].warm) intent.push(live[j]);
    while (intent.length > cfg.maxLive) drop(intent.shift());
    return entry;
  }

  var warmed = null;
  function warm() {
    if (d.hidden || d.prerendering || (warmed && live.indexOf(warmed) >= 0)) return;
    var links = d.querySelectorAll("a[href]");
    for (var i = 0; i < cfg.warm.length; i++) {
      var want = new w.URL(cfg.warm[i], w.location.href).href;
      for (var k = 0; k < links.length; k++) {
        if (target(links[k]) === want && links[k].getClientRects().length) { warmed = prerender(want, true); return; }
      }
    }
  }
  function armWarm() { w.setTimeout(warm, cfg.warmDelayMs); }
  function afterLoad() {
    if (d.readyState === "complete") armWarm();
    else w.addEventListener("load", armWarm, { once: true });
  }
  if (d.prerendering) d.addEventListener("prerenderingchange", afterLoad, { once: true });
  else afterLoad();
  d.addEventListener("visibilitychange", function () { if (d.hidden && warmed) drop(warmed); });

  var pending = 0;
  var pendingUrl = "";
  function soon(url) {
    if (url === pendingUrl) return;
    w.clearTimeout(pending);
    pendingUrl = url;
    if (url) pending = w.setTimeout(function () { pendingUrl = ""; prerender(url); }, cfg.dwellMs);
  }
  var opt = { capture: true, passive: true };
  d.addEventListener("pointerover", function (e) {
    if (e.target && e.target.closest && e.target.closest("nav")) warm();
    if (e.pointerType !== "touch") soon(target(e.target));
  }, opt);
  d.addEventListener("focusin", function (e) { soon(target(e.target)); }, opt);
  d.addEventListener("pointerdown", function (e) { prerender(target(e.target)); }, opt);
}

// The inline <script> for a member page's <head>. `skip` names paths the page
// handles without navigating (index.html's "/" and "/desk"); `warm` is the tab
// to have ready before anyone reaches for it, in order of preference.
function bootScript(opts) {
  const cfg = {
    tabs: TAB_PATHS,
    hold: HOLD_PATHS,
    skip: (opts && opts.skip) || [],
    warm: (opts && opts.warm) || [],
    dwellMs: DWELL_MS,
    maxLive: MAX_LIVE,
    ttlMs: TTL_MS,
    warmTtlMs: WARM_TTL_MS,
    warmDelayMs: WARM_DELAY_MS,
    warmPath: WARM_PATH,
    desktopToken: (opts && opts.desktopToken) || "",
  };
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
  return `<script>try{(${instantNavBoot.toString()})(${json});}catch(e){}</script>\n`;
}

module.exports = {
  TAB_PATHS, HOLD_PATHS, DWELL_MS, MAX_LIVE, TTL_MS, WARM_TTL_MS, WARM_DELAY_MS,
  WARM_PATH, WARM_MAX_BYTES, DESKTOP_PRELOAD_HEADER,
  desktopPreloadBoot, desktopPreloadScript, injectFirstInHead,
  isSpeculative, createVisitDeferrals, createWarmCache, visitTag, instantNavBoot, bootScript,
};
