// The comp-report box's sample addresses (sample-addresses.js): real
// buildings in the member's area that nobody has searched yet. The rules the
// module's header states, executed.

const test = require("node:test");
const assert = require("node:assert");
const S = require("../sample-addresses");

// A seeded random so a shuffle is exact. Mulberry32.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("areaMarkets: a property outranks The Board, which outranks a search", () => {
  const out = S.areaMarkets({
    recents: [{ address: "1 Main St, Dallas, TX" }, { address: "2 Main St, Dallas, TX" }],
    watchlist: [{ market: "Phoenix, AZ" }],
    portfolio: [{ address: "9 Elm St, Portland, OR" }],
  });
  // Portland 3, Phoenix 2, Dallas 1+1 = 2: Phoenix came first, so it keeps
  // its place in the tie.
  assert.deepStrictEqual(out.slice(0, 3), ["Portland, OR", "Phoenix, AZ", "Dallas, TX"]);
});

test("areaMarkets: metro siblings follow the member's own markets, never lead them", () => {
  const out = S.areaMarkets({ recents: [{ address: "100 E Fairview Ave, Meridian, ID" }] });
  assert.strictEqual(out[0], "Meridian, ID");
  assert.ok(out.includes("Boise, ID"), "Boise is Meridian's metro sibling");
  assert.strictEqual(new Set(out).size, out.length, "no market twice");
});

test("areaMarkets: no signal is no area, and junk is not a market", () => {
  assert.deepStrictEqual(S.areaMarkets({}), []);
  assert.deepStrictEqual(S.areaMarkets({ recents: [{ address: "somewhere nice" }] }), []);
});

test("areaMarkets: keeps only the top three of the member's own markets", () => {
  const recents = ["Dallas, TX", "Austin, TX", "Denver, CO", "Reno, NV"]
    .map((m, i) => ({ address: `${i + 1} Main St, ${m}` }));
  const out = S.areaMarkets({ recents });
  assert.ok(!out.includes("Reno, NV"));
  assert.ok(out.length >= S.MAX_AREA_MARKETS);
});

test("sampleCandidates: one street-numbered building with a city, nothing looser", () => {
  const rows = [
    { address: "100 Main St, Boise, ID", property_type: "Industrial" },
    { address: "10000 SF warehouse, Boise, ID", property_type: "Industrial" },       // a quantity
    { address: "1200-1250 Main St, Boise, ID", property_type: "Industrial" },        // a range
    { address: "5 Oak St & 7 Oak St, Boise, ID", property_type: "Industrial" },      // two buildings
    { address: "Portion of 9 Pine St, Boise, ID", property_type: "Industrial" },     // no leading number
    { address: "Downtown Boise submarket", property_type: "Industrial" },            // no number at all
    { address: "300 River St", property_type: "Industrial", market: "Boise, ID" },   // borrows its market
    { address: "400 Lake St", property_type: "Industrial", market: "" },             // no city anywhere
    { address: "500 Hill Rd, Boise, ID", property_type: "Office" },                  // another type
    { address: "100 Main Street, Boise, ID", property_type: "Industrial" },          // the same building
    { address: "600 Vine St, Boise, ID", property_type: "" },                        // untyped
  ];
  const out = S.sampleCandidates(rows, { type: "Industrial", random: seeded(1) });
  const got = out.map((c) => c.address).sort();
  assert.deepStrictEqual(got, ["100 Main St, Boise, ID", "300 River St, Boise, ID"]);
  for (const c of out) assert.strictEqual(c.market, "Boise, ID");
});

test("sampleCandidates: the injected aggregate check refuses what it names", () => {
  const rows = [
    { address: "100 Main St, Boise, ID", property_type: "Retail" },
    { address: "200 Main St, Boise, ID", property_type: "Retail" },
  ];
  const out = S.sampleCandidates(rows, { isAggregateAddress: (a) => a.startsWith("200"), random: seeded(2) });
  assert.deepStrictEqual(out.map((c) => c.address), ["100 Main St, Boise, ID"]);
});

test("sampleCandidates: without a type every typed row counts, each with its own type", () => {
  const rows = [
    { address: "100 Main St, Boise, ID", property_type: "Retail" },
    { address: "200 Main St, Boise, ID", property_type: "Office" },
  ];
  const out = S.sampleCandidates(rows, { random: seeded(3) });
  assert.deepStrictEqual(out.map((c) => c.type).sort(), ["Office", "Retail"]);
});

test("sampleCandidates: random order, the same order for the same seed", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ address: `${i + 1} Main St, Boise, ID`, property_type: "Industrial" }));
  const a = S.sampleCandidates(rows, { random: seeded(7) }).map((c) => c.address);
  const b = S.sampleCandidates(rows, { random: seeded(7) }).map((c) => c.address);
  const c = S.sampleCandidates(rows, { random: seeded(8) }).map((c) => c.address);
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, c);
  assert.notDeepStrictEqual(a, rows.map((r) => r.address), "not the corpus's own order");
  assert.strictEqual(new Set(a).size, 30, "a shuffle loses nothing");
});

test("pickUnsearched: anything already searched is never a sample", () => {
  const key = (s) => s.toLowerCase();
  const cands = ["1 A St, Boise, ID", "2 B St, Boise, ID", "3 C St, Boise, ID", "4 D St, Boise, ID"]
    .map((address) => ({ address, type: "Industrial" }));
  const out = S.pickUnsearched(cands, {
    searched: new Set(["1 a st, boise, id", "3 c st, boise, id"]), addressKey: key, count: 3,
  });
  assert.deepStrictEqual(out.map((c) => c.address), ["2 B St, Boise, ID", "4 D St, Boise, ID"]);
});

test("pickUnsearched: stops at the count", () => {
  const cands = Array.from({ length: 10 }, (_, i) => ({ address: `${i + 1} A St, Boise, ID` }));
  assert.strictEqual(S.pickUnsearched(cands, { count: 3 }).length, 3);
});

test("clampCount: 3 by default, never more than the ceiling", () => {
  assert.strictEqual(S.clampCount(undefined), 3);
  assert.strictEqual(S.clampCount("0"), 3);
  assert.strictEqual(S.clampCount("abc"), 3);
  assert.strictEqual(S.clampCount("5"), 5);
  assert.strictEqual(S.clampCount("500"), S.MAX_COUNT);
});
