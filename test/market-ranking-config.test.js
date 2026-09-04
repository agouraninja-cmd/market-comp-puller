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
const thresholds = JSON.parse(fs.readFileSync(path.join(ROOT, "market-thresholds.json"), "utf8"));

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

// The floor was 5 until 2026-09-02, when the block went from six metrics to
// four. Both removals are recorded in market-weights.json's
// `_removed_2026_09_02`, and neither was a preference:
//
//   * Net domestic migration — Census PEP components is not exposed for a
//     metropolitan geography through the API; /pep/components 404s for an MSA.
//   * Real per-capita personal income — BEA's MSA series on FRED (RPIPC<code>)
//     resolves for every market and is DISCONTINUED, ending 2023-01-01. For a
//     growth metric, three and a half years stale is dead.
//
// Their weight moved to metrics that measure something adjacent: migration's
// to population growth, because migration is most of what moves a metro's
// population and they were never independent; income's to job growth.
//
// The floor stays as a tripwire against a block being emptied by accident, not
// as a claim about how many metrics there ought to be.
test("the macro sub-weights sum to one", () => {
  const vals = Object.values(weights.macro).map((m) => m.weight);
  assert.ok(vals.length >= 3, "macro block looks truncated");
  const total = vals.reduce((a, b) => a + b, 0);
  assert.ok(sumsToOne(total), `macro sub-weights sum to ${total}, not 1`);
});

// A metric that was removed for being unavailable must be removed from BOTH
// files, or the thresholds file grows a table of entries nothing can ever use
// and the next reader has to work out which list is authoritative.
test("nothing removed from the weights lingers in the thresholds", () => {
  const removed = Object.keys(weights._removed_2026_09_02 || {});
  const stillThere = removed.filter((k) => thresholds.macro && thresholds.macro[k]);
  assert.deepStrictEqual(stillThere, [],
    "a metric removed from market-weights.json still has a threshold");
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

test("the tier list is 50 primary, 50 secondary, and every remaining metro", () => {
  const counts = { primary: 0, secondary: 0, tertiary: 0 };
  for (const m of tiers.markets) counts[m.tier]++;
  assert.strictEqual(counts.primary, 50);
  assert.strictEqual(counts.secondary, 50);
  // Tertiary is "the rest above the population floor", so it is not pinned to a
  // number — the count moves when Census redraws a delineation or the floor is
  // retuned, and both are correct rather than a break.
  assert.ok(counts.tertiary > 50, "expected a real tail of tertiary markets");
  assert.strictEqual(tiers.markets.length, counts.primary + counts.secondary + counts.tertiary);
});

// The floor is a PRODUCT judgement, not a data limit — every metro has an
// employment series, including Eagle Pass TX at 57,770. Below roughly a quarter
// of a million people a metro has no institutional CRE market: few arms-length
// trades in a year, and a comp set one owner-user sale wide. Ranking one
// implies a precision the transaction volume cannot support, whatever the macro
// series say about it.
test("no market falls below the commercial-activity floor", () => {
  const floor = 250000;
  const under = tiers.markets.filter((m) => m.cbsa.population < floor);
  assert.deepStrictEqual(under.map((m) => `${m.market} (${m.cbsa.population})`), [],
    `below ${floor.toLocaleString()} the transaction volume cannot support a ranking`);
});

// Micropolitan areas are excluded, and this holds the line because the reason
// is easy to forget and the temptation to "just add the rest" is obvious.
// MEASURED 2026-09-02: BLS publishes no metro employment series for micros at
// all. Seaford DE (247,799, micropolitan) returns zero seasonally adjusted
// total-nonfarm series; Eagle Pass TX (57,770, the smallest METRO in the
// country) returns two. The cutoff is the statistical designation, not size —
// so adding the 542 micros would add 542 rows that can never score on the
// macro block.
test("no micropolitan area is in the list", () => {
  const micro = tiers.markets.filter((m) => /Micro Area/i.test(m.cbsa.name || ""));
  assert.deepStrictEqual(micro.map((m) => m.market), [],
    "a micropolitan area cannot score on the macro block — BLS publishes no employment series for one");
});

test("population is present, positive, and orders the tiers", () => {
  for (const m of tiers.markets) {
    assert.ok(Number.isFinite(m.cbsa.population) && m.cbsa.population > 0,
      `${m.market} has no population from Census`);
  }
  const primary = tiers.markets.filter((m) => m.tier === "primary");
  const tertiary = tiers.markets.filter((m) => m.tier === "tertiary");
  const smallestPrimary = Math.min(...primary.map((m) => m.cbsa.population));
  const largestTertiary = Math.max(...tertiary.map((m) => m.cbsa.population));
  assert.ok(smallestPrimary > largestTertiary,
    "tiers are population rank, so no tertiary market may be larger than a primary one");
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
//
// This test USED to assert that nothing was verified, because nothing had
// checked. That has been done: scripts/build-market-tiers.js generates the
// file from the Census Bureau, which is the body that defines CBSAs, so the
// codes are not merely checked but sourced. The invariant therefore inverts —
// a verified row must carry the EVIDENCE of its verification, so that a
// hand-edited `verified: true` is still caught.
//
// What that check found on the hand-written list it replaced: Cleveland was
// recorded as 17460, which is not a CBSA at all (17410 is Cleveland, OH), and
// 32 of 175 names were from an older delineation vintage.
test("every verified code carries the evidence of its verification", () => {
  for (const m of tiers.markets) {
    assert.strictEqual(m.cbsa.verified, true, `${m.market} is not verified`);
    assert.match(String(m.cbsa.verified_on || ""), /^\d{4}-\d{2}-\d{2}$/,
      `${m.market} claims verified with no date — a hand-set flag`);
    assert.match(String(m.cbsa.verified_by || ""), /scripts\/[a-z-]+\.js/,
      `${m.market} claims verified with no script named — only a script may set this`);
    assert.match(String(m.cbsa.verified_by || ""), /Census/,
      `${m.market}: only the Census Bureau defines a CBSA`);
  }
});

test("the file says it is derived, so nobody hand-edits it", () => {
  const note = String(tiers._comment || "").toLowerCase();
  assert.ok(note.includes("derived") && note.includes("regenerate"),
    "market-tiers.json must say it is generated — the next reader may never see this test");
  assert.ok(note.includes("different city"),
    "and must keep the reason the codes matter: a wrong code returns real data for a different city");
});
