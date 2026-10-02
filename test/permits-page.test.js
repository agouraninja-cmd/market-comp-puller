// The Permit tracker (/permits, under Tools — 2026-09-24).
//
// Three things are pinned here. The page's own script compiles (the whole
// page is one template literal, so a stray backtick or single-backslash
// escape ships a page that renders and does nothing). The route, against the
// stand-in PostgREST: a signed-out reader gets the sign-in wall and no
// filings; a member gets the window, newest first, with the filing at their
// firm's building marked; an old filing and an unswept city stay out. And
// the nav: "Permit tracker" is the third Tools row on BOTH nav authors,
// after Market explorer and Comp report.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const VAULT = require("../broker-vault");
const PF = require("../permit-filings");
const { renderPermitsBody } = require("../permits-page");

const ROOT = path.join(__dirname, "..");
const SERVER_JS = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const INDEX_HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const SRC = fs.readFileSync(path.join(ROOT, "permits-page.js"), "utf8");

test("the page's script compiles, and the literal interpolates the boot alone", () => {
  for (const boot of [null, { s: 401, j: {} }, { s: 200, j: { filings: [] } }]) {
    const html = renderPermitsBody(boot);
    const m = html.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(m);
    assert.doesNotThrow(() => new Function(m[1]));
  }
  const literal = SRC.slice(SRC.indexOf("return `<style>"), SRC.lastIndexOf("</script>`"));
  assert.deepEqual([...literal.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]), ["bootJson"]);
  assert.equal((literal.match(/`/g) || []).length, 1, "only the literal's own opener");
  // HTML text outside the script takes the character, not an escape: the
  // first capture printed "city\u2019s" on the page.
  const markup = renderPermitsBody(null).split("<script>")[0];
  assert.equal(/\\u[0-9a-f]{4}/i.test(markup), false, "no literal \\uXXXX in the page's HTML text");
  assert.ok(renderPermitsBody({ s: 200, j: { filings: [{ address: "</script><b>" }] } }).includes("\\u003c/script>"),
    "the boot escapes < so a portal string cannot close the script");
});

// The page's own script, run against a stand-in DOM: every element the markup
// names, with the class it starts with, and just enough of document, location
// and fetch for the boot to draw every tab. What it proves is which tab opens
// and when the unread count is cleared: the first thing a person sees, and the
// one write the page makes on its own.
function runPage(boot, { hash = "", search = "" } = {}) {
  const html = renderPermitsBody(boot);
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const els = {};
  const posts = [];
  const el = (id) => els[id] || (els[id] = {
    id, className: "", textContent: "", innerHTML: "", value: "", checked: false, disabled: false, hidden: false, tabIndex: 0,
    attrs: {}, options: [], selectedIndex: 0, firstChild: null,
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener() {}, appendChild(c) { this.options.push(c); }, focus() {}, scrollIntoView() {},
    querySelectorAll() { return []; }, querySelector() { return null; },
  });
  for (const m of html.split("<script>")[0].matchAll(/<[a-z0-9]+\b([^>]*)>/gi)) {
    const id = /\sid="([^"]+)"/.exec(m[1]);
    const cls = /\sclass="([^"]*)"/.exec(m[1]);
    if (id) el(id[1]).className = cls ? cls[1] : "";
  }
  const document = { getElementById: el, createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [], head: { appendChild() {} }, documentElement: {} };
  const location = { hash, search, pathname: "/permits" };
  const fetch = (url, opts) => { posts.push([opts && opts.method, url]); return { then: () => ({ catch() {} }) }; };
  const history = { replaceState() {} };
  new Function("document", "location", "fetch", "history", "window", "getComputedStyle", script)(
    document, location, fetch, history, {}, () => ({ getPropertyValue: () => "" }));
  const selected = ["tabFilings", "tabMine", "tabAlerts"].find((id) => els[id].attrs["aria-selected"] === "true");
  return { els, posts, selected };
}

const STEPS5 = ["submitted", "review", "approved", "issued", "final"].map((key) => ({ key, label: key, done: false, at: null }));
const watchOf = (id, unread) => ({ id, mine: true, permitNumber: id, city: "Boise", label: "", address: "", status: "In Review", stage: "open",
  steps: STEPS5, step: "review", notify: { steps: [] }, history: [], unread, firm: "", firmId: "", checkError: "" });
const bootWith = (unread) => ({
  s: 200, j: { filings: [], cities: "Boise", windowDays: 30 },
  mine: { s: 200, j: { canTrack: true, cities: [{ key: "boise", label: "Boise" }], watches: [watchOf("w1", unread)], unread, max: 25, steps: [], notifySteps: [] } },
  alerts: { s: 200, j: { canTrack: true, alerts: [], cities: [], propertyTypes: [], kinds: [], areaMiles: [1] } },
});

test("three tabs: it opens on Your permits when one has news, on Filings otherwise", () => {
  // Draft C (2026-10-02). The unread count is cleared only once Your permits
  // is shown, by a POST from the page — never by opening another tab.
  const news = runPage(bootWith(1));
  assert.equal(news.selected, "tabMine");
  assert.deepEqual(news.posts, [["POST", "/api/permits/seen"]]);
  assert.equal(news.els.tabMineNew.textContent, "1 new");
  assert.equal(news.els.pwSec.className, "pt-panel", "the tab's panel is the one shown");
  assert.equal(news.els.ptFilings.className, "pt-panel hide");
  const quiet = runPage(bootWith(0));
  assert.equal(quiet.selected, "tabFilings");
  assert.deepEqual(quiet.posts, [], "nothing to clear, nothing sent");
  const named = runPage(bootWith(1), { hash: "#alerts" });
  assert.equal(named.selected, "tabAlerts", "a tab named in the hash wins");
  assert.deepEqual(named.posts, [], "news on a tab not shown stays unread");
  const free = runPage({ ...bootWith(0), mine: { s: 200, j: { canTrack: false, cities: [], watches: [], unread: 0 } },
    alerts: { s: 200, j: { canTrack: false, alerts: [] } } });
  assert.equal(free.selected, "tabFilings");
  assert.equal(free.els.tabMinePro.className, "pt-protag", "a free account sees Pro on Your permits");
  assert.equal(free.els.tabAlertsPro.className, "pt-protag", "and on Alerts");
  assert.equal(free.els.pwPro.className, "pw-pro");
  assert.equal(free.els.paPro.className, "pw-pro");
  const out = runPage({ s: 401, j: {} });
  assert.equal(out.els.ptApp.className, "hide", "signed out: the wall, and no tabs");
  assert.equal(out.els.ptWall.className, "pt-wall");
});

test("the two deep links land: #pw-<id> on each permit's card, ?track=1 on the add form", () => {
  // Made for the Workspace's Tracked permits card (2026-09-29), which came
  // off on 2026-09-30; a saved link to either still lands, on Your permits.
  const body = renderPermitsBody({ s: 200, j: { filings: [] } });
  const script = body.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.match(script, /class="pw-card" id="pw-'\+esc\(w\.id\)\+'"/, "each card carries the id the Workspace links to");
  const start = script.slice(script.indexOf("function startTab(){"), script.lastIndexOf("apply(BOOT);"));
  assert.ok(start.indexOf('hash.indexOf("#pw-")===0') > -1);
  assert.ok(start.includes('MINE&&MINE.canTrack&&ownCount()<(MINE.max||25)){ showTab("mine"); openAdd(); return; }'),
    "the form opens only for a member who may track (Pro), and only while there is room to add");
  const boot = script.slice(script.lastIndexOf("apply(BOOT);"));
  assert.ok(boot.indexOf("startTab();") > boot.indexOf("applyMine(BOOT.mine);"), "the card is looked for after the list is drawn");
  const linked = runPage(bootWith(0), { search: "?track=1" });
  assert.equal(linked.selected, "tabMine");
  assert.equal(linked.els.pwForm.className, "pw-form", "?track=1 opens the add form");
  const card = runPage(bootWith(0), { hash: "#pw-w1" });
  assert.equal(card.selected, "tabMine", "#pw-<id> opens the tab its card is on");
  assert.match(card.els["pw-w1"].className, /pw-focus/);
  // One seen POST in the whole script, reached only through the Your permits tab.
  assert.equal((script.match(/fetch\("\/api\/permits\/seen"/g) || []).length, 1);
  assert.ok(script.includes('if(name==="mine")markSeen();'));
});

test("the filters: every property type with its count, zero included, and a type with nothing says so", () => {
  // The Property type menu (2026-09-29) became one group of the Filings tab's
  // filters (2026-10-02); the rules it carried came with it.
  const html = renderPermitsBody({ s: 200, j: { filings: [] } });
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.ok(script.includes('{g:"prop",label:"Property type",val:function(f){return f.propertyType},order:PROP_TYPES,zeros:true}'));
  assert.ok(script.includes('{g:"type",label:"Permit type"'), "the permit-type filter stays");
  assert.ok(script.includes('"No "+(props[0]==="Other"?"other":props[0].toLowerCase())+" permit filed in "'), "an empty type says so in words");
  assert.ok(script.includes("function clearFilters(){"), "Clear filters resets every group");
  assert.equal(html.includes("ptInd"), false, "the old Industrial only box stays gone");
  assert.equal(html.includes('id="ptStrip"'), false, "the four number tiles are gone (their week counted eight days)");
});

test("Tools reads Market explorer, Comp report, Permit tracker on both nav authors", () => {
  // The owner's order (2026-09-24): the permit tracker is the THIRD row.
  for (const [name, src, bulk] of [["server.js", SERVER_JS, '<a id="navBulk" href="/bulk"'],
    ["index.html", INDEX_HTML, '<a id="menuBulkLink" href="/bulk"']]) {
    const label = src.indexOf('class="navsec">Tools<');
    const me = src.indexOf('<a href="/markets"', label);
    const cr = src.indexOf(bulk, label);
    const pt = src.indexOf('<a href="/permits"', label);
    assert.ok(label > -1 && me > label && cr > me && pt > cr, `${name}: Market explorer, then Comp report, then Permit tracker`);
    assert.ok(pt - cr < 600, `${name}: Permit tracker sits right after Comp report`);
  }
  assert.ok(/CTA_FREE_PAGES = new Set\([^)]*"\/permits"/.test(SERVER_JS), "a working page drops the red CTA");
});

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const NOW = new Date().toISOString();
const YEAR_OUT = new Date(Date.now() + 365 * 864e5).toISOString();
const dayAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const BRAD = { id: "u-brad", email: "brad@colliers.com", name: "Brad" };
const SOLO = { id: "u-solo", email: "solo@nowhere.com", name: "Solo" };
const ORG = "5a1e9a1e-0000-4000-8000-000000000001";
const B1 = "5a1e9a1e-0000-4000-8000-0000000000b1";
const fl = (street, over) => ({
  id: crypto.randomUUID(), jurisdiction: "boise", permit_number: "BLD-" + crypto.randomUUID().slice(0, 6),
  permit_type: "Tenant Improvement", description: null, project_name: null, address: street,
  street_key: PF.streetKey(street, VAULT.addressKey), market: "Boise, ID", parcel_number: null, zoning: "C-2",
  is_industrial: false, applicant_company: "Somebody LLC", contractor_company: null, applied_date: dayAgo(2),
  status: "Received", status_changed_at: null, source_url: "https://aca-prod.accela.com/BOISE/x",
  first_seen_at: NOW, last_seen_at: NOW, ...over });

test("the /permits route, signed out and signed in", async (t) => {
  const db = await fake.start({ tables: {
    users: [BRAD, SOLO].map((u) => ({ ...u, pro_tester: false, vault_beta: false })),
    sessions: [BRAD, SOLO].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
    subscriptions: [],
    orgs: [{ id: ORG, name: "Colliers Boise", share_default: "none", seats: 5, kind: "broker" }],
    org_members: [{ id: crypto.randomUUID(), org_id: ORG, email: BRAD.email, user_id: BRAD.id, role: "owner",
      invited_at: NOW, joined_at: NOW, removed_at: null, auto_share: null }],
    org_buildings: [{ id: B1, org_id: ORG, address: "1450 W Mission Ave, Boise, ID 83705",
      address_key: VAULT.addressKey("1450 W Mission Ave, Boise, ID 83705"), verified_key: null, market: "Boise, ID",
      property_type: "Industrial", size_sqft: null, year_built: null, lat: null, lng: null,
      added_by_user_id: BRAD.id, added_by_name: "Brad", created_at: NOW, updated_at: NOW }],
    permit_filings: [
      fl("1450 W MISSION AVE", { permit_number: "ON-BOARD", applied_date: dayAgo(1), is_industrial: true, zoning: "I-2" }),
      fl("200 N 8TH ST", { permit_number: "OFFICE-TI", applied_date: dayAgo(3) }),
      fl("9 OLD RD", { permit_number: "TOO-OLD", applied_date: dayAgo(45) }),
      // Nampa is read from its published reports (2026-10-01), a month
      // behind: its window is the last thirty days its reports cover, which
      // end at its newest filing, so a 40-day-old one is in and a 75-day-old
      // one is not.
      fl("1 NAMPA ST", { permit_number: "NAMPA-RPT", jurisdiction: "nampa", market: "Nampa, ID", applied_date: dayAgo(40) }),
      fl("2 NAMPA ST", { permit_number: "NAMPA-OLD", jurisdiction: "nampa", market: "Nampa, ID", applied_date: dayAgo(75) }),
    ],
    permit_filing_events: [], analytics_events: [],
  } });
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(async () => { srv.stop(); await db.stop(); });
  const page = async (user) => {
    const r = await fetch(`${srv.base}/permits`, user ? { headers: { cookie: `cn_session=tok-${user.id}` } } : {});
    const html = await r.text();
    assert.equal(r.status, 200);
    return { html, boot: JSON.parse(html.match(/var BOOT = (.*);\n/)[1]), headers: r.headers };
  };

  await t.test("signed out: the wall, and not one filing", async () => {
    const { html, boot, headers } = await page(null);
    assert.equal(boot.s, 401);
    assert.equal(html.includes("ON-BOARD"), false);
    assert.equal(headers.get("cache-control"), "no-store");
  });

  await t.test("a firm member: the window, newest first, their building's filing marked", async () => {
    const { html, boot } = await page(BRAD);
    assert.equal(boot.s, 200);
    assert.deepEqual(boot.j.filings.map((f) => f.permitNumber), ["ON-BOARD", "OFFICE-TI", "NAMPA-RPT"],
      "the 45-day-old Boise filing stays out; Nampa's window is its reports' last thirty days");
    const d40 = dayAgo(40);
    assert.deepEqual(boot.j.reportCities,
      [{ city: "Nampa", through: new Date(Date.UTC(Number(d40.slice(0, 4)), Number(d40.slice(5, 7)), 0)).toISOString().slice(0, 10) }],
      "the page is told where Nampa's reports stop, to say so");
    assert.equal(boot.j.filings[2].daysAgo, 40, "a Nampa filing keeps its true age");
    assert.deepEqual(boot.j.filings[0].onBoard, { id: B1, address: "1450 W Mission Ave, Boise, ID 83705" });
    assert.equal(boot.j.filings[1].onBoard, null);
    assert.deepEqual(boot.j.filings.slice(0, 2).map((f) => f.propertyType), ["Industrial", "Other"],
      "each filing carries its property type for the menu, worked out at read time");
    assert.ok(boot.j.filings.every((f) => f.stage === "open"),
      "and its stage, the colour of its status and the Status filter (\"Received\" is open)");
    assert.equal(boot.j.inFirm, true);
    assert.equal(boot.j.cities, "Boise, Meridian and Nampa");
    assert.equal(boot.j.stale, false);
    assert.ok(html.includes('<a href="/permits" aria-current="page">Permit tracker<span id="navPermitDot" class="navdot" hidden'),
      "the Tools row marks the page, and carries its unread dot hidden until asked");
    assert.equal(boot.mine.s, 200, "Your permits rides the same boot");
    assert.deepEqual(boot.mine.j.watches, []);
    assert.deepEqual(boot.mine.j.cities, [{ key: "boise", label: "Boise" }, { key: "meridian", label: "Meridian" }],
      "Nampa cannot be tracked by number: its reports cannot look up one permit");
  });

  await t.test("a member with no firm still gets the list, with nothing marked", async () => {
    const { boot } = await page(SOLO);
    assert.equal(boot.s, 200);
    assert.equal(boot.j.inFirm, false);
    assert.equal(boot.j.filings.length, 3);
    assert.ok(boot.j.filings.every((f) => f.onBoard === null));
  });
});
