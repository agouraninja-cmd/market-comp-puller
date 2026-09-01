// Recent searches, and the rule they exist to enforce: a portfolio holds the
// properties a member says they OWN.
//
// WHY THIS EXISTS. Until 2026-08-31 every signed-in search auto-saved itself
// into portfolio_items, so a desk headed "Your properties" was really a log of
// everything the account had ever looked up — a broker who priced fifty
// prospects owned a portfolio of fifty buildings they had never bought. A
// search lands in recent_searches now (migration 043) and the member adds what
// is theirs.
//
// The half worth testing at the route level is the NEGATIVE one: that nothing
// on this path writes to the desk. A regression there is invisible — a desk
// with too much on it looks like a busy desk — so it is asserted directly,
// table by table, rather than inferred from a response body.
//
// NOTHING HERE REACHES A REAL VENDOR: the fake PostgREST answers every read
// and write, and no search is ever run.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const PAT = { id: "11111111-1111-4111-8111-111111111111", email: "pat@brokerage.com", name: "Pat" };
const SAM = { id: "22222222-2222-4222-8222-222222222222", email: "sam@other.com", name: "Sam" };
const ADDR = "1201 W Idaho St, Boise, ID 83702";

// A report shaped the way index.html stores one. Only the fields the route
// validates and the tests read need to be real.
const report = () => ({
  comps: [{ address: "500 Elm St, Boise, ID", price: 1000000, size_sqft: 10000 }],
  summary: "A market.",
});
const payload = (address, over) => ({
  meta: Object.assign(
    { address, type: "Industrial", months: 24, txFocus: "both", subject: null },
    over || {},
  ),
  data: report(),
});

async function bootAll() {
  const tables = {
    users: [
      Object.assign({}, PAT, { pro_tester: false, vault_beta: false }),
      Object.assign({}, SAM, { pro_tester: false, vault_beta: false }),
    ],
    sessions: [
      { token_hash: sha256("tok-" + PAT.id), user_id: PAT.id, expires_at: YEAR_OUT },
      { token_hash: sha256("tok-" + SAM.id), user_id: SAM.id, expires_at: YEAR_OUT },
    ],
    subscriptions: [{
      user_id: PAT.id, plan: "pro_monthly", status: "active",
      current_period_end: YEAR_OUT, cancel_at_period_end: false,
    }],
    recent_searches: [], portfolio_items: [], analytics_events: [], market_pages: [],
  };
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
    ANTHROPIC_API_KEY: "test-key-not-a-real-one",
  });
  return { db, srv, tables, stop: async () => { srv.stop(); await db.stop(); } };
}

const as = (who, init) => Object.assign({}, init || {}, {
  headers: Object.assign(
    { "content-type": "application/json", cookie: "cn_session=tok-" + who.id },
    (init && init.headers) || {},
  ),
});

const mine = (tables, who) => tables.recent_searches.filter((x) => x.user_id === who.id);

test("a search is filed under recent searches and never on the desk", async (t) => {
  const ctx = await bootAll();
  t.after(() => ctx.stop());
  const srv = ctx.srv;
  const tables = ctx.tables;

  await t.test("anonymous is refused before anything is read", async () => {
    for (const method of ["GET", "POST", "DELETE"]) {
      const r = await fetch(srv.base + "/api/recents", {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? JSON.stringify({ payload: payload("1 A St") }) : undefined,
      });
      assert.equal(r.status, 401, method + " must require a session");
    }
    assert.equal(tables.recent_searches.length, 0);
  });

  await t.test("a POST stores the report and the desk stays empty", async () => {
    const r = await fetch(srv.base + "/api/recents", as(PAT, {
      method: "POST",
      body: JSON.stringify({ payload: payload(ADDR) }),
    }));
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.ok(body.id, "the row id comes back so it can be added to the portfolio later");

    assert.equal(tables.recent_searches.length, 1);
    const row = tables.recent_searches[0];
    assert.equal(row.user_id, PAT.id);
    assert.equal(row.address, ADDR);
    assert.equal(row.property_type, "Industrial");
    assert.ok(Array.isArray(row.payload.data.comps), "the whole report, so it reopens for free");

    // THE assertion this file exists for.
    assert.equal(tables.portfolio_items.length, 0,
      "a search must never put a property on the desk unasked");
  });

  await t.test("the same property twice is one row, re-valued", async () => {
    await fetch(srv.base + "/api/recents", as(PAT, {
      method: "POST",
      body: JSON.stringify({ payload: payload(ADDR, { months: 36 }) }),
    }));
    assert.equal(tables.recent_searches.length, 1, "upserted, not duplicated");
    assert.equal(tables.recent_searches[0].payload.meta.months, 36, "and it holds the newer run");
  });

  await t.test("a report with no address, type or comps is refused", async () => {
    const bad = [
      { payload: { meta: { type: "Industrial" }, data: report() } },
      { payload: { meta: { address: "1 A St", type: "" }, data: report() } },
      { payload: { meta: { address: "1 A St", type: "Industrial" }, data: { summary: "x" } } },
      {},
    ];
    for (const b of bad) {
      const r = await fetch(srv.base + "/api/recents", as(PAT, {
        method: "POST", body: JSON.stringify(b),
      }));
      assert.equal(r.status, 400, JSON.stringify(b));
    }
    assert.equal(tables.recent_searches.length, 1, "and nothing was written");
  });

  await t.test("the list is scoped to its owner", async () => {
    await fetch(srv.base + "/api/recents", as(SAM, {
      method: "POST", body: JSON.stringify({ payload: payload("900 Other Rd, Meridian, ID") }),
    }));
    const list = await (await fetch(srv.base + "/api/recents", as(PAT))).json();
    assert.equal(list.items.length, 1, "Pat sees only what Pat ran");
    assert.equal(list.items[0].address, ADDR);
  });

  // The list is a summary: reports are fetched one at a time, so opening a
  // desk never drags every stored report down the wire.
  //
  // Asserted against the SOURCE rather than the wire, and the reason is worth
  // knowing before someone "fixes" it: the fake PostgREST treats `select` as a
  // non-filter and returns whole rows, so a wire assertion here would be
  // testing the fake. Real PostgREST honours it. The file-fallback branch does
  // the same job in JS and is checked the same way.
  await t.test("the list read asks for columns, not reports", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const cols = src.match(/const RECENT_LIST_COLUMNS = "([^"]+)"/);
    assert.ok(cols, "RECENT_LIST_COLUMNS must exist");
    assert.ok(!cols[1].split(",").includes("payload"),
      "the list must not select payload, or every desk load ships every report");
    assert.match(src, /recent_searches\?user_id=eq\.\$\{encodeURIComponent\(userId\)\}` \+\s*\n\s*`&select=\$\{RECENT_LIST_COLUMNS\}/,
      "listRecents must actually use it");
    assert.match(src, /\.map\(\(\{ payload, \.\.\.rest \}\) => rest\)/,
      "and the file fallback must strip the payload the same way");
  });

  await t.test("one row comes back whole, and only to its owner", async () => {
    const id = mine(tables, PAT)[0].id;
    const ok = await fetch(srv.base + "/api/recents?id=" + id, as(PAT));
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).payload.data.comps.length, "with its report, so Open is free");

    const nope = await fetch(srv.base + "/api/recents?id=" + id, as(SAM));
    assert.equal(nope.status, 404, "another member gets 404, never somebody else's building");
  });

  await t.test("adding one to the portfolio is a separate, deliberate act", async () => {
    const row = mine(tables, PAT)[0];
    const r = await fetch(srv.base + "/api/portfolio", as(PAT, {
      method: "POST",
      body: JSON.stringify({ payload: row.payload, snapshot: null }),
    }));
    assert.equal(r.status, 200, "the ordinary portfolio route, unchanged");
    assert.equal(tables.portfolio_items.length, 1);
    assert.equal(tables.portfolio_items[0].address, ADDR);
    // The recent stays put: it records the search, it is not a staging area.
    assert.ok(mine(tables, PAT).some((x) => x.id === row.id),
      "adding a property does not consume the search that found it");
  });

  await t.test("delete removes one, and a bare DELETE clears the list", async () => {
    const before = mine(tables, PAT).length;
    assert.ok(before >= 1);
    const id = mine(tables, PAT)[0].id;

    const one = await fetch(srv.base + "/api/recents?id=" + id, as(PAT, { method: "DELETE" }));
    assert.equal(one.status, 200);
    assert.equal(mine(tables, PAT).length, before - 1);

    await fetch(srv.base + "/api/recents", as(PAT, { method: "DELETE" }));
    assert.equal(mine(tables, PAT).length, 0);
    assert.equal(mine(tables, SAM).length, 1,
      "clearing my list must not touch anybody else's");
    // Clearing searches is not clearing the desk.
    assert.equal(tables.portfolio_items.length, 1,
      "the portfolio survives: those are properties the member said they own");
  });
});
