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
// Vault -> Workspace 740-850 ms before, ~20 ms prerendered. Browsers without
// speculation rules (Safari, Firefox) skip all of it and behave as before.
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
//      remember).
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
const DWELL_MS = 65;
const MAX_LIVE = 2;
const TTL_MS = 30 * 1000;
const WARM_TTL_MS = 60 * 1000;
// After `load`, so the warm-up never competes with the page being opened.
const WARM_DELAY_MS = 1500;

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
//     a non-GET made while unseen waits for `prerenderingchange`, and any
//     non-GET that lands drops every prerender this page is holding;
//   - nothing further without speculation rules (Safari, Firefox);
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
    if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
  }
  function dropAll() { while (live.length) drop(live[0]); }

  var F = w.fetch;
  if (typeof F === "function") {
    w.fetch = function (input, init) {
      var args = arguments;
      var m = String((init && init.method) || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
      if (m === "GET" || m === "HEAD") return F.apply(w, args);
      var p = d.prerendering
        ? new Promise(function (resolve) { d.addEventListener("prerenderingchange", function () { resolve(); }, { once: true }); })
            .then(function () { return F.apply(w, args); })
        : F.apply(w, args);
      p.then(dropAll, dropAll);
      return p;
    };
  }

  var S = w.HTMLScriptElement;
  if (!S || typeof S.supports !== "function" || !S.supports("speculationrules")) return;

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
  function prerender(url, isWarm) {
    if (!url) return null;
    for (var i = 0; i < live.length; i++) {
      if (live[i].url !== url) continue;
      if (isWarm && !live[i].warm) { live[i].warm = true; expire(live[i], cfg.warmTtlMs); }
      return live[i];
    }
    var s = d.createElement("script");
    s.type = "speculationrules";
    s.textContent = JSON.stringify({ prerender: [{ source: "list", urls: [url] }] });
    d.head.appendChild(s);
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
    skip: (opts && opts.skip) || [],
    warm: (opts && opts.warm) || [],
    dwellMs: DWELL_MS,
    maxLive: MAX_LIVE,
    ttlMs: TTL_MS,
    warmTtlMs: WARM_TTL_MS,
    warmDelayMs: WARM_DELAY_MS,
  };
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
  return `<script>try{(${instantNavBoot.toString()})(${json});}catch(e){}</script>\n`;
}

module.exports = {
  TAB_PATHS, DWELL_MS, MAX_LIVE, TTL_MS, WARM_TTL_MS, WARM_DELAY_MS,
  isSpeculative, createVisitDeferrals, visitTag, instantNavBoot, bootScript,
};
