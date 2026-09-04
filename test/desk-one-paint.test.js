// The workspace fills in ONE PAINT (2026-09-03).
//
// It used to reveal itself a section at a time: renderMyDesk unhid #myDesk on
// entry and every renderer unhid its own section when its own fetch landed,
// and those fetches ran as a chain ten deep. Filmed against a stand-in
// database with a 60ms round trip, the sections appeared at 0.6s, 0.9s,
// 1.3s, 1.8s, 2.3s, 2.6s, 2.9s and 3.2s — the page inserting parts, which is
// how the owner described it. Now the first fill for an identity is held
// behind a skeleton and revealed once, and the reads run concurrently where
// the data allows: filmed the same way, everything appeared together at 1.7s.
//
// The method is org-desk.test.js's: slice renderMyDesk out of index.html,
// run it in a vm with a stand-in DOM and renderers that resolve when the
// test says so, and assert on what is visible when.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const DESK_RE = /  let deskFilledFor = null;[\s\S]*?\n  function renderDeskRest\(\) \{[\s\S]*?\n  \}/;

function makeDom() {
  const els = new Map();
  const mk = () => {
    const classes = new Set();
    return {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, force) => {
          const on = force === undefined ? !classes.has(c) : !!force;
          if (on) classes.add(c); else classes.delete(c);
          return on;
        },
      },
    };
  };
  const document = { getElementById(id) { if (!els.has(id)) els.set(id, mk()); return els.get(id); } };
  return { document, hidden: (id) => document.getElementById(id).classList.contains("hidden") };
}

// A promise the test resolves by hand, so a renderer "lands" when told to.
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function load(user) {
  const src = html.match(DESK_RE);
  assert.ok(src, "could not find renderMyDesk / renderDeskRest in index.html");
  const dom = makeDom();
  const pending = { portfolio: deferred(), shares: deferred(), hubs: deferred(), branding: deferred() };
  const ctx = vm.createContext({
    document: dom.document,
    console, setTimeout, Promise,
    currentUser: user,
    authKnown: true,
    acctApi: () => pending.portfolio.promise,
    applyAvatarUI() {},
    portfolioKeys: new Set(),
    markPortfolioSaved() {},
    syncPortfolioButton() {},
    renderShares: () => pending.shares.promise,
    renderDeskHubs: () => pending.hubs.promise,
    loadBranding: () => pending.branding.promise,
  });
  new vm.Script(
    "function looksSignedIn() { return authKnown ? Boolean(currentUser) : false; }\n" +
    src[0] + "\nthis.run = renderMyDesk;",
    { filename: "index.html" }).runInContext(ctx);
  ctx.dom = dom;
  ctx.pending = pending;
  ctx.landAll = (items) => {
    pending.portfolio.resolve({ items: items || [] });
    pending.shares.resolve(); pending.hubs.resolve(); pending.branding.resolve();
  };
  // Everything settles in microtasks once resolved; one macrotask is plenty.
  ctx.settle = () => new Promise((r) => setTimeout(r, 5));
  return ctx;
}

const BRAD = { id: "u-brad", email: "brad@colliers.com" };

test("the first fill is held behind the stand-in and revealed once, whole", async () => {
  const c = load(BRAD);
  const run = c.run();
  assert.ok(c.dom.hidden("myDesk"), "the desk stays hidden while its reads are out");
  assert.ok(!c.dom.hidden("deskLoading"), "the stand-in shows in its place");
  // Three of four sections landing is not the desk: it stays held.
  c.pending.shares.resolve(); c.pending.hubs.resolve(); c.pending.branding.resolve();
  await c.settle();
  assert.ok(c.dom.hidden("myDesk"), "one read still out keeps the desk held");
  c.pending.portfolio.resolve({ items: [] });
  await run;
  assert.ok(!c.dom.hidden("myDesk"), "the desk shows once everything has landed");
  assert.ok(c.dom.hidden("deskLoading"), "the stand-in leaves with it");
});

test("a later call for the same identity repaints in place and never blanks the desk", async () => {
  const c = load(BRAD);
  const first = c.run();
  c.landAll();
  await first;
  assert.ok(!c.dom.hidden("myDesk"));
  // Second call: fresh, still-pending reads — the desk must stay on screen.
  Object.assign(c.pending, { portfolio: deferred(), shares: deferred(), hubs: deferred(), branding: deferred() });
  const second = c.run();
  assert.ok(!c.dom.hidden("myDesk"), "a desk already on screen is not re-hidden by a repaint");
  assert.ok(c.dom.hidden("deskLoading"), "and the stand-in does not come back");
  c.landAll();
  await second;
  assert.ok(!c.dom.hidden("myDesk"));
});

test("signing out while a fill is in flight leaves the desk hidden", async () => {
  const c = load(BRAD);
  const fill = c.run();
  assert.ok(c.dom.hidden("myDesk"));
  c.currentUser = null;
  c.run(); // refreshAccountUI's call for the signed-out state
  assert.ok(c.dom.hidden("myDesk"));
  assert.ok(c.dom.hidden("deskLoading"), "nobody signed in: no stand-in either");
  c.landAll();
  await fill;
  assert.ok(c.dom.hidden("myDesk"), "the stale fill must not reveal a desk for an account no longer signed in");
  assert.ok(c.dom.hidden("deskLoading"));
});

test("a different account signing in mid-fill owns the reveal", async () => {
  const c = load(BRAD);
  const bradFill = c.run();
  c.currentUser = { id: "u-mike", email: "mike@colliers.com" };
  const mikePending = { portfolio: deferred(), shares: deferred(), hubs: deferred(), branding: deferred() };
  const bradPending = c.pending;
  Object.assign(c.pending, mikePending);
  const mikeFill = c.run();
  assert.ok(c.dom.hidden("myDesk"));
  // Brad's reads land first: nothing shows, because Mike's are still out.
  bradPending.portfolio.resolve({ items: [] });
  await bradFill;
  assert.ok(c.dom.hidden("myDesk"), "Brad's late reads must not reveal Mike's half-filled desk");
  mikePending.portfolio.resolve({ items: [] });
  mikePending.shares.resolve(); mikePending.hubs.resolve(); mikePending.branding.resolve();
  await mikeFill;
  assert.ok(!c.dom.hidden("myDesk"));
});

test("a renderer that rejects does not hold the desk forever", async () => {
  const c = load(BRAD);
  c.renderShares = () => Promise.reject(new Error("boom"));
  const fill = c.run();
  c.pending.portfolio.resolve({ items: [] });
  c.pending.hubs.resolve(); c.pending.branding.resolve();
  await fill;
  assert.ok(!c.dom.hidden("myDesk"), "renderDeskRest must swallow a rejection so the reveal still happens");
});

test("the watchdog exists, so a hung read cannot hold the workspace hostage", () => {
  const src = html.match(DESK_RE)[0];
  assert.match(src, /const DESK_FILL_MAX_MS = \d+;/);
  assert.ok(src.includes("Promise.race([work, new Promise((r) => setTimeout(r, DESK_FILL_MAX_MS))])"),
    "the first fill must race its batch against the watchdog");
});

test("the stand-in precedes the desk in the markup and ships hidden", () => {
  const at = html.indexOf('id="deskLoading"');
  assert.ok(at > 0, "#deskLoading must exist");
  assert.ok(at < html.indexOf('<section id="myDesk"'), "the stand-in sits where the desk will appear");
  const tag = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
  assert.match(tag, /class="hidden dk-skel"/, "hidden until a fill starts, styled as a deck");
  assert.match(tag, /aria-hidden="true"/);
  assert.ok(html.includes(".dk-skel-lab") && html.includes(".dk-skel-card"), "its two classes must be styled");
});

test("the boot path decides the sign-in card and the stand-in on the cookie hint, not on currentUser", () => {
  const at = html.indexOf("function showDeskView()");
  const fn = html.slice(at, html.indexOf("\n  }", at));
  assert.ok(fn.includes('getElementById("deskSignIn").classList.toggle("hidden", looksSignedIn())'),
    "a member's first frame must not be the Sign in card");
  assert.ok(fn.includes('getElementById("deskLoading").classList.toggle("hidden", !(looksSignedIn() && !currentUser))'),
    "a member whose account read is still out sees the stand-in, not a gap");
  assert.ok(!fn.includes('classList.toggle("hidden", Boolean(currentUser))'),
    "the currentUser-only toggle must not come back");
});

test("the firm-scoped reads run together, and only the two that need the buildings wait for them", () => {
  const at = html.indexOf("async function renderShares()");
  const fn = html.slice(at, html.indexOf("\n  }\n", at));
  // The membership read starts beside the shares read, not after it.
  assert.ok(fn.indexOf("const firmReady = renderFirm()") < fn.indexOf('fetch("/api/shares")'),
    "renderFirm must start before the shares fetch");
  // Every early exit waits for it before hiding the firm sections.
  assert.ok(fn.includes("const bail = async (err) => {\n      await firmReady;\n      hideAll();"),
    "a shares failure must wait for the firm read before hideAll(), or the read undoes the hide");
  assert.ok(!/\n\s*hideAll\(\);\s*\n\s*errEl\.classList\.remove/.test(fn), "no bare hideAll-then-error path may remain");
  // Buildings, conversations and the board go out together; the shelf and
  // the contacts follow the buildings and nothing else.
  const batch = fn.slice(fn.indexOf("const buildings = renderBuildings();"));
  assert.match(batch, /Promise\.all\(\[\s*buildings,\s*renderDeskThreads\(\),\s*renderDealBoard\(\),\s*buildings\.then\(\(\) => Promise\.all\(\[renderFirmShelf\(\), renderContacts\(\)\]\)\),\s*\]\)/,
    "the firm-scoped batch must keep this shape");
  assert.ok(!fn.includes("await renderBuildings();"), "the sequential chain must not come back");
  assert.ok(!fn.includes("await renderDeskThreads();"));
});
