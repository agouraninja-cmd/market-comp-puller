// Sites deals shared with the firm, a report's estimate on a deal, and where
// a deal sits (2026-10-21, migration 061), against a real server and the
// stand-in database. sites.test.js proves the rules; only a boot proves the
// firm read is a separate query that shows a colleague's shared deals and
// nothing else, that every write is still the owner's alone, and that a
// deploy ahead of 061 costs the three new things and nothing that worked
// before.
//
// Run: npm test   (node --test, no dependencies, no network)

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const PEOPLE = [
  { id: "u-jordan", email: "jordan@ridgeline.example", name: "Jordan Reyes" },
  { id: "u-casey", email: "casey@ridgeline.example", name: "Casey Lin" },
  { id: "u-out", email: "out@other.example", name: "Out Sider" },
  { id: "u-solo", email: "solo@solo.example", name: "Solo" },
];
const V2 = ["org_id", "estimate", "lat", "lng", "geo_source"];

function baseTables() {
  return {
    users: PEOPLE.map((p) => ({ ...p, pro_tester: false, vault_beta: false, digest_optout: false, created_at: "2025-01-01T00:00:00Z" })),
    sessions: PEOPLE.map((p) => ({ token_hash: sha256("tok-" + p.id), user_id: p.id, expires_at: YEAR_OUT })),
    subscriptions: PEOPLE.map((p) => ({ user_id: p.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false })),
    orgs: [], org_members: [], org_subscriptions: [], user_sites: [], portfolio_items: [], analytics_events: [],
  };
}

// A Census stand-in: "Overland" is placed, anything else is a real miss.
async function startCensus() {
  const server = http.createServer((req, res) => {
    const line = new URL(req.url, "http://x").searchParams.get("address") || "";
    const matches = /overland/i.test(line) ? [{ coordinates: { x: -116.265, y: 43.5893 }, matchedAddress: line.toUpperCase() }] : [];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ result: { addressMatches: matches } }));
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://localhost:${server.address().port}/geocoder`, stop: () => new Promise((r) => server.close(r)) };
}

async function bootWith(t, opts = {}) {
  const tables = baseTables();
  const db = await fake.start({ tables, ...(opts.db || {}) });
  const census = await startCensus();
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    CENSUS_API_URL: census.url });
  t.after(async () => { srv.stop(); await census.stop(); await db.stop(); });
  const call = async (who, method, path, body, extra) => {
    const r = await fetch(srv.base + path, { method, headers: { "content-type": "application/json", cookie: `cn_session=tok-${who}`, ...(extra || {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { s: r.status, j: await r.json().catch(() => ({})) };
  };
  return { tables, db, srv, call };
}

async function firms(call) {
  const org = await call("u-jordan", "POST", "/api/org", { name: "Ridgeline Dev", kind: "development" });
  assert.equal(org.s, 200, JSON.stringify(org.j));
  const orgId = org.j.id;
  assert.equal((await call("u-jordan", "POST", "/api/org/invite", { orgId, emails: ["casey@ridgeline.example"] })).s, 200);
  assert.equal((await call("u-casey", "POST", "/api/org/accept", { orgId })).s, 200);
  assert.equal((await call("u-out", "POST", "/api/org", { name: "Elsewhere", kind: "development" })).s, 200);
  return orgId;
}

const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 40)); }
  return fn();
};

test("a deal shared with the firm is seen by colleagues, read-only, and by nobody else", async (t) => {
  const { tables, db, call } = await bootWith(t);
  const orgId = await firms(call);

  const a = await call("u-jordan", "POST", "/api/sites", { address: "5600 W Overland Rd, Boise, ID 83709", acres: "9.2", asking_price: "5,800,000", share: true });
  assert.equal(a.s, 200, JSON.stringify(a.j));
  assert.equal(a.j.site.org_id, orgId, "the add form's box shares it with the owner's own firm");
  const b = await call("u-jordan", "POST", "/api/sites", { address: "3100 S Federal Way, Boise, ID 83705" });
  assert.equal(b.j.site.org_id, null, "a caller that says nothing shares nothing");

  await t.test("a colleague sees the shared deal, named, and only that one", async () => {
    const r = await call("u-casey", "GET", "/api/sites");
    assert.equal(r.s, 200);
    assert.deepEqual(r.j.sites, [], "Casey's own list is Casey's");
    assert.deepEqual(r.j.firmSites.map((s) => s.address), ["5600 W Overland Rd, Boise, ID 83709"]);
    assert.equal(r.j.firmSites[0].owner.name, "Jordan Reyes");
    assert.equal(r.j.firmSites[0].user_id, undefined, "an account id never rides along");
    assert.deepEqual(r.j.share, { orgId, name: "Ridgeline Dev" });
  });
  await t.test("the owner's own read is unchanged, and their shared deal is not listed twice", async () => {
    const r = await call("u-jordan", "GET", "/api/sites");
    assert.equal(r.j.sites.length, 2);
    assert.deepEqual(r.j.firmSites, []);
  });
  await t.test("another firm, and a member of no firm, see none of it", async () => {
    assert.deepEqual((await call("u-out", "GET", "/api/sites")).j.firmSites, []);
    const solo = await call("u-solo", "GET", "/api/sites");
    assert.deepEqual(solo.j.firmSites, []);
    assert.equal(solo.j.share, null, "no firm, nothing to share with");
  });
  await t.test("a colleague can change nothing on it", async () => {
    const before = JSON.stringify(tables.user_sites);
    assert.equal((await call("u-casey", "POST", "/api/sites/update", { id: a.j.site.id, stage: "loi" })).s, 404);
    assert.equal((await call("u-casey", "POST", "/api/sites/update", { id: a.j.site.id, share: false })).s, 404);
    assert.equal((await call("u-casey", "DELETE", "/api/sites?id=" + a.j.site.id)).s, 200, "no existence oracle");
    assert.equal(JSON.stringify(tables.user_sites), before, "a colleague's write reached the owner's row");
  });
  await t.test("the owner's switch takes it out of the firm's view and back", async () => {
    assert.equal((await call("u-jordan", "POST", "/api/sites/update", { id: a.j.site.id, share: false })).j.site.org_id, null);
    assert.deepEqual((await call("u-casey", "GET", "/api/sites")).j.firmSites, []);
    const on = await call("u-jordan", "POST", "/api/sites/update", { id: b.j.site.id, share: true });
    assert.equal(on.s, 200);
    assert.deepEqual((await call("u-casey", "GET", "/api/sites")).j.firmSites.map((s) => s.id), [b.j.site.id]);
    assert.equal((await call("u-jordan", "POST", "/api/sites/update", { id: b.j.site.id, share: "yes" })).s, 400, "a switch is a boolean");
  });
  await t.test("a member of no firm cannot share", async () => {
    const d = await call("u-solo", "POST", "/api/sites", { address: "1 Main St, Boise, ID 83702", share: true });
    assert.equal(d.j.site.org_id, null);
    const r = await call("u-solo", "POST", "/api/sites/update", { id: d.j.site.id, share: true });
    assert.equal(r.s, 400);
    assert.match(r.j.error, /Join a firm/);
  });
  await t.test("a colleague who leaves the firm takes their shared deals with them", async () => {
    const c = await call("u-casey", "POST", "/api/sites", { address: "8800 W Ustick Rd, Boise, ID 83704", share: true });
    assert.equal(c.j.site.org_id, orgId);
    assert.ok((await call("u-jordan", "GET", "/api/sites")).j.firmSites.some((s) => s.id === c.j.site.id));
    const m = tables.org_members.find((x) => x.org_id === orgId && x.email === "casey@ridgeline.example");
    assert.equal((await call("u-casey", "DELETE", `/api/org/member?org=${orgId}&id=${m.id}`)).s, 200);
    assert.ok(!(await call("u-jordan", "GET", "/api/sites")).j.firmSites.some((s) => s.id === c.j.site.id));
    assert.equal((await call("u-casey", "GET", "/api/sites")).j.sites.length, 1, "it is still Casey's own");
  });
  assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));
});

test("a report's estimate is written onto the owner's deal, checked, and a deal is placed on the map", async (t) => {
  const { tables, db, srv, call } = await bootWith(t);
  const base = srv.base;
  await firms(call);
  const d = await call("u-jordan", "POST", "/api/sites", { address: "5600 W Overland Rd, Boise, ID 83709" });
  const miss = await call("u-jordan", "POST", "/api/sites", { address: "1 Nowhere Ln, Boise, ID 83702" });
  const row = (id) => tables.user_sites.find((s) => s.id === id);

  await t.test("the estimate", async () => {
    const r = await call("u-jordan", "POST", "/api/sites/update", { id: d.j.site.id, estimate: { low: 5075000, likely: 5775000, high: 6275000, report: "r-1" } });
    assert.equal(r.s, 200, JSON.stringify(r.j));
    assert.deepEqual(row(d.j.site.id).estimate, { low: 5075000, likely: 5775000, high: 6275000, report: "r-1", at: r.j.site.estimate.at });
    assert.match(r.j.site.estimate.at, /^\d{4}-\d{2}-\d{2}$/, "stamped with the server's today");
    const before = JSON.stringify(row(d.j.site.id));
    for (const bad of [{ likely: 0 }, { low: 6000000, likely: 5000000 }, { likely: 5000000, report: "../x" }, "5000000"]) {
      assert.equal((await call("u-jordan", "POST", "/api/sites/update", { id: d.j.site.id, estimate: bad })).s, 400, JSON.stringify(bad));
    }
    assert.equal(JSON.stringify(row(d.j.site.id)), before, "a refused estimate changed nothing");
    assert.equal((await call("u-casey", "POST", "/api/sites/update", { id: d.j.site.id, estimate: { likely: 1 } })).s, 404, "only the owner's deal");
  });
  await t.test("where it sits: placed from our own server, a miss stamped once", async () => {
    assert.ok(await waitFor(() => row(d.j.site.id).geo_source === "census"), JSON.stringify(row(d.j.site.id)));
    assert.equal(row(d.j.site.id).lat, 43.5893);
    assert.ok(await waitFor(() => row(miss.j.site.id).geo_source === "none"));
    assert.equal(row(miss.j.site.id).lat, undefined);
    // A new address is a new place.
    await call("u-jordan", "POST", "/api/sites/update", { id: miss.j.site.id, address: "5700 W Overland Rd, Boise, ID 83709" });
    assert.ok(await waitFor(() => row(miss.j.site.id).geo_source === "census"));
  });
  await t.test("a read places an older deal, but never a speculative one (rule 15)", async () => {
    // A deal from before 061 has no place yet.
    const r = row(d.j.site.id);
    delete r.lat; delete r.lng; delete r.geo_source;
    const quiet = async () => { await new Promise((ok) => setTimeout(ok, 400)); return row(d.j.site.id).geo_source == null; };
    assert.equal((await call("u-jordan", "GET", "/api/sites", undefined, { "sec-purpose": "prefetch;prerender" })).s, 200);
    assert.ok(await quiet(), "a prerendered read wrote nothing");
    assert.equal((await call("u-jordan", "GET", "/api/sites", undefined, { "x-cn-desk-boot": "1" })).s, 200);
    assert.ok(await quiet(), "nor did the desk boot's fan-out, which a prerendered Home makes");
    const page = await fetch(base + "/sites", { headers: { cookie: "cn_session=tok-u-jordan", "sec-purpose": "prefetch;prerender" } });
    assert.equal(page.status, 200);
    assert.ok(await quiet(), "nor a prerendered /sites");
    assert.equal((await call("u-jordan", "GET", "/api/sites")).s, 200);
    assert.ok(await waitFor(() => row(d.j.site.id).geo_source === "census"), "a real read places it");
  });
  assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));
});

test("before migration 061 runs, Sites works as it did and offers none of the three", async (t) => {
  const { tables, call } = await bootWith(t, { db: { missingColumns: { user_sites: V2 } } });
  await firms(call);
  const g = await call("u-jordan", "GET", "/api/sites");
  assert.equal(g.s, 200, JSON.stringify(g.j));
  assert.equal(g.j.share, null, "sharing is not offered without its column");
  assert.deepEqual(g.j.firmSites, []);
  const add = await call("u-jordan", "POST", "/api/sites", { address: "5600 W Overland Rd, Boise, ID 83709", share: true });
  assert.equal(add.s, 200, "adding a deal still works: " + JSON.stringify(add.j));
  assert.ok(!("org_id" in tables.user_sites[0]), "the insert never named a column that is not there");
  const before = JSON.stringify(tables.user_sites);
  const sh = await call("u-jordan", "POST", "/api/sites/update", { id: add.j.site.id, share: true });
  assert.equal(sh.s, 503);
  assert.match(sh.j.error, /Nothing was changed/);
  assert.equal((await call("u-jordan", "POST", "/api/sites/update", { id: add.j.site.id, estimate: { likely: 1 } })).s, 503);
  assert.equal(JSON.stringify(tables.user_sites), before);
  assert.equal((await call("u-jordan", "POST", "/api/sites/update", { id: add.j.site.id, stage: "loi" })).s, 200, "a stage move still works");
});
