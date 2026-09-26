"use strict";

// Instant tab switching (instant-nav.js). Three things are pinned here, in
// the order they can go wrong:
//
//   - the BROWSER half, driven with a stand-in window: which pointer and key
//     events prerender which tab, how many are held and for how long, and —
//     the part that matters most — that a page being prerendered writes
//     nothing until somebody sees it, and that a write drops what was
//     prerendered before it;
//   - the SERVER half: a speculative GET parks its page-visit event under a
//     one-time token, and /api/visit logs it exactly once, on a real server;
//   - the WIRING: both shells carry the script for a member and nobody else,
//     and no page visit is logged around logPageVisit.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const NAV = require("../instant-nav");
const shared = require("./helpers/boot");

const root = path.join(__dirname, "..");
const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");
const indexSrc = fs.readFileSync(path.join(root, "index.html"), "utf8");

const ORIGIN = "https://compninja.co";
const CFG = {
  tabs: NAV.TAB_PATHS, hold: NAV.HOLD_PATHS, skip: [], warm: [], warmPath: NAV.WARM_PATH, dwellMs: NAV.DWELL_MS, maxLive: NAV.MAX_LIVE,
  ttlMs: NAV.TTL_MS, warmTtlMs: NAV.WARM_TTL_MS, warmDelayMs: NAV.WARM_DELAY_MS,
};

// A window with just enough of a DOM for instantNavBoot: listeners, a <head>
// that holds scripts, the page's links, manual timers, and a fetch that
// records its calls.
// `safari: true` is a browser with no prerendering at all: no speculation
// rules and no `document.prerendering` property (WebKit, Gecko).
function stage({ path: at = "/vault", supports = true, prerendering = false, skip = [], warm = [],
  links = [], readyState = "complete", hidden = false, safari = false } = {}) {
  if (safari) supports = false;
  const listeners = {};
  const winListeners = {};
  const timers = [];
  let nextId = 0;
  const head = {
    children: [],
    appendChild(el) { el.parentNode = head; head.children.push(el); },
    removeChild(el) { head.children.splice(head.children.indexOf(el), 1); el.parentNode = null; },
  };
  const document = {
    prerendering,
    readyState,
    hidden,
    head,
    querySelectorAll: () => links,
    createElement: (tag) => ({ tagName: tag, type: "", textContent: "", parentNode: null }),
    addEventListener(type, fn, opts) {
      (listeners[type] = listeners[type] || []).push({ fn, once: Boolean(opts && opts.once) });
    },
  };
  if (safari) delete document.prerendering;
  const calls = [];
  const win = {
    document,
    location: new URL(ORIGIN + at),
    URL,
    HTMLScriptElement: supports ? { supports: (t) => t === "speculationrules" } : undefined,
    fetch(input, init) { calls.push({ input, init }); return Promise.resolve({ ok: true }); },
    setTimeout(fn, ms) { const id = ++nextId; timers.push({ id, fn, ms }); return id; },
    clearTimeout(id) { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
  };
  NAV.instantNavBoot({ ...CFG, skip, warm }, win);
  return {
    win, document, calls, listeners,
    fire(type, ev) {
      const ls = listeners[type] || [];
      listeners[type] = ls.filter((l) => !l.once);
      ls.forEach((l) => l.fn(ev || {}));
    },
    fireWindow(type) { (winListeners[type] || []).forEach((fn) => fn({})); },
    // Run every pending timer of at most `ms` (the dwell, or the TTL).
    tick(ms) {
      for (const t of timers.filter((x) => x.ms <= ms)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    },
    urls: () => head.children.map((s) => {
      assert.equal(s.type, "speculationrules");
      const rules = JSON.parse(s.textContent);
      assert.deepEqual(Object.keys(rules), ["prerender"], "prerender only — never a prefetch-and-discard");
      assert.equal(rules.prerender[0].source, "list");
      assert.ok(!("eagerness" in rules.prerender[0]), "an old browser drops a rule with a key it does not know");
      return rules.prerender[0].urls[0];
    }),
  };
}

const NAV_EL = { tagName: "NAV" };
// `shown: false` is a row the page has not revealed (the vault link before
// /api/config says the member may use it): display:none has no client rects.
function link(href, attrs = {}, { inNav = true, shown = true } = {}) {
  return {
    href: new URL(href, ORIGIN + "/").href,
    target: attrs.target || "",
    closest(sel) { return sel === "nav" ? (inNav ? NAV_EL : null) : this; },
    hasAttribute: (n) => n in attrs,
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    getClientRects: () => (shown ? [{}] : []),
  };
}
const NOT_A_LINK = { closest: () => null };
const NAV_GAP = { closest: (sel) => (sel === "nav" ? NAV_EL : null) };
const mouse = (el) => ({ target: el, pointerType: "mouse" });
const flush = () => new Promise((r) => setImmediate(r));

// --- The browser half: what gets prerendered -------------------------------

test("a pointer resting on a tab prerenders it, once", () => {
  const s = stage();
  s.fire("pointerover", mouse(link("/desk")));
  assert.deepEqual(s.urls(), [], "nothing before the dwell: a pointer crossing the rail is not intent");
  s.tick(NAV.DWELL_MS);
  assert.deepEqual(s.urls(), [ORIGIN + "/desk"]);
  // Leaving and coming back, or landing on a child of the same link (the
  // Messages row carries its unread dot inside it), never adds a second rule.
  s.fire("pointerover", mouse(NOT_A_LINK));
  s.fire("pointerover", mouse(link("/desk")));
  s.tick(NAV.DWELL_MS);
  assert.deepEqual(s.urls(), [ORIGIN + "/desk"]);
});

test("passing over a tab on the way somewhere else prerenders nothing", () => {
  const s = stage();
  s.fire("pointerover", mouse(link("/desk")));
  s.fire("pointerover", mouse(link("/messages")));
  s.fire("pointerover", mouse(NOT_A_LINK));
  s.tick(NAV.DWELL_MS);
  assert.deepEqual(s.urls(), []);
});

test("a press prerenders at once, and is the only signal on touch", () => {
  const s = stage();
  s.fire("pointerover", { target: link("/markets"), pointerType: "touch" });
  s.tick(NAV.DWELL_MS);
  assert.deepEqual(s.urls(), [], "a touch 'hover' is the tap itself arriving; the press handles it");
  s.fire("pointerdown", { target: link("/markets"), pointerType: "touch" });
  assert.deepEqual(s.urls(), [ORIGIN + "/markets"], "no dwell on a press");
});

test("keyboard focus on a tab waits like a pointer does", () => {
  const s = stage();
  s.fire("focusin", { target: link("/bulk") });
  s.tick(NAV.DWELL_MS);
  assert.deepEqual(s.urls(), [ORIGIN + "/bulk"]);
});

test("only a plain link to another tab qualifies", () => {
  const s = stage({ path: "/vault", skip: ["/"] });
  for (const [why, el] of [
    ["the page already showing", link("/vault")],
    ["aria-current", link("/permits", { "aria-current": "page" })],
    ["a path this page handles in place", link("/")],
    ["a query string (/desk?settings=1 opens a panel)", link("/desk?settings=1")],
    ["a fragment", link("/markets#map")],
    ["not a tab", link("/market/boise-id")],
    ["another origin", link("https://example.com/desk")],
    ["opens elsewhere", link("/desk", { target: "_blank" })],
    ["a download", link("/bulk", { download: "" })],
    ["not a link", NOT_A_LINK],
  ]) {
    s.fire("pointerdown", mouse(el));
    assert.deepEqual(s.urls(), [], why);
  }
});

test("every tab in the rail is one it will prerender", () => {
  // The rail's destinations, both shells. A tab missing here simply loads the
  // old way; this pins that the list is the rail and not a subset of it.
  for (const p of ["/desk", "/vault", "/messages", "/markets", "/bulk", "/permits"]) {
    assert.ok(NAV.TAB_PATHS.includes(p), p);
    assert.ok(indexSrc.includes(`href="${p}"`) || p === "/desk", `index.html has no ${p} row`);
  }
});

test("at most MAX_LIVE prerenders are held, oldest dropped first", () => {
  const s = stage({ path: "/permits" });
  s.fire("pointerdown", mouse(link("/desk")));
  s.fire("pointerdown", mouse(link("/vault")));
  s.fire("pointerdown", mouse(link("/messages")));
  assert.equal(NAV.MAX_LIVE, 2);
  assert.deepEqual(s.urls(), [ORIGIN + "/vault", ORIGIN + "/messages"]);
});

// --- The browser half: keeping the next tab warm ----------------------------

test("the likely next tab is warmed once the page has loaded and gone quiet", () => {
  const s = stage({ path: "/desk", skip: ["/", "/desk"], warm: ["/vault"], links: [link("/desk"), link("/vault")] });
  assert.deepEqual(s.urls(), [], "never while the page itself is still arriving");
  s.tick(NAV.WARM_DELAY_MS);
  assert.deepEqual(s.urls(), [ORIGIN + "/vault"], "the owner's own example: Workspace -> Vault");
});

test("a page still loading waits for its load event before warming", () => {
  const s = stage({ path: "/markets", warm: ["/desk"], links: [link("/desk")], readyState: "loading" });
  s.tick(NAV.WARM_DELAY_MS);
  assert.deepEqual(s.urls(), []);
  s.fireWindow("load");
  s.tick(NAV.WARM_DELAY_MS);
  assert.deepEqual(s.urls(), [ORIGIN + "/desk"]);
});

test("a tab the member cannot see is never warmed", () => {
  // The vault row ships hidden and is revealed by entitlement: a member
  // without the vault must not cost the server a vault render per page view.
  const s = stage({ path: "/desk", skip: ["/", "/desk"], warm: ["/vault"], links: [link("/vault", {}, { shown: false })] });
  s.tick(NAV.WARM_DELAY_MS);
  assert.deepEqual(s.urls(), []);
  const none = stage({ path: "/markets", warm: ["/desk"], links: [] });
  none.tick(NAV.WARM_DELAY_MS);
  assert.deepEqual(none.urls(), [], "or one with no link on the page at all");
});

test("a sweep of hovers cannot evict the warm tab", () => {
  const s = stage({ path: "/markets", warm: ["/desk"], links: [link("/desk")] });
  s.tick(NAV.WARM_DELAY_MS);
  for (const p of ["/vault", "/messages", "/permits"]) s.fire("pointerdown", mouse(link(p)));
  assert.deepEqual(s.urls(), [ORIGIN + "/desk", ORIGIN + "/messages", ORIGIN + "/permits"]);
  // And hovering the warm tab itself adds no second rule for it.
  s.fire("pointerdown", mouse(link("/desk")));
  assert.equal(s.urls().filter((u) => u === ORIGIN + "/desk").length, 1);
});

test("warming a tab already prerendered for a hover promotes it out of the FIFO", () => {
  // Cursor Bugbot, PR #340: the member rests on Workspace before the warm-up
  // fires, the warm-up finds that entry and must make it the warm one — or two
  // more hovers evict the tab that was meant to stay ready.
  const s = stage({ path: "/markets", warm: ["/desk"], links: [link("/desk")] });
  s.fire("pointerdown", mouse(link("/desk")));
  s.tick(NAV.WARM_DELAY_MS);
  for (const p of ["/vault", "/messages", "/permits"]) s.fire("pointerdown", mouse(link(p)));
  assert.deepEqual(s.urls(), [ORIGIN + "/desk", ORIGIN + "/messages", ORIGIN + "/permits"]);
  s.tick(NAV.TTL_MS);
  assert.ok(s.urls().includes(ORIGIN + "/desk"), "and it lives the warm TTL, not the hover one");
  s.tick(NAV.WARM_TTL_MS);
  assert.ok(!s.urls().includes(ORIGIN + "/desk"));
});

test("the warm tab expires, and only a pointer reaching for the nav re-arms it", () => {
  const s = stage({ path: "/vault", warm: ["/desk"], links: [link("/desk")] });
  s.tick(NAV.WARM_DELAY_MS);
  assert.deepEqual(s.urls(), [ORIGIN + "/desk"]);
  s.tick(NAV.WARM_TTL_MS);
  assert.deepEqual(s.urls(), [], "no standing poll: an idle page stops holding one");
  s.fire("pointerover", mouse(NOT_A_LINK));
  assert.deepEqual(s.urls(), [], "moving about the page is not reaching for a tab");
  s.fire("pointerover", mouse(NAV_GAP));
  assert.deepEqual(s.urls(), [ORIGIN + "/desk"], "entering the nav warms it again at once");
  s.fire("pointerover", mouse(NAV_GAP));
  assert.equal(s.urls().length, 1, "and only once while it lives");
});

test("a hidden page warms nothing, and hiding a page lets go of its warm tab", () => {
  const hidden = stage({ path: "/vault", warm: ["/desk"], links: [link("/desk")], hidden: true });
  hidden.tick(NAV.WARM_DELAY_MS);
  assert.deepEqual(hidden.urls(), []);
  const s = stage({ path: "/vault", warm: ["/desk"], links: [link("/desk")] });
  s.tick(NAV.WARM_DELAY_MS);
  s.document.hidden = true;
  s.fire("visibilitychange");
  assert.deepEqual(s.urls(), []);
});

test("a page that is itself a prerender warms nothing until it is shown", () => {
  const s = stage({ path: "/vault", warm: ["/desk"], links: [link("/desk")], prerendering: true });
  s.tick(NAV.WARM_DELAY_MS);
  assert.deepEqual(s.urls(), [], "no chain of prerenders nobody asked for");
  s.document.prerendering = false;
  s.fire("prerenderingchange");
  s.tick(NAV.WARM_DELAY_MS);
  assert.deepEqual(s.urls(), [ORIGIN + "/desk"]);
});

test("a prerender is let go after TTL_MS, so a click much later loads fresh", () => {
  const s = stage();
  s.fire("pointerdown", mouse(link("/desk")));
  s.tick(NAV.TTL_MS - 1);
  assert.deepEqual(s.urls(), [ORIGIN + "/desk"]);
  s.tick(NAV.TTL_MS);
  assert.deepEqual(s.urls(), []);
});

test("a write that lands drops every prerender held before it", async () => {
  // Sign-out is a POST: a vault prerendered with the old session must not be
  // one click away afterwards. Likewise a building added on the desk.
  const s = stage();
  s.fire("pointerdown", mouse(link("/desk")));
  s.fire("pointerdown", mouse(link("/messages")));
  await s.win.fetch("/api/watchlist/feed");
  await flush();
  assert.equal(s.urls().length, 2, "a read changes nothing");
  await s.win.fetch("/api/logout", { method: "POST" });
  await flush();
  assert.deepEqual(s.urls(), []);
});

test("while prerendering, reads go out and writes wait until the page is shown", async () => {
  const s = stage({ prerendering: true });
  await s.win.fetch("/api/watchlist/feed");
  assert.equal(s.calls.length, 1, "a read runs while unseen — that is the point of prerendering");
  const posted = s.win.fetch("/api/watchlist/seen", { method: "POST" });
  const req = s.win.fetch({ url: "/api/x", method: "DELETE" });
  await flush();
  assert.equal(s.calls.length, 1, "no write may leave a page nobody has seen");
  s.document.prerendering = false;
  s.fire("prerenderingchange");
  await posted;
  await req;
  assert.equal(s.calls.length, 3);
  assert.equal(s.calls[1].init.method, "POST");
  assert.equal(s.calls[2].input.method, "DELETE", "a Request-shaped input is a write too");
});

test("while prerendering, a read that stamps read/seen waits like a write", async () => {
  // Cursor security review, PR #340: the Messages page opens its newest
  // conversation on load, and GET /api/messages/thread stamps last_read_at —
  // a hover on the Messages tab would have marked it read and cut off the
  // follow-up mail. Same for a deal room (GET /api/hub, stampHubSeen).
  const s = stage({ prerendering: true });
  const thread = s.win.fetch("/api/messages/thread?id=t1&after=");
  const room = s.win.fetch(ORIGIN + "/api/hub?id=abcdef");
  const list = s.win.fetch("/api/messages");
  await flush();
  assert.deepEqual(s.calls.map((c) => c.input), ["/api/messages"], "the list is a plain read and goes out");
  s.fire("pointerdown", mouse(link("/desk")));
  s.document.prerendering = false;
  s.fire("prerenderingchange");
  await thread; await room; await list;
  assert.deepEqual(s.calls.map((c) => c.input),
    ["/api/messages", "/api/messages/thread?id=t1&after=", ORIGIN + "/api/hub?id=abcdef"]);
  assert.equal(s.urls().length, 1, "a held READ is not a write: it drops nothing once it lands");
  // Once shown, those reads are what they always were.
  await s.win.fetch("/api/messages/thread?id=t2");
  assert.equal(s.calls.length, 4);
});

test("every held read is a real GET route that writes, in server.js", () => {
  // If one of these routes moves, the hold silently stops holding it. Each
  // pattern is the route line AND the write it makes, so a route that stops
  // writing can come off the list deliberately rather than by accident.
  const routes = {
    "/api/messages/thread": [/req\.method === "GET" && msgPath === "\/api\/messages\/thread"/, /READING A THREAD IS READING IT/],
    "/api/hub": [/req\.method === "GET" && hubPath === "\/api\/hub"\)/, /stampHubSeen\(id,/],
    "/api/broker/me": [/req\.method === "GET" && req\.url === "\/api\/broker\/me"/, /broker_profiles\?id=eq\./],
    "/api/broker/leads": [/req\.method === "GET" && req\.url\.split\("\?"\)\[0\] === "\/api\/broker\/leads"/, /broker_coverage\?on_conflict=/],
    "/api/broker/bovs": [/req\.url\.split\("\?"\)\[0\] === "\/api\/broker\/bovs"/, /broker_bovs\?on_conflict=/],
    "/api/bulk": [/req\.method === "GET" && path === "\/api\/bulk"/, /function reapStalledBulkJob|reapStalledBulkJob\(/],
  };
  assert.deepEqual(Object.keys(routes).sort(), [...NAV.HOLD_PATHS].sort());
  for (const [p, res] of Object.entries(routes)) {
    for (const re of res) assert.match(serverSrc, re, `${p}: ${re} no longer found`);
  }
  assert.ok(NAV.bootScript({}).includes(JSON.stringify(NAV.HOLD_PATHS)), "the served script carries the list");
});

test("a speculative /vault render does not run the vault's backfills", () => {
  // The page's own server render writes (geocode + building facts), which no
  // browser guard can hold. The workspace warms /vault on every view, and a
  // building the Census cannot place would be retried on each of those.
  assert.match(serverSrc, /async function attachPropertyCoords\(userId, comps, \{ backfill = true \} = \{\}\)/);
  assert.match(serverSrc, /if \(backfill\) scheduleBuildingFacts\(/);
  assert.match(serverSrc, /if \(backfill\) Promise\.resolve\(\)\.then\(\(\) => geocodeVaultPropertyRows\(/);
  assert.match(serverSrc, /attachPropertyCoords\(user\.id, rows,\s*\{ backfill: !INSTANTNAV\.isSpeculative\(req\.headers\) \}\)/);
});

test("the write guard holds wherever prerendering happens, with or without our rules", async () => {
  // Chrome also prerenders from its own address bar, on pages whose rules we
  // never wrote: the guard is installed first and for every browser.
  const s = stage({ supports: false, prerendering: true });
  const p = s.win.fetch("/api/x", { method: "POST" });
  await flush();
  assert.equal(s.calls.length, 0);
  s.document.prerendering = false;
  s.fire("prerenderingchange");
  await p;
  assert.equal(s.calls.length, 1);
});

// --- Safari and Firefox: the server builds the tab ahead -------------------

const warmPosts = (s) => s.calls.filter((c) => c.input === NAV.WARM_PATH).map((c) => {
  assert.equal(c.init.method, "POST");
  assert.equal(c.init.keepalive, true, "it must survive the click's own navigation starting");
  assert.equal(c.init.credentials, "same-origin");
  return JSON.parse(c.init.body);
});

test("without prerendering, a resting pointer asks the server to build the tab", () => {
  const s = stage({ safari: true });
  s.fire("pointerover", mouse(link("/desk")));
  assert.deepEqual(warmPosts(s), [], "not before the dwell");
  s.tick(NAV.DWELL_MS);
  assert.deepEqual(warmPosts(s), [{ path: "/desk", warm: false }]);
  assert.deepEqual(s.urls(), [], "and no speculation rule: this browser would ignore it");
  s.fire("pointerover", mouse(NOT_A_LINK));
  s.fire("pointerover", mouse(link("/desk")));
  s.tick(NAV.DWELL_MS);
  assert.equal(warmPosts(s).length, 1, "one render per tab while it lives");
  s.fire("pointerdown", { target: link("/messages"), pointerType: "touch" });
  assert.deepEqual(warmPosts(s)[1], { path: "/messages", warm: false }, "a tap asks at once");
});

test("without prerendering, the likely next tab is built after load, and a hovered one is promoted", () => {
  const s = stage({ safari: true, path: "/markets", warm: ["/desk"], links: [link("/desk")] });
  s.tick(NAV.WARM_DELAY_MS);
  assert.deepEqual(warmPosts(s), [{ path: "/desk", warm: true }]);
  const t = stage({ safari: true, path: "/markets", warm: ["/desk"], links: [link("/desk")] });
  t.fire("pointerdown", mouse(link("/desk")));
  t.tick(NAV.WARM_DELAY_MS);
  assert.deepEqual(warmPosts(t), [{ path: "/desk", warm: false }, { path: "/desk", warm: true }],
    "the server's copy must live the warm TTL too, so it is told");
});

test("without prerendering, asking the server is not a write, but a write forgets what was asked", async () => {
  const s = stage({ safari: true });
  s.fire("pointerdown", mouse(link("/desk")));
  await flush();
  s.fire("pointerdown", mouse(link("/desk")));
  assert.equal(warmPosts(s).length, 1, "the request for a page must not throw that page away");
  await s.win.fetch("/api/logout", { method: "POST" });
  await flush();
  s.fire("pointerdown", mouse(link("/desk")));
  assert.equal(warmPosts(s).length, 2, "after a write the next reach asks again (the server dropped its copy)");
});

test("the served script carries the warm path", () => {
  assert.ok(NAV.bootScript({}).includes(`"warmPath":"${NAV.WARM_PATH}"`));
  assert.equal(NAV.WARM_PATH, "/api/warm");
});

// --- The server's store for pages built ahead -----------------------------

test("a page built ahead is handed over once, and only before it expires", async () => {
  let now = 0;
  const c = NAV.createWarmCache({ now: () => now });
  const page = { status: 200, headers: {}, body: Buffer.from("<p>vault</p>") };
  let made = 0;
  assert.equal(c.start("k|/vault", () => { made++; return page; }, 30000), true);
  assert.equal(c.start("k|/vault", () => { made++; return page; }, 30000), false, "a second ask joins the first");
  await flush();
  assert.equal(made, 1, "…and never starts a second render");
  assert.equal(c.bytes, page.body.length);
  assert.equal(await c.take("k|/vault"), page);
  assert.equal(c.take("k|/vault"), null, "single use: the next visit renders fresh");
  assert.equal(c.bytes, 0);
  c.start("k|/desk", () => page, 30000);
  now = 30000;
  assert.equal(c.take("k|/desk"), null, "expired");
  assert.equal(c.size, 0);
});

test("a render still under way is joined, and a failed one is forgotten", async () => {
  const c = NAV.createWarmCache();
  let finish;
  c.start("k|/desk", () => new Promise((r) => { finish = r; }), 30000);
  await flush();
  const joined = c.take("k|/desk");
  assert.ok(joined, "a click during the render gets the render");
  finish({ status: 200, headers: {}, body: Buffer.from("x") });
  assert.equal((await joined).body.toString(), "x");
  c.start("k|/vault", () => null, 30000);
  await flush();
  assert.equal(c.has("k|/vault"), false, "an unusable render leaves nothing to hand over");
  c.start("k|/bulk", () => { throw new Error("boom"); }, 30000);
  await flush();
  assert.equal(c.has("k|/bulk"), false);
});

test("a hover that becomes the warm tab lives the warm TTL", async () => {
  let now = 0;
  const c = NAV.createWarmCache({ now: () => now });
  c.start("k|/desk", () => ({ status: 200, headers: {}, body: Buffer.from("x") }), NAV.TTL_MS);
  c.start("k|/desk", () => null, NAV.WARM_TTL_MS);
  now = NAV.TTL_MS + 1;
  assert.equal(c.has("k|/desk"), true);
  now = NAV.WARM_TTL_MS;
  assert.equal(c.has("k|/desk"), false);
});

test("the store drops one cookie's pages on a write, and stays inside its bytes", async () => {
  const c = NAV.createWarmCache({ maxBytes: 10 });
  const page = (n) => ({ status: 200, headers: {}, body: Buffer.alloc(n) });
  c.start("a|/desk", () => page(4), 30000);
  c.start("a|/vault", () => page(4), 30000);
  c.start("b|/desk", () => page(1), 30000);
  await flush();
  c.dropPrefix("a|");
  assert.equal(c.has("a|/desk") || c.has("a|/vault"), false);
  assert.equal(c.has("b|/desk"), true, "another visitor's page is theirs");
  c.start("c|/desk", () => page(6), 30000);
  c.start("c|/vault", () => page(6), 30000);
  await flush();
  assert.ok(c.bytes <= 10, `holding ${c.bytes} bytes`);
  assert.equal(c.has("c|/vault"), true, "the newest survives; the oldest go first");
  assert.equal(c.has("b|/desk"), false);
});

test("the served script compiles, runs first, and cannot end its own tag", () => {
  for (const html of [NAV.bootScript({ warm: ["/desk"] }), NAV.bootScript({ skip: ["/", "/desk"], warm: ["/vault"] })]) {
    assert.match(html, /^<script>try\{/);
    const js = html.replace(/^<script>/, "").replace(/<\/script>\n$/, "");
    assert.ok(!/<\/script/i.test(js));
    assert.doesNotThrow(() => new Function(js));
    assert.ok(!/defer|async/.test(html.slice(0, 20)), "inline and blocking: it wraps fetch before the page's own scripts run");
  }
  assert.match(NAV.bootScript({ skip: ["/", "/desk"] }), /"skip":\["\/","\/desk"\]/);
  assert.match(NAV.bootScript({ warm: ["/vault"] }), /"warm":\["\/vault"\]/);
});

// --- The server half: a visit is counted when it is seen -------------------

test("isSpeculative reads Chrome's prerender and prefetch headers, and nothing else", () => {
  assert.ok(NAV.isSpeculative({ "sec-purpose": "prefetch;prerender" }));
  assert.ok(NAV.isSpeculative({ "sec-purpose": "prefetch" }));
  assert.ok(NAV.isSpeculative({ "sec-purpose": "prefetch;anonymous-client-ip" }));
  assert.ok(NAV.isSpeculative({ purpose: "prefetch" }));
  assert.ok(!NAV.isSpeculative({}));
  assert.ok(!NAV.isSpeculative(undefined));
  assert.ok(!NAV.isSpeculative({ "sec-purpose": "prefetched-nothing" }));
});

test("a deferred visit is taken exactly once, and not after it expires", () => {
  let now = 1000;
  let n = 0;
  const v = NAV.createVisitDeferrals({ ttlMs: 50, max: 3, now: () => now, newToken: () => `t${++n}` });
  const a = v.defer({ kind: "vault_visit" });
  assert.deepEqual(v.take(a), { kind: "vault_visit" });
  assert.equal(v.take(a), null, "a replayed token logs nothing");
  assert.equal(v.take(""), null);
  assert.equal(v.take(undefined), null);
  const b = v.defer({ kind: "bulk_visit" });
  now += 50;
  assert.equal(v.take(b), null, "a prerender nobody opened within the TTL never counts");
  assert.equal(v.size, 0, "and it does not linger in memory");
  for (let i = 0; i < 5; i++) v.defer({ i });
  assert.equal(v.size, 3, "capped: a flood of speculative GETs cannot grow the map without bound");
});

test("the visit tag posts its token once the page is shown", () => {
  assert.equal(NAV.visitTag("not-a-token"), "");
  assert.equal(NAV.visitTag(""), "");
  const tag = NAV.visitTag("0123456789abcdef0123456789abcdef");
  assert.match(tag, /"\/api\/visit"/);
  assert.match(tag, /document\.prerendering/);
  assert.match(tag, /prerenderingchange/);
  assert.doesNotThrow(() => new Function(tag.replace(/^<script>/, "").replace(/<\/script>$/, "")));
});

// --- The wiring -------------------------------------------------------------

test("both shells carry the script for a member, from one source", () => {
  const shell = serverSrc.slice(serverSrc.indexOf("function marketShell("));
  const end = shell.indexOf("</head>");
  assert.match(shell.slice(0, end), /\(signedIn \? INSTANT_NAV_SHELL : ""\)/,
    "marketShell must emit it, and only for a member");
  assert.ok(indexSrc.includes("<!--INSTANT_NAV-->"), "index.html lost the marker");
  assert.match(serverSrc,
    /\.replace\(INSTANT_NAV_MARKER, parseCookies\(req\)\[SESSION_COOKIE\] \? INSTANT_NAV_APP : ""\)/);
  // Above every script of the page's own that could fetch.
  const marker = indexSrc.indexOf("<!--INSTANT_NAV-->");
  const firstSrc = indexSrc.indexOf("<script src=");
  assert.ok(marker > 0 && marker < firstSrc, "the marker must precede the page's scripts");
  assert.match(serverSrc,
    /const INSTANT_NAV_APP = INSTANTNAV\.bootScript\(\{ skip: \["\/", "\/desk"\], warm: \["\/vault"\] \}\)/,
    "the app handles / and /desk in place (a prerender of either is thrown away) and keeps the vault warm");
  assert.match(serverSrc, /const INSTANT_NAV_SHELL = INSTANTNAV\.bootScript\(\{ warm: \["\/desk"\] \}\)/,
    "every other page keeps the workspace warm: it is home");
});

test("every page writes through fetch, the one channel the prerender guard holds", () => {
  // Pages are prerendered before anyone sees them — the warm tab on EVERY
  // page view. The guard wraps fetch; a sendBeacon or an XMLHttpRequest on
  // load would slip past it and write from a page nobody opened.
  const files = fs.readdirSync(root).filter((f) => f.endsWith(".js") && f !== "instant-nav.js");
  files.push("index.html");
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.ok(!/sendBeacon\s*\(|XMLHttpRequest/.test(src),
      `${f} writes around the prerender guard: use fetch, which holds a write until the page is shown`);
  }
});

test("no page visit is logged around logPageVisit", () => {
  const kinds = ["bulk_visit", "messages_visit", "building_visit", "permits_visit", "buildings_visit", "vault_visit"];
  for (const k of kinds) {
    assert.ok(!serverSrc.includes(`logEvent("${k}"`), `${k} is logged on a speculative GET`);
    assert.ok(serverSrc.includes(`logPageVisit(req, "${k}"`), `${k} lost its logPageVisit`);
  }
  const visits = serverSrc.match(/logEvent\("[a-z_]+_visit"/g) || [];
  assert.deepEqual(visits, [], "a new *_visit event must go through logPageVisit");
  // And every page that parks one hands the tag down, or the visit is lost.
  const parked = (serverSrc.match(/const visitTag = logPageVisit\(/g) || []).length;
  const handed = (serverSrc.match(/\(boot\) \+ visitTag,/g) || []).length;
  assert.equal(parked, kinds.length);
  assert.equal(handed, kinds.length);
});

test("a prerendered page's visit counts on activation, once, on a real server", async (t) => {
  const srv = await shared.boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());
  const logFile = path.join(srv.dataDir, "analytics.jsonl");
  const visits = () => {
    try {
      return fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean)
        .map((l) => JSON.parse(l)).filter((r) => r.kind === "vault_visit");
    } catch (_) { return []; }
  };
  const waitFor = async (n) => {
    for (let i = 0; i < 40 && visits().length < n; i++) await new Promise((r) => setTimeout(r, 50));
    return visits().length;
  };

  await t.test("an ordinary GET logs at once and carries no tag", async () => {
    const html = await (await fetch(srv.base + "/vault")).text();
    assert.equal(await waitFor(1), 1);
    assert.ok(!html.includes("/api/visit"));
  });

  await t.test("a prerender logs nothing until its token comes back", async () => {
    const r = await fetch(srv.base + "/vault", { headers: { "sec-purpose": "prefetch;prerender" } });
    const html = await r.text();
    const m = html.match(/\}\)\("([0-9a-f]{32})"\);<\/script>/);
    assert.ok(m, "the page carries its visit tag");
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(visits().length, 1, "a hover is not a visit");

    const post = (body) => fetch(srv.base + "/api/visit", { method: "POST", body });
    assert.equal((await post(m[1])).status, 204);
    assert.equal(await waitFor(2), 2);
    const row = visits()[1];
    assert.equal(row.source, visits()[0].source, "the server's own verdict, not the browser's");

    assert.equal((await post(m[1])).status, 204, "a replay is answered the same way");
    assert.equal((await post("nonsense")).status, 204);
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(visits().length, 2, "and logs nothing");
  });

  await t.test("the script rides a member's pages and nobody else's", async () => {
    const anon = await (await fetch(srv.base + "/markets")).text();
    assert.ok(!anon.includes("speculationrules"), "a stranger's marketing page must not prerender");
    const member = await (await fetch(srv.base + "/markets", { headers: { cookie: "cn_session=x" } })).text();
    assert.ok(member.includes("speculationrules"));
    const app = await (await fetch(srv.base + "/?auth=signup")).text();
    assert.ok(!app.includes("<!--INSTANT_NAV-->"), "the marker is always replaced");
    assert.ok(!app.includes("speculationrules"));
    const memberApp = await (await fetch(srv.base + "/", { headers: { cookie: "cn_session=x" } })).text();
    assert.ok(memberApp.includes("speculationrules"));
    assert.ok(memberApp.indexOf("speculationrules") < memberApp.indexOf('<script src="/valuation.js">'));
  });
});

test("routeWarm runs before every route, and its render can never wait on itself", () => {
  const at = serverSrc.indexOf("const server = http.createServer(");
  const warm = serverSrc.indexOf("if (routeWarm(req, res,", at);
  const bind = serverSrc.indexOf("bindRequestListeners(req);", at);
  assert.ok(at > 0 && warm > at && warm < bind, "routeWarm must be the first thing a request meets");
  assert.match(serverSrc, /if \(!req\.headers\.cookie \|\| req\.headers\[WARM_HEADER\]\) return false;/,
    "the loopback render is marked, and a marked request is never served from (or joined to) the store");
  assert.match(serverSrc, /\[WARM_HEADER\]: "1",/);
  assert.match(serverSrc, /purpose: "prefetch",/, "the render is speculative: visit parked, /vault backfills skipped");
});

test("Safari and Firefox: a tab built ahead is served once, to the same cookie, until a write", async (t) => {
  const srv = await shared.boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());
  const C = "cn_session=x; cn_vid=0123456789abcdef0123456789abcdef";
  const warm = (path, cookie = C) => fetch(srv.base + NAV.WARM_PATH, {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ path }),
  }).then((r) => assert.equal(r.status, 204));
  const get = async (path, cookie = C) => {
    const r = await fetch(srv.base + path, { headers: { cookie } });
    return { hit: r.headers.get("x-cn-warm") === "hit", status: r.status, html: await r.text() };
  };

  await t.test("the click gets the page built for it, once", async () => {
    await warm("/markets");
    const first = await get("/markets");
    assert.equal(first.hit, true, "served from the store (joining the render if it is still running)");
    assert.equal(first.status, 200);
    assert.match(first.html, /<\/html>/);
    assert.equal((await get("/markets")).hit, false, "single use: the next visit renders fresh");
  });

  await t.test("never to another cookie, a query string or a path that is not a tab", async () => {
    await warm("/markets");
    assert.equal((await get("/markets", "cn_session=y; cn_vid=0123456789abcdef0123456789abcdef")).hit, false);
    assert.equal((await get("/markets?x=1")).hit, false);
    assert.equal((await get("/markets")).hit, true, "and those misses did not use it up");
    await warm("/market/boise-id");
    assert.equal((await get("/market/boise-id")).hit, false);
    await warm("/markets", "cn_vid=0123456789abcdef0123456789abcdef");
    assert.equal((await get("/markets", "cn_vid=0123456789abcdef0123456789abcdef")).hit, false,
      "member tabs only: no session, nothing built");
  });

  await t.test("a write from the same cookie throws it away; asking for a page does not", async () => {
    await warm("/desk");
    await fetch(srv.base + "/api/visit", { method: "POST", headers: { cookie: C }, body: "x" });
    await warm("/desk");
    assert.equal((await get("/desk")).hit, true, "/api/warm and /api/visit change no data");
    await warm("/desk");
    await fetch(srv.base + "/api/anything", { method: "POST", headers: { cookie: C }, body: "{}" });
    assert.equal((await get("/desk")).hit, false, "a page built before a save is never shown after it");
  });

  await t.test("the built page's visit counts when it is shown, not when it is built", async () => {
    const logFile = path.join(srv.dataDir, "analytics.jsonl");
    const visits = () => {
      try {
        return fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean)
          .map((l) => JSON.parse(l)).filter((r) => r.kind === "vault_visit").length;
      } catch (_) { return 0; }
    };
    const before = visits();
    await warm("/vault");
    const page = await get("/vault");
    assert.equal(page.hit, true);
    const m = page.html.match(/\}\)\("([0-9a-f]{32})"\);<\/script>/);
    assert.ok(m, "the page carries its visit tag");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(visits(), before, "building it logged nothing");
    await fetch(srv.base + "/api/visit", { method: "POST", headers: { cookie: C }, body: m[1] });
    for (let i = 0; i < 40 && visits() === before; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(visits(), before + 1);
  });
});
