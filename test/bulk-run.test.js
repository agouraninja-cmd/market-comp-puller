// Bulk valuation's worker, actually running — a whole job from POST to a
// valued row on the member's desk, against a stub search provider.
//
// WHY THIS EXISTS. bulk-routes.test.js proves the refusals, the scoping and
// the read paths, and stops exactly where the money starts: every one of its
// runs is refused before a job is created, because the harness has no provider
// key. So everything from "a report came back" through valuing it, writing the
// row, upserting it to the desk and finishing the job was argued in comments
// and never executed — on the one feature in this app where a mistake is
// measured in dollars.
//
// SEARCH_API_URL (server.js) is what closes that, and it is RESEND_API_URL's
// precedent applied to the same problem: the digest's whole point is mail
// leaving the building, this one's is fifty searches leaving it, and neither
// can be tested by stopping at the call. Production never sets either.
//
// NOTHING HERE REACHES A REAL VENDOR. The stub below answers every search, the
// fake PostgREST answers every read and write, and the comps deliberately cite
// loopnet.com — a host link-check.js never fetches — so the source-link check
// runs its real code and makes no network call. The subject carries its own
// coordinates so the radius blend never reaches the Census geocoder.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const BULK = require("../bulk.js");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const PAT = { id: "11111111-1111-4111-8111-111111111111", email: "pat@brokerage.com", name: "Pat" };

// The report the stub "search" returns. Long comp keys on purpose: expandComp
// passes them through, and writing the compact ones here would test the
// encoding rather than the worker.
function reportFor(address) {
  const sale = (n, price, size, date) => ({
    address: `${n} Warehouse Way, Boise, ID 83702`,
    date, transaction: "Sale",
    size_sqft: String(size), price_or_rate: `$${price.toLocaleString("en-US")}`,
    source_type: "public_record",
    // A bot-walled host: link-check.js never fetches these, so the real
    // source-link check runs and touches no network.
    source_url: "https://www.loopnet.com/Listing/example",
    notes: "Arms-length sale.",
  });
  return {
    summary: `Industrial sales near ${address} have been steady.`,
    value_drivers: ["Vacancy is tight.", "Rents are rising."],
    market_trend: "Prices up modestly year over year.",
    market_cap_rate_range: "6.0% - 6.75%",
    annual_price_trend_pct: 3,
    subject_size_sqft: "20000",
    subject_size_source: "county records",
    // Supplied so the radius blend reads coordinates off the report instead of
    // geocoding the address at the US Census.
    subject_lat: 43.6150,
    subject_lng: -116.2023,
    comps: [
      sale(100, 1900000, 20000, "2026-05-10"),
      sale(200, 2050000, 20500, "2026-03-02"),
      sale(300, 1750000, 19000, "2025-12-14"),
      sale(400, 2200000, 21000, "2026-06-20"),
      sale(500, 1980000, 20200, "2026-01-08"),
    ],
  };
}

// The provider stand-in: one non-streaming Anthropic response body, which is
// why the suite sets STREAM_ANTHROPIC=off. It counts calls, because "how many
// searches did this job actually buy" is the question the cache exists to
// answer and the one nobody could ask before.
async function startStubProvider() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let asked = "";
      try {
        const sent = JSON.parse(body || "{}");
        asked = JSON.stringify(sent).slice(0, 4000);
      } catch (_) { /* the count is what matters */ }
      calls.push({ asked });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        stop_reason: "end_turn",
        usage: { input_tokens: 1000, output_tokens: 500 },
        content: [{ type: "text", text: JSON.stringify(reportFor("the subject")) }],
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
    bulk_jobs: [], bulk_job_items: [], portfolio_items: [],
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
    // The stub answers one JSON body, not an SSE stream.
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

// The worker runs after the POST answers, so every assertion waits on the job
// rather than on a timer.
async function waitForJob(base, id, { timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await fetch(`${base}/api/bulk?id=${encodeURIComponent(id)}`, as());
    const body = await r.json();
    if (body.job && body.job.status !== "running") return body;
    if (Date.now() > deadline) {
      throw new Error(`job never finished: ${JSON.stringify(body.job)}`);
    }
    await new Promise((r2) => setTimeout(r2, 100));
  }
}

test("a bulk job runs end to end and lands on the desk", async (t) => {
  const ctx = await bootAll();
  t.after(() => ctx.stop());
  const { srv, tables, stub } = ctx;

  const started = await fetch(srv.base + "/api/bulk", as({
    method: "POST",
    body: JSON.stringify({
      text: "1201 W Idaho St, Boise, ID 83702\n900 N Cole Rd, Boise, ID 83704",
      type: "Industrial", months: 24, label: "Q3 review",
    }),
  }));
  const startedBody = await started.json();
  assert.equal(started.status, 200, JSON.stringify(startedBody));
  const { job } = startedBody;
  const finished = await waitForJob(srv.base, job.id);

  await t.test("the job finishes and every row is valued", () => {
    assert.equal(finished.job.status, "done");
    assert.equal(finished.job.done_count, 2);
    assert.equal(finished.items.length, 2);
    for (const it of finished.items) {
      assert.equal(it.status, "done", it.error || "");
      assert.ok(it.value_likely > 0, "a finished row must carry a figure");
      assert.ok(it.value_low <= it.value_likely && it.value_likely <= it.value_high,
        "low <= likely <= high");
      assert.equal(it.sale_comps, 5, "all five stub comps are sales");
      assert.equal(it.size_sqft, 20000);
      assert.equal(it.size_source, "county records");
      assert.equal(it.market, "Boise, ID");
    }
  });

  await t.test("the figure is bulk.js's own answer over the report as SERVED", () => {
    // The rule the whole feature rests on: if the worker ever computes a value
    // any other way, a portfolio stops reconciling with the reports behind it
    // and neither screen can show that.
    //
    // Valued against the report STORED on the desk, not against the stub's
    // reply — and the difference is the point. The served report is the stub's
    // reply after normalization, $/SF reconciliation, distance stamping and
    // the radius blend, and salePsfOf prefers the reconciled price_per_sqft
    // over price ÷ size. Scoring against the raw stub would be scoring a
    // report no member ever sees, and it is off by a couple of cents per foot
    // (measured: 99.90 vs 99.92), which is exactly the kind of quiet drift
    // this assertion exists to catch.
    for (const it of finished.items) {
      const saved = tables.portfolio_items.find((x) => x.id === it.portfolio_item_id);
      const expected = BULK.valueFromReport(saved.payload.data, {
        asOf: Date.now(), propertyType: "Industrial",
      });
      assert.equal(it.value_likely, expected.value_likely,
        "the stored figure must be valueFromReport's own answer");
      assert.equal(it.value_low, expected.value_low);
      assert.equal(it.value_high, expected.value_high);
      // asOf moves by milliseconds between the worker's run and this one, and
      // the trend factor is continuous in comp age, so $/SF is compared to the
      // cent rather than to the float. The dollar figures above are exact
      // because heroRound quantizes them.
      assert.ok(Math.abs(it.psf_mid - expected.psf_mid) < 0.01,
        `psf ${it.psf_mid} vs ${expected.psf_mid}`);
    }
  });

  await t.test("the totals sum what was valued", () => {
    assert.equal(finished.summary.valued, 2);
    assert.equal(finished.summary.failed, 0);
    assert.equal(finished.summary.likely,
      finished.items.reduce((n, it) => n + it.value_likely, 0));
  });

  await t.test("every valuation is on My Desk, linked from its row", async () => {
    // The half a member actually keeps: a bulk row is a summary, and the
    // evidence for it has to be reachable as an ordinary saved property.
    assert.equal(tables.portfolio_items.length, 2);
    for (const it of finished.items) {
      assert.ok(it.portfolio_item_id, "a valued row must link to its property");
      const saved = tables.portfolio_items.find((x) => x.id === it.portfolio_item_id);
      assert.ok(saved, "the link must point at a real row");
      assert.equal(saved.user_id, PAT.id);
      assert.equal(saved.address, it.address);
      assert.equal(saved.property_type, "Industrial");
      // A whole report, so the desk re-renders it exactly like a searched one.
      assert.ok(Array.isArray(saved.payload.data.comps) && saved.payload.data.comps.length);
      assert.equal(saved.payload.meta.type, "Industrial");
      assert.equal(saved.payload.meta.months, 24);
      assert.equal(saved.snapshots[0].likely, it.value_likely,
        "the desk's value history must agree with the row");
    }
  });

  await t.test("the corpus and the cache saw the report", () => {
    // Both are downstream of the SEARCH and upstream of the gate, and both
    // swallow their own errors — so if the worker had skipped them, nothing
    // anywhere would have said so.
    assert.ok(tables.comp_corpus.length >= 5, "harvest ran on the ungated report");
    assert.ok(tables.search_cache.length >= 2, "each address cached its own search");
  });

  await t.test("two addresses bought two searches, not more", () => {
    // The cost assertion. A retry loop or a double-run would show up here as
    // four calls and nowhere else.
    assert.equal(stub.calls.length, 2);
  });

  await t.test("re-running the same list is free and says so", async () => {
    // Re-running IS the resume (there is deliberately no resume button), and
    // that is only true if the second run costs nothing.
    const before = stub.calls.length;
    const again = await fetch(srv.base + "/api/bulk", as({
      method: "POST",
      body: JSON.stringify({
        text: "1201 W Idaho St, Boise, ID 83702\n900 N Cole Rd, Boise, ID 83704",
        type: "Industrial", months: 24,
      }),
    }));
    assert.equal(again.status, 200);
    const second = await waitForJob(srv.base, (await again.json()).job.id);
    assert.equal(second.job.status, "done");
    assert.equal(stub.calls.length, before, "a cached address must not buy a search");
    for (const it of second.items) {
      assert.equal(it.cached, true, "and the row says it came from cache");
      assert.ok(it.value_likely > 0);
    }
    // Upserted, not duplicated: the same two properties, re-valued.
    assert.equal(tables.portfolio_items.length, 2);
  });
});

test("a search that fails costs the row, not the run", async (t) => {
  // One bad address must never stop the rest of the list — the watchlist
  // digest's rule, and here the other forty-nine are owed their answer.
  const ctx = await bootAll();
  t.after(() => ctx.stop());

  // Answer the FIRST call with a 500 and the rest normally.
  let n = 0;
  const original = ctx.stub;
  const flaky = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      n++;
      if (n === 1) {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "upstream is unhappy" } }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
        content: [{ type: "text", text: JSON.stringify(reportFor("x")) }],
      }));
    });
  });
  await new Promise((r) => flaky.listen(0, r));
  t.after(() => new Promise((r) => flaky.close(r)));

  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: ctx.db.url, SUPABASE_SERVICE_KEY: "service-key",
    SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key",
    STREAM_ANTHROPIC: "off",
    SEARCH_API_URL: `http://localhost:${flaky.address().port}/v1/messages`,
  });
  t.after(() => srv.stop());
  void original;

  const r = await fetch(srv.base + "/api/bulk", as({
    method: "POST",
    body: JSON.stringify({
      text: "500 First St, Boise, ID 83702\n600 Second St, Boise, ID 83702",
      type: "Industrial", months: 24,
    }),
  }));
  assert.equal(r.status, 200);
  const done = await waitForJob(srv.base, (await r.json()).job.id);

  assert.equal(done.job.status, "done", "the job still finishes");
  assert.equal(done.items.length, 2);
  const failed = done.items.filter((it) => it.status === "failed");
  const ok = done.items.filter((it) => it.status === "done");
  assert.equal(failed.length, 1);
  assert.equal(ok.length, 1, "the other address is still valued");
  assert.ok(failed[0].error, "a failure travels with a reason");
  assert.ok(!/api\.anthropic|x-api-key|upstream is unhappy/i.test(failed[0].error),
    "and the vendor's own words never reach a customer — clientErrorMessage decides");
  assert.equal(failed[0].value_likely, null, "a failure is not a zero");
  assert.equal(done.summary.valued, 1, "and the total covers one address, and says so");
  assert.equal(done.summary.failed, 1);
});
