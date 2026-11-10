// scripts/accuracy-bench.js: the offline hold-one-out that says whether a
// change to valuation.js made the valuation better or worse.
//
// Run: npm test
//
// Cost: zero. Pure: it requires the script (which starts nothing), builds a
// few comps by hand, and reads the checked-in market-seed.json once.

const test = require("node:test");
const assert = require("node:assert");

const V = require("../valuation");
const B = require("../scripts/accuracy-bench");

// A market whose prices follow ONE rule exactly: $/SF = 1000 x SF^-0.15, so a
// building twice the size sells for 2^-0.15 of the price per foot. Every comp
// closed in the same month and is the same age, so nothing but size differs.
function sizeMarket(sizes) {
  return {
    key: "industrial-testville-id", type: "Industrial", asOf: Date.parse("2026-07-01"),
    comps: sizes.map((sf, i) => ({
      address: (100 + i) + " Size St, Testville, ID", transaction: "Sale", date: "Jun 2026",
      size_sqft: String(sf), price_per_sqft: String(1000 * Math.pow(sf, -0.15)),
      year_built: "2000", source_type: "public_record",
    })),
  };
}

test("datasetFromSeed turns market-seed.json's shape into scoreable markets", () => {
  const ds = B.datasetFromSeed({
    "industrial-boise-id": { type: "Industrial", generatedAt: "2026-10-08", comps: [{ address: "1 A St" }] },
    "broken": { type: "Office", generatedAt: "not a date", comps: [] },
    "no-type": { generatedAt: "2026-10-08", comps: [] },
  });
  assert.equal(ds.length, 1);
  assert.equal(ds[0].key, "industrial-boise-id");
  assert.equal(ds[0].asOf, Date.parse("2026-10-08"));
});

test("datasetFromCorpusRows buckets by market and type and reads deal_date as the comp's date", () => {
  const ds = B.datasetFromCorpusRows([
    { ts: "2026-09-01T00:00:00Z", market: "Boise, ID", property_type: "Industrial", address: "1 A St", deal_date: "Mar 2026" },
    { ts: "2026-10-01T00:00:00Z", market: "Boise, ID", property_type: "Industrial", address: "2 A St", deal_date: "Active" },
    { ts: "2026-10-01T00:00:00Z", market: "Boise, ID", property_type: "Office", address: "3 A St", deal_date: "Apr 2026" },
    { ts: "2026-10-01T00:00:00Z", market: "", property_type: "Office", address: "4 A St" },
  ]);
  assert.equal(ds.length, 2);
  const ind = ds.find((m) => m.type === "Industrial");
  assert.equal(ind.comps.length, 2);
  assert.equal(ind.comps[0].date, "Mar 2026");
  assert.equal(ind.asOf, Date.parse("2026-10-01T00:00:00Z"), "a bucket is scored as of its newest harvest");
});

test("an asking price, an estimate and a lease are never the answer key", () => {
  const m = sizeMarket([10000, 12000, 14000, 16000, 18000]);
  m.comps[0].date = "Active";
  m.comps[1].date = "Listed May 2026";
  m.comps[2].source_type = "estimate";
  m.comps[3].transaction = "Lease";
  const rs = B.holdOneOut(V, [m]);
  // Only the 18,000 SF sale can be a subject; the lease is not even a peer.
  assert.equal(rs.length, 1);
  assert.equal(rs[0].subject, "industrial-testville-id#4");
});

test("the same building twice is one subject and never its own peer", () => {
  // Four same-size, same-month sales at 100 / 140 / 190 / 250, so every
  // weight is equal and nothing is adjusted: the arithmetic is by hand.
  const m = sizeMarket([10000, 10000, 10000, 10000]);
  [100, 140, 190, 250].forEach((psf, i) => { m.comps[i].price_per_sqft = String(psf); });
  // A second harvest of the first building: another spelling, same deal.
  m.comps.push(Object.assign({}, m.comps[0], { address: "100 Size Street, Testville, ID 83000" }));
  const rs = B.holdOneOut(V, [m]);
  const first = rs.filter((r) => /#0$|#4$/.test(r.subject));
  assert.equal(first.length, 1, "the duplicate must not score twice");
  // Valued from 140 / 190 / 250 only. Had its own copy been a peer, the
  // median of 100 / 140 / 190 / 250 would be 165.
  assert.equal(first[0].predicted, 190, "a subject must never be valued from a copy of itself");
  assert.equal(rs.length, 4);
});

test("a market too thin to value anything scores nothing", () => {
  assert.deepEqual(B.holdOneOut(V, [sizeMarket([10000, 12000, 14000])]), []);
});

test("in a market that prices by size, the adjustment is what gets the answer right", () => {
  const m = sizeMarket([5000, 10000, 20000, 40000, 80000, 160000]);
  const on = B.summarize(B.holdOneOut(V, [m]));
  const off = B.summarize(B.holdOneOut(V, [m], { adjust: false }));
  assert.equal(on.scored, 6);
  assert.equal(off.scored, 6);
  assert.ok(on.meanLogError < off.meanLogError / 2,
    "restating comps at the subject's size must at least halve the error here: " + on.meanLogError + " vs " + off.meanLogError);
});

test("elasticities recovers the size rule a market was built from", () => {
  // Two markets at different price levels, the same -0.15 rule inside each.
  const a = sizeMarket([5000, 10000, 20000, 40000]);
  const b = sizeMarket([6000, 15000, 30000, 90000]);
  b.key = "industrial-otherville-id";
  b.comps.forEach((c, i) => {
    c.price_per_sqft = String(3 * Number(c.price_per_sqft));
    c.year_built = String(1990 + i * 7);       // age varies, but changes no price
  });
  a.comps.forEach((c, i) => { c.year_built = String(2000 + i * 3); });
  const e = B.elasticities(V, [a, b]);
  assert.equal(e.comps, 8);
  assert.equal(e.markets, 2);
  assert.ok(Math.abs(e.size - -0.15) < 1e-6, "size elasticity: " + e.size);
  assert.ok(Math.abs(e.yearBuilt) < 1e-6, "no age effect was built in: " + e.yearBuilt);
});

test("pairedBootstrap is deterministic and says which way a change went", () => {
  const before = [], after = [];
  ["m1", "m2", "m3", "m4"].forEach((market, k) => {
    for (let i = 0; i < 5; i++) {
      const base = 0.2 + 0.03 * i + 0.01 * k;
      before.push({ market, subject: market + "#" + i, type: "Industrial", absError: base, logError: base });
      after.push({ market, subject: market + "#" + i, type: "Industrial", absError: base * 0.8, logError: base * 0.8 });
    }
  });
  const stat = (rs) => B.mean(rs.map((r) => r.logError));
  const one = B.pairedBootstrap(before, after, stat, 500);
  const two = B.pairedBootstrap(before, after, stat, 500);
  assert.deepEqual(one, two, "the same inputs must print the same interval");
  assert.ok(one.high < 0, "every subject improved by a fifth, so the whole interval is below zero");
  assert.ok(Math.abs(one.mid - -0.2) < 1e-9);
  assert.equal(one.shareBetter, 1);
});

test("pairUp drops a subject only one version scored", () => {
  const r = (subject) => ({ market: "m", subject, type: "Office", absError: 0.1, logError: 0.1 });
  const p = B.pairUp([r("m#0"), r("m#1"), r("m#2")], [r("m#2"), r("m#0")]);
  assert.deepEqual(p.before.map((x) => x.subject), ["m#0", "m#2"]);
  assert.deepEqual(p.after.map((x) => x.subject), ["m#0", "m#2"]);
});

test("parseCsvRows reads the corpus export, quotes and all", () => {
  const rows = B.parseCsvRows('﻿market,address,price_or_rate\r\n"Boise, ID","#4 Industrial Way, Boise, ID","$1,200,000"\n"Nampa, ID","12 ""A"" St",\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].market, "Boise, ID");
  assert.equal(rows[0].address, "#4 Industrial Way, Boise, ID", "a leading # is an address here, not a note line");
  assert.equal(rows[0].price_or_rate, "$1,200,000");
  assert.equal(rows[1].address, '12 "A" St');
  assert.equal(rows[1].price_or_rate, "");
});

test("parseArgs: --before defaults to origin/main and refuses what it does not know", () => {
  assert.equal(B.parseArgs([]).before, null);
  assert.equal(B.parseArgs(["--before"]).before, B.DEFAULT_REF);
  assert.equal(B.parseArgs(["--before", "HEAD~1", "--json"]).before, "HEAD~1");
  assert.equal(B.parseArgs(["--before", "--json"]).before, B.DEFAULT_REF);
  assert.equal(B.parseArgs(["--corpus", "x.csv"]).corpus, "x.csv");
  assert.throws(() => B.parseArgs(["--corpus"]), /needs a file/);
  assert.throws(() => B.parseArgs(["--bogus"]), /Unknown argument/);
});

// The one test here that reads real data. valuation.js's size and age
// coefficients were chosen because they made this benchmark better; if a
// regenerated market-seed.json (gen-market-seed.js) or a change to the math
// ever makes the adjusted valuation WORSE than the unadjusted one on the
// checked-in seed, the claim in valuation.js's header is no longer true and
// someone should look before it ships. Deliberately the weakest statement
// that still means something: not "at least 7% better" (a fresh seed is a
// fresh sample), only "not worse".
test("on the checked-in seed, the size and age adjustment does not make the valuation worse", () => {
  const seed = require("../market-seed.json");
  const ds = B.datasetFromSeed(seed);
  const on = B.summarize(B.holdOneOut(V, ds));
  const off = B.summarize(B.holdOneOut(V, ds, { adjust: false }));
  assert.ok(on.scored >= 50, "the seed should score a meaningful number of sales, got " + on.scored);
  assert.equal(on.scored, off.scored, "both versions must score the same subjects");
  assert.ok(on.meanLogError <= off.meanLogError,
    "adjusted " + on.meanLogError.toFixed(4) + " vs unadjusted " + off.meanLogError.toFixed(4)
    + ": run `node scripts/accuracy-bench.js` and re-check valuation.js's SIZE_ELASTICITY / VINTAGE_LOG_PER_YEAR");
});
