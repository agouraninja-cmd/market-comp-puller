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
    // A turned-off link's address greys itself through style (Your links).
    style: {},
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
  const ctx = load(INVITES_RE, "this.fn = renderFirmInvites;", "function renderHomeFirm() {}");
  ctx.fn([{ orgId: "o1", name: "Colliers Boise", shareDefault: "reports" }]);
  const text = ctx.dom.text("firmInvites");
  assert.match(text, /Colliers Boise/);
  assert.match(text, /new reports you run would be shared with them/);
  assert.match(text, /you can turn that off/,
    "the disclosure must also say the member can refuse — the veto is the reason auto-share shipped");
});

test("an invitation from an ordinary firm makes no claim about sharing", () => {
  const ctx = load(INVITES_RE, "this.fn = renderFirmInvites;", "function renderHomeFirm() {}");
  ctx.fn([{ orgId: "o1", name: "Colliers Boise", shareDefault: "none" }]);
  const text = ctx.dom.text("firmInvites");
  assert.match(text, /invited you/);
  assert.doesNotMatch(text, /would be shared/);
});

test("accepting posts the invitation's own org id, and re-reads the desk", async () => {
  const fetch = makeFetch([["/api/org/accept", { body: { ok: true } }]]);
  const ctx = load(INVITES_RE, "this.fn = renderFirmInvites; this.reloaded = () => __n;",
    "let __n = 0; async function renderHomeFirm() { __n++; }", { fetch });
  ctx.fn([{ orgId: "o-real", name: "Colliers Boise" }]);
  const btn = buttons(ctx.dom.el("firmInvites"))[0];
  assert.equal(btn.textContent, "Accept");
  await btn.fire("click");
  assert.equal(fetch.log.length, 1);
  assert.equal(JSON.parse(fetch.log[0].init.body).orgId, "o-real");
  // Joining changes the firm section AND puts the firm's buildings, contacts
  // and dates on Home, which come from several endpoints — so Home re-reads.
  assert.equal(ctx.reloaded(), 1, "accepting an invitation left the desk showing the pre-join state");
});

test("an accept that fails says so and gives the button back", async () => {
  const fetch = makeFetch([["/api/org/accept", { status: 500, body: {} }]]);
  const ctx = load(INVITES_RE, "this.fn = renderFirmInvites;",
    "async function renderHomeFirm() {}", { fetch });
  ctx.fn([{ orgId: "o1", name: "Colliers Boise" }]);
  const btn = buttons(ctx.dom.el("firmInvites"))[0];
  await btn.fire("click");
  assert.equal(btn.disabled, false, "a failed accept left the only button on the row disabled forever");
  assert.match(ctx.dom.text("firmInvites"), /didn't go through/);
});

// ---------------------------------------------------------------------------
// The roster — the last-owner rule, read from the same list the server uses
// ---------------------------------------------------------------------------
// The roster and the profile card (2026-09-29, Draft A) load together: the
// list's rows open the card, and the card's buttons are the ones the rows
// used to carry. Captured from renderFirmMembers through renderMemberCard.
const MEMBERS_RE = /  async function renderFirmMembers\(firm\) \{[\s\S]*?\n  function renderMemberCard\([\s\S]*?\n  \}/;

function loadMembers(body, status, extras) {
  const fetch = makeFetch([["/api/org/members", { status: status || 200, body }]]);
  return load(MEMBERS_RE,
    "this.fn = renderFirmMembers; this.confirms = () => __confirms;" +
    " this.actions = memberCardActions; this.run = runMemberAction; this.card = renderMemberCard;",
    "const __confirms = [];\n" +
    "function confirm(m) { __confirms.push(m); return true; }\n" +
    "async function renderHomeFirm() {}\n" +
    "function openSettingsModal() {}\n" +
    "function renderFirmAutoShare() {} function renderFirmBilling() {}\n" +
    "function renderFirmShop() {} function renderFirmName() {}",
    Object.assign({ fetch }, extras || {}));
}

const OWNER = { id: "m1", email: "brad@colliers.com", name: "Brad Nolan", role: "owner", pending: false, self: true };
const MEMBER = { id: "m2", email: "mike@colliers.com", name: "Mike Chen", role: "member", pending: false, self: false };
const ADMIN = { id: "m4", email: "ann@colliers.com", name: "Ann Ruiz", role: "admin", pending: false, self: false };
const labels = (list) => list.map((a) => a.label);
const cardFor = (ctx, m, data) => {
  const owners = data.members.filter((x) => !x.pending && x.role === "owner").length;
  const a = ctx.actions(m, data, owners);
  return { primary: labels(a.primary), menu: labels(a.menu) };
};
// The rows that OPEN a card are buttons too; these are the other buttons.
const rowControls = (ctx) => buttons(ctx.dom.el("firmMemberRows")).filter((b) => !b.getAttribute("data-card"));

test("an accepted colleague is a named row that opens their card", async () => {
  const data = { name: "Colliers Boise", canManage: true, members: [OWNER, MEMBER, { id: "m9", email: "nameless@colliers.com", role: "member", pending: false }] };
  const ctx = loadMembers(data);
  await ctx.fn({ id: "o1" });
  const rows = buttons(ctx.dom.el("firmMemberRows")).filter((b) => b.getAttribute("data-card"));
  assert.deepEqual(rows.map((b) => b.getAttribute("data-card")), ["m1", "m2", "m9"]);
  assert.match(rows[0].textContent, /Brad Nolan \(you\)/);
  assert.match(rows[1].textContent, /Mike Chen/);
  assert.match(rows[1].textContent, /mike@colliers\.com/, "the email rides beside the name");
  assert.match(rows[2].textContent, /nameless@colliers\.com/, "no name falls back to the email");
  assert.equal(rows[0].getAttribute("aria-haspopup"), "dialog");
  assert.deepEqual(rowControls(ctx), [], "the role and remove buttons moved into the card");
});

test("the sole owner is not offered a way out the server would refuse", async () => {
  // org-access.js refuses it: a firm with no owner has nobody who can invite,
  // remove or hand the role on, and no route repairs one.
  const data = { name: "Colliers Boise", canManage: true, members: [OWNER] };
  const ctx = loadMembers(data);
  assert.deepEqual(cardFor(ctx, OWNER, data), { primary: ["Edit your card"], menu: [] });
});

test("a second owner makes leaving and stepping down offerable", async () => {
  const other = Object.assign({}, MEMBER, { role: "owner" });
  const data = { name: "Colliers Boise", canManage: true, members: [OWNER, other] };
  const ctx = loadMembers(data);
  assert.deepEqual(cardFor(ctx, OWNER, data), { primary: ["Edit your card"], menu: ["Make me an admin", "Make me a member", "Leave firm"] });
  assert.deepEqual(cardFor(ctx, other, data), { primary: ["Message"], menu: ["Make admin", "Make member", "Remove from firm"] });
});

test("the owner's ladder: Make admin on a member, Make owner on an admin, the way down in the menu", async () => {
  const data = { name: "Colliers Boise", canManage: true, members: [OWNER, ADMIN, MEMBER] };
  const ctx = loadMembers(data);
  assert.deepEqual(cardFor(ctx, MEMBER, data), { primary: ["Message", "Make admin"], menu: ["Make owner", "Remove from firm"] });
  assert.deepEqual(cardFor(ctx, ADMIN, data), { primary: ["Message", "Make owner"], menu: ["Make member", "Remove from firm"] });
});

test("an admin removes people but never changes a role or removes an owner", async () => {
  const me = Object.assign({}, ADMIN, { self: true });
  const owner = Object.assign({}, OWNER, { self: false });
  const data = { name: "Colliers Boise", canManage: true, members: [owner, me, MEMBER] };
  const ctx = loadMembers(data);
  assert.deepEqual(cardFor(ctx, MEMBER, data), { primary: ["Message"], menu: ["Remove from firm"] });
  assert.deepEqual(cardFor(ctx, owner, data), { primary: ["Message"], menu: [] });
});

test("a plain member may leave, and is offered nothing on anybody else's card", async () => {
  const me = Object.assign({}, MEMBER, { self: true });
  const owner = Object.assign({}, OWNER, { self: false });
  const data = { name: "Colliers Boise", canManage: false, members: [owner, me] };
  const ctx = loadMembers(data);
  await ctx.fn({ id: "o1" });
  assert.deepEqual(cardFor(ctx, me, data), { primary: ["Edit your card"], menu: ["Leave firm"] });
  assert.deepEqual(cardFor(ctx, owner, data), { primary: ["Message"], menu: [] });
  assert.equal(ctx.dom.hidden("firmInviteWrap"), true,
    "the invite form was offered to somebody the server will not let invite");
});

test("a pending invitation is not an owner, so it cannot hold the firm hostage", async () => {
  // owners counts !pending rows only. A firm whose second owner has not
  // accepted still has exactly one real owner, and stepping down stays off.
  const data = {
    name: "Colliers Boise", canManage: true,
    members: [OWNER, { id: "m3", email: "new@colliers.com", role: "owner", pending: true }],
  };
  const ctx = loadMembers(data);
  await ctx.fn({ id: "o1" });
  // The unaccepted one has no card and keeps its Remove on the row, which is
  // the point — an invitation nobody took must not lock the roster.
  assert.deepEqual(rowControls(ctx).map((b) => b.textContent), ["Remove"]);
  assert.match(ctx.dom.text("firmMemberRows"), /invited, not accepted/);
  assert.match(ctx.dom.text("firmStats"), /1 person · 1 invited/);
  assert.deepEqual(cardFor(ctx, OWNER, data).menu, []);
});

test("removing somebody is confirmed by name, and says what they keep", async () => {
  const data = { name: "Colliers Boise", canManage: true, members: [OWNER, MEMBER] };
  const ctx = loadMembers(data);
  await ctx.run({ id: "o1" }, data, MEMBER, "remove", {}, null);
  const msg = ctx.confirms()[0];
  assert.match(msg, /mike@colliers\.com/);
  assert.match(msg, /Colliers Boise/);
  assert.match(msg, /keep their own reports/,
    "the confirm must say what removal does NOT take — a broker's own book is not the firm's");
  await ctx.run({ id: "o1" }, data, MEMBER, "role:owner", {}, null);
  assert.match(ctx.confirms()[1], /change anyone's role, including yours/);
});

test("Message opens a conversation with that person and sends nothing", async () => {
  const loc = { href: "" };
  const data = { name: "Colliers Boise", canManage: true, members: [OWNER, MEMBER] };
  const ctx = loadMembers(data, 200, { location: loc });
  await ctx.run({ id: "o1" }, data, MEMBER, "message", { userId: "u-mike" }, null);
  assert.equal(loc.href, "/messages?to=u-mike");
  assert.equal(ctx.confirms().length, 0);
});

test("the card says what the server sent, and nothing it did not", async () => {
  const data = { name: "Colliers Boise", canManage: true, members: [OWNER, MEMBER] };
  const ctx = loadMembers(data);
  ctx.card({ id: "o1" }, data, MEMBER, {
    name: "Mike Chen", email: "mike@colliers.com", title: "Associate · Industrial", role: "member",
    joinedAt: "2026-06-10T00:00:00Z", self: false, photoRev: "",
    covers: [{ market: "Meridian, ID", type: "Industrial" }], shared: { reports: 7, comps: 0 },
    seat: { pro: false, viaFirm: false },
  }, 1);
  const text = ctx.dom.text("memberCardBody");
  assert.match(text, /Mike Chen/);
  assert.match(text, /Associate · Industrial/);
  assert.match(text, /Meridian · Industrial/, "a market reads as the city, not the city and state code");
  assert.match(text, /7 reports/);
  assert.doesNotMatch(text, /\d+ (comps?|buildings?|firm permits?)\b/, "a zero is not listed, and a count the server left out is not invented");
  assert.match(text, /Not on Pro\. Firm permit notices don't reach Mike\./);
  assert.deepEqual(buttons(ctx.dom.el("memberCardBody")).map((b) => b.textContent).slice(0, 3), ["Message", "Make admin", "•••"]);

  ctx.card({ id: "o1" }, data, MEMBER, { name: "Mike Chen", email: "mike@colliers.com", role: "member", self: false,
    covers: null, shared: {}, seat: null }, 1);
  const bare = ctx.dom.text("memberCardBody");
  assert.doesNotMatch(bare, /Covers|No markets/, "a failed coverage read says nothing about coverage");
  assert.doesNotMatch(bare, /Shared with the firm|Nothing shared/, "failed counts are left out, not drawn as nothing");
  assert.doesNotMatch(bare, /Pro/, "no seat line unless the server sent one (owners only)");

  ctx.card({ id: "o1" }, data, MEMBER, null, 1);
  assert.match(ctx.dom.text("memberCardBody"), /Couldn't load this profile/);
});

test("your own empty card asks you to finish it, and says it is what colleagues see", async () => {
  const data = { name: "Colliers Boise", canManage: true, members: [OWNER, MEMBER] };
  const ctx = loadMembers(data);
  ctx.card({ id: "o1" }, data, OWNER, { name: "Brad Nolan", email: "brad@colliers.com", title: "", role: "owner",
    self: true, photoRev: "", covers: [], shared: { reports: 0, comps: 0, buildings: 0, permits: 0 }, seat: null }, 1);
  const text = ctx.dom.text("memberCardBody");
  assert.match(text, /Finish your card/);
  assert.match(text, /Add a photo/);
  assert.match(text, /Add your title/);
  assert.match(text, /Pick the markets and property types you cover/);
  assert.match(text, /Nothing shared with the firm yet/);
  assert.match(text, /This is what your colleagues see/);
  assert.doesNotMatch(text, /No markets picked yet/, "your own card asks, rather than reporting a gap");
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
// The firm's buildings (migration 046, Three Spaces slice 3). Presentation
// only; org-buildings.js decides what may be stored. Since 2026-10-07 the
// list draws on Home's map rather than in a table of its own, so these tests
// pin the READ (firmBuildings), the add form and the "Add to firm" doors.
// ---------------------------------------------------------------------------
const BUILDINGS_RE = /  let firmBuildings = \[\];[\s\S]*?\n  document\.getElementById\("buildingAddForm"\)\.addEventListener\("submit"[\s\S]*?\n  \}\);/;
function loadBuildings(opts) {
  const o = opts || {};
  const routes = [["/api/org/buildings", o.route || { status: o.status || 200, body: o.body }]];
  const fetch = makeFetch(routes);
  const ctx = load(BUILDINGS_RE,
    "this.read = readFirmBuildings; this.door = buildingDoor; this.onBoard = buildingOnBoard;" +
    " this.list = () => firmBuildings; this.setFirmKnown = (v) => { __firmKnown = v; };" +
    " this.setOpen = setBuildingAddOpen; this.drawn = () => __drawn;",
    // myFirm() answers null until renderFirm has resolved the membership on a
    // real page; __firmKnown lets a test model that cold-load beat. Home's
    // map is the list's one drawer now; counted, not drawn, here.
    "let currentUser = __user; let __firmKnown = true; function myFirm() { return __firmKnown ? __firm : null; }\n" +
    "let __drawn = 0; function drawHomeMap() { __drawn++; }",
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

test("the firm's buildings are read whole, once, for Home's map", async () => {
  const ctx = loadBuildings({ body: {
    summary: "2 buildings · 2 Industrial", truncated: false,
    buildings: [BLDG({}), BLDG({ id: "b2", address: "7 Linder Rd, Meridian, ID" })],
  } });
  await ctx.read();
  assert.deepEqual(ctx.list().map((b) => b.id), ["b1", "b2"]);
  assert.equal(ctx.fetchLog.length, 1, "one read of its own route, and nothing else");
  assert.equal(ctx.fetchLog[0].url, "/api/org/buildings?id=o1");
});

// The add form moved into Home's Properties tab (2026-10-07), behind "Add a
// property" → "One of the firm's buildings". It still ships closed, and
// setBuildingAddOpen is still its one writer.
test("the buildings add form ships closed, with one writer, behind Home's chooser", () => {
  assert.match(html, /id="buildingAddForm" class="hidden /, "the form ships hidden — the vault's #addSec rule");
  assert.equal((html.match(/getElementById\("buildingAddForm"\)\.classList/g) || []).length, 1,
    "setBuildingAddOpen is the single writer of the form's visibility");
  assert.match(html, /getElementById\("hmAddFirm"\)\.addEventListener\("click", \(\) => \{[\s\S]{0,300}setBuildingAddOpen\(true\);/,
    "the chooser's firm choice opens it");
  const ctx = loadBuildings({ body: { summary: "", truncated: false, buildings: [] } });
  ctx.setOpen(true);
  assert.equal(ctx.dom.hidden("buildingAddForm"), false);
  ctx.setOpen(false);
  assert.equal(ctx.dom.hidden("buildingAddForm"), true);
});

// One row family (2026-09-04). The rows are FLAT — the tests in this file
// index a row's children by position — and pinning the family stops a
// renderer drifting back to its own idiom, which is how the same building
// came to be a Georgia address on the shelf and an underlined sans one in
// the old Buildings table.
test("the contacts draw the workspace's one row family", () => {
  // The shelf drew it too until 2026-10-08, when it moved to Messages.
  const at = html.indexOf("function contactRow(");
  const src = html.slice(at, html.indexOf("\n  }\n", at));
  assert.ok(src.includes('className = "dk-row"'), "contactRow builds .dk-row");
  assert.ok(src.includes('"dk-row-meta"'), "contactRow puts the meta on .dk-row-meta");
  assert.ok(!src.includes("dk-shelf-") && !src.includes("db-row"), "contactRow left its old idiom");
  assert.ok(!/\.dk-shelf-row\s*\{/.test(html), "the shelf's own row rule is retired");
});

test("a failed read empties the list rather than keeping another firm's", async () => {
  const ctx = loadBuildings({ body: { buildings: [BLDG({})] } });
  await ctx.read();
  assert.equal(ctx.list().length, 1);
  const failed = loadBuildings({ status: 503, body: { error: "down" } });
  await failed.read();
  assert.deepEqual(failed.list(), []);
});

test("a member of no firm, or a signed-out page, reads no buildings and makes no fetch", async () => {
  let ctx = loadBuildings({ firm: null, body: { buildings: [BLDG({})] } });
  await ctx.read();
  assert.deepEqual(ctx.list(), []);
  assert.equal(ctx.fetchLog.length, 0);
  ctx = loadBuildings({ user: null, body: { buildings: [BLDG({})] } });
  await ctx.read();
  assert.deepEqual(ctx.list(), []);
  assert.equal(ctx.fetchLog.length, 0, "a stale firm in memory must not be asked about on a signed-out page");
});

test("the door shows only for a member of a firm and only for an address not already on the board", async () => {
  const ctx = loadBuildings({ body: { summary: "1 building", truncated: false,
    buildings: [BLDG({ verifiedKey: "500 warehouse way boise id 83702" })] } });
  await ctx.read();
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
  // A shelf row can be drawn before renderFirm has answered, so a door
  // decided at creation time would leave the row doorless.
  const ctx = loadBuildings({ body: { summary: "1 building", truncated: false, buildings: [BLDG({})] } });
  ctx.setFirmKnown(false);
  const early = ctx.door({ address: "1 New St, Boise, ID" });
  const listed = ctx.door({ address: "500 Warehouse Way, Boise, ID" });
  assert.ok(early.classList.contains("hidden"), "hidden until the list is known");
  ctx.setFirmKnown(true);
  await ctx.read();
  assert.equal(early.classList.contains("hidden"), false, "revealed by the read");
  assert.equal(listed.classList.contains("hidden"), true, "and the one already on the board stays hidden");
});

test("the door posts the identity the row already holds, then re-reads the board and redraws Home", async () => {
  const seen = [];
  const ctx = loadBuildings({ route: () => {
    seen.push(1);
    return seen.length === 1
      ? { status: 200, body: { summary: "", truncated: false, buildings: [] } }
      : { status: 200, body: { ok: true, existed: false, building: BLDG({}) } };
  } });
  await ctx.read();
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
  assert.equal(ctx.fetchLog.filter((c) => !c.init.method).length, 2, "the list is read again after the add");
  assert.equal(ctx.drawn(), 1, "and Home's map is redrawn, so the new building shows");
});

// ---------------------------------------------------------------------------
// Conversations for Home's Today, and the contact door (slice 8)
// ---------------------------------------------------------------------------
const THREADS_RE = /  let deskThreadsStat = null;\n  async function renderDeskThreads\(\) \{[\s\S]*?\n  \}/;
function loadDeskThreads(opts) {
  const o = opts || {};
  const fetch = makeFetch([["/api/messages", { status: o.status || 200, body: o.body }]]);
  const ctx = load(THREADS_RE,
    "this.render = renderDeskThreads; this.stat = () => deskThreadsStat;",
    "let currentUser = __user; function myFirm() { return __firm; }",
    { fetch, __user: o.user === undefined ? { email: "brad@colliers.com" } : o.user,
      __firm: o.firm === undefined ? { id: "o1", name: "Colliers Boise" } : o.firm });
  ctx.fetchLog = fetch.log;
  return ctx;
}
const TH = (o) => Object.assign({ id: "t1", label: "Mike", unread: 0, lastMessageAt: "2026-09-01T00:00:00Z", preview: "Seen the comp?" }, o);

test("Today's unread conversations arrive unread first, newest first, with the whole list counted", async () => {
  const body = { threads: [
    TH({ id: "old", label: "Old", unread: 1, lastMessageAt: "2026-01-01T00:00:00Z" }),
    TH({ id: "u", label: "Dana", unread: 2, lastMessageAt: "2026-02-01T00:00:00Z" }),
    TH({ id: "n1", label: "N1", lastMessageAt: "2026-09-01T00:00:00Z" }),
  ] };
  const ctx = loadDeskThreads({ body });
  await ctx.render();
  const s = ctx.stat();
  assert.equal(s.total, 3);
  assert.equal(s.unread, 2);
  assert.deepEqual(s.unreadList.map((t) => t.id), ["u", "old"], "unread only, newest first: HOMEMAP.agenda never re-sorts them");
});

test("no firm, a failed read, or a signed-out page: no conversations, and no fetch where there is no member", async () => {
  let ctx = loadDeskThreads({ firm: null, body: { threads: [TH({})] } });
  await ctx.render();
  assert.equal(ctx.stat(), null);
  assert.equal(ctx.fetchLog.length, 0);
  ctx = loadDeskThreads({ user: null, body: { threads: [TH({})] } });
  await ctx.render();
  assert.equal(ctx.stat(), null);
  assert.equal(ctx.fetchLog.length, 0, "a stale firm in memory must not be asked about on a signed-out page");
  ctx = loadDeskThreads({ status: 503, body: { error: "down" } });
  await ctx.render();
  assert.equal(ctx.stat(), null, "'could not read' is null, never an empty list");
  ctx = loadDeskThreads({ body: { threads: [] } });
  await ctx.render();
  assert.deepEqual(ctx.stat(), { total: 0, unread: 0, unreadList: [] });
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
// The firm's lease dates (2026-09-04): one read, for Home's Today and map.
// The figure strip that first drew them left with the old Home (2026-10-07);
// the read and its rules stayed.
// ---------------------------------------------------------------------------
const CRIT_RE = /  async function readFirmCritical\(\) \{[\s\S]*?\n  \}\n/;
function loadCritical(opts) {
  const o = opts || {};
  const fetch = makeFetch([["/api/org/leases", o.leases || { status: 200, body: { critical: o.critical || [] } }]]);
  const ctx = load(CRIT_RE, "this.read = readFirmCritical;",
    "let currentUser = __user; function myFirm() { return __firm; }",
    { fetch, __user: o.user === undefined ? { email: "brad@colliers.com" } : o.user,
      __firm: o.firm === undefined ? { id: "o1", name: "Colliers Boise" } : o.firm });
  ctx.fetchLog = fetch.log;
  return ctx;
}

test("the leases read hands back the dates, or null when it could not read them — never an empty list", async () => {
  const dates = [{ tenant: "Acme Logistics", kind: "notice", days: 41 }];
  const ok = loadCritical({ critical: dates });
  assert.deepEqual(await ok.read(), dates);
  assert.equal(ok.fetchLog.length, 1);
  assert.equal(ok.fetchLog[0].url, "/api/org/leases?id=o1");
  const failed = loadCritical({ leases: { status: 503, body: {} } });
  assert.equal(await failed.read(), null, "'could not read the leases' must not look like 'nothing is due'");
  const none = loadCritical({ firm: null });
  assert.equal(await none.read(), null);
  assert.equal(none.fetchLog.length, 0, "no firm, no read");
});

test("the leases read starts beside the batch, lands before Home draws, and has one reader", () => {
  const at = html.indexOf("async function renderHomeFirm()");
  const fn = html.slice(at, html.indexOf("\n  }\n", at));
  assert.ok(fn.indexOf("const critical = readFirmCritical();") < fn.indexOf("const buildings = readFirmBuildings();"),
    "the leases read starts beside the batch, not after it");
  assert.ok(fn.indexOf("deskCritical = await critical;") > fn.indexOf("await Promise.all(["), "joined after the batch");
  assert.ok(fn.indexOf("deskCritical = await critical;") < fn.indexOf("drawHomeMap()"), "and before Home draws from it");
  assert.equal((html.match(/bootFetch\(`\/api\/org\/leases\?id=\$\{encodeURIComponent\(firm\.id\)\}`\)/g) || []).length, 1,
    "exactly one reader of the leases route on Home: bootFetch hands an embedded answer to its FIRST caller only");
});

test("the section is labelled Contacts — the tenant-rep shop it was named for was withdrawn", () => {
  // The label may carry Draft C's head icon ahead of the word; the word is
  // what this test is about.
  assert.match(html, /<span class="rd-lab">(?:<span class="dk-hico[^"]*">[\s\S]*?<\/svg><\/span>)?Contacts<\/span>/);
  assert.doesNotMatch(html, /rd-lab">Tenant contacts</, "a broker shop or a development shop keeps a contact list too");
});

// The shelf's own tests (its counts, its saved view, Take down, Discuss)
// moved with it to Messages on 2026-10-08: test/report-inbox.test.js runs
// its rules, and test/messages-page.test.js pins the page's half.
test("Home no longer reads or draws the firm's shelf", () => {
  for (const gone of ["renderFirmShelf", "applyFirmShelfFilter", "firmShelfItems", 'id="deskSharedWithFirm"', "/api/org/shelf"]) {
    assert.ok(!html.includes(gone), `index.html still carries ${gone}`);
  }
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
  const invites = load(INVITES_RE, "this.fn = renderFirmInvites;", "function renderHomeFirm() {}");
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

// The rename box (2026-10-09): offered to whoever the server lets rename,
// hidden from everybody else, and never written over a draft being typed.
const FIRM_NAME_RE = /  const firmNameOf = [^\n]*\n  function renderFirmName\(firm\) \{[\s\S]*?\n  \}/;

test("an owner or admin gets the rename box; a colleague does not", () => {
  const owner = load(FIRM_NAME_RE, "this.fn = renderFirmName;");
  assert.equal(owner.dom.hidden("firmNameWrap"), true, "the markup ships it hidden");
  owner.fn({ name: "Jacob R Adler", canManage: true });
  assert.equal(owner.dom.hidden("firmNameWrap"), false);
  assert.equal(owner.dom.el("firmRenameInput").value, "Jacob R Adler");
  assert.equal(owner.dom.hidden("firmRenameBtn"), true, "no Rename button until the name changes");

  const colleague = load(FIRM_NAME_RE, "this.fn = renderFirmName;");
  colleague.fn({ name: "Jacob R Adler", canManage: false });
  assert.equal(colleague.dom.hidden("firmNameWrap"), true,
    "they read the name in the panel's heading; the server would refuse the box");
});

test("a redraw mid-edit keeps the name being typed", () => {
  const ctx = load(FIRM_NAME_RE, "this.fn = renderFirmName;");
  const input = ctx.dom.el("firmRenameInput");
  input.value = "Adler Industrial";
  ctx.dom.document.activeElement = input;
  ctx.fn({ name: "Jacob R Adler", canManage: true });
  assert.equal(input.value, "Adler Industrial", "Home refreshing must not wipe a draft");
  assert.equal(ctx.dom.hidden("firmRenameBtn"), false, "and the draft can still be saved");

  // Spacing alone is not a new name: the server would store the same string.
  input.value = "  Jacob   R Adler ";
  ctx.fn({ name: "Jacob R Adler", canManage: true });
  assert.equal(ctx.dom.hidden("firmRenameBtn"), true);
});

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

// The shelf's saved view per shop (a development shop opens on Land) is
// Messages' since 2026-10-08, read from org-access.js's SHOP_COPY on the
// server (test/report-inbox.test.js runs the rule).

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
    copy[0] + "\nasync function renderHomeFirm() {}\nfunction openUpgradePrompt() {}", { fetch });
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
  // renderHomeFirm still hides it on sign-out: the roster names colleagues.
  assert.ok(html.includes('document.getElementById("deskFirm").classList.add("hidden");'),
    "a stale roster survives a sign-out");
});

// ---------------------------------------------------------------------------
// Home's greeting and its clock (Draft C, 2026-09-25). The banner that first
// carried them left with the old Home on 2026-10-07 (and with it the agenda,
// the dates card, the figure cards, the find box, the no-firm start cards
// and the skyline); the greeting moved over Home's list (#hmTitle, #hmDay),
// with its timer.
// ---------------------------------------------------------------------------
const CLOCK_RE = /  function deskGreetingFor\(now, user\) \{[\s\S]*?\n  function stopDeskClock\(\) \{[\s\S]*?\n  \}/;
// A test clock for the slice: `new Date()` reads `clock.now`, and timers are
// RECORDED, never scheduled. drawDeskClock arms a timer for the next change
// of greeting, and a real one aimed at noon would hold this file's
// `node --test` process open for hours.
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
function loadGreeting(user, clock) {
  const c = clock || fakeClock(Date.now());
  return load(CLOCK_RE, "this.greet = deskGreetingFor; this.draw = drawDeskClock; this.stop = stopDeskClock;",
    "let currentUser = __user;",
    { fetch: makeFetch([]), __user: user, Date: c.Date, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
}

test("Home greets a member by first name, on this browser's clock, and says Home to nobody", () => {
  const ctx = loadGreeting({ email: "brad@colliers.com", name: "Brad Keller" });
  const at = (h) => new Date(2026, 8, 25, h, 5);
  assert.equal(ctx.greet(at(8), { name: "Brad Keller" }), "Good morning, Brad");
  assert.equal(ctx.greet(at(13), { name: "Brad Keller" }), "Good afternoon, Brad");
  assert.equal(ctx.greet(at(19), { name: "  Brad  " }), "Good evening, Brad");
  assert.equal(ctx.greet(at(8), { email: "sam@summitcre.com" }), "Good morning", "no name, no guess at one from the email");
  assert.equal(ctx.greet(at(8), { name: "X".repeat(90) }).length, "Good morning, ".length + 40, "a long name is cut, not wrapped over the heading");
  ctx.draw();
  assert.match(ctx.dom.text("hmTitle"), /^Good (morning|afternoon|evening), Brad$/);
  assert.match(ctx.dom.text("hmDay"), /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [A-Z][a-z]+ \d{1,2}$/);
  const out = loadGreeting(null);
  out.draw();
  assert.equal(out.dom.text("hmTitle"), "Home");
  // drawHomeMap writes the same greeting on every draw, from the same helper.
  assert.match(html, /getElementById\("hmTitle"\)\.textContent = deskGreetingFor\(new Date\(\), currentUser\);/);
});

test("a Home left open turns to Good afternoon at noon, Good evening at 5, and a new day at midnight", () => {
  // Owner, 2026-09-25: a Home opened before noon still said "Good morning"
  // in the afternoon, because the greeting was written once, at paint. This
  // runs the real timer path on a clock the test moves.
  const clock = fakeClock(new Date(2026, 8, 25, 11, 50).getTime());
  const ctx = loadGreeting({ email: "brad@colliers.com", name: "Brad Keller" }, clock);
  ctx.draw();
  assert.equal(ctx.dom.text("hmTitle"), "Good morning, Brad");
  assert.equal(clock.armed().length, 1, "one timer");
  assert.equal(clock.armed()[0].delay, 10 * 60 * 1000 + 250, "aimed just past noon, not polled");
  clock.fire();
  assert.equal(ctx.dom.text("hmTitle"), "Good afternoon, Brad", "noon itself is afternoon");
  assert.equal(clock.armed().length, 1, "re-armed for 5pm, never stacked");
  clock.fire();
  assert.equal(ctx.dom.text("hmTitle"), "Good evening, Brad");
  assert.equal(ctx.dom.text("hmDay"), "Friday, September 25");
  clock.fire();
  assert.equal(ctx.dom.text("hmTitle"), "Good morning, Brad");
  assert.equal(ctx.dom.text("hmDay"), "Saturday, September 26", "midnight moves the day line too");
  ctx.draw(); ctx.draw();
  assert.equal(clock.armed().length, 1, "every draw re-arms the SAME one timer");
  ctx.stop();
  assert.equal(clock.armed().length, 0, "stopDeskClock leaves nothing armed");
  const nobody = fakeClock(new Date(2026, 8, 25, 11, 50).getTime());
  loadGreeting(null, nobody).draw();
  assert.equal(nobody.armed().length, 0, "a signed-out Home says Home and arms nothing");
});

test("a sign-out takes Home back down: no name, no timer, no firm", () => {
  const at = html.indexOf("async function renderHomeFirm()");
  const fn = html.slice(at, html.indexOf("\n  }\n", at));
  const hide = fn.slice(fn.indexOf("const hideAll = () => {"), fn.indexOf("};", fn.indexOf("const hideAll = () => {")));
  assert.ok(hide.includes("stopDeskClock();"),
    "hideAll stops the greeting's timer, or it would greet the signed-out page at the next hour mark");
  assert.ok(hide.includes("resetHomeMap();"), "and Home's map forgets the buildings, deals and colleagues it named");
  const reset = html.slice(html.indexOf("  function resetHomeMap() {"), html.indexOf("\n  }\n", html.indexOf("  function resetHomeMap() {")));
  assert.ok(reset.includes('t.textContent = "Home"'), "the heading goes back to Home, with no name");
  assert.ok(html.includes("if (!document.hidden && deskClockTimer) drawDeskClock();"),
    "a tab coming back re-reads the clock, only while a greeting is live");
  assert.ok(fn.indexOf("drawDeskClock();") > fn.indexOf("await firmReady;"), "the greeting is drawn once the account is known");
});

test("the empty lists are previews with one next step, and the preview holds no text that could read as data", () => {
  // The three Sharing card empties left with the card (2026-10-08); Messages
  // says its own empty states.
  for (const id of ["contactsEmpty"]) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > 0, id);
    const tag = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
    assert.match(tag, /class="hidden dk-ghost"/, `${id} ships hidden and is a preview`);
    const cta = html.indexOf('class="dk-ghost-cta"', at);
    const rows = html.slice(html.indexOf(">", at) + 1, html.lastIndexOf("<", cta));
    assert.match(rows, /class="dk-ghost-rows" aria-hidden="true"/, `${id}'s preview is hidden from a screen reader`);
    assert.equal(rows.replace(/<[^>]*>/g, "").trim(), "", `${id}'s preview rows must carry no text`);
  }
  // .dk-ghost sets display, so it needs its own hidden rule (the .pr-cell trap).
  assert.ok(html.includes(".dk-ghost.hidden { display: none; }"));
});

test("the old Home is deleted, not hidden: no banner, skyline, strip, agenda, decks or their writers", () => {
  for (const gone of ['id="deskHero"', 'id="deskSky"', 'id="deskStrip"', 'id="deskAgenda"', 'id="deskCritical"',
    'id="deskThreads"', 'id="deskDealBoard"', 'id="deskPermits"', 'id="deskBuildings"', 'id="deskFirmEmpty"',
    "data-deck", "drawDeskSky", "drawDeskHome", "resetDeskHero", "drawFirmStrip", "drawAgenda", "renderDeskFind",
    "renderDealBoard", "renderYourPermits", "renderFirmEmpty", "refreshDeckVisibility", "/firm-skyline.js", "SKYLINE"]) {
    assert.ok(!html.includes(gone), `index.html still carries ${gone}`);
  }
  assert.ok(!fs.existsSync(path.join(__dirname, "..", "firm-skyline.js")), "firm-skyline.js left with the skyline");
  const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.ok(!serverSrc.includes('"/firm-skyline.js"'), "server.js no longer serves it");
});

// ---------------------------------------------------------------------------
// Tracked permits are OFF Home (2026-09-30, owner's call). The card
// (#deskTracked) and its "Needs you" entries shipped 2026-09-29 and came off
// the next day; a member's permits live on /permits, and the rail's Permit
// tracker dot still says when one reached a step. /api/permits/mine is
// /permits' read now, so it is not in the boot list either.
// ---------------------------------------------------------------------------
test("tracked permits stay off Home: no card, no Today entry, no boot read", () => {
  for (const gone of ['id="deskTracked', "renderTrackedPermits", "deskPermitNotices", "View permit →"]) {
    assert.ok(!html.includes(gone), `index.html still carries ${gone}`);
  }
  const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const list = serverSrc.match(/const DESK_BOOT_URLS = \[[\s\S]*?\n\];/)[0];
  assert.ok(!list.includes("/api/permits/mine"), "nothing on Home reads it, so the page must not wait on it");
  assert.ok(list.includes("/api/permits/unread"), "the rail's Permit tracker dot still ships with the page");
});

// ---------------------------------------------------------------------------
// The Sharing card (2026-10-06 to 2026-10-08). Home's Reports tab held the
// firm shelf, what was sent to the member and their own links; the owner
// moved them into Messages on 2026-10-08. Its rules are report-inbox.js's
// now (test/report-inbox.test.js); Home must carry none of it.
// ---------------------------------------------------------------------------
test("Home carries no Reports tab and no Sharing card, and reads no shares", () => {
  for (const gone of ['id="hmTabReports"', 'id="hmPaneReports"', 'id="deskSharing"', 'id="shareTabs"', 'id="deskInbox"',
    'id="sharesRows"', "syncShareCard", "renderSharesTable", "mergeShareInbox", "drawShareInbox", "addMyShareRow",
    "renderDeskHubs", 'bootFetch("/api/shares")', 'bootFetch("/api/hubs")']) {
    assert.ok(!html.includes(gone), `index.html still carries ${gone}`);
  }
  const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const list = serverSrc.match(/const DESK_BOOT_URLS = \[[\s\S]*?\n\];/)[0];
  for (const url of ["/api/shares", "/api/hubs"]) assert.ok(!list.includes(`"${url}"`), `Home's boot still waits on ${url}`);
  const org = serverSrc.match(/const DESK_BOOT_ORG_URLS = \(id\) => \[[\s\S]*?\n\];/)[0];
  assert.ok(!org.includes("`/api/org/shelf?id=${id}`"), "Home's boot still waits on the shelf");
});
