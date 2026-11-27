// The accuracy lab's pure helpers (scripts/accuracy-lab.js).
//
// Run: npm test
//
// The lab scores candidate versions of the valuation math against today's. Two
// of its failure modes would be silent, so they are pinned here:
//
//   * a variant whose patch no longer matches valuation.js would score the
//     BASELINE under a new name and report "no change" for a change that was
//     never applied;
//   * an unpatched copy that differs from the module customers run would make
//     every comparison a comparison against the wrong baseline.
//
// Requiring the script runs nothing (main is behind require.main).

const test = require("node:test");
const assert = require("node:assert");

const LAB = require("../scripts/accuracy-lab");
const VALUATION = require("../valuation");

const AS_OF = Date.parse("2026-07-01");
const comp = (over) => Object.assign({
  address: "1 A St", transaction: "Sale", date: "2026-01-15",
  size_sqft: "10000", price_per_sqft: "100", source_type: "public_record",
}, over || {});

test("every variant's patch still matches valuation.js exactly once", () => {
  assert.ok(LAB.VARIANTS.length > 10);
  LAB.VARIANTS.forEach((v) => {
    if (v.patches) assert.doesNotThrow(() => LAB.patchedValuation(v.patches), v.name);
  });
});

test("a patch that matches nothing, or twice, throws instead of scoring the baseline", () => {
  assert.throws(() => LAB.patchedValuation([["this line is not in valuation.js", "x"]]), /exactly once/);
  assert.throws(() => LAB.patchedValuation([["numericValue", "x"]]), /exactly once/);
});

test("an unpatched copy is the production math, figure for figure", () => {
  const copy = LAB.patchedValuation([]);
  const comps = [
    comp({ price_per_sqft: "80", date: "2024-03-15", size_sqft: "40000" }),
    comp({ price_per_sqft: "100", source_type: "listing" }),
    comp({ price_per_sqft: "120", date: "2025-06-15" }),
    comp({ price_per_sqft: "150", size_sqft: "2500" }),
    comp({ price_per_sqft: "95" }),
  ];
  const opts = { subjectSF: 10000, asOf: AS_OF, trendPct: 4, propertyType: "Industrial" };
  assert.deepEqual(copy.valueFromComps(comps, opts), VALUATION.valueFromComps(comps, opts));
});

test("a patched copy really runs the patched line", () => {
  const stale = [comp({ price_per_sqft: "100", date: "2022-07-01" })];
  const noRecency = LAB.patchedValuation([[LAB.SRC.recency, ""]]);
  assert.ok(VALUATION.compWeight(stale[0], AS_OF, 10000) < 0.3);
  assert.equal(noRecency.compWeight(stale[0], AS_OF, 10000), 1);
});

test("parseCsv reads quoted commas, doubled quotes, line breaks in a cell, CRLF and a BOM", () => {
  const text = "﻿address,notes,price\r\n"
    + '"1 A St, Boise, ID","said ""as is""\nsecond line","$1,000"\r\n'
    + "2 B St,,\r\n";
  assert.deepEqual(LAB.parseCsv(text), [
    { address: "1 A St, Boise, ID", notes: 'said "as is"\nsecond line', price: "$1,000" },
    { address: "2 B St", notes: "", price: "" },
  ]);
  assert.deepEqual(LAB.parseCsv(""), []);
});

test("dedupeRows keeps one row per address, date and price", () => {
  const a = { address: "1 A St", deal_date: "Mar 2025", price_or_rate: "$1" };
  const rows = LAB.dedupeRows([a, Object.assign({}, a, { address: " 1 a st " }), Object.assign({}, a, { deal_date: "Apr 2025" })]);
  assert.equal(rows.length, 2);
});

test("sizeAdjusted restates a comp at the subject's size and leaves an unsized one alone", () => {
  const comps = [comp({ size_sqft: "40000" }), comp({ size_sqft: "" })];
  const ctx = { subject: { row: { property_type: "Industrial" } }, peers: [{ psf: 100 }, { psf: 100 }] };
  const out = LAB.sizeAdjusted(-0.5)(comps, { subjectSF: 10000 }, ctx);
  // A comp four times the subject's size, at elasticity -0.5: 100 x (1/4)^-0.5.
  assert.ok(Math.abs(Number(out[0].price_per_sqft) - 200) < 1e-9);
  assert.equal(out[1], comps[1]);
  assert.equal(comps[0].price_per_sqft, "100", "the caller's comp is not mutated");
});

test("peerTrendPct reads a clean trend, shrinks a short one toward flat, and is bounded", () => {
  const rising = [2022, 2023, 2024, 2025, 2026].map((y, i) => ({ dy: y, psf: 100 * Math.pow(1.05, i) }));
  assert.ok(Math.abs(LAB.peerTrendPct(rising, 0, 15) - 5) < 1e-6);
  const shrunk = LAB.peerTrendPct(rising, 10, 15);
  assert.ok(shrunk > 0 && shrunk < 5);
  const boom = [2023, 2024, 2025, 2026].map((y, i) => ({ dy: y, psf: 100 * Math.pow(1.6, i) }));
  assert.equal(LAB.peerTrendPct(boom, 0, 15), 15);
  assert.equal(LAB.peerTrendPct(rising.slice(0, 3), 0, 15), null, "under four comps is no trend");
  assert.equal(LAB.peerTrendPct(rising.map((p) => ({ dy: 2025, psf: p.psf })), 0, 15), null, "one date is no trend");
});

test("pairedChange is deterministic and resamples whole markets", () => {
  const pairs = [];
  for (let m = 0; m < 12; m++) {
    for (let i = 0; i < 5; i++) pairs.push({ market: "M" + m, base: 0.2 + i * 0.01, cand: 0.15 + i * 0.01 });
  }
  const a = LAB.pairedChange(pairs, 300), b = LAB.pairedChange(pairs, 300);
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.change + 0.05) < 1e-12);
  assert.ok(a.hi < 0, "a uniform five-point gain clears the noise");
  assert.equal(a.markets, 12);
  assert.equal(a.winRate, 1);
});

test("compare pairs a candidate's subjects with the baseline's by market, type and building", () => {
  const base = [{ market: "A", type: "Industrial", key: "1 a st", absError: 0.2 }, { market: "A", type: "Industrial", key: "2 a st", absError: 0.3 }];
  const cand = [{ market: "A", type: "Industrial", key: "1 a st", absError: 0.1 }, { market: "B", type: "Industrial", key: "9 z st", absError: 0.5 }];
  assert.deepEqual(LAB.compare(base, cand), [{ market: "A", type: "Industrial", base: 0.2, cand: 0.1 }]);
});

// Distance (2026-11-16): the export carries lat/lng, and these two leaves turn
// them into what a live report has: a stamped distance_mi that valuation.js's
// own distance term reads, and the radius blend's circle.
const BOISE = { lat: 43.615, lng: -116.2023 };
const north = (mi) => ({ lat: String(BOISE.lat + mi / 69), lng: String(BOISE.lng) });
const distCtx = (type, peerMiles) => ({
  subject: { row: { property_type: type, lat: String(BOISE.lat), lng: String(BOISE.lng) } },
  peers: peerMiles.map((mi) => ({ row: mi == null ? {} : north(mi) })),
});

test("withDistance stamps miles from the two points, and leaves an unplaced peer alone", () => {
  const ctx = distCtx("Residential", [0.5, 4, null]);
  const out = LAB.withDistance([comp(), comp(), comp()], {}, ctx);
  assert.equal(out[0].distance_mi, 0.5);
  assert.equal(out[1].distance_mi, 4);
  assert.equal("distance_mi" in out[2], false);
  // Production's own weighting reads it: four miles out is past the house
  // free pass, so it counts for less than the half-mile comp.
  assert.ok(VALUATION.compWeight(out[1], AS_OF, 10000, null, { propertyType: "Residential" })
    < VALUATION.compWeight(out[0], AS_OF, 10000, null, { propertyType: "Residential" }));
  const noSubject = { subject: { row: { property_type: "Residential" } }, peers: ctx.peers };
  assert.equal(LAB.withDistance([comp()], {}, noSubject)[0].distance_mi, undefined);
});

test("withinBlendRadius keeps the blend's circle: a mile for houses, ten for commercial", () => {
  const houses = distCtx("Residential", [0.3, 0.6, 0.9, 3, 8]);
  const near = LAB.withinBlendRadius(LAB.withDistance(houses.peers.map(() => comp()), {}, houses), {}, houses);
  assert.deepEqual(near.map((c) => c.distance_mi), [0.3, 0.6, 0.9]);
  const sheds = distCtx("Industrial", [0.3, 0.6, 0.9, 3, 8, 14]);
  const inTen = LAB.withinBlendRadius(LAB.withDistance(sheds.peers.map(() => comp()), {}, sheds), {}, sheds);
  assert.deepEqual(inTen.map((c) => c.distance_mi), [0.3, 0.6, 0.9, 3, 8]);
});

test("withinBlendRadius leaves every peer when fewer than three sit inside, and no point is outside", () => {
  const ctx = distCtx("Residential", [0.4, 5, null, 9]);
  const all = LAB.withDistance(ctx.peers.map(() => comp()), {}, ctx);
  assert.equal(LAB.withinBlendRadius(all, {}, ctx).length, 4);
});

test("the lab carries both distance variants", () => {
  const names = LAB.VARIANTS.filter((v) => v.group === "distance").map((v) => v.name);
  assert.equal(names.length, 2);
});

// 2026-11-27: the comp-fit variants put the pool through comp-fit.js's own
// function, so the lab cannot score a copy of the rule a report runs.
function fitCtx(sizes, notes) {
  return {
    subject: { row: { property_type: "Industrial", address: "1 Subject Way, Boise, ID" } },
    peers: sizes.map((s, i) => ({ row: { notes: (notes && notes[i]) || "" } })),
  };
}
const fitComps = (sizes) => sizes.map((s, i) => comp({ address: (i + 2) + " Peer St, Boise, ID", size_sqft: String(s) }));

test("the fit variant a report runs leaves a different-sized peer in; the size variant cuts it", () => {
  const sizes = [10000, 11000, 9000, 12000, 1000, 90000];
  const ctx = fitCtx(sizes);
  const opts = { subjectSF: 10000 };
  const asBlended = LAB.fittedPeers({})(fitComps(sizes), opts, ctx);
  assert.equal(asBlended.length, 6, "refitBlended does not size-cut saved deals, so neither does its variant");
  const withSize = LAB.fittedPeers({ size: true })(fitComps(sizes), opts, ctx);
  assert.deepEqual(withSize.map((c) => c.size_sqft), ["10000", "11000", "9000", "12000"]);
  // The floor is comp-fit.js's own: never under three priced sales.
  const thin = [10000, 1000, 90000, 800];
  assert.equal(LAB.fittedPeers({ size: true })(fitComps(thin), opts, fitCtx(thin)).length, 3);
});

test("the fit variants read a peer's notes off its row, which the backtest's comps do not carry", () => {
  const sizes = [10000, 10000, 10000, 10000, 10000];
  const notes = ["", "Foreclosure sale.", "", "Part of a 3-property portfolio.", ""];
  const kept = LAB.fittedPeers({})(fitComps(sizes), { subjectSF: 10000 }, fitCtx(sizes, notes));
  assert.equal(kept.length, 3);
  const only = LAB.fittedPeers({ priceBasisOnly: true })(fitComps(sizes), { subjectSF: 10000 }, fitCtx(sizes, notes));
  assert.equal(only.length, 3);
  // Fewer than three left: the rule stands down, as a live report's floor does.
  const most = ["Foreclosure sale.", "Sold at auction.", "Bank-owned sale.", "", ""];
  assert.equal(LAB.fittedPeers({ priceBasisOnly: true })(fitComps(sizes), { subjectSF: 10000 }, fitCtx(sizes, most)).length, 5);
});

test("the lab carries the fit variants, the size question both ways, and the comp-count curve", () => {
  const fit = LAB.VARIANTS.filter((v) => v.group === "fit").map((v) => v.name);
  assert.equal(fit.length, 5);
  assert.equal(fit.filter((n) => /PLUS the size-class cut/.test(n)).length, 2);
  assert.equal(LAB.VARIANTS.filter((v) => v.group === "count").length, 4);
});

test("market-seed.json reads as corpus rows, and nothing else is mistaken for it", () => {
  const rows = LAB.seedRows(JSON.stringify({
    "industrial-boise-id": { type: "Industrial", city: "Boise", state: "ID",
      comps: [{ address: "1 A St, Boise, ID", date: "Mar 2026", transaction: "Sale", size_sqft: "10000", price_or_rate: "$1,000,000" }] },
    "note": "not a page",
  }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].market, "Boise, ID");
  assert.equal(rows[0].property_type, "Industrial");
  assert.equal(rows[0].deal_date, "Mar 2026");
  assert.equal(LAB.seedRows("[1,2]"), null);
  assert.equal(LAB.seedRows('{"a":1}'), null);
  assert.equal(LAB.seedRows('{"address":"1 A St"}\n{"address":"2 B St"}'), null, "a .json of JSON lines still reads as lines");
  // The committed seed itself: every row lands in a market and a type.
  const seed = LAB.seedRows(require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "market-seed.json"), "utf8"));
  assert.ok(seed.length > 100);
  assert.ok(seed.every((r) => /, [A-Z]{2}$/.test(r.market) && r.property_type));
});
