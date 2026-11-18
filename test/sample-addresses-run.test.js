// GET /api/sample-addresses against a real server.js and the stand-in
// database. The owner's rule (2026-11-18): the comp-report box's samples are
// real buildings in the member's area that NOBODY has searched yet, so that
// every sample run is a fresh search and fresh comps. What is proved here:
// the member's own markets decide where to look; a building in search_cache,
// however old and as whatever type, is never offered; with no area the list
// is nationwide and says so; and the gate is the Explorer's.
//
// NOTHING HERE REACHES A REAL VENDOR: the fake PostgREST answers every read,
// and no search is ever run.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const LONG_AGO = "2025-01-01T00:00:00.000Z";
const PAT = { id: "11111111-1111-4111-8111-111111111111", email: "pat@brokerage.com", name: "Pat" };
const NEW = { id: "33333333-3333-4333-8333-333333333333", email: "new@brokerage.com", name: "New" };
const SAM = { id: "22222222-2222-4222-8222-222222222222", email: "sam@other.com", name: "Sam" };

const corpus = (address, market, property_type, i) => ({
  address, market, property_type, ts: `2026-11-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
});
// The search cache's own address normalization (cacheAddressKey in server.js).
const key = (a) => a.trim().toLowerCase().replace(/\./g, "").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ");

async function bootAll() {
  const pro = (who) => ({
    user_id: who.id, plan: "pro_monthly", status: "active",
    current_period_end: YEAR_OUT, cancel_at_period_end: false,
  });
  const tables = {
    users: [PAT, NEW, SAM].map((u) => Object.assign({}, u, { pro_tester: false, vault_beta: false })),
    sessions: [PAT, NEW, SAM].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
    subscriptions: [pro(PAT), pro(NEW)],
    // Pat has searched in Boise; that is Pat's area.
    recent_searches: [{
      id: "r1", user_id: PAT.id, address: "1201 W Idaho St, Boise, ID 83702", property_type: "Industrial",
      verified_key: null, created_at: LONG_AGO, updated_at: LONG_AGO,
    }],
    portfolio_items: [], watchlist_items: [], analytics_events: [], market_pages: [],
    comp_corpus: [
      corpus("100 Main St, Boise, ID", "Boise, ID", "Industrial", 1),
      corpus("200 Main St, Boise, ID", "Boise, ID", "Industrial", 2),
      corpus("300 Main St, Boise, ID", "Boise, ID", "Industrial", 3),
      corpus("400 Main St, Boise, ID", "Boise, ID", "Industrial", 4),
      corpus("500 Main St, Meridian, ID", "Meridian, ID", "Industrial", 5),
      corpus("600 Elm St, Boise, ID", "Boise, ID", "Office", 6),
      corpus("700 Commerce St, Dallas, TX", "Dallas, TX", "Industrial", 7),
    ],
    search_cache: [
      // Searched over a year ago as Industrial: still not "never looked up".
      { cache_key: "a", address_key: key("100 Main St, Boise, ID"), prop_type: "Industrial", created_at: LONG_AGO, payload: {} },
      // Searched as OFFICE: a building somebody looked up is looked up.
      { cache_key: "b", address_key: key("200 Main St, Boise, ID"), prop_type: "Office", created_at: LONG_AGO, payload: {} },
    ],
  };
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    PRO_TRIAL_DAYS: "0",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
    ANTHROPIC_API_KEY: "test-key-not-a-real-one",
  });
  return { db, srv, tables, stop: async () => { srv.stop(); await db.stop(); } };
}

const as = (who) => ({ headers: { cookie: "cn_session=tok-" + who.id } });

test("sample addresses: unsearched buildings in the member's area", async (t) => {
  const ctx = await bootAll();
  t.after(ctx.stop);
  const get = (path, who) => fetch(ctx.srv.base + path, who ? as(who) : undefined);

  await t.test("signed out is refused", async () => {
    const r = await get("/api/sample-addresses?type=Industrial");
    assert.strictEqual(r.status, 401);
  });

  await t.test("a plan without the Address Explorer is refused, as the Explorer is", async () => {
    const r = await get("/api/sample-addresses?type=Industrial", SAM);
    assert.strictEqual(r.status, 403);
  });

  await t.test("an unknown type is refused by name", async () => {
    const r = await get("/api/sample-addresses?type=Spaceship", PAT);
    assert.strictEqual(r.status, 400);
  });

  await t.test("the member's area, minus everything ever searched", async () => {
    const r = await get("/api/sample-addresses?type=Industrial&count=3", PAT);
    assert.strictEqual(r.status, 200);
    const d = await r.json();
    assert.strictEqual(d.area, "Boise, ID");
    const got = d.addresses.map((a) => a.address).sort();
    // 100 and 200 Main were searched (an old Industrial search, an Office
    // one); Meridian is Boise's metro sibling; Dallas is someone else's area
    // and Pat's area alone fills the list.
    assert.deepStrictEqual(got, ["300 Main St, Boise, ID", "400 Main St, Boise, ID", "500 Main St, Meridian, ID"]);
    for (const a of d.addresses) assert.strictEqual(a.type, "Industrial");
    // Addresses only: never a price, a date or the member's own search.
    assert.deepStrictEqual(Object.keys(d.addresses[0]).sort(), ["address", "market", "type"]);
    assert.ok(!JSON.stringify(d).includes("1201 W Idaho"), "the member's own search is never echoed");
  });

  await t.test("too few in the area tops up nationwide", async () => {
    const r = await get("/api/sample-addresses?type=Industrial&count=4", PAT);
    const d = await r.json();
    const got = d.addresses.map((a) => a.address);
    assert.strictEqual(got.length, 4);
    assert.ok(got.includes("700 Commerce St, Dallas, TX"));
    assert.ok(!got.includes("100 Main St, Boise, ID") && !got.includes("200 Main St, Boise, ID"));
  });

  await t.test("no area at all is nationwide, and says so", async () => {
    const r = await get("/api/sample-addresses?type=Industrial&count=8", NEW);
    const d = await r.json();
    assert.strictEqual(d.area, "");
    const got = d.addresses.map((a) => a.address).sort();
    assert.deepStrictEqual(got, [
      "300 Main St, Boise, ID", "400 Main St, Boise, ID",
      "500 Main St, Meridian, ID", "700 Commerce St, Dallas, TX",
    ]);
  });

  await t.test("without a type, each sample carries its own", async () => {
    const r = await get("/api/sample-addresses?count=8", NEW);
    const d = await r.json();
    const office = d.addresses.find((a) => a.address === "600 Elm St, Boise, ID");
    assert.ok(office, "the office building is offered");
    assert.strictEqual(office.type, "Office");
  });

  await t.test("it reads the public corpus and the cache, and writes nothing", async () => {
    const tablesRead = new Set(ctx.db.requests.map((q) => q.table));
    for (const vault of ["broker_comps", "org_comps"]) {
      assert.ok(!tablesRead.has(vault), `${vault} must never feed a sample`);
    }
    const writes = ctx.db.requests.filter((q) =>
      q.method !== "GET" && ["comp_corpus", "search_cache", "recent_searches", "portfolio_items", "watchlist_items"].includes(q.table));
    assert.deepStrictEqual(writes, []);
  });
});
