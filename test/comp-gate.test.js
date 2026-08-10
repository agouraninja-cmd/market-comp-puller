// Comp gating — proves the paywall holds and the free valuation stays honest.
//
// Run: npm test
//
// The two promises under test: a locked comp's identity NEVER leaves the
// server, and a free user's valuation math still sees every comp's numbers.

const test = require("node:test");
const assert = require("node:assert");

const { gateReport, selectVisible, basisRow, compWeight } = require("../comp-gate");
const { computeEntitlements } = require("../entitlements");

const NOW = Date.parse("2026-08-01T00:00:00Z");

// Fields that identify a property. None may appear on a basis row, ever.
const IDENTIFYING = ["address", "price_or_rate", "source_url", "notes", "lat", "lng"];

function comp(over = {}) {
  return {
    address: "100 Main St, Dallas, TX",
    date: "Jan 2026",
    transaction: "Sale",
    size_sqft: "50,000",
    price_or_rate: "$7,000,000",
    price_per_sqft: "$140",
    cap_rate: "6.5%",
    notes: "Sold to an owner-user.",
    source_url: "https://example.com/deal",
    source_type: "public_record",
    lat: "32.7767",
    lng: "-96.7970",
    ...over,
  };
}
const report = (comps) => ({ summary: "A market.", avg_price_per_sqft: "$140", comps });
const freeEnt = computeEntitlements({ user: null, now: NOW, enabled: true });
const proEnt = computeEntitlements({
  user: { id: "u1" }, now: NOW, enabled: true,
  subscription: { plan: "pro_monthly", status: "active", current_period_end: "2026-09-01T00:00:00Z" },
});

// --- the gate itself -------------------------------------------------------

test("free report is cut to 10 comps and says how many are locked", () => {
  const r = gateReport(report(Array.from({ length: 18 }, () => comp())), freeEnt, { asOfMs: NOW });
  assert.equal(r.comps.length, 10);
  assert.equal(r.locked_count, 8);
  assert.equal(r.locked_basis.length, 8);
});

test("Pro gets everything and no basis rows", () => {
  const r = gateReport(report(Array.from({ length: 18 }, () => comp())), proEnt, { asOfMs: NOW });
  assert.equal(r.comps.length, 18);
  assert.equal(r.locked_count, 0);
  assert.equal(r.locked_basis, undefined);
});

test("a report with fewer comps than the limit is untouched", () => {
  const r = gateReport(report([comp(), comp()]), freeEnt, { asOfMs: NOW });
  assert.equal(r.comps.length, 2);
  assert.equal(r.locked_count, 0);
  assert.equal(r.locked_basis, undefined, "nothing is locked, so there is nothing to stand in for");
});

test("gating never mutates the caller's report (the cache keeps the full set)", () => {
  const original = report(Array.from({ length: 10 }, () => comp()));
  gateReport(original, freeEnt, { asOfMs: NOW });
  assert.equal(original.comps.length, 10, "the object handed to the cache and the corpus must stay whole");
});

// --- the non-negotiable: no identity in a basis row ------------------------

test("basis rows carry arithmetic only — no address, price, url, notes or coords", () => {
  const r = gateReport(report(Array.from({ length: 12 }, () => comp())), freeEnt, { asOfMs: NOW });
  const serialized = JSON.stringify(r.locked_basis);
  for (const row of r.locked_basis) {
    for (const field of IDENTIFYING) {
      assert.ok(!(field in row), `basis row must not carry ${field}`);
    }
  }
  // Belt and braces: the actual wire bytes must not contain the identifying
  // values either, however they were nested.
  assert.ok(!serialized.includes("Main St"), "no address text on the wire");
  assert.ok(!serialized.includes("7,000,000"), "no sale price on the wire");
  assert.ok(!serialized.includes("example.com"), "no source url on the wire");
  assert.ok(!serialized.includes("owner-user"), "no notes on the wire");
});

test("a whole gated response leaks nothing about a locked comp", () => {
  const comps = [
    ...Array.from({ length: 10 }, (_, i) => comp({ address: `${i} Visible Way, Dallas, TX`, date: "Jul 2026" })),
    comp({ address: "999 SECRET BLVD, Dallas, TX", date: "Feb 2024", source_url: "https://secret.example" }),
  ];
  const wire = JSON.stringify(gateReport(report(comps), freeEnt, { asOfMs: NOW }));
  assert.ok(!wire.includes("SECRET"), "the locked comp's address must not appear anywhere in the response");
  assert.ok(!wire.includes("secret.example"));
  assert.ok(wire.includes("Visible Way"), "the ten visible comps still arrive in full");
});

test("basis rows keep exactly the fields the valuation needs", () => {
  const row = basisRow(comp({ price_per_sqft: "$140" }));
  assert.deepEqual(Object.keys(row).sort(),
    ["date", "price_per_sqft", "size_sqft", "source_type", "transaction"].sort());
});

test("$/SF is derived when the model left it blank, so no comp drops out of the range", () => {
  const row = basisRow(comp({ price_per_sqft: "", price_or_rate: "$7,000,000", size_sqft: "50,000" }));
  assert.equal(row.price_per_sqft, "140");
});

test("per-unit and per-acre figures ride along for Multifamily and Land", () => {
  assert.equal(basisRow(comp({ price_per_unit: "$180,000" })).price_per_unit, "$180,000");
  assert.equal(basisRow(comp({ price_per_acre: "$400,000" })).price_per_acre, "$400,000");
});

test("a broker-verified locked comp keeps its tier but not its identity", () => {
  const row = basisRow(comp({ verified: true, address: "1 Broker Rd" }));
  assert.equal(row.verified, true, "provenance drives its weight in the range");
  assert.ok(!("address" in row));
});

// --- which 10 get shown ------------------------------------------------------

test("sales fill the free slots before leases", () => {
  const comps = [
    comp({ transaction: "Lease", address: "L1", date: "Jul 2026" }),
    comp({ transaction: "Lease", address: "L2", date: "Jul 2026" }),
    comp({ transaction: "Lease", address: "L3", date: "Jul 2026" }),
    ...Array.from({ length: 10 }, (_, i) =>
      comp({ transaction: "Sale", address: `S${i + 1}`, date: "Jan 2025" })),
  ];
  const r = gateReport(report(comps), freeEnt, { asOfMs: NOW });
  const shown = r.comps.map((c) => c.address);
  assert.deepEqual(shown, Array.from({ length: 10 }, (_, i) => `S${i + 1}`),
    "even though the leases are far more recent, the valuation is sales-based");
});

test("leases fill the slots sales cannot", () => {
  const comps = [
    comp({ transaction: "Sale", address: "S1" }),
    comp({ transaction: "Sale", address: "S2" }),
    comp({ transaction: "Sale", address: "S3" }),
    ...Array.from({ length: 10 }, (_, i) => comp({ transaction: "Lease", address: `L${i + 1}` })),
  ];
  const r = gateReport(report(comps), freeEnt, { asOfMs: NOW });
  assert.equal(r.comps.length, 10);
  assert.ok(["S1", "S2", "S3"].every((a) => r.comps.some((c) => c.address === a)),
    "every sale is always shown");
});

test("best-first: recent, well-sourced, similar-size comps win the slots", () => {
  const comps = [
    comp({ address: "STALE", date: "Jan 2021", source_type: "estimate" }),
    comp({ address: "FRESH", date: "Jul 2026", source_type: "public_record" }),
    comp({ address: "OKAY", date: "Jan 2025", source_type: "listing" }),
  ];
  const { visible } = selectVisible(comps, 1, { asOfMs: NOW, subjectSqft: 50000 });
  assert.equal(visible[0].address, "FRESH");
});

test("a wildly different size class loses to a similar-size comp", () => {
  const comps = [
    comp({ address: "HUGE", size_sqft: "2,000,000", date: "Jul 2026" }),
    comp({ address: "FITS", size_sqft: "52,000", date: "Jul 2026" }),
  ];
  const { visible } = selectVisible(comps, 1, { asOfMs: NOW, subjectSqft: 50000 });
  assert.equal(visible[0].address, "FITS");
});

test("selection is stable — re-gating a cached report picks the same comps", () => {
  const comps = Array.from({ length: 9 }, (_, i) => comp({ address: `A${i}` }));
  const a = selectVisible(comps, 4, { asOfMs: NOW, subjectSqft: 50000 });
  const b = selectVisible(comps, 4, { asOfMs: NOW, subjectSqft: 50000 });
  assert.deepEqual(a.visible.map((c) => c.address), b.visible.map((c) => c.address));
});

test("visible comps stay in report order, not weight order", () => {
  const comps = [
    comp({ address: "MID", date: "Jan 2025" }),
    comp({ address: "NEWEST", date: "Jul 2026" }),
    comp({ address: "OLDEST", date: "Jan 2021" }),
  ];
  const { visible } = selectVisible(comps, 2, { asOfMs: NOW, subjectSqft: 50000 });
  // Ranking picks NEWEST then MID; the response lists them the way the report
  // did, so a comp's position never contradicts its printed row number.
  assert.deepEqual(visible.map((c) => c.address), ["MID", "NEWEST"]);
});

// --- the valuation must not move ------------------------------------------

test("free and Pro compute the same $/SF set from the same report", () => {
  const comps = Array.from({ length: 15 }, (_, i) =>
    comp({ address: `${i} Main`, price_per_sqft: `$${100 + i * 5}`, size_sqft: "50,000" }));
  const full = gateReport(report(comps), proEnt, { asOfMs: NOW });
  const free = gateReport(report(comps), freeEnt, { asOfMs: NOW });

  const psfOf = (c) => Number(String(c.price_per_sqft).replace(/[^0-9.]/g, ""));
  const proSet = full.comps.map(psfOf).sort((a, b) => a - b);
  const freeSet = free.comps.map(psfOf)
    .concat(free.locked_basis.map(psfOf))
    .sort((a, b) => a - b);

  assert.deepEqual(freeSet, proSet,
    "a free user's valuation inputs must be identical to a Pro user's — only the list is gated");
});

test("weights match between a visible comp and its basis row", () => {
  const c = comp({ date: "Jan 2025", size_sqft: "50,000", source_type: "listing" });
  assert.equal(
    compWeight(c, NOW, 50000),
    compWeight(basisRow(c), NOW, 50000),
    "a locked comp must pull the same weight in the range as it would if shown");
});

// --- degenerate input ------------------------------------------------------

test("a report with no comps array passes through untouched", () => {
  assert.deepEqual(gateReport({ summary: "x" }, freeEnt), { summary: "x" });
  assert.equal(gateReport(null, freeEnt), null);
});

test("a zero limit locks everything and still reports the count", () => {
  const { visible, locked } = selectVisible([comp(), comp()], 0, { asOfMs: NOW });
  assert.equal(visible.length, 0);
  assert.equal(locked.length, 2);
});
