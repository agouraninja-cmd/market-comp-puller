// The market-page cross-link on a served report, actually running.
//
// WHY THIS EXISTS. `market_page` is what puts "See the Ontario market page →"
// under a report's Market Summary, and it is attached at SERIALIZATION inside
// finishReportForViewer — the same closure the paywall, the radius blend and
// the vault blend live in. Nothing executed it: a live admin search on
// production came back with no market_page at all, which reads exactly like a
// regression until you notice that an INTERNAL caller returns from that
// function early, before any of those decorations. The customer path is the
// one nobody had run.
//
// So this pins the difference the internal early-return creates, in both
// directions: a signed-in visitor gets the cross-link, an internal caller
// deliberately does not, and a market with no standing page gets nothing
// rather than a slug that 404s.
//
// NOTHING HERE REACHES A REAL VENDOR — archive-first.test.js's arrangement,
// for its reasons: a stub answers every search, the fake PostgREST answers
// every read and write, comps cite loopnet.com so the link check runs its
// real code with no network, and the subject carries its own coordinates so
// the radius blend never geocodes.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const DAYS_AGO = (n) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString().slice(0, 10);
const PAT = { id: "22222222-2222-4222-8222-222222222222", email: "pat@brokerage.com", name: "Pat" };
const ADMIN_KEY = "test-admin-key";

// A seeded market that really does have a standing page, and one that
// really does not — read from market-seed.json rather than hardcoded, so a
// reseed that drops Ontario fails loudly here instead of quietly passing.
const SEED = require("../market-seed.json");
const COVERED = SEED["industrial-ontario-ca"];

function reportFor(city) {
  const sale = (n) => ({
    address: `${n}00 Example Way, ${city}`,
    date: DAYS_AGO(30 + n), transaction: "Sale",
    size_sqft: "15000", price_or_rate: "$4,000,000",
    source_type: "public_record",
    source_url: "https://www.loopnet.com/Listing/example",
    notes: "Arms-length sale.",
  });
  return {
    summary: `Industrial sales in ${city} have been steady.`,
    currency: "USD",
    comps: [sale(1), sale(2), sale(3), sale(4)],
    avg_price_per_sqft: 266,
    subject_lat: 34.0633, subject_lng: -117.6509,
    market_cap_rate_range: { low: "4.75%", high: "5.75%" },
    value_drivers: ["Freeway access"],
    market_trend: "Prices have held steady.",
    search_radius: "~5 miles",
    transactions_reviewed: 12,
  };
}

async function startStubProvider() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const text = JSON.stringify(reportFor("Ontario, CA"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        stop_reason: "end_turn",
        usage: { input_tokens: 1000, output_tokens: 500 },
        content: [{ type: "text", text }],
      }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  return {
    url: `http://localhost:${server.address().port}/v1/messages`,
    stop: () => new Promise((r) => server.close(r)),
  };
}

async function bootAll() {
  const db = await fake.start({
    tables: {
      users: [{ ...PAT, pro_tester: false, vault_beta: false }],
      sessions: [{ token_hash: sha256("tok-" + PAT.id), user_id: PAT.id, expires_at: YEAR_OUT }],
      subscriptions: [{
        user_id: PAT.id, plan: "pro_monthly", status: "active",
        current_period_end: YEAR_OUT, cancel_at_period_end: false,
      }],
      broker_comps: [], broker_properties: [], org_members: [], org_comps: [],
      comp_corpus: [], search_cache: [], analytics_events: [],
      comp_submissions: [], subject_sizes: [], market_pages: [],
    },
  });
  const stub = await startStubProvider();
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    ADMIN_KEY,
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
    SEARCH_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "test-key-not-a-real-one",
    STREAM_ANTHROPIC: "off",
    SEARCH_API_URL: stub.url,
  });
  return { db, srv, stub, stop: async () => { srv.stop(); await stub.stop(); await db.stop(); } };
}

function search(base, address, headers = {}) {
  return fetch(base + "/api/comps", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `cn_session=tok-${PAT.id}`,
      ...headers,
    },
    body: JSON.stringify({ address, type: "Industrial", months: 12 }),
  });
}

test("the market-page cross-link reaches the report that shows it", async (t) => {
  assert.ok(COVERED, "market-seed.json no longer carries industrial-ontario-ca — pick another covered market");
  const env = await bootAll();
  t.after(() => env.stop());
  const base = env.srv.base;

  await t.test("a signed-in visitor's report links to the standing market page", async () => {
    const r = await search(base, "4200 E Airport Dr, Ontario, CA 91761");
    assert.equal(r.status, 200);
    const rep = await r.json();
    assert.ok(rep.market_page, "no market_page on a market that has a standing page");
    assert.equal(rep.market_page.slug, "industrial-ontario-ca");
    assert.equal(rep.market_page.market, "Ontario, CA");
    // The slug must be a page that actually resolves, or the report links a 404.
    const page = await fetch(base + "/market/" + rep.market_page.slug);
    assert.equal(page.status, 200, "the cross-link points at a page that does not render");
  });

  await t.test("a market with no standing page gets no link rather than a dead one", async () => {
    const r = await search(base, "12 Nowhere Rd, Poplar Bluff, MO 63901");
    assert.equal(r.status, 200);
    const rep = await r.json();
    assert.ok(!("market_page" in rep),
      "an uncovered market must omit the key outright, never carry a slug that 404s");
  });

  // The reason this file exists. An internal caller (the seed generator, the
  // Explorer, an admin smoke test) returns from finishReportForViewer BEFORE
  // the decorations, so its report carries none of them — which looks like a
  // regression the first time somebody runs a live admin search and finds no
  // cross-link. Pinned so the difference is documented rather than rediscovered.
  await t.test("an internal caller gets the undecorated report, by design", async () => {
    const r = await search(base, "4200 E Airport Dr, Ontario, CA 91761", { "x-admin-key": ADMIN_KEY });
    assert.equal(r.status, 200);
    const rep = await r.json();
    assert.ok(!("market_page" in rep), "internal callers return before the cross-link is attached");
    assert.ok(!("exports_remaining" in rep), "and before the export tally");
    assert.ok(!("branding_allowed" in rep), "and before the branding flag");
    assert.ok(rep.comps.length, "but the report itself is whole — that is the point of the bypass");
  });
});
