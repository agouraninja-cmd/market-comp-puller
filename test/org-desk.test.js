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
    "function renderFirmInvites(i) { __calls.push(['invites', i]); }\n" +
    // The branding card's scope row follows the firm state (041). A silent
    // stub, not a __calls entry: these tests assert the render-call LIST, and
    // the scope hook fires on every path by design, so recording it would
    // add noise to every assertion without proving anything new.
    "function updateBrandScopeUI() {}",
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
    "async function renderFirmMembers() {} function renderFirmInvites() {}\n" +
    "function updateBrandScopeUI() {}");
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
    "function renderFirmAutoShare() {} function renderFirmBilling() {}\n" +
    "function renderFirmShop() {}",
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
    "this.render = renderFirmShelf; this.filter = applyFirmShelfFilter; this.items = () => firmShelfItems;" +
    // The flag the type filter sets when a person changes it themselves.
    " this.touch = () => { firmShelfTypeTouched = true; };",
    "let currentUser = __user; function myFirm() { return __firm; }\n" +
    "function fmtShareDate(s) { return 'Mar 14'; }\n" +
    // The buildings door (slice 3) is a collaborator of a shelf row, stubbed
    // here like fmtShareDate; its own tests are the buildings block below.
    "function buildingDoor() { return null; }",
    { fetch, __user: o.user === undefined ? { email: "brad@colliers.com" } : o.user,
      __firm: o.firm === undefined ? { id: "o1", name: "Colliers Boise" } : o.firm });
}

const ITEM = (o) => Object.assign({
  address: "500 Warehouse Way", market: "Boise, ID", type: "Industrial",
  sharedBy: "Brad", mine: false, url: "/r/abc", createdAt: "2026-03-14T00:00:00Z",
}, o);

// ---------------------------------------------------------------------------
// The firm's buildings (migration 045, Three Spaces slice 3) — the deck's
// index. Presentation only; org-buildings.js decides what may be stored.
// ---------------------------------------------------------------------------
const BUILDINGS_RE = /  let firmBuildings = \[\];[\s\S]*?\n  document\.getElementById\("buildingAddForm"\)\.addEventListener\("submit"[\s\S]*?\n  \}\);/;
function loadBuildings(opts) {
  const o = opts || {};
  const routes = [["/api/org/buildings", o.route || { status: o.status || 200, body: o.body }]];
  const fetch = makeFetch(routes);
  const ctx = load(BUILDINGS_RE,
    "this.render = renderBuildings; this.door = buildingDoor; this.onBoard = buildingOnBoard;" +
    " this.list = () => firmBuildings; this.setFirmKnown = (v) => { __firmKnown = v; };",
    // myFirm() answers null until renderFirm has resolved the membership on a
    // real page; __firmKnown lets a test model that cold-load beat.
    // COLLAPSE_AT is the desk's own threshold (index.html:~11860), stubbed
    // at the value the source pins below.
    "let currentUser = __user; let __firmKnown = true; function myFirm() { return __firmKnown ? __firm : null; }\n" +
    "const COLLAPSE_AT = 8;",
    { fetch, __user: o.user === undefined ? { email: "brad@colliers.com" } : o.user,
      __firm: o.firm === undefined ? { id: "o1", name: "Colliers Boise" } : o.firm });
  ctx.fetchLog = fetch.log;
  return ctx;
}
const BLDG = (o) => Object.assign({
  id: "b1", address: "500 Warehouse Way, Boise, ID", addressKey: "500 warehouse way boise id",
  verifiedKey: "", market: "Boise, ID", type: "Industrial", sizeSqft: 40000, yearBuilt: 1994,
  addedBy: "Mike", mine: false, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
}, o);

test("the buildings section states the server's count for the whole set and attributes each row", async () => {
  const ctx = loadBuildings({ body: {
    summary: "2 buildings · 2 Industrial", truncated: false,
    buildings: [BLDG({}), BLDG({ id: "b2", address: "7 Linder Rd, Meridian, ID", mine: true, addedBy: "Brad", sizeSqft: null, yearBuilt: null })],
  } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("deskBuildings"), false);
  assert.equal(ctx.dom.text("buildingsStats"), "2 buildings · 2 Industrial", "the line is the server's, never recomputed here");
  assert.equal(ctx.dom.hidden("buildingsEmpty"), true);
  assert.equal(ctx.dom.hidden("buildingsTruncated"), true);
  const text = ctx.dom.text("buildingRows");
  assert.match(text, /500 Warehouse Way, Boise, ID/);
  assert.match(text, /Industrial · 40,000 SF · built 1994 · added by Mike/);
  assert.match(text, /7 Linder Rd, Meridian, ID/);
  assert.match(text, /added by you/, "your own row reads 'you', the shelf's rule");
  assert.doesNotMatch(text, /added by Brad/);
  assert.equal(buttons(ctx.dom.el("buildingRows")).length, 2, "a Remove per row");
});

// The owner's overflow rule (slice 4): eight rows, then one control.
test("past eight buildings the desk shows eight and one link to the whole list", async () => {
  const twelve = Array.from({ length: 12 }, (_, i) => BLDG({ id: "b" + i, address: (i + 1) * 100 + " Cap St, Boise, ID" }));
  const ctx = loadBuildings({ body: { summary: "12 buildings · 12 Industrial", truncated: false, buildings: twelve } });
  await ctx.render();
  assert.equal(buttons(ctx.dom.el("buildingRows")).length, 8, "eight rows, most recent first");
  assert.match(ctx.dom.text("buildingRows"), /100 Cap St/);
  assert.doesNotMatch(ctx.dom.text("buildingRows"), /900 Cap St/, "the ninth is behind the link");
  assert.equal(ctx.dom.text("buildingsStats"), "12 buildings · 12 Industrial", "the count line still describes the whole set");
  assert.equal(ctx.dom.hidden("buildingsMore"), false);
  assert.equal(ctx.dom.text("buildingsMoreLink"), "See all 12 buildings →");
});

test("at eight or fewer the link does not render at all", async () => {
  const eight = Array.from({ length: 8 }, (_, i) => BLDG({ id: "b" + i, address: (i + 1) * 100 + " Cap St, Boise, ID" }));
  const ctx = loadBuildings({ body: { summary: "8 buildings", truncated: false, buildings: eight } });
  await ctx.render();
  assert.equal(buttons(ctx.dom.el("buildingRows")).length, 8);
  assert.equal(ctx.dom.hidden("buildingsMore"), true, "a control that can only be a no-op never renders");
});

test("the desk's threshold and the module's OVERFLOW_AT are one number", () => {
  const B = require("../org-buildings");
  assert.match(html, /const COLLAPSE_AT = 8;/, "index.html's threshold moved; move org-buildings.js's OVERFLOW_AT with it");
  assert.equal(B.OVERFLOW_AT, 8);
});

test("an empty board is an invitation, a failed read is neither", async () => {
  let ctx = loadBuildings({ body: { summary: "", truncated: false, buildings: [] } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("deskBuildings"), false);
  assert.equal(ctx.dom.hidden("buildingsEmpty"), false);
  assert.equal(ctx.dom.text("buildingsStats"), "");
  ctx = loadBuildings({ status: 503, body: { error: "down" } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("deskBuildings"), true,
    "'no buildings' and 'could not reach the database' must never look the same");
  assert.deepEqual(ctx.list(), []);
});

test("a truncated board says so rather than under-reporting", async () => {
  const ctx = loadBuildings({ body: { summary: "1000 buildings", truncated: true, buildings: [BLDG({})] } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("buildingsTruncated"), false);
});

test("a member of no firm, or a signed-out page, gets no buildings section and no fetch", async () => {
  let ctx = loadBuildings({ firm: null, body: { buildings: [BLDG({})] } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("deskBuildings"), true);
  assert.equal(ctx.fetchLog.length, 0);
  ctx = loadBuildings({ user: null, body: { buildings: [BLDG({})] } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("deskBuildings"), true);
  assert.equal(ctx.fetchLog.length, 0, "a stale firm in memory must not be asked about on a signed-out page");
});

test("the door shows only for a member of a firm and only for an address not already on the board", async () => {
  const ctx = loadBuildings({ body: { summary: "1 building", truncated: false,
    buildings: [BLDG({ verifiedKey: "500 warehouse way boise id 83702" })] } });
  await ctx.render();
  const shown = (d) => d && !d.classList.contains("hidden");
  assert.equal(shown(ctx.door({ address: "1 New St, Boise, ID" })), true, "a new address gets the door");
  assert.equal(shown(ctx.door({ address: "500 WAREHOUSE WAY, Boise, ID  " })), false, "the exact address, whatever its case, is already listed");
  assert.equal(shown(ctx.door({ address: "500 Warehouse Way, Boise, ID 83702", verifiedKey: "500 warehouse way boise id 83702" })), false,
    "the same building typed another way meets through the verified key");
  assert.equal(ctx.door({ address: "" }), null);
  const noFirm = loadBuildings({ firm: null, body: { buildings: [] } });
  assert.equal(shown(noFirm.door({ address: "1 New St, Boise, ID" })), false, "no firm, no door");
  const noUser = loadBuildings({ user: null, body: { buildings: [] } });
  assert.equal(noUser.door({ address: "1 New St, Boise, ID" }), null, "signed out, nothing is even created");
});

test("a door created before the firm resolved is revealed once the list loads — the cold-load order", async () => {
  // The portfolio table is drawn before renderFirm has answered, so a door
  // decided at creation time would leave every property row doorless.
  const ctx = loadBuildings({ body: { summary: "1 building", truncated: false, buildings: [BLDG({})] } });
  ctx.setFirmKnown(false);
  const early = ctx.door({ address: "1 New St, Boise, ID" });
  const listed = ctx.door({ address: "500 Warehouse Way, Boise, ID" });
  assert.ok(early.classList.contains("hidden"), "hidden until the list is known");
  ctx.setFirmKnown(true);
  await ctx.render();
  assert.equal(early.classList.contains("hidden"), false, "revealed by the renderer");
  assert.equal(listed.classList.contains("hidden"), true, "and the one already on the board stays hidden");
});

test("the door posts the identity the row already holds and then re-reads the board", async () => {
  const seen = [];
  const ctx = loadBuildings({ route: () => {
    seen.push(1);
    return seen.length === 1
      ? { status: 200, body: { summary: "", truncated: false, buildings: [] } }
      : { status: 200, body: { ok: true, existed: false, building: BLDG({}) } };
  } });
  await ctx.render();
  const door = ctx.door({ address: "500 Warehouse Way, Boise, ID", propertyType: "Industrial", verifiedKey: "500 warehouse way boise id 83702" });
  assert.ok(door);
  await door.fire("click");
  const post = ctx.fetchLog.find((c) => c.init && c.init.method === "POST");
  assert.ok(post, "nothing was posted");
  assert.deepEqual(JSON.parse(post.init.body), {
    address: "500 Warehouse Way, Boise, ID", propertyType: "Industrial", verifiedKey: "500 warehouse way boise id 83702",
  }, "the verified key travels, so the same building typed two ways still meets one row");
  assert.equal(door.textContent, "On the firm's list");
  assert.match(ctx.dom.text("buildingMsg"), /Added 500 Warehouse Way, Boise, ID to Colliers Boise's buildings/);
});

// ---------------------------------------------------------------------------
// Conversations on the Workspace, and the contact door (slice 8)
// ---------------------------------------------------------------------------
const THREADS_RE = /  const DESK_THREADS = 5;[\s\S]*?\n  async function renderDeskThreads\(\) \{[\s\S]*?\n  \}/;
function loadDeskThreads(opts) {
  const o = opts || {};
  const fetch = makeFetch([["/api/messages", { status: o.status || 200, body: o.body }]]);
  return load(THREADS_RE,
    "this.render = renderDeskThreads;",
    "let currentUser = __user; function myFirm() { return __firm; }",
    { fetch, __user: o.user === undefined ? { email: "brad@colliers.com" } : o.user,
      __firm: o.firm === undefined ? { id: "o1", name: "Colliers Boise" } : o.firm });
}
const TH = (o) => Object.assign({ id: "t1", label: "Mike", unread: 0, lastMessageAt: "2026-09-01T00:00:00Z", preview: "Seen the comp?" }, o);

test("the Workspace shows at most five conversations, unread first, each a door into /messages", async () => {
  const body = { threads: [
    TH({ id: "old", label: "Old", lastMessageAt: "2026-01-01T00:00:00Z" }),
    TH({ id: "u", label: "Dana", unread: 2, lastMessageAt: "2026-02-01T00:00:00Z" }),
    TH({ id: "n1", label: "N1", lastMessageAt: "2026-09-01T00:00:00Z" }),
    TH({ id: "n2", label: "N2", lastMessageAt: "2026-08-01T00:00:00Z" }),
    TH({ id: "n3", label: "N3", lastMessageAt: "2026-07-01T00:00:00Z" }),
    TH({ id: "n4", label: "N4", lastMessageAt: "2026-06-01T00:00:00Z" }),
  ] };
  const ctx = loadDeskThreads({ body });
  await ctx.render();
  assert.equal(ctx.dom.hidden("deskThreads"), false);
  assert.match(ctx.dom.text("deskThreadsStats"), /6 conversations · 1 unread/, "the count describes the whole list");
  const rows = ctx.dom.el("deskThreadRows").children;
  assert.equal(rows.length, 5, "five, never more");
  assert.match(rows[0].textContent, /● Dana/, "unread first, marked");
  assert.match(rows[0].textContent, /2 new/);
  assert.match(rows[1].textContent, /N1/, "then most recent");
  assert.doesNotMatch(ctx.dom.text("deskThreadRows"), /Old/, "the oldest fell off the five");
  assert.equal(rows[0].children[0].href, "/messages?t=u");
});

test("no firm, a failed read, or a signed-out page: no conversations section, no fetch where there is no member", async () => {
  let ctx = loadDeskThreads({ firm: null, body: { threads: [TH({})] } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("deskThreads"), true);
  ctx = loadDeskThreads({ status: 503, body: { error: "down" } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("deskThreads"), true, "'could not read' is not 'no conversations'");
  ctx = loadDeskThreads({ body: { threads: [] } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("deskThreadsEmpty"), false);
});

test("the contact door names the person and the company, and NEVER their email", () => {
  const src = html.match(/  function contactDiscussHref\(c\) \{[\s\S]*?\n  \}/);
  assert.ok(src, "contactDiscussHref is gone from index.html");
  const fn = new Function(src[0] + "\nreturn contactDiscussHref;")();
  const href = fn({ name: "Dana Wu", company: "Acme Logistics", email: "dana@acme.com", notes: "call after 3" });
  assert.match(href, /^\/messages\?say=/);
  const said = decodeURIComponent(href.slice("/messages?say=".length));
  assert.match(said, /^Contact: Dana Wu · Acme Logistics/);
  assert.doesNotMatch(said, /dana@acme\.com|@/, "the email must not spread into a message — 039's rule");
  assert.doesNotMatch(said, /call after 3/, "nor the notes");
  assert.equal(fn({ name: "", company: "" }), "", "nobody to name, no door");
  // And the row builder uses it, with nothing else on the href.
  assert.match(html, /talk\.href = contactDiscussHref\(c\);/);
});

test("the shelf row's Discuss sends the report as a LINK, never a copy of it", () => {
  assert.match(html, /talk\.href = "\/messages\?say=" \+ encodeURIComponent\("About the " \+ \(r\.type \? r\.type \+ " " : ""\) \+ "report on " \+ r\.address \+ ": " \+ r\.url\);/,
    "the shelf's Discuss must carry the report's URL, so report-access.js stays the sole decider of who may read it");
});

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
// What a revoke and a firm share must not leave behind
//
// All three of these were found by driving the firm surfaces by hand on
// 2026-08-19 and are invisible to a reader of the source: each one is a piece
// of state that outlives the thing it described.
// ---------------------------------------------------------------------------

test("undoing an auto-share forgets the link it just revoked", async () => {
  const fetch = makeFetch([["/api/shares/revoke", { body: { ok: true } }]]);
  const ctx = load(AUTONOTICE_RE,
    "this.fn = renderAutoShareNotice; this.setMeta = (m) => { currentMeta = m; };" +
    " this.memo = () => lastPublished;",
    "let currentMeta = null;\n" +
    "let lastPublished = { parsed: {}, key: '[\"org\",[],false,\"o1\"]', result: { url: '/r/sh1' } };",
    { fetch });
  ctx.setMeta({ autoShared: { firm: "Colliers Boise", id: "sh1", url: "/r/sh1", undone: false } });
  ctx.fn();
  await buttons(ctx.dom.el("autoShareNotice"))[0].fire("click");
  // The publish memo keys on the audience and on object identity, and a
  // revoke changes neither. Without this reset, Undo followed by Share to the
  // same firm handed back the URL that had just been revoked, under "Link
  // copied. It is on <firm>'s desk now." — nothing published, nothing for a
  // colleague to open, and no error anywhere.
  assert.equal(ctx.memo().result, null, "the publish memo still holds the revoked link");
  assert.equal(ctx.memo().parsed, null);
});

test("a shared report never shows the sender's auto-share line", () => {
  // Shares published before publishCurrentReport began stripping it carry
  // `autoShared` inside their stored payload, so the colleague opening a LIVE
  // firm link was told "Removed from <firm>" on a report nobody had revoked —
  // and, un-undone, was handed an Undo button for somebody else's share.
  const ctx = load(AUTONOTICE_RE,
    "this.fn = renderAutoShareNotice; this.setMeta = (m) => { currentMeta = m; };",
    "let currentMeta = null;");
  ctx.setMeta({ shared: true, autoShared: { firm: "Colliers Boise", id: "sh1", undone: true } });
  ctx.fn();
  assert.equal(ctx.dom.hidden("autoShareNotice"), true);
  assert.equal(ctx.dom.text("autoShareNotice"), "", "a reader of a shared report was told about a revoke");
});

const PUBLISH_RE = /  async function publishCurrentReport\(opts = \{\}\) \{[\s\S]*?\n  \}/;

test("a share carries the report, not the sender's note about sharing it", async () => {
  const fetch = makeFetch([["/api/share", { body: { id: "sh2", url: "/r/sh2", visibility: "org" } }]]);
  const ctx = load(PUBLISH_RE,
    "this.publish = publishCurrentReport; this.meta = () => currentMeta;",
    "let currentParsed = { comps: [] };\n" +
    "let currentMeta = { address: '1 Main St', autoShared: { firm: 'Colliers Boise', id: 'sh1', undone: true } };\n" +
    "let lastPublished = { parsed: null, key: '', result: null };\n" +
    "const location = { pathname: '/', href: 'https://compninja.co/' };",
    { fetch });
  await ctx.publish({ visibility: "org", orgId: "o1" });
  const sent = JSON.parse(fetch.log[0].init.body);
  assert.equal(sent.meta.address, "1 Main St");
  assert.ok(!("autoShared" in sent.meta), "the sender's auto-share note was stored inside the share");
  // Stripped from the COPY that goes over the wire, never off the live report:
  // the sender is still looking at their own notice, and its Undo needs the
  // share id it names.
  assert.ok(ctx.meta().autoShared, "the sender's own notice lost its Undo");
});

// ---------------------------------------------------------------------------
// Attribution — whose comp is this
// ---------------------------------------------------------------------------
const BADGE_RE = /  function firmOfComp\(comp\) \{[\s\S]*?\n  \}\n\n  function sourceBadge\(comp\) \{[\s\S]*?\n  \}/;

function loadBadge() {
  return load(BADGE_RE, "this.badge = sourceBadge;",
    "const SOURCE_TIERS = { broker_vault: { label: 'From your vault', cls: 'bv', legend: 'a private comp' } };\n" +
    "const VALUATION = { tierOf: () => 'broker_vault' };\n" +
    "function compTier(c) { return VALUATION.tierOf(c); }");
}

test("a colleague's comp names them on screen, not only on hover", () => {
  const el = loadBadge().badge({ private: true, firm: "Colliers Boise", shared_by: "Dana Reyes" });
  assert.match(el.textContent, /From Colliers Boise/);
  // `title` is a desktop hover with no touch equivalent, so the attribution
  // did not exist at all on a phone and was found by accident on a laptop.
  // Whose comp it is decides whether a broker trusts the row and who they can
  // ask about it, which is the point of sharing into a firm at all.
  assert.match(el.textContent, /Dana Reyes/, "the sharer is hover-only again");
  const cred = el.children[el.children.length - 1];
  assert.ok(!/06603A/.test(cred.className),
    "the firm credit is wearing the green Verified colour, which is a public claim it has not earned");
});

test("an unattributed firm comp still says which firm, and invents no name", () => {
  const el = loadBadge().badge({ private: true, firm: "Colliers Boise" });
  assert.equal(el.textContent, "From Colliers Boise");
  assert.match(el.title, /Shared with Colliers Boise/);
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
  const shop = loadShop();
  shop.fn({ name: "F", kind: "development", canManage: true });
  collect(shop);
  const create = loadCreate({ kind: "" });
  await create.click();
  collect(create);

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

// ---------------------------------------------------------------------------
// Shop kind (migration 036) — the browser half of Transition Plan v2 §6.
//
// A tenant rep shop was a third kind from 2026-08-21 and was withdrawn on
// 2026-08-31. The database CHECK still accepts the string, so a firm may
// genuinely still hold it, and the tests below say what such a firm sees.
//
// Two things are worth executing rather than reading: that a control which
// only an owner may use is not offered to everybody, and that the shelf's
// saved view never hides rows while its own filter is off screen.
// ---------------------------------------------------------------------------
const SHOP_COPY_RE = /  const SHOP_COPY = \{[\s\S]*?\n  const shopCopy = [^\n]*\n/;
const SHOP_RE = /  function renderFirmShop\(firm\) \{[\s\S]*?\n  \}/;

function loadShop() {
  const copy = html.match(SHOP_COPY_RE);
  assert.ok(copy, "index.html's SHOP_COPY block moved — the slice below reads it");
  return load(SHOP_RE, "this.fn = renderFirmShop;", copy[0]);
}

test("an owner may change the shop; a colleague reads it and cannot", () => {
  const owner = loadShop();
  owner.fn({ name: "Boise Land Partners", kind: "development", canManage: true });
  assert.equal(owner.dom.el("firmShopSelect").value, "development");
  assert.equal(owner.dom.el("firmShopSelect").disabled, false);
  assert.match(owner.dom.text("firmShopState"), /land comps, rent comps/);

  const colleague = loadShop();
  colleague.fn({ name: "Colliers Boise", kind: "broker", canManage: false });
  assert.equal(colleague.dom.el("firmShopSelect").disabled, true,
    "/api/org/settings refuses them, and a control that can only fail is worse than a sentence");
  // They still read the answer: it is why their shelf opens the way it does.
  assert.match(colleague.dom.text("firmShopState"), /^Broker shop · your shelf holds comp sets, BOVs/);
});

test("a firm still holding the withdrawn tenant rep kind reads as a broker shop", () => {
  // The browser half of the rule that let 037 be withdrawn without a data
  // migration. The failure this executes is a SELECT with no matching option:
  // a value read straight off the row would leave the box blank, and an owner
  // correcting a blank writes a kind to a firm nobody meant to re-label.
  const ctx = loadShop();
  ctx.fn({ name: "Ada Tenant Advisors", kind: "tenant_rep", canManage: true });
  assert.equal(ctx.dom.el("firmShopSelect").value, "broker",
    "a retired kind falls back to the incumbent option, never to nothing");
  assert.match(ctx.dom.text("firmShopState"), /comp sets, BOVs/);
  assert.doesNotMatch(ctx.dom.text("firmShopState"), /lease abstracts, rent comps and market surveys/);

  const colleague = loadShop();
  colleague.fn({ name: "Ada Tenant Advisors", kind: "tenant_rep", canManage: false });
  assert.equal(colleague.dom.el("firmShopSelect").disabled, true);
  assert.match(colleague.dom.text("firmShopState"), /^Broker shop · your shelf holds/);
});

test("a firm from before 036 reads as a broker shop rather than as nothing", () => {
  const ctx = loadShop();
  ctx.fn({ name: "Colliers Boise", canManage: true });   // no kind at all
  assert.equal(ctx.dom.el("firmShopSelect").value, "broker");
  assert.match(ctx.dom.text("firmShopState"), /comp sets, BOVs, market reports and lease abstracts/);
});

const LAND = (o) => ITEM(Object.assign({ type: "Land", address: "40 acres, Kuna" }, o));
const sixItems = (type) => Array.from({ length: 6 }, (_, i) =>
  ITEM({ type: i < 2 ? "Land" : type, address: `${i} Test St` }));

test("a development shop's shelf opens on Land, and says how much it is not showing", async () => {
  const ctx = loadShelf({
    firm: { id: "o1", name: "Boise Land Partners", kind: "development" },
    body: { items: sixItems("Industrial") },
  });
  await ctx.render();
  assert.equal(ctx.dom.el("firmShelfType").value, "Land", "§6's saved view");
  // The whole shelf in the header, the filtered slice named separately: a view
  // the colleague did not choose must never read as the record having shrunk.
  assert.match(ctx.dom.text("firmShelfStats"), /6 reports/);
  assert.equal(ctx.dom.text("firmShelfCount"), "2 of 6");
  assert.equal(ctx.dom.el("sharedWithFirmRows").children.length, 2);
});

test("a withdrawn kind's shelf opens on everything rather than on nothing", async () => {
  // The shelf reads shelfType off the same map, so a retired kind must land
  // on the broker default. The failure worth executing is a shelf filtered by
  // `undefined`, which shows a colleague an empty record of their own firm.
  const ctx = loadShelf({
    firm: { id: "o1", name: "Ada Tenant Advisors", kind: "tenant_rep" },
    body: { items: sixItems("Office") },
  });
  await ctx.render();
  assert.equal(ctx.dom.el("firmShelfType").value, "");
  assert.equal(ctx.dom.el("sharedWithFirmRows").children.length, 6);
});

test("a broker shop's shelf opens on everything", async () => {
  const ctx = loadShelf({
    firm: { id: "o1", name: "Colliers Boise", kind: "broker" },
    body: { items: sixItems("Industrial") },
  });
  await ctx.render();
  assert.equal(ctx.dom.el("firmShelfType").value, "");
  assert.equal(ctx.dom.el("sharedWithFirmRows").children.length, 6);
  assert.equal(ctx.dom.text("firmShelfCount"), "", "nothing is being filtered, so nothing is counted");
});

test("the saved view never hides rows while its own filter is off screen", async () => {
  // The filter row is furniture under six rows and hides itself. If the
  // default still applied, a five-report shelf would show two and offer no
  // visible way to ask why — a record that appears to have lost something.
  const ctx = loadShelf({
    firm: { id: "o1", name: "Boise Land Partners", kind: "development" },
    body: { items: [LAND({}), ITEM({ address: "1 A St" }), ITEM({ address: "2 B St" })] },
  });
  await ctx.render();
  assert.equal(ctx.dom.hidden("firmShelfSearchWrap"), true);
  assert.equal(ctx.dom.el("firmShelfType").value, "", "cleared, not merely hidden");
  assert.equal(ctx.dom.el("sharedWithFirmRows").children.length, 3, "every row is on the shelf");
});

test("a colleague's own choice of filter survives the next render", async () => {
  const ctx = loadShelf({
    firm: { id: "o1", name: "Boise Land Partners", kind: "development" },
    body: { items: sixItems("Retail") },
  });
  await ctx.render();
  assert.equal(ctx.dom.el("firmShelfType").value, "Land");
  // They widen it themselves. A default that undoes a person's own click is
  // not a default, it is a fight — so the second render leaves it alone.
  ctx.dom.el("firmShelfType").value = "";
  ctx.touch();
  await ctx.render();
  assert.equal(ctx.dom.el("firmShelfType").value, "");
  assert.equal(ctx.dom.el("sharedWithFirmRows").children.length, 6);
});

test("the type filter and the search box narrow together", async () => {
  const ctx = loadShelf({
    firm: { id: "o1", name: "Boise Land Partners", kind: "broker" },
    body: { items: [LAND({ market: "Kuna, ID" }), LAND({ address: "80 acres, Nampa", market: "Nampa, ID" }),
                    ITEM({ address: "500 Warehouse Way" })] },
  });
  await ctx.render();
  ctx.dom.el("firmShelfType").value = "Land";
  ctx.dom.el("firmShelfSearch").value = "nampa";
  ctx.filter();
  assert.equal(ctx.dom.el("sharedWithFirmRows").children.length, 1);
  assert.equal(ctx.dom.text("firmShelfCount"), "1 of 3");
  // An empty shelf and a filter with no hits are still told apart, now that
  // either control can be the one that empties the list.
  ctx.dom.el("firmShelfSearch").value = "nothing here";
  ctx.filter();
  assert.equal(ctx.dom.hidden("firmShelfNoMatch"), false);
});

// The create button, which is where the shop question is REQUIRED. Sliced as
// the handler it is: the guard has to hold in the browser as well as on the
// route, or the server's refusal arrives as a sentence under the name box
// about a question further up the form.
const CREATE_RE = /  document\.getElementById\("firmCreateBtn"\)\.addEventListener\("click", async \(\) => \{[\s\S]*?\n  \}\);/;

function loadCreate(opts) {
  const o = opts || {};
  const fetch = makeFetch([["/api/org", { status: o.status || 200, body: o.body || { id: "o1" } }]]);
  const copy = html.match(SHOP_COPY_RE);
  const ctx = load(CREATE_RE, "this.fetch = fetch;",
    copy[0] + "\nasync function renderShares() {}\nfunction openUpgradePrompt() {}", { fetch });
  ctx.dom.el("firmNameInput").value = o.name === undefined ? "Colliers Boise" : o.name;
  ctx.dom.el("firmKindSelect").value = o.kind === undefined ? "broker" : o.kind;
  ctx.click = () => ctx.dom.el("firmCreateBtn").fire("click");
  return ctx;
}

test("creating a firm without answering the shop question asks nothing of the server", async () => {
  const ctx = loadCreate({ kind: "" });
  await ctx.click();
  assert.equal(ctx.fetch.log.length, 0, "the round trip was spent on a question the page could answer");
  assert.equal(ctx.dom.hidden("firmCreateErr"), false);
  assert.match(ctx.dom.text("firmCreateErr"),
    /broker shop or a development shop/);
  assert.equal(ctx.dom.el("firmCreateBtn").disabled, false, "and the button comes back");
});

test("a firm is created with both answers, and the form is left empty", async () => {
  const ctx = loadCreate({ kind: "development", name: "Boise Land Partners" });
  await ctx.click();
  assert.equal(ctx.fetch.log.length, 1);
  const sent = JSON.parse(ctx.fetch.log[0].init.body);
  assert.deepEqual(sent, { name: "Boise Land Partners", kind: "development" });
  assert.equal(ctx.dom.el("firmNameInput").value, "");
  assert.equal(ctx.dom.el("firmKindSelect").value, "", "the next firm asks the question again");
});
