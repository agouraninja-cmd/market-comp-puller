// The ranking arithmetic, and specifically the ways it must refuse to answer.
//
// Most of these tests are about ABSENCE rather than about the maths. Scoring a
// missing metric as zero is the failure this module was written to prevent:
// zero means "flat" on a -1..+1 scale, and a market with patchy data would be
// dragged to the middle and read as reliably average. Tertiary markets have
// the patchiest data of all — BLS suppresses small-cell employment, ACS
// carries wide margins — so the markets most likely to be scored wrong are
// exactly the ones a member would be least able to check.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const S = require("../market-score.js");
const ROOT = path.join(__dirname, "..");
const WEIGHTS = JSON.parse(fs.readFileSync(path.join(ROOT, "market-weights.json"), "utf8"));
const THRESHOLDS = JSON.parse(fs.readFileSync(path.join(ROOT, "market-thresholds.json"), "utf8"));

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ---------------------------------------------------------------- normalize -

test("normalize maps low/mid/high onto -1/0/+1 and clamps outside them", () => {
  const t = { low: -2, mid: 0.5, high: 3 };
  assert.ok(close(S.normalize(-2, t), -1));
  assert.ok(close(S.normalize(0.5, t), 0));
  assert.ok(close(S.normalize(3, t), 1));
  assert.ok(close(S.normalize(-50, t), -1), "far below low still clamps at -1");
  assert.ok(close(S.normalize(50, t), 1), "far above high still clamps at +1");
});

test("normalize is linear between the stated points, on both sides", () => {
  const t = { low: 0, mid: 10, high: 20 };
  assert.ok(close(S.normalize(5, t), -0.5));
  assert.ok(close(S.normalize(15, t), 0.5));
});

test("mid is not assumed to be zero", () => {
  // Population growth of exactly 0% must NOT read as flat: the country grows
  // near 0.5%, so a market at 0 is losing ground. This is the single most
  // likely threshold mistake and the reason the config says so out loud.
  const t = THRESHOLDS.macro["Population growth (YoY)"];
  assert.ok(t.mid > 0, "population growth's neutral point should be above zero");
  assert.ok(S.normalize(0, t) < 0, "0% population growth must score below flat");
});

test("invert flips the sense for indicators where lower is better", () => {
  const t = THRESHOLDS.macro["Unemployment rate (level and direction)"];
  assert.strictEqual(t.invert, true);
  assert.ok(S.normalize(3.0, t) > 0.9, "3% unemployment is a strong positive");
  assert.ok(S.normalize(8.0, t) < -0.9, "8% unemployment is a strong negative");
});

test("normalize returns null — never 0 — for anything it cannot read", () => {
  const t = { low: -2, mid: 0.5, high: 3 };
  for (const bad of [undefined, null, NaN, Infinity, "2.0", {}, []]) {
    assert.strictEqual(S.normalize(bad, t), null, "unreadable input must be null: " + String(bad));
  }
  assert.strictEqual(S.normalize(1, null), null, "no threshold means no score");
  assert.strictEqual(S.normalize(1, { low: 1, mid: 1, high: 3 }), null, "a degenerate threshold is unusable, not zero");
});

// -------------------------------------------------------------------- blend -

test("blend is a weighted mean over the metrics that have values", () => {
  const r = S.blend({ a: 1, b: -1 }, { a: 0.75, b: 0.25 });
  assert.ok(close(r.score, 0.5));
  assert.ok(close(r.coverage, 1));
});

// The rule this module exists for.
test("a missing metric is dropped and the rest renormalised, not scored as zero", () => {
  const both = S.blend({ a: 1, b: -1 }, { a: 0.5, b: 0.5 });
  assert.ok(close(both.score, 0));

  const oneMissing = S.blend({ a: 1, b: null }, { a: 0.5, b: 0.5 });
  assert.ok(close(oneMissing.score, 1),
    "with b absent the answer is a's score, not a's score halved toward zero");
  assert.ok(close(oneMissing.coverage, 0.5), "and coverage reports that half the weight was missing");
});

test("blend reports null when nothing at all was present", () => {
  const r = S.blend({ a: null, b: null }, { a: 0.5, b: 0.5 });
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.coverage, 0);
});

test("blend clamps to the scale even if inputs exceed it", () => {
  assert.ok(close(S.blend({ a: 5 }, { a: 1 }).score, 1));
  assert.ok(close(S.blend({ a: -5 }, { a: 1 }).score, -1));
});

// ---------------------------------------------------------------- composite -

test("an absent narrative renormalises the two public weights", () => {
  const w = { macro: 0.30, class: 0.45, narrative: 0.25 };
  const c = S.composite({ macro: 1, class: 0, narrative: null }, w);
  // 0.30 and 0.45 renormalise to 0.4 and 0.6.
  assert.ok(close(c.score, 0.4), "expected the public halves alone, renormalised");
  assert.ok(close(c.publicScore, 0.4));
});

test("absence of a narrative is never a penalty", () => {
  const w = { macro: 0.30, class: 0.45, narrative: 0.25 };
  const none = S.composite({ macro: 0.8, class: 0.8, narrative: null }, w).score;
  const zero = S.composite({ macro: 0.8, class: 0.8, narrative: 0 }, w).score;
  assert.ok(none > zero,
    "a market nobody has written about must not score below one somebody called flat");
});

test("publicScore is always computed, so the UI can show it beside the adjusted one", () => {
  const w = { macro: 0.30, class: 0.45, narrative: 0.25 };
  const c = S.composite({ macro: 0.5, class: 0.5, narrative: -1 }, w);
  assert.ok(close(c.publicScore, 0.5), "the public halves are unaffected by the narrative");
  assert.ok(c.score < c.publicScore, "and the narrative pulled the composite down");
});

// --------------------------------------------------------------------- band -

test("band uses symmetric edges and refuses to guess", () => {
  assert.strictEqual(S.band(0.25), "expanding");
  assert.strictEqual(S.band(0.24), "flat");
  assert.strictEqual(S.band(-0.25), "contracting");
  assert.strictEqual(S.band(-0.24), "flat");
  assert.strictEqual(S.band(null), null, "unknown must render nothing, never 'flat'");
  assert.strictEqual(S.band(NaN), null);
});

// -------------------------------------------------------------- scoreMarket -

function readings(macroVal, classVal) {
  const m = {}, c = {};
  for (const k of Object.keys(WEIGHTS.macro)) m[k] = macroVal;
  for (const k of Object.keys(WEIGHTS.class_specific.industrial)) c[k] = classVal;
  return { macroReadings: m, classReadings: c };
}

test("scoreMarket runs end to end against the committed config", () => {
  const r = S.scoreMarket(
    Object.assign(readings(3.0, 3.5), { narrative: 0.5 }),
    { assetClass: "industrial", weights: WEIGHTS, thresholds: THRESHOLDS }
  );
  assert.ok(r, "expected a result");
  assert.strictEqual(r.assetClass, "industrial");
  assert.ok(typeof r.score === "number" && r.score > 0);
  assert.ok(typeof r.publicScore === "number");
  assert.ok(["expanding", "flat", "contracting"].includes(r.band));
  assert.deepStrictEqual(r.weights, {
    macro: WEIGHTS.by_asset_class.industrial.macro,
    class: WEIGHTS.by_asset_class.industrial.class,
    narrative: WEIGHTS.by_asset_class.industrial.narrative,
  });
});

test("scoreMarket reports coverage rather than hiding a thin score", () => {
  const input = readings(2.0, 2.0);
  // Knock out every macro reading but one.
  const keys = Object.keys(input.macroReadings);
  keys.slice(1).forEach((k) => { delete input.macroReadings[k]; });
  const r = S.scoreMarket(input, { assetClass: "industrial", weights: WEIGHTS, thresholds: THRESHOLDS });
  assert.ok(r.macro.coverage > 0 && r.macro.coverage < 1,
    "a partially-covered block must say so, so a caller can refuse it");
  assert.ok(typeof r.macro.score === "number", "and still answer from what it had");
});

test("a market with no readings at all scores null, not zero", () => {
  const r = S.scoreMarket({ macroReadings: {}, classReadings: {}, narrative: null },
    { assetClass: "industrial", weights: WEIGHTS, thresholds: THRESHOLDS });
  assert.strictEqual(r.macro.score, null);
  assert.strictEqual(r.class.score, null);
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.band, null);
});

test("bandMovedByNarrative flags when a lens changed the word, not just the decimal", () => {
  const cfg = { assetClass: "industrial", weights: WEIGHTS, thresholds: THRESHOLDS };
  const base = readings(1.2, 1.2);          // lands somewhere near flat/positive

  const small = S.scoreMarket(Object.assign({}, base, { narrative: 0.05 }), cfg);
  const large = S.scoreMarket(Object.assign({}, base, { narrative: -1 }), cfg);
  assert.strictEqual(typeof small.bandMovedByNarrative, "boolean");
  assert.strictEqual(typeof large.bandMovedByNarrative, "boolean");
  assert.ok(large.score < small.score, "a strongly negative lens must pull the composite down");
});

test("every asset class in the weights file scores without throwing", () => {
  for (const cls of Object.keys(WEIGHTS.by_asset_class)) {
    const m = {}, c = {};
    for (const k of Object.keys(WEIGHTS.macro)) m[k] = 1.0;
    for (const k of Object.keys(WEIGHTS.class_specific[cls])) c[k] = 1.0;
    const r = S.scoreMarket({ macroReadings: m, classReadings: c, narrative: 0 },
      { assetClass: cls, weights: WEIGHTS, thresholds: THRESHOLDS });
    assert.ok(r && typeof r.score === "number", cls + " failed to score");
  }
});

test("an unknown asset class returns null rather than a confident zero", () => {
  assert.strictEqual(
    S.scoreMarket({ macroReadings: {}, classReadings: {} },
      { assetClass: "datacenter", weights: WEIGHTS, thresholds: THRESHOLDS }),
    null);
});

test("junk never throws", () => {
  assert.doesNotThrow(() => S.scoreMarket(null, null));
  assert.doesNotThrow(() => S.scoreMarket({}, { assetClass: "industrial", weights: WEIGHTS }));
  assert.doesNotThrow(() => S.blend(null, null));
  assert.doesNotThrow(() => S.composite(null, null));
});

// ------------------------------------------------------- config <-> module --

test("every weighted metric has a threshold, and every threshold a weight", () => {
  const wm = Object.keys(WEIGHTS.macro).sort();
  const tm = Object.keys(THRESHOLDS.macro).sort();
  assert.deepStrictEqual(wm, tm,
    "market-weights.json and market-thresholds.json name different macro metrics — " +
    "a weighted metric with no threshold scores null and silently loses its weight");

  for (const cls of Object.keys(WEIGHTS.class_specific)) {
    const w = Object.keys(WEIGHTS.class_specific[cls]).sort();
    const t = Object.keys(THRESHOLDS.class_specific[cls] || {}).sort();
    assert.deepStrictEqual(w, t, cls + ": weights and thresholds name different metrics");
  }
});

test("every threshold is usable: low < mid < high, and units are stated", () => {
  const blocks = [["macro", THRESHOLDS.macro]].concat(
    Object.keys(THRESHOLDS.class_specific).map((c) => [c, THRESHOLDS.class_specific[c]]));
  for (const [where, block] of blocks) {
    for (const name of Object.keys(block)) {
      const t = block[name];
      assert.ok(t.low < t.mid && t.mid < t.high,
        `${where}.${name}: low<mid<high is required (got ${t.low}/${t.mid}/${t.high})`);
      assert.ok(String(t.unit || "").trim(),
        `${where}.${name}: no unit stated — a threshold whose unit is a guess is worse than none`);
    }
  }
});
