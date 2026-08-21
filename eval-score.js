// ---------------------------------------------------------------------------
// Search-quality scoring. Turns one /api/comps report into a row of numbers,
// and a set of rows into a summary two runs can be diffed on.
//
// Deliberately PURE, like entitlements.js and corpus-audit.js: no I/O, no
// fetch, no clock reads (the caller passes `now`). run-eval.js owns every
// side effect.
//
// This is a SCORECARD, not an assertion suite. Nothing here has a pass/fail
// threshold: one run of a stochastic model over a dozen addresses is noisy,
// and a number dressed up as a verdict would be worse than no number. The
// product is the delta between two runs, read by a human.
// Spec: docs/superpowers/specs/2026-08-09-search-quality-eval-design.md
// ---------------------------------------------------------------------------

"use strict";

const VALUATION = require("./valuation");
const AUDIT = require("./corpus-audit");

function num(v) {
  const n = Number(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : NaN;
}

function isSale(c) {
  return !String((c && c.transaction) || "").toLowerCase().startsWith("lease");
}

// $/SF for a sale comp: the model's figure, else price / size.
function salePpsf(c) {
  const direct = num(c && c.price_per_sqft);
  if (direct > 0) return direct;
  const p = num(c && c.price_or_rate), s = num(c && c.size_sqft);
  return p > 0 && s > 0 ? p / s : NaN;
}

// "1 A St, Boise, ID 83702" -> "boise, id". An approximation of server.js's
// marketOf, which cannot be required here (server.js boots a server on
// require). Good enough to catch a comp from another metro, which is the
// failure this metric exists to see.
function cityStateOf(address) {
  const parts = String(address || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  const state = (parts[parts.length - 1].match(/^([A-Za-z]{2})\b/) || [])[1];
  if (!state) return "";
  return (parts[parts.length - 2] + ", " + state).toLowerCase();
}

function scoreReport(report, target, now) {
  const r = report || {};
  const comps = Array.isArray(r.comps) ? r.comps.filter(Boolean) : [];
  const months = Number((target && target.months) || 12);
  const windowStart = now - months * 30.44 * 24 * 3600 * 1000;
  const subjectMarket = cityStateOf(target && target.address);

  let pricedSales = 0, sized = 0, aggregate = 0, inWindow = 0, marketMatch = 0, estimates = 0;
  let weight = 0;
  const tierCounts = {};
  for (const c of comps) {
    const tier = VALUATION.tierOf(c) || "estimate";
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    weight += VALUATION.TIER_WEIGHT[tier] != null ? VALUATION.TIER_WEIGHT[tier] : 0;
    if (tier === "estimate") estimates += 1;
    if (AUDIT.isAggregateAddress(c.address)) aggregate += 1;
    const t = Date.parse(c.date);
    if (!isNaN(t) && t >= windowStart && t <= now) inWindow += 1;
    if (subjectMarket && cityStateOf(c.address) === subjectMarket) marketMatch += 1;
    if (isSale(c) && salePpsf(c) > 0) {
      pricedSales += 1;
      if (num(c.size_sqft) > 0) sized += 1;
    }
  }
  const rate = (n) => (comps.length ? n / comps.length : 0);
  const drivers = Array.isArray(r.value_drivers) ? r.value_drivers.join("") : String(r.value_drivers || "");
  return {
    comps: comps.length,
    pricedSales: pricedSales,
    valuationPossible: pricedSales >= 2,
    provenanceScore: comps.length ? weight / comps.length : 0,
    tierCounts: tierCounts,
    estimateRate: rate(estimates),
    aggregateRate: rate(aggregate),
    inWindowRate: rate(inWindow),
    marketMatchRate: rate(marketMatch),
    sizeRate: pricedSales ? sized / pricedSales : 0,
    subjectSizeFound: Boolean(r.subject_size_sqft),
    summaryChars: String(r.summary || "").length,
    valueDriversChars: drivers.length,
    marketTrendChars: String(r.market_trend || "").length,
    priceDiscoveryChars: String((r.price_discovery && r.price_discovery.note) || "").length,
    // What the search actually cost, from `_call` — attached by /api/comps for
    // an internal caller only (see the gate() closure) and present only on a
    // BILLED leg, never a cache hit. Absent leaves every key undefined, which
    // summarize() filters out of its averages rather than folding in as zero:
    // a run that never saw the field must report "no cost data", not "$0.00".
    //
    // reportTokens is the figure the other two exist to contextualize. On
    // Gemini `thought_tokens` is a SUBSET of `output_tokens`, so the report
    // itself is the remainder — and that remainder is what every prompt trim
    // this project has ever made was aiming at, while the thinking beside it is
    // several times larger. Without the split a THINKING_LEVEL comparison can
    // show that the clock moved but not that reasoning is why.
    ...costMetrics(r && r._call),
  };
}

function costMetrics(call) {
  if (!call || typeof call !== "object") return {};
  const u = (call.usage && typeof call.usage === "object") ? call.usage : {};
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  const output = num(u.output_tokens);
  const thought = num(u.thought_tokens);
  return {
    costUsd: num(call.cost_usd),
    billedCalls: num(call.billed_calls),
    inputTokens: num(u.input_tokens),
    outputTokens: output,
    thoughtTokens: thought,
    // Never negative, even if a provider one day reports the two independently
    // rather than as a subset — a negative "report size" would be nonsense in
    // an average and would hide the real bug behind a plausible-looking number.
    reportTokens: Math.max(0, output - thought),
    // The share of everything generated that was reasoning rather than report.
    // This is the single number that says whether THINKING_LEVEL is worth
    // touching on a given provider: at 0 it cannot help at all.
    thoughtShare: output > 0 ? thought / output : 0,
  };
}

// Averaged over SUCCESSES only. A failed target is a fact of its own (see
// `failures`), never a zero dragging an average toward a flattering middle.
const AVERAGED = ["comps", "pricedSales", "provenanceScore", "estimateRate", "aggregateRate",
  "inWindowRate", "marketMatchRate", "sizeRate", "summaryChars", "valueDriversChars",
  "marketTrendChars", "priceDiscoveryChars", "durationMs",
  // Spend and token accounting. These only appear when the run was made by an
  // internal caller against a billed leg; an older summary simply has none of
  // them, and compare() already reports a one-sided metric as null rather than
  // as a delta from zero.
  "costUsd", "billedCalls", "inputTokens", "outputTokens", "thoughtTokens",
  "reportTokens", "thoughtShare"];

function summarize(results) {
  const rows = Array.isArray(results) ? results : [];
  const ok = rows.filter((x) => x && x.ok && x.metrics);
  const metrics = {};
  for (const key of AVERAGED) {
    const vals = ok.map((x) => x.metrics[key]).filter((v) => typeof v === "number" && isFinite(v));
    if (vals.length) metrics[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  const boolRate = (key) => (ok.length ? ok.filter((x) => x.metrics[key]).length / ok.length : 0);
  return {
    targets: rows.length,
    scored: ok.length,
    failures: rows.length - ok.length,
    failedTargets: rows.filter((x) => !x || !x.ok).map((x) => ({ target: x && x.target, error: x && x.error })),
    metrics: metrics,
    valuationPossibleRate: boolRate("valuationPossible"),
    subjectSizeFoundRate: boolRate("subjectSizeFound"),
  };
}

function compare(baseline, candidate) {
  const b = baseline || {}, c = candidate || {};
  const bm = b.metrics || {}, cm = c.metrics || {};
  const metrics = {};
  for (const key of Object.keys(bm).concat(Object.keys(cm))) {
    if (metrics[key]) continue;
    const bv = typeof bm[key] === "number" ? bm[key] : null;
    const cv = typeof cm[key] === "number" ? cm[key] : null;
    let delta = null;
    if (bv != null && cv != null) {
      delta = parseFloat((cv - bv).toPrecision(15));
    }
    metrics[key] = { baseline: bv, candidate: cv, delta: delta };
  }
  const scalar = (key) => {
    const bv = typeof b[key] === "number" ? b[key] : null;
    const cv = typeof c[key] === "number" ? c[key] : null;
    let delta = null;
    if (bv != null && cv != null) {
      delta = parseFloat((cv - bv).toPrecision(15));
    }
    return { baseline: bv, candidate: cv, delta: delta };
  };
  return {
    metrics: metrics,
    valuationPossibleRate: scalar("valuationPossibleRate"),
    subjectSizeFoundRate: scalar("subjectSizeFoundRate"),
    failures: scalar("failures"),
  };
}

module.exports = { scoreReport, summarize, compare, cityStateOf, AVERAGED };
