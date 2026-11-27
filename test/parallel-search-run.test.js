// The two-lane search, wired into a real server.js against a stub provider.
// On by default since 2026-11-27 (server.js PARALLEL_SEARCH has the reason:
// more comps per report without a longer search). test/helpers/boot.js turns
// it off for every other suite, so this is the one place it runs.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const shared = require("./helpers/boot");

const MONTH = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 7);
const LOOP = "https://www.loopnet.com/Listing/example";   // bot-walled: never fetched
const sale = (address, price) => ({ address, date: MONTH, transaction: "Sale", size_sqft: "30,000",
  price_or_rate: price, source_type: "listing", source_url: LOOP });

const PRIMARY = {
  summary: "Industrial sales have been steady.", currency: "USD",
  comps: [sale("1 First St, Boise, ID", "$6,000,000"), sale("2 First St, Boise, ID", "$6,300,000"),
          sale("3 Shared Ave, Boise, ID", "$6,600,000")],
  avg_price_per_sqft: "$210", market_cap_rate_range: { low: "6.0%", high: "6.75%" },
  value_drivers: ["Vacancy is tight."], market_trend: "Stable.",
};
const RECORDS = {
  currency: "USD", subject_size_sqft: "32000", subject_size_source: "public_record",
  comps: [sale("3 Shared Ave, Boise, ID", "$6,600,000"),   // both lanes found it: kept once
          sale("4 Record Rd, Boise, ID", "$6,900,000"), sale("5 Record Rd, Boise, ID", "$7,200,000")],
};

async function startStub() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const prompt = JSON.stringify((JSON.parse(body || "{}")).messages || "");
      const records = /START WITH NEWS, PRESS AND PUBLIC RECORDS/.test(prompt);
      calls.push(records ? "records" : /START WITH BROKERAGE AND LISTING SOURCES/.test(prompt) ? "primary" : "solo");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 500 },
        content: [{ type: "text", text: JSON.stringify(records ? RECORDS : PRIMARY) }] }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://localhost:${server.address().port}/v1/messages`, calls,
           stop: () => new Promise((r) => server.close(r)) };
}

const ENV = (stub, extra) => ({
  ACCOUNT_WALL: "off", GUEST_SEARCH_LIMIT: "5", ADMIN_KEY: "test-admin-key",
  SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-a-real-one",
  STREAM_ANTHROPIC: "off", SEARCH_API_URL: stub.url, ...extra,
});
// As an internal caller, so the whole comp list comes back ungated.
const search = (base) => fetch(base + "/api/comps", {
  method: "POST", headers: { "content-type": "application/json", "x-admin-key": "test-admin-key" },
  body: JSON.stringify({ address: "100 Subject Way, Boise, ID", type: "Industrial", months: 24 }),
});

test("two lanes run for one report, and their comps are merged without a repeat", async (t) => {
  const stub = await startStub();
  t.after(() => stub.stop());
  const srv = await shared.boot(ENV(stub, { PARALLEL_SEARCH: "on" }));
  t.after(() => srv.stop());
  const res = await search(srv.base);
  const report = await res.json();
  assert.equal(res.status, 200, JSON.stringify(report).slice(0, 300));
  assert.deepEqual(stub.calls.slice().sort(), ["primary", "records"]);
  const addrs = report.comps.map((c) => c.address).sort();
  assert.deepEqual(addrs, ["1 First St, Boise, ID", "2 First St, Boise, ID", "3 Shared Ave, Boise, ID",
    "4 Record Rd, Boise, ID", "5 Record Rd, Boise, ID"]);
  // The primary lane owns the narrative; the records lane owns the size.
  assert.equal(report.summary, PRIMARY.summary);
  assert.equal(String(report.subject_size_sqft), "32000");
});

test("PARALLEL_SEARCH=off is one call, as before", async (t) => {
  const stub = await startStub();
  t.after(() => stub.stop());
  const srv = await shared.boot(ENV(stub, { PARALLEL_SEARCH: "off" }));
  t.after(() => srv.stop());
  const res = await search(srv.base);
  const report = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(stub.calls, ["solo"]);
  assert.equal(report.comps.length, 3);
});

test("the two-lane search is on unless it is switched off, and the suites switch it off", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(src, /const PARALLEL_SEARCH = !\/\^\(0\|off\|false\|no\)\$\/i\.test\(String\(process\.env\.PARALLEL_SEARCH \|\| ""\)\);/);
  const boot = fs.readFileSync(path.join(__dirname, "helpers", "boot.js"), "utf8");
  assert.match(boot, /PARALLEL_SEARCH: "off",/);
});
