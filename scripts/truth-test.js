#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The truth test: run a real report on buildings that have ALREADY SOLD and
// measure how far the report's Likely value lands from the sale price.
//
//   node scripts/truth-test.js --label baseline            # the whole set
//   node scripts/truth-test.js --label try --limit 6       # the first six
//   node scripts/truth-test.js --compare a.json b.json     # two saved runs
//   node scripts/truth-test.js --label x --raw dir --cached  # free: the cache
//
// This is the only instrument here that measures the WHOLE product: the
// search finding comps and the math valuing them. backtest.js (the /admin
// card) and scripts/accuracy-lab.js score the math over comps already saved;
// run-eval.js scores a report's shape with no answer key.
//
// It runs against a live server (TRUTH_BASE, default https://compninja.co)
// as an internal caller, so every building is a BILLED search (about a cent
// each on Gemini at low reasoning; two with a wider or a second lane), is
// cached and is harvested like any member's search. The admin key is never
// read here: requests go through curl, and either the session's network
// proxy injects it or ADMIN_KEY is set in the environment and passed as the
// header.
//
// FOUR RULES FOR READING IT
//
//   1. One run of a building is one draw. The same address on the same code
//      landed +48%, -12% and +29% in one afternoon (2026-11-27), because each
//      search finds a different handful of comps. Compare two settings only
//      on the same buildings, with each run at least twice, and read the
//      spread between repeats before reading the difference between settings.
//   2. The subject's own sale is taken OUT of its comps before valuing. The
//      search finds it (it is the best-documented deal at that address) and
//      corpus-first retrieval hands it over outright; left in, a report would
//      be graded on a price it was shown.
//   3. The answer key is the saved comp corpus (scripts/truth-set.json says
//      where each row came from). A "news" or "listing" sale price is what a
//      page reported, and a few are wrong. A building whose miss is over 100%
//      on every run is more likely a bad row than a bad report: check it.
//   4. An internal caller's report skips the radius blend, so this measures
//      the SEARCH's comps, not the saved deals a member's report also gets.
//
// AND ONE RULE FOR RUNNING IT: this spends real money at a real rate, on the
// same account every member's search runs on. On 2026-11-27 four passes of
// this set in ninety minutes, the last two at double rate, tripped the
// search account's spend-based rate limit, and for three minutes every search
// on the site failed. So it runs two at a time by default, it STOPS after
// three refusals in a row instead of hammering an account that has said no,
// and `--cached` re-scores the reports the last run left in the cache without
// a single billed call. Reach for that first: a change to the MATH needs no
// new searches at all (`--raw <dir>` keeps the reports for exactly that).
// ---------------------------------------------------------------------------

"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BULK = require(path.join(ROOT, "bulk.js"));
const BACKTEST = require(path.join(ROOT, "backtest.js"));

const BASE = String(process.env.TRUTH_BASE || "https://compninja.co").replace(/\/+$/, "");

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (v, d) => (v == null ? "-" : (v * 100).toFixed(d == null ? 1 : d) + "%");

// Same street-line key the backtest uses to say two rows are one building.
const sameBuilding = (a, b) => BACKTEST.normAddress(a) === BACKTEST.normAddress(b);

// One report's score against the sale price. Pure: test/truth-test.test.js.
function scoreReport(target, report, now) {
  const comps = Array.isArray(report && report.comps) ? report.comps : [];
  const own = comps.filter((c) => c && sameBuilding(c.address, target.address)).length;
  const clean = { ...report, comps: comps.filter((c) => !(c && sameBuilding(c.address, target.address))) };
  const size = Number(String((report && report.subject_size_sqft) || "").replace(/[^0-9.]/g, "")) || 0;
  const v = BULK.valueFromReport(clean, {
    subjectSizeSqft: size, asOf: now, note: "", propertyType: target.type,
  });
  const likely = v && Number(v.value_likely) > 0 ? Number(v.value_likely) : null;
  const call = (report && report._call) || {};
  return {
    address: target.address, type: target.type, sold: target.sold,
    likely, miss: likely ? (likely - target.sold) / target.sold : null,
    inRange: v && likely ? target.sold >= v.value_low && target.sold <= v.value_high : null,
    size, sizeTruth: target.size || null,
    saleComps: v ? v.sale_comps : 0, comps: clean.comps.length, ownSaleRemoved: own,
    setAside: (report && report.set_aside_counts) || null,
    wider: (report && report.wider_search) || null,
    calls: call.billed_calls || 0, cost: call.cost_usd || 0,
  };
}

function summarize(rows) {
  const scored = rows.filter((r) => r.miss != null);
  const abs = scored.map((r) => Math.abs(r.miss));
  return {
    buildings: rows.length,
    valued: scored.length,
    failed: rows.filter((r) => r.error).length,
    medianMiss: median(abs),
    // A handful of 300% misses would own a plain mean; cap each at 100%.
    meanMiss: mean(abs.map((a) => Math.min(a, 1))),
    within10: scored.length ? abs.filter((a) => a <= 0.10).length / scored.length : null,
    within20: scored.length ? abs.filter((a) => a <= 0.20).length / scored.length : null,
    over50: scored.length ? abs.filter((a) => a > 0.50).length / scored.length : null,
    bias: median(scored.map((r) => r.miss)),
    inRange: scored.length ? scored.filter((r) => r.inRange).length / scored.length : null,
    saleComps: mean(rows.filter((r) => !r.error).map((r) => r.saleComps)),
    seconds: median(rows.filter((r) => r.seconds > 0).map((r) => r.seconds)),
    slowest: rows.reduce((m, r) => Math.max(m, r.seconds || 0), 0),
    overMinute: rows.filter((r) => r.seconds > 60).length,
    cost: rows.reduce((s, r) => s + (r.cost || 0), 0),
    calls: rows.reduce((s, r) => s + (r.calls || 0), 0),
  };
}

function printSummary(label, s) {
  console.log(`\n${label}`);
  console.log(`  buildings ${s.buildings}, valued ${s.valued}, failed ${s.failed}`);
  console.log(`  median miss ${pct(s.medianMiss)}   mean miss (capped) ${pct(s.meanMiss)}   bias ${pct(s.bias)}`);
  console.log(`  within 10% ${pct(s.within10, 0)}   within 20% ${pct(s.within20, 0)}   over 50% ${pct(s.over50, 0)}   sold price inside Low-High ${pct(s.inRange, 0)}`);
  console.log(`  sale comps per report ${s.saleComps == null ? "-" : s.saleComps.toFixed(1)}   median time ${s.seconds == null ? "-" : s.seconds.toFixed(0) + "s"}   slowest ${s.slowest.toFixed(0)}s   over a minute ${s.overMinute}`);
  console.log(`  billed calls ${s.calls}   cost $${s.cost.toFixed(2)}`);
}

// Two saved runs, building for building. Only buildings valued in BOTH count,
// so a failure in one run cannot pass for an improvement in the other.
function compare(a, b) {
  const key = (r) => BACKTEST.normAddress(r.address) + "|" + r.type;
  const byA = new Map(a.rows.filter((r) => r.miss != null).map((r) => [key(r), r]));
  const pairs = [];
  b.rows.forEach((r) => { const x = byA.get(key(r)); if (x && r.miss != null) pairs.push({ a: x, b: r }); });
  const absA = pairs.map((p) => Math.abs(p.a.miss)), absB = pairs.map((p) => Math.abs(p.b.miss));
  return {
    pairs: pairs.length,
    medianA: median(absA), medianB: median(absB),
    meanA: mean(absA.map((x) => Math.min(x, 1))), meanB: mean(absB.map((x) => Math.min(x, 1))),
    better: pairs.filter((p) => Math.abs(p.b.miss) < Math.abs(p.a.miss)).length,
    worse: pairs.filter((p) => Math.abs(p.b.miss) > Math.abs(p.a.miss)).length,
    // How far one building moved between the two runs: the noise a real
    // difference has to beat.
    medianSwing: median(pairs.map((p) => Math.abs(p.b.miss - p.a.miss))),
    compsA: mean(pairs.map((p) => p.a.saleComps)), compsB: mean(pairs.map((p) => p.b.saleComps)),
  };
}

// "The search account has said no": our own daily cap (429), the provider's
// rate or spend limit (502 "busy", from upstreamError) or the service down.
const REFUSALS_TO_STOP = 3;
function isRefusal(row) {
  return Boolean(row && row.error && /^(429|502|503)\b/.test(String(row.error)));
}

function post(body) {
  const args = ["-sS", "-m", "300", "-X", "POST", "-H", "content-type: application/json"];
  if (process.env.ADMIN_KEY) args.push("-H", "x-admin-key: " + process.env.ADMIN_KEY);
  args.push("-d", JSON.stringify(body), "-w", "\n%{http_code}", BASE + "/api/comps");
  return new Promise((resolve, reject) => {
    execFile("curl", args, { maxBuffer: 5e7 }, (err, out) => {
      if (err) return reject(err);
      const cut = out.lastIndexOf("\n");
      resolve({ status: out.slice(cut + 1).trim(), text: out.slice(0, cut) });
    });
  });
}

// A file name for one building's raw report: its street line, made safe.
function rawName(target) {
  return BACKTEST.normAddress(target.address).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") + ".json";
}

// `flags.cached` leaves `fresh` off, so the server answers from its cache
// when it holds this exact search (it does after any earlier run of the set)
// and nothing is billed. A cache MISS on that path IS a billed search, which
// is why the run still goes through the same limits.
async function runOne(target, flags) {
  const started = Date.now();
  try {
    const body = { address: target.address, type: target.type, months: flags.months, maxComps: 12 };
    if (!flags.cached) body.fresh = true;
    const r = await post(body);
    const seconds = (Date.now() - started) / 1000;
    let report;
    try { report = JSON.parse(r.text); } catch (e) { return { address: target.address, type: target.type, sold: target.sold, seconds, error: "unreadable answer (" + r.status + ")" }; }
    if (r.status !== "200") return { address: target.address, type: target.type, sold: target.sold, seconds, error: r.status + " " + String(report.error || "").slice(0, 120) };
    if (flags.raw) {
      fs.mkdirSync(flags.raw, { recursive: true });
      fs.writeFileSync(path.join(flags.raw, rawName(target)), JSON.stringify({ target, fetchedAt: new Date().toISOString(), report }, null, 1));
    }
    return { ...scoreReport(target, report, Date.now()), seconds };
  } catch (err) {
    return { address: target.address, type: target.type, sold: target.sold, seconds: (Date.now() - started) / 1000, error: String(err && err.message || err).slice(0, 160) };
  }
}

async function main(argv) {
  const flags = { label: "run", concurrency: 2, months: 24, set: path.join(__dirname, "truth-set.json") };
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--label") flags.label = argv[++i];
    else if (a === "--limit") flags.limit = Number(argv[++i]);
    else if (a === "--concurrency") flags.concurrency = Math.max(1, Number(argv[++i]) || 1);
    else if (a === "--months") flags.months = Number(argv[++i]);
    else if (a === "--set") flags.set = argv[++i];
    else if (a === "--out") flags.out = argv[++i];
    else if (a === "--raw") flags.raw = argv[++i];
    else if (a === "--cached") flags.cached = true;
    else if (a === "--compare") flags.compare = true;
    else files.push(a);
  }
  if (flags.compare) {
    if (files.length !== 2) { console.error("usage: node scripts/truth-test.js --compare a.json b.json"); process.exit(2); }
    const [a, b] = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
    printSummary(a.label, summarize(a.rows));
    printSummary(b.label, summarize(b.rows));
    const c = compare(a, b);
    console.log(`\nSame ${c.pairs} buildings, valued in both:`);
    console.log(`  median miss ${pct(c.medianA)} -> ${pct(c.medianB)}   mean (capped) ${pct(c.meanA)} -> ${pct(c.meanB)}`);
    console.log(`  closer on ${c.better}, further on ${c.worse}   a building moved ${pct(c.medianSwing)} between the two runs (median)`);
    console.log(`  sale comps per report ${c.compsA.toFixed(1)} -> ${c.compsB.toFixed(1)}`);
    return;
  }
  const set = JSON.parse(fs.readFileSync(flags.set, "utf8"));
  const targets = (flags.limit > 0 ? set.targets.slice(0, flags.limit) : set.targets);
  console.log(`${targets.length} buildings against ${BASE}, ${flags.concurrency} at a time. `
    + (flags.cached ? "From the server's cache where it has them: only a miss is billed." : "Every one is a billed search."));
  const rows = new Array(targets.length);
  let next = 0, refusals = 0, stopped = false;
  await Promise.all(Array.from({ length: flags.concurrency }, async () => {
    for (;;) {
      const i = next++;
      if (i >= targets.length) return;
      if (stopped) {
        rows[i] = { address: targets[i].address, type: targets[i].type, sold: targets[i].sold, seconds: 0, error: "not run: stopped after " + REFUSALS_TO_STOP + " refusals in a row" };
        continue;
      }
      rows[i] = await runOne(targets[i], flags);
      const r = rows[i];
      // The account saying no (a 429 from the provider reaches us as a 502
      // "busy", our own cap as a 429) is not a failure to retry through.
      if (isRefusal(r)) { refusals += 1; if (refusals >= REFUSALS_TO_STOP) stopped = true; } else refusals = 0;
      console.log((r.error ? "FAILED  " : pct(r.miss).padStart(8)) + "  " + r.seconds.toFixed(0).padStart(3) + "s  "
        + String(r.saleComps == null ? "-" : r.saleComps).padStart(2) + " comps  " + r.address + (r.error ? "  [" + r.error + "]" : ""));
    }
  }));
  if (stopped) console.log(`\n!! Stopped: the search account refused ${REFUSALS_TO_STOP} searches in a row. Wait before running this again, and run it slower.`);
  const s = summarize(rows);
  printSummary(flags.label, s);
  const out = flags.out || path.join(ROOT, "truth-runs", flags.label + "-" + Date.now() + ".json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ label: flags.label, base: BASE, at: new Date().toISOString(), summary: s, rows }, null, 1));
  console.log("\nSaved " + out);
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });

module.exports = { scoreReport, summarize, compare, median, isRefusal, rawName, REFUSALS_TO_STOP };
