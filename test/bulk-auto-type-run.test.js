// A Comp report run with no picked type (2026-10-09): each address is looked
// up first and searched as its own type, against a stub provider that answers
// both the type questions and the report searches.
//
// WHY THIS EXISTS. The run's type box silently started on Industrial, so a list
// nobody set valued every office and apartment as a warehouse. The box is gone;
// this proves the worker that replaced it: one list, several types, each row
// searched, valued and filed as what it is, and a row nothing can type failing
// alone, retryable.
//
// NOTHING HERE REACHES A REAL VENDOR (SEARCH_API_URL is the stub below; the
// database is the stand-in; comps cite loopnet.com, which link-check.js never
// fetches; the subject carries coordinates so nothing is geocoded).

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const PAT = { id: "22222222-2222-4222-8222-222222222222", email: "pat@brokerage.com", name: "Pat" };

// What each address is, to the stub. Flipped by the retry test.
const KNOWN = {
  "1 Office Plaza": { type: "Office", confidence: "high", evidence: "A Class A office tower." },
  "2 Warehouse Way": { type: "Industrial", confidence: "high", evidence: "A 30-ft clear warehouse." },
};

function reportFor() {
  const sale = (n, price, size, date) => ({
    address: `${n} Main St, Boise, ID 83702`, date, transaction: "Sale",
    size_sqft: String(size), price_or_rate: `$${price.toLocaleString("en-US")}`,
    source_type: "public_record", source_url: "https://www.loopnet.com/Listing/example",
    notes: "Arms-length sale.",
  });
  return {
    summary: "Sales near the subject have been steady.",
    value_drivers: ["Vacancy is tight."], market_trend: "Flat.",
    subject_size_sqft: "20000", subject_size_source: "county records",
    subject_lat: 43.615, subject_lng: -116.2023,
    comps: [sale(100, 1900000, 20000, "2026-05-10"), sale(200, 2050000, 20500, "2026-03-02"),
      sale(300, 1750000, 19000, "2025-12-14"), sale(400, 2200000, 21000, "2026-06-20")],
  };
}

async function startStub() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const sent = JSON.parse(body || "{}");
      const prompt = String(sent.messages && sent.messages[0].content[0].text || "");
      const reply = (text) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 100 },
          content: [{ type: "text", text }],
        }));
      };
      const isType = prompt.includes("What counts as evidence:") || prompt.includes("parcel or appraisal-district record");
      const address = ["1 Office Plaza", "2 Warehouse Way", "3 Mystery Ln"].find((a) => prompt.includes(a)) || "";
      calls.push({ kind: isType ? "type" : "report", address, prompt });
      if (!isType) return reply(JSON.stringify(reportFor()));
      const known = KNOWN[address];
      if (!known) {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "stub: unknown address" } }));
      }
      reply(JSON.stringify([{ id: "a1", ...known }]));
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
    bulk_jobs: [], bulk_job_items: [], portfolio_items: [], recent_searches: [],
    comp_corpus: [], search_cache: [], analytics_events: [],
    comp_submissions: [], subject_sizes: [], subject_types: [], market_pages: [],
  };
  const db = await fake.start({ tables });
  const stub = await startStub();
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
    SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-a-real-one",
    STREAM_ANTHROPIC: "off", SEARCH_API_URL: stub.url,
  });
  return { db, srv, stub, tables, stop: async () => { srv.stop(); await stub.stop(); await db.stop(); } };
}

const as = (init = {}) => ({
  ...init,
  headers: { "content-type": "application/json", cookie: `cn_session=tok-${PAT.id}`, ...(init.headers || {}) },
});

async function waitForJob(base, id, { timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = await (await fetch(`${base}/api/bulk?id=${encodeURIComponent(id)}`, as())).json();
    if (body.job && body.job.status !== "running") return body;
    if (Date.now() > deadline) throw new Error(`job never finished: ${JSON.stringify(body.job)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test("a run with no picked type values each address as its own type", async (t) => {
  const ctx = await bootAll();
  t.after(() => ctx.stop());
  const { srv, tables, stub } = ctx;

  const started = await fetch(srv.base + "/api/bulk", as({
    method: "POST",
    body: JSON.stringify({
      text: "1 Office Plaza, Boise, ID 83702\n2 Warehouse Way, Boise, ID 83702\n3 Mystery Ln, Boise, ID 83702",
      months: 24,
    }),
  }));
  const startedBody = await started.json();
  assert.equal(started.status, 200, JSON.stringify(startedBody));
  assert.equal(startedBody.job.property_type, "Auto");
  const finished = await waitForJob(srv.base, startedBody.job.id);
  const row = (a) => finished.items.find((it) => it.address.startsWith(a));

  await t.test("each findable row is searched, valued and labelled as its own type", () => {
    assert.equal(row("1 Office Plaza").status, "done", row("1 Office Plaza").error || "");
    assert.equal(row("2 Warehouse Way").status, "done", row("2 Warehouse Way").error || "");
    assert.equal(row("1 Office Plaza").property_type, "Office");
    assert.equal(row("2 Warehouse Way").property_type, "Industrial");
    assert.ok(row("1 Office Plaza").value_likely > 0);
    const reportFor = (a) => stub.calls.find((c) => c.kind === "report" && c.address === a);
    assert.match(reportFor("1 Office Plaza").prompt, /\bOffice\b/);
    assert.match(reportFor("2 Warehouse Way").prompt, /\bIndustrial\b/);
  });

  await t.test("a row's type is looked up before its own search, never after", () => {
    for (const a of ["1 Office Plaza", "2 Warehouse Way"]) {
      const mine = stub.calls.filter((c) => c.address === a).map((c) => c.kind);
      assert.deepEqual(mine, ["type", "report"], a);
    }
  });

  await t.test("a row nothing can type fails alone, with words a member can act on, and costs no search", () => {
    const m = row("3 Mystery Ln");
    assert.equal(m.status, "failed");
    assert.match(m.error, /Couldn't tell what kind of property this is/);
    assert.ok(!stub.calls.some((c) => c.kind === "report" && c.address === "3 Mystery Ln"));
    assert.equal(finished.job.status, "done", "one untypeable row never stops the run");
  });

  await t.test("each row's report is filed under its own type", () => {
    for (const [a, type] of [["1 Office Plaza", "Office"], ["2 Warehouse Way", "Industrial"]]) {
      const saved = tables.recent_searches.find((x) => x.id === row(a).recent_item_id);
      assert.ok(saved, a);
      assert.equal(saved.property_type, type);
      assert.equal(saved.payload.meta.type, type);
    }
  });

  await t.test("the file names each row's type and says the run had none picked", async () => {
    const r = await fetch(`${srv.base}/api/bulk/export.csv?id=${encodeURIComponent(finished.job.id)}`, as());
    assert.equal(r.status, 200);
    const csv = await r.text();
    const [title, header, ...rows] = csv.split(/\r?\n/);
    assert.match(title, /type found per address/);
    const cols = header.split(",");
    const at = cols.indexOf("property_type");
    assert.ok(at >= 0);
    const office = rows.find((l) => l.includes("1 Office Plaza"));
    assert.equal(office.split(",")[at + 2], "Office", "the property_type cell (the address cell holds two commas)");
    assert.ok(cols.includes("clear_height") && cols.includes("units"), "every type's detail columns");
  });

  await t.test("retrying the untyped row looks it up again", async () => {
    KNOWN["3 Mystery Ln"] = { type: "Retail", confidence: "medium", evidence: "A strip center." };
    const r = await fetch(srv.base + "/api/bulk/item/retry", as({
      method: "POST", body: JSON.stringify({ id: row("3 Mystery Ln").id }),
    }));
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    const again = await waitForJob(srv.base, finished.job.id);
    const m = again.items.find((it) => it.address.startsWith("3 Mystery Ln"));
    assert.equal(m.status, "done", m.error || "");
    assert.equal(m.property_type, "Retail");
  });
});

test("a run with a type sent is searched as that type and never looked up", async (t) => {
  const ctx = await bootAll();
  t.after(() => ctx.stop());
  const { srv, stub } = ctx;
  const started = await fetch(srv.base + "/api/bulk", as({
    method: "POST",
    body: JSON.stringify({ text: "1 Office Plaza, Boise, ID 83702", type: "Retail", months: 24 }),
  }));
  const body = await started.json();
  assert.equal(started.status, 200, JSON.stringify(body));
  assert.equal(body.job.property_type, "Retail");
  const finished = await waitForJob(srv.base, body.job.id);
  assert.equal(finished.items[0].status, "done", finished.items[0].error || "");
  assert.equal(finished.items[0].property_type, null);
  assert.ok(!stub.calls.some((c) => c.kind === "type"), "a sent type is never second-guessed");
});

test("an unknown type is refused by name", async (t) => {
  const ctx = await bootAll();
  t.after(() => ctx.stop());
  const r = await fetch(ctx.srv.base + "/api/bulk", as({
    method: "POST", body: JSON.stringify({ text: "1 Office Plaza, Boise, ID", type: "Castle", months: 24 }),
  }));
  assert.equal(r.status, 400);
  const err = (await r.json()).error;
  assert.match(err, /Unknown property type "Castle"/);
  assert.match(err, /Industrial/, "the refusal names the types that are accepted");
});
