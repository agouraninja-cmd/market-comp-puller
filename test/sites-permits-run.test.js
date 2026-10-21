// Permits near a Sites deal (2026-10-21; the owner's #5, "permits within 1
// mile of my sites, with alerts"), against a real server and the stand-in
// database. sites.test.js proves the distance rules; only a boot proves the
// deal pane's read finds the right permits for a deal the reader can see and
// nothing for one they cannot, that its one-click alert is an ordinary area
// alert that then reads as covering the deal, and that the Permit tracker
// marks the filings near the reader's deals and no one else's.
//
// Run: npm test   (node --test, no dependencies, no network)

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const VAULT = require("../broker-vault");
const PF = require("../permit-filings");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const NOW = new Date().toISOString();
const YEAR_OUT = new Date(Date.now() + 365 * 864e5).toISOString();
const dayAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const PEOPLE = [
  { id: "u-jordan", email: "jordan@ridgeline.example", name: "Jordan Reyes" },
  { id: "u-casey", email: "casey@ridgeline.example", name: "Casey Lin" },
  { id: "u-out", email: "out@other.example", name: "Out Sider" },
];
// Where the Census stand-in puts each street, and two permits near each.
const PLACES = { overland: [43.5893, -116.265], ustick: [43.6331, -116.2915] };
const fl = (street, lat, lng, over) => ({
  id: crypto.randomUUID(), jurisdiction: "boise", permit_number: "BLD-" + crypto.randomUUID().slice(0, 6),
  permit_type: "New Commercial", description: null, project_name: null, address: street,
  street_key: PF.streetKey(street, VAULT.addressKey), market: "Boise, ID", parcel_number: null, zoning: "R-3",
  is_industrial: false, applicant_company: "Somebody LLC", contractor_company: null, applied_date: dayAgo(2),
  status: "Received", status_changed_at: null, source_url: "https://aca-prod.accela.com/BOISE/x",
  first_seen_at: NOW, last_seen_at: NOW, lat, lng, geo_source: lat == null ? "none" : "parcel", ...over });

async function startCensus() {
  const server = http.createServer((req, res) => {
    const line = (new URL(req.url, "http://x").searchParams.get("address") || "").toLowerCase();
    const key = Object.keys(PLACES).find((k) => line.includes(k));
    const matches = key ? [{ coordinates: { x: PLACES[key][1], y: PLACES[key][0] }, matchedAddress: line.toUpperCase() }] : [];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ result: { addressMatches: matches } }));
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://localhost:${server.address().port}/geocoder`, stop: () => new Promise((r) => server.close(r)) };
}

test("a deal's pane lists the permits filed within a mile, offers an alert, and /permits marks them", async (t) => {
  const tables = {
    users: PEOPLE.map((p) => ({ ...p, pro_tester: false, vault_beta: false, digest_optout: false, created_at: "2025-01-01T00:00:00Z" })),
    sessions: PEOPLE.map((p) => ({ token_hash: sha256("tok-" + p.id), user_id: p.id, expires_at: YEAR_OUT })),
    subscriptions: PEOPLE.map((p) => ({ user_id: p.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false })),
    orgs: [], org_members: [], org_subscriptions: [], org_buildings: [], user_sites: [], portfolio_items: [], analytics_events: [],
    permit_filings: [
      fl("5650 W OVERLAND RD", 43.5899, -116.2672, { permit_number: "NEAR-OVERLAND", applied_date: dayAgo(1), permit_type: "New Multifamily" }),
      fl("4100 W OVERLAND RD", 43.5893, -116.2400, { permit_number: "TWO-MILES" }),
      fl("8850 W USTICK RD", 43.6335, -116.2930, { permit_number: "NEAR-USTICK", applied_date: dayAgo(3) }),
      fl("1 NOWHERE LN", null, null, { permit_number: "NO-PLACE" }),
    ],
    permit_filing_events: [], permit_watches: [], permit_watch_events: [], permit_alerts: [],
  };
  const db = await fake.start({ tables });
  const census = await startCensus();
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    CENSUS_API_URL: census.url });
  t.after(async () => { srv.stop(); await census.stop(); await db.stop(); });
  const call = async (who, method, p, body) => {
    const r = await fetch(srv.base + p, { method, headers: { "content-type": "application/json", cookie: `cn_session=tok-${who}` },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { s: r.status, j: await r.json().catch(() => ({})) };
  };
  const waitFor = async (fn, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 25)); }
    return fn();
  };
  const org = await call("u-jordan", "POST", "/api/org", { name: "Ridgeline Dev", kind: "development" });
  assert.equal(org.s, 200, JSON.stringify(org.j));
  assert.equal((await call("u-jordan", "POST", "/api/org/invite", { orgId: org.j.id, emails: ["casey@ridgeline.example"] })).s, 200);
  assert.equal((await call("u-casey", "POST", "/api/org/accept", { orgId: org.j.id })).s, 200);
  assert.equal((await call("u-out", "POST", "/api/org", { name: "Elsewhere", kind: "development" })).s, 200);

  const mine = (await call("u-jordan", "POST", "/api/sites", { address: "5600 W Overland Rd, Boise, ID 83709" })).j.site;
  const theirs = (await call("u-casey", "POST", "/api/sites", { address: "8800 W Ustick Rd, Boise, ID 83704", share: true })).j.site;
  const lost = (await call("u-jordan", "POST", "/api/sites", { address: "1 Nowhere Ln, Boise, ID 83702" })).j.site;
  const row = (id) => tables.user_sites.find((s) => s.id === id);
  assert.ok(await waitFor(() => row(mine.id).geo_source === "census" && row(theirs.id).geo_source === "census" && row(lost.id).geo_source === "none"));

  await t.test("the owner's deal: the permits within a mile, newest first, with their distance", async () => {
    const r = await call("u-jordan", "GET", `/api/sites/permits?id=${mine.id}`);
    assert.equal(r.s, 200, JSON.stringify(r.j));
    assert.equal(r.j.placed, true);
    assert.deepEqual(r.j.permits.map((p) => p.permitNumber), ["NEAR-OVERLAND"], "the one 1.3 miles off stays out, as does one with no place");
    assert.equal(r.j.total, 1);
    assert.equal(r.j.permits[0].miles, 0.1);
    assert.equal(r.j.permits[0].street, "5650 W Overland Rd", "the portal's capitals, in ordinary case");
    assert.equal(r.j.alert, null, "no alert covers it yet");
    assert.equal(r.j.canAlert, true);
    assert.match(r.j.cities, /Boise/);
  });
  await t.test("a colleague's shared deal reads the same way; another firm's is not found", async () => {
    const r = await call("u-jordan", "GET", `/api/sites/permits?id=${theirs.id}`);
    assert.equal(r.s, 200);
    assert.deepEqual(r.j.permits.map((p) => p.permitNumber), ["NEAR-USTICK"]);
    assert.equal((await call("u-out", "GET", `/api/sites/permits?id=${theirs.id}`)).s, 404, "an id says nothing to someone who cannot see the deal");
    assert.equal((await call("u-out", "GET", `/api/sites/permits?id=${mine.id}`)).s, 404, "nor an unshared one");
    assert.equal((await call("u-jordan", "GET", "/api/sites/permits?id=nope")).s, 400);
  });
  await t.test("a deal Census could not place says so rather than listing nothing", async () => {
    const r = await call("u-jordan", "GET", `/api/sites/permits?id=${lost.id}`);
    assert.equal(r.s, 200);
    assert.deepEqual({ placed: r.j.placed, geo: r.j.geo }, { placed: false, geo: "none" });
    assert.equal(r.j.permits, undefined);
  });
  await t.test("one click is an ordinary area alert, and then the deal reads as covered", async () => {
    const a = await call("u-jordan", "POST", "/api/permits/alerts", { areaAddress: "5600 W Overland Rd, Boise, ID 83709", areaMiles: 1, name: "Near 5600 W Overland Rd" });
    assert.equal(a.s, 200, JSON.stringify(a.j));
    assert.equal(a.j.alert.area.miles, 1);
    const r = await call("u-jordan", "GET", `/api/sites/permits?id=${mine.id}`);
    assert.deepEqual(r.j.alert, { id: a.j.alert.id, miles: 1 });
    assert.equal((await call("u-casey", "GET", `/api/sites/permits?id=${theirs.id}`)).j.alert, null, "Jordan's alert is not Casey's");
  });
  await t.test("the Permit tracker marks each filing near the reader's deals, and only theirs", async () => {
    const page = async (who) => {
      const r = await fetch(`${srv.base}/permits`, { headers: { cookie: `cn_session=tok-${who}` } });
      return JSON.parse((await r.text()).match(/var BOOT = (.*);\n/)[1]);
    };
    const near = (boot) => Object.fromEntries(boot.j.filings.map((f) => [f.permitNumber, f.nearSite && f.nearSite.address]));
    const j = await page("u-jordan");
    assert.equal(j.j.nearSites, 2, "Jordan's placed deal and Casey's shared one");
    assert.deepEqual(near(j), { "NEAR-OVERLAND": "5600 W Overland Rd, Boise, ID 83709", "TWO-MILES": null,
      "NEAR-USTICK": "8800 W Ustick Rd, Boise, ID 83704", "NO-PLACE": null });
    assert.equal(j.j.filings.find((f) => f.permitNumber === "NEAR-OVERLAND").nearSite.miles, 0.1);
    const c = await page("u-casey");
    assert.deepEqual(near(c)["NEAR-OVERLAND"], null, "Jordan's unshared deal marks nothing for Casey");
    assert.equal(near(c)["NEAR-USTICK"], "8800 W Ustick Rd, Boise, ID 83704");
    const o = await page("u-out");
    assert.equal(o.j.nearSites, 0);
    assert.ok(o.j.filings.every((f) => f.nearSite === null), "another firm's reader sees no deal's address");
  });
  assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));
});
