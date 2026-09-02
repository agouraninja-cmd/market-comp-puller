// ---------------------------------------------------------------------------
// The market ranking arithmetic: three weighted parts into one score.
//
// Spec: docs/superpowers/specs/2026-09-01-market-ranking-design.md
//
//     score = Wm x macro + Wc x class-specific + Wn x narrative
//
// Every score in this file is on a -1..+1 scale where -1 is contracting, 0 is
// flat and +1 is expanding, and the three weights for an asset class sum to 1
// (test/market-ranking-config.test.js holds that against market-weights.json).
//
// PURE, like valuation.js, entitlements.js and comp-gate.js: no DOM, no fetch,
// no clock, no require of anything that has any of those. The weights and
// thresholds are PASSED IN rather than read from disk here, so the same
// function serves the server, the test suite and — via the browser global
// below — a page that wants to re-score as a member moves a slider.
//
// DUAL-EXPORTED for that last reason (the valuation.js precedent): Node for
// server.js and npm test, `MARKETSCORE` for index.html.
//
// ---------------------------------------------------------------------------
// THE RULE THAT MATTERS MOST IN HERE: a missing input is NOT a zero.
//
// Zero on a -1..+1 scale means "flat" — a measurement. Absent means "we do not
// know". Scoring an absent metric as zero silently drags every market with
// patchy data toward the middle, and tertiary markets have the patchiest data
// of all: BLS suppresses small-cell employment and ACS carries wide margins
// exactly where the corpus is thinnest. That would make small markets look
// reliably average, which is the most expensive kind of wrong — it reads as a
// finding rather than as a gap.
//
// So every function here drops absent metrics and RENORMALISES the weights of
// the ones that remain, then reports how much weight it actually had. A caller
// that wants to refuse a thin score can read `coverage` and decide; the
// arithmetic never decides silently.
// ---------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MARKETSCORE = api;
})(typeof self !== "undefined" ? self : this, function () {

// Band edges. Deliberately symmetric and deliberately wide: the vocabulary is
// three words, and a market one hundredth over an edge should not flip a badge
// that a reader treats as a claim about the world. Matches the spec.
const BAND_EDGE = 0.25;

function isNum(v) { return typeof v === "number" && isFinite(v); }

// A raw indicator (job growth in percent, migration per thousand) onto -1..+1.
//
// Piecewise linear through three stated points rather than a curve: `mid` is
// the value that should read as flat, and it is NOT usually zero. Population
// growth of exactly 0% is a market losing ground against a country growing at
// ~0.5%, and a threshold table that treated 0 as neutral would call it flat.
// Every mid in market-weights.json is therefore an explicit judgement, visible
// in a diff.
//
// `invert` is for indicators where lower is better — unemployment is the only
// one today. Inverting at the threshold rather than negating the weight keeps
// every weight positive, so a reader of the config never has to work out what
// a negative weight would have meant.
function normalize(value, t) {
  if (!isNum(value) || !t || !isNum(t.low) || !isNum(t.mid) || !isNum(t.high)) return null;
  if (t.low === t.mid || t.mid === t.high) return null;   // an unusable threshold is absent, not zero
  let s;
  if (value <= t.mid) s = -1 * Math.min(1, (t.mid - value) / (t.mid - t.low));
  else s = Math.min(1, (value - t.mid) / (t.high - t.mid));
  return t.invert ? -s : s;
}

// Weighted mean over the metrics that HAVE a value, with the weights of the
// rest removed from the denominator. Returns the score and the share of the
// block's total weight that was actually present.
//
// `weights` is { metricName: number }, `scores` is { metricName: number|null }.
function blend(scores, weights) {
  let num = 0, den = 0, total = 0;
  for (const name of Object.keys(weights || {})) {
    const w = weights[name];
    if (!isNum(w) || w <= 0) continue;
    total += w;
    const s = scores ? scores[name] : null;
    if (!isNum(s)) continue;
    num += s * w;
    den += w;
  }
  if (den <= 0) return { score: null, coverage: 0 };
  return {
    score: Math.max(-1, Math.min(1, num / den)),
    coverage: total > 0 ? den / total : 0,
  };
}

// Turn raw readings into normalized per-metric scores, then blend them.
//
//   readings   { metricName: rawValue }
//   weights    { metricName: weight }        e.g. market-weights.json .macro
//   thresholds { metricName: {low,mid,high,invert?} }
function scoreBlock(readings, weights, thresholds) {
  const scores = {};
  for (const name of Object.keys(weights || {})) {
    const raw = readings ? readings[name] : undefined;
    scores[name] = normalize(raw, thresholds ? thresholds[name] : null);
  }
  const out = blend(scores, weights);
  out.metrics = scores;
  return out;
}

// The composite. `parts` is { macro, class, narrative }, each a number on
// -1..+1 or null; `w` is { macro, class, narrative } summing to 1.
//
// An absent part is dropped and the rest renormalised, which is how the spec's
// "absence is never a penalty" rule is implemented: a market nobody has written
// a narrative for scores on its public halves alone rather than being pulled
// toward zero by a narrative of 0. The same mechanism covers a firm that sets
// the narrative weight to zero deliberately — it simply has no narrative
// weight to renormalise.
function composite(parts, w) {
  const res = blend(
    { macro: parts ? parts.macro : null, class: parts ? parts.class : null, narrative: parts ? parts.narrative : null },
    { macro: w ? w.macro : 0, class: w ? w.class : 0, narrative: w ? w.narrative : 0 }
  );
  return {
    score: res.score,
    coverage: res.coverage,
    // The public-only score, always computed, because the UI must be able to
    // show it beside the adjusted one. That side-by-side is the whole
    // defensibility argument in the spec, and computing it here means no
    // caller can render the adjusted number without having this one to hand.
    publicScore: blend(
      { macro: parts ? parts.macro : null, class: parts ? parts.class : null },
      { macro: w ? w.macro : 0, class: w ? w.class : 0 }
    ).score,
  };
}

function band(score) {
  if (!isNum(score)) return null;                 // unknown renders nothing, never "flat"
  if (score >= BAND_EDGE) return "expanding";
  if (score <= -BAND_EDGE) return "contracting";
  return "flat";
}

// The whole pipeline for one market and one asset class.
//
//   input.macroReadings   raw macro indicators
//   input.classReadings   raw class-specific indicators
//   input.narrative       -1..+1 from a lens, or null
//   config.weights        market-weights.json (parsed)
//   config.thresholds     threshold table (parsed)
//   config.assetClass     'industrial' | ...
//   config.overrides      optional per-firm { macro, class, narrative }
//
// Returns every intermediate value, not just the answer. A ranking whose
// components cannot be read back is one nobody can argue with, and being
// arguable is the entire reason this replaces a word the model asserted.
function scoreMarket(input, config) {
  const cls = config && config.assetClass;
  const weights = config && config.weights;
  const thresholds = (config && config.thresholds) || {};
  const top = (config && config.overrides) || (weights && weights.by_asset_class && weights.by_asset_class[cls]);
  if (!top) return null;

  const macro = scoreBlock(input && input.macroReadings, weights.macro && mapWeights(weights.macro), thresholds.macro);
  const klass = scoreBlock(
    input && input.classReadings,
    weights.class_specific && weights.class_specific[cls] && mapWeights(weights.class_specific[cls]),
    thresholds.class_specific && thresholds.class_specific[cls]
  );
  const narrative = isNum(input && input.narrative) ? Math.max(-1, Math.min(1, input.narrative)) : null;

  const comp = composite(
    { macro: macro.score, class: klass.score, narrative: narrative },
    { macro: top.macro, class: top.class, narrative: top.narrative }
  );

  return {
    assetClass: cls,
    macro: macro,
    class: klass,
    narrative: narrative,
    score: comp.score,
    publicScore: comp.publicScore,
    coverage: comp.coverage,
    band: band(comp.score),
    publicBand: band(comp.publicScore),
    // True when the narrative changed which of the three words is shown. The
    // UI should say so out loud: a lens that moved a decimal is different from
    // one that moved a market from flat to contracting, and only the second is
    // worth a reader's attention.
    bandMovedByNarrative: band(comp.score) !== band(comp.publicScore),
    weights: { macro: top.macro, class: top.class, narrative: top.narrative },
  };
}

// market-weights.json stores { metric: {weight, source, note} } so the config
// can carry provenance beside every number — an unsourced input cannot be
// audited, and a test holds that. blend() wants a flat { metric: weight },
// so this is the adaptor between the file's shape and the arithmetic's.
function mapWeights(block) {
  const out = {};
  for (const k of Object.keys(block || {})) {
    const v = block[k];
    out[k] = (v && typeof v === "object") ? v.weight : v;
  }
  return out;
}

return { BAND_EDGE, normalize, blend, scoreBlock, composite, band, scoreMarket, mapWeights };
});
