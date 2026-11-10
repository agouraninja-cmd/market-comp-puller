// The monthly search allowance (2026-11-10), against a real server, a stand-in
// database and a stub search provider.
//
// Run: npm test   (node --test, no dependencies, no network)
//
// The owner's rule: "400 searches per month then 10 cents a search after". It
// replaced bulk's 50-per-run and 200-per-day caps. entitlements.test.js proves
// the RULE and bulk-routes.test.js proves the list form; this proves the parts
// only a running server can, on the single-report path:
//   - a billed search is counted, and a cached one is not;
//   - an account with nothing to charge is refused at the allowance, in plain
//     JSON, BEFORE anything is searched, while a report it already ran still
//     opens from cache;
//   - a trial is told what a paid plan does about it, and a comped account is
//     not sold anything;
//   - a paying subscriber is never stopped, and the owner's ledger shows what
//     the searches past the allowance come to;
//   - a free account is not metered by this rule at all.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const ENT = require("../entitlements");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const PERIOD = ENT.searchUsagePeriod(Date.now());
const INCLUDED = ENT.PRO_SEARCHES_PER_MONTH;

const FREE = { id: "22222222-2222-4222-8222-222222222222", email: "owner@example.com", name: "Owner" };
const PRO = { id: "33333333-3333-4333-8333-333333333333", email: "broker@example.com", name: "Broker" };
const TESS = { id: "77777777-7777-4777-8777-777777777777", email: "tess@example.com", name: "Tess" };
const NEW = { id: "88888888-8888-4888-8888-888888888888", email: "new@example.com", name: "Newcomer" };

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

const searched = (n, user, period = PERIOD) => Array.from({ length: n }, (_, i) => ({
  user_id: user.id, period, report_key: `seed-${String(i).padStart(5, "0")}`,
  created_at: new Date().toISOString(),
}));

async function bootAll({ usage = [], env = {} } = {}) {
  const old = "2025-01-01T00:00:00Z";
  const tables = {
    users: [
      { ...FREE, pro_tester: false, vault_beta: false, created_at: old },
      { ...PRO, pro_tester: false, vault_beta: false, created_at: old },
      { ...TESS, pro_tester: true, vault_beta: false, created_at: old },
      // Created now, so with PRO_TRIAL_DAYS on this account is inside its trial.
      { ...NEW, pro_tester: false, vault_beta: false, created_at: new Date().toISOString() },
    ],
    sessions: [FREE, PRO, TESS, NEW].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
    subscriptions: [{ user_id: PRO.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false }],
    export_usage: usage.slice(), portfolio_items: [], recent_searches: [], comp_corpus: [], search_cache: [],
    analytics_events: [], comp_submissions: [], subject_sizes: [], market_pages: [],
  };
  const db = await fake.start({ tables });
  const stub = await startStubProvider();
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key", SITE_URL: "https://compninja.co",
    SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-a-real-one",
    STREAM_ANTHROPIC: "off", SEARCH_API_URL: stub.url,
    ...env,
  });
  return { db, srv, stub, tables, stop: async () => { srv.stop(); await stub.stop(); await db.stop(); } };
}

const run = (srv, who, address) => fetch(srv.base + "/api/comps", {
  method: "POST",
  headers: { "content-type": "application/json", cookie: `cn_session=tok-${who.id}` },
  body: JSON.stringify({ address, type: "Industrial", months: 24 }),
});
const rowsFor = (tables, who) => tables.export_usage.filter((r) => r.user_id === who.id && r.period === PERIOD);

test("a billed search is counted against the month, and a cached one is not", async (t) => {
  const env = await bootAll();
  t.after(() => env.stop());
  const { srv, stub, tables } = env;

  assert.equal((await run(srv, PRO, "1 A St, Boise, ID")).status, 200);
  assert.equal((await run(srv, PRO, "2 A St, Boise, ID")).status, 200);
  assert.equal(stub.calls.length, 2);
  assert.equal(rowsFor(tables, PRO).length, 2, "one row per billed search");

  // The same address again is served from cache: no provider call, no row.
  assert.equal((await run(srv, PRO, "1 A St, Boise, ID")).status, 200);
  assert.equal(stub.calls.length, 2, "the re-run did not search");
  assert.equal(rowsFor(tables, PRO).length, 2, "and so it was not counted");

  const keys = rowsFor(tables, PRO).map((r) => r.report_key);
  assert.equal(new Set(keys).size, 2, "each search has a key of its own, so none is deduped away");

  const cfg = await (await fetch(srv.base + "/api/config", { headers: { cookie: `cn_session=tok-${PRO.id}` } })).json();
  assert.equal(cfg.pro.searchesIncluded, INCLUDED, "the page is told the figure");
  assert.equal(cfg.pro.searchOverageCents, ENT.SEARCH_OVERAGE_CENTS);
});

test("an account with nothing to charge is stopped at the allowance, before anything is searched", async (t) => {
  // TESS is comped (users.pro_tester): Pro, with no card. One search short of
  // the allowance, so the first new address is her last.
  const env = await bootAll({ usage: searched(INCLUDED - 1, TESS) });
  t.after(() => env.stop());
  const { srv, stub, tables } = env;

  const last = await run(srv, TESS, "1 T St, Boise, ID");
  assert.equal(last.status, 200, "the 400th search is served");
  assert.equal(rowsFor(tables, TESS).length, INCLUDED);
  const before = stub.calls.length;

  const next = await run(srv, TESS, "2 T St, Boise, ID");
  assert.equal(next.status, 403, "the 401st is refused");
  assert.match(next.headers.get("content-type") || "", /json/, "plain JSON, not an event stream");
  const body = await next.json();
  assert.equal(body.code, "search_limit");
  assert.equal(body.upgrade, false, "a comped account is not sent to the pricing window");
  assert.match(body.error, /used the 400 searches included this month/);
  assert.match(body.error, /start again on [A-Z][a-z]+ 1\b/);
  assert.doesNotMatch(body.error, /paid plan/);
  assert.equal(body.searches.left, 0);
  assert.equal(stub.calls.length, before, "refused BEFORE anything was searched or billed");
  assert.equal(rowsFor(tables, TESS).length, INCLUDED, "and a refusal is not counted");

  // What she already ran still opens: a cache hit never reaches the gate.
  const again = await run(srv, TESS, "1 T St, Boise, ID");
  assert.equal(again.status, 200, "a report already run opens from cache at the limit");
  assert.equal(stub.calls.length, before);
});

test("a trial at the allowance is told what a paid plan does about it", async (t) => {
  const env = await bootAll({ usage: searched(INCLUDED, NEW), env: { PRO_TRIAL_DAYS: "30" } });
  t.after(() => env.stop());
  const { srv, stub } = env;

  const cfg = await (await fetch(srv.base + "/api/config", { headers: { cookie: `cn_session=tok-${NEW.id}` } })).json();
  assert.equal(cfg.pro.trial, true, "the fixture really is on a trial");

  const r = await run(srv, NEW, "9 N St, Boise, ID");
  assert.equal(r.status, 403);
  const body = await r.json();
  assert.equal(body.code, "search_limit");
  assert.equal(body.upgrade, true, "so the page opens the pricing window with this sentence");
  assert.match(body.error, /On a paid plan, searches past 400 keep going at \$0\.10 each/);
  assert.equal(stub.calls.length, 0, "nothing was searched");
});

test("a paying subscriber is never stopped, and the ledger says what the overage comes to", async (t) => {
  const env = await bootAll({
    usage: [...searched(INCLUDED + 2, PRO), ...searched(3, TESS)],
    env: { ADMIN_KEY: "adm-key-for-this-test" },
  });
  t.after(() => env.stop());
  const { srv, stub, tables } = env;

  const r = await run(srv, PRO, "5 P St, Boise, ID");
  assert.equal(r.status, 200, "402 searches in, the 403rd is still served");
  assert.equal(stub.calls.length, 1);
  assert.equal(rowsFor(tables, PRO).length, INCLUDED + 3, "and it is counted like any other");

  const anon = await fetch(srv.base + "/api/admin/search-usage");
  assert.equal(anon.status, 401, "the ledger is the owner's");

  const led = await fetch(srv.base + "/api/admin/search-usage", { headers: { "x-admin-key": "adm-key-for-this-test" } });
  assert.equal(led.status, 200);
  const ledger = await led.json();
  assert.equal(ledger.period, PERIOD.replace("searches-", ""));
  assert.equal(ledger.included, INCLUDED);
  const pro = ledger.members.find((m) => m.email === PRO.email);
  assert.deepEqual({ used: pro.used, over: pro.over, owed_cents: pro.owed_cents },
    { used: INCLUDED + 3, over: 3, owed_cents: 30 }, "three searches past the allowance at 10 cents");
  const tess = ledger.members.find((m) => m.email === TESS.email);
  assert.deepEqual({ used: tess.used, over: tess.over, owed_cents: tess.owed_cents }, { used: 3, over: 0, owed_cents: 0 });
  assert.equal(ledger.total_owed_cents, 30);
  assert.equal(ledger.members[0].email, PRO.email, "heaviest first");

  const other = await (await fetch(srv.base + "/api/admin/search-usage?period=2020-01",
    { headers: { "x-admin-key": "adm-key-for-this-test" } })).json();
  assert.equal(other.members.length, 0, "another month is another ledger");
});

test("a free account is not metered by this rule", async (t) => {
  const env = await bootAll();
  t.after(() => env.stop());
  const { srv, tables } = env;

  assert.equal((await run(srv, FREE, "1 F St, Boise, ID")).status, 200);
  assert.equal(rowsFor(tables, FREE).length, 0, "the free plan is governed by its report allowance, not this tally");
  const cfg = await (await fetch(srv.base + "/api/config", { headers: { cookie: `cn_session=tok-${FREE.id}` } })).json();
  assert.equal(cfg.pro.searchesIncluded, null);
});
