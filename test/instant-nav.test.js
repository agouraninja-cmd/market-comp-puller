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
  tabs: NAV.TAB_PATHS, skip: [], warm: [], dwellMs: NAV.DWELL_MS, maxLive: NAV.MAX_LIVE,
  ttlMs: NAV.TTL_MS, warmTtlMs: NAV.WARM_TTL_MS, warmDelayMs: NAV.WARM_DELAY_MS,
};

// A window with just enough of a DOM for instantNavBoot: listeners, a <head>
// that holds scripts, the page's links, manual timers, and a fetch that
// records its calls.
function stage({ path: at = "/vault", supports = true, prerendering = false, skip = [], warm = [],
  links = [], readyState = "complete", hidden = false } = {}) {
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

test("without speculation rules only the write guard is installed", async () => {
  const s = stage({ supports: false, prerendering: true });
  assert.deepEqual(Object.keys(s.listeners), [], "Safari/Firefox: no pointer listeners at all");
  const p = s.win.fetch("/api/x", { method: "POST" });
  await flush();
  assert.equal(s.calls.length, 0, "a browser prerendering by other means still gets the guard");
  s.document.prerendering = false;
  s.fire("prerenderingchange");
  await p;
  assert.equal(s.calls.length, 1);
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
