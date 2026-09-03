const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

// Building-level facts, actually run (spec
// docs/superpowers/specs/2026-09-03-vault-building-facts-design.md; migration
// 050).
//
// test/building-facts.test.js proves the pure rules. This boots the real
// server against the fake PostgREST, uploads a real CSV the way the page
// does, and reads back what was actually derived, stitched and applied — and,
// just as importantly, what was NOT written: the stored deal rows must keep
// exactly what the broker stated, and the export must carry stated values
// only. The derivation is awaited inside the upload route, so no polling.

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

// The import-time geocode (017 step 2) fires on every upload; a census stub
// that finds nothing keeps that off the real Census and out of these tests.
function startCensus() {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ result: { addressMatches: [] } }));
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${srv.address().port}/onelineaddress`,
    stop: () => new Promise((r) => srv.close(r)),
  })));
}

async function bootAll() {
  const census = await startCensus();
  const db = await fake.start({ tables: baseTables() });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    CENSUS_API_URL: census.url,
  });
  return {
    db, srv,
    stop: async () => { srv.stop(); await db.stop(); await census.stop(); },
  };
}

const H = { "content-type": "application/json", cookie: `cn_session=${TOKEN}` };
function upload(srv, csv) {
  return fetch(srv.base + "/api/vault/upload", {
    method: "POST", headers: H, body: JSON.stringify({ filename: "book.csv", csv }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
}
function readVault(srv) {
  return fetch(srv.base + "/api/vault?limit=1000", { headers: H })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
}
const byPrice = (comps, price) => comps.find((c) => Number(c.price) === price);
const bodyOf = (r) => { try { return JSON.parse(r.body); } catch { return {}; } };

// One building, four deals. Two sales state the year built, one of them the
// clear height and the size; one sale states nothing about the building; one
// lease states its suite.
const ADDR = "\"1450 Mission Ave, Boise, ID\"";
const CSV =
  "address,property_type,transaction,deal_date,price,size_sqft,year_built,clear_height\n" +
  `${ADDR},Industrial,sale,2026-03-14,8400000,84000,1998,28 ft\n` +
  `${ADDR},Industrial,sale,2024-06-01,4200000,,1998,\n` +
  `${ADDR},Industrial,sale,2022-01-10,3000000,,,\n` +
  `${ADDR},Industrial,lease,2025-05-05,,4000,,\n`;

test("building-level facts (migration 050)", async (t) => {
  await t.test("an upload derives the building's facts and the vault read inherits them", async () => {
    const { db, srv, stop } = await bootAll();
    try {
      const up = await upload(srv, CSV);
      assert.equal(up.status, 200, JSON.stringify(up.body));
      assert.equal(up.body.imported, 4);

      // Derived and stored on the DIMENSION, scoped by user.
      const prop = db.tables.broker_properties[0];
      assert.ok(prop && prop.facts, "facts were never derived");
      assert.equal(prop.facts.values.year_built, "1998");
      assert.equal(prop.facts.values.clear_height, "28 ft");
      assert.equal(prop.facts.values.size_sqft, 84000, "size derives from sales only");
      assert.deepEqual(prop.facts.conflicts, {});
      const factPatches = db.requests.filter((r) =>
        r.method === "PATCH" && r.table === "broker_properties" && bodyOf(r).facts);
      assert.ok(factPatches.length >= 1);
      for (const p of factPatches) {
        assert.ok(p.query.includes("user_id=eq.u1"), "every facts write is user-scoped");
      }

      // The stored deal rows are UNTOUCHED: read-time only.
      const stored = db.tables.broker_comps;
      const bare = stored.find((c) => Number(c.price) === 3000000);
      assert.equal(bare.year_built ?? null, null);
      assert.equal(bare.size_sqft ?? null, null);
      assert.equal(bare.price_per_sqft ?? null, null);

      // The vault read applies them and says so.
      const v = await readVault(srv);
      assert.equal(v.status, 200);
      const comps = v.body.comps;
      assert.equal(comps.length, 4);

      const full = byPrice(comps, 8400000);
      assert.equal("inherited" in full, false, "a deal that states everything inherits nothing");

      const half = byPrice(comps, 4200000);
      assert.equal(half.year_built, "1998", "its own stated year");
      assert.equal(half.size_sqft, 84000);
      assert.equal(half.price_per_sqft, 50, "$/SF from ITS price and the inherited size");
      assert.deepEqual(half.inherited, ["size_sqft", "clear_height", "price_per_sqft"]);

      const blank = byPrice(comps, 3000000);
      assert.equal(blank.year_built, "1998");
      assert.equal(blank.clear_height, "28 ft");
      assert.equal(blank.size_sqft, 84000);
      assert.equal(blank.price_per_sqft, 35.71);
      assert.deepEqual(blank.inherited, ["year_built", "size_sqft", "clear_height", "price_per_sqft"]);

      const lease = comps.find((c) => c.transaction === "lease");
      assert.equal(lease.size_sqft, 4000, "a suite is not the building");
      assert.equal(lease.year_built, "1998");
      assert.deepEqual(lease.inherited, ["year_built", "clear_height"]);
      assert.equal(lease.price_per_sqft ?? null, null);

      // Every comp on the building carries the building's facts, which is
      // what lets the page prefill a known address without asking.
      for (const c of comps) assert.equal(c.facts.values.year_built, "1998");

      assert.deepEqual(db.unparsed, [],
        "every filter this sent must be one the fake understands");
    } finally { await stop(); }
  });

  await t.test("the export carries stated values only", async () => {
    const { srv, stop } = await bootAll();
    try {
      const up = await upload(srv, CSV);
      assert.equal(up.status, 200);
      const r = await fetch(srv.base + "/api/vault/export.csv", { headers: H });
      assert.equal(r.status, 200);
      const text = await r.text();
      // Two deals stated 1998; the two that inherit it on screen must not
      // export it, or export-then-reimport would turn a reading into a
      // statement.
      assert.equal((text.match(/1998/g) || []).length, 2, text);
      assert.equal((text.match(/28 ft/g) || []).length, 1, text);
    } finally { await stop(); }
  });

  await t.test("an edit that makes the deals disagree turns the fact into a conflict served to nobody", async () => {
    const { db, srv, stop } = await bootAll();
    try {
      const up = await upload(srv, CSV);
      assert.equal(up.status, 200);
      const first = db.tables.broker_comps.find((c) => Number(c.price) === 8400000);
      const e = await fetch(srv.base + "/api/vault/comp?id=" + encodeURIComponent(first.id), {
        method: "PATCH", headers: H, body: JSON.stringify({ year_built: "2004" }),
      });
      assert.equal(e.status, 200, await e.text());

      const prop = db.tables.broker_properties[0];
      assert.equal(prop.facts.values.year_built, undefined, "a quietly chosen winner is a guess");
      assert.deepEqual(prop.facts.conflicts.year_built, ["2004", "1998"]);

      const v = await readVault(srv);
      const blank = byPrice(v.body.comps, 3000000);
      assert.equal(blank.year_built ?? null, null, "a conflicted fact inherits onto nobody");
      assert.ok(!blank.inherited.includes("year_built"));
      // Everything the deals still agree on keeps flowing.
      assert.equal(blank.clear_height, "28 ft");
      assert.deepEqual(db.unparsed, []);
    } finally { await stop(); }
  });

  await t.test("a book from before 050 derives on its first vault read", async () => {
    const { db, srv, stop } = await bootAll();
    try {
      const up = await upload(srv, CSV);
      assert.equal(up.status, 200);
      // Simulate a pre-050 dimension row: facts never derived.
      db.tables.broker_properties[0].facts = null;
      const v1 = await readVault(srv);
      assert.equal(v1.status, 200);
      // The backfill is fire-and-forget off the read; wait for it.
      const t0 = Date.now();
      while (Date.now() - t0 < 4000 && !db.tables.broker_properties[0].facts) {
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.ok(db.tables.broker_properties[0].facts, "the read-time backfill never derived");
      const v2 = await readVault(srv);
      assert.equal(byPrice(v2.body.comps, 3000000).year_built, "1998");
    } finally { await stop(); }
  });

  await t.test("/building-facts.js is served uncached, like /gut-check.js", async () => {
    const { srv, stop } = await bootAll();
    try {
      const r = await fetch(srv.base + "/building-facts.js");
      assert.equal(r.status, 200);
      assert.match(r.headers.get("cache-control") || "", /max-age=0/);
      assert.match(await r.text(), /root\.BFACTS = api/);
    } finally { await stop(); }
  });
});
