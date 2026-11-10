#!/usr/bin/env node
// How far the valuation math lands from a known sale price, measured offline,
// and whether a change to that math made it better or worse.
//
// WHY THIS EXISTS. /api/accuracy (backtest.js) scores the math over the
// production corpus, which needs the database, and it reports one number for
// the code that is deployed. Neither helps while a change to valuation.js is
// still on a branch: there was no way to ask "is this better than what is
// live" without shipping it and reading the admin card afterwards. This is
// that question as one command, on data that is checked in.
//
//   node scripts/accuracy-bench.js                      the current math, scored
//   node scripts/accuracy-bench.js --before             vs origin/main's valuation.js
//   node scripts/accuracy-bench.js --before HEAD~1      vs any other ref
//   node scripts/accuracy-bench.js --corpus corpus.csv  on a corpus export instead
//   node scripts/accuracy-bench.js --json               the same, machine-readable
//
// WHAT IT DOES. A hold-one-out: for each market in the data it takes one
// closed, sourced sale out, values it from the market's other sale comps with
// valuation.js's real valueFromComps (the held-out sale's own size and year
// built standing in for the subject's), and compares the Likely $/SF with what
// the building actually sold for. Zero cost: no server, no search, no
// database, no clock (each market is scored as of the day its comps were
// gathered, so the answer is the same tomorrow).
//
// THE DATA. By default market-seed.json: about 250 real sale comps across 40
// city-and-type markets, each set written by one real search. --corpus takes
// the file GET /api/comp-corpus downloads (ADMIN_KEY), which is every comp
// production has harvested and is the larger, better sample.
//
// HOW TO READ IT, and four limits that belong next to the numbers:
//   * It measures the MATH, never the comp-finding. The comps are given.
//     Whether a search finds good comps is run-eval.js's question.
//   * The seed's comps are CITYWIDE, gathered for a market page with no
//     subject, so a downtown tower and a suburban flex building share a set.
//     A real report's comps are chosen for one building and sit far closer
//     together. The absolute error here therefore overstates a report's; the
//     number to read is the CHANGE between two versions of the math on the
//     same comps.
//   * It runs untrended (trendPct null), like backtest.js: the trend a market
//     page stores is the model's own estimate, and indexing the peers with it
//     while scoring against an un-indexed sale would grade the trend, not the
//     math.
//   * A few hundred subjects is a small sample. --before therefore reports an
//     interval, from resampling whole MARKETS (the comps inside one market
//     are not independent of each other), and a change whose interval
//     straddles zero has not been shown to do anything.
//
// Pure helpers are exported and tested in test/accuracy-bench.test.js;
// requiring this file starts nothing.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.join(__dirname, "..");
const { parseDealDate } = require("../deal-date.js");
const BACKTEST = require("../backtest.js");

const DEFAULT_REF = "origin/main";
const MIN_PEERS = 3;
const BOOTSTRAP_ITERS = 4000;

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function isLease(c) {
  return String((c && c.transaction) || "").toLowerCase().startsWith("lease");
}

// ---------------------------------------------------------------------------
// Datasets. Both sources become the same shape:
//   [{ key, type, asOf (ms), comps: [report-shaped comp] }]
// ---------------------------------------------------------------------------

// market-seed.json: { "<slug>": { type, city, state, generatedAt, comps } }.
function datasetFromSeed(seed) {
  return Object.keys(seed || {}).map((key) => {
    const m = seed[key] || {};
    return { key, type: m.type, asOf: Date.parse(m.generatedAt), comps: Array.isArray(m.comps) ? m.comps : [] };
  }).filter((m) => m.type && Number.isFinite(m.asOf));
}

// Corpus rows (the CSV /api/comp-corpus downloads, or comp-corpus.jsonl),
// bucketed by market + type the way corpusRowsForMarket reads them. A corpus
// row calls its date `deal_date`; a report comp calls it `date`. Each bucket
// is scored as of its newest harvest.
function datasetFromCorpusRows(rows) {
  const buckets = new Map();
  (rows || []).forEach((r) => {
    if (!r || !r.market || !r.property_type) return;
    const key = r.property_type + "|" + r.market;
    if (!buckets.has(key)) buckets.set(key, { key, type: r.property_type, asOf: 0, comps: [] });
    const b = buckets.get(key);
    const ts = Date.parse(r.ts);
    if (Number.isFinite(ts) && ts > b.asOf) b.asOf = ts;
    b.comps.push(Object.assign({}, r, { date: r.deal_date }));
  });
  return Array.from(buckets.values()).filter((b) => b.asOf > 0);
}

// ---------------------------------------------------------------------------
// The hold-one-out.
//
// A subject is a sale that can stand in as an answer key: closed (an asking
// price is not an outcome, and parseDealDate refuses "Active" / "Listed Mar
// 2025" exactly as the corpus readers rely on), priced, sized, and not an
// `estimate` (a figure the model could not tie to a source). Its peers are
// every other priced, sized sale comp in the market, listings and estimates
// included, because that is what a report's valuation is handed.
//
// The same building harvested or listed twice is neither two subjects nor its
// own peer: backtest.js's isSameProperty (street-line key, or an exact
// size-and-price match) decides, and that module's header has the incident
// that made it necessary.
//
// `opts.adjust === false` scores the same comps with no property type named,
// which is valuation.js's own switch for "no size or age adjustment". In
// THIS harness that isolates the adjustment exactly: the only other things a
// type changes are the distance curve and the Residential price tier, and no
// comp here carries a distance or a subject asking price.
// ---------------------------------------------------------------------------
function holdOneOut(V, dataset, opts) {
  const o = opts || {};
  const minPeers = o.minPeers == null ? MIN_PEERS : o.minPeers;
  const out = [];
  (dataset || []).forEach((m) => {
    const sales = m.comps
      .map((c, index) => ({ comp: c, row: c, index, key: BACKTEST.normAddress(c && c.address) }))
      .filter((x) => x.comp && !isLease(x.comp) && V.salePsfOf(x.comp) > 0 && V.numericValue(x.comp.size_sqft) > 0);
    const scored = [];
    sales.forEach((subj) => {
      if (parseDealDate(subj.comp.date) == null) return;
      if (V.tierOf(subj.comp) === "estimate" || V.tierOf(subj.comp) == null) return;
      if (scored.some((s) => BACKTEST.isSameProperty(s, subj))) return;
      const peers = sales.filter((p) => p !== subj && !BACKTEST.isSameProperty(subj, p));
      if (peers.length < minPeers) return;
      const v = V.valueFromComps(peers.map((p) => p.comp), {
        subjectSF: V.numericValue(subj.comp.size_sqft),
        asOf: m.asOf,
        trendPct: null,
        subjectYear: subj.comp.year_built,
        propertyType: o.adjust === false ? undefined : m.type,
      });
      if (!v || !(v.psfMid > 0)) return;
      const truth = V.salePsfOf(subj.comp);
      scored.push(subj);
      out.push({
        market: m.key,
        // Which comp of its market this subject is, so two runs over one
        // dataset can be paired subject for subject.
        subject: m.key + "#" + subj.index,
        type: m.type,
        truth,
        predicted: v.psfMid,
        absError: Math.abs(v.psfMid - truth) / truth,
        // Symmetric: 2x too high and 2x too low are the same size of miss,
        // which a percentage error is not (+100% against -50%).
        logError: Math.abs(Math.log(v.psfMid / truth)),
        inBand: truth >= v.psfLow && truth <= v.psfHigh,
        bandWidth: (v.psfHigh - v.psfLow) / v.psfMid,
      });
    });
  });
  return out;
}

function summarize(results) {
  const rs = results || [];
  const share = (f) => (rs.length ? rs.filter(f).length / rs.length : null);
  return {
    scored: rs.length,
    markets: new Set(rs.map((r) => r.market)).size,
    medianAbsError: median(rs.map((r) => r.absError)),
    meanLogError: mean(rs.map((r) => r.logError)),
    within10: share((r) => r.absError <= 0.10),
    within20: share((r) => r.absError <= 0.20),
    bandCoverage: share((r) => r.inBand),
    medianBandWidth: median(rs.map((r) => r.bandWidth)),
  };
}

function byType(results) {
  const types = Array.from(new Set((results || []).map((r) => r.type))).sort();
  return types.map((t) => Object.assign({ type: t }, summarize(results.filter((r) => r.type === t))));
}

// ---------------------------------------------------------------------------
// Is `after` better than `before`, or is that the luck of which markets are in
// the file? A paired bootstrap over MARKETS: draw markets with replacement,
// score both versions on the same draw, keep the relative change. The
// generator is seeded, so the same inputs print the same interval.
//
// The two lists are paired subject for subject (`subject` is the comp's own
// position in its market), and `pairUp` drops any subject only one version
// scored, so a version that refuses a comp cannot win by skipping it.
// ---------------------------------------------------------------------------
function pairUp(before, after) {
  const have = new Map(after.map((r) => [r.subject, r]));
  const b = [], a = [];
  before.forEach((r) => {
    const mate = have.get(r.subject);
    if (mate) { b.push(r); a.push(mate); }
  });
  return { before: b, after: a };
}

function pairedBootstrap(before, after, stat, iters) {
  const groups = new Map();
  before.forEach((r, i) => {
    if (!groups.has(r.market)) groups.set(r.market, []);
    groups.get(r.market).push(i);
  });
  const markets = Array.from(groups.keys());
  if (!markets.length) return null;
  let state = 12345;
  const rnd = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  const deltas = [];
  for (let it = 0; it < (iters || BOOTSTRAP_ITERS); it++) {
    const idx = [];
    for (let k = 0; k < markets.length; k++) {
      const pick = groups.get(markets[Math.floor(rnd() * markets.length)]);
      for (let j = 0; j < pick.length; j++) idx.push(pick[j]);
    }
    const b = stat(idx.map((i) => before[i])), a = stat(idx.map((i) => after[i]));
    if (b > 0) deltas.push((a - b) / b);
  }
  deltas.sort((x, y) => x - y);
  const at = (p) => deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * p))];
  return { low: at(0.025), mid: at(0.5), high: at(0.975), shareBetter: deltas.filter((d) => d < 0).length / deltas.length };
}

function compare(before, after, iters) {
  const p = pairUp(before, after);
  const sb = summarize(p.before), sa = summarize(p.after);
  const rel = (x, y) => (x > 0 ? (y - x) / x : null);
  return {
    before: sb,
    after: sa,
    medianAbsErrorChange: rel(sb.medianAbsError, sa.medianAbsError),
    meanLogErrorChange: rel(sb.meanLogError, sa.meanLogError),
    meanLogErrorInterval: pairedBootstrap(p.before, p.after, (rs) => mean(rs.map((r) => r.logError)), iters),
    medianAbsErrorInterval: pairedBootstrap(p.before, p.after, (rs) => median(rs.map((r) => r.absError)), iters),
    byType: byType(p.before).map((b) => {
      const a = summarize(p.after.filter((r) => r.type === b.type));
      return { type: b.type, scored: b.scored, before: b.medianAbsError, after: a.medianAbsError,
        beforeLog: b.meanLogError, afterLog: a.meanLogError };
    }),
  };
}

// ---------------------------------------------------------------------------
// What the data itself says size and building age are worth: a regression of
// ln($/SF) on ln(building SF) and year built, WITHIN each market (every
// figure is taken as a difference from its own market's mean, so a pricey
// city and a cheap one cannot masquerade as a size effect). `size` is an
// elasticity (-0.15 means 1% more building, 0.15% less per SF); `yearBuilt`
// is the log change per year newer (0.01 is about 1% a year). `t` is the
// coefficient over its standard error; past about 2 it is not noise.
//
// This is where valuation.js's SIZE_ELASTICITY and VINTAGE_LOG_PER_YEAR came
// from, and it is here so they can be re-checked against a bigger corpus
// rather than taken on trust.
// ---------------------------------------------------------------------------
function elasticities(V, dataset) {
  let sxx = 0, sxz = 0, szz = 0, sxy = 0, szy = 0, syy = 0, n = 0, groups = 0;
  (dataset || []).forEach((m) => {
    const rows = [];
    m.comps.forEach((c) => {
      if (!c || isLease(c)) return;
      const psf = V.salePsfOf(c), sf = V.numericValue(c.size_sqft), yb = V.yearOf(c.year_built);
      if (!(psf > 0) || !(sf > 0) || yb == null) return;
      rows.push({ y: Math.log(psf), x: Math.log(sf), z: yb });
    });
    if (rows.length < 2) return;
    groups += 1;
    const mu = (f) => rows.reduce((a, r) => a + r[f], 0) / rows.length;
    const my = mu("y"), mx = mu("x"), mz = mu("z");
    rows.forEach((r) => {
      const y = r.y - my, x = r.x - mx, z = r.z - mz;
      sxx += x * x; sxz += x * z; szz += z * z; sxy += x * y; szy += z * y; syy += y * y; n += 1;
    });
  });
  const det = sxx * szz - sxz * sxz;
  // Two coefficients plus one mean per market are spent before any residual.
  const dof = n - groups - 2;
  if (!(det > 0) || dof <= 0) return null;
  const size = (sxy * szz - szy * sxz) / det;
  const yearBuilt = (szy * sxx - sxy * sxz) / det;
  const sse = syy - size * sxy - yearBuilt * szy;
  const s2 = sse / dof;
  return {
    comps: n, markets: groups,
    size, sizeT: size / Math.sqrt(s2 * szz / det),
    yearBuilt, yearBuiltT: yearBuilt / Math.sqrt(s2 * sxx / det),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

// A minimal CSV reader for the corpus export: quoted fields, doubled quotes,
// commas and newlines inside quotes. broker-vault.js's parseCsv also treats a
// leading "#" as a note line, which a corpus address ("#4 Industrial Way")
// must not be.
function parseCsvRows(text) {
  const out = [];
  let row = [], field = "", quoted = false;
  const src = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) out.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) out.push(row);
  if (!out.length) return [];
  const head = out[0].map((h) => h.trim());
  return out.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? "" : r[i]])));
}

function readCorpusFile(file) {
  const text = fs.readFileSync(file, "utf8");
  if (/\.jsonl$/i.test(file)) {
    return text.split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  }
  return parseCsvRows(text);
}

// valuation.js as it stood at a git ref, loaded from a temp file. `git show`
// rather than a worktree: one pure file is all a comparison needs.
function valuationAtRef(ref) {
  const r = spawnSync("git", ["show", ref + ":valuation.js"], { cwd: REPO, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("Could not read valuation.js at " + ref + ": " + String(r.stderr || "").trim());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cn-bench-"));
  const file = path.join(dir, "valuation.js");
  fs.writeFileSync(file, r.stdout);
  try { return require(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function parseArgs(argv) {
  const a = { before: null, corpus: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") a.json = true;
    else if (t === "--help" || t === "-h") a.help = true;
    else if (t === "--corpus") a.corpus = argv[++i] || "";
    else if (t === "--before") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { a.before = next; i++; } else a.before = DEFAULT_REF;
    } else throw new Error("Unknown argument: " + t);
  }
  if (a.corpus === "") throw new Error("--corpus needs a file (the CSV from GET /api/comp-corpus)");
  return a;
}

const pct = (x) => (x == null ? "  n/a" : (x * 100).toFixed(1) + "%");
const signed = (x) => (x == null ? "n/a" : (x > 0 ? "+" : "") + (x * 100).toFixed(1) + "%");

function printSummary(label, s) {
  console.log(`${label}`);
  console.log(`  scored ${s.scored} sales in ${s.markets} markets`);
  console.log(`  median error            ${pct(s.medianAbsError)}   (half of the estimates land closer than this)`);
  console.log(`  within 10% / 20%        ${pct(s.within10)} / ${pct(s.within20)}`);
  console.log(`  mean log error          ${s.meanLogError == null ? "n/a" : s.meanLogError.toFixed(3)}`);
  console.log(`  sale inside Low-High    ${pct(s.bandCoverage)}   (band is ${pct(s.medianBandWidth)} of Likely wide)`);
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 18).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    return 0;
  }
  const V = require("../valuation.js");
  const dataset = args.corpus
    ? datasetFromCorpusRows(readCorpusFile(path.resolve(args.corpus)))
    : datasetFromSeed(JSON.parse(fs.readFileSync(path.join(REPO, "market-seed.json"), "utf8")));
  const source = args.corpus ? path.basename(args.corpus) : "market-seed.json";

  const now = holdOneOut(V, dataset);
  const unadjusted = holdOneOut(V, dataset, { adjust: false });
  const report = {
    source,
    current: summarize(now),
    byType: byType(now),
    adjustment: compare(unadjusted, now),
    elasticities: elasticities(V, dataset),
    coefficients: { size: V.SIZE_ELASTICITY, yearBuilt: V.VINTAGE_LOG_PER_YEAR, cap: V.ADJUSTMENT_CAP },
  };
  if (args.before) report.vsRef = Object.assign({ ref: args.before }, compare(holdOneOut(valuationAtRef(args.before), dataset), now));

  if (args.json) { console.log(JSON.stringify(report, null, 2)); return 0; }

  console.log(`Valuation accuracy, hold-one-out over ${source}\n`);
  if (!now.length) {
    console.log("Nothing could be scored: no market holds a closed, sourced sale with at least " + MIN_PEERS + " other sale comps.");
    return 0;
  }
  printSummary("The math as it stands in this checkout", report.current);
  console.log("\n  by type          scored   median error   mean log error");
  report.byType.forEach((t) => console.log(`  ${t.type.padEnd(16)} ${String(t.scored).padStart(5)}   ${pct(t.medianAbsError).padStart(11)}   ${t.meanLogError.toFixed(3).padStart(13)}`));

  const showChange = (title, c) => {
    console.log(`\n${title}`);
    console.log(`  median error    ${pct(c.before.medianAbsError)} -> ${pct(c.after.medianAbsError)}   (${signed(c.medianAbsErrorChange)})`);
    console.log(`  mean log error  ${c.before.meanLogError.toFixed(3)} -> ${c.after.meanLogError.toFixed(3)}   (${signed(c.meanLogErrorChange)})`);
    const i = c.meanLogErrorInterval;
    if (i) {
      console.log(`  95% interval on the mean-log-error change, resampling markets: ${signed(i.low)} to ${signed(i.high)}`);
      console.log(`  better in ${pct(i.shareBetter)} of resamples` + (i.high < 0 ? "" : "   <- the interval reaches zero: not shown to be an improvement"));
    }
    console.log(`  inside Low-High ${pct(c.before.bandCoverage)} -> ${pct(c.after.bandCoverage)}, band width ${pct(c.before.medianBandWidth)} -> ${pct(c.after.medianBandWidth)}`);
    c.byType.forEach((t) => console.log(`    ${t.type.padEnd(14)} n=${String(t.scored).padEnd(4)} median error ${pct(t.before)} -> ${pct(t.after)}`));
  };
  showChange("What the size and age adjustment is worth (same code, adjustment off vs on)", report.adjustment);
  if (report.vsRef) showChange(`Against valuation.js at ${report.vsRef.ref}`, report.vsRef);

  const e = report.elasticities;
  if (e) {
    console.log(`\nWhat this data says size and age are worth (within-market regression, ${e.comps} comps in ${e.markets} markets)`);
    console.log(`  size elasticity      ${e.size.toFixed(3)}  (t ${e.sizeT.toFixed(1)})   valuation.js uses ${V.SIZE_ELASTICITY}`);
    console.log(`  per year newer       ${e.yearBuilt.toFixed(4)} (t ${e.yearBuiltT.toFixed(1)})   valuation.js uses ${V.VINTAGE_LOG_PER_YEAR}`);
  }
  console.log("\nThis scores the math on comps it was handed, not the search that finds them,");
  console.log("and the seed's citywide comp sets make the absolute error larger than a report's.");
  return 0;
}

module.exports = {
  datasetFromSeed, datasetFromCorpusRows, holdOneOut, summarize, byType,
  pairUp, pairedBootstrap, compare, elasticities, parseCsvRows, parseArgs, median, mean,
  MIN_PEERS, DEFAULT_REF,
};

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))); }
  catch (err) { console.error(err && err.message ? err.message : err); process.exit(1); }
}
