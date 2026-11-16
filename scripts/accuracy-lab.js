#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The accuracy lab: does a change to the valuation math make it more right?
//
//   node scripts/accuracy-lab.js comp-corpus.csv            # the standard set
//   node scripts/accuracy-lab.js a.csv b.jsonl --only size  # variants by name
//   node scripts/accuracy-lab.js corpus.csv --facts         # what the data says
//
// backtest.js is the instrument /admin reads: hold each known sale out, value
// it from its peers with the production math, measure the miss. This is the
// bench that instrument was built for. It scores CANDIDATE versions of the math
// over the same subjects and the same peers, and prints each one against
// today's, pair for pair, so "is a 1.5-year half-life better than 2?" has an
// answer that is a number.
//
// Feed it the corpus export (/admin -> Downloads -> Comp corpus), a
// comp-corpus.jsonl, or several of either. Nothing here is on any request
// path, nothing is written, and nothing leaves the machine.
//
// THREE RULES FOR READING IT
//
//   1. A variant has to beat the NOISE, not just the baseline. Subjects in one
//      market share peers, so they are not independent draws; the interval
//      printed beside each change resamples whole MARKETS (a cluster
//      bootstrap). An interval that straddles zero is a coin flip.
//   2. It measures the math, not the comp-finding, exactly like the card on
//      /admin: comps already in the corpus, valued untrended unless a variant
//      supplies a trend.
//   3. Every variant either wraps the production composition or patches its
//      SOURCE TEXT. Nothing is reimplemented, and a patch that matches nothing
//      throws: a refactor of valuation.js must not let an experiment quietly
//      score the baseline under a new name.
// ---------------------------------------------------------------------------

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BACKTEST = require(path.join(ROOT, "backtest.js"));
const VALUATION = require(path.join(ROOT, "valuation.js"));
const BLEND = require(path.join(ROOT, "blend-corpus.js"));
const { parseDealDate } = require(path.join(ROOT, "deal-date.js"));

// ---- reading rows ---------------------------------------------------------

// RFC-4180 enough for our own export: quoted fields, doubled quotes, and line
// breaks inside quotes (a comp's notes can hold one).
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => { o[h] = r[i] == null ? "" : r[i]; });
    return o;
  });
}

function readRows(file) {
  const text = fs.readFileSync(file, "utf8");
  if (/\.jsonl?$/i.test(file)) {
    return text.split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean);
  }
  return parseCsv(text);
}

// Two files can hold the same harvest. Same identity the corpus dedupes on.
function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const k = [r.address, r.deal_date, r.price_or_rate].map((x) => String(x || "").toLowerCase().trim()).join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---- a patched copy of the production math --------------------------------

const VALUATION_SRC = fs.readFileSync(path.join(ROOT, "valuation.js"), "utf8");

function patchedValuation(patches) {
  let src = VALUATION_SRC;
  (patches || []).forEach(([from, to]) => {
    const parts = src.split(from);
    if (parts.length !== 2) {
      throw new Error("patch must match valuation.js exactly once (" + (parts.length - 1) + " matches): " + from);
    }
    src = parts.join(to);
  });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("module", "self", src)(mod, undefined);
  return mod.exports;
}

// The lines a variant may rewrite. Named once so a variant reads as intent.
const SRC = {
  recency: "if (age !== null) w *= Math.pow(0.5, age / 2);",
  size: "if (octaves > 1) w *= Math.pow(0.5, octaves - 1);",
  band: "if (n >= 4) return { low: q(BAND_LOW_PCT), mid: q(0.5), high: q(BAND_HIGH_PCT), trimmed: true };",
  thin: "return { low: items[0].v, mid: q(0.5), high: items[n - 1].v, trimmed: false };",
  floor: "return Math.max(0.15, w);",
  tiers: "listing: 0.85, news: 0.7, estimate: 0.5",
  elasticity: "var SIZE_ELASTICITY = { Industrial: -0.2, Office: -0.2, Retail: -0.2 };",
};

// ---- the leaves variants are built from -----------------------------------

const num = VALUATION.numericValue;

// Restate a comp's $/SF at the SUBJECT's size: big buildings trade at lower
// $/SF, so a comp twice the subject's size understates it. `beta` is the size
// elasticity of $/SF (negative). The ratio is clamped so one absurd size
// cannot become an absurd price.
function sizeAdjusted(beta) {
  return (comps, opts, ctx) => {
    const subjSF = Number(opts.subjectSF);
    return comps.map((c, i) => {
      const sf = num(c.size_sqft), psf = ctx.peers[i].psf;
      if (!(sf > 0) || !(subjSF > 0) || !(psf > 0)) return c;
      const ratio = Math.min(8, Math.max(1 / 8, subjSF / sf));
      const b = typeof beta === "function" ? beta(ctx.subject.row.property_type) : beta;
      return Object.assign({}, c, { price_per_sqft: String(psf * Math.pow(ratio, b)) });
    });
  };
}

// A market trend read off the peers themselves: the slope of ln($/SF) on the
// deal date, ridge-shrunk toward flat (`lambda`, in years squared: with few
// comps or a short span the slope is mostly noise and should stay near zero),
// then bounded. Returns percent per year, or null.
function peerTrendPct(peers, lambda, capPct) {
  const pts = peers.filter((p) => p.psf > 0 && Number.isFinite(p.dy));
  if (pts.length < 4) return null;
  const mx = pts.reduce((s, p) => s + p.dy, 0) / pts.length;
  const my = pts.reduce((s, p) => s + Math.log(p.psf), 0) / pts.length;
  let sxx = 0, sxy = 0;
  pts.forEach((p) => { sxx += (p.dy - mx) * (p.dy - mx); sxy += (p.dy - mx) * (Math.log(p.psf) - my); });
  if (!(sxx > 0)) return null;
  const slope = sxy / (sxx + lambda);
  const pct = (Math.exp(slope) - 1) * 100;
  const cap = capPct || 15;
  const bounded = Math.max(-cap, Math.min(cap, pct));
  return Math.abs(bounded) < 0.05 ? null : bounded;
}

// The same restatement, with the elasticity read off THIS comp set: the slope
// of ln($/SF) on ln(size) across the peers, ridge-shrunk toward a prior
// (`beta0`; `lambda` is how many "units of size spread" the prior is worth)
// and bounded, so three comps cannot invent a steep curve.
function sizeAdjustedLocal(beta0, lambda, lo, hi) {
  return (comps, opts, ctx) => {
    const pts = ctx.peers.map((p) => ({ x: Math.log(num(p.row.size_sqft)), y: Math.log(p.psf) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    let b = beta0;
    if (pts.length >= 3) {
      const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      let sxx = 0, sxy = 0;
      pts.forEach((p) => { sxx += (p.x - mx) * (p.x - mx); sxy += (p.x - mx) * (p.y - my); });
      b = (sxy + lambda * beta0) / (sxx + lambda);
    }
    b = Math.max(lo == null ? -0.6 : lo, Math.min(hi == null ? 0 : hi, b));
    return sizeAdjusted(b)(comps, opts, ctx);
  };
}

// Take the vintage factor back OUT: the backtest hands it the subject's year
// built and each comp's, as the live report does, so "is vintage weighting
// earning its keep?" is asked by removing it.
function withoutVintage(comps, opts) {
  return {
    comps: comps.map((c) => Object.assign({}, c, { year_built: "" })),
    opts: Object.assign({}, opts, { subjectYear: null }),
  };
}

// ---- variants -------------------------------------------------------------
// { name, group, patches?, both?(comps, opts, ctx), comps?(comps, opts, ctx), opts?(opts, ctx) }

const VARIANTS = [];
const add = (v) => VARIANTS.push(v);
const elasticityMap = (o) => "var SIZE_ELASTICITY = " + JSON.stringify(o).replace(/"/g, "").replace(/:/g, ": ").replace(/,/g, ", ").replace("{", "{ ").replace("}", " }") + ";";
const CRE = ["Industrial", "Office", "Retail"];
const creAt = (b) => CRE.reduce((o, t) => Object.assign(o, { [t]: b }), {});

add({ name: "size restatement OFF (as before 2026-11-15)", group: "restate", patches: [[SRC.elasticity, "var SIZE_ELASTICITY = {};"]] });
[-0.1, -0.15, -0.25, -0.3, -0.4].forEach((b) => add({
  name: "size restatement at " + b + " (now -0.2)", group: "restate",
  patches: [[SRC.elasticity, elasticityMap(creAt(b))]],
}));
[-0.1, -0.2].forEach((b) => add({
  name: "restate houses too, at " + b, group: "restate-houses",
  patches: [[SRC.elasticity, elasticityMap(Object.assign(creAt(-0.2), { Residential: b }))]],
}));
[[-0.2, 5], [-0.2, 15]].forEach(([b0, lam]) => add({
  name: "restate with the slope read off the comps (prior " + b0 + ", shrink " + lam + ")", group: "restate-local",
  patches: [[SRC.elasticity, "var SIZE_ELASTICITY = {};"]],
  comps: (comps, opts, ctx) => (CRE.includes(ctx.subject.row.property_type) ? sizeAdjustedLocal(b0, lam)(comps, opts, ctx) : comps),
}));

[1, 1.5, 3, 4].forEach((h) => add({
  name: "recency half-life " + h + "y (now 2y)", group: "recency",
  patches: [[SRC.recency, "if (age !== null) w *= Math.pow(0.5, age / " + h + ");"]],
}));
add({ name: "no recency weighting", group: "recency", patches: [[SRC.recency, ""]] });

add({ name: "size: penalty from 1.5x (now 2x)", group: "size",
  patches: [[SRC.size, "if (octaves > 0.585) w *= Math.pow(0.5, octaves - 0.585);"]] });
add({ name: "size: penalty from 1x, smooth", group: "size",
  patches: [[SRC.size, "w *= Math.pow(0.5, octaves);"]] });
add({ name: "size: twice as steep past 2x", group: "size",
  patches: [[SRC.size, "if (octaves > 1) w *= Math.pow(0.5, 2 * (octaves - 1));"]] });
add({ name: "size: no penalty", group: "size", patches: [[SRC.size, ""]] });

[[2, 15], [5, 15], [10, 15], [5, 8]].forEach(([lam, cap]) => add({
  name: "trend from the comps (shrink " + lam + ", cap " + cap + "%)", group: "trend",
  opts: (opts, ctx) => Object.assign({}, opts, { trendPct: peerTrendPct(ctx.peers, lam, cap) }),
}));

add({ name: "vintage weighting OFF (year built)", group: "vintage", both: withoutVintage });

[[0.25, 0.75], [0.2, 0.8], [0.1, 0.9]].forEach(([lo, hi]) => add({
  name: "band " + lo * 100 + "th-" + hi * 100 + "th pct (now 15-85)", group: "band",
  patches: [[SRC.band, "if (n >= 4) return { low: q(" + lo + "), mid: q(0.5), high: q(" + hi + "), trimmed: true };"]],
}));

const MID = {
  "geometric mean": "Math.exp(items.reduce((s, x) => s + x.w * Math.log(x.v), 0) / total)",
  "trimean (Q1 + 2 x median + Q3) / 4": "(q(0.25) + 2 * q(0.5) + q(0.75)) / 4",
  "mean of the 30th-70th pct": "(q(0.3) + q(0.4) + q(0.5) + q(0.6) + q(0.7)) / 5",
};
Object.keys(MID).forEach((k) => add({
  name: "likely = " + k + " (now the median)", group: "mid",
  patches: [
    [SRC.band, "if (n >= 4) return { low: q(BAND_LOW_PCT), mid: " + MID[k] + ", high: q(BAND_HIGH_PCT), trimmed: true };"],
    [SRC.thin, "return { low: items[0].v, mid: " + MID[k] + ", high: items[n - 1].v, trimmed: false };"],
  ],
}));

add({ name: "listing weight 0.6 (now 0.85)", group: "tier",
  patches: [[SRC.tiers, "listing: 0.6, news: 0.7, estimate: 0.5"]] });
add({ name: "listing weight 1.0 (now 0.85)", group: "tier",
  patches: [[SRC.tiers, "listing: 1, news: 0.7, estimate: 0.5"]] });
add({ name: "weight floor 0.05 (now 0.15)", group: "floor",
  patches: [[SRC.floor, "return Math.max(0.05, w);"]] });

// One building, harvested several times (a re-dated listing, a re-spelled
// street), entering the math once per copy. The backtest collapses copies
// before valuing; the radius blend does not (it dedupes on the exact
// address|date|price string, and a re-dated copy differs in the date). On the
// 2026-11-15 corpus counting every copy scored no worse, if anything a point
// better inside the noise: a building several searches found is likely a real,
// well-documented one. So collapsing copies in the blend is NOT an accuracy
// fix, and this line is here to say so before someone ships it as one.
add({ name: "every harvested copy counted (as the radius blend does)", group: "copies",
  comps: (comps, opts, ctx) => ctx.everyCopy.map((p) => p.comp) });

// Manufactured homes and houses kept to their own kind, with the radius
// blend's own test (blend-corpus.js isManufacturedHome; adopted there
// 2026-11-16). The backtest pools a whole market, so here the rule filters
// the peers; when fewer than three of the subject's kind remain it leaves them
// all, standing in for the live report, whose own comps stay whatever the
// blend skips. A row the test cannot read as manufactured counts as a house.
add({ name: "manufactured homes and houses kept apart (the radius blend since 2026-11-16)", group: "kind",
  comps: (comps, opts, ctx) => {
    if (ctx.subject.row.property_type !== "Residential") return comps;
    const mine = BLEND.isManufacturedHome(ctx.subject.row);
    const keep = comps.filter((c, i) => BLEND.isManufacturedHome(ctx.peers[i].row) === mine);
    return keep.length >= 3 ? keep : comps;
  } });


function valueFnFor(variant) {
  const V = variant.patches ? patchedValuation(variant.patches) : VALUATION;
  return (comps, opts, ctx) => {
    let c = comps, o = opts;
    if (variant.both) { const r = variant.both(c, o, ctx); c = r.comps; o = r.opts; }
    if (variant.comps) c = variant.comps(c, o, ctx);
    if (variant.opts) o = variant.opts(o, ctx);
    return V.valueFromComps(c, o);
  };
}

// ---- statistics -----------------------------------------------------------

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : null);

function summarize(subjects) {
  const abs = subjects.map((s) => s.absError);
  return {
    n: subjects.length,
    medianAbsError: median(abs),
    // A handful of 400% misses would own a plain mean; cap each at 100%.
    meanAbsError: mean(abs.map((a) => Math.min(a, 1))),
    within10: share(abs, (a) => a <= 0.10),
    within20: share(abs, (a) => a <= 0.20),
    bias: median(subjects.map((s) => s.signedError)),
    bandCoverage: share(subjects, (s) => s.inBand),
    medianBandWidth: median(subjects.map((s) => s.bandWidth)),
  };
}

// Deterministic, so two runs over one file print the same interval.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Change in median absolute error, variant minus baseline, with a 90% interval
// from resampling whole markets. `pairs` is [{ market, base, cand }].
function pairedChange(pairs, draws) {
  const byMarket = new Map();
  pairs.forEach((p) => {
    if (!byMarket.has(p.market)) byMarket.set(p.market, []);
    byMarket.get(p.market).push(p);
  });
  const markets = Array.from(byMarket.values());
  const stat = (ps) => median(ps.map((p) => p.cand)) - median(ps.map((p) => p.base));
  const rand = mulberry32(20261115);
  const out = [];
  for (let d = 0; d < (draws || 1000); d++) {
    const sample = [];
    for (let i = 0; i < markets.length; i++) {
      const m = markets[Math.floor(rand() * markets.length)];
      for (let j = 0; j < m.length; j++) sample.push(m[j]);
    }
    out.push(stat(sample));
  }
  out.sort((a, b) => a - b);
  return {
    change: stat(pairs),
    lo: out[Math.floor(out.length * 0.05)],
    hi: out[Math.floor(out.length * 0.95)],
    winRate: share(pairs.filter((p) => p.cand !== p.base), (p) => p.cand < p.base),
    moved: pairs.filter((p) => p.cand !== p.base).length,
    markets: markets.length,
  };
}

function compare(baseSubjects, candSubjects) {
  const idOf = (s) => s.market + "|" + s.type + "|" + s.key;
  const base = new Map(baseSubjects.map((s) => [idOf(s), s]));
  const pairs = [];
  candSubjects.forEach((s) => {
    const b = base.get(idOf(s));
    if (b) pairs.push({ market: s.market, type: s.type, base: b.absError, cand: s.absError });
  });
  return pairs;
}

// ---- what the data itself says --------------------------------------------
// Pooled within-bucket slopes: each market+type bucket is demeaned first, so
// "Dallas is pricier than Boise" cannot pass for a size or a time effect.

function facts(rows) {
  const pool = [];
  rows.forEach((r) => {
    if (String(r.transaction || "").toLowerCase().startsWith("lease")) return;
    const dy = parseDealDate(r.deal_date);
    const sf = num(r.size_sqft);
    const psf = VALUATION.salePsfOf(r);
    if (dy == null || !(sf > 0) || !(psf > 0)) return;
    pool.push({ k: r.market + "|" + r.property_type, type: r.property_type, dy, lsf: Math.log(sf), lpsf: Math.log(psf) });
  });
  const byType = new Map();
  pool.forEach((p) => { if (!byType.has(p.type)) byType.set(p.type, []); byType.get(p.type).push(p); });
  const out = [];
  byType.forEach((ps, type) => {
    const buckets = new Map();
    ps.forEach((p) => { if (!buckets.has(p.k)) buckets.set(p.k, []); buckets.get(p.k).push(p); });
    let sxx = 0, sxy = 0, txx = 0, txy = 0, n = 0, resid = [];
    buckets.forEach((b) => {
      if (b.length < 4) return;
      const ms = mean(b.map((p) => p.lsf)), mp = mean(b.map((p) => p.lpsf)), mt = mean(b.map((p) => p.dy));
      b.forEach((p) => {
        sxx += (p.lsf - ms) * (p.lsf - ms); sxy += (p.lsf - ms) * (p.lpsf - mp);
        txx += (p.dy - mt) * (p.dy - mt); txy += (p.dy - mt) * (p.lpsf - mp);
        resid.push(Math.abs(p.lpsf - mp));
        n++;
      });
    });
    out.push({
      type, rows: ps.length, inBuckets: n,
      sizeElasticity: sxx > 0 ? sxy / sxx : null,
      trendPctPerYear: txx > 0 ? (Math.exp(txy / txx) - 1) * 100 : null,
      // Median distance of a comp from its own bucket's geometric mean: the
      // floor no reweighting can get under without new information.
      spread: resid.length ? Math.exp(median(resid)) - 1 : null,
    });
  });
  return out.sort((a, b) => b.rows - a.rows);
}

// ---- printing -------------------------------------------------------------

const pct = (v, d) => (v == null ? "  -  " : (v * 100).toFixed(d == null ? 1 : d) + "%");
const signed = (v) => (v == null ? "-" : (v > 0 ? "+" : "") + (v * 100).toFixed(1));
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

function printSummary(label, s) {
  console.log(pad(label, 44) + lpad(s.n, 5) + lpad(pct(s.medianAbsError), 9) + lpad(pct(s.meanAbsError), 9)
    + lpad(pct(s.within10, 0), 7) + lpad(pct(s.within20, 0), 7) + lpad(signed(s.bias), 8)
    + lpad(pct(s.bandCoverage, 0), 7) + lpad(pct(s.medianBandWidth, 0), 7));
}

function main(argv) {
  const files = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") flags.only = argv[++i];
    else if (a === "--min-peers") flags.minPeers = Number(argv[++i]);
    else if (a === "--facts") flags.facts = true;
    else if (a === "--by-type") flags.byType = true;
    else if (a === "--json") flags.json = argv[++i];
    else files.push(a);
  }
  if (!files.length) {
    console.error("usage: node scripts/accuracy-lab.js <corpus.csv|.jsonl> [...] [--only <text>] [--min-peers N] [--by-type] [--facts] [--json out.json]");
    process.exit(2);
  }
  const rows = dedupeRows(files.reduce((all, f) => all.concat(readRows(f)), []));
  const scoreWith = (valueFn) => BACKTEST.score(rows, {
    parseDealDate, minSubjects: 0, detail: true, valueFn,
    ...(flags.minPeers ? { minPeers: flags.minPeers } : {}),
  });

  const base = scoreWith(null);
  console.log(rows.length + " rows read; " + base.scored + " sales scored across "
    + new Set(base.subjects.map((s) => s.market)).size + " markets. Skipped: " + JSON.stringify(base.skipped));
  if (base.scored < 20) console.log("!! Under 20 scored sales: everything below is noise. Do not tune against it.");

  if (flags.facts) {
    console.log("\nWhat the data says (within-bucket, sales only):");
    console.log(pad("type", 14) + lpad("rows", 6) + lpad("used", 6) + lpad("size elast.", 13) + lpad("trend/yr", 10) + lpad("spread", 9));
    facts(rows).forEach((f) => console.log(pad(f.type, 14) + lpad(f.rows, 6) + lpad(f.inBuckets, 6)
      + lpad(f.sizeElasticity == null ? "-" : f.sizeElasticity.toFixed(3), 13)
      + lpad(f.trendPctPerYear == null ? "-" : f.trendPctPerYear.toFixed(1) + "%", 10)
      + lpad(pct(f.spread, 0), 9)));
  }

  console.log("\n" + pad("", 44) + lpad("n", 5) + lpad("med err", 9) + lpad("mean err", 9)
    + lpad("<=10%", 7) + lpad("<=20%", 7) + lpad("bias", 8) + lpad("band", 7) + lpad("width", 7));
  printSummary("TODAY (production math)", summarize(base.subjects));
  const types = Array.from(new Set(base.subjects.map((s) => s.type))).sort();
  types.forEach((t) => printSummary("  " + t, summarize(base.subjects.filter((s) => s.type === t))));

  const chosen = VARIANTS.filter((v) => !flags.only
    || (v.name + " " + v.group).toLowerCase().includes(String(flags.only).toLowerCase()));
  const report = { rows: rows.length, base: summarize(base.subjects), variants: [] };
  let group = null;
  console.log("\nCandidates. Change is in median error, in points; negative is better.");
  chosen.forEach((v) => {
    if (v.group !== group) { group = v.group; console.log(""); }
    const cand = scoreWith(valueFnFor(v));
    const pairs = compare(base.subjects, cand.subjects);
    const ch = pairedChange(pairs);
    const s = summarize(cand.subjects);
    printSummary(v.name, s);
    console.log(pad("", 6) + "change " + signed(ch.change) + " pts  [90%: " + signed(ch.lo) + " to " + signed(ch.hi) + "]"
      + "  better on " + pct(ch.winRate, 0) + " of the " + ch.moved + " it moved"
      + (ch.hi < 0 ? "   <-- clears the noise" : ch.lo > 0 ? "   <-- worse" : ""));
    if (flags.byType) {
      types.forEach((t) => {
        const tp = pairs.filter((p) => p.type === t);
        if (tp.length >= 8) {
          const c = pairedChange(tp, 400);
          console.log(pad("", 8) + pad(t, 14) + lpad(tp.length, 4) + "  " + signed(c.change) + "  [" + signed(c.lo) + " to " + signed(c.hi) + "]");
        }
      });
    }
    report.variants.push({ name: v.name, group: v.group, summary: s, change: ch });
  });
  if (flags.json) fs.writeFileSync(flags.json, JSON.stringify(report, null, 2));
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  parseCsv, dedupeRows, patchedValuation, sizeAdjusted, sizeAdjustedLocal, peerTrendPct, summarize, pairedChange, compare, facts,
  VARIANTS, SRC,
};
