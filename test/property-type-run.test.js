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

async function startStub() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const sent = JSON.parse(body || "{}");
      const prompt = String(sent.messages && sent.messages[0].content[0].text || "");
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
