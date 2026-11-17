// The truth test, actually running: scripts/truth-test.js against the real
// server.js it boots for itself and a stub search provider.
//
// WHY THIS EXISTS. test/truth-score.test.js proves the scoring. What it
// cannot prove is the runner's promises, and each is a way this tool could
// quietly lie or cost money: a dry run must spend NOTHING; the closed price
// must never be in what the model is sent (it would be the answer in the
// prompt); the server it boots must be cut off from any database; a private
// deal's address and price must stay out of the file that gets committed;
// and re-scoring a saved run must not search again. The stub records every
// request body, so "what did the model actually receive" is read off the
// wire.
//
// NOTHING HERE REACHES A REAL VENDOR, test/archive-first.test.js's
// arrangement: the stub answers every search, comps cite loopnet.com so the
// link check runs its real code with no network, the subject carries its own
// coordinates, and the Census geocoder is pointed at a closed port.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const CLI = path.join(__dirname, "..", "scripts", "truth-test.js");
const DAYS_AGO = (n) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString().slice(0, 10);
const MONTHS_AGO = (n) => {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
};

// Figures no comp below shares, so finding one in a prompt or a committed
// file can only mean it leaked from the answer key.
const PUBLIC_PRICE = 2345678;
const PRIVATE_PRICE = 1987654;
const PRIVATE_STREET = "300 Hidden Ledger Ln";

const SALES = [
  { id: "boi-ind-01", address: "100 Truth Way, Boise, ID 83702", type: "Industrial",
    sale_price: PUBLIC_PRICE, sale_date: MONTHS_AGO(4), size_sqft: 20000, source: "https://example.com/deed", checked: true },
  // Not closed yet: searched, its prediction stored, nothing scored.
  { id: "boi-ind-open", address: "200 Open Rd, Boise, ID 83702", type: "Industrial", size_sqft: 20000 },
];
const PRIVATE = [
  { id: "deal-01", address: PRIVATE_STREET + ", Boise, ID 83702", type: "Industrial",
    sale_price: PRIVATE_PRICE, sale_date: MONTHS_AGO(3), size_sqft: 20000, source: "closing statement", checked: true },
];

function reportFor(prompt) {
  const comp = (n, psf) => ({
    address: `${n} Web Found Way, Boise, ID 83702`,
    date: DAYS_AGO(150 + n * 10), transaction: "Sale",
    size_sqft: "15000", price_or_rate: "$" + (psf * 15000).toLocaleString("en-US"),
    source_type: "public_record",
    source_url: "https://www.loopnet.com/Listing/example",
    notes: "Arms-length sale.",
  });
  const comps = [comp(1, 101), comp(2, 109), comp(3, 117), comp(4, 125), comp(5, 133)];
  const rep = {
    summary: "Industrial sales in Boise have been steady.",
    currency: "USD",
    subject_size_sqft: "20000",
    subject_lat: 43.615, subject_lng: -116.2023,
    comps,
    avg_price_per_sqft: "$117",
    market_cap_rate_range: "6.0% - 6.75%",
    value_drivers: ["Vacancy is tight."],
    market_trend: "Stable.",
    search_radius: "5 miles",
    transactions_reviewed: 9,
  };
  // What a real search does for a sale the web holds: it finds the building's
  // own sale, and here it also (against the prompt's rule) lists it as a comp.
  if (prompt.includes("100 Truth Way")) {
    rep.subject_last_sale = { date: "Jul 2026", price: "$" + PUBLIC_PRICE.toLocaleString("en-US"), source_url: "https://www.loopnet.com/Listing/own" };
    comps.push(Object.assign(comp(6, 999), { address: "100 Truth Way, Boise, ID 83702" }));
  }
  return rep;
}

async function startStubProvider() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      calls.push(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        stop_reason: "end_turn",
        usage: { input_tokens: 1000, output_tokens: 500 },
        content: [{ type: "text", text: JSON.stringify(reportFor(body)) }],
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

function cli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: {
        ...process.env,
        // Everything a developer's own .env could change about this run.
        SEARCH_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "test-key-not-a-real-one",
        GEMINI_API_KEY: "",
        MODEL: "",
        THINKING_LEVEL: "",
        STREAM_ANTHROPIC: "off",
        CENSUS_API_URL: "http://127.0.0.1:9/census-unset",
        GOOGLE_MAPS_API_KEY: "",
        // A real database the runner must refuse to carry into its server.
        SUPABASE_URL: "https://should-never-be-reached.supabase.co",
        SUPABASE_SERVICE_KEY: "service-key-that-must-be-blanked",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cn-truth-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const set = path.join(dir, "truth.json");
  const priv = path.join(dir, "private.json");
  fs.writeFileSync(set, JSON.stringify({ sales: SALES }));
  fs.writeFileSync(priv, JSON.stringify({ sales: PRIVATE }));
  const common = ["--set", set, "--private", priv, "--out", dir, "--label", "t"];
  const only = (sub) => {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).map((f) => path.join(d, f));
  };
  return { dir, set, priv, common, only };
}

test("without --yes it prints the plan and spends nothing", async (t) => {
  const stub = await startStubProvider();
  t.after(() => stub.stop());
  const f = fixture(t);
  const r = await cli(f.common, { SEARCH_API_URL: stub.url });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /The truth test: 3 buildings/);
  assert.match(r.stdout, /2 closed, 1 still open/);
  assert.match(r.stdout, /Nothing was spent\. Add --yes to run it\./);
  assert.equal(stub.calls.length, 0, "a dry run reached the search provider");
  assert.deepEqual(f.only("docs"), [], "a dry run wrote a summary");
  assert.deepEqual(f.only("eval-runs"), [], "a dry run wrote a run");
});

test("a typo in the answer key stops the run before anything is spent", async (t) => {
  const stub = await startStubProvider();
  t.after(() => stub.stop());
  const f = fixture(t);
  fs.writeFileSync(f.set, JSON.stringify({ sales: [Object.assign({}, SALES[0], { sale_date: "July 2026" })] }));
  const r = await cli(f.common.concat(["--yes"]), { SEARCH_API_URL: stub.url });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /boi-ind-01: sale_date must be/);
  assert.equal(stub.calls.length, 0);
});

test("a real run scores the closed sales, stores the open one, and keeps the answer key to itself", async (t) => {
  const stub = await startStubProvider();
  t.after(() => stub.stop());
  const f = fixture(t);
  const r = await cli(f.common.concat(["--yes"]), { SEARCH_API_URL: stub.url });
  assert.equal(r.code, 0, r.stdout + r.stderr);

  // One search per building, each carrying the address and never the price.
  assert.equal(stub.calls.length, 3, r.stdout);
  const sent = stub.calls.join("\n");
  ["100 Truth Way", "200 Open Rd", PRIVATE_STREET].forEach((a) => assert.ok(sent.includes(a), a + " was not searched"));
  [PUBLIC_PRICE, PRIVATE_PRICE].forEach((p) => {
    assert.ok(!sent.includes(String(p)), "a closed price was sent to the model");
    assert.ok(!sent.includes(p.toLocaleString("en-US")), "a closed price was sent to the model");
  });

  // Each building is searched cold. On one shared server the second search
  // in a market is handed the comps the first one saved, the first building's
  // own sale among them, and the score then depends on the order of the file.
  stub.calls.forEach((body) => {
    assert.ok(!body.includes("Web Found Way"), "a search was handed comps an earlier building's search found");
    assert.equal(["100 Truth Way", "200 Open Rd", PRIVATE_STREET].filter((a) => body.includes(a)).length, 1,
      "one building's prompt names another building in the answer key");
  });

  // The server it booted had no database, though this process's environment
  // named one: the run says so, and a server that reached for it would have
  // failed every search.
  assert.match(r.stdout, /no database, nothing saved/);

  const files = f.only(path.join("docs", "evals"));
  assert.equal(files.length, 1, "one summary to commit");
  assert.match(path.basename(files[0]), /^\d{4}-\d{2}-\d{2}-truth-t-\d+\.json$/);
  const text = fs.readFileSync(files[0], "utf8");
  const out = JSON.parse(text);
  assert.equal(out.kind, "truth-test");
  assert.equal(out.provider, "anthropic");
  assert.equal(out.summary.scored, 2);
  assert.equal(out.summary.open, 1);
  assert.equal(out.summary.failed, 0);
  assert.equal(out.summary.hitRate, 1);

  const byId = Object.fromEntries(out.rows.map((row) => [row.id, row]));
  // The public sale: scored, the building's own sale found, and its own row
  // in the comps taken out before valuing (at $999/SF it would have shown).
  const pub = byId["boi-ind-01"];
  assert.equal(pub.status, "scored");
  assert.equal(pub.address, "100 Truth Way, Boise, ID 83702");
  assert.equal(pub.leakedComps, 1);
  assert.equal(pub.knewPrice, true);
  assert.equal(pub.ownSale.matches, true);
  assert.equal(pub.served.sale_comps, 5);
  assert.equal(pub.size.error, 0);
  assert.ok(pub.served.likely > 2000000 && pub.served.likely < 2500000, "likely " + pub.served.likely);
  assert.ok(pub.miss.absError < 0.15, "miss " + pub.miss.error);
  // The open one: a prediction, and nothing to hold it against.
  const open = byId["boi-ind-open"];
  assert.equal(open.status, "open");
  assert.equal(open.miss, null);
  assert.equal(open.served.likely, pub.served.likely);

  // The private deal: its percentages, and nothing that names it.
  const priv = byId["deal-01"];
  assert.equal(priv.private, true);
  assert.equal(priv.status, "scored");
  assert.ok(Number.isFinite(priv.miss.error));
  assert.equal(priv.knewPrice, false);
  ["address", "market", "truth", "served"].forEach((k) => assert.ok(!(k in priv), "the committed private row carries " + k));
  ["Hidden Ledger", String(PRIVATE_PRICE), PRIVATE_PRICE.toLocaleString("en-US")]
    .forEach((needle) => assert.ok(!text.includes(needle), "the committed summary holds " + needle));

  // The full run is kept apart, for --rescore.
  const runDirs = f.only("eval-runs");
  assert.equal(runDirs.length, 1);
  const runFile = path.join(runDirs[0], "run.json");
  const run = JSON.parse(fs.readFileSync(runFile, "utf8"));
  assert.equal(run.kind, "truth-run");
  assert.equal(run.items.length, 3);
  assert.ok(run.items.every((it) => it.report && Array.isArray(it.report.comps)));

  // The open building closes. Re-scoring holds the STORED prediction against
  // the new price, and runs no search.
  const closedAt = Math.round(open.served.likely / 1.25);
  fs.writeFileSync(f.set, JSON.stringify({ sales: [SALES[0],
    Object.assign({}, SALES[1], { sale_price: closedAt, sale_date: MONTHS_AGO(0) })] }));
  const before = stub.calls.length;
  const again = await cli(["--rescore", runFile, "--set", f.set, "--private", f.priv, "--out", f.dir], { SEARCH_API_URL: stub.url });
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.equal(stub.calls.length, before, "a re-score ran a search");
  assert.match(again.stdout, /Re-scored 3 buildings/);
  const rescored = f.only(path.join("docs", "evals")).filter((p) => /truth-t-rescored-/.test(p));
  assert.equal(rescored.length, 1);
  const out2 = JSON.parse(fs.readFileSync(rescored[0], "utf8"));
  assert.equal(out2.summary.scored, 3);
  assert.equal(out2.summary.open, 0);
  const closed = out2.rows.find((row) => row.id === "boi-ind-open");
  assert.equal(closed.status, "scored");
  assert.equal(closed.served.likely, open.served.likely, "the prediction is the one made at the time");
  assert.ok(Math.abs(closed.miss.error - 0.25) < 0.001, "miss " + closed.miss.error);

  // And the two summaries compare, pair for pair, on what both scored.
  const cmp = await cli(["--compare", files[0], rescored[0]], {});
  assert.equal(cmp.code, 0, cmp.stderr);
  assert.match(cmp.stdout, /Buildings scored in both: 2/);
  assert.match(cmp.stdout, /Inside the noise/);
});

test("an unknown flag is refused before anything runs", async () => {
  const r = await cli(["--yess"], {});
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Unrecognized flag: --yess/);
});
