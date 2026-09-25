// The free report allowance (2026-09-25), against a real server, a stand-in
// database and a stub search provider.
//
// Run: npm test   (node --test, no dependencies, no network)
//
// entitlements.test.js proves the RULE. This proves the parts only a running
// server can: that the fourth distinct report is refused BEFORE anything is
// searched, that a re-run of a counted report goes through free, that a report
// is spent only once it is served, that the count rides home on each report,
// and that the tally lives apart from the download tally in the same table.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const FREE = { id: "22222222-2222-4222-8222-222222222222", email: "owner@example.com", name: "Owner" };
const PRO = { id: "33333333-3333-4333-8333-333333333333", email: "broker@example.com", name: "Broker" };

function report() {
  const sale = (n, price, size, date) => ({
    address: `${n} Warehouse Way, Boise, ID 83702`, date, transaction: "Sale",
    size_sqft: String(size), price_or_rate: `$${price.toLocaleString("en-US")}`,
    source_type: "public_record", source_url: "https://www.loopnet.com/Listing/example",
    notes: "Arms-length sale.",
  });
  return {
    summary: "Industrial sales have been steady.", value_drivers: ["Vacancy is tight."],
    market_trend: "Prices up modestly.", market_cap_rate_range: "6.0% - 6.75%",
    annual_price_trend_pct: 3, subject_size_sqft: "20000", subject_size_source: "county records",
    subject_lat: 43.6150, subject_lng: -116.2023,
    comps: [sale(100, 1900000, 20000, "2026-05-10"), sale(200, 2050000, 20500, "2026-03-02")],
  };
}

async function startStubProvider() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      calls.push(body.length);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        stop_reason: "end_turn",
        usage: { input_tokens: 1000, output_tokens: 500 },
        content: [{ type: "text", text: JSON.stringify(report()) }],
      }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://localhost:${server.address().port}/v1/messages`, calls, stop: () => new Promise((r) => server.close(r)) };
}

async function bootAll(extraEnv = {}) {
  const tables = {
    users: [FREE, PRO].map((u) => ({ ...u, pro_tester: false, vault_beta: false, created_at: "2025-01-01T00:00:00Z" })),
    sessions: [FREE, PRO].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
    subscriptions: [{ user_id: PRO.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false }],
    export_usage: [], portfolio_items: [], recent_searches: [], comp_corpus: [], search_cache: [],
    analytics_events: [], comp_submissions: [], subject_sizes: [], market_pages: [],
  };
  const db = await fake.start({ tables });
  const stub = await startStubProvider();
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key", SITE_URL: "https://compninja.co",
    SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-a-real-one",
    STREAM_ANTHROPIC: "off", SEARCH_API_URL: stub.url,
    ...extraEnv,
  });
  return { db, srv, stub, tables, stop: async () => { srv.stop(); await stub.stop(); await db.stop(); } };
}

const run = (srv, who, address) => fetch(srv.base + "/api/comps", {
  method: "POST",
  headers: { "content-type": "application/json", cookie: `cn_session=tok-${who.id}` },
  body: JSON.stringify({ address, type: "Industrial", months: 24 }),
});

test("a free account runs three reports a month, then is asked to upgrade", async (t) => {
  const env = await bootAll();
  t.after(() => env.stop());
  const { srv, stub, tables } = env;

  const cfg = await (await fetch(srv.base + "/api/config", { headers: { cookie: `cn_session=tok-${FREE.id}` } })).json();
  assert.equal(cfg.pro.reportsRemaining, 3, "the form can say how many are left before the first report");
  assert.equal(cfg.pro.freeReportsPerMonth, 3);

  const left = [];
  for (const addr of ["1 Main St, Boise, ID", "2 Main St, Boise, ID", "3 Main St, Boise, ID"]) {
    const r = await run(srv, FREE, addr);
    assert.equal(r.status, 200, `report for ${addr} should be served`);
    left.push((await r.json()).reports_remaining);
  }
  assert.deepEqual(left, [2, 1, 0], "each served report says what is left after it");

  const searchesBefore = stub.calls.length;
  const fourth = await run(srv, FREE, "4 Main St, Boise, ID");
  assert.equal(fourth.status, 403, "the fourth distinct report is refused");
  const body = await fourth.json();
  assert.equal(body.code, "report_limit");
  assert.equal(body.upgrade, true);
  assert.match(body.error, /3 free reports this month/);
  assert.equal(stub.calls.length, searchesBefore, "refused BEFORE anything was searched or billed");

  // A re-run of a report already counted this month is free.
  const again = await run(srv, FREE, "2 Main St, Boise, ID");
  assert.equal(again.status, 200, "re-running a counted report is not a new report");
  assert.equal((await again.json()).reports_remaining, 0);

  // The tally sits in its own key space: three report rows, no export rows.
  const periods = tables.export_usage.filter((r) => r.user_id === FREE.id).map((r) => r.period);
  assert.equal(periods.length, 3, "one row per distinct report, the re-run adding none");
  assert.ok(periods.every((p) => /^reports-\d{4}-\d{2}$/.test(p)), "report rows never share the download period");
  const cfg2 = await (await fetch(srv.base + "/api/config", { headers: { cookie: `cn_session=tok-${FREE.id}` } })).json();
  assert.equal(cfg2.pro.exportsRemaining, 5, "running reports must not spend downloads");
  assert.equal(cfg2.pro.reportsRemaining, 0);
});

test("Pro has no report allowance and leaves no tally", async (t) => {
  const env = await bootAll();
  t.after(() => env.stop());
  for (const addr of ["1 A St, Boise, ID", "2 A St, Boise, ID", "3 A St, Boise, ID", "4 A St, Boise, ID"]) {
    const r = await run(env.srv, PRO, addr);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).reports_remaining, undefined, "a paying account is never told a count");
  }
  assert.equal(env.tables.export_usage.filter((r) => r.user_id === PRO.id).length, 0);
});

test("FREE_REPORTS_PER_MONTH=off lifts the cap", async (t) => {
  const env = await bootAll({ FREE_REPORTS_PER_MONTH: "off" });
  t.after(() => env.stop());
  for (const addr of ["1 B St, Boise, ID", "2 B St, Boise, ID", "3 B St, Boise, ID", "4 B St, Boise, ID"]) {
    const r = await run(env.srv, FREE, addr);
    assert.equal(r.status, 200, "no cap, no refusal");
  }
  const cfg = await (await fetch(env.srv.base + "/api/config", { headers: { cookie: `cn_session=tok-${FREE.id}` } })).json();
  assert.equal(cfg.pro.reportsRemaining, "unlimited");
});

test("the free allowance is stated on /pricing and /faq from the same setting", async (t) => {
  const env = await bootAll({ FREE_REPORTS_PER_MONTH: "5" });
  t.after(() => env.stop());
  const pricing = await (await fetch(env.srv.base + "/pricing")).text();
  const faq = await (await fetch(env.srv.base + "/faq")).text();
  assert.match(pricing, /Five reports a month/, "the Free tile reads the configured cap");
  assert.match(faq, /runs 5 full reports a month/, "the FAQ answer reads the configured cap");
});
