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

async function startStub() {
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
      const text = JSON.stringify(/WIDER SEARCH FOR SIZE-MATCHED SALES/.test(prompt) ? WIDER : FIRST);
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
