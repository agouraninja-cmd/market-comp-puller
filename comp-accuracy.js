// ---------------------------------------------------------------------------
// Comp search accuracy: are the comp's own numbers self-consistent, and do
// they match a known deal?
//
// The gap this fills: eval-score.js scores the SHAPE of a report (how many
// priced sales, what provenance tier), corpus-audit.js scores CITATION
// INTEGRITY, and backtest.js scores the reconciliation MATH over comps
// already harvested. All three say so in their own headers, at length. None
// of them asks whether a returned comp is TRUE, which is the product's core
// function. A report of twelve beautifully-tiered comps with the wrong
// prices scores perfectly on every existing instrument.
//
// TWO FAMILIES, and the difference between them matters when reading the
// output:
//
//   1. Self-consistency (checkComps). Needs no answer key, costs nothing,
//      deterministic. A comp whose price, size and $/SF do not divide is
//      wrong, full stop. These are DEFECTS, not signals.
//   2. Ground-truth agreement (scoreTruth). Needs truth-set.json. Recall and
//      field agreement against deals we independently know. A SCORECARD, in
//      eval-score.js's sense: a small sample of a stochastic system, read as
//      a delta between two runs rather than as a verdict.
//
// PURE, like entitlements.js, comp-gate.js, corpus-audit.js and backtest.js:
// no I/O, no fetch, no clock reads (the caller passes `now`). run-accuracy.js
// owns every side effect.
//
// Where a rule already exists somewhere in this repo it is REQUIRED, never
// restated: normAddress from backtest.js (a cross-search building identity
// that already had the Red Label Lane spelling bug beaten out of it),
// cityStateOf from eval-score.js, numericValue from valuation.js,
// isAggregateAddress from corpus-audit.js. Every one of those would
// otherwise be a second copy to keep in step.
//
// See docs/superpowers/specs/2026-08-16-comp-search-accuracy-design.md.
// ---------------------------------------------------------------------------

"use strict";

const VALUATION = require("./valuation");
const AUDIT = require("./corpus-audit");
const BACKTEST = require("./backtest");
const SCORE = require("./eval-score");

// --- Tolerances -----------------------------------------------------------
// Exported so a caller can report the threshold beside the number, and so a
// test names the same constant the code does.

// Stated $/SF vs price / size. Loose enough to absorb the model rounding a
// figure to whole dollars, tight enough that a genuinely different number
// shows. A $104.37/SF comp written as "$104" is 0.35% off.
const PSF_TOLERANCE = 0.05;

// Per-unit and per-acre denominators, same reasoning.
const ALT_BASIS_TOLERANCE = 0.05;

// A matched deal's price. Deliberately the tightest of the three: a sale
// price is an exact, recorded number, so a real match should be near exact
// and anything past a couple of percent means one of the two is wrong.
const PRICE_TOLERANCE = 0.02;

// A matched deal's size. Deliberately looser than price: gross vs rentable
// vs assessor-recorded square footage genuinely differ between sources for
// the same building, and calling that a comp error would flag honest data.
const SIZE_TOLERANCE = 0.05;

// A matched deal's date. A recording date and a closing date are routinely
// weeks apart, and different sources quote different ones.
const DATE_TOLERANCE_DAYS = 31;

// Effective sale $/SF outside this band is garbage rather than an opinion.
// Very wide on purpose: this is here to catch a parse failure or a units
// mix-up, not to disagree with Manhattan retail or cheap rural land.
const SANE_PSF_MIN = 1;
const SANE_PSF_MAX = 20000;

// A sale price below this, on a building over MIN_SIZED_SF, is not a price.
// Catches "$1.2M" (which numericValue reads as 1.2, a hazard valuation.js's
// salePsfOf already guards against, which is how we know the model writes
// it) and a lease rate written into the sale price field.
const MIN_SALE_PRICE = 10000;
const MIN_SIZED_SF = 1000;

const FINDING_KEYS = [
  "psf_mismatch",
  "alt_basis_mismatch",
  "rate_as_sale_price",
  "implausible_psf",
  "future_date",
  "duplicate_comp",
];

// Bases that may stand in as an answer. `model_corpus` is refused by name:
// a deal a past search produced is not independent of the thing being
// measured, so scoring a new search against it measures agreement between
// two model runs and reports a flattering number for a shared mistake. Same
// rule as backtest.js's GROUND_TRUTH_TIERS, restated for a different harness.
const TRUTH_BASES = ["broker_verified", "public_record", "news", "listing"];
const REFUSED_BASES = ["model_corpus", "estimate", "model"];

// A basis that names a document has to cite it. broker_verified does not:
// the citation there is a named broker who vouched, recorded in
// comp_submissions rather than at a URL.
const BASES_REQUIRING_URL = ["public_record", "news", "listing"];

const DAY_MS = 24 * 3600 * 1000;

function num(v) {
  return VALUATION.numericValue(v);
}

function isSale(c) {
  return !String((c && c.transaction) || "").toLowerCase().startsWith("lease");
}

function relDiff(a, b) {
  if (!(a > 0) || !(b > 0)) return NaN;
  return Math.abs(a - b) / b;
}

function parseDate(v) {
  const t = Date.parse(String(v == null ? "" : v));
  return isNaN(t) ? null : t;
}

// ---------------------------------------------------------------------------
// Family 1: self-consistency. No answer key, no cost, no opinions.
// ---------------------------------------------------------------------------

// Findings for ONE comp, ignoring the rest of the list (duplicates are a
// property of the list and are added by checkComps).
function checkComp(comp, now) {
  const c = comp || {};
  const out = [];
  const price = num(c.price_or_rate);
  const size = num(c.size_sqft);
  const statedPsf = num(c.price_per_sqft);
  const sale = isSale(c);

  // Order matters for readability of the output, not for correctness: the
  // shorthand check runs first so a "$1.2M" comp is reported as the parse
  // failure it is rather than as three downstream complaints about the
  // nonsense that number produces.
  if (sale && price > 0 && price < MIN_SALE_PRICE && size > MIN_SIZED_SF) {
    out.push({
      key: "rate_as_sale_price",
      detail: `sale price parses as ${price} on ${size} SF: shorthand like "$1.2M" or a lease rate in the price field`,
    });
  } else {
    if (sale && price > 0 && size > 0 && statedPsf > 0) {
      const derived = price / size;
      const inBand = (v) => v >= SANE_PSF_MIN && v <= SANE_PSF_MAX;
      const diff = relDiff(statedPsf, derived);
      if (inBand(derived) && inBand(statedPsf) && diff > PSF_TOLERANCE) {
        out.push({
          key: "psf_mismatch",
          detail: `stated $${round(statedPsf)}/SF vs ${price} / ${size} = $${round(derived)}/SF (${pct(diff)} apart)`,
        });
      }
    }
    if (sale) {
      const psf = statedPsf > 0 ? statedPsf : (price > 0 && size > 0 ? price / size : NaN);
      if (psf > 0 && (psf < SANE_PSF_MIN || psf > SANE_PSF_MAX)) {
        out.push({ key: "implausible_psf", detail: `$${round(psf)}/SF` });
      }
    }
  }

  // The denominators the market actually quotes for two of the six types.
  // Nothing else in the repo checks these, and for Multifamily and Land they
  // are the headline figure rather than a secondary column.
  const alt = [
    ["price_per_unit", "units", "unit"],
    ["price_per_acre", "lot_acres", "acre"],
  ];
  for (const [rateKey, countKey, label] of alt) {
    const rate = num(c[rateKey]);
    const count = num(c[countKey]);
    if (!(sale && rate > 0 && count > 0 && price > 0)) continue;
    const derived = price / count;
    const diff = relDiff(rate, derived);
    if (diff > ALT_BASIS_TOLERANCE) {
      out.push({
        key: "alt_basis_mismatch",
        detail: `stated $${round(rate)}/${label} vs ${price} / ${count} = $${round(derived)}/${label} (${pct(diff)} apart)`,
      });
    }
  }

  const t = parseDate(c.date);
  // One day of slack so a timezone-less date string on today's deal is not
  // reported as a deal from the future.
  if (t != null && t > now + DAY_MS) {
    out.push({ key: "future_date", detail: String(c.date) });
  }

  return out;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function pct(fraction) {
  return `${Math.round(fraction * 1000) / 10}%`;
}

// Two comps are the same building when their street-line key matches, or
// when size AND price match exactly. The second test is backtest.js's own
// belt-and-braces rule and it is here for the same reason it is there: that
// harness was once fooled into scoring three spellings of one warehouse as
// three independent subjects, and one building voting twice in a median is
// the identical failure one layer up.
function sameBuilding(a, b) {
  if (a.key && a.key === b.key) return true;
  const asz = num(a.comp.size_sqft), bsz = num(b.comp.size_sqft);
  if (!(asz > 0) || asz !== bsz) return false;
  const ap = num(a.comp.price_or_rate), bp = num(b.comp.price_or_rate);
  return ap > 0 && ap === bp;
}

function checkComps(comps, opts) {
  const list = (Array.isArray(comps) ? comps : []).filter(Boolean);
  const now = Number((opts && opts.now) || 0);
  const findings = {};
  FINDING_KEYS.forEach((k) => { findings[k] = 0; });
  const flagged = [];
  const seen = [];

  list.forEach((comp, i) => {
    const entry = { comp: comp, key: BACKTEST.normAddress(comp.address) };
    const hits = checkComp(comp, now);

    const dupOf = seen.find((s) => sameBuilding(s, entry));
    if (dupOf) {
      hits.push({
        key: "duplicate_comp",
        detail: `same building as "${dupOf.comp.address}"`,
      });
    }
    seen.push(entry);

    hits.forEach((h) => {
      findings[h.key] = (findings[h.key] || 0) + 1;
      flagged.push({ index: i, address: String(comp.address || ""), key: h.key, detail: h.detail });
    });
  });

  const dirty = new Set(flagged.map((f) => f.index));
  const clean = list.length - dirty.size;
  return {
    total: list.length,
    clean: clean,
    // An empty list scores 1 rather than NaN: there is nothing wrong with
    // it. Same call corpus-audit.js makes.
    score: list.length ? clean / list.length : 1,
    findings: findings,
    flagged: flagged,
  };
}

// ---------------------------------------------------------------------------
// Family 2: agreement with an answer key.
// ---------------------------------------------------------------------------

function dealMarket(deal) {
  const d = deal || {};
  return SCORE.cityStateOf(d.city_state || d.address || "");
}

// The deals a competent search of this target SHOULD have found: our market,
// our property type, inside the window that was asked for.
function expectedDeals(truthRows, target, now) {
  const rows = (Array.isArray(truthRows) ? truthRows : []).filter(Boolean);
  const t = target || {};
  const market = SCORE.cityStateOf(t.address);
  const type = String(t.type || "").toLowerCase();
  const months = Number(t.months || 12);
  const windowStart = now - months * 30.44 * DAY_MS;
  return rows.filter((d) => {
    if (market && dealMarket(d) !== market) return false;
    if (type && String(d.type || "").toLowerCase() !== type) return false;
    const at = parseDate(d.date);
    return at != null && at >= windowStart && at <= now;
  });
}

// A returned comp is this deal when the building matches by address key, or
// when price, size and date all agree closely enough that it cannot
// plausibly be a different transaction.
function matchComp(deal, comps) {
  const key = BACKTEST.normAddress(deal.address);
  const byAddress = comps.find((c) => key && BACKTEST.normAddress(c.address) === key);
  if (byAddress) return byAddress;
  const dp = num(deal.price), ds = num(deal.size_sqft), dt = parseDate(deal.date);
  if (!(dp > 0) || !(ds > 0) || dt == null) return null;
  return comps.find((c) => {
    const ct = parseDate(c.date);
    if (ct == null || Math.abs(ct - dt) > DATE_TOLERANCE_DAYS * DAY_MS) return false;
    return relDiff(num(c.price_or_rate), dp) <= PRICE_TOLERANCE
      && relDiff(num(c.size_sqft), ds) <= SIZE_TOLERANCE;
  }) || null;
}

function scoreTruth(report, truthRows, target, now) {
  const comps = Array.isArray(report && report.comps) ? report.comps.filter(Boolean) : [];
  const expected = expectedDeals(truthRows, target, now);

  const matched = [];
  const missed = [];
  const matchedComps = new Set();

  for (const deal of expected) {
    const comp = matchComp(deal, comps);
    if (!comp) {
      missed.push(deal.address);
      continue;
    }
    matchedComps.add(comp);
    const priceError = relDiff(num(comp.price_or_rate), num(deal.price));
    const sizeError = relDiff(num(comp.size_sqft), num(deal.size_sqft));
    const ct = parseDate(comp.date), dt = parseDate(deal.date);
    const dateErrorDays = ct != null && dt != null ? Math.abs(ct - dt) / DAY_MS : NaN;
    matched.push({
      address: deal.address,
      basis: deal.basis,
      priceError: priceError,
      sizeError: sizeError,
      dateErrorDays: dateErrorDays,
      // An unreported field is not a disagreement: the comp simply does not
      // carry it, which family 1 and eval-score.js's sizeRate already see.
      priceAgrees: isNaN(priceError) ? null : priceError <= PRICE_TOLERANCE,
      sizeAgrees: isNaN(sizeError) ? null : sizeError <= SIZE_TOLERANCE,
      dateAgrees: isNaN(dateErrorDays) ? null : dateErrorDays <= DATE_TOLERANCE_DAYS,
    });
  }

  const rate = (field) => {
    const vals = matched.map((m) => m[field]).filter((v) => v !== null);
    return vals.length ? vals.filter(Boolean).length / vals.length : null;
  };

  // Comps we cannot speak to. NOT an error rate, and nothing here may turn
  // it into one: the answer key holds the deals we happen to know, not every
  // deal in the market, so an unmatched comp is UNPROVEN rather than false.
  // Reporting it as a false-positive rate would produce a confident accuracy
  // number that mostly measures how small the truth set is. A test pins this.
  const unverified = comps.length - matchedComps.size;

  return {
    expected: expected.length,
    found: matched.length,
    // Null rather than 0 when the key covers nothing here: no expected deals
    // is "not measured", and a zero would read as a total miss and drag any
    // average that pooled it.
    recall: expected.length ? matched.length / expected.length : null,
    missed: missed,
    matched: matched,
    priceAgreeRate: rate("priceAgrees"),
    sizeAgreeRate: rate("sizeAgrees"),
    dateAgreeRate: rate("dateAgrees"),
    contradictions: matched.filter((m) => m.priceAgrees === false).length,
    unverified: unverified,
    unverifiedRate: comps.length ? unverified / comps.length : 0,
  };
}

// One report, both families.
function scoreAccuracy(report, opts) {
  const o = opts || {};
  const now = Number(o.now || 0);
  const comps = Array.isArray(report && report.comps) ? report.comps.filter(Boolean) : [];
  return {
    consistency: checkComps(comps, { now: now }),
    truth: scoreTruth(report, o.truth || [], o.target || {}, now),
  };
}

// ---------------------------------------------------------------------------
// Roll-up across reports.
// ---------------------------------------------------------------------------

// Recall and the agreement rates are POOLED (sum of numerators over sum of
// denominators), never averaged over per-report rates: a target with one
// expected deal would otherwise carry the same weight as one with twenty,
// and with a small answer key that is most of the variance in the number.
function summarizeAccuracy(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.ok !== false);
  const findings = {};
  FINDING_KEYS.forEach((k) => { findings[k] = 0; });
  let total = 0, clean = 0;
  let expected = 0, found = 0, contradictions = 0, unverified = 0, comps = 0;
  const agree = { priceAgrees: [0, 0], sizeAgrees: [0, 0], dateAgrees: [0, 0] };

  for (const r of list) {
    const c = r.consistency || {};
    total += c.total || 0;
    clean += c.clean || 0;
    FINDING_KEYS.forEach((k) => { findings[k] += (c.findings && c.findings[k]) || 0; });

    const t = r.truth || {};
    expected += t.expected || 0;
    found += t.found || 0;
    contradictions += t.contradictions || 0;
    unverified += t.unverified || 0;
    comps += (t.unverified || 0) + (t.found || 0);
    (t.matched || []).forEach((m) => {
      Object.keys(agree).forEach((f) => {
        if (m[f] === null || m[f] === undefined) return;
        agree[f][1] += 1;
        if (m[f]) agree[f][0] += 1;
      });
    });
  }

  const pooled = ([hit, n]) => (n ? hit / n : null);
  return {
    reports: list.length,
    comps: total,
    consistencyScore: total ? clean / total : 1,
    findings: findings,
    truthExpected: expected,
    truthFound: found,
    recall: expected ? found / expected : null,
    priceAgreeRate: pooled(agree.priceAgrees),
    sizeAgreeRate: pooled(agree.sizeAgrees),
    dateAgreeRate: pooled(agree.dateAgrees),
    contradictions: contradictions,
    // Carried as a plain count and a rate, never named an error rate.
    unverified: unverified,
    unverifiedRate: comps ? unverified / comps : 0,
  };
}

const COMPARED = ["consistencyScore", "recall", "priceAgreeRate", "sizeAgreeRate",
  "dateAgreeRate", "contradictions", "unverifiedRate", "comps", "truthExpected", "truthFound"];

function compareAccuracy(baseline, candidate) {
  const b = baseline || {}, c = candidate || {};
  const out = {};
  const cell = (bv, cv) => ({
    baseline: typeof bv === "number" ? bv : null,
    candidate: typeof cv === "number" ? cv : null,
    delta: typeof bv === "number" && typeof cv === "number"
      ? parseFloat((cv - bv).toPrecision(15)) : null,
  });
  COMPARED.forEach((k) => { out[k] = cell(b[k], c[k]); });
  const findings = {};
  FINDING_KEYS.forEach((k) => {
    findings[k] = cell((b.findings || {})[k], (c.findings || {})[k]);
  });
  return { metrics: out, findings: findings };
}

// ---------------------------------------------------------------------------
// The answer key's own rules.
// ---------------------------------------------------------------------------

function validateDeal(deal, i) {
  const d = deal || {};
  const where = `deal ${i + 1}${d.address ? ` (${d.address})` : ""}`;
  const errors = [];
  const basis = String(d.basis || "");

  if (REFUSED_BASES.indexOf(basis) >= 0) {
    errors.push(`${where}: basis "${basis}" is not independent of the search being measured. A deal a past search produced cannot be its own answer key.`);
  } else if (TRUTH_BASES.indexOf(basis) < 0) {
    errors.push(`${where}: basis must be one of ${TRUTH_BASES.join(", ")} (got "${basis}")`);
  } else if (BASES_REQUIRING_URL.indexOf(basis) >= 0 && !/^https?:\/\//i.test(String(d.source_url || ""))) {
    errors.push(`${where}: basis "${basis}" cites a document, so source_url must be an http(s) URL`);
  }

  if (!String(d.address || "").trim()) errors.push(`${where}: address is required`);
  else if (AUDIT.isAggregateAddress(d.address)) {
    errors.push(`${where}: address names a statistic or carries no street number, so it cannot be an answer`);
  }
  if (!dealMarket(d)) errors.push(`${where}: needs a "City, ST" tail, in address or city_state`);
  if (!String(d.type || "").trim()) errors.push(`${where}: type is required`);
  if (parseDate(d.date) == null) errors.push(`${where}: date must parse (YYYY-MM-DD)`);
  if (!(num(d.price) > 0)) errors.push(`${where}: price must parse to a positive number`);
  if (d.size_sqft != null && d.size_sqft !== "" && !(num(d.size_sqft) > 0)) {
    errors.push(`${where}: size_sqft, when given, must parse to a positive number`);
  }
  return errors;
}

function validateTruthSet(set) {
  const s = set || {};
  const deals = Array.isArray(s.deals) ? s.deals : null;
  if (!deals) return { ok: false, deals: 0, errors: ["truth set has no `deals` array"] };
  const errors = [];
  deals.forEach((d, i) => { errors.push.apply(errors, validateDeal(d, i)); });
  return { ok: errors.length === 0, deals: deals.length, errors: errors };
}

// The answer key defines the exam: one search per market and property type
// it holds, with a window wide enough to reach that group's oldest deal.
function targetsFromTruthSet(set, opts) {
  const o = opts || {};
  const now = Number(o.now || 0);
  const maxComps = Number(o.maxComps || 12);
  const deals = Array.isArray(set && set.deals) ? set.deals.filter(Boolean) : [];
  const groups = new Map();
  for (const d of deals) {
    const market = dealMarket(d);
    const at = parseDate(d.date);
    if (!market || at == null) continue;
    const type = String(d.type || "").trim();
    const gk = `${market}|${type.toLowerCase()}`;
    const months = Math.ceil((now - at) / (30.44 * DAY_MS));
    const g = groups.get(gk);
    if (g) {
      g.months = Math.max(g.months, months);
      g.deals += 1;
    } else {
      groups.set(gk, {
        // The answer key's own address is the subject: the deals around it
        // are what we know, so it is the market's best-covered point.
        address: d.address,
        type: type,
        months: months,
        deals: 1,
      });
    }
  }
  return Array.from(groups.values()).map((g) => ({
    address: g.address,
    type: g.type,
    // Round the window out to the lookbacks a person would actually pick,
    // and never ask for less than a year.
    months: [12, 24, 36, 60, 120].find((m) => m >= g.months) || 120,
    maxComps: maxComps,
    knownDeals: g.deals,
  }));
}

module.exports = {
  checkComp,
  checkComps,
  scoreTruth,
  scoreAccuracy,
  summarizeAccuracy,
  compareAccuracy,
  validateDeal,
  validateTruthSet,
  targetsFromTruthSet,
  expectedDeals,
  sameBuilding,
  FINDING_KEYS,
  TRUTH_BASES,
  REFUSED_BASES,
  BASES_REQUIRING_URL,
  PSF_TOLERANCE,
  ALT_BASIS_TOLERANCE,
  PRICE_TOLERANCE,
  SIZE_TOLERANCE,
  DATE_TOLERANCE_DAYS,
  SANE_PSF_MIN,
  SANE_PSF_MAX,
  MIN_SALE_PRICE,
};
