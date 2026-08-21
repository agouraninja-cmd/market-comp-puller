// Archive-first retrieval, actually running — vault -> corpus -> web, against
// a real server, the fake PostgREST and a stub search provider.
//
// WHY THIS EXISTS. The pure halves (archiveCoverage/archiveIsStrong in
// blend-comps.js) prove the threshold; what they cannot prove is the wiring,
// and the wiring is where every failure mode of this feature lives: the
// budget cut has to reach the PROVIDER REQUEST (max_uses), the report served
// to the broker has to still carry their blended comps, the shared cache has
// to gain NOTHING from a vault-subsidized search, and a visitor with no vault
// has to be byte-for-byte unaffected. The stub records every request body, so
// "what budget did the model actually receive" is read off the wire rather
// than inferred from a log line.
//
// NOTHING HERE REACHES A REAL VENDOR — bulk-run.test.js's arrangement, for
// its reasons: the stub answers every search, the fake answers every read and
// write, comps cite loopnet.com so the link check runs its real code with no
// network, and the subject carries its own coordinates so the radius blend
// never geocodes.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const DAYS_AGO = (n) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString().slice(0, 10);
const PAT = { id: "11111111-1111-4111-8111-111111111111", email: "pat@brokerage.com", name: "Pat" };

// One vault row: priced, recent, Boise Industrial — usable by both the
// archive-strength count and the serialization blend, which is the point:
// the budget is cut on exactly the evidence the report will carry.
function vaultRow(n, price) {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    user_id: PAT.id, upload_id: null, property_id: null,
    market: "Boise, ID", property_type: "Industrial",
    address: `${n}00 Vault Ave, Boise, ID 83702`,
    address_key: `${n}00 vault ave boise id 83702`,
    deal_date: DAYS_AGO(40 + n), transaction: "sale",
    price, size_sqft: 10000, price_per_sqft: price / 10000,
    dedupe_key: `${n}00 vault ave|${DAYS_AGO(40 + n)}|${price}`,
    published: false,
  };
}

function reportFor(city) {
  const sale = (n) => ({
    address: `${n} Web Found Way, ${city}`,
    date: DAYS_AGO(30 + n), transaction: "Sale",
    size_sqft: "15000", price_or_rate: "$1,500,000",
    source_type: "public_record",
    source_url: "https://www.loopnet.com/Listing/example",
    notes: "Arms-length sale.",
  });
  return {
    summary: `Industrial sales in ${city} have been steady.`,
    currency: "USD",
    subject_size_sqft: "20000",
    subject_lat: 43.615, subject_lng: -116.2023,
    comps: [sale(1), sale(2)],
    avg_price_per_sqft: "$100",
    market_cap_rate_range: "6.0% - 6.75%",
    value_drivers: ["Vacancy is tight."],
    market_trend: "Stable.",
    search_radius: "5 miles",
    transactions_reviewed: 6,
  };
}

// Records the PARSED request per call — max_uses is what this suite is about,
// and reading it parsed beats regexing a truncated string.
async function startStubProvider() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let sent = {};
      try { sent = JSON.parse(body || "{}"); } catch (_) { /* count still matters */ }
      calls.push({
        maxUses: sent.tools && sent.tools[0] ? sent.tools[0].max_uses : null,
        promptChars: JSON.stringify(sent.messages || "").length,
        prompt: JSON.stringify(sent.messages || ""),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        stop_reason: "end_turn",
        usage: { input_tokens: 1000, output_tokens: 500 },
        content: [{ type: "text", text: JSON.stringify(reportFor("Boise, ID")) }],
      }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  return {
    url: `http://localhost:${server.address().port}/v1/messages`,
    calls,
    stop: () => new Promise((r) => server.close(r)),
  };
}

async function bootAll() {
  const tables = {
    users: [{ ...PAT, pro_tester: false, vault_beta: false }],
    sessions: [{ token_hash: sha256("tok-" + PAT.id), user_id: PAT.id, expires_at: YEAR_OUT }],
    subscriptions: [{
      user_id: PAT.id, plan: "pro_monthly", status: "active",
      current_period_end: YEAR_OUT, cancel_at_period_end: false,
    }],
    // Four priced comps: exactly archiveIsStrong's threshold.
    broker_comps: [1, 2, 3, 4].map((n) => vaultRow(n, 1000000 + n * 50000)),
    broker_properties: [],
    org_members: [], org_comps: [],
    comp_corpus: [], search_cache: [], analytics_events: [],
    comp_submissions: [], subject_sizes: [], market_pages: [],
  };
  const db = await fake.start({ tables });
  const stub = await startStubProvider();
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
    SEARCH_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "test-key-not-a-real-one",
    STREAM_ANTHROPIC: "off",
    SEARCH_API_URL: stub.url,
  });
  return {
    db, srv, stub, tables,
    stop: async () => { srv.stop(); await stub.stop(); await db.stop(); },
  };
}

const as = (init = {}) => ({
  ...init,
  headers: {
    "content-type": "application/json",
    cookie: `cn_session=tok-${PAT.id}`,
    ...(init.headers || {}),
  },
});

async function until(cond, message, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (cond()) return;
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function search(base, address) {
  return fetch(base + "/api/comps", as({
    method: "POST",
    body: JSON.stringify({ address, type: "Industrial", months: 12 }),
  }));
}

test("archive-first retrieval: the vault cuts the budget, the cache gains nothing, nobody else changes", async (t) => {
  const ctx = await bootAll();
  t.after(() => ctx.stop());
  const { srv, stub, tables } = ctx;

  // --- control first: a market where Pat's vault holds nothing -------------
  const control = await search(srv.base, "2100 N Stemmons Fwy, Dallas, TX 75207");
  assert.equal(control.status, 200, JSON.stringify(await control.clone().json()).slice(0, 300));
  await control.json();

  await t.test("a search with no vault coverage runs the full budget and is cached", async () => {
    assert.equal(stub.calls.length, 1, "one billed call");
    assert.equal(stub.calls[0].maxUses, 10, "12-comp, no-size, no-corpus ask = 10 searches");
    await until(() => tables.search_cache.length === 1,
      "the control search was never written to the shared cache");
  });

  // --- the archive-strong search -------------------------------------------
  const res = await search(srv.base, "500 Subject St, Boise, ID 83702");
  assert.equal(res.status, 200);
  const report = await res.json();

  await t.test("the provider request carries the floored budget", () => {
    assert.equal(stub.calls.length, 2, "one more billed call");
    assert.equal(stub.calls[1].maxUses, 3, "vault-strong floor is 3 (2 with a typed size) — never 0");
  });

  await t.test("no vault row, address, or price reaches the prompt", () => {
    const p = stub.calls[1].prompt;
    assert.ok(!/Vault Ave/i.test(p), "a vault comp's address is in the prompt");
    assert.ok(!p.includes("1050000") && !p.includes("1,050,000"), "a vault comp's price is in the prompt");
    assert.ok(!/archive|vault/i.test(p), "the prompt mentions the vault at all");
  });

  await t.test("the broker's report still blends their comps at serialization", () => {
    assert.equal(report.private_count, 4, "all four vault comps ride the report");
    const priv = (report.comps || []).filter((c) => c.private === true);
    assert.equal(priv.length, 4);
    assert.ok(priv.every((c) => c.source_type === "broker_vault"));
  });

  await t.test("the shared cache gains NOTHING from a vault-subsidized search", async () => {
    // The harvest and analytics writes from this search are fire-and-forget,
    // so give them the same bounded wait — then assert the cache count never
    // moved past the control's single entry.
    await until(() => tables.analytics_events.some((e) => e.kind === "search" && e.source === "archive"),
      "the archive-assisted search was never tagged in analytics");
    assert.equal(tables.search_cache.length, 1,
      "a vault-subsidized report was written to the property-keyed shared cache — the next visitor would be served a thinner report missing the private rows that justified it");
  });

  await t.test("the analytics tag reads the same decision as the budget", () => {
    const rows = tables.analytics_events.filter((e) => e.kind === "search");
    const archive = rows.filter((e) => e.source === "archive");
    const untagged = rows.filter((e) => !e.source);
    assert.equal(archive.length, 1, "exactly the floored search is tagged archive");
    assert.equal(untagged.length, 1, "exactly the control search is untagged");
  });
});

// The rollback lever. Boot once more with the flag off: same vault, same
// search, full budget — the pre-feature app exactly.
test("ARCHIVE_FIRST=off restores corpus-then-web for everyone", async (t) => {
  const ctx = await bootAll();
  t.after(() => ctx.stop());
  const off = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: ctx.db.url, SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
    SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-a-real-one",
    STREAM_ANTHROPIC: "off", SEARCH_API_URL: ctx.stub.url,
    ARCHIVE_FIRST: "off",
  });
  t.after(() => off.stop());

  const res = await search(off.base, "500 Subject St, Boise, ID 83702");
  assert.equal(res.status, 200);
  const last = ctx.stub.calls[ctx.stub.calls.length - 1];
  assert.equal(last.maxUses, 10, "with the lever off, a full vault buys no budget cut");
  await until(() => ctx.tables.search_cache.length >= 1,
    "with the lever off the search caches normally");
});
