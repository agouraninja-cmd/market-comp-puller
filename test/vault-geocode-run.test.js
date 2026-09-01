const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

// Import-time geocoding, actually run (spec
// docs/superpowers/specs/2026-08-06-private-comp-geocoding.md §3 step 2).
//
// test/vault-coordinates.test.js proves the SPREADSHEET path only ever writes
// geo_source 'broker', and test/broker-properties.test.js proves the pure
// filter. Neither can reach the part that matters most: the privacy wall says
// a private comp's address may go to OUR OWN Census call and nowhere else, and
// the write must never beat a coordinate the broker supplied themselves. This
// boots the real server against the fake PostgREST with a census-shaped stub
// on CENSUS_API_URL (the RESEND_API_URL precedent — test-only, trusted
// config), uploads a real CSV the way the page does, and reads back what was
// actually PATCHed.
//
// The geocode is fire-and-forget by contract, so these tests poll the fake's
// captured requests rather than trusting the upload response to mean the work
// happened — the response deliberately says nothing about it.

const DAY = 86400000;
const TOKEN = "test-session-token";
const TOKEN_HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");

function baseTables() {
  return {
    users: [{ id: "u1", email: "broker@example.com", vault_beta: true }],
    sessions: [
      { id: "s1", user_id: "u1", token_hash: TOKEN_HASH,
        expires_at: new Date(Date.now() + 30 * DAY).toISOString() },
    ],
    broker_comps: [],
    broker_uploads: [],
    broker_properties: [],
    broker_profiles: [
      { id: "p1", user_id: "u1", email: "broker@example.com",
        display_name: "", company: "Test & Co", public: false },
    ],
  };
}

// A census-shaped stub. `hits` records every request so a test can assert the
// geocoder was consulted — or, just as importantly, that it never was.
function startCensus({ status = 200, lat = 43.615, lng = -116.2023 } = {}) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(req.url);
    if (status !== 200) { res.writeHead(status); return res.end("outage"); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ result: { addressMatches: [
      { coordinates: { x: lng, y: lat }, matchedAddress: "1450 MISSION AVE" },
    ] } }));
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${srv.address().port}/onelineaddress`,
    hits,
    stop: () => new Promise((r) => srv.close(r)),
  })));
}

async function bootAll({ censusStatus = 200 } = {}) {
  const census = await startCensus({ status: censusStatus });
  const db = await fake.start({ tables: baseTables() });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    CENSUS_API_URL: census.url,
  });
  return {
    db, srv, census,
    stop: async () => { srv.stop(); await db.stop(); await census.stop(); },
  };
}

function upload(srv, csv) {
  return fetch(srv.base + "/api/vault/upload", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `cn_session=${TOKEN}` },
    body: JSON.stringify({ filename: "book.csv", csv }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

// The fake records each request's body as the raw string it arrived as.
const bodyOf = (r) => { try { return JSON.parse(r.body); } catch { return {}; } };
const censusPatches = (db) => db.requests.filter((r) =>
  r.method === "PATCH" && r.table === "broker_properties" &&
  bodyOf(r).geo_source === "census");

// The work is asynchronous on purpose; wait for a condition, bounded.
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return fn();
}

// Commas, deliberately. These fixtures read "1450 Mission Ave Boise ID" until
// 2026-09-01, which marketOf cannot parse — so the comp they stood for would
// have been filed under a market literally called "1450 Mission Ave Boise ID",
// never appearing in the uploader's own reports. The upload path refuses that
// now (parseUpload's injected hasMarket), and these say what a real address
// looks like, which is also what templateCsv has always shown.
const CSV_NO_COORDS =
  "address,property_type,transaction,deal_date,price,size_sqft\n" +
  "\"1450 Mission Ave, Boise, ID\",Industrial,sale,2026-03-14,4250000,31000\n";

const CSV_WITH_COORDS =
  "address,property_type,transaction,deal_date,price,size_sqft,lat,lng\n" +
  "\"1450 Mission Ave, Boise, ID\",Industrial,sale,2026-03-14,4250000,31000,43.99,-116.99\n";

test("import-time geocoding (spec step 2)", async (t) => {
  await t.test("an upload without coordinates locates its building, geo_source census", async () => {
    const { db, srv, census, stop } = await bootAll();
    try {
      const { status, body } = await upload(srv, CSV_NO_COORDS);
      assert.equal(status, 200);
      assert.equal(body.ok, true);

      assert.ok(await until(() => censusPatches(db).length > 0),
        "the fire-and-forget geocode never PATCHed the property");

      const patch = censusPatches(db)[0];
      // The guard IS the broker-wins rule: a PATCH without lat=is.null could
      // overwrite a coordinate the broker typed. Assert on the request, not
      // just the outcome, so a dropped guard fails even while the outcome
      // happens to look right.
      assert.ok(patch.query.includes("lat=is.null"),
        "the census PATCH must be guarded lat=is.null");
      assert.ok(patch.query.includes("user_id=eq.u1"),
        "every vault write is user-scoped");
      assert.equal(typeof bodyOf(patch).geocoded_at, "string");

      const prop = db.tables.broker_properties[0];
      assert.equal(prop.geo_source, "census");
      assert.equal(prop.lat, 43.615);
      assert.equal(prop.lng, -116.2023);
      assert.ok(census.hits.length >= 1, "the address went to our census stub");
      assert.deepEqual(db.unparsed, [],
        "every filter this sent must be one the fake understands");
    } finally { await stop(); }
  });

  await t.test("a census outage leaves the building unlocated and the upload untouched", async () => {
    const { db, srv, census, stop } = await bootAll({ censusStatus: 500 });
    try {
      const { status, body } = await upload(srv, CSV_NO_COORDS);
      // The broker's book is stored regardless — the geocode is an
      // enrichment, and an outage may not cost an upload.
      assert.equal(status, 200);
      assert.equal(body.ok, true);

      // Wait until the scheduled pass has provably run (it consulted the
      // stub), then a beat longer, then assert nothing was written.
      assert.ok(await until(() => census.hits.length >= 1),
        "the geocode pass never ran at all");
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(censusPatches(db).length, 0, "an outage must not write");
      assert.equal(db.tables.broker_properties[0].lat ?? null, null,
        "skip, never guess: no coordinate is better than a wrong one");
    } finally { await stop(); }
  });

  await t.test("a broker-located building is never touched by the census path", async () => {
    const { db, srv, census, stop } = await bootAll();
    try {
      const { status, body } = await upload(srv, CSV_WITH_COORDS);
      assert.equal(status, 200);
      assert.equal(body.ok, true);

      // The broker PATCH runs before the geocode is scheduled, so the
      // lat=is.null read excludes this building — the stub must never even
      // be consulted. Wait for the schedule's own read to have happened.
      assert.ok(await until(() => db.requests.some((r) =>
        r.method === "GET" && r.table === "broker_properties" &&
        r.query.includes("lat=is.null"))),
        "the scheduled geocode pass never ran its read");
      await new Promise((r) => setTimeout(r, 200));

      assert.equal(census.hits.length, 0,
        "a located building's address must never leave the process");
      assert.equal(censusPatches(db).length, 0);
      const prop = db.tables.broker_properties[0];
      assert.equal(prop.geo_source, "broker", "the broker's own value stands");
      assert.equal(prop.lat, 43.99);
      assert.deepEqual(db.unparsed, []);
    } finally { await stop(); }
  });
});
