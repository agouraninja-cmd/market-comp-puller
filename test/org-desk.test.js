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
    // Two more, for the contacts panel's toggle: aria-expanded rides the
    // single writer, and opening it focuses the first field.
    attrs: {},
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    focus() {},
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
    createElementNS: (ns, tag) => makeEl(tag),
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
  // The renderers read through bootFetch (2026-09-04), which in the page
  // consults the serve-time payload first. There is no payload here, so it
  // is the sandbox's fetch — the one each test hands in — by another name.
  const bootFetch = "function bootFetch(url, init) { return fetch(url, init); }\n";
  new vm.Script(bootFetch + (prefix || "") + "\n" + src[0] + "\n" + exports,
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

test("the follow option names the firm's current setting, so it never reads as a copy of 'always'", () => {
  // Owner's read of the control (2026-09-01): "Follow the firm" and "Always
  // share with the firm" looked like one option twice. They ARE one outcome
  // while the firm default is on; they part when it is off. So the follow
  // label carries the firm's current setting, and "always" says what it
  // survives. This pins that the label is written from shareDefault — the
  // firm's own switch — in both states, and that the static markup no longer
  // ships the two labels that read alike.
  const ctx = load(AUTOSHARE_RE, "this.fn = renderFirmAutoShare;");
  ctx.fn({ name: "Colliers Boise", canManage: false, shareDefault: "reports", autoShare: null, autoShareOn: true });
  assert.match(ctx.dom.text("firmAutoShareFollow"), /Use the firm's setting \(currently on\)/);
  ctx.fn({ name: "Colliers Boise", canManage: false, shareDefault: "none", autoShare: null, autoShareOn: false });
  assert.match(ctx.dom.text("firmAutoShareFollow"), /Use the firm's setting \(currently off\)/);
  assert.match(html, /<option value="always">Always share, even if the firm turns it off<\/option>/,
    "the always option has to say what it survives, or it reads as follow-while-on");
  assert.doesNotMatch(html, /Follow the firm</, "the old label read as a duplicate of 'always'");
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
// The firm's buildings (migration 046, Three Spaces slice 3) — the deck's
// index. Presentation only; org-buildings.js decides what may be stored.
// ---------------------------------------------------------------------------
const BUILDINGS_RE = /  let firmBuildings = \[\];[\s\S]*?\n  document\.getElementById\("buildingAddForm"\)\.addEventListener\("submit"[\s\S]*?\n  \}\);/;
function loadBuildings(opts) {
  const o = opts || {};
  const routes = [["/api/org/buildings", o.route || { status: o.status || 200, body: o.body }]];
  const fetch = makeFetch(routes);
  const ctx = load(BUILDINGS_RE,
    "this.render = renderBuildings; this.door = buildingDoor; this.onBoard = buildingOnBoard;" +
    " this.list = () => firmBuildings; this.setFirmKnown = (v) => { __firmKnown = v; };" +
    " this.setOpen = setBuildingAddOpen;" +
    // The table's two borrowed columns (Draft 1): the shelf count and the
    // next lease date, read from state other sections parsed.
    " this.setCritical = (c) => { deskCritical = c; }; this.decorate = decorateBuildingRows;",
    // myFirm() answers null until renderFirm has resolved the membership on a
    // real page; __firmKnown lets a test model that cold-load beat.
    // COLLAPSE_AT is the desk's own threshold (index.html:~11860), stubbed
    // at the value the source pins below. firmShelfItems is the shelf's own
    // module-level list, declared above this slice on the real page.
    "let currentUser = __user; let __firmKnown = true; function myFirm() { return __firmKnown ? __firm : null; }\n" +
    "const COLLAPSE_AT = 8; let firmShelfItems = __shelf;",
    { fetch, __user: o.user === undefined ? { email: "brad@colliers.com" } : o.user,
      __firm: o.firm === undefined ? { id: "o1", name: "Colliers Boise" } : o.firm,
      __shelf: o.shelf || [] });
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
  assert.match(text, /7 Linder Rd, Meridian, ID/);
  assert.match(text, /added by you/, "your own row reads 'you', the shelf's rule");
  assert.doesNotMatch(text, /added by Brad/);
  // A table since Draft 1: each figure is its own cell, in column order.
  const cells = (row) => row.children.filter((c) => /\bdk-bc\b/.test(c.className)).map((c) => c.textContent);
  const [first, second] = ctx.dom.el("buildingRows").children;
  assert.equal(first.children[1].textContent, "added by Mike");
  assert.deepEqual(cells(first), ["Industrial", "40,000 SF", "1994", "—", "—"]);
  assert.deepEqual(cells(second), ["Industrial", "—", "—", "—", "—"], "a blank figure is a dash, never a zero");
  assert.equal(ctx.dom.hidden("buildingsHead"), false, "the column header shows with the rows");
  assert.equal(buttons(ctx.dom.el("buildingRows")).length, 2, "a Remove per row");
});

// Draft 1 (2026-09-24): the one destructive verb moved behind ⋯, and the
// two columns Buildings cannot fill itself come from state other sections
// already parsed — never a fetch of their own.
test("Remove sits in the row's menu, beside a way to the sheet, not on the row", async () => {
  const ctx = loadBuildings({ body: { summary: "1 building", truncated: false, buildings: [BLDG({})] } });
  await ctx.render();
  const row = ctx.dom.el("buildingRows").children[0];
  const menu = row.children[row.children.length - 1];
  assert.equal(menu.tagName, "DETAILS", "the last cell is the ⋯ menu");
  assert.equal(menu.className, "dk-menu");
  assert.match(menu.children[0].getAttribute("aria-label"), /^More for 500 Warehouse Way/, "the knob names its row for a screen reader");
  const pop = menu.children[1];
  assert.equal(pop.children[0].href, "/building/b1");
  assert.equal(pop.children[1].tagName, "BUTTON");
  assert.equal(pop.children[1].textContent, "Remove from the board");
  assert.ok(!row.children.some((c) => c.tagName === "BUTTON"), "no button sits on the row itself");
});

test("the shelf and next-date columns are read from the shelf and the leases, and can only under-count", async () => {
  const ctx = loadBuildings({
    body: { summary: "2 buildings", truncated: false, buildings: [
      BLDG({}), BLDG({ id: "b2", address: "7 Linder Rd, Meridian, ID" })] },
    shelf: [
      { address: "500 WAREHOUSE WAY, Boise, ID " }, { address: "500 Warehouse Way, Boise, ID" },
      { address: "500 Warehouse Way Boise ID" },   // typed another way: missed, never guessed
    ],
  });
  await ctx.render();
  const cell = (i, cls) => ctx.dom.el("buildingRows").children[i].children.find((c) => c.className.includes("dk-bc-" + cls));
  assert.equal(cell(0, "shelf").textContent, "2 reports", "the exact address, whatever its case or padding");
  assert.equal(cell(1, "shelf").textContent, "—");
  assert.equal(cell(0, "next").textContent, "—", "no leases read yet");
  ctx.setCritical([
    { buildingId: "b2", kind: "notice", date: "2026-11-04", days: 41, tenant: "Acme" },
    { buildingId: "b2", kind: "expiry", date: "2027-02-01", days: 130, tenant: "Acme" },
    { buildingId: "b1", kind: "expiry", date: "2027-07-21", days: 300, tenant: "Dental" },
  ]);
  ctx.decorate();
  assert.match(cell(1, "next").textContent, /^Notice Nov 4/, "the soonest date is the next date");
  assert.ok(cell(1, "next").classList.contains("due"), "inside ninety days it is the red figure");
  assert.match(cell(0, "next").textContent, new RegExp("^Expires Jul 21" + (new Date().getUTCFullYear() === 2027 ? "$" : ", 2027$")),
    "a date in another year says the year");
  assert.ok(!cell(0, "next").classList.contains("due"));
  assert.equal(ctx.fetchLog.length, 1, "one read of its own route, and nothing else");
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

// The Ledger redesign (2026-09-04): the add form ships closed behind one
// control, the Contacts rule applied to the section that never got it.
test("the buildings add form ships closed behind one control, with one writer", () => {
  assert.match(html, /id="buildingAddForm" class="hidden /, "the form ships hidden — the vault's #addSec rule");
  assert.match(html, /id="buildingAddToggle" aria-expanded="false" aria-controls="buildingAddForm"/);
  assert.equal((html.match(/getElementById\("buildingAddForm"\)\.classList/g) || []).length, 1,
    "setBuildingAddOpen is the single writer of the form's visibility");
  const ctx = loadBuildings({ body: { summary: "", truncated: false, buildings: [] } });
  ctx.setOpen(true);
  assert.equal(ctx.dom.hidden("buildingAddForm"), false);
  assert.equal(ctx.dom.el("buildingAddToggle").getAttribute("aria-expanded"), "true");
  assert.match(ctx.dom.text("buildingAddToggle"), /Close/);
  ctx.setOpen(false);
  assert.equal(ctx.dom.hidden("buildingAddForm"), true);
  assert.equal(ctx.dom.el("buildingAddToggle").getAttribute("aria-expanded"), "false");
  assert.match(ctx.dom.text("buildingAddToggle"), /Add by address/);
});

// One row family (2026-09-04). The rows are FLAT — the tests above index a
// row's children by position — and their text is unchanged; only the
// classes moved. This pins the family so a renderer cannot drift back to
// its own idiom, which is how the same building came to be a Georgia
// address on the shelf and an underlined sans one in Buildings.
test("buildings, conversations, the shelf and contacts draw one row family", async () => {
  const ctx = loadBuildings({ body: { summary: "1 building", truncated: false, buildings: [BLDG({})] } });
  await ctx.render();
  const row = ctx.dom.el("buildingRows").children[0];
  // Buildings is a table since Draft 1 (2026-09-24), but still one of the
  // family: a .dk-row, flat, the Georgia address first and the meta second.
  assert.equal(row.className, "dk-row dk-brow");
  assert.equal(row.children[0].className, "dk-row-name dk-addr", "the address is the name line, in Georgia");
  assert.equal(row.children[1].className, "dk-row-meta", "the meta sits under the name");
  // The shelf and the contacts, by source: same three classes.
  for (const fn of ["applyFirmShelfFilter", "contactRow"]) {
    const at = html.indexOf(`function ${fn}(`);
    const src = html.slice(at, html.indexOf("\n  }\n", at));
    assert.ok(src.includes('className = "dk-row"'), `${fn} builds .dk-row`);
    assert.ok(src.includes('"dk-row-meta"'), `${fn} puts the meta on .dk-row-meta`);
    assert.ok(!src.includes("dk-shelf-") && !src.includes("db-row"), `${fn} left its old idiom`);
  }
  assert.ok(!/\.dk-shelf-row\s*\{/.test(html), "the shelf's own row rule is retired");
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

// ---------------------------------------------------------------------------
// Contacts on the Workspace (2026-09-02): the fold, the closed form, the label
// ---------------------------------------------------------------------------
const CONTACTS_RE = /  let contactsExpanded = false;[\s\S]*?\n  async function renderContacts\(\) \{[\s\S]*?\n  \}/;
function loadContacts(o) {
  const fetch = makeFetch([["/api/org/contacts", { status: o.status || 200, body: o.body }]]);
  return load(CONTACTS_RE,
    "this.render = renderContacts; this.setOpen = setContactAddOpen;",
    "const COLLAPSE_AT = 8; let currentUser = __user; function myFirm() { return __firm; }\n" +
    "let firmBuildings = __buildings;\n" +
    "function contactDiscussHref(c) { return '/messages?say=' + encodeURIComponent(c.name); }\n" +
    "function contactsMsg() {}",
    { fetch, __buildings: o.buildings || [], __user: o.user === undefined ? { email: "brad@colliers.com" } : o.user,
      __firm: o.firm === undefined ? { id: "o1", name: "Colliers Boise" } : o.firm });
}
const CT = (i) => ({ id: "c" + i, name: "Person " + i, company: "Co " + i, email: "p" + i + "@x.com", mine: i === 0, addedBy: "Mike" });

test("Contacts shows COLLAPSE_AT rows and folds the rest, while the count names the whole list", async () => {
  const ctx = loadContacts({ body: { contacts: Array.from({ length: 11 }, (_, i) => CT(i)) } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("deskContacts"), false);
  assert.match(ctx.dom.text("contactsStats"), /^11 contacts$/, "the count describes the whole list, not the eight shown");
  const wrap = ctx.dom.el("contactRows");
  assert.equal(wrap.children.length, 2, "the flat head and the fold");
  assert.equal(wrap.children[0].children.length, 8, "eight flat, never more — the buildings section's number");
  const fold = wrap.children[1];
  assert.equal(fold.tagName, "DETAILS");
  assert.equal(fold.open, false, "ships folded");
  assert.match(fold.children[0].textContent, /^Show 3 more$/);
  assert.equal(fold.children[1].children.length, 3, "the rest are in the fold, not dropped");
  assert.match(wrap.children[0].children[0].textContent, /Person 0.*added by you/, "the reader's own row says you");
});

test("under the cap there is no fold; no firm or a failed read hides the section", async () => {
  let ctx = loadContacts({ body: { contacts: [CT(0), CT(1)] } });
  await ctx.render();
  assert.equal(ctx.dom.el("contactRows").children.length, 1, "no details element under eight");
  assert.equal(ctx.dom.el("contactRows").children[0].children.length, 2);
  assert.equal(ctx.dom.hidden("contactsEmpty"), true);
  ctx = loadContacts({ body: { contacts: [] } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("contactsEmpty"), false);
  ctx = loadContacts({ firm: null, body: { contacts: [CT(0)] } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("deskContacts"), true);
  assert.equal(ctx.fetch.log.length, 0, "no member, no read");
  ctx = loadContacts({ status: 503, body: { error: "down" } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("deskContacts"), true, "'could not read' is not 'no contacts'");
});

test("a contact attached to a building carries a door to that building's sheet", async () => {
  const ctx = loadContacts({
    body: { contacts: [Object.assign(CT(0), { buildingId: "b1" }), Object.assign(CT(1), { buildingId: "b-unknown" }), CT(2)] },
    buildings: [{ id: "b1", address: "1210 N 17th St, Boise, ID" }],
  });
  await ctx.render();
  const rows = ctx.dom.el("contactRows").children[0].children;
  const links = (row) => (row.children || []).filter((el) => el.tagName === "A").map((a) => [a.href, a.textContent]);
  assert.deepEqual(links(rows[0]).filter((l) => l[0].startsWith("/building/")), [["/building/b1", "at 1210 N 17th St, Boise, ID"]]);
  assert.equal(links(rows[1]).filter((l) => l[0].startsWith("/building/")).length, 0, "a building the desk does not hold gets no door, never a broken one");
  assert.equal(links(rows[2]).filter((l) => l[0].startsWith("/building/")).length, 0);
});

test("the add/import form ships closed behind one control, with one writer", () => {
  // Markup: closed, and the control says what it opens.
  assert.match(html, /id="contactAddForm" class="hidden /, "the form ships hidden — the vault's #addSec rule");
  assert.match(html, /id="contactAddToggle" aria-expanded="false" aria-controls="contactAddForm"/);
  // One writer: nothing else touches the form's classes.
  assert.equal((html.match(/getElementById\("contactAddForm"\)\.classList/g) || []).length, 1,
    "setContactAddOpen is the single writer of the form's visibility");
  const ctx = loadContacts({ body: { contacts: [] } });
  ctx.setOpen(true);
  assert.equal(ctx.dom.hidden("contactAddForm"), false);
  assert.equal(ctx.dom.el("contactAddToggle").getAttribute("aria-expanded"), "true");
  assert.match(ctx.dom.text("contactAddToggle"), /Close/);
  ctx.setOpen(false);
  assert.equal(ctx.dom.hidden("contactAddForm"), true);
  assert.equal(ctx.dom.el("contactAddToggle").getAttribute("aria-expanded"), "false");
  assert.match(ctx.dom.text("contactAddToggle"), /Add or import/);
});

// ---------------------------------------------------------------------------
// The firm strip (2026-09-04) — four figures above the decks, drawn from the
// state the section renderers parsed plus one read of its own (the leases).
// ---------------------------------------------------------------------------
const STRIP_RE = /  async function readFirmCritical\(\) \{[\s\S]*?\n  function drawFirmStrip\(critical\) \{[\s\S]*?\n  \}\n/;
function loadStrip(opts) {
  const o = opts || {};
  const fetch = makeFetch([["/api/org/leases", o.leases || { status: 200, body: { critical: o.critical || [] } }]]);
  const ctx = load(STRIP_RE,
    "this.read = readFirmCritical; this.draw = drawFirmStrip;",
    "let currentUser = __user; function myFirm() { return __firm; }\n" +
    "let firmBuildings = __buildings; let firmShelfItems = __shelf; let deskThreadsStat = __threads;",
    { fetch, __user: o.user === undefined ? { email: "brad@colliers.com" } : o.user,
      __firm: o.firm === undefined ? { id: "o1", name: "Colliers Boise" } : o.firm,
      __buildings: o.buildings || [], __shelf: o.shelf || [], __threads: o.threads === undefined ? null : o.threads });
  ctx.fetchLog = fetch.log;
  // The sections the strip reads ship hidden in the markup; a populated desk
  // has shown them.
  if (!o.buildingsHidden) ctx.dom.el("deskBuildings").classList.remove("hidden");
  if (!o.shelfHidden) ctx.dom.el("deskSharedWithFirm").classList.remove("hidden");
  ctx.dom.el("buildingsStats").textContent = o.stats === undefined ? "2 buildings · 2 Industrial" : o.stats;
  return ctx;
}
const NOW_ISO = new Date().toISOString();

test("the strip draws its four figures from the sections' state and the leases read", async () => {
  const ctx = loadStrip({
    buildings: [BLDG({}), BLDG({ id: "b2" })],
    shelf: [{ market: "Boise, ID", createdAt: NOW_ISO }, { market: "Boise, ID", createdAt: "2026-01-02T00:00:00Z" }, { market: "Meridian, ID", createdAt: "2026-02-02T00:00:00Z" }],
    threads: { total: 5, unread: 2 },
    critical: [{ tenant: "Acme Logistics", kind: "notice", days: 41 }, { tenant: "Zed", kind: "expiry", days: 200 }],
  });
  ctx.draw(await ctx.read());
  assert.equal(ctx.dom.hidden("deskStrip"), false);
  assert.equal(ctx.dom.text("stripBuildingsFig"), "2");
  assert.equal(ctx.dom.text("stripBuildingsSub"), "2 Industrial", "the server's summary line, minus the count the figure already shows");
  assert.equal(ctx.dom.text("stripShelfFig"), "1 this month");
  assert.equal(ctx.dom.text("stripShelfSub"), "3 reports · 2 markets");
  assert.equal(ctx.dom.text("stripUnreadFig"), "2");
  assert.equal(ctx.dom.text("stripUnreadSub"), "of 5 conversations");
  assert.equal(ctx.dom.text("stripCriticalFig"), "2", "every date in the window counts");
  assert.equal(ctx.dom.text("stripCriticalSub"), "Acme Logistics · notice in 41 days", "the soonest is named");
  assert.ok(ctx.dom.el("stripCriticalFig").classList.contains("due"), "a due date is the one red figure");
  assert.equal(ctx.fetchLog.length, 1, "one read of its own, and no re-read of a section's route");
  assert.equal(ctx.fetchLog[0].url, "/api/org/leases?id=o1");
});

test("a figure whose read failed is a dash, never a zero", async () => {
  const ctx = loadStrip({ buildings: [BLDG({})], leases: { status: 503, body: {} }, threads: null, shelfHidden: true });
  ctx.draw(await ctx.read());
  assert.equal(ctx.dom.hidden("deskStrip"), false, "the other cells still draw");
  assert.equal(ctx.dom.text("stripCriticalFig"), "—");
  assert.match(ctx.dom.text("stripCriticalSub"), /Couldn't read leases/);
  assert.ok(!ctx.dom.el("stripCriticalFig").classList.contains("due"));
  assert.equal(ctx.dom.text("stripUnreadFig"), "—");
  assert.equal(ctx.dom.text("stripShelfFig"), "—");
});

test("no firm, or a buildings read that failed, means no strip", async () => {
  const none = loadStrip({ firm: null });
  none.draw(await none.read());
  assert.equal(none.dom.hidden("deskStrip"), true);
  assert.equal(none.fetchLog.length, 0, "no firm, no read");
  const failed = loadStrip({ buildingsHidden: true });
  failed.draw(await failed.read());
  assert.equal(failed.dom.hidden("deskStrip"), true, "a strip of dashes says nothing");
});

test("the strip lands in the same paint as the batch, and hides with the firm sections", () => {
  const at = html.indexOf("async function renderShares()");
  const fn = html.slice(at, html.indexOf("\n  }\n", at));
  assert.ok(fn.indexOf("const critical = readFirmCritical();") < fn.indexOf("const buildings = renderBuildings();"),
    "the leases read starts beside the batch, not after it");
  assert.ok(fn.indexOf("drawFirmStrip(await critical)") > fn.indexOf("await Promise.all(["),
    "the strip is drawn after the batch has parsed the state it reads");
  assert.ok(fn.includes('getElementById("deskStrip").classList.add("hidden")'), "hideAll hides the strip");
  assert.ok(!html.includes("bootFetch(`/api/org/leases?id=${encodeURIComponent(firm.id)}`)") ||
    (html.match(/bootFetch\(`\/api\/org\/leases\?id=\$\{encodeURIComponent\(firm\.id\)\}`\)/g) || []).length === 1,
    "exactly one reader of the leases route on the desk");
  // Every id the strip reaches for exists in the markup.
  const ctx = loadStrip({ buildings: [BLDG({})], threads: { total: 1, unread: 0 } });
  ctx.draw([]);
  for (const id of ctx.dom.asked) assert.ok(html.includes(`id="${id}"`), `the strip reads #${id}, which is not in index.html's markup`);
});

test("the section is labelled Contacts — the tenant-rep shop it was named for was withdrawn", () => {
  // The label may carry Draft C's head icon ahead of the word; the word is
  // what this test is about.
  assert.match(html, /<span class="rd-lab">(?:<span class="dk-hico[^"]*">[\s\S]*?<\/svg><\/span>)?Contacts<\/span>/);
  assert.doesNotMatch(html, /rd-lab">Tenant contacts</, "a broker shop or a development shop keeps a contact list too");
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

// ---------------------------------------------------------------------------
// The Firm account panel (2026-09-03) — the fourth state, said out loud
// ---------------------------------------------------------------------------
const OPEN_FIRM_RE = /  async function openFirmModal\(\) \{[\s\S]*?\n  \}/;

function loadOpenFirm({ shows, state, billing, isPro }) {
  return load(OPEN_FIRM_RE,
    "this.openFirmModal = openFirmModal; this.asked = () => __asked;",
    "let firmState = __state; let proConfig = { billing: __billing, isPro: __isPro }; let __asked = 0;\n" +
    "function billingLive() { return Boolean(proConfig && proConfig.billing); }\n" +
    // renderFirm is the section's own decider; here it stands in for the
    // outcome it would have reached — shown, or hidden.
    "async function renderFirm() { __asked++; document.getElementById('deskFirm').classList.toggle('hidden', !__shows); }",
    { __shows: shows, __state: state, __billing: billing, __isPro: isPro });
}

test("the firm panel asks for a fresh read on every open, and shows the section when there is one", async () => {
  const ctx = loadOpenFirm({ shows: true, state: { orgs: [{ id: "o1" }], invites: [], canCreate: true } });
  await ctx.openFirmModal();
  assert.equal(ctx.asked(), 1, "opening the panel did not re-read the firm — an invitation that arrived since would be missed");
  assert.equal(ctx.dom.hidden("firmModal"), false);
  assert.equal(ctx.dom.hidden("deskFirm"), false);
  assert.equal(ctx.dom.hidden("firmModalNone"), true, "'not in a firm' shown beside a roster");
  assert.equal(ctx.dom.hidden("firmModalErr"), true);
  assert.equal(ctx.dom.hidden("acctMenu"), true, "the account menu stayed open under the panel");
});

test("an account in no firm is TOLD so — a panel opened on purpose cannot answer with nothing", async () => {
  // On the workspace renderFirm hid the section and that was the answer. In
  // a modal somebody clicked, a blank card reads as broken.
  const ctx = loadOpenFirm({ shows: false, state: { orgs: [], invites: [], canCreate: false }, billing: true, isPro: false });
  await ctx.openFirmModal();
  assert.equal(ctx.dom.hidden("firmModalNone"), false);
  assert.equal(ctx.dom.hidden("firmModalErr"), true);
  assert.equal(ctx.dom.hidden("firmModalPricing"), false, "billing is live and the account is free: the pricing door is offered");
});

test("the pricing door inside that message follows the settings panel's rule", async () => {
  // Dark deployment: nothing for sale, so no door (the Buy-button rule).
  let ctx = loadOpenFirm({ shows: false, state: { orgs: [], invites: [], canCreate: false }, billing: false, isPro: false });
  await ctx.openFirmModal();
  assert.equal(ctx.dom.hidden("firmModalPricing"), true, "a pricing button on a deployment with no checkout");
  // Already Pro (say, in no firm and not invited): no door either.
  ctx = loadOpenFirm({ shows: false, state: { orgs: [], invites: [], canCreate: false }, billing: true, isPro: true });
  await ctx.openFirmModal();
  assert.equal(ctx.dom.hidden("firmModalPricing"), true, "a Pro member offered pricing");
});

test("a failed firm read says it failed — never 'you have no firm'", async () => {
  const ctx = loadOpenFirm({ shows: false, state: null, billing: true, isPro: false });
  await ctx.openFirmModal();
  assert.equal(ctx.dom.hidden("firmModalErr"), false);
  assert.equal(ctx.dom.hidden("firmModalNone"), true,
    "an outage was reported as the member having no firm");
});

test("the firm section lives in the panel, not on the workspace", () => {
  // The move itself. #deskFirm keeps its id (every renderer and the tests
  // above reach it by name), so the only thing that says where it is, is
  // which container encloses it.
  const modalAt = html.indexOf('id="firmModal"');
  const deskAt = html.indexOf('id="deskFirm"');
  const myDeskAt = html.indexOf('id="myDesk"');
  assert.ok(modalAt > -1 && deskAt > -1 && myDeskAt > -1);
  assert.ok(modalAt < deskAt && deskAt < myDeskAt,
    "#deskFirm is not inside #firmModal (which precedes the workspace markup)");
  assert.equal(html.split('id="deskFirm"').length - 1, 1, "exactly one firm section");
  // renderShares still hides it on sign-out: the roster names colleagues.
  assert.ok(html.includes('document.getElementById("deskFirm").classList.add("hidden");'),
    "a stale roster survives a sign-out");
});

// ---------------------------------------------------------------------------
// The firm deck's body for a member in no firm (2026-09-16). Until this
// existed every section of the deck rendered only for a member of a firm, so
// a member in none opened the workspace to the Sharing deck alone — with
// nothing saying what a firm is or where to start one (seen in the desktop
// app on an account with no firm). renderFirmEmpty() reads the membership
// renderFirm() already loaded and fetches nothing.
// ---------------------------------------------------------------------------
const FIRM_EMPTY_RE = /  function renderFirmEmpty\(\) \{[\s\S]*?\n  \}\n[\s\S]*?\n  function syncStartCards\(\) \{[\s\S]*?\n  \}\n/;
function loadFirmEmpty(o) {
  return load(FIRM_EMPTY_RE, "this.draw = renderFirmEmpty;",
    "let currentUser = __user; let firmState = __state; function myFirm() { return __firm; } let proConfig = __pro;",
    { __user: o.user === undefined ? { email: "brad@colliers.com" } : o.user,
      __state: o.state === undefined ? { orgs: [], invites: [], canCreate: true } : o.state,
      __firm: o.firm === undefined ? null : o.firm,
      __pro: o.pro === undefined ? { enabled: false } : o.pro });
}

test("a member who can create a firm is told what one gives and offered the door", () => {
  const ctx = loadFirmEmpty({});
  ctx.draw();
  assert.equal(ctx.dom.hidden("deskFirmEmpty"), false);
  assert.equal(ctx.dom.text("deskFirmEmptyLab"), "Not in a firm yet");
  assert.equal(ctx.dom.text("deskFirmEmptyBtn"), "Create a firm");
  assert.match(ctx.dom.text("deskFirmEmptyCopy"), /board of buildings, a shelf of shared reports, a contact list and conversations/);
  assert.match(ctx.dom.text("deskFirmEmptyCopy"), /keeps your own reports and vault/, "the privacy half of the promise travels with it");
});

test("a pending invitation names the firm and points at it instead of at creating one", () => {
  const ctx = loadFirmEmpty({ state: { orgs: [], invites: [{ orgId: "o1", name: "Colliers Boise" }], canCreate: true } });
  ctx.draw();
  assert.equal(ctx.dom.hidden("deskFirmEmpty"), false);
  assert.equal(ctx.dom.text("deskFirmEmptyLab"), "You've been invited");
  assert.equal(ctx.dom.text("deskFirmEmptyBtn"), "See the invitation");
  assert.match(ctx.dom.text("deskFirmEmptyCopy"), /^Colliers Boise invited you\./);
});

test("an account that cannot create a firm is not offered a Create button", () => {
  const ctx = loadFirmEmpty({ state: { orgs: [], invites: [], canCreate: false } });
  ctx.draw();
  assert.equal(ctx.dom.hidden("deskFirmEmpty"), false, "the explanation still shows — the deck must not be empty for a free member either");
  assert.notEqual(ctx.dom.text("deskFirmEmptyBtn"), "Create a firm");
  assert.match(ctx.dom.text("deskFirmEmptyCopy"), /Ask a colleague to invite you/);
});

test("a member of a firm, a failed read and a signed-out desk all show nothing", () => {
  for (const o of [
    { firm: { id: "o1", name: "Colliers Boise" }, state: { orgs: [{ id: "o1" }], invites: [], canCreate: true } },
    { state: null },
    { user: null },
  ]) {
    const ctx = loadFirmEmpty(o);
    ctx.dom.el("deskFirmEmpty").classList.remove("hidden"); // a stale reveal from the previous identity
    ctx.draw();
    assert.equal(ctx.dom.hidden("deskFirmEmpty"), true, JSON.stringify(o));
  }
});

test("the empty state is wired: first in the deck, drawn after the firm read, hidden by hideAll, and its button opens the panel", () => {
  const deck = html.indexOf('id="deckFirm"');
  const empty = html.indexOf('id="deskFirmEmpty"');
  const buildings = html.indexOf('id="deskBuildings"');
  assert.ok(deck > 0 && empty > deck && empty < buildings, "the no-firm body sits at the top of the firm deck, ahead of Buildings");
  const at = html.indexOf("async function renderShares()");
  const fn = html.slice(at, html.indexOf("\n  }\n", at));
  assert.ok(fn.indexOf("await firmReady;\n    // The no-firm body") > 0 && fn.indexOf("renderFirmEmpty();") > fn.indexOf("await firmReady;"),
    "renderShares draws it once the membership is known");
  assert.ok(fn.indexOf("renderFirmEmpty();") < fn.indexOf("await Promise.all(["), "and before the firm batch, so it lands in the one paint");
  assert.ok(fn.includes('getElementById("deskFirmEmpty").classList.add("hidden")'), "hideAll hides it with the rest of the firm surfaces");
  assert.ok(html.includes('document.getElementById("deskFirmEmptyBtn").addEventListener("click", () => {\n    if (typeof openFirmModal === "function") openFirmModal();'),
    "the one door is the Firm & branding panel, which already knows which state it is showing");
});

// ---------------------------------------------------------------------------
// Draft 1 (2026-09-24): the "Needs you" agenda, the dates card, the head's
// firm line and the find box. All four draw from state other sections have
// already parsed; none of them fetches.
// ---------------------------------------------------------------------------
const DATE_HELPERS_RE = /  function fmtDeskDay\(iso, withYear\) \{[\s\S]*?\n  function leaseWhat\(c\) \{[\s\S]*?\n  \}/;
const DATES_RE = /  const AGENDA_DAYS = 90;[\s\S]*?\n  function drawDeskHead\(\) \{[\s\S]*?\n  \}/;
// A test clock for the slice: `new Date()` reads `clock.now`, and timers are
// RECORDED, never scheduled. drawDeskHead arms a timer for the next change
// of greeting (2026-09-25), and a real one aimed at noon would hold this
// file's `node --test` process open for hours.
function fakeClock(ms) {
  const clock = { now: ms, timers: [] };
  clock.Date = class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
  };
  clock.setTimeout = (fn, delay) => { clock.timers.push({ fn, delay, live: true }); return clock.timers.length; };
  clock.clearTimeout = (id) => { if (clock.timers[id - 1]) clock.timers[id - 1].live = false; };
  clock.armed = () => clock.timers.filter((t) => t.live);
  // Move the clock to when the one armed timer is due, and run it.
  clock.fire = () => {
    const [t] = clock.armed();
    assert.ok(t, "a timer is armed");
    t.live = false;
    clock.now += t.delay;
    t.fn();
  };
  return clock;
}
function loadDates(o) {
  const opts = o || {};
  const fetch = makeFetch([]);
  const clock = fakeClock(Date.now());
  const ctx = load(DATES_RE,
    "this.draw = drawDeskDates; this.head = drawDeskHead; this.closed = () => __closed;",
    "let currentUser = __user; function myFirm() { return __firm; }\n" +
    "let deskCritical = null; let deskThreadsStat = __threads; const DESK_DUE_DAYS = 90; let __closed = 0;\n" +
    "let firmBuildings = __buildings;\n" +
    "function decorateBuildingRows() {} function closeDeskFind() { __closed++; }\n" +
    "function shopCopy(kind) { return kind === 'development' ? { label: 'Development shop' } : { label: 'Broker shop' }; }\n" +
    html.match(DATE_HELPERS_RE)[0],
    { fetch, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
      __user: opts.user === undefined ? { email: "brad@colliers.com" } : opts.user,
      __firm: opts.firm === undefined ? { id: "o1", name: "Foothill Commercial", kind: "broker" } : opts.firm,
      __threads: opts.threads === undefined ? { total: 0, unread: 0, unreadList: [] } : opts.threads,
      __buildings: opts.buildings || [{ id: "b3", address: "3100 S Federal Way, Boise, ID" }] });
  ctx.fetchLog = fetch.log;
  // The strip is what the agenda follows; a populated desk has shown it.
  if (!opts.stripHidden) ctx.dom.el("deskStrip").classList.remove("hidden");
  return ctx;
}
const LEASE = (o) => Object.assign({ buildingId: "b3", address: "3100 S Federal Way, Boise, ID", tenant: "Acme Logistics",
  suite: "", kind: "notice", date: "2026-11-04", days: 41, leaseExpiry: "2027-02-01" }, o);

test("Needs you lists the lease dates inside ninety days, then the unread conversations, each with its next step", () => {
  const ctx = loadDates({ threads: { total: 3, unread: 1, unreadList: [{ id: "t9", label: "Mike Tran", unread: 2, preview: "Rent roll is in" }] } });
  ctx.draw([LEASE({}), LEASE({ buildingId: "b6", tenant: "Treasure Valley Dental", kind: "expiry", date: "2027-07-21", days: 300 })]);
  assert.equal(ctx.dom.hidden("deskAgenda"), false);
  const rows = ctx.dom.el("deskAgendaRows").children;
  assert.equal(rows.length, 2, "the 300-day expiry is a critical date, not something that needs you this quarter");
  assert.match(rows[0].textContent, /Option notice · Acme Logistics/);
  assert.match(rows[0].textContent, /in 41 days/);
  assert.match(rows[0].textContent, /lease expires Feb 1, 2027/, "a notice names the expiry it protects");
  assert.equal(rows[0].children[2].href, "/building/b3", "the lease lives on the building's sheet");
  assert.match(rows[1].textContent, /2 new.*Mike Tran.*Rent roll is in/);
  assert.equal(rows[1].children[2].href, "/messages?t=t9");
  assert.equal(ctx.dom.text("deskAgendaStats"), "2 items");
  assert.equal(ctx.dom.hidden("deskAgendaNote"), true);
  // Draft C: the banner's one line counts what the card lists.
  assert.equal(ctx.dom.text("deskHeroSub"), "1 date in the next 90 days and 1 unread conversation.");
  assert.equal(ctx.dom.hidden("deskHeroSub"), false);
  assert.equal(ctx.fetchLog.length, 0, "no read of its own");
});

test("Needs you says 'nothing' only when both of its reads came back", () => {
  // Draft C (2026-09-25): "nothing" is said on the banner, and the card
  // whose only sentence it would be steps aside. A failed read keeps the
  // card up to name the read, and the banner then says nothing at all.
  let ctx = loadDates({});
  ctx.draw([]);
  assert.equal(ctx.dom.text("deskHeroSub"), "Nothing needs you right now.", "both read, nothing due, nothing unread: say so");
  assert.equal(ctx.dom.hidden("deskHeroSub"), false);
  assert.equal(ctx.dom.hidden("deskAgenda"), true, "a card that could only say 'nothing' is not drawn");
  ctx = loadDates({});
  ctx.draw(null);
  assert.equal(ctx.dom.hidden("deskHeroSub"), true, "a failed leases read must not read as 'nothing is due'");
  assert.equal(ctx.dom.hidden("deskAgenda"), false, "the card stays up to say which read failed");
  assert.match(ctx.dom.text("deskAgendaNote"), /Couldn't read lease dates/);
  ctx = loadDates({ threads: null });
  ctx.draw([]);
  assert.equal(ctx.dom.hidden("deskHeroSub"), true);
  assert.equal(ctx.dom.hidden("deskAgenda"), false);
  assert.match(ctx.dom.text("deskAgendaNote"), /Couldn't read conversations/);
  // An empty board has nothing to be due yet: the line says where to start
  // instead of reassuring anybody about a firm with no record in it.
  ctx = loadDates({ buildings: [] });
  ctx.draw([]);
  assert.equal(ctx.dom.text("deskHeroSub"), "Foothill Commercial is ready. Put your first building on the board to begin.");
});

test("Needs you follows the strip: no firm, a signed-out page or a hidden strip means no agenda", () => {
  for (const o of [{ firm: null }, { user: null }, { stripHidden: true }]) {
    const ctx = loadDates(o);
    ctx.dom.el("deskAgenda").classList.remove("hidden"); // a stale reveal
    ctx.draw([LEASE({})]);
    assert.equal(ctx.dom.hidden("deskAgenda"), true, JSON.stringify(o));
  }
});

test("the dates card lists the next twelve months, hides on a failed read, and says so when there are none", () => {
  let ctx = loadDates({});
  ctx.draw([LEASE({}), LEASE({ buildingId: "", tenant: "", kind: "expiry", date: "2027-07-21", days: 300 })]);
  assert.equal(ctx.dom.hidden("deskCritical"), false);
  const rows = ctx.dom.el("deskCriticalRows").children;
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Nov 4.*2026.*Option notice · Acme Logistics/);
  assert.ok(rows[0].children[0].className.includes("due"), "inside ninety days it is red");
  assert.equal(rows[1].children[1].children[0].tagName, "SPAN", "no building to name, no broken link");
  assert.match(rows[1].textContent, /Lease expires · A lease/);
  ctx = loadDates({});
  ctx.draw(null);
  assert.equal(ctx.dom.hidden("deskCritical"), true, "'could not read' is not 'nothing due'");
  ctx = loadDates({});
  ctx.draw([]);
  assert.equal(ctx.dom.hidden("deskCritical"), false);
  assert.equal(ctx.dom.hidden("deskCriticalEmpty"), false);
});

test("the head names the firm and its shop, and shows the find box only for a member of a firm", () => {
  let ctx = loadDates({ firm: { id: "o1", name: "Foothill Commercial", kind: "development" } });
  ctx.head();
  assert.equal(ctx.dom.text("deskFirmLine"), "Foothill Commercial · Development shop");
  assert.equal(ctx.dom.hidden("deskFirmLine"), false);
  assert.equal(ctx.dom.hidden("deskFindWrap"), false);
  ctx = loadDates({ firm: null });
  ctx.head();
  assert.equal(ctx.dom.hidden("deskFirmLine"), true);
  assert.equal(ctx.dom.hidden("deskFindWrap"), true);
  assert.equal(ctx.closed(), 1, "a find box that goes away takes its open results with it");
});

const FIND_RE = /  const DESK_FIND_EACH = 5;[\s\S]*?\n  function renderDeskFind\(\) \{[\s\S]*?\n  \}/;
function loadFind(o) {
  return load(FIND_RE,
    "this.find = renderDeskFind; this.match = deskFindMatches;",
    "let firmBuildings = __b; let firmShelfItems = __s; let firmContacts = __c; let contactsExpanded = false;",
    { fetch: makeFetch([]), __b: o.buildings || [], __s: o.shelf || [], __c: o.contacts || [] });
}

test("the find box searches the whole board, shelf and contact list in the browser, all terms together", () => {
  const buildings = Array.from({ length: 12 }, (_, i) => BLDG({ id: "b" + i, address: `${(i + 1) * 100} Federal Way, Boise, ID` }));
  const ctx = loadFind({
    buildings,
    shelf: [ITEM({ address: "3100 S Federal Way, Boise, ID", sharedBy: "Mike Tran", url: "/r/x1" })],
    contacts: [{ id: "c1", name: "Dana Wu", company: "Acme Logistics", email: "dana@acme.com" },
               { id: "c2", name: "Sam Ortiz", company: "Idaho Cold Storage", buildingId: "b2" }],
  });
  assert.equal(ctx.match("f"), null, "one character is not a search");
  const m = ctx.match("federal way");
  assert.equal(m.buildings.length, 12, "the whole board, not the eight on screen");
  assert.equal(m.reports.length, 1);
  assert.equal(ctx.match("acme dana").contacts.length, 1, "terms AND together");
  assert.equal(ctx.match("acme sam").contacts.length, 0);
  ctx.dom.el("deskFind").value = "federal";
  ctx.find();
  assert.equal(ctx.dom.hidden("deskFindResults"), false);
  assert.equal(ctx.dom.el("deskFind").getAttribute("aria-expanded"), "true");
  const text = ctx.dom.text("deskFindResults");
  assert.match(text, /Buildings/);
  assert.match(text, /and 7 more/, "five of each, and the rest counted rather than dropped silently");
  assert.match(text, /Reports on the shelf/);
  ctx.dom.el("deskFind").value = "cold storage";
  ctx.find();
  const hit = ctx.dom.el("deskFindResults").children.find((c) => c.className === "dk-find-hit");
  assert.equal(hit.href, "/building/b2", "a contact attached to a building opens that building's sheet");
  ctx.dom.el("deskFind").value = "zzzz";
  ctx.find();
  assert.match(ctx.dom.text("deskFindResults"), /Nothing in your workspace matches/);
});

test("the new desk pieces reach only ids that exist, and are hidden with the firm sections", () => {
  const asked = new Set();
  const dates = loadDates({ threads: { total: 1, unread: 1, unreadList: [{ id: "t", label: "M", unread: 1, preview: "p" }] } });
  dates.draw([LEASE({})]);
  dates.head();
  dates.dom.asked.forEach((id) => asked.add(id));
  const find = loadFind({ buildings: [BLDG({})] });
  find.dom.el("deskFind").value = "warehouse";
  find.find();
  find.dom.asked.forEach((id) => asked.add(id));
  for (const id of asked) assert.ok(html.includes(`id="${id}"`), `the desk reads #${id}, which is not in index.html's markup`);
  const at = html.indexOf("async function renderShares()");
  const fn = html.slice(at, html.indexOf("\n  }\n", at));
  for (const id of ["deskAgenda", "deskCritical", "deskFirmLine", "deskFindWrap"]) {
    assert.ok(fn.includes(`getElementById("${id}").classList.add("hidden")`), `hideAll hides #${id}`);
  }
  assert.ok(fn.indexOf("drawDeskDates(await critical)") > fn.indexOf("drawFirmStrip(await critical)"),
    "the agenda is drawn after the strip, whose verdict it follows");
});

test("the workspace is two columns of decks, and the top row is not a deck", () => {
  const main = html.indexOf('class="dk-col dk-main"');
  const side = html.indexOf('id="deckSide"');
  assert.ok(main > 0 && side > main, "the record column, then the side column");
  for (const id of ["deckFirm", "deckSharing"]) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > main && at < side, `#${id} sits in the main column`);
  }
  for (const id of ["deskThreads", "deskCritical", "deskDealBoard", "deskPermits", "deskContacts"]) {
    assert.ok(html.indexOf(`id="${id}"`) > side, `#${id} is a card in the side column`);
  }
  assert.match(html, /<div class="dk-col dk-side dk-deck" data-deck id="deckSide">/,
    "the side column is itself a deck, so it hides when every card in it is hidden");
  const top = html.slice(html.indexOf('<div class="dk-top">'), html.indexOf('<div class="dk-cols">'));
  assert.ok(top.includes('id="deskAgenda"'), "the top row holds Needs you");
  assert.ok(!/<[a-z][^>]*\sdata-deck[\s>]/.test(top), "the top row must never hold a deck open");
  // Draft C: the figure cards rest on the banner's edge, so they come first
  // in #myDesk and Needs you follows them, full width.
  assert.ok(html.indexOf('id="deskStrip"') < html.indexOf('<div class="dk-top">'), "the figure cards read first, on the banner's edge");
});

// ---------------------------------------------------------------------------
// Draft C (2026-09-25, the owner's pick): the banner over the Workspace —
// the home city's photograph or a drawn contour map, the greeting, one line
// of status — the figure cards on its edge, the empty sections drawn as a
// faint preview with one next step, type tags, and three start cards for a
// member in no firm.
// ---------------------------------------------------------------------------
const HOME_RE = /  function drawDeskHome\(home\) \{[\s\S]*?\n  \}\n/;
function loadHome(buildings) {
  return load(HOME_RE, "this.draw = drawDeskHome;", "let firmBuildings = __b;", { __b: buildings || [] });
}
const BOISE_PHOTO = {
  src: "/market-heroes/boise-id.jpg",
  srcset: "/market-heroes/boise-id-1920.jpg 1920w, /market-heroes/boise-id.jpg 3840w",
  credit: "Patrick R.", license: "CC BY-SA 3.0",
  commonsUrl: "https://commons.wikimedia.org/wiki/File:Front_St._Downtown_Boise.jpg",
};

test("the banner shows the home city's photograph, credited on the picture, with the board's markets", () => {
  const ctx = loadHome([{ market: "Meridian, ID" }, { market: "Boise, ID" }, { market: "Boise, ID" }, { market: "Nampa, ID" }]);
  ctx.draw({ market: "Boise, ID", photo: BOISE_PHOTO });
  assert.equal(ctx.dom.hidden("deskHeroImg"), false);
  assert.equal(ctx.dom.el("deskHeroImg").getAttribute("src"), "/market-heroes/boise-id.jpg");
  assert.equal(ctx.dom.el("deskHeroImg").getAttribute("srcset"), BOISE_PHOTO.srcset);
  assert.ok(ctx.dom.el("deskHero").classList.contains("has-photo"), "the scrim that keeps white text readable on a photo");
  assert.equal(ctx.dom.hidden("deskHeroCredit"), false, "a photograph is never shown without its credit");
  assert.equal(ctx.dom.text("deskHeroCredit"), "Photo: Patrick R. · CC BY-SA 3.0");
  const link = ctx.dom.el("deskHeroCredit").children[0];
  assert.equal(link.tagName, "A");
  assert.equal(link.href, BOISE_PHOTO.commonsUrl);
  assert.equal(link.rel, "noopener noreferrer");
  assert.equal(ctx.dom.text("deskHeroWhere"), "Boise, ID · Meridian, ID · Nampa, ID", "the home market leads, the photo is of it");
  assert.equal(ctx.dom.hidden("deskHeroWhereWrap"), false);
});

test("the banner shows only our own /market-heroes/ files, and a null home takes the picture down", () => {
  for (const src of ["https://evil.example/x.jpg", "//evil.example/market-heroes/x.jpg", "javascript:alert(1)", "", 42]) {
    const ctx = loadHome([{ market: "Boise, ID" }]);
    ctx.draw({ market: "Boise, ID", photo: Object.assign({}, BOISE_PHOTO, { src }) });
    assert.equal(ctx.dom.hidden("deskHeroImg"), true, String(src));
    assert.equal(ctx.dom.hidden("deskHeroCredit"), true, "no picture, no credit");
    assert.ok(!ctx.dom.el("deskHero").classList.contains("has-photo"));
  }
  // A srcset naming anything else is dropped whole; the checked src stands.
  let ctx = loadHome([{ market: "Boise, ID" }]);
  ctx.draw({ market: "Boise, ID", photo: Object.assign({}, BOISE_PHOTO, { srcset: "/market-heroes/a.jpg 1920w, https://evil.example/b.jpg 3840w" }) });
  assert.equal(ctx.dom.el("deskHeroImg").getAttribute("srcset"), null);
  assert.equal(ctx.dom.hidden("deskHeroImg"), false);
  // A credit link goes only to Commons.
  ctx = loadHome([{ market: "Boise, ID" }]);
  ctx.draw({ market: "Boise, ID", photo: Object.assign({}, BOISE_PHOTO, { commonsUrl: "https://evil.example/" }) });
  assert.equal(ctx.dom.el("deskHeroCredit").children[0].tagName, "SPAN", "an unexpected credit URL is text, never a link");
  // A sign-out, a failed read or no firm: the drawn banner, nothing named.
  ctx = loadHome([{ market: "Boise, ID" }]);
  ctx.draw({ market: "Boise, ID", photo: BOISE_PHOTO });
  ctx.draw(null);
  assert.equal(ctx.dom.hidden("deskHeroImg"), true);
  assert.equal(ctx.dom.hidden("deskHeroCredit"), true);
  assert.equal(ctx.dom.hidden("deskHeroWhereWrap"), true, "no city left on a banner whose firm is gone");
});

test("renderBuildings draws the banner from the buildings read it already made", async () => {
  const ctx = loadBuildings({ body: { buildings: [BLDG({})], summary: "1 building · 1 Industrial", home: { market: "Boise, ID", photo: BOISE_PHOTO } } });
  await ctx.render();
  assert.equal(ctx.fetchLog.length, 1, "the photo rides the buildings answer, not a read of its own");
  assert.equal(ctx.dom.el("deskHeroImg").getAttribute("src"), BOISE_PHOTO.src);
  const failed = loadBuildings({ status: 503, body: {} });
  failed.dom.el("deskHeroImg").classList.remove("hidden"); // a stale picture
  await failed.render();
  assert.equal(failed.dom.hidden("deskHeroImg"), true, "a failed read takes the picture down with the list");
});

test("a building's type is a tinted tag with the same word", async () => {
  const ctx = loadBuildings({ body: { buildings: [BLDG({}), BLDG({ id: "b2", type: "Office" }), BLDG({ id: "b3", type: "" })], summary: "" } });
  await ctx.render();
  const rows = ctx.dom.el("buildingRows").children;
  const typeCell = (row) => row.children.find((c) => String(c.className).includes("dk-bc-type"));
  assert.equal(typeCell(rows[0]).textContent, "Industrial", "the cell's text is unchanged, so the narrow reflow reads the same");
  assert.equal(typeCell(rows[0]).children[0].className, "dk-pill dk-tone-est");
  assert.equal(typeCell(rows[1]).children[0].className, "dk-pill dk-tone-bv");
  assert.equal(typeCell(rows[2]).textContent, "—", "no type, no tag");
  assert.ok(typeCell(rows[2]).className.includes("empty"));
});

test("the empty board's own button opens the add form and never closes it", async () => {
  const ctx = loadBuildings({ body: { buildings: [], summary: "" } });
  await ctx.render();
  assert.equal(ctx.dom.hidden("buildingsEmpty"), false);
  await ctx.dom.el("buildingsEmptyAdd").fire("click");
  assert.equal(ctx.dom.hidden("buildingAddForm"), false);
  await ctx.dom.el("buildingsEmptyAdd").fire("click");
  assert.equal(ctx.dom.hidden("buildingAddForm"), false, "a second click must not close what the first opened");
});

function loadGreeting(user, clock) {
  const c = clock || fakeClock(Date.now());
  return load(DATES_RE, "this.greet = deskGreetingFor; this.head = drawDeskHead;",
    "let currentUser = __user; function myFirm() { return null; }\n" +
    "let deskCritical = null; let deskThreadsStat = null; const DESK_DUE_DAYS = 90; let firmBuildings = [];\n" +
    "function decorateBuildingRows() {} function closeDeskFind() {}\n" +
    "function shopCopy() { return { label: 'Broker shop' }; }\n" + html.match(DATE_HELPERS_RE)[0],
    { fetch: makeFetch([]), __user: user, Date: c.Date, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
}

test("the banner greets a member by first name, on this browser's clock, and says Workspace to nobody", () => {
  const ctx = loadGreeting({ email: "brad@colliers.com", name: "Brad Keller" });
  const at = (h) => new Date(2026, 8, 25, h, 5);
  assert.equal(ctx.greet(at(8), { name: "Brad Keller" }), "Good morning, Brad");
  assert.equal(ctx.greet(at(13), { name: "Brad Keller" }), "Good afternoon, Brad");
  assert.equal(ctx.greet(at(19), { name: "  Brad  " }), "Good evening, Brad");
  assert.equal(ctx.greet(at(8), { email: "sam@summitcre.com" }), "Good morning", "no name, no guess at one from the email");
  assert.equal(ctx.greet(at(8), { name: "X".repeat(90) }).length, "Good morning, ".length + 40, "a long name is cut, not wrapped over the banner");
  ctx.head();
  assert.match(ctx.dom.text("deskGreeting"), /^Good (morning|afternoon|evening), Brad$/);
  assert.match(ctx.dom.text("deskToday"), /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [A-Z][a-z]+ \d{1,2}$/);
  const out = loadGreeting(null);
  out.head();
  assert.equal(out.dom.text("deskGreeting"), "Workspace");
});

test("a workspace left open turns to Good afternoon at noon, Good evening at 5, and a new day at midnight", () => {
  // Owner, 2026-09-25: a workspace opened before noon still said "Good
  // morning" in the afternoon, because the greeting was written once, at
  // paint. This runs the real timer path on a clock the test moves.
  const clock = fakeClock(new Date(2026, 8, 25, 11, 50).getTime());
  const ctx = loadGreeting({ email: "brad@colliers.com", name: "Brad Keller" }, clock);
  ctx.head();
  assert.equal(ctx.dom.text("deskGreeting"), "Good morning, Brad");
  assert.equal(clock.armed().length, 1, "one timer");
  assert.equal(clock.armed()[0].delay, 10 * 60 * 1000 + 250, "aimed just past noon, not polled");
  clock.fire();
  assert.equal(ctx.dom.text("deskGreeting"), "Good afternoon, Brad", "noon itself is afternoon");
  assert.equal(clock.armed().length, 1, "re-armed for 5pm, never stacked");
  clock.fire();
  assert.equal(ctx.dom.text("deskGreeting"), "Good evening, Brad");
  assert.equal(ctx.dom.text("deskToday"), "Friday, September 25");
  clock.fire();
  assert.equal(ctx.dom.text("deskGreeting"), "Good morning, Brad");
  assert.equal(ctx.dom.text("deskToday"), "Saturday, September 26", "midnight moves the day line too");
  ctx.head(); ctx.head();
  assert.equal(clock.armed().length, 1, "every draw re-arms the SAME one timer");
  const nobody = fakeClock(new Date(2026, 8, 25, 11, 50).getTime());
  loadGreeting(null, nobody).head();
  assert.equal(nobody.armed().length, 0, "a signed-out banner says Workspace and arms nothing");
});

test("a sign-out puts the banner back: no name, no status line, no city", () => {
  const at = html.indexOf("async function renderShares()");
  const fn = html.slice(at, html.indexOf("\n  }\n", at));
  assert.ok(fn.includes("resetDeskHero();"), "hideAll resets the banner with the rest of the firm surfaces");
  const reset = html.slice(html.indexOf("  function resetDeskHero() {"), html.indexOf("\n  }\n", html.indexOf("  function resetDeskHero() {")));
  assert.ok(reset.includes('getElementById("deskGreeting").textContent = "Workspace"'));
  assert.ok(reset.includes("clearTimeout(deskClockTimer);"),
    "and stops the greeting's timer, or it would greet the signed-out banner at the next hour mark");
  assert.ok(html.includes('if (!document.hidden && deskClockTimer) drawDeskClock();'),
    "a tab coming back re-reads the clock, only while a greeting is live");
  assert.ok(reset.includes('heroSub("")'));
  assert.ok(reset.includes("drawDeskHome(null)"));
});

test("a zero on the figure cards steps back, and a dash (a read that failed) does not", async () => {
  const ctx = loadStrip({ buildings: [], shelf: [], threads: { total: 0, unread: 0 }, critical: [], stats: "" });
  ctx.draw(await ctx.read());
  for (const id of ["stripBuildingsFig", "stripShelfFig", "stripUnreadFig", "stripCriticalFig"]) {
    assert.ok(ctx.dom.el(id).classList.contains("zero"), id + " is a zero and should step back");
  }
  const failed = loadStrip({ buildings: [BLDG({})], leases: { status: 503, body: {} }, threads: null, shelfHidden: true });
  failed.draw(await failed.read());
  assert.ok(!failed.dom.el("stripCriticalFig").classList.contains("zero"), "'could not read' keeps its ink");
  assert.ok(!failed.dom.el("stripBuildingsFig").classList.contains("zero"), "1 building is not a zero");
});

test("the empty sections are previews with one next step, and the preview holds no text that could read as data", () => {
  for (const id of ["buildingsEmpty", "deskSharedWithFirmEmpty", "deskSharesEmpty", "deskThreadsEmpty", "deskCriticalEmpty", "contactsEmpty"]) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > 0, id);
    const tag = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
    assert.match(tag, /class="hidden dk-ghost"/, `${id} ships hidden and is a preview`);
    const cta = html.indexOf('class="dk-ghost-cta"', at);
    const rows = html.slice(html.indexOf(">", at) + 1, html.lastIndexOf("<", cta));
    assert.match(rows, /class="dk-ghost-rows" aria-hidden="true"/, `${id}'s preview is hidden from a screen reader`);
    assert.equal(rows.replace(/<[^>]*>/g, "").trim(), "", `${id}'s preview rows must carry no text`);
  }
  // .dk-ghost sets display, so it needs its own hidden rule (the .dk-strip trap).
  assert.ok(html.includes(".dk-ghost.hidden { display: none; }"));
  assert.ok(html.includes(".dk-start.hidden { display: none; }"));
  assert.ok(html.includes(".dk-hero-where.hidden { display: none; }"));
});

test("a member in no firm gets three start cards, the second chosen by plan so it never opens onto a Pro gate", () => {
  let ctx = loadFirmEmpty({ state: { orgs: [], invites: [], canCreate: true }, pro: { enabled: true, canBulkValue: true } });
  ctx.draw();
  assert.equal(ctx.dom.el("deskStart2").href, "/bulk");
  assert.equal(ctx.dom.text("deskStart2T"), "Run a comp report");
  assert.equal(ctx.dom.hidden("deskStart2IcoReport"), false);
  assert.equal(ctx.dom.hidden("deskStart2IcoPermit"), true);
  ctx = loadFirmEmpty({ state: { orgs: [], invites: [], canCreate: false }, pro: { enabled: true, canBulkValue: false } });
  ctx.draw();
  assert.equal(ctx.dom.el("deskStart2").href, "/permits", "a free member is sent where a free member can go");
  // A vault-only beta grant can create a firm (canUseOrg) and still has no
  // Comp report tool (canBulkValue is Pro alone): the card follows the tool,
  // not the firm flag (Cursor Bugbot on PR #320).
  const beta = loadFirmEmpty({ state: { orgs: [], invites: [], canCreate: true }, pro: { enabled: true, canBulkValue: false } });
  beta.draw();
  assert.equal(beta.dom.el("deskStart2").href, "/permits");
  assert.equal(beta.dom.text("deskFirmEmptyBtn"), "Create a firm", "the firm card still offers what canCreate allows");
  // Before /api/config answers, the default config has no canBulkValue: the
  // safe card, never the gated one.
  const early = loadFirmEmpty({ state: { orgs: [], invites: [], canCreate: true } });
  early.draw();
  assert.equal(early.dom.el("deskStart2").href, "/permits");
  // And the card follows the config when it lands, beside the rail's row.
  const at = html.indexOf('document.getElementById("menuBulkLink")\n      .classList.toggle(');
  assert.ok(at > 0 && html.slice(at, at + 400).includes("syncStartCards();"), "refreshBillingUI re-decides the card with the rail row");
  assert.equal(ctx.dom.text("deskStart2T"), "Watch new permits");
  assert.equal(ctx.dom.hidden("deskStart2IcoReport"), true);
  assert.equal(ctx.dom.hidden("deskStart2IcoPermit"), false);
  // The city pictures on the first card are real, committed files.
  const box = html.slice(html.indexOf('id="deskFirmEmpty"'), html.indexOf('id="deskStart2"'));
  const pics = [...box.matchAll(/src="\/market-heroes\/([a-z0-9-]+\.jpg)"/g)].map((m) => m[1]);
  assert.equal(pics.length, 3);
  for (const f of pics) assert.ok(fs.existsSync(path.join(__dirname, "..", "market-heroes", f)), f + " must exist");
});

test("the banner, the start cards and the previews reach only ids that exist", async () => {
  const asked = new Set();
  const home = loadHome([{ market: "Boise, ID" }]);
  home.draw({ market: "Boise, ID", photo: BOISE_PHOTO });
  home.dom.asked.forEach((id) => asked.add(id));
  const greet = loadGreeting({ name: "Brad" });
  greet.head();
  greet.dom.asked.forEach((id) => asked.add(id));
  const empty = loadFirmEmpty({});
  empty.draw();
  empty.dom.asked.forEach((id) => asked.add(id));
  const dates = loadDates({});
  dates.draw([]);
  dates.dom.asked.forEach((id) => asked.add(id));
  for (const id of asked) assert.ok(html.includes(`id="${id}"`), `the desk reads #${id}, which is not in index.html's markup`);
});

// ---------------------------------------------------------------------------
// The firm's skyline (2026-09-25, Draft B of the banner drafts — the owner's
// pick). One tower per building on the board. The RULES are firm-skyline.js's
// and are tested in test/firm-skyline.test.js; these run the page's half —
// what it draws, what hovering does, and when it stays away — against the
// real module.
// ---------------------------------------------------------------------------
const SKY_RE = /  let deskSky = null;[\s\S]*?\n  window\.addEventListener\("resize"[\s\S]*?\n  \}\);/;
const SKY_NOW = new Date(2026, 8, 25, 9, 30).getTime();
const skyDaysAgo = (n) => new Date(SKY_NOW - n * 86400000).toISOString();
const SKYB = (o) => Object.assign({ id: "b1", address: "3275 S Federal Way, Boise, ID", sizeSqft: 24000, type: "Industrial",
  createdAt: skyDaysAgo(90), addedBy: "Brad Ellis", mine: false, market: "Boise, ID" }, o);
function loadSky(o) {
  const clock = fakeClock(o.at || SKY_NOW);
  const ctx = load(SKY_RE,
    "this.draw = drawDeskSky; this.clear = clearDeskSky; this.paint = paintDeskSky; this.state = () => deskSky;",
    "let currentUser = __user; function myFirm() { return __firm; }\n" +
    "let firmBuildings = __b; let deskCritical = __crit; let firmShelfItems = __shelf;",
    { __user: o.user === undefined ? { email: "brad@foothillcre.com" } : o.user,
      __firm: o.firm === undefined ? { id: "o1", name: "Foothill Commercial" } : o.firm,
      __b: o.buildings || [], __crit: o.critical || null, __shelf: o.shelf || [],
      SKYLINE: o.noModule ? undefined : require("../firm-skyline.js"),
      Date: clock.Date,
      window: { innerWidth: o.width || 1440, addEventListener() {} } });
  if (o.stripHidden) ctx.dom.el("deskStrip").classList.add("hidden");
  else ctx.dom.el("deskStrip").classList.remove("hidden");
  ctx.clock = clock;
  return ctx;
}
const skyTowers = (ctx) => {
  const g = ctx.dom.el("deskSky").children.find((c) => c.attrs && c.attrs.class === "sky-towers");
  return g ? g.children : [];
};
const partsOf = (a, cls) => a.children.filter((c) => c.attrs && c.attrs.class === cls);
const BOARD = () => [
  SKYB({ id: "quiet", address: "120 N Milwaukee St, Boise, ID", sizeSqft: 15600, createdAt: skyDaysAgo(200) }),
  SKYB({ id: "due", createdAt: skyDaysAgo(60) }),
  SKYB({ id: "new", address: "2900 E Overland Rd, Meridian, ID", sizeSqft: 64000, createdAt: skyDaysAgo(5), mine: true }),
];

test("the skyline draws one tower per building, oldest first, each a link to its sheet", () => {
  const ctx = loadSky({ buildings: BOARD(), critical: [{ buildingId: "due", kind: "notice", tenant: "Acme Logistics", days: 41 }] });
  ctx.draw();
  assert.ok(ctx.dom.el("deskHero").classList.contains("has-sky"), "the sky covers the city photograph");
  assert.ok(ctx.dom.el("deskHero").classList.contains("sky-dawn"), "half past nine is dawn, like the greeting's morning");
  assert.equal(ctx.dom.hidden("deskSky"), false);
  const towers = skyTowers(ctx);
  assert.deepEqual(towers.map((a) => a.attrs.href), ["/building/quiet", "/building/due", "/building/new"],
    "oldest on the left, so the skyline grows to the right");
  assert.match(towers[1].attrs["aria-label"], /^3275 S Federal Way\. Industrial · 24,000 SF .*Option notice for Acme Logistics in 41 days\./);
  assert.equal(ctx.dom.text("deskSkyCap"), "Your firm's skyline · 3 buildings · +1 this month");
  assert.equal(ctx.dom.hidden("deskSkyInfo"), false, "the count and the key are behind the ⓘ, not under the greeting");
  assert.equal(ctx.dom.hidden("deskSkyEmpty"), true);
});

test("a red light marks only a date inside 90 days, a crane only a building added this month, and work lights windows", () => {
  const ctx = loadSky({ buildings: BOARD(),
    critical: [{ buildingId: "due", kind: "notice", tenant: "Acme", days: 41 }, { buildingId: "quiet", kind: "expiry", days: 200 }],
    shelf: [{ address: "3275 S Federal Way, Boise, ID", createdAt: skyDaysAgo(2) }] });
  ctx.draw();
  const [quiet, due, fresh] = skyTowers(ctx);
  assert.equal(partsOf(due, "sky-red").length, 1);
  assert.equal(partsOf(quiet, "sky-red").length, 0, "a date past 90 days is not a red light");
  assert.equal(partsOf(fresh, "sky-crane").length, 1);
  assert.equal(partsOf(due, "sky-crane").length + partsOf(quiet, "sky-crane").length, 0);
  const lit = (a) => partsOf(a, "sky-win lit").length / (partsOf(a, "sky-win lit").length + partsOf(a, "sky-win").length);
  assert.ok(lit(due) > lit(quiet), "a building the firm worked on is brighter than a quiet one");
});

test("at rest the callout names the tower that needs the firm most; hovering another moves it, leaving brings it back", () => {
  const ctx = loadSky({ buildings: BOARD(), critical: [{ buildingId: "due", kind: "notice", tenant: "Acme Logistics", days: 41 }],
    shelf: [{ address: "3275 S Federal Way, Boise, ID", createdAt: skyDaysAgo(2) }] });
  ctx.draw();
  assert.equal(ctx.dom.hidden("deskSkyCall"), false);
  assert.equal(ctx.dom.text("deskSkyCallName"), "3275 S Federal Way");
  assert.equal(ctx.dom.el("deskSkyCallName").getAttribute("href"), "/building/due");
  assert.equal(ctx.dom.el("deskSkyCallOpen").getAttribute("href"), "/building/due", "the callout opens the building's sheet");
  assert.equal(ctx.dom.text("deskSkyCallDue"), "Option notice for Acme Logistics in 41 days");
  assert.equal(ctx.dom.text("deskSkyCallMeta"), "1 report this month");
  const [, due, fresh] = skyTowers(ctx);
  assert.ok(due.classList.contains("on"), "the tower being spoken about is lit up");
  fresh.fire("mouseenter");
  assert.equal(ctx.dom.text("deskSkyCallName"), "2900 E Overland Rd");
  assert.equal(ctx.dom.text("deskSkyCallDue"), "");
  assert.equal(ctx.dom.text("deskSkyCallFresh"), "New this month, added by you");
  assert.ok(fresh.classList.contains("on") && !due.classList.contains("on"));
  fresh.fire("mouseleave");
  assert.equal(ctx.dom.text("deskSkyCallName"), "3275 S Federal Way", "back to the tower that needs the firm");
  fresh.fire("focus");
  assert.equal(ctx.dom.text("deskSkyCallName"), "2900 E Overland Rd", "a keyboard gets the same callout");
});

test("with nothing due and nothing new, the callout waits for a hover", () => {
  const ctx = loadSky({ buildings: [SKYB({})] });
  ctx.draw();
  assert.equal(ctx.dom.hidden("deskSkyCall"), true);
  skyTowers(ctx)[0].fire("mouseenter");
  assert.equal(ctx.dom.hidden("deskSkyCall"), false);
  assert.equal(ctx.dom.text("deskSkyCallMeta"), "No reports this month");
});

test("with nothing due, even a building added this month waits for a hover (the crane already says new)", () => {
  const ctx = loadSky({ buildings: [SKYB({ createdAt: skyDaysAgo(1), mine: true })] });
  ctx.draw();
  assert.equal(ctx.dom.hidden("deskSkyCall"), true, "a new firm's lone building no longer carries a card all day");
  assert.ok(!skyTowers(ctx)[0].classList.contains("on"));
  skyTowers(ctx)[0].fire("mouseenter");
  assert.equal(ctx.dom.hidden("deskSkyCall"), false);
  assert.equal(ctx.dom.text("deskSkyCallFresh"), "New this month, added by you");
  ctx.draw(); // the desk re-renders while the pointer is still on the tower
  assert.equal(ctx.dom.hidden("deskSkyCall"), false, "a redraw under the pointer keeps the card up");
  assert.equal(ctx.dom.text("deskSkyCallFresh"), "New this month, added by you");
  skyTowers(ctx)[0].fire("mouseleave");
  assert.equal(ctx.dom.hidden("deskSkyCall"), true, "and goes again when the pointer leaves");
  ctx.draw();
  assert.equal(ctx.dom.hidden("deskSkyCall"), true, "a redraw after leaving does not bring it back");
});

test("the callout stands beside the tower it describes, never over it, and never over the ⓘ", () => {
  const W = 1000, H = 292;
  const box = (el) => {
    const m = /^left:(-?\d+)px;top:(-?\d+)px;width:(\d+)px$/.exec(el.getAttribute("style") || "");
    assert.ok(m, "placed as left/top/width: " + el.getAttribute("style"));
    return { left: Number(m[1]), top: Number(m[2]), width: Number(m[3]) };
  };
  const boards = {
    "one building": [SKYB({ createdAt: skyDaysAgo(1) })],
    "ten buildings": Array.from({ length: 10 }, (_, i) => SKYB({ id: "b" + i, address: `${i + 1} Main St, Boise, ID`,
      sizeSqft: 8000 + i * 9000, createdAt: skyDaysAgo(80 - i * 8) })),
  };
  for (const [what, buildings] of Object.entries(boards)) {
    const ctx = loadSky({ buildings });
    ctx.dom.el("deskHero").getBoundingClientRect = () => ({ left: 0, width: W, height: H });
    ctx.draw();
    const info = /^left:(\d+)px/.exec(ctx.dom.el("deskSkyInfo").getAttribute("style"));
    const infoRight = Number(info[1]) + 24;
    for (const a of skyTowers(ctx)) {
      a.fire("mouseenter");
      const body = partsOf(a, "sky-body")[0].attrs;
      const tx = Number(body.x), tr = tx + Number(body.width), ttop = Number(body.y);
      const c = box(ctx.dom.el("deskSkyCall"));
      assert.ok(c.left >= tr + 10 || c.left + c.width <= tx - 10, `${what}: the card is beside its tower, not over it`);
      assert.ok(c.left >= infoRight, `${what}: the ⓘ stays uncovered`);
      assert.ok(c.left + c.width <= W - 22, `${what}: inside the banner`);
      assert.ok(c.top >= 76, `${what}: below the find box`);
      assert.ok(c.top + 80 <= H * 0.79, `${what}: standing on the ground, not under it`);
      assert.ok(ttop > 0);
      a.fire("mouseleave");
    }
  }
});

test("an empty board shows where the skyline will stand, and its button opens the add form", () => {
  const ctx = loadSky({ buildings: [] });
  let opened = 0;
  ctx.dom.el("buildingsEmptyAdd").click = () => { opened += 1; };
  ctx.draw();
  assert.ok(ctx.dom.el("deskHero").classList.contains("has-sky"));
  assert.equal(ctx.dom.el("deskSky").children.filter((c) => c.attrs && c.attrs.class === "sky-ghost").length, 3);
  assert.equal(ctx.dom.hidden("deskSkyEmpty"), false);
  assert.equal(ctx.dom.hidden("deskSkyInfo"), true, "no legend for nothing");
  assert.equal(ctx.dom.hidden("deskSkyCall"), true);
  ctx.dom.el("deskSkyAdd").fire("click");
  assert.equal(opened, 1);
});

test("no firm, a failed board read, a missing rule or a sign-out leaves the old banner", () => {
  const cases = [
    ["the board could not be read", { buildings: BOARD(), stripHidden: true }],
    ["/firm-skyline.js did not load", { buildings: BOARD(), noModule: true }],
    ["not in a firm", { buildings: BOARD(), firm: null }],
    ["signed out", { buildings: BOARD(), user: null }],
  ];
  for (const [why, o] of cases) {
    const ctx = loadSky(o);
    ["has-sky", "sky-dawn"].forEach((c) => ctx.dom.el("deskHero").classList.add(c)); // a stale skyline
    ["deskSky", "deskSkyInfo", "deskSkyCall", "deskSkyEmpty"].forEach((id) => ctx.dom.el(id).classList.remove("hidden"));
    ctx.draw();
    assert.ok(!ctx.dom.el("deskHero").classList.contains("has-sky"), why + ": the city photograph shows again");
    assert.ok(!ctx.dom.el("deskHero").classList.contains("sky-dawn"), why);
    for (const id of ["deskSky", "deskSkyInfo", "deskSkyCall", "deskSkyEmpty"]) {
      assert.equal(ctx.dom.hidden(id), true, `${why}: #${id}`);
    }
  }
});

test("the sky turns with the greeting's clock", () => {
  const at = (h) => new Date(2026, 8, 25, h, 5).getTime();
  const day = loadSky({ buildings: BOARD(), at: at(13) });
  day.draw();
  assert.ok(day.dom.el("deskHero").classList.contains("sky-day"));
  assert.ok(!day.dom.el("deskHero").classList.contains("sky-dawn"));
  day.clock.now = at(18);
  day.paint();
  assert.ok(day.dom.el("deskHero").classList.contains("sky-dusk"));
  assert.ok(!day.dom.el("deskHero").classList.contains("sky-day"), "one sky at a time");
  const clockFn = html.slice(html.indexOf("  function drawDeskClock() {"), html.indexOf("\n  }\n", html.indexOf("  function drawDeskClock() {")));
  assert.ok(clockFn.includes('if (typeof paintDeskSky === "function") paintDeskSky();'),
    "the greeting's timer turns the sky too, guarded so a page without the skyline still greets");
});

test("the towers stand on the sky's horizon at any banner height, and the ground runs only under them", () => {
  // The owner's screenshot, 2026-09-25: a 312px banner put the horizon at
  // 246px and the ground at 250px (H - 62), two lines four pixels apart, and
  // the ground ran from beside a lone tower to the banner's corner.
  const share = Number(html.match(/const DESK_SKY_HORIZON = ([\d.]+);/)[1]);
  const pct = +(share * 100).toFixed(2);
  for (const part of ["dawn", "day", "dusk"]) {
    const rule = html.match(new RegExp(`\\.dk-hero\\.has-sky\\.sky-${part} \\.dk-hero-bg \\{ background:[^}]*\\}`))[0];
    assert.ok(rule.includes(` ${pct}%,`), `the ${part} sky's horizon is at ${pct}%, the share the towers stand at`);
  }
  for (const H of [292, 312, 360]) {
    const ctx = loadSky({ buildings: [SKYB({ createdAt: skyDaysAgo(1), mine: true })] });
    ctx.dom.el("deskHero").getBoundingClientRect = () => ({ left: 0, width: 1000, height: H });
    ctx.draw();
    const ground = ctx.dom.el("deskSky").children.filter((c) => c.attrs && c.attrs.class === "sky-ground");
    assert.equal(ground.length, 1);
    assert.equal(Number(ground[0].attrs.y1), +(H * share).toFixed(1), `a ${H}px banner's ground is its horizon`);
    const body = partsOf(skyTowers(ctx)[0], "sky-body")[0].attrs;
    assert.ok(Math.abs(Number(body.y) + Number(body.height) - H * share) < 0.01, "the tower stands on it");
    // What stands on it: the tower, and a lone tower's outlines of towers to come.
    const ghosts = ctx.dom.el("deskSky").children.filter((c) => c.attrs && /sky-ghost/.test(c.attrs.class || ""));
    const edge = ghosts.length ? ghosts[ghosts.length - 1].attrs : body;
    const left = Number(body.x), right = Number(edge.x) + Number(edge.width);
    assert.ok(Number(ground[0].attrs.x1) >= left - 26.01 && Number(ground[0].attrs.x2) <= right + 26.01,
      "the ground is only as wide as what stands on it");
    assert.ok(Number(ground[0].attrs.x2) < 1000, "and never runs to the banner's edge");
  }
  assert.match(html, /\.dk-sky \.sky-ground \{ stroke: url\(#deskSkyGround\);/, "its ends fade out");
  assert.match(html, /new ResizeObserver\(\(\) => \{\s*if \(!deskSky\) return;[\s\S]{0,200}?layoutDeskSky\(\)[\s\S]{0,80}?\.observe\(document\.getElementById\("deskHero"\)\)/,
    "a banner that grows after it was drawn is laid out again, or the ground floats above the horizon");
});

test("one building stands mid-room beside outlines of towers to come; three are an ordinary skyline", () => {
  const soon = (ctx) => ctx.dom.el("deskSky").children.filter((c) => c.attrs && c.attrs.class === "sky-ghost sky-soon");
  const one = loadSky({ buildings: [SKYB({ createdAt: skyDaysAgo(1), mine: true })] });
  one.dom.el("deskHero").getBoundingClientRect = () => ({ left: 0, width: 1000, height: 292 });
  one.draw();
  assert.equal(skyTowers(one).length, 1);
  assert.equal(soon(one).length, 3, "three faint outlines beside a lone tower");
  assert.ok(soon(one).every((g) => g.attrs["aria-hidden"] === "true"), "outlines are not buildings, so a screen reader skips them");
  const body = partsOf(skyTowers(one)[0], "sky-body")[0].attrs;
  assert.ok(Number(body.x) < 1000 - 28 - 150, "not pinned to the banner's right edge");
  const three = loadSky({ buildings: BOARD() });
  three.draw();
  assert.equal(soon(three).length, 0);
  assert.match(html, /\.dk-sky \.sky-ghost\.sky-soon \{[^}]*stroke: rgba\(255,255,255,\.2\)/, "fainter than the empty board's outlines");
});

test("the skyline's count and key sit behind an ⓘ beside the towers, which a click pins open", () => {
  const ctx = loadSky({ buildings: BOARD() });
  ctx.draw();
  const info = ctx.dom.el("deskSkyInfo");
  assert.match(info.getAttribute("style"), /^left:\d+px;top:\d+px$/, "layoutDeskSky stands it on the ground");
  const btn = ctx.dom.el("deskSkyInfoBtn");
  btn.fire("click");
  assert.ok(info.classList.contains("open"));
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  btn.fire("keydown", { key: "Escape" });
  assert.ok(!info.classList.contains("open"), "Escape closes it");
  btn.fire("click");
  ctx.clear();
  assert.ok(!info.classList.contains("open") && btn.getAttribute("aria-expanded") === "false", "a sign-out does not leave it pinned");
  const hero = html.slice(html.indexOf('<h2 id="deskGreeting"'), html.indexOf('<div id="deskSkyCall"'));
  assert.doesNotMatch(hero, /deskSkyCap|deskSkyKey/, "nothing explains the chart under the greeting");
  assert.match(html, /\.dk-sky-info:hover \.dk-sky-key, \.dk-sky-info:focus-within \.dk-sky-key, \.dk-sky-info\.open \.dk-sky-key \{ display: flex; \}/);
});

test("a tower the callout describes is only outlined; a hover or keyboard focus lights it", () => {
  const on = html.match(/\.dk-sky a\.on \.sky-body \{[^}]*\}/);
  assert.ok(on, "a lone building is always the callout's tower, so .on is what a new firm sees all day");
  assert.doesNotMatch(on[0], /fill:/, ".on keeps the resting glass");
  const lit = html.indexOf(".dk-sky a:hover .sky-body, .dk-sky a:focus-visible .sky-body {");
  assert.ok(lit > html.indexOf(on[0]), "the hover rule comes after .on, so it wins on equal weight");
});

test("on a phone the towers stay behind the words and take no pointer or tab stop", () => {
  const ctx = loadSky({ buildings: BOARD(), width: 390, critical: [{ buildingId: "due", kind: "notice", days: 10 }] });
  ctx.draw();
  assert.ok(skyTowers(ctx).every((a) => a.attrs.tabindex === "-1"));
  assert.equal(ctx.dom.hidden("deskSkyCall"), true, "no callout floating over the words");
  assert.match(html, /\.dk-sky a \{ pointer-events: none; \}/);
});

test("the skyline is drawn last from what the desk read, and goes with the rest of the banner", () => {
  const at = html.indexOf("async function renderShares()");
  const fn = html.slice(at, html.indexOf("\n  }\n", at));
  assert.ok(fn.indexOf("drawDeskSky();") > fn.indexOf("drawDeskDates(await critical);"),
    "after the lease dates, the shelf and the buildings have all been parsed");
  const r0 = html.indexOf("  function resetDeskHero() {");
  assert.ok(html.slice(r0, html.indexOf("\n  }\n", r0)).includes("clearDeskSky();"),
    "a sign-out takes the skyline down with the name");
  const block = html.match(SKY_RE)[0];
  assert.doesNotMatch(block, /bootFetch\(|fetch\(`?\/api/, "it has no read of its own");
  assert.doesNotMatch(block, /innerHTML/, "tenants, names and addresses are written with textContent");
  assert.doesNotMatch(block, /#[0-9A-Fa-f]{3,8}\b|rgba?\(/, "no colour rides in the markup the script builds; they are classes in the style block");
  const ctx = loadSky({ buildings: BOARD(), critical: [{ buildingId: "due", kind: "notice", tenant: "A", days: 3 }] });
  ctx.draw();
  const empty = loadSky({ buildings: [] });
  empty.draw();
  const asked = new Set([...ctx.dom.asked, ...empty.dom.asked]);
  for (const id of asked) assert.ok(html.includes(`id="${id}"`), `the skyline reads #${id}, which is not in index.html's markup`);
});

test("the browser can actually reach SKYLINE", () => {
  assert.match(html, /<script src="\/firm-skyline\.js"><\/script>/);
  const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverSrc,
    /"\/firm-skyline\.js": \{ file: "firm-skyline\.js", type: "text\/javascript; charset=utf-8", maxAge: 0 \}/);
  assert.ok(!/const \{[^}]*\} = SKYLINE/.test(html), "guarded with typeof, never destructured: a missing file must not take the page down");
});
