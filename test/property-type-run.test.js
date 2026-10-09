// POST /api/property-type, actually running: the memo, the two passes, and
// the gates, against a stub provider that answers type questions.
//
// NOTHING HERE REACHES A REAL VENDOR: SEARCH_API_URL points every billed call
// at the stub below, and no database is configured, so the memo is the
// child's own property-types.json.

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const shared = require("./helpers/boot");

// What the stub says, per address, per pass. "fail" answers HTTP 500.
const SCRIPT = {
  "100 Office Tower Way": { quick: { type: "Office", confidence: "high", evidence: "A 20-story office tower." } },
  "200 Unsure St": {
    quick: { type: "Industrial", confidence: "low", evidence: "Nothing found; street guess." },
    deep: { type: "Retail", confidence: "high", evidence: "LoopNet lists a strip center." },
  },
  "300 Deep Fails Rd": {
    quick: { type: "Multifamily", confidence: "low", evidence: "Street guess." },
    deep: "fail",
  },
  "400 Slow Ln": { quick: { type: "Land", confidence: "high", evidence: "Vacant parcel listing." }, delayMs: 400 },
  "500 Medium Ave": {
    quick: { type: "Office", confidence: "medium", evidence: "A clinic in a suite." },
    deep: { type: "Office", confidence: "medium", evidence: "Suites listed for lease." },
  },
};

// The report a search returns. Comps cite loopnet.com, a host link-check.js
// never fetches, and the subject carries coordinates so the radius blend never
// geocodes: nothing leaves the machine.
const sale = (n, price, size, date) => ({
  address: `${n} Main St, Boise, ID 83702`, date, transaction: "Sale",
  size_sqft: String(size), price_or_rate: `$${price.toLocaleString("en-US")}`,
  source_type: "public_record", source_url: "https://www.loopnet.com/Listing/example",
  notes: "Arms-length sale.",
});
const REPORT = {
  summary: "Office sales near the subject have been steady.",
  value_drivers: ["Vacancy is easing."], market_trend: "Flat.",
  subject_size_sqft: "20000", subject_size_source: "county records",
  subject_lat: 43.615, subject_lng: -116.2023,
  comps: [sale(10, 4000000, 20000, "2026-05-10"), sale(20, 4200000, 21000, "2026-03-02"),
    sale(30, 3900000, 19500, "2025-12-14"), sale(40, 4100000, 20500, "2026-06-20")],
};

async function startStub() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const sent = JSON.parse(body || "{}");
      const prompt = String(sent.messages && sent.messages[0].content[0].text || "");
      // A report search, not a type question: answer with a small report.
      if (!prompt.includes("What counts as evidence:") && !prompt.includes("parcel or appraisal-district record")) {
        calls.push({ pass: "report", prompt });
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          stop_reason: "end_turn",
          usage: { input_tokens: 1000, output_tokens: 500 },
          content: [{ type: "text", text: JSON.stringify(REPORT) }],
        }));
      }
      const pass = prompt.includes("parcel or appraisal-district record") ? "deep" : "quick";
      const address = Object.keys(SCRIPT).find((a) => prompt.includes(a));
      calls.push({ pass, address, maxUses: sent.tools && sent.tools[0] && sent.tools[0].max_uses, prompt });
      const plan = SCRIPT[address] || {};
      const answer = plan[pass];
      setTimeout(() => {
        if (!answer || answer === "fail") {
          res.writeHead(500, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: { message: "stub refused" } }));
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          stop_reason: "end_turn",
          usage: { input_tokens: 500, output_tokens: 40 },
          content: [{ type: "text", text: JSON.stringify([{ id: "a1", ...answer }]) }],
        }));
      }, plan.delayMs || 0);
    });
  });
  await new Promise((r) => server.listen(0, r));
  return {
    url: `http://localhost:${server.address().port}/v1/messages`,
    calls,
    stop: () => new Promise((r) => server.close(r)),
  };
}

async function bootWith(stub, extra) {
  return shared.boot({
    ACCOUNT_WALL: "off",
    SUPABASE_URL: "", SUPABASE_SERVICE_KEY: "",
    SEARCH_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "test-key-not-a-real-one",
    STREAM_ANTHROPIC: "off",
    SEARCH_API_URL: stub.url,
    ...(extra || {}),
  });
}

const ask = (srv, address) => fetch(srv.base + "/api/property-type", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address }),
});

test("the lookup, end to end", async (t) => {
  const stub = await startStub();
  const srv = await bootWith(stub);
  t.after(async () => { srv.stop(); await stub.stop(); });

  await t.test("a high quick answer is the answer, after one 3-search call", async () => {
    const r = await ask(srv, "100 Office Tower Way, Boise, ID");
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.type, "Office");
    assert.equal(body.confidence, "high");
    assert.equal(body.pass, "quick");
    assert.equal(body.source, "lookup");
    const mine = stub.calls.filter((c) => c.address === "100 Office Tower Way");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].pass, "quick");
    assert.equal(mine[0].maxUses, 3);
  });

  await t.test("the same address again comes from the memo and costs nothing", async () => {
    const before = stub.calls.length;
    const body = await (await ask(srv, "100 office tower way,  boise, id")).json();
    assert.equal(body.type, "Office");
    assert.equal(body.source, "memo");
    assert.equal(stub.calls.length, before);
  });

  await t.test("an unsure quick answer gets the deep pass, and the deep answer wins", async () => {
    const body = await (await ask(srv, "200 Unsure St, Dallas, TX")).json();
    assert.equal(body.type, "Retail");
    assert.equal(body.pass, "deep");
    const mine = stub.calls.filter((c) => c.address === "200 Unsure St");
    assert.deepEqual(mine.map((c) => c.pass), ["quick", "deep"]);
    assert.equal(mine[1].maxUses, 6);
  });

  await t.test("a failed deep pass leaves the quick guess, which is not remembered", async () => {
    const body = await (await ask(srv, "300 Deep Fails Rd, Austin, TX")).json();
    assert.equal(body.type, "Multifamily");
    assert.equal(body.confidence, "low");
    assert.equal(body.pass, "quick");
    const again = await (await ask(srv, "300 Deep Fails Rd, Austin, TX")).json();
    assert.equal(again.source, "lookup", "a street guess must be looked up again, not served from the memo");
    assert.equal(stub.calls.filter((c) => c.address === "300 Deep Fails Rd").length, 4);
  });

  await t.test("a medium answer is remembered", async () => {
    await ask(srv, "500 Medium Ave, Tampa, FL");
    const again = await (await ask(srv, "500 Medium Ave, Tampa, FL")).json();
    assert.equal(again.source, "memo");
    assert.equal(again.type, "Office");
  });

  await t.test("two lookups of one address at once share one call", async () => {
    const [a, b] = await Promise.all([ask(srv, "400 Slow Ln, Nampa, ID"), ask(srv, "400 Slow Ln, Nampa, ID")]);
    assert.equal((await a.json()).type, "Land");
    assert.equal((await b.json()).type, "Land");
    assert.equal(stub.calls.filter((c) => c.address === "400 Slow Ln").length, 1);
  });

  await t.test("an address the stub knows nothing about answers type null, not an error", async () => {
    const r = await ask(srv, "999 Nowhere Rd, Boise, ID");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { type: null });
  });

  await t.test("only a street address is looked up", async () => {
    const before = stub.calls.length;
    const r = await ask(srv, "Downtown Boise");
    assert.equal(r.status, 400);
    assert.equal(stub.calls.length, before);
  });
});

test("under the account wall an anonymous visitor is refused before anything is spent", async (t) => {
  const stub = await startStub();
  const srv = await bootWith(stub, { ACCOUNT_WALL: "on" });
  t.after(async () => { srv.stop(); await stub.stop(); });
  const r = await ask(srv, "100 Office Tower Way, Boise, ID");
  assert.equal(r.status, 403);
  assert.equal((await r.json()).signin_required, true);
  assert.equal(stub.calls.length, 0);
});

test("with no provider key the lookup answers type null and calls nobody", async (t) => {
  const stub = await startStub();
  const srv = await bootWith(stub, { ANTHROPIC_API_KEY: "" });
  t.after(async () => { srv.stop(); await stub.stop(); });
  const r = await ask(srv, "100 Office Tower Way, Boise, ID");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { type: null });
  assert.equal(stub.calls.length, 0);
});

test("/api/comps with no type works the type out first", async (t) => {
  const stub = await startStub();
  // Several searches from one anonymous connection: the one-free-search guest
  // gate is beside the point here (the next test covers the gate).
  const srv = await bootWith(stub, { GUEST_SEARCH_LIMIT: "off" });
  t.after(async () => { srv.stop(); await stub.stop(); });
  const comps = (body) => fetch(srv.base + "/api/comps", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });

  await t.test("the report is searched as the found type and says how it was found", async () => {
    const r = await comps({ address: "100 Office Tower Way, Boise, ID", months: 24 });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.comps) && body.comps.length > 0);
    assert.equal(body.property_type_found.type, "Office");
    assert.equal(body.property_type_found.pass, "quick");
    const order = stub.calls.map((c) => c.pass);
    assert.deepEqual(order.slice(0, 2), ["quick", "report"], "the type is looked up before the search");
    const report = stub.calls.find((c) => c.pass === "report");
    assert.match(report.prompt, /Office/);
  });

  await t.test("a sent type is never second-guessed", async () => {
    const before = stub.calls.length;
    const r = await comps({ address: "500 Medium Ave, Tampa, FL", type: "Retail", months: 24 });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.property_type_found, undefined);
    assert.deepEqual(stub.calls.slice(before).map((c) => c.pass), ["report"]);
  });

  await t.test("an address nobody can type answers 422 and runs no search", async () => {
    const before = stub.calls.length;
    const r = await comps({ address: "999 Nowhere Rd, Boise, ID", months: 24 });
    assert.equal(r.status, 422);
    assert.equal((await r.json()).code, "type_unknown");
    assert.ok(!stub.calls.slice(before).some((c) => c.pass === "report"));
  });
});

test("/api/comps with no type refuses a blocked guest before the billed lookup", async (t) => {
  const stub = await startStub();
  const srv = await bootWith(stub, { ACCOUNT_WALL: "on" });
  t.after(async () => { srv.stop(); await stub.stop(); });
  const r = await fetch(srv.base + "/api/comps", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: "100 Office Tower Way, Boise, ID", months: 24 }),
  });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).signin_required, true);
  assert.equal(stub.calls.length, 0);
});
