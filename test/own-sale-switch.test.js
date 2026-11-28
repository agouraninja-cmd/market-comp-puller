// OWN_SALE=off, the rollback for "the building's own sale leads its value"
// (valuation.js has the rule; server.js, beside settleOwnSale, says what the
// switch covers), against a real server, the stand-in database and a stub
// search provider.
//
// WHY THIS EXISTS. That rule moves a report's headline figure, so it has to
// be stoppable from the host's settings with no new code. A rollback that
// only stops NEW reports from leaning is half of one: the cache already
// holds reports whose sale the server stamped, and the stamp is what the page
// and the bulk rows lean on. So this boots the rule ON, lets one report be
// settled and cached, then boots it OFF against the same cache and checks
// both halves: the cached report is served without its stamp, and a fresh
// search is the search it was before the rule existed.
//
// NOTHING HERE REACHES A REAL VENDOR: the stub answers every search, the
// stand-in answers every read and write, and every source link is on a host
// the link check never fetches (loopnet.com is bot-walled), so the link check
// and the read of the sale's own page both run their real code with no
// network. The subject carries its own coordinates so nothing geocodes.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
// "2026-06": a month and a year, the shape VALUATION.saleDateMs reads by rule.
const MONTHS_AGO = (n) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };
const PAT = { id: "22222222-2222-4222-8222-222222222222", email: "pat@brokerage.com", name: "Pat" };
const LOOP = "https://www.loopnet.com/Listing/example";

const FIRST = "500 Subject St, Boise, ID 83702";
const SECOND = "700 Other St, Boise, ID 83702";

// What the search writes back for `address`: four ordinary sales, the
// subject's own sale among its comps (the prompt forbids it and it comes back
// anyway), and that same sale as subject_last_sale, complete.
function answerFor(address) {
  const sale = (n) => ({
    address: `${n}0 Web Found Way, Boise, ID`, date: MONTHS_AGO(2), transaction: "Sale",
    size_sqft: "20000", price_or_rate: "$2,000,000", source_type: "public_record", source_url: LOOP,
    notes: "Arms-length sale.",
  });
  return {
    summary: "Industrial sales in Boise have been steady.",
    currency: "USD",
    subject_size_sqft: "20000",
    subject_lat: 43.615, subject_lng: -116.2023,
    comps: [sale(1), sale(2), sale(3), sale(4), {
      address: address.replace(" St,", " Street,"), date: MONTHS_AGO(5), transaction: "Sale",
      size_sqft: "20000", price_or_rate: "$3,000,000", source_type: "news", source_url: LOOP,
      notes: "Sold to an investor.",
    }],
    subject_last_sale: {
      date: MONTHS_AGO(5), price: "$3,000,000", source_url: LOOP, source_type: "news",
      address, size_sqft: "20000", basis: "arms_length",
      // A model cannot stamp its own sale: these three must not survive.
      settled: 1, unusable: "", page_states_price: true,
    },
    avg_price_per_sqft: "$100",
    market_cap_rate_range: "6.0% - 6.75%",
    value_drivers: ["Vacancy is tight."],
    market_trend: "Stable.",
    search_radius: "5 miles",
    transactions_reviewed: 6,
  };
}

async function startStub() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let sent = {};
      try { sent = JSON.parse(body || "{}"); } catch (_) { /* the count still matters */ }
      const prompt = JSON.stringify(sent.messages || "");
      calls.push({ prompt });
      const text = JSON.stringify(answerFor(prompt.includes("700 Other St") ? SECOND : FIRST));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 500 },
        content: [{ type: "text", text }] }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://localhost:${server.address().port}/v1/messages`, calls,
           stop: () => new Promise((r) => server.close(r)) };
}

const bootWith = (db, stub, env) => shared.boot({
  ACCOUNT_WALL: "off", PRO_ENABLED: "on",
  SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key", SITE_URL: "https://compninja.co",
  SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-a-real-one",
  STREAM_ANTHROPIC: "off", SEARCH_API_URL: stub.url,
  COMP_WIDER_SEARCH: "off",
  ...env,
});

const search = (base, address) => fetch(base + "/api/comps", {
  method: "POST",
  headers: { "content-type": "application/json", cookie: `cn_session=tok-${PAT.id}` },
  body: JSON.stringify({ address, type: "Industrial", months: 12 }),
});

async function until(cond, message, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (cond()) return;
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((r) => setTimeout(r, 50));
  }
}

// The boot object index.html is served with, as the page reads it.
async function bootObject(base) {
  const html = await (await fetch(base + "/index.html")).text();
  const m = html.match(/window\.CN_AUTH_BOOT=(\{[^}]*\})/);
  assert.ok(m, "the page was served with no boot object");
  return JSON.parse(m[1]);
}

// Either way the prompt sends a search after the subject's own sale: a step
// of its own when the size is already known, one sentence on the end of the
// size step when it is not.
const LOOKS_FOR_THE_SALE = /SUBJECT SALE:|one more search for a sale of this exact address/;

const ownRows = (report) => (report.comps || []).filter((c) => /Subject Str|Other Str/.test(String(c.address)));
const stamped = (tables) => tables.search_cache.filter((row) => /"settled":1/.test(JSON.stringify(row))).length;

test("OWN_SALE=off stops the lean on new reports and on ones already settled and cached", async (t) => {
  const tables = {
    users: [{ ...PAT, pro_tester: false, vault_beta: false }],
    sessions: [{ token_hash: sha256("tok-" + PAT.id), user_id: PAT.id, expires_at: YEAR_OUT }],
    subscriptions: [{ user_id: PAT.id, plan: "pro_monthly", status: "active",
      current_period_end: YEAR_OUT, cancel_at_period_end: false }],
    broker_comps: [], broker_properties: [], org_members: [], org_comps: [],
    comp_corpus: [], search_cache: [], analytics_events: [],
    comp_submissions: [], subject_sizes: [], market_pages: [],
  };
  const db = await fake.start({ tables });
  t.after(() => db.stop());
  const stub = await startStub();
  t.after(() => stub.stop());

  // --- the rule ON (the default): one report settled, stamped and cached ---
  const on = await bootWith(db, stub, {});
  let onStopped = false;
  t.after(() => { if (!onStopped) on.stop(); });

  const first = await search(on.base, FIRST);
  const settledReport = await first.json();
  assert.equal(first.status, 200, JSON.stringify(settledReport).slice(0, 300));

  await t.test("on: the search is asked for the building's own sale, and the sale is settled and stamped", async () => {
    assert.equal(stub.calls.length, 1);
    // No size was typed, so this search already looks the subject up for its
    // size, and the ask for its sale rides on the end of that step.
    assert.match(stub.calls[0].prompt, LOOKS_FOR_THE_SALE);
    assert.equal(settledReport.subject_last_sale.settled, 1);
    assert.equal(settledReport.subject_last_sale.basis, "arms_length");
    assert.equal(ownRows(settledReport).length, 0, "the subject's own sale is not one of its comps");
    assert.equal(settledReport.set_aside_counts.own_sale, 1);
    // The stub wrote `page_states_price: true` and `unusable: ""` into its
    // own answer. Neither is the server's finding (the page is on a host
    // that is never fetched), so neither may ride out.
    assert.equal("page_states_price" in settledReport.subject_last_sale, false, "a model cannot vouch for its own page");
    assert.equal("unusable" in settledReport.subject_last_sale, false);
    await until(() => tables.search_cache.length === 1, "the settled report was never written to the cache");
    assert.equal(stamped(tables), 1, "the cache holds the report as settled");
  });

  await t.test("on: the page is told nothing, so its bytes are what they always were", async () => {
    const boot = await bootObject(on.base);
    assert.equal("ownSale" in boot, false);
    assert.deepEqual(Object.keys(boot).sort(), ["rail", "signedIn", "wall"]);
  });

  on.stop();
  onStopped = true;

  // --- the rule OFF, against the same cache --------------------------------
  const off = await bootWith(db, stub, { OWN_SALE: "off" });
  t.after(() => off.stop());

  await t.test("off: the cached report is served without its stamp, and the cache keeps it", async () => {
    const res = await search(off.base, FIRST);
    const report = await res.json();
    assert.equal(res.status, 200, JSON.stringify(report).slice(0, 300));
    assert.equal(stub.calls.length, 1, "a cache hit: nothing was billed");
    assert.ok(report.subject_last_sale, "the sale is still shown as the history it is");
    assert.equal(report.subject_last_sale.price, "$3,000,000");
    assert.equal("settled" in report.subject_last_sale, false, "nothing downstream can lean on it");
    // A copy left the server, not the cached object: the stamp has to still
    // be there when the switch goes back on.
    assert.equal(stamped(tables), 1);
  });

  await t.test("off: a fresh search is the search it was before the rule", async () => {
    const res = await search(off.base, SECOND);
    const report = await res.json();
    assert.equal(res.status, 200, JSON.stringify(report).slice(0, 300));
    assert.equal(stub.calls.length, 2, "this one is new, so it is searched");
    assert.doesNotMatch(stub.calls[1].prompt, LOOKS_FOR_THE_SALE, "no search is spent looking for the sale");
    assert.match(stub.calls[1].prompt, /SUBJECT SIZE \(do this FIRST\)/, "the size lookup itself is untouched");
    assert.equal("settled" in report.subject_last_sale, false, "nothing is settled, so nothing is stamped");
    assert.equal(ownRows(report).length, 1, "the comps are the ones the search wrote");
    assert.equal((report.set_aside_counts || {}).own_sale, undefined);
  });

  await t.test("off: the page is told, which covers a report rendered from a saved payload", async () => {
    const boot = await bootObject(off.base);
    assert.equal(boot.ownSale, false);
  });
});
