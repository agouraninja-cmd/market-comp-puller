// scripts/truth-test.js: the pure half. Requiring the script runs nothing
// (main is behind require.main), and nothing here makes a request.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const TT = require("../scripts/truth-test");

const NOW = Date.parse("2026-11-27");
const comp = (address, psf, over) => ({ address, transaction: "Sale", date: "2026-06", size_sqft: "10000",
  price_per_sqft: String(psf), source_type: "public_record", ...over });
const target = { address: "100 Main St, Boise, ID", type: "Industrial", sold: 1000000 };

test("a report is scored against the sale price, with the building's own sale taken out", () => {
  const report = {
    subject_size_sqft: "10000",
    comps: [comp("1 A St, Boise, ID", 90), comp("2 B St, Boise, ID", 110), comp("3 C St, Boise, ID", 100),
            comp("4 D St, Boise, ID", 100),
            // The subject's own sale, respelled: a report must not be graded
            // on a price it was shown.
            comp("100 Main Street, Boise, ID 83702", 500)],
    _call: { billed_calls: 2, cost_usd: 0.02 },
  };
  const r = TT.scoreReport(target, report, NOW);
  assert.equal(r.ownSaleRemoved, 1);
  assert.equal(r.comps, 4);
  assert.equal(r.saleComps, 4);
  assert.equal(r.likely, 1000000);
  assert.equal(r.miss, 0);
  assert.equal(r.inRange, true);
  assert.equal(r.calls, 2);
  // Nothing in this report is a settled sale of the building, so the second
  // score is the first one over again and nothing "leaned".
  assert.equal(r.leaned, false);
  assert.equal(r.shownLikely, r.likely);
  assert.equal(r.shownMiss, 0);
  assert.equal(r.ownSale, null);
  // For any other building, that fifth comp is just a comp and stays.
  const other = TT.scoreReport({ ...target, address: "999 Elsewhere Rd, Boise, ID" }, report, NOW);
  assert.equal(other.ownSaleRemoved, 0);
  assert.equal(other.comps, 5);
});

// The reason the script prints two scores. Every building in the set has
// sold and the answer key IS that sale, so a report that leans on the sale
// lands on the answer by construction. Scored as one figure, that would read
// as accuracy.
test("a report that leans on the building's own sale is scored twice, and the comps-only score never sees the sale", () => {
  const sale = { date: "2026-09", price: "$1,000,000", source_url: "https://news.example.com/deals/100-main-st-sells",
    source_type: "news", address: "100 Main St, Boise, ID", basis: "arms_length", settled: 1 };
  const report = {
    subject_size_sqft: "10000", currency: "USD", subject_last_sale: sale,
    // Comps at half the building's own price: other buildings, badly matched.
    comps: [comp("1 A St, Boise, ID", 45), comp("2 B St, Boise, ID", 55), comp("3 C St, Boise, ID", 50), comp("4 D St, Boise, ID", 50)],
  };
  const r = TT.scoreReport(target, report, NOW);
  // COMPS ONLY: $50/SF x 10,000 SF, as if the sale had never been found.
  assert.equal(r.likely, 500000);
  assert.equal(r.miss, -0.5);
  // AS SHOWN: it starts from the sale, so it lands beside it.
  assert.equal(r.leaned, true);
  assert.ok(Math.abs(r.shownMiss) < 0.06, "leaning on the sale lands near the sale: " + r.shownMiss);
  assert.equal(r.shownInRange, true);
  assert.equal(r.ownSale.refused, null);
  assert.ok(r.ownSale.weight >= 0.5);
  // A sale the server never stamped is one the page does not lean on, and
  // the script says why instead of quietly scoring it as a find.
  const unstamped = TT.scoreReport(target, { ...report, subject_last_sale: { ...sale, settled: undefined } }, NOW);
  assert.equal(unstamped.leaned, false);
  assert.equal(unstamped.ownSale.refused, "unsettled");
  assert.equal(unstamped.shownMiss, -0.5);
  // The search corrected the address, and the sale is recorded under the
  // corrected one. COMPS ONLY must still never see it: valued with the sale
  // left in, this report lands at about $965,000, the answer key echoed into
  // the one figure the docs call accuracy.
  const corrected = TT.scoreReport(target, { ...report, subject_address_corrected: "100 Main St, Boise, ID 83702",
    subject_last_sale: { ...sale, address: "100 Main St, Boise, ID 83702" } }, NOW);
  assert.equal(corrected.likely, 500000, "COMPS ONLY never weighs the building's own sale");
  // The input is not edited: the same report scores the same twice.
  assert.deepEqual(TT.scoreReport(target, report, NOW), r);
  assert.ok(report.subject_last_sale, "scoring must not strip the caller's report");
});

test("the summary keeps the two scores apart and leaves an asking price out of both", () => {
  const rows = [
    { address: "a", check: "confirmed", miss: -0.40, inRange: false, shownMiss: 0.02, shownInRange: true, leaned: true, ownSale: { refused: null }, saleComps: 4 },
    { address: "b", check: "confirmed", miss: 0.20, inRange: true, shownMiss: 0.20, shownInRange: true, leaned: false, ownSale: { refused: "basis" }, saleComps: 6 },
    { address: "c", check: "unverified", miss: 0.60, inRange: false, shownMiss: 0.60, shownInRange: false, leaned: false, ownSale: null, saleComps: 5 },
    // "Sold" for its own asking price: there is no answer to score against.
    { address: "d", check: "asking", miss: 0.01, inRange: true, shownMiss: 0.01, shownInRange: true, leaned: true, ownSale: { refused: null }, saleComps: 9 },
  ];
  const s = TT.summarize(rows);
  assert.equal(s.buildings, 4);
  assert.equal(s.notASale, 1);
  assert.equal(s.valued, 3);
  // The headline figures are the comps-only score, as they always were.
  assert.equal(s.medianMiss, 0.40);
  assert.equal(s.within10, 0);
  assert.equal(s.confirmed.n, 2);
  assert.ok(Math.abs(s.confirmed.medianMiss - 0.30) < 1e-12);
  // The other score, split by whether the report leaned on the sale.
  assert.equal(s.shown.all.n, 3);
  assert.equal(s.shown.leaned.n, 1);
  assert.equal(s.shown.leaned.medianMiss, 0.02);
  assert.equal(s.shown.notLeaned.n, 2);
  assert.ok(Math.abs(s.shown.notLeaned.medianMiss - 0.40) < 1e-12);
  assert.deepEqual(s.shown.refusals, { basis: 1, none_found: 1 });
  assert.ok(Math.abs(s.saleComps - 5) < 1e-12, "the asking row's comps are not averaged in either");
});

test("an asking-price row is not run, and a saved report is replayed with no request", (t) => {
  const targets = [{ address: "1 A St, Boise, ID", check: "confirmed" }, { address: "2 B St, Boise, ID", check: "asking" }, { address: "3 C St, Boise, ID" }];
  assert.deepEqual(TT.runnable(targets).map((x) => x.address), ["1 A St, Boise, ID", "3 C St, Boise, ID"]);
  assert.equal(TT.runnable(targets, true).length, 3);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "truth-replay-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const report = { subject_size_sqft: "10000", comps: [comp("1 A St, Boise, ID", 90), comp("2 B St, Boise, ID", 110), comp("3 C St, Boise, ID", 100), comp("4 D St, Boise, ID", 100)] };
  fs.writeFileSync(path.join(dir, "100-main-st.json"), JSON.stringify({ target, fetchedAt: "2026-11-27T00:00:00.000Z", report }));
  fs.writeFileSync(path.join(dir, "broken.json"), "{ not json");
  fs.writeFileSync(path.join(dir, "notes.txt"), "ignored");
  // The row takes its `check` from the truth set as it stands today, so a
  // building vetted after the run is read with what is known now.
  const rows = TT.replayRows(dir, { targets: [{ ...target, check: "confirmed" }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].check, "confirmed");
  assert.equal(rows[0].miss, 0);
  assert.equal(rows[0].replayed, "100-main-st.json");
  // And the script still makes a request only from runOne.
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "truth-test.js"), "utf8");
  const replay = src.slice(src.indexOf("function replayRows"), src.indexOf("async function runOne"));
  assert.ok(replay.length > 200 && !/post\(|execFile|fetch\(/.test(replay), "replaying must not reach the network");
});

test("a report with no size or no priced sale is counted as not valued, never as a zero miss", () => {
  const noSize = TT.scoreReport(target, { comps: [comp("1 A St, Boise, ID", 90), comp("2 B St, Boise, ID", 110), comp("3 C St, Boise, ID", 100)] }, NOW);
  assert.equal(noSize.miss, null);
  const empty = TT.scoreReport(target, { subject_size_sqft: "10000", comps: [] }, NOW);
  assert.equal(empty.miss, null);
  const s = TT.summarize([noSize, empty, { address: "x", error: "503" }]);
  assert.equal(s.valued, 0);
  assert.equal(s.failed, 1);
  assert.equal(s.medianMiss, null);
});

test("the summary is the median of absolute misses, with the mean capped at 100%", () => {
  const rows = [0.05, -0.10, 0.30, -0.60, 4.0].map((miss, i) => ({ address: String(i), miss, inRange: i < 2, saleComps: 4, seconds: 30 + i * 10, cost: 0.01, calls: 1 }));
  const s = TT.summarize(rows);
  assert.equal(s.medianMiss, 0.30);
  assert.ok(Math.abs(s.meanMiss - (0.05 + 0.10 + 0.30 + 0.60 + 1) / 5) < 1e-12);
  assert.equal(s.within10, 2 / 5);
  assert.equal(s.within20, 2 / 5);
  assert.equal(s.over50, 2 / 5);
  assert.equal(s.inRange, 2 / 5);
  assert.equal(s.overMinute, 1);
  assert.equal(s.slowest, 70);
});

test("two runs are compared only on buildings valued in both, and report the swing between them", () => {
  const a = { rows: [{ address: "1 A St, Boise, ID", type: "Office", miss: 0.10, saleComps: 4 },
                     { address: "2 B St, Boise, ID", type: "Office", miss: -0.40, saleComps: 3 },
                     { address: "3 C St, Boise, ID", type: "Office", miss: null, saleComps: 0 }] };
  const b = { rows: [{ address: "1 A Street, Boise, ID", type: "Office", miss: -0.20, saleComps: 8 },
                     { address: "2 B St, Boise, ID", type: "Office", miss: -0.10, saleComps: 7 },
                     { address: "3 C St, Boise, ID", type: "Office", miss: 0.05, saleComps: 6 }] };
  const c = TT.compare(a, b);
  assert.equal(c.pairs, 2, "the building one run could not value is not an improvement in the other");
  assert.equal(c.better, 1);
  assert.equal(c.worse, 1);
  assert.equal(c.medianA, 0.25);
  assert.ok(Math.abs(c.medianB - 0.15) < 1e-12);
  assert.ok(Math.abs(c.medianSwing - 0.30) < 1e-12);
  assert.equal(c.compsB, 7.5);
});

test("a refusal from the search account is told apart from an ordinary failure", () => {
  // The provider's rate or spend limit reaches a caller as a 502 "busy",
  // our own daily cap as a 429: after three in a row the run stops.
  assert.equal(TT.isRefusal({ error: "502 Our comp search is unusually busy right now. Please try again in a minute." }), true);
  assert.equal(TT.isRefusal({ error: "429 Daily search limit reached" }), true);
  assert.equal(TT.isRefusal({ error: "503 temporarily unavailable" }), true);
  assert.equal(TT.isRefusal({ error: "400 Address is required" }), false);
  assert.equal(TT.isRefusal({ error: "unreadable answer (200)" }), false);
  assert.equal(TT.isRefusal({ miss: 0.1 }), false);
  assert.equal(TT.isRefusal(null), false);
  assert.equal(TT.REFUSALS_TO_STOP, 3);
  // And the run is slow by default: this spends on the account every
  // member's search runs on.
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "truth-test.js"), "utf8");
  assert.match(src, /const flags = \{ label: "run", concurrency: 2,/);
  assert.match(src, /if \(!flags\.cached\) body\.fresh = true;/);
});

test("a raw report is filed under its building's street line", () => {
  assert.equal(TT.rawName({ address: "4500 Salisbury Rd, Jacksonville, FL" }), "4500-salisbury-rd.json");
  assert.equal(TT.rawName({ address: "5705 W. 98th St., Los Angeles, CA 90045" }), "5705-w-98th-st.json");
  assert.equal(TT.rawName({ address: "760 US-378 W, Lexington, SC 29072" }), "760-us-378-w.json");
});

test("the committed truth set is usable: an address, a type and a sale price on every row, no repeats", () => {
  const set = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "scripts", "truth-set.json"), "utf8"));
  assert.ok(set.targets.length >= 40);
  const seen = new Set();
  for (const t of set.targets) {
    assert.match(t.address, /^\d.*, [A-Z]{2}( \d{5})?$/, t.address);
    assert.ok(["Industrial", "Office", "Retail"].includes(t.type), t.address);
    assert.ok(t.sold >= 500000, t.address);
    const k = t.address.toLowerCase();
    assert.ok(!seen.has(k), "listed twice: " + t.address);
    seen.add(k);
    // Every row says how far its price can be trusted (the 2026-11-27 audit
    // against the web), and a row that is not a plain sale says what it is.
    assert.ok(TT.CHECKS.includes(t.check), "no check on " + t.address);
    if (t.check === "asking") assert.ok(t.caveat, "an asking-price row says so: " + t.address);
    if (t.sale_type) assert.ok(t.caveat, "an unusual sale says what it was: " + t.address);
  }
  const count = (c) => set.targets.filter((t) => t.check === c).length;
  assert.ok(count("confirmed") >= 25, "most of the answer key should be confirmed sales");
  assert.ok(count("asking") >= 1, "the asking-price rows stay in the file, marked, so older runs still line up");
  assert.ok(TT.runnable(set.targets).every((t) => t.check !== "asking"));
});
