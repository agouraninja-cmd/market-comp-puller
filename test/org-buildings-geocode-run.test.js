// Locating the firm's buildings, actually run (2026-09-25).
//
// The Workspace banner shows one of the firm's buildings from above each
// morning, so a building typed into the add form — which arrives with no
// coordinates — is looked up with our own Census call. building-day.js and
// org-buildings.js prove the rules in isolation; this boots the real server
// against the stand-in PostgREST with a Census-shaped stub on CENSUS_API_URL
// (the vault-geocode-run precedent) and reads back what was actually
// written: a building is located after it is added, a board that predates
// the banner fills in on its next read, a Census answer on ANOTHER street is
// refused, a location a member's own door supplied is never looked up or
// rewritten, and the write is scoped to the firm.
//
// The lookup is fire-and-forget by contract, so these tests poll what the
// stand-in received rather than trusting a response to mean the work happened.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const VAULT = require("../broker-vault");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const NOW = new Date().toISOString();
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const BRAD = { id: "u-brad", email: "brad@foothillcre.com", name: "Brad" };
const ORG_ID = "9c1e9a1e-0000-4000-8000-0000000000a1";

// Census answers by the address asked for; anything else is a real miss.
const ANSWERS = {
  "3275 s federal way, boise, id": { y: 43.572128, x: -116.190925, m: "3275 S FEDERAL WAY, BOISE, ID, 83705" },
  "560 s eagle rd, meridian, id": { y: 43.610232, x: -116.354672, m: "560 N EAGLE RD, MERIDIAN, ID, 83642" },
  "120 n milwaukee st, boise, id": { y: 43.605718, x: -116.281339, m: "120 N MILWAUKEE ST, BOISE, ID, 83704" },
  "450 w main st, boise, id": { y: 1, x: 1, m: "450 MAIN ST, BOISE, ID, 83702" },
};
function startCensus() {
  const hits = [];
  const srv = http.createServer((req, res) => {
    const addr = new URL(req.url, "http://x").searchParams.get("address") || "";
    hits.push(addr);
    const a = ANSWERS[addr.trim().toLowerCase()];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ result: { addressMatches: a ? [{ coordinates: { x: a.x, y: a.y }, matchedAddress: a.m }] : [] } }));
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${srv.address().port}/onelineaddress`, hits,
    stop: () => new Promise((done) => srv.close(done)),
  })));
}

const building = (address, extra) => Object.assign({
  id: crypto.randomUUID(), org_id: ORG_ID, address, address_key: VAULT.addressKey(address), verified_key: null,
  market: "Boise, ID", property_type: "Industrial", size_sqft: 20000, year_built: 1990, lat: null, lng: null,
  added_by_user_id: BRAD.id, added_by_name: "Brad", created_at: NOW, updated_at: NOW,
}, extra);

async function until(fn, ms) {
  const end = Date.now() + (ms || 4000);
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 40)); }
  return fn();
}

test("the firm's buildings are located so the banner can picture them", async (t) => {
  const census = await startCensus();
  const tables = {
    users: [{ ...BRAD, pro_tester: false, vault_beta: false }],
    sessions: [{ token_hash: sha256("tok-" + BRAD.id), user_id: BRAD.id, expires_at: YEAR_OUT }],
    orgs: [{ id: ORG_ID, name: "Foothill Commercial", share_default: "none", seats: 5, kind: "broker" }],
    org_members: [{ id: crypto.randomUUID(), org_id: ORG_ID, email: BRAD.email, user_id: BRAD.id, role: "owner",
      invited_at: NOW, joined_at: NOW, removed_at: null, auto_share: null }],
    // A board that predates the banner: one building with no location.
    org_buildings: [building("120 N Milwaukee St, Boise, ID")],
    analytics_events: [],
  };
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    CENSUS_API_URL: census.url,
  });
  t.after(async () => { srv.stop(); await db.stop(); await census.stop(); });
  const url = `${srv.base}/api/org/buildings?id=${encodeURIComponent(ORG_ID)}`;
  const headers = { "content-type": "application/json", cookie: `cn_session=tok-${BRAD.id}` };
  const row = (address) => db.tables.org_buildings.find((b) => b.address === address);
  const add = (body) => fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

  await t.test("a board that predates the banner fills in on its next read", async () => {
    const r = await fetch(url, { headers });
    assert.equal(r.status, 200);
    assert.ok(await until(() => row("120 N Milwaukee St, Boise, ID").lat != null), "the read looked it up in the background");
    const b = row("120 N Milwaukee St, Boise, ID");
    assert.equal(b.lat, 43.605718);
    assert.equal(b.lng, -116.281339);
    const again = await (await fetch(url, { headers })).json();
    const wire = again.buildings.find((x) => x.address === "120 N Milwaukee St, Boise, ID");
    assert.equal(wire.lat, 43.605718, "and the banner reads it off the same list");
  });

  await t.test("a building added by address is located after it is added", async () => {
    const r = await add({ address: "3275 S Federal Way, Boise, ID", propertyType: "Industrial" });
    assert.equal(r.status, 200);
    assert.ok(await until(() => row("3275 S Federal Way, Boise, ID").lat != null));
    assert.equal(row("3275 S Federal Way, Boise, ID").lat, 43.572128);
    const patches = db.requests.filter((q) => q.method === "PATCH" && q.table === "org_buildings" &&
      q.body && "lat" in JSON.parse(q.body));
    assert.ok(patches.length >= 2, "the backfill and the add each wrote a location");
    for (const p of patches) {
      const q = decodeURIComponent(p.query);
      assert.match(q, new RegExp(`org_id=eq\\.${ORG_ID}`), "scoped to the firm, never by id alone");
      assert.match(q, /lat=is\.null/, "and it only ever fills an empty location");
      assert.deepEqual(Object.keys(JSON.parse(p.body)).sort(), ["lat", "lng"],
        "a location and nothing else: being located is not activity on the board");
    }
  });

  await t.test("a Census answer on another street is refused", async () => {
    const before = census.hits.length;
    const r = await add({ address: "560 S Eagle Rd, Meridian, ID", propertyType: "Retail" });
    assert.equal(r.status, 200);
    assert.ok(await until(() => census.hits.length > before), "it was asked");
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(row("560 S Eagle Rd, Meridian, ID").lat, null, "560 N Eagle Rd is the other side of town");
  });

  await t.test("a location a member's own door supplied is never looked up or rewritten", async () => {
    const r = await add({ address: "450 W Main St, Boise, ID", propertyType: "Office", lat: 43.61386, lng: -116.199328 });
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 300));
    assert.ok(!census.hits.some((h) => /450 W Main St/i.test(h)), "no lookup for a building that has a location");
    assert.equal(row("450 W Main St, Boise, ID").lat, 43.61386);
  });

  await t.test("a building with no street number is never sent to Census", async () => {
    await fetch(url, { headers });
    await new Promise((res) => setTimeout(res, 300));
    assert.ok(census.hits.every((h) => /^\s*\d/.test(h)));
    assert.deepEqual(db.unparsed, [], "every query shape was one the stand-in understands");
  });
});
