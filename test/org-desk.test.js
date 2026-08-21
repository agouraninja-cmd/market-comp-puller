// The firm surfaces INSIDE index.html — the browser half of the enterprise
// system.
//
// Why this file exists: test/org-run.test.js proves the routes, end to end,
// against a stand-in PostgREST — an invite grants nothing until it is
// accepted, a removed colleague stops reading the report, a firm checkout
// writes the firm's table. All of that is server truth. Nothing anywhere
// tested that the DESK renders it. index.html carries ~450 lines of firm
// code across eight render functions and not one of them was executed by
// `npm test`, so the failures this file exists to catch are the ones the
// server cannot see: a sole owner offered a "Leave firm" button the server
// will refuse, an invitation accepted without the auto-share disclosure the
// spec made a condition of building auto-share at all, a firm-link notice
// left over from the previous report, or a renamed div that silently turns
// the whole section into nothing.
//
// The method is index-html.test.js's: slice a function's source out of the
// page, run it in a vm with a small stand-in DOM, and assert on what it did.
// Executing beats matching a regex over the source — the point of a render
// function is what it puts on screen.
//
// Spec: docs/superpowers/specs/2026-08-16-enterprise-team-accounts-design.md

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// ---------------------------------------------------------------------------
// A stand-in DOM
//
// Deliberately tiny and deliberately NOT jsdom: this repo has no npm
// dependencies, and the firm renderers touch six things (getElementById,
// createElement, createTextNode, classList, textContent, appendChild). A
// fuller fake would be a second browser to be wrong in.
//
// getElementById mints an element for any id it is asked for, and every id
// asked for is recorded — which is what lets the last test in this file prove
// that every id the code reaches for actually exists in the markup. A stub
// that invented elements silently would hide exactly that failure.
// ---------------------------------------------------------------------------
// The class attribute index.html ships each id with. Without this an element
// minted by the stub starts with no classes at all, so "it was left hidden"
// and "it was never touched" look identical — and `hidden` in the markup is
// precisely how these sections ship.
const MARKUP_CLASSES = (() => {
  const map = new Map();
  const re = /<[a-z][a-z0-9]*\s[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[0].match(/\bid="([^"]+)"/);
    if (!id) continue;
    const cls = m[0].match(/\bclass="([^"]*)"/);
    map.set(id[1], cls ? cls[1] : "");
  }
  return map;
})();

function makeEl(tag, initialClasses) {
  const classes = new Set(String(initialClasses || "").split(/\s+/).filter(Boolean));
  const handlers = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    _text: "",
    className: "",
    value: "",
    checked: false,
    disabled: false,
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
    appendChild(child) { el.children.push(child); return child; },
    addEventListener(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    // Returns the handlers' promises so a test can await an async click.
    fire(ev, arg) {
      return Promise.all((handlers[ev] || []).map((fn) => fn(arg || { target: el })));
    },
  };
  Object.defineProperty(el, "textContent", {
    get: () => el._text + el.children.map((c) => c.textContent).join(""),
    set: (v) => { el.children = []; el._text = v === undefined ? "" : String(v); },
  });
  Object.defineProperty(el, "innerHTML", {
    get: () => el.textContent,
    // The only assignment the firm code makes is `= ""`, to empty a list.
    set: (v) => { el.children = []; el._text = v ? String(v) : ""; },
  });
  return el;
}

function makeDom() {
  const els = new Map();
  const asked = new Set();
  const document = {
    getElementById(id) {
      asked.add(id);
      if (!els.has(id)) els.set(id, makeEl("div", MARKUP_CLASSES.get(id)));
      return els.get(id);
    },
    createElement: (tag) => makeEl(tag),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t), children: [] }),
  };
  return {
    document,
    asked,
    el: (id) => document.getElementById(id),
    hidden: (id) => document.getElementById(id).classList.contains("hidden"),
    text: (id) => document.getElementById(id).textContent,
  };
}

// Every button under an element, at any depth — the rows these functions
// build are two levels deep.
function buttons(el) {
  const out = [];
  (function walk(node) {
    (node.children || []).forEach((c) => {
      if (c.tagName === "BUTTON") out.push(c);
      walk(c);
    });
  })(el);
  return out;
}

// A fetch that answers from a table of url-substring -> response, and records
// every call. An unmatched url is a REJECTION rather than a default 200: a
// render that quietly asked for something this test did not model should fail
// here, not sail past on a fabricated answer.
function makeFetch(routes) {
  const log = [];
  const fetch = (url, init) => {
    log.push({ url: String(url), init: init || {} });
    for (const [frag, res] of routes) {
      if (String(url).includes(frag)) {
        const r = typeof res === "function" ? res() : res;
        return Promise.resolve({
          ok: r.ok !== false && (r.status || 200) < 400,
          status: r.status || 200,
          json: async () => r.body,
        });
      }
    }
    return Promise.reject(new Error("unmocked fetch: " + url));
  };
  fetch.log = log;
  return fetch;
}

// Slices a function (and any prelude) out of index.html and runs it in a
// context. `prefix` declares the module-level bindings the slice reads, which
// is how currentUser/currentMeta/firmState are set per test without the whole
// page.
function load(re, exports, prefix, extras) {
  const src = html.match(re);
  assert.ok(src, "could not find " + re + " in index.html — was it renamed or moved?");
  const dom = makeDom();
  const ctx = vm.createContext(Object.assign({
    document: dom.document,
    console,
    setTimeout,
  }, extras || {}));
  new vm.Script((prefix || "") + "\n" + src[0] + "\n" + exports,
    { filename: "index.html" }).runInContext(ctx);
  ctx.dom = dom;
  return ctx;
}

// ---------------------------------------------------------------------------
// renderFirm — three states, exactly one of them on screen
// ---------------------------------------------------------------------------
const FIRM_RE = /  function myFirm\(\) \{[\s\S]*?\n  \}\n\n  async function renderFirm\(\) \{[\s\S]*?\n  \}/;

function loadRenderFirm(state) {
  return load(FIRM_RE,
    "this.renderFirm = renderFirm; this.calls = __calls;",
    // loadMyFirms is the network read; stubbing it here keeps myFirm() real,
    // which is the binding renderFirm actually branches on.
    "let currentUser = __user; let firmState = null; const __calls = [];\n" +
    "async function loadMyFirms() { firmState = __state; return __state; }\n" +
    "async function renderFirmMembers(f) { __calls.push(['members', f]); }\n" +
    "function renderFirmInvites(i) { __calls.push(['invites', i]); }",
    { __user: { email: "brad@colliers.com" }, __state: state });
}

const STATE = (o) => Object.assign({ canCreate: false, orgs: [], invites: [], billing: {} }, o);

test("the desk shows exactly one firm state, never two at once", async () => {
  // A member of a firm: the roster, and nothing else.
  let ctx = loadRenderFirm(STATE({ orgs: [{ id: "o1", name: "Colliers Boise" }], canCreate: true }));
  await ctx.renderFirm();
  assert.equal(ctx.dom.hidden("deskFirm"), false);
  assert.equal(ctx.dom.hidden("firmMembers"), false);
  assert.equal(ctx.dom.hidden("firmInvites"), true);
  assert.equal(ctx.dom.hidden("firmCreate"), true, "a member of a firm is still being offered a new one");
  assert.deepEqual(ctx.calls.map((c) => c[0]), ["members"]);

  // An invitation waiting, and no firm yet: the invitation.
  ctx = loadRenderFirm(STATE({ invites: [{ orgId: "o2", name: "Cushman" }], canCreate: true }));
  await ctx.renderFirm();
  assert.equal(ctx.dom.hidden("firmInvites"), false);
  assert.equal(ctx.dom.hidden("firmCreate"), true);
  assert.equal(ctx.dom.hidden("firmMembers"), true);

  // Neither, but this account could create one.
  ctx = loadRenderFirm(STATE({ canCreate: true }));
  await ctx.renderFirm();
  assert.equal(ctx.dom.hidden("firmCreate"), false);
  assert.equal(ctx.dom.hidden("firmInvites"), true);
  assert.equal(ctx.dom.hidden("firmMembers"), true);
});

test("a firm beats a pending invitation — a member is never shown a second door", async () => {
  // Both at once is a real state: you can be invited to a second firm while
  // already in one. The roster is the answer; POST /api/org/accept would
  // refuse the second membership anyway.
  const ctx = loadRenderFirm(STATE({
    orgs: [{ id: "o1", name: "Colliers Boise" }],
    invites: [{ orgId: "o2", name: "Cushman" }],
  }));
  await ctx.renderFirm();
  assert.equal(ctx.dom.hidden("firmMembers"), false);
  assert.equal(ctx.dom.hidden("firmInvites"), true);
});

test("an account that cannot create a firm is offered nothing, not an error", async () => {
  // canCreate tracks canUseOrg, which is false on the free plan. The paywall
  // for firms lives in the pricing modal; an invitation to start something the
  // server would refuse is worse than silence.
  const ctx = loadRenderFirm(STATE({ canCreate: false }));
  await ctx.renderFirm();
  assert.equal(ctx.dom.hidden("deskFirm"), true);
});

test("a failed /api/org read hides the section — 'we could not ask' is not 'you have no firm'", async () => {
  const ctx = loadRenderFirm(null);
  await ctx.renderFirm();
  assert.equal(ctx.dom.hidden("deskFirm"), true);
  assert.equal(ctx.dom.hidden("firmCreate"), true,
    "a firm read that failed offered to create a firm this account may already be in");
});

test("a signed-out desk asks nothing and shows nothing", async () => {
  const ctx = load(FIRM_RE, "this.renderFirm = renderFirm; this.asked = () => __asked;",
    "let currentUser = null; let firmState = null; let __asked = false;\n" +
    "async function loadMyFirms() { __asked = true; return null; }\n" +
    "async function renderFirmMembers() {} function renderFirmInvites() {}");
  await ctx.renderFirm();
  assert.equal(ctx.dom.hidden("deskFirm"), true);
  assert.equal(ctx.asked(), false, "the desk read a firm membership for a signed-out visitor");
});

// ---------------------------------------------------------------------------
// The invitation row — the auto-share disclosure rides on it
// ---------------------------------------------------------------------------
const INVITES_RE = /  function renderFirmInvites\(invites\) \{[\s\S]*?\n  \}/;

test("an invitation from an auto-sharing firm says so BEFORE it is accepted", () => {
  // The spec's safeguard: joining a firm whose default is on changes what
  // happens to work not yet run, and being told after the accept is being
  // told too late.
  const ctx = load(INVITES_RE, "this.fn = renderFirmInvites;", "function renderShares() {}");
  ctx.fn([{ orgId: "o1", name: "Colliers Boise", shareDefault: "reports" }]);
  const text = ctx.dom.text("firmInvites");
  assert.match(text, /Colliers Boise/);
  assert.match(text, /new reports you run would be shared with them/);
  assert.match(text, /you can turn that off/,
    "the disclosure must also say the member can refuse — the veto is the reason auto-share shipped");
});

test("an invitation from an ordinary firm makes no claim about sharing", () => {
  const ctx = load(INVITES_RE, "this.fn = renderFirmInvites;", "function renderShares() {}");
  ctx.fn([{ orgId: "o1", name: "Colliers Boise", shareDefault: "none" }]);
  const text = ctx.dom.text("firmInvites");
  assert.match(text, /invited you/);
  assert.doesNotMatch(text, /would be shared/);
});

test("accepting posts the invitation's own org id, and re-reads the desk", async () => {
  const fetch = makeFetch([["/api/org/accept", { body: { ok: true } }]]);
  const ctx = load(INVITES_RE, "this.fn = renderFirmInvites; this.reloaded = () => __n;",
    "let __n = 0; async function renderShares() { __n++; }", { fetch });
  ctx.fn([{ orgId: "o-real", name: "Colliers Boise" }]);
  const btn = buttons(ctx.dom.el("firmInvites"))[0];
  assert.equal(btn.textContent, "Accept");
  await btn.fire("click");
  assert.equal(fetch.log.length, 1);
  assert.equal(JSON.parse(fetch.log[0].init.body).orgId, "o-real");
  // Joining changes the firm section AND puts the firm's shelf on the desk,
  // which come from two different endpoints — so the whole desk re-reads.
  assert.equal(ctx.reloaded(), 1, "accepting an invitation left the desk showing the pre-join state");
});

test("an accept that fails says so and gives the button back", async () => {
  const fetch = makeFetch([["/api/org/accept", { status: 500, body: {} }]]);
  const ctx = load(INVITES_RE, "this.fn = renderFirmInvites;",
    "async function renderShares() {}", { fetch });
  ctx.fn([{ orgId: "o1", name: "Colliers Boise" }]);
  const btn = buttons(ctx.dom.el("firmInvites"))[0];
  await btn.fire("click");
  assert.equal(btn.disabled, false, "a failed accept left the only button on the row disabled forever");
  assert.match(ctx.dom.text("firmInvites"), /didn't go through/);
});

// ---------------------------------------------------------------------------
// The roster — the last-owner rule, read from the same list the server uses
// ---------------------------------------------------------------------------
const MEMBERS_RE = /  async function renderFirmMembers\(firm\) \{[\s\S]*?\n  \}/;

function loadMembers(body, status) {
  const fetch = makeFetch([["/api/org/members", { status: status || 200, body }]]);
  return load(MEMBERS_RE,
    "this.fn = renderFirmMembers; this.confirms = () => __confirms;",
    "const __confirms = [];\n" +
    "function confirm(m) { __confirms.push(m); return true; }\n" +
    "async function renderShares() {}\n" +
    "function renderFirmAutoShare() {} function renderFirmBilling() {}",
    { fetch });
}

const OWNER = { id: "m1", email: "brad@colliers.com", role: "owner", pending: false, self: true };
const MEMBER = { id: "m2", email: "mike@colliers.com", role: "member", pending: false, self: false };

test("the sole owner is not offered a Leave button the server would refuse", async () => {
  // org-access.js refuses it: a firm with no owner has nobody who can invite,
  // remove or hand the role on, and no route repairs one. Offering the control
  // and answering with an error is how a person learns to distrust the page.
  const ctx = loadMembers({ name: "Colliers Boise", canManage: true, members: [OWNER] });
  await ctx.fn({ id: "o1" });
  assert.equal(buttons(ctx.dom.el("firmMemberRows")).length, 0);
});

test("a second owner makes leaving offerable again", async () => {
  const ctx = loadMembers({
    name: "Colliers Boise", canManage: true,
    members: [OWNER, Object.assign({}, MEMBER, { role: "owner" })],
  });
  await ctx.fn({ id: "o1" });
  const labels = buttons(ctx.dom.el("firmMemberRows")).map((b) => b.textContent);
  assert.deepEqual(labels, ["Leave firm", "Remove"]);
});

test("a pending invitation is not an owner, so it cannot hold the firm hostage", async () => {
  // owners counts !pending rows only. A firm whose second owner has not
  // accepted still has exactly one real owner, and the button must stay off.
  const ctx = loadMembers({
    name: "Colliers Boise", canManage: true,
    members: [OWNER, { id: "m3", email: "new@colliers.com", role: "owner", pending: true }],
  });
  await ctx.fn({ id: "o1" });
  // The sole ACCEPTED owner keeps no button; the unaccepted one is revocable,
  // which is the point — an invitation nobody took must not lock the roster.
  assert.deepEqual(buttons(ctx.dom.el("firmMemberRows")).map((b) => b.textContent), ["Remove"]);
  assert.match(ctx.dom.text("firmMemberRows"), /invited, not accepted/);
  assert.match(ctx.dom.text("firmStats"), /1 person · 1 invited/);
});

test("a plain member may leave, and is offered nothing on anybody else's row", async () => {
  const ctx = loadMembers({
    name: "Colliers Boise", canManage: false,
    members: [Object.assign({}, OWNER, { self: false }), Object.assign({}, MEMBER, { self: true })],
  });
  await ctx.fn({ id: "o1" });
  assert.deepEqual(buttons(ctx.dom.el("firmMemberRows")).map((b) => b.textContent), ["Leave firm"]);
  assert.equal(ctx.dom.hidden("firmInviteWrap"), true,
    "the invite form was offered to somebody the server will not let invite");
});

test("removing somebody is confirmed by name, and says what they keep", async () => {
  const ctx = loadMembers({ name: "Colliers Boise", canManage: true, members: [OWNER, MEMBER] });
  await ctx.fn({ id: "o1" });
  const remove = buttons(ctx.dom.el("firmMemberRows")).find((b) => b.textContent === "Remove");
  await remove.fire("click");
  const msg = ctx.confirms()[0];
  assert.match(msg, /mike@colliers\.com/);
  assert.match(msg, /Colliers Boise/);
  assert.match(msg, /keep their own reports/,
    "the confirm must say what removal does NOT take — a broker's own book is not the firm's");
});

test("a members read that fails still names the firm rather than blanking it", async () => {
  const ctx = loadMembers({}, 500);
  await ctx.fn({ id: "o1", name: "Colliers Boise" });
  assert.equal(ctx.dom.text("firmStats"), "Colliers Boise");
  assert.equal(buttons(ctx.dom.el("firmMemberRows")).length, 0);
});

// ---------------------------------------------------------------------------
// The two auto-share switches
// ---------------------------------------------------------------------------
const AUTOSHARE_RE = /  function renderFirmAutoShare\(firm\) \{[\s\S]*?\n  \}/;

test("the switch states what will actually happen, from the server's own answer", () => {
  const ctx = load(AUTOSHARE_RE, "this.fn = renderFirmAutoShare;");
  // autoShareOn is READ, never recomputed from the other two fields: that
  // combination is exactly the rule that grows a second, subtly different copy.
  ctx.fn({ name: "Colliers Boise", canManage: true, shareDefault: "reports", autoShare: "always", autoShareOn: true });
  assert.match(ctx.dom.text("firmAutoShareState"), /On — new reports go to Colliers Boise/);
  assert.equal(ctx.dom.el("firmDefaultToggle").checked, true);
  assert.equal(ctx.dom.el("firmAutoShareSelect").value, "always");
  assert.equal(ctx.dom.hidden("firmDefaultWrap"), false);
});

test("a member's NO is shown as off even while the firm's default is on", () => {
  // The safeguard, on screen: the firm says yes, the member said no, and the
  // sentence has to describe the member's actual outcome.
  const ctx = load(AUTOSHARE_RE, "this.fn = renderFirmAutoShare;");
  ctx.fn({ name: "Colliers Boise", canManage: false, shareDefault: "reports", autoShare: "never", autoShareOn: false });
  assert.match(ctx.dom.text("firmAutoShareState"), /Off — nothing is shared unless you share it/);
  assert.equal(ctx.dom.hidden("firmDefaultWrap"), true,
    "a plain member was shown the FIRM's switch, which they cannot set");
  assert.equal(ctx.dom.el("firmAutoShareSelect").value, "never");
});

test("a member who has not chosen reads as following the firm", () => {
  const ctx = load(AUTOSHARE_RE, "this.fn = renderFirmAutoShare;");
  ctx.fn({ name: "Colliers Boise", canManage: true, shareDefault: "none", autoShare: null, autoShareOn: false });
  assert.equal(ctx.dom.el("firmAutoShareSelect").value, "follow",
    "a null personal setting is 'follow the firm', not an empty control");
  assert.equal(ctx.dom.el("firmDefaultToggle").checked, false);
});

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------
const BILLING_RE = /  function renderFirmBilling\(firm\) \{[\s\S]*?\n  \}/;

function loadBilling(billing) {
  return load(BILLING_RE, "this.fn = renderFirmBilling;",
    "let firmState = { billing: __billing };", { __billing: billing });
}

test("a hand-granted firm shows its seats and offers no billing controls", () => {
  // Seats can be granted by hand — the vault_beta precedent. Such a firm has
  // seats, no subscription, and everything works.
  const ctx = loadBilling({ o1: { seats: 5, used: 2, status: "none", canBill: false } });
  ctx.fn({ id: "o1" });
  assert.equal(ctx.dom.hidden("firmBilling"), false);
  assert.match(ctx.dom.text("firmSeats"), /2 of 5 seats used · 3 free/);
  assert.doesNotMatch(ctx.dom.text("firmSeats"), /none/);
  assert.equal(ctx.dom.hidden("firmBuySeatsBtn"), true);
  assert.equal(ctx.dom.hidden("firmPortalBtn"), true);
});

test("the portal is offered only once a subscription exists", () => {
  // It 400s without a Stripe customer, and a firm that has never paid has
  // none — the Buy-button rule: a control that can only fail never renders.
  let ctx = loadBilling({ o1: { seats: 3, used: 3, status: "none", canBill: true } });
  ctx.fn({ id: "o1" });
  assert.equal(ctx.dom.hidden("firmBuySeatsBtn"), false);
  assert.equal(ctx.dom.hidden("firmPortalBtn"), true);
  assert.match(ctx.dom.text("firmSeats"), /none free/);

  ctx = loadBilling({ o1: { seats: 3, used: 1, status: "active", canBill: true } });
  ctx.fn({ id: "o1" });
  assert.equal(ctx.dom.hidden("firmPortalBtn"), false);
  assert.match(ctx.dom.text("firmSeats"), /· active/);
});

test("a colleague who is not the owner sees seats and no way to change them", () => {
  // canBill is owner-only, deliberately narrower than canManage: committing a
  // firm to a recurring charge is not the same act as managing people.
  const ctx = loadBilling({ o1: { seats: 5, used: 2, status: "active", canBill: false } });
  ctx.fn({ id: "o1" });
  assert.equal(ctx.dom.hidden("firmBilling"), false);
  assert.equal(ctx.dom.hidden("firmBuySeatsBtn"), true);
  assert.equal(ctx.dom.hidden("firmPortalBtn"), true);
});

test("a firm with no billing block at all renders nothing rather than zeros", () => {
  const ctx = loadBilling({});
  ctx.fn({ id: "o1" });
  assert.equal(ctx.dom.hidden("firmBilling"), true);
});

// ---------------------------------------------------------------------------
// The shelf
// ---------------------------------------------------------------------------
const SHELF_RE = /  let firmShelfItems = \[\];[\s\S]*?\n  function applyFirmShelfFilter\(\) \{[\s\S]*?\n  \}/;

function loadShelf(opts) {
  const o = opts || {};
  const fetch = makeFetch([["/api/org/shelf", { status: o.status || 200, body: o.body }]]);
  return load(SHELF_RE,
    "this.render = renderFirmShelf; this.filter = applyFirmShelfFilter; this.items = () => firmShelfItems;",
    "let currentUser = __user; function myFirm() { return __firm; }\n" +
    "function fmtShareDate(s) { return 'Mar 14'; }",
    { fetch, __user: o.user === undefined ? { email: "brad@colliers.com" } : o.user,
      __firm: o.firm === undefined ? { id: "o1", name: "Colliers Boise" } : o.firm });
}

const ITEM = (o) => Object.assign({
  address: "500 Warehouse Way", market: "Boise, ID", type: "Industrial",
  sharedBy: "Brad", mine: false, url: "/r/abc", createdAt: "2026-03-14T00:00:00Z",
}, o);

test("the shelf's header count describes the WHOLE shelf, never the filtered view", async () => {
  // /vault's rule, for its reasons: a count that shrinks with the search box
  // is how a record stops being trusted as a record.
  const ctx = loadShelf({ body: { items: [ITEM({}), ITEM({ address: "2 B St", market: "Meridian, ID" })] } });
  await ctx.render();
  assert.match(ctx.dom.text("firmShelfStats"), /2 reports · 2 markets/);
  ctx.dom.el("firmShelfSearch").value = "warehouse";
  ctx.filter();
  assert.match(ctx.dom.text("firmShelfStats"), /2 reports/, "the header count followed the filter");
  assert.equal(ctx.dom.text("firmShelfCount"), "1 of 2",
    "the filtered count is stated separately, so nothing is silently hidden");
});

test("an empty shelf and a search with no hits are told apart", async () => {
  // Showing the empty-shelf invitation to somebody whose search missed reads
  // as the shelf having been wiped — the same misreport-absence-as-outage trap
  // the vault's own filters had to fix.
  const ctx = loadShelf({ body: { items: [ITEM({})] } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("deskSharedWithFirmEmpty"), true);
  assert.equal(ctx.dom.hidden("firmShelfNoMatch"), true);

  ctx.dom.el("firmShelfSearch").value = "nothing like this";
  ctx.filter();
  assert.equal(ctx.dom.hidden("firmShelfNoMatch"), false);
  assert.equal(ctx.dom.hidden("deskSharedWithFirmEmpty"), true,
    "a search with no hits told the reader their firm has shared nothing");
});

test("your own share is on the shelf, attributed to you rather than to your name", async () => {
  // Slice 1 excluded the caller's own shares, which is right for a
  // "shared with you" list and wrong for a shelf: a record missing your own
  // work cannot answer "has anybody here valued this building".
  const ctx = loadShelf({ body: { items: [ITEM({ mine: true, sharedBy: "Brad" })] } });
  await ctx.render();
  const text = ctx.dom.text("sharedWithFirmRows");
  assert.match(text, /shared by you/);
  assert.doesNotMatch(text, /shared by Brad/);
});

test("a truncated shelf says so rather than under-reporting", async () => {
  const ctx = loadShelf({ body: { items: [ITEM({})], truncated: true } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("firmShelfTruncated"), false);
});

test("the shelf's search box is furniture under six rows", async () => {
  const ctx = loadShelf({ body: { items: [ITEM({}), ITEM({})] } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("firmShelfSearchWrap"), true);
  const many = loadShelf({ body: { items: Array.from({ length: 6 }, () => ITEM({})) } });
  await many.render();
  assert.equal(many.dom.hidden("firmShelfSearchWrap"), false);
});

test("no firm means no shelf, and a signed-out desk does not even ask", async () => {
  const noFirm = loadShelf({ firm: null, body: { items: [] } });
  await noFirm.render();
  assert.equal(noFirm.dom.hidden("deskSharedWithFirm"), true);

  // currentUser is checked FIRST: a failed /api/org leaves the cached
  // membership holding the last answer, and the one state where acting on
  // that is wrong rather than merely stale is a signed-out page.
  const out = loadShelf({ user: null, firm: { id: "o1", name: "Stale" }, body: { items: [] } });
  await out.render();
  assert.equal(out.dom.hidden("deskSharedWithFirm"), true);
  assert.equal(out.fetch.log.length, 0, "the desk asked a signed-out browser's firm for its shelf");
});

test("a shelf read that fails hides it and drops the previous firm's rows", async () => {
  const ctx = loadShelf({ status: 500, body: {} });
  await ctx.render();
  assert.equal(ctx.dom.hidden("deskSharedWithFirm"), true);
  assert.deepEqual(ctx.items(), [],
    "a failed read left the last firm's reports in memory for the next filter to paint");
});

// ---------------------------------------------------------------------------
// The two notices on the report itself
// ---------------------------------------------------------------------------
test("a firm link says so, and says the one thing that stops a mistake", () => {
  const ctx = load(/  function renderFirmShareNotice\(\) \{[\s\S]*?\n  \}/,
    "this.fn = renderFirmShareNotice; this.setMeta = (m) => { currentMeta = m; };",
    "let currentMeta = null;");
  ctx.setMeta({ firmShare: { firm: "Colliers Boise", sharedBy: "Brad", mine: false } });
  ctx.fn();
  assert.equal(ctx.dom.hidden("firmShareNotice"), false);
  assert.match(ctx.dom.text("firmShareNotice"), /Brad shared this with Colliers Boise/);
  // The concrete mistake this exists to prevent: forwarding a firm link to a
  // client and finding out it was refused after sending.
  assert.match(ctx.dom.text("firmShareNotice"), /send a client a separate link/);

  ctx.setMeta({ firmShare: { firm: "Colliers Boise", sharedBy: "Brad", mine: true } });
  ctx.fn();
  assert.match(ctx.dom.text("firmShareNotice"), /^You shared this/);

  // An ordinary report CLEARS it rather than leaving the last one up — the
  // notice is about the link, and the next report is a different link.
  ctx.setMeta({ address: "1 Main St" });
  ctx.fn();
  assert.equal(ctx.dom.hidden("firmShareNotice"), true);
  assert.equal(ctx.dom.text("firmShareNotice"), "");
});

const AUTONOTICE_RE = /  function renderAutoShareNotice\(\) \{[\s\S]*?\n  \}/;

test("an auto-shared report says so and offers a working Undo", async () => {
  const fetch = makeFetch([["/api/shares/revoke", { body: { ok: true } }]]);
  const ctx = load(AUTONOTICE_RE,
    "this.fn = renderAutoShareNotice; this.setMeta = (m) => { currentMeta = m; };",
    "let currentMeta = null;", { fetch });
  const meta = { autoShared: { firm: "Colliers Boise", id: "sh1", url: "/r/sh1", undone: false } };
  ctx.setMeta(meta);
  ctx.fn();
  assert.match(ctx.dom.text("autoShareNotice"), /Shared with Colliers Boise automatically/);
  assert.match(ctx.dom.text("autoShareNotice"), /your firm's setting/);

  // A real control rather than a link to a settings page: the moment somebody
  // wants this off is the moment they are looking at the report.
  const undo = buttons(ctx.dom.el("autoShareNotice"))[0];
  assert.ok(undo, "the auto-share notice has no Undo");
  await undo.fire("click");
  assert.equal(fetch.log.length, 1);
  assert.match(fetch.log[0].url, /\/api\/shares\/revoke/);
  assert.equal(JSON.parse(fetch.log[0].init.body).id, "sh1");
  // Undo REVOKES — it does not merely hide the line.
  assert.equal(meta.autoShared.undone, true);
  assert.match(ctx.dom.text("autoShareNotice"), /Removed from Colliers Boise/);
  assert.equal(buttons(ctx.dom.el("autoShareNotice")).length, 0, "Undo is still offered after it ran");
});

test("a failed Undo gives the button back and says so", async () => {
  const fetch = makeFetch([["/api/shares/revoke", { status: 500, body: {} }]]);
  const ctx = load(AUTONOTICE_RE,
    "this.fn = renderAutoShareNotice; this.setMeta = (m) => { currentMeta = m; };",
    "let currentMeta = null;", { fetch });
  ctx.setMeta({ autoShared: { firm: "Colliers Boise", id: "sh1", undone: false } });
  ctx.fn();
  const undo = buttons(ctx.dom.el("autoShareNotice"))[0];
  await undo.fire("click");
  assert.equal(undo.disabled, false);
  assert.match(ctx.dom.text("autoShareNotice"), /try again/);
});

test("an ordinary report carries no auto-share line", () => {
  const ctx = load(AUTONOTICE_RE,
    "this.fn = renderAutoShareNotice; this.setMeta = (m) => { currentMeta = m; };",
    "let currentMeta = null;");
  ctx.setMeta({ address: "1 Main St" });
  ctx.fn();
  assert.equal(ctx.dom.hidden("autoShareNotice"), true);
  assert.equal(ctx.dom.text("autoShareNotice"), "");
});

test("auto-share fires once per report, and never on an old one", () => {
  // Guarded on meta.autoShared: every subject-field edit re-runs renderResults,
  // so without it a repaint would re-publish — including something the member
  // had just undone. The caller's own guard (not sample, not fromHistory, not
  // shared) is what keeps it off reports that were not just run.
  const src = html.match(/  async function maybeAutoShareToFirm\(meta\) \{[\s\S]*?\n  \}/);
  assert.ok(src, "could not find maybeAutoShareToFirm");
  assert.match(src[0], /if \(!currentUser \|\| !meta \|\| meta\.autoShared\) return;/,
    "the once-per-report guard is gone — a repaint would re-publish");
  assert.match(src[0], /if \(currentMeta !== meta\) return;/,
    "a report that finished while another was rendering would stamp the wrong building");
  const caller = html.match(/maybeAutoShareToFirm\(meta\)/g);
  assert.ok(caller, "nothing calls maybeAutoShareToFirm");
  // The caller's guard, checked where it lives: fresh reports only.
  const guard = html.match(/(?:[^\n]*\n){10}[^\n]*maybeAutoShareToFirm\(meta\);/);
  assert.ok(/!meta\.sample && !meta\.fromHistory && !meta\.shared|isFresh/.test(guard[0]),
    "auto-share is no longer guarded to freshly-run reports: " + guard[0].trim());
});

// ---------------------------------------------------------------------------
// The markup these functions reach for
// ---------------------------------------------------------------------------
test("every id the firm code reaches for exists in index.html", async () => {
  // The failure this catches is the quiet one: a renamed or deleted div leaves
  // getElementById returning null, the render throws mid-way, and the desk
  // shows a half-built firm section with no error anybody sees.
  const asked = new Set();
  const collect = (ctx) => ctx.dom.asked.forEach((id) => asked.add(id));

  const firm = loadRenderFirm(STATE({ orgs: [{ id: "o1", name: "F" }], canCreate: true }));
  await firm.renderFirm();
  collect(firm);
  const invites = load(INVITES_RE, "this.fn = renderFirmInvites;", "function renderShares() {}");
  invites.fn([{ orgId: "o1", name: "F", shareDefault: "reports" }]);
  collect(invites);
  const members = loadMembers({ name: "F", canManage: true, members: [OWNER, MEMBER] });
  await members.fn({ id: "o1" });
  collect(members);
  const auto = load(AUTOSHARE_RE, "this.fn = renderFirmAutoShare;");
  auto.fn({ name: "F", canManage: true, shareDefault: "reports", autoShare: "always", autoShareOn: true });
  collect(auto);
  const billing = loadBilling({ o1: { seats: 5, used: 2, status: "active", canBill: true } });
  billing.fn({ id: "o1" });
  collect(billing);
  const shelf = loadShelf({ body: { items: [ITEM({})], truncated: true } });
  await shelf.render();
  collect(shelf);

  assert.ok(asked.size > 15, "the sweep collected almost no ids — did the loaders stop running?");
  for (const id of asked) {
    assert.ok(html.includes(`id="${id}"`),
      `the firm code reads #${id}, which is not in index.html's markup`);
  }
});

test("both report notices are dropped from the print and the PNG", () => {
  // They are context about the LINK, not report content: a printed copy handed
  // to a client has no business carrying a firm's internal routing.
  for (const id of ["firmShareNotice", "autoShareNotice"]) {
    const m = html.match(new RegExp(`<p id="${id}" class="([^"]+)"`));
    assert.ok(m, `#${id} is not a <p> with a class list any more`);
    assert.match(m[1], /\bno-print\b/, `#${id} would print on a client's copy`);
    assert.match(m[1], /\bno-capture\b/, `#${id} would land in the exported PNG`);
    assert.match(m[1], /\bhidden\b/, `#${id} ships visible, so an ordinary report shows an empty line`);
  }
});
