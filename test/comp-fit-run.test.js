// The comp-fit step and the wider search, wired into a real server.js against
// a stub search provider (comp-fit.js has the rules; test/comp-fit.test.js
// the decision table). The first answer is the 76 Inverness Dr E report's
// shape: a 32,000 SF building, two ~7,200 SF sales, a condo unit and one
// right-sized sale. The server must set aside the unit, see that only one
// right-sized sale is left, run ONE wider search told the size band and the
// addresses already in hand, and then cut the two small buildings once the
// wider search has found right-sized ones. The visitor gets counts, never
// the set-aside comps.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const shared = require("./helpers/boot");

const DAYS_AGO = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 7);
const LOOP = "https://www.loopnet.com/Listing/example";   // bot-walled: never fetched

function sale(address, sqft, price) {
  return { address, date: DAYS_AGO(60), transaction: "Sale", size_sqft: sqft, price_or_rate: price,
           source_type: "listing", source_url: LOOP };
}

const FIRST = {
  summary: "Industrial sales in Englewood have been steady.",
  currency: "USD",
  subject_size_sqft: "32000",
  subject_address_corrected: "76 Inverness Dr E, Englewood, CO 80112",
  comps: [
    sale("9500 E Easter Ave, Centennial, CO", "7,200", "$1,900,000"),
    sale("9510 E Easter Ave, Centennial, CO", "7,260", "$1,950,000"),
    sale("67 Inverness Dr E, Unit C, Englewood, CO", "30,000", "$6,000,000"),
    sale("4900 Ward Rd, Wheat Ridge, CO", "40,000", "$9,600,000"),
  ],
  avg_price_per_sqft: "$200",
  market_cap_rate_range: { low: "6.0%", high: "6.75%" },
  value_drivers: ["Vacancy is tight."],
  market_trend: "Stable.",
  search_radius: "5 miles",
};

const WIDER = {
  currency: "USD",
  comps: [
    sale("67 Inverness Dr E, Unit C, Englewood, CO", "30,000", "$6,000,000"),   // a repeat: dropped
    sale("100 Inverness Dr W, Englewood, CO", "30,000", "$6,900,000"),
    sale("200 Inverness Dr W, Englewood, CO", "35,000", "$8,000,000"),
    sale("300 Inverness Dr W, Englewood, CO", "28,000", "$6,500,000"),
  ],
};

async function startStub(first) {
  const FIRST_ANSWER = first || FIRST;
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let sent = {};
      try { sent = JSON.parse(body || "{}"); } catch (_) {}
      const prompt = JSON.stringify(sent.messages || "");
      const tool = (sent.tools && sent.tools[0]) || {};
      calls.push({ prompt, maxUses: tool.max_uses == null ? null : tool.max_uses });
      const text = JSON.stringify(/WIDER SEARCH FOR SIZE-MATCHED SALES/.test(prompt) ? WIDER : FIRST_ANSWER);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 500 },
        content: [{ type: "text", text }] }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://localhost:${server.address().port}/v1/messages`, calls,
           stop: () => new Promise((r) => server.close(r)) };
}

function search(base, address) {
  return fetch(base + "/api/comps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, type: "Industrial", months: 24 }),
  });
}

test("a thin, off-size report is fitted and searched wider before anyone sees it", async (t) => {
  const stub = await startStub();
  t.after(() => stub.stop());
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", GUEST_SEARCH_LIMIT: "5",
    SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-a-real-one",
    STREAM_ANTHROPIC: "off", SEARCH_API_URL: stub.url,
    COMP_WIDER_SEARCH: "on",
  });
  t.after(() => srv.stop());

  const res = await search(srv.base, "76 Inverness Dr E, Inglewood, CO");
  const report = await res.json();
  assert.equal(res.status, 200, JSON.stringify(report).slice(0, 300));

  await t.test("exactly one wider search, told the size band and what is already in hand", () => {
    assert.equal(stub.calls.length, 2);
    const p = stub.calls[1].prompt;
    assert.match(p, /between 16,000 and 64,000 SF/);
    assert.match(p, /67 Inverness Dr E, Unit C/, "a set-aside address is excluded too");
    assert.match(p, /4900 Ward Rd/, "a kept address is excluded");
    assert.equal(stub.calls[1].maxUses, 6);
    // Comps only: no narrative fields asked of the wider lane.
    assert.doesNotMatch(p, /\\"summary\\": \\"\\"/);
  });

  await t.test("the unit sale and the two small buildings are gone; the right-sized ones stayed", () => {
    const addrs = report.comps.map((c) => c.address);
    assert.ok(!addrs.some((a) => /Unit C/.test(a)));
    assert.ok(!addrs.some((a) => /Easter Ave/.test(a)));
    assert.ok(addrs.includes("4900 Ward Rd, Wheat Ridge, CO"));
    assert.equal(addrs.filter((a) => /Inverness Dr W/.test(a)).length, 3);
  });

  await t.test("the visitor gets counts, never the set-aside comps", () => {
    assert.equal("set_aside" in report, false);
    assert.deepEqual(report.set_aside_counts, { unit: 1, size: 2 });
    assert.deepEqual(report.wider_search, { added: 3 });
  });

  await t.test("the corrected address rides the report", () => {
    assert.equal(report.subject_address_corrected, "76 Inverness Dr E, Englewood, CO 80112");
  });
});

test("COMP_FIT=off serves the model's comps as they came", async (t) => {
  const stub = await startStub();
  t.after(() => stub.stop());
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", GUEST_SEARCH_LIMIT: "5",
    SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-a-real-one",
    STREAM_ANTHROPIC: "off", SEARCH_API_URL: stub.url,
    COMP_WIDER_SEARCH: "on", COMP_FIT: "off",
  });
  t.after(() => srv.stop());
  const res = await search(srv.base, "76 Inverness Dr E, Englewood, CO");
  const report = await res.json();
  assert.equal(res.status, 200);
  assert.equal(stub.calls.length, 1);
  assert.equal(report.comps.length, 4);
  assert.equal("set_aside_counts" in report, false);
});

// The search's time budget (2026-11-27): the wider search is the one optional
// leg, so it is the one the clock governs. A budget too small to fit it means
// it never starts: one billed call, the first search's comps, and the report
// says nothing was added.
test("a wider search that would not fit the time budget is never started", async (t) => {
  const stub = await startStub();
  t.after(() => stub.stop());
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", GUEST_SEARCH_LIMIT: "5",
    SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-a-real-one",
    STREAM_ANTHROPIC: "off", SEARCH_API_URL: stub.url,
    COMP_WIDER_SEARCH: "on", SEARCH_TIME_BUDGET_SECONDS: "5",
  });
  t.after(() => srv.stop());
  const res = await search(srv.base, "76 Inverness Dr E, Englewood, CO");
  const report = await res.json();
  assert.equal(res.status, 200, JSON.stringify(report).slice(0, 300));
  assert.equal(stub.calls.length, 1, "the thin report asked for a wider search and the clock refused it");
  assert.deepEqual(report.wider_search, { added: 0, skipped: "time" });
  // The first search's comps, fitted: the unit is gone, and the floor kept
  // the two small buildings because nothing came to replace them.
  assert.deepEqual(report.set_aside_counts, { unit: 1 });
  assert.equal(report.comps.length, 3);
});

test("SEARCH_TIME_BUDGET_SECONDS=off is the behaviour before the budget", async (t) => {
  const stub = await startStub();
  t.after(() => stub.stop());
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", GUEST_SEARCH_LIMIT: "5",
    SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-a-real-one",
    STREAM_ANTHROPIC: "off", SEARCH_API_URL: stub.url,
    COMP_WIDER_SEARCH: "on", SEARCH_TIME_BUDGET_SECONDS: "off",
  });
  t.after(() => srv.stop());
  const res = await search(srv.base, "76 Inverness Dr E, Englewood, CO");
  const report = await res.json();
  assert.equal(res.status, 200);
  assert.equal(stub.calls.length, 2);
  assert.deepEqual(report.wider_search, { added: 3 });
});

// The blended re-fit (2026-11-27). The corpus already holds, with map points:
// the two small buildings this very search will set aside (harvested by an
// earlier search, as a size set-aside is), a condo unit, a foreclosure, a
// right-sized deal, and a deal of another size. Only the last two may join.
function corpusRow(address, over) {
  const row = {
    ts: new Date().toISOString(), property_type: "Industrial", market: "Englewood, CO",
    address, transaction: "Sale", deal_date: DAYS_AGO(90), size_sqft: "30000",
    price_or_rate: "$6,600,000", price_per_sqft: "", cap_rate: "", notes: "",
    source_url: "https://example.com/saved", source_type: "listing",
    lat: "39.5750", lng: "-104.8600", verified: false, ...over,
  };
  row.dedupe_key = [row.address, row.deal_date, row.price_or_rate].join("|").toLowerCase();
  return row;
}
const SAVED_ROWS = [
  corpusRow("9500 E Easter Ave, Centennial, CO", { size_sqft: "7200", price_or_rate: "$1,900,000", deal_date: DAYS_AGO(200) }),
  corpusRow("9510 E Easter Ave, Centennial, CO", { size_sqft: "7260", price_or_rate: "$1,950,000", deal_date: DAYS_AGO(200) }),
  corpusRow("8 Flex Ct, Unit 4, Englewood, CO"),
  corpusRow("9 Bank Rd, Englewood, CO", { notes: "Bank-owned (REO) sale; two miles north of the target." }),
  corpusRow("500 Other Way, Englewood, CO", { notes: "Owner-user purchase next to the target." }),
  corpusRow("10 Small Rd, Englewood, CO", { size_sqft: "9000", price_or_rate: "$2,300,000" }),
];

test("saved deals are fitted before they join a report, and a set-aside comp cannot come back through them", async (t) => {
  const stub = await startStub({ ...FIRST, subject_lat: "39.5700", subject_lng: "-104.8600" });
  t.after(() => stub.stop());
  const boot = (extra) => shared.boot({
    ACCOUNT_WALL: "off", GUEST_SEARCH_LIMIT: "5",
    SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-a-real-one",
    STREAM_ANTHROPIC: "off", SEARCH_API_URL: stub.url,
    COMP_WIDER_SEARCH: "on",
    DATA_FILES: { "comp-corpus.jsonl": SAVED_ROWS.map((r) => JSON.stringify(r)).join("\n") + "\n" },
    ...extra,
  });
  // Everything a visitor's report is valued from: the comps shown in full
  // and the locked rows standing in for the rest of a free report.
  const basisOf = (rep) => (rep.comps || []).length + (rep.locked_basis || []).length;

  const srv = await boot({});
  t.after(() => srv.stop());
  const res = await search(srv.base, "76 Inverness Dr E, Englewood, CO");
  const report = await res.json();
  assert.equal(res.status, 200, JSON.stringify(report).slice(0, 300));

  await t.test("only the two saved deals that fit joined: four search comps and two saved", () => {
    assert.equal(report.corpus_count, 2);
    assert.equal(basisOf(report), 6);
    const addrs = report.comps.map((c) => c.address);
    assert.ok(!addrs.some((a) => /Easter Ave|Unit 4|Bank Rd/.test(a)), addrs.join(" | "));
  });

  await t.test("the counts still describe what the SEARCH found and nothing else", () => {
    assert.deepEqual(report.set_aside_counts, { unit: 1, size: 2 });
    assert.equal("set_aside" in report, false);
  });

  await t.test("a saved deal's notes, written about another subject, never reach the page", () => {
    const savedShown = report.comps.filter((c) => c.from_corpus);
    assert.ok(savedShown.every((c) => !("notes" in c)));
    assert.doesNotMatch(JSON.stringify(report), /next to the target|north of the target/);
  });

  await t.test("COMP_FIT=off is the blend as it was: every saved deal in the circle", async (t2) => {
    const off = await boot({ COMP_FIT: "off" });
    t2.after(() => off.stop());
    const r2 = await (await search(off.base, "76 Inverness Dr E, Englewood, CO")).json();
    assert.equal(r2.corpus_count, 6);
    assert.equal(basisOf(r2), 10);
    assert.doesNotMatch(JSON.stringify(r2), /next to the target|north of the target/, "notes stay off the page either way");
  });
});
