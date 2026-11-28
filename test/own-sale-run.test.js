// The building's own sale, wired into a real server.js against a stub search
// provider (valuation.js has the rule, "The building's own sale (2026-11-27)";
// search-pipeline.md has the server half). A recent, vetted sale of the
// subject can now carry up to nine tenths of a report's value, and the page
// leans on nothing the SERVER has not stamped `settled: 1`. So the wiring is
// where the money is: the search must ask for the sale, the subject must not
// be valued against itself, the stamp must come from the server and never
// from the model, it must survive the cache, and OWN_SALE=off must take the
// whole thing back without a deploy.
//
// No real internet request is made. The provider is a local stub reached
// through SEARCH_API_URL. Every source_url in these answers is either on
// loopnet.com (LINKCHECK.hostClass calls it "blocked", so neither
// checkSourceLinks nor ownSalePageVerdict fetches it or even resolves its
// name) or on a host with no dot in it (LINKCHECK.checkableUrl refuses it
// before any DNS lookup), or is not http at all. Census, which the comp fit
// asks for distances, is pointed at a closed local port by helpers/boot.js.
//
// Run: node --test test/own-sale-run.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const shared = require("./helpers/boot");

const ADMIN = "own-sale-run-admin-key";
const DAY = 864e5;
const ISO_DAYS_AGO = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const LOOP = (slug) => `https://www.loopnet.com/Listing/${slug}`;   // bot-walled: never fetched

// Four right-sized priced sales, so the comp fit's floor and the wider search
// (off in every suite but its own) have nothing to do.
function marketComps() {
  return [
    ["4100 Dock St, Denver, CO 80216", "38,000", "$4,900,000"],
    ["4200 Dock St, Denver, CO 80216", "42,000", "$5,300,000"],
    ["5100 Rail Ave, Denver, CO 80216", "36,000", "$4,500,000"],
    ["5200 Rail Ave, Denver, CO 80216", "45,000", "$5,800,000"],
  ].map(([address, size, price], i) => ({ address, transaction: "Sale", date: ISO_DAYS_AGO(90 + i * 30),
    size_sqft: size, price_or_rate: price, source_type: "listing", source_url: LOOP(`comp-${i}`) }));
}
const base = (over) => ({
  summary: "Industrial sales in north Denver have been steady.",
  currency: "USD",
  comps: marketComps(),
  avg_price_per_sqft: "$128",
  market_cap_rate_range: { low: "6.0%", high: "6.75%" },
  value_drivers: ["Vacancy is tight."],
  market_trend: "Stable.",
  search_radius: "5 miles",
  ...over,
});

const SOLD = ISO_DAYS_AGO(200);

// A: a reported, priced sale, plus three rows at the subject's own address
// among the comps: its sale (again), its own listing, and a lease of the
// whole building (sized like the subject, so the comp fit's size rule keeps
// it and only the own-sale rule could move it).
const ADDR_A = "1200 Industrial Pkwy, Denver, CO 80216";
const ANSWER_A = base({
  subject_last_sale: { date: SOLD, price: "$5,200,000", source_url: LOOP("1200-industrial-pkwy-sold"),
    source_type: "listing", address: ADDR_A, size_sqft: "40000", basis: "Arm's length" },
  comps: [
    ...marketComps(),
    { address: "1200 Industrial Pkwy, Denver, CO", transaction: "Sale", date: SOLD, size_sqft: "40,000",
      price_or_rate: "$5,200,000", source_type: "listing", source_url: LOOP("1200-industrial-pkwy-sold") },
    { address: "1200 Industrial Pkwy, Denver, CO 80216", transaction: "Sale", date: "Active", size_sqft: "40,000",
      price_or_rate: "$6,400,000", source_type: "listing", source_url: LOOP("1200-industrial-pkwy-for-sale") },
    { address: "1200 Industrial Pkwy, Denver, CO", transaction: "Lease", date: ISO_DAYS_AGO(120), size_sqft: "40,000",
      price_or_rate: "$9.50/SF/yr", source_type: "listing", source_url: LOOP("1200-industrial-pkwy-lease") },
  ],
});

// B: every key of subject_last_sale in a shape normalizeSubjectLastSale must
// tidy, plus keys it must not let through.
const ADDR_B = "77 Basis Rd, Denver, CO 80216";
const ANSWER_B = base({
  subject_last_sale: { date: SOLD, price: "$3,000,000", source_url: "ftp://records.denvergov.org/77-basis-rd",
    source_type: "Press Release", address: ADDR_B, size_sqft: "21,500 SF", basis: "a friendly deal between neighbours",
    settled: 0, verified: true },
});

// C: a house. The rule does not cover Residential, so whatever the model
// writes there, including a stamp of its own, must not come back stamped.
const ADDR_C = "15 Elm St, Boise, ID 83702";
const ANSWER_C = {
  summary: "Boise home prices have been flat.", currency: "USD",
  subject_last_sale: { date: SOLD, price: "$610,000", source_url: LOOP("15-elm-st"), settled: 1 },
  comps: ["21 Elm St", "33 Oak St", "40 Ash St", "52 Pine St"].map((s, i) => ({
    address: `${s}, Boise, ID 83702`, transaction: "Sale", date: ISO_DAYS_AGO(60 + i * 20), size_sqft: "2,100",
    price_or_rate: `$${600 + i * 10},000`, source_type: "listing", source_url: LOOP(`house-${i}`) })),
  avg_price_per_sqft: "$295", value_drivers: ["Low inventory."], market_trend: "Flat.", search_radius: "1 mile",
};

// D: the reported sale has a date and no price ("terms undisclosed"), and a
// closed sale of the same building sits among the comps, sourced to a news
// page on a dotless host (refused before any lookup).
const ADDR_D = "300 Harbor Dr, Denver, CO 80216";
const HARBOR_NEWS = "https://denverbiz/news/300-harbor-dr-sells";
const ANSWER_D = base({
  subject_last_sale: { date: ISO_DAYS_AGO(400), price: "", source_url: "" },
  comps: [
    ...marketComps(),
    { address: ADDR_D, transaction: "Sale", date: SOLD, size_sqft: "40,000", price_or_rate: "$4,100,000",
      source_type: "news", source_url: HARBOR_NEWS },
  ],
});

const ANSWERS = [[ADDR_A, ANSWER_A], [ADDR_B, ANSWER_B], [ADDR_C, ANSWER_C], [ADDR_D, ANSWER_D]];

// Every string inside the request, joined: the prompt is a text block inside
// messages[0].content, and reading it parsed keeps quotes unescaped.
function textOf(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => textOf(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => textOf(x, out));
  return out;
}

async function startStub() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let sent = {};
      try { sent = JSON.parse(body || "{}"); } catch (_) {}
      const prompt = textOf(sent.messages).join("\n");
      // The target is named before anything else in the prompt; an earlier
      // search's address can turn up further down (its harvested comps are
      // offered back as known deals), so the FIRST address named wins.
      const at = (addr) => { const i = prompt.indexOf(addr); return i < 0 ? Infinity : i; };
      const hit = ANSWERS.filter(([addr]) => at(addr) < Infinity).sort((x, y) => at(x[0]) - at(y[0]))[0];
      calls.push({ prompt, address: hit ? hit[0] : null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 500 },
        content: [{ type: "text", text: JSON.stringify(hit ? hit[1] : base()) }] }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://localhost:${server.address().port}/v1/messages`, calls,
           stop: () => new Promise((r) => server.close(r)) };
}

const bootWith = (stub, extra) => shared.boot({
  ACCOUNT_WALL: "off", GUEST_SEARCH_LIMIT: "20", ADMIN_KEY: ADMIN,
  SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-a-real-one",
  STREAM_ANTHROPIC: "off", SEARCH_API_URL: stub.url, ...extra,
});

// `admin` asks as the internal caller, which gets the whole ungated report
// (set_aside included); without it the request is an anonymous visitor's.
async function search(srv, body, admin = true) {
  const res = await fetch(srv.base + "/api/comps", {
    method: "POST",
    headers: { "content-type": "application/json", ...(admin ? { "x-admin-key": ADMIN } : {}) },
    body: JSON.stringify({ months: 24, ...body }),
  });
  const report = await res.json();
  assert.equal(res.status, 200, JSON.stringify(report).slice(0, 300));
  return report;
}
const promptFor = (stub, addr) => {
  const c = stub.calls.filter((x) => x.address === addr);
  assert.equal(c.length, 1, `exactly one provider call for ${addr}, saw ${c.length}`);
  return c[0].prompt;
};

test("with the rule on, the server asks for the building's own sale, vets it and stamps it", async (t) => {
  const stub = await startStub();
  t.after(() => stub.stop());
  const srv = await bootWith(stub, {});
  t.after(() => srv.stop());

  // A typed size, so the sale gets its own step rather than riding the
  // SUBJECT SIZE step (buildPrompt: subjectSaleStep is for a search whose
  // size is already known).
  const a = await search(srv, { address: ADDR_A, type: "Industrial", subjectSizeSqft: 40000 });

  await t.test("an Industrial search of a street address carries the SUBJECT SALE step and the seven-key template", () => {
    const p = promptFor(stub, ADDR_A);
    assert.match(p, /SUBJECT SALE: among your FIRST searches/);
    assert.match(p, /make ONE search on the TARGET address itself/);
    assert.ok(p.includes(`"subject_last_sale": { "date": "", "price": "", "source_url": "", "source_type": "", "address": "", "size_sqft": "", "basis": "" }`),
      "the template names date, price, source_url, source_type, address, size_sqft and basis");
  });

  // Valued against itself, the building would be counted once as a comp and
  // again as the anchor, and its own asking price would sit in the range.
  await t.test("the subject's own sale and listing leave the comps for set_aside, and a lease at its address stays", () => {
    const addrs = a.comps.map((c) => `${c.address} | ${c.transaction} | ${c.date}`);
    assert.ok(!a.comps.some((c) => /^1200 Industrial Pkwy/.test(c.address) && c.transaction === "Sale"),
      "no sale row at the subject's address is left among the comps: " + addrs.join(" ; "));
    assert.ok(a.comps.some((c) => /^1200 Industrial Pkwy/.test(c.address) && c.transaction === "Lease"),
      "a lease at the subject's address is a real lease comp and stays");
    assert.equal(a.comps.filter((c) => /Dock St|Rail Ave/.test(c.address)).length, 4, "the market's own comps are untouched");
    const own = (a.set_aside || []).filter((c) => /^1200 Industrial Pkwy/.test(c.address));
    assert.equal(own.length, 2);
    assert.ok(own.every((c) => c.set_aside === "own_sale"), JSON.stringify(own.map((c) => c.set_aside)));
    assert.deepEqual(a.set_aside_counts, { own_sale: 2 });
  });

  await t.test("the same-address row on the market becomes the subject's asking price", () => {
    assert.ok(a.subject_asking, "subject_asking was filled from the listing row");
    assert.equal(a.subject_asking.source_url, LOOP("1200-industrial-pkwy-for-sale"));
    assert.match(String(a.subject_asking.price), /6,400,000|6400000/);
  });

  await t.test("the reported sale is kept as reported and stamped settled: 1", () => {
    const s = a.subject_last_sale;
    assert.equal(s.date, SOLD);
    assert.equal(s.price, "$5,200,000");
    assert.equal(s.basis, "arms_length", "\"Arm's length\" is the vocabulary's arms_length");
    assert.equal(s.source_type, "listing");
    assert.equal(s.size_sqft, "40000");
    assert.equal(s.settled, 1);
    assert.equal("from_comp" in s, false, "a priced reported sale is not replaced by a comp row");
  });

  await t.test("normalizeSubjectLastSale tidies every key and lets nothing else through", async (t2) => {
    const b = await search(srv, { address: ADDR_B, type: "Industrial", subjectSizeSqft: 21500 });
    t2.diagnostic(JSON.stringify(b.subject_last_sale));
    assert.deepEqual(b.subject_last_sale, {
      date: SOLD, price: "$3,000,000",
      source_url: "",            // not http(s): never an anchor href
      basis: "other",            // a word off the list reads "other", which does not lean
      source_type: "news",       // a press release is somebody reporting the sale
      address: ADDR_B,
      size_sqft: "21500",
      settled: 1,                // the server's stamp; the model's 0 and its "verified" are gone
    });
  });

  await t.test("a dateable but unpriced sale is replaced by the same building's closed sale sourced to news", async (t2) => {
    const d = await search(srv, { address: ADDR_D, type: "Industrial", subjectSizeSqft: 40000 });
    const s = d.subject_last_sale;
    t2.diagnostic(JSON.stringify(s));
    assert.equal(s.from_comp, true);
    assert.equal(s.date, SOLD);
    assert.equal(s.price, "$4,100,000");
    assert.equal(s.source_url, HARBOR_NEWS);
    assert.equal(s.source_type, "news");
    assert.equal(s.settled, 1);
    // The row's notes say nothing of the sale and the reported line had no
    // basis, so none is written: silence is not "arms_length".
    assert.equal("basis" in s, false);
    assert.ok(!d.comps.some((c) => /^300 Harbor Dr/.test(c.address)), "the promoted row is not also a comp");
  });

  await t.test("a Residential search has no SUBJECT SALE step, and a stamp the model wrote is dropped", async (t2) => {
    const c = await search(srv, { address: ADDR_C, type: "Residential" });
    const p = promptFor(stub, ADDR_C);
    assert.doesNotMatch(p, /SUBJECT SALE/);
    assert.ok(c.subject_last_sale, "the sale is still reported as history");
    assert.equal(c.subject_last_sale.price, "$610,000");
    assert.equal("settled" in c.subject_last_sale, false, JSON.stringify(c.subject_last_sale));
    t2.diagnostic("residential comps: " + c.comps.length);
  });

  // The stamp is written before the cache write; a cached report that lost
  // it would quietly stop leaning on the sale for thirty days.
  await t.test("the same address again is served from the cache, stamp and all, and a visitor sees counts only", async (t2) => {
    const before = stub.calls.length;
    const again = await search(srv, { address: ADDR_A, type: "Industrial", subjectSizeSqft: 40000 }, false);
    assert.equal(stub.calls.length, before, "no second provider call: this was a cache hit");
    assert.equal(again.subject_last_sale && again.subject_last_sale.settled, 1);
    assert.equal(again.subject_last_sale.price, "$5,200,000");
    assert.equal("set_aside" in again, false, "a visitor never gets the set-aside rows");
    assert.equal(again.set_aside_counts && again.set_aside_counts.own_sale, 2);
    t2.diagnostic("visitor comps: " + (again.comps || []).length);
  });
});

test("OWN_SALE=off asks for no sale, takes nothing out of the comps and stamps nothing", async (t) => {
  const stub = await startStub();
  t.after(() => stub.stop());
  const srv = await bootWith(stub, { OWN_SALE: "off" });
  t.after(() => srv.stop());

  const a = await search(srv, { address: ADDR_A, type: "Industrial", subjectSizeSqft: 40000 });
  const p = promptFor(stub, ADDR_A);
  assert.doesNotMatch(p, /SUBJECT SALE/);
  assert.ok(a.subject_last_sale, "the sale is still reported");
  assert.equal(a.subject_last_sale.price, "$5,200,000");
  assert.equal("settled" in a.subject_last_sale, false, JSON.stringify(a.subject_last_sale));
  // Off is the search as it was before the rule: its own-address rows stay.
  assert.ok(a.comps.some((c) => /^1200 Industrial Pkwy/.test(c.address) && c.date === SOLD),
    "the own-address sale row stays among the comps with the rule off");
  assert.equal(((a.set_aside_counts || {}).own_sale) || 0, 0);
});
