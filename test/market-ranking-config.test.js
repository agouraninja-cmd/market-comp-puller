// The ranking configuration's paper rules, made into build failures.
//
// market-weights.json and market-tiers.json are DATA the scoring code will
// read, and both carry invariants that are invisible on inspection: a weight
// block that sums to 0.97 produces a score that is quietly 3% short on every
// market it touches, and nothing raises. The migrations folder learned this
// lesson the expensive way (test/migrations.test.js's header), so the weights
// arrive with their rules already enforced rather than after the first wrong
// number reaches a customer.
//
// These weights are EXPECTED to change — they are the model's tuning surface,
// not settled science. What must not change is that they sum to one, that
// every asset class is present in every block, and that nothing reads a CBSA
// code somebody has not checked.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const weights = JSON.parse(fs.readFileSync(path.join(ROOT, "market-weights.json"), "utf8"));
const tiers = JSON.parse(fs.readFileSync(path.join(ROOT, "market-tiers.json"), "utf8"));

const ASSET_CLASSES = ["industrial", "office", "retail", "multifamily", "land", "residential"];
const TIERS = ["primary", "secondary", "tertiary"];

// Floating point: 0.30 + 0.45 + 0.25 is not exactly 1 in IEEE 754, so compare
// to four places the way the workbook's own ROUND(...,4) check does.
function sumsToOne(n) {
  return Math.round(n * 10000) / 10000 === 1;
}

test("every asset class carries all three weights, and they sum to one", () => {
  for (const cls of ASSET_CLASSES) {
    const w = weights.by_asset_class[cls];
    assert.ok(w, `market-weights.json has no by_asset_class entry for "${cls}"`);
    for (const key of ["macro", "class", "narrative"]) {
      assert.strictEqual(typeof w[key], "number", `${cls}.${key} must be a number`);
      assert.ok(w[key] >= 0 && w[key] <= 1, `${cls}.${key} must be within 0..1`);
    }
    const total = w.macro + w.class + w.narrative;
    assert.ok(sumsToOne(total),
      `${cls} weights sum to ${total}, not 1 — every market's ${cls} score would be ` +
      `scaled by that factor and nothing would raise`);
  }
});

test("by_asset_class holds exactly the six classes, no more", () => {
  assert.deepStrictEqual(Object.keys(weights.by_asset_class).sort(), [...ASSET_CLASSES].sort());
});

test("the macro sub-weights sum to one", () => {
  const vals = Object.values(weights.macro).map((m) => m.weight);
  assert.ok(vals.length >= 5, "macro block looks truncated");
  const total = vals.reduce((a, b) => a + b, 0);
  assert.ok(sumsToOne(total), `macro sub-weights sum to ${total}, not 1`);
});

test("each class-specific sub-weight block sums to one", () => {
  for (const cls of ASSET_CLASSES) {
    const block = weights.class_specific[cls];
    assert.ok(block, `no class_specific block for "${cls}"`);
    const total = Object.values(block).reduce((a, m) => a + m.weight, 0);
    assert.ok(sumsToOne(total), `class_specific.${cls} sums to ${total}, not 1`);
  }
});

test("every weighted metric names a source", () => {
  const named = [
    ...Object.entries(weights.macro).map(([k, v]) => [`macro.${k}`, v]),
    ...ASSET_CLASSES.flatMap((c) =>
      Object.entries(weights.class_specific[c]).map(([k, v]) => [`${c}.${k}`, v])),
  ];
  for (const [where, metric] of named) {
    assert.ok(String(metric.source || "").trim(),
      `${where} carries a weight but names no source — an unsourced input cannot be audited`);
  }
});

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

test("the tier list is 25 primary, 50 secondary, 100 tertiary", () => {
  const counts = { primary: 0, secondary: 0, tertiary: 0 };
  for (const m of tiers.markets) counts[m.tier]++;
  assert.deepStrictEqual(counts, { primary: 25, secondary: 50, tertiary: 100 });
  assert.strictEqual(tiers.markets.length, 175);
});

test("every market row is complete and carries a known tier", () => {
  for (const m of tiers.markets) {
    assert.ok(String(m.market || "").trim(), "a market row has no name");
    assert.match(String(m.state || ""), /^[A-Z]{2}$/, `bad state on ${m.market}`);
    assert.ok(TIERS.includes(m.tier), `${m.market} has tier "${m.tier}"`);
    assert.ok(String(m.cbsa && m.cbsa.name || "").trim(), `${m.market} has no CBSA name`);
    assert.match(String(m.cbsa && m.cbsa.code || ""), /^\d{5}$/,
      `${m.market} has a CBSA code that is not five digits`);
  }
});

test("no two markets claim the same CBSA code", () => {
  const seen = new Map();
  for (const m of tiers.markets) {
    const code = m.cbsa.code;
    assert.ok(!seen.has(code),
      `CBSA ${code} is claimed by both "${seen.get(code)}" and "${m.market}" — ` +
      `one of them would silently read the other's employment data`);
    seen.set(code, m.market);
  }
});

// THE ONE THAT MATTERS MOST, and the reason the flag exists at all.
//
// A wrong CBSA code does not throw. FRED answers it with real, well-formed
// employment for whichever city actually owns that code, every downstream
// number is confidently wrong, and no test of the arithmetic can detect it.
// So the flag gates the read: until scripts/resolve-fred-series.js has
// confirmed a code against the Census delineation files and set this true,
// nothing may pull data for that market.
test("no CBSA code is marked verified until a resolver has checked it", () => {
  const claimed = tiers.markets.filter((m) => m.cbsa.verified === true);
  assert.deepStrictEqual(claimed.map((m) => m.market), [],
    "a CBSA code is flagged verified, but the resolver script does not exist yet — " +
    "verified:true must be set BY that script, never by hand");
});

test("the unverified warning survives in the file itself", () => {
  const note = String(tiers._comment || "").toLowerCase();
  assert.ok(note.includes("unverified"),
    "market-tiers.json must keep its own warning — the next reader may never see this test");
});
