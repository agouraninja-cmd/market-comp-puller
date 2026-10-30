// sites-page.js — /sites, a development firm's deals by stage (2026-10-12).
// It was Home's Properties tab until then, so the rail's Sites row opened a
// second Home. These run the page's own script against a small stand-in DOM
// with the real SITES and HOMESITES, so the board, the walls and the open
// deal are checked as drawn, not as written.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { renderSitesBody } = require("../sites-page");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "sites-page.js"), "utf8");
const SITES_SRC = fs.readFileSync(path.join(ROOT, "sites.js"), "utf8");
const HS_SRC = fs.readFileSync(path.join(ROOT, "home-sites.js"), "utf8");
const TODAY = "2026-10-12";
const DEV = { name: "Ridgeline Development", kind: "development" };

const deal = (o) => Object.assign({ id: "s1", address: "2410 W Amity Rd, Meridian, ID 83642", property_type: "Land", stage: "prospect",
  acres: 18.4, asking_price: 3450000, dates: [], stage_dates: {}, portfolio_item_id: null, notes: null }, o);

// ---- a stand-in DOM: just what the page and home-sites.js touch -------------
class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase(); this.ownerDocument = doc;
    this.children = []; this.attrs = {}; this.listeners = {}; this.className = ""; this.hidden = false;
    this.parentNode = null; this._text = ""; this.style = {};
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = String(v == null ? "" : v); }
  append(...kids) {
    kids.forEach((k) => {
      if (k == null) return;
      const node = typeof k === "object" ? k : Object.assign(new El("#text", this.ownerDocument), { _text: String(k) });
      if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((c) => c !== node);
      node.parentNode = this; this.children.push(node);
    });
  }
  replaceChildren(...kids) { this.textContent = ""; this.append(...kids); }
  after(node) { const p = this.parentNode; p.children.splice(p.children.indexOf(this) + 1, 0, node); node.parentNode = p; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === "class") this.className = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  fire(t, ev) { (this.listeners[t] || []).forEach((fn) => fn(Object.assign({ currentTarget: this, target: this, preventDefault() {} }, ev))); }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
  get classList() {
    const el = this;
    return { contains: (c) => el.className.split(/\s+/).includes(c),
      toggle: (c, on) => { const s = new Set(el.className.split(/\s+/).filter(Boolean)); (on === undefined ? !s.has(c) : on) ? s.add(c) : s.delete(c); el.className = [...s].join(" "); } };
  }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  byClass(c) { return this.all().filter((e) => e.className.split(/\s+/).includes(c)); }
}

function run(boot, { scripts = true, fetchJson = null } = {}) {
  const html = renderSitesBody(boot);
  const doc = { activeElement: null };
  doc.createElement = (t) => new El(t, doc);
  doc.createElementNS = (_, t) => new El(t, doc);
  const ids = {};
  for (const m of html.matchAll(/<(\w+)[^>]*\bid="(sp\w+)"([^>]*)>/g)) {
    const e = new El(m[1], doc);
    e.hidden = /\shidden[\s>]/.test(m[0]) || /\shidden$/.test(m[0].slice(0, -1));
    ids[m[2]] = e;
  }
  doc.getElementById = (id) => ids[id] || null;
  const fetched = [];
  const ctx = { document: doc, console, Promise, JSON, Date, Object, Array, String, Number, Math, Set,
    fetch: (url, opts) => { fetched.push([url, opts]); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(fetchJson || {}) }); },
    window: { confirm: () => true } };
  ctx.self = ctx;
  vm.createContext(ctx);
  if (scripts) { vm.runInContext(SITES_SRC, ctx); vm.runInContext(HS_SRC, ctx); }
  const js = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
  vm.runInContext(js, ctx);
  return { html, ids, fetched, doc };
}

// ---- the walls ---------------------------------------------------------------

test("each refusal is said in words, and the board never draws behind one", () => {
  for (const [boot, want] of [
    [null, /couldn't be loaded/],
    [{ s: 401 }, /Sign in to see your sites/],
    [{ s: 403 }, /part of Pro/],
    [{ s: 503 }, /unavailable right now/],
    [{ s: 200, sites: [], today: TODAY, firm: null }, /Sites is for development firms[\s\S]*Your properties are on Home/],
    [{ s: 200, sites: [], today: TODAY, firm: { name: "Summit", kind: "broker" } }, /Sites is for development firms/],
    // A firm read that failed, or a firm whose own row did not come back, is
    // said as such, never as "not a development firm" (2026-10-21).
    [{ s: 200, sites: [], today: TODAY, firm: null, firmFailed: true, firmSites: null }, /Your firm couldn't be loaded just now/],
    [{ s: 200, sites: [], today: TODAY, firm: { name: "your firm", kind: null } }, /Your firm couldn't be loaded just now/],
  ]) {
    const { ids } = run(boot);
    assert.equal(ids.spWall.hidden, false, JSON.stringify(boot));
    assert.match(ids.spWall.textContent, want);
    assert.equal(ids.spApp.hidden, true, "the board drew behind a wall: " + JSON.stringify(boot));
  }
  const { ids } = run({ s: 200, sites: [deal({})], today: TODAY, firm: DEV }, { scripts: false });
  assert.match(ids.spWall.textContent, /didn't finish loading/, "without its scripts the page says so");
});

// ---- the board ---------------------------------------------------------------

test("the deals sit in their stage's column; passed fold away; owned are Home's", () => {
  const sites = [
    deal({ id: "a", stage: "prospect", dates: [{ on: "2026-10-15", label: "LOI due" }] }),
    deal({ id: "b", address: "100 N Main St, Kuna, ID", stage: "contract", acres: 9.6, asking_price: 2880000 }),
    deal({ id: "c", address: "5 E Pine Ave, Nampa, ID", stage: "contract", acres: null, asking_price: null }),
    deal({ id: "d", address: "9 Old Rd, Star, ID", stage: "passed", stage_dates: { passed: "2026-09-30" } }),
    deal({ id: "e", stage: "owned", portfolio_item_id: "p1" }),
  ];
  const { ids } = run({ s: 200, sites, today: TODAY, firm: DEV });
  assert.equal(ids.spWall.hidden, true);
  assert.equal(ids.spApp.hidden, false);
  assert.equal(ids.spEmpty.hidden, true);
  const cols = ids.spBoard.children;
  assert.deepEqual(cols.map((c) => c.getAttribute("aria-label")), ["Prospect", "LOI", "Under contract", "Entitlements"]);
  const cardsIn = (col) => col.byClass("sp-card").map((c) => c.byClass("sp-ca")[0].textContent);
  assert.deepEqual(cardsIn(cols[0]), ["2410 W Amity Rd"]);
  assert.deepEqual(cardsIn(cols[1]), []);
  assert.match(cols[1].textContent, /Nothing here/, "an empty stage says so");
  assert.deepEqual(cardsIn(cols[2]), ["100 N Main St", "5 E Pine Ave"]);
  // A card says what a developer reads first, and a deadline inside a week is hot.
  const a = cols[0].byClass("sp-card")[0];
  assert.match(a.textContent, /Meridian, ID 83642/);
  assert.match(a.textContent, /18\.4 ac · \$3\.45M · \$188K\/ac/);
  assert.match(a.textContent, /LOI due · Oct 15/);
  assert.equal(a.byClass("hot").length, 1);
  // The figures across the deals in play (the passed and the owned are not).
  assert.match(ids.spFigs.textContent, /3deals in play/);
  assert.match(ids.spFigs.textContent, /28acres/);
  assert.match(ids.spFigs.textContent, /\$6\.33Masking/);
  // Passed, folded; owned, pointed home.
  assert.equal(ids.spPassed.hidden, false);
  assert.deepEqual(ids.spPassedRows.byClass("sp-ca").map((e) => e.textContent), ["9 Old Rd"]);
  assert.match(ids.spPassedRows.textContent, /Passed Sep 30/);
  assert.match(ids.spFoot.textContent, /1 closed deal is with what you own, on Home\./);
  assert.equal(ids.spOpen.hidden, true, "nothing is open until a card is");
});

test("a card opens its deal under the board with Home's own pane, and closes it again", () => {
  const { ids } = run({ s: 200, sites: [deal({ id: "a", stage: "loi" })], today: TODAY, firm: DEV });
  const card = () => ids.spBoard.byClass("sp-card")[0];
  card().fire("click");
  assert.equal(ids.spOpen.hidden, false);
  assert.equal(card().getAttribute("aria-expanded"), "true");
  assert.equal(ids.spOpen.byClass("hs-pane").length, 1, "the pane is home-sites.js's");
  assert.match(ids.spOpen.textContent, /Move to Under contract →/);
  assert.match(ids.spOpen.textContent, /Key terms/);
  card().fire("click");
  assert.equal(ids.spOpen.hidden, true);
  assert.equal(card().getAttribute("aria-expanded"), "false");
});

test("an empty list is an invitation, and the add form takes deals only", () => {
  const { ids } = run({ s: 200, sites: [], today: TODAY, firm: DEV });
  assert.equal(ids.spEmpty.hidden, false);
  assert.equal(ids.spBoard.hidden, true);
  assert.equal(ids.spFigs.hidden, true);
  ids.spEmptyAdd.fire("click");
  const form = ids.spAdd.all().find((e) => e.tagName === "FORM");
  assert.ok(form, "the add form did not open");
  assert.ok(!ids.spAdd.all().some((e) => e.getAttribute("role") === "radiogroup"), "/sites offers \"I own it\": that is Home's");
  assert.match(ids.spAdd.textContent, /Add property/);
});

test("after a write the page reads /api/sites again and draws what came back", async () => {
  const later = [deal({ id: "a", stage: "contract" })];
  const { ids, fetched } = run({ s: 200, sites: [deal({ id: "a", stage: "prospect" })], today: TODAY, firm: DEV },
    { fetchJson: { sites: later, today: TODAY } });
  ids.spBoard.byClass("sp-card")[0].fire("click");
  const move = ids.spOpen.all().find((e) => e.tagName === "BUTTON" && /^Move to LOI/.test(e.textContent));
  move.fire("click");
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(fetched.map((f) => f[0]), ["/api/sites/update", "/api/sites"]);
  assert.equal(ids.spBoard.children[2].byClass("sp-card").length, 1, "the deal is drawn where the read put it");
  assert.equal(ids.spOpen.hidden, false, "the moved deal stays open");
});

// ---- rules held against the source -----------------------------------------------

test("the page is built from text, interpolates only its boot, and loads Home's three files", () => {
  const lit = SRC.slice(SRC.indexOf("return `"), SRC.lastIndexOf("`;"));
  assert.deepEqual(lit.match(/\$\{[^}]*\}/g), ["${bootJson}"], "a second interpolation in the page literal");
  assert.equal((lit.match(/`/g) || []).length, 1, "a backtick inside the page literal closes it early");
  assert.doesNotMatch(lit, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  const html = renderSitesBody({ s: 200, sites: [deal({ address: "</script><script>alert(1)</script>" })], today: TODAY, firm: DEV });
  assert.ok(!html.includes("</script><script>alert(1)"), "a typed address can close the boot's script tag");
  for (const src of ['<script src="/sites.js">', '<script src="/home-sites.js">', '<link rel="stylesheet" href="/home-sites.css">']) {
    assert.ok(html.includes(src), src);
  }
  // No write on load: a prerendered copy of this page must change nothing.
  const { fetched } = run({ s: 200, sites: [deal({})], today: TODAY, firm: DEV });
  assert.deepEqual(fetched, []);
});

test("server.js serves /sites through requireSites' gate and marks its rail row", () => {
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const route = server.slice(server.indexOf('pagePath === "/sites"'), server.indexOf('pagePath === "/permits"'));
  // The read is sitesPayload's since 2026-10-21 (GET /api/sites answers the
  // same thing), still the member's own rows by user_id.
  // A prerendered /sites places no deal on the map (rule 15).
  const order = ["getSessionUser(req)", "canUseVault", "DB_CONFIGURED", "sitesPayload(user, { place: !INSTANTNAV.isSpeculative(req.headers) })"];
  // GET /api/sites is a pure read: nothing there places a deal.
  const api = server.slice(server.indexOf('if (req.url.split("?")[0] === "/api/sites") {'), server.indexOf('if (req.url.split("?")[0] === "/api/sites") {') + 1500);
  assert.match(api, /sendJson\(res, 200, await sitesPayload\(user\)\)/);
  let at = -1;
  for (const s of order) { const i = route.indexOf(s); assert.ok(i > at, s + " is missing or out of order"); at = i; }
  const payload = server.slice(server.indexOf("const sitesPayload = async (user, opts) => {"), server.indexOf('if (req.method === "POST" && req.url.split("?")[0] === "/api/sites/update")'));
  assert.ok(payload.includes("user_sites?user_id=eq.${encodeURIComponent(user.id)}"), "the page's read is the member's own rows");
  assert.match(route, /logPageVisit\(req, "sites_visit"/);
  assert.match(route, /current: "\/sites"/);
  assert.match(server, /"\/home-sites\.css": \{ file: "home-sites\.css", type: "text\/css; charset=utf-8", maxAge: 0 \}/);
});

test("a failed read of the team's deals is said once, not over every later line (2026-10-21)", () => {
  // Found in review: draw() said it on every draw, covering what a write had
  // just said, and nothing took it down once a read came back.
  const { ids } = run({ s: 200, sites: [deal({ id: "a", stage: "loi" })], today: TODAY, firm: DEV, firmSites: null });
  assert.equal(ids.spMsg.hidden, false);
  assert.match(ids.spMsg.textContent, /Your team's shared deals couldn't be loaded just now\. Yours are all here\./);
  ids.spMsg.textContent = "5600 W Overland Rd is shared with Ridgeline Dev.";
  ids.spBoard.byClass("sp-card")[0].fire("click");   // a draw
  assert.equal(ids.spMsg.textContent, "5600 W Overland Rd is shared with Ridgeline Dev.", "a later draw leaves the newer line alone");
});
