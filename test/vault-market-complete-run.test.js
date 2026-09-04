const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

// Suggesting a "City, ST" for a file's bare addresses, actually run
// (2026-09-02). test/vault-market-complete.test.js proves the pure rules;
// this boots the real server against the fake PostgREST and a census-shaped
// stub on CENSUS_API_URL (test/vault-geocode-run.test.js's precedent) and
// proves the parts a module test cannot reach: that the candidates come from
// THIS broker's vault and coverage and nobody else's, that `completeWith` is
// canonicalized by the route and applied inside parseUpload, and that the
// confirmation check sends a completed address to our own Census call and
// nowhere else, writing nothing.

const DAY = 86400000;
const TOKEN = "test-session-token";
const TOKEN_HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");

function baseTables() {
  return {
    users: [
      { id: "u1", email: "broker@example.com", vault_beta: true },
      { id: "u2", email: "other@example.com", vault_beta: true },
    ],
    sessions: [
      { id: "s1", user_id: "u1", token_hash: TOKEN_HASH,
        expires_at: new Date(Date.now() + 30 * DAY).toISOString() },
    ],
    broker_comps: [
      { id: "c1", user_id: "u1", market: "Boise, ID", address: "9 Old Rd, Boise, ID" },
      { id: "c2", user_id: "u1", market: "Boise, ID", address: "10 Old Rd, Boise, ID" },
      // Another broker's book: their market must never be offered here.
      { id: "c3", user_id: "u2", market: "Caldwell, ID", address: "1 Elsewhere, Caldwell, ID" },
    ],
    broker_coverage: [
      { id: "cv1", user_id: "u1", market: "Nampa, ID", property_type: "Industrial" },
      { id: "cv2", user_id: "u2", market: "Twin Falls, ID", property_type: "Industrial" },
    ],
    broker_uploads: [],
    broker_properties: [],
    broker_csv_mappings: [],
    broker_profiles: [
      { id: "p1", user_id: "u1", email: "broker@example.com",
        display_name: "", company: "Test & Co", public: false },
    ],
  };
}

function startCensus({ status = 200 } = {}) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(decodeURIComponent(req.url));
    if (status !== 200) { res.writeHead(status); return res.end("outage"); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ result: { addressMatches: [
      { coordinates: { x: -116.2, y: 43.6 }, matchedAddress: "MATCH" },
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

function post(srv, route, body) {
  return fetch(srv.base + route, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `cn_session=${TOKEN}` },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

const HEAD = "address,property_type,transaction,deal_date,price,size_sqft";
const MIXED =
  HEAD + "\n" +
  "\"805 S Progress Ave, Meridian, ID\",Industrial,sale,2026-03-14,4250000,31000\n" +
  "6200 W Gowen Rd,Industrial,sale,2026-02-01,1200000,24500\n";
const BARE = HEAD + "\n6200 W Gowen Rd,Industrial,sale,2026-02-01,1200000,24500\n";

test("suggested market completion, end to end", async (t) => {
  await t.test("inspect names the bare rows and ranks this broker's own markets", async () => {
    const { db, srv, stop } = await bootAll();
    try {
      const { status, body } = await post(srv, "/api/vault/inspect", { csv: MIXED });
      assert.equal(status, 200);
      const s = body.marketSuggest;
      assert.equal(s.count, 1);
      assert.deepEqual(s.sample, [{ line: 3, address: "6200 W Gowen Rd" }]);
      assert.deepEqual(s.candidates.map((c) => [c.market, c.source]), [
        ["Meridian, ID", "file"],
        ["Boise, ID", "vault"],
        ["Nampa, ID", "coverage"],
      ]);
      const offered = s.candidates.map((c) => c.market);
      assert.ok(!offered.includes("Caldwell, ID") && !offered.includes("Twin Falls, ID"),
        "another broker's markets must never be offered");
      const reads = db.requests.filter((r) => r.method === "GET" &&
        (r.table === "broker_comps" || r.table === "broker_coverage"));
      assert.ok(reads.length >= 2 && reads.every((r) => r.query.includes("user_id=eq.u1")),
        "both market reads are user-scoped");
      assert.deepEqual(db.unparsed, []);
    } finally { await stop(); }
  });

  await t.test("mapping City and State columns makes the question disappear", async () => {
    const { db, srv, stop } = await bootAll();
    try {
      const csv = "Street,Town,ST,Type,Deal,Date\n6200 W Gowen Rd,Boise,ID,Industrial,sale,2026-02-01\n";
      const mapping = { street: "address", town: "address_city", st: "address_state" };
      const { status, body } = await post(srv, "/api/vault/inspect", { csv, mapping });
      assert.equal(status, 200);
      assert.equal(body.marketSuggest.count, 0);
      assert.deepEqual(body.marketSuggest.candidates, []);
      // Nothing incomplete: the two market reads are not even paid.
      assert.equal(db.requests.filter((r) => r.table === "broker_coverage").length, 0);
    } finally { await stop(); }
  });

  await t.test("upload with completeWith files the bare row under the canonical market", async () => {
    const { db, srv, stop } = await bootAll();
    try {
      const { status, body } = await post(srv, "/api/vault/upload",
        { filename: "book.csv", csv: BARE, completeWith: "boise, id" });
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(body.imported, 1);
      assert.equal(body.completed, 1);
      assert.equal(body.completedAs, "Boise, ID");
      const stored = db.tables.broker_comps.find((c) => c.user_id === "u1" && c.upload_id);
      assert.equal(stored.address, "6200 W Gowen Rd, Boise, ID");
      assert.equal(stored.market, "Boise, ID");
    } finally { await stop(); }
  });

  await t.test("a completeWith that is not a market is refused before any row is read", async () => {
    const { db, srv, stop } = await bootAll();
    try {
      const { status, body } = await post(srv, "/api/vault/upload",
        { filename: "book.csv", csv: BARE, completeWith: "Boise" });
      assert.equal(status, 400);
      assert.match(body.error, /City, ST/);
      assert.equal(db.tables.broker_uploads.length, 0, "nothing was written");
    } finally { await stop(); }
  });

  await t.test("the confirm-table rows door ignores completeWith", async () => {
    const { srv, stop } = await bootAll();
    try {
      const rows = [{ address: "6200 W Gowen Rd", property_type: "Industrial", transaction: "sale",
                      deal_date: "2026-02-01", price: "1200000" }];
      const { status, body } = await post(srv, "/api/vault/upload",
        { filename: "sheet.pdf", rows, completeWith: "Boise, ID" });
      // The row arrives bare and stays bare: the page completes confirm-table
      // rows in the cells themselves, so the whole-file answer does not apply.
      assert.equal(status, 400);
      assert.match(body.error, /needs a city and state/);
    } finally { await stop(); }
  });

  await t.test("confirm-market checks the COMPLETED addresses against our own census call", async () => {
    const { db, srv, census, stop } = await bootAll();
    try {
      const before = db.requests.length;
      const { status, body } = await post(srv, "/api/vault/confirm-market",
        { market: "boise, id", addresses: ["6200 W Gowen Rd", "3155 E Copper Point Dr"] });
      assert.equal(status, 200);
      assert.equal(body.market, "Boise, ID");
      assert.equal(body.checked, 2);
      assert.equal(body.confirmed, 2);
      assert.deepEqual(body.results.map((r) => r.address),
        ["6200 W Gowen Rd, Boise, ID", "3155 E Copper Point Dr, Boise, ID"]);
      assert.equal(census.hits.length, 2);
      assert.ok(census.hits.every((h) => h.includes("Boise, ID")),
        "only the completed string leaves the process");
      const writes = db.requests.slice(before).filter((r) => r.method !== "GET");
      assert.deepEqual(writes, [], "confirming writes nothing");
    } finally { await stop(); }
  });

  await t.test("a census outage reads as unconfirmed, never as an error", async () => {
    const { srv, stop } = await bootAll({ censusStatus: 500 });
    try {
      const { status, body } = await post(srv, "/api/vault/confirm-market",
        { market: "Boise, ID", addresses: ["6200 W Gowen Rd"] });
      assert.equal(status, 200);
      assert.equal(body.checked, 1);
      assert.equal(body.confirmed, 0);
    } finally { await stop(); }
  });

  await t.test("confirm-market caps at ten addresses and refuses a non-market", async () => {
    const { srv, census, stop } = await bootAll();
    try {
      const many = Array.from({ length: 11 }, (_, i) => `${i + 1} Main St`);
      const ok = await post(srv, "/api/vault/confirm-market", { market: "Boise, ID", addresses: many });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.checked, 10);
      assert.equal(census.hits.length, 10);
      const bad = await post(srv, "/api/vault/confirm-market", { market: "Boise", addresses: ["1 Main St"] });
      assert.equal(bad.status, 400);
      assert.equal(census.hits.length, 10, "a refused market sends nothing anywhere");
    } finally { await stop(); }
  });
});

// The extract route must hand classifyExtractRows the same predicate the
// upload route hands parseUpload — otherwise a photographed sheet's bare
// street shows as ready on the confirm table and fails only after Import,
// which is the exact gap this feature closes. A source scan, because the
// route's other half is a vendor call the suite cannot make.
test("the extract route injects hasMarket into classifyExtractRows", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(src, /VAULT\.classifyExtractRows\(parsed\.rows,\s*\{\s*hasMarket:\s*addressHasMarket\s*\}\)/);
  assert.ok(!/classifyExtractRows\(parsed\.rows\)/.test(src), "no bare call remains");
});
