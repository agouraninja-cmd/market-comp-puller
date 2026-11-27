#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The truth test: run a real report on buildings that have ALREADY SOLD and
// measure how far the report's Likely value lands from the sale price.
//
//   node scripts/truth-test.js --label baseline            # the whole set
//   node scripts/truth-test.js --label try --limit 6       # the first six
//   node scripts/truth-test.js --compare a.json b.json     # two saved runs
//   node scripts/truth-test.js --label x --raw dir --cached  # free: the cache
//   node scripts/truth-test.js --label x --replay dir      # free: saved reports
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
// TWO SCORES, AND THEY ARE NEVER ONE FIGURE
//
// Since 2026-11-27 a report can LEAN on the building's own sale
// (valuation.js, "The building's own sale"). Every building in this set has
// sold, and the answer key is that sale. So a report that finds the sale and
// leans on it lands near the answer because it STARTS from the answer. That
// is the product doing what it should, and it says nothing at all about how
// good the comps are or how close a report lands on a building that has not
// sold. Each report is therefore scored twice:
//
//   COMPS ONLY   the building's own sale is hidden: every row at its address
//                comes out of the comps and `subject_last_sale` is deleted.
//                This is the honest accuracy figure. It is what a report on a
//                building with no recent sale of its own can do, and it is the
//                only number to quote as "how accurate is it".
//   AS SHOWN     the report under the rule a member's page applies: the own
//                sale used when the server found and vetted one. It is split
//                into the buildings that leaned on their sale and those that
//                did not. The "leaned" half is an ECHO of the answer key.
//                Read it for how OFTEN a sale is found and for anything far
//                from 0% (a wrong sale leaned on), never as accuracy.
//
// A row's `miss`, `likely` and `inRange` are the COMPS ONLY score, as they
// were before the split, so older saved runs still compare.
//
// FIVE RULES FOR READING IT
//
//   1. One run of a building is one draw. The same address on the same code
//      landed +48%, -12% and +29% in one afternoon (2026-11-27), because each
//      search finds a different handful of comps. Compare two settings only
//      on the same buildings, with each run at least twice, and read the
//      spread between repeats before reading the difference between settings.
//   2. The subject's own sale is taken OUT of its comps before valuing, in
//      both scores. The search finds it (it is the best-documented deal at
//      that address); left in, a report would be graded on a price it was
//      shown. The server takes it out itself since 2026-11-27 (settleOwnSale).
//   3. The answer key is weaker than it looks, so every row carries `check`
//      (scripts/truth-set.json says what each means). An audit of all 47
//      against the web on 2026-11-27 confirmed 30 sales, could not confirm 15,
//      and found 2 that were ASKING prices dated as sales. Those two are not
//      scored and not run. Every summary prints the confirmed rows beside all
//      of them: when the two disagree, believe the confirmed ones.
//   4. An internal caller's report skips the radius blend, so this measures
//      the SEARCH's comps, not the saved deals a member's report also gets.
//   5. Most of these buildings are in our own comp corpus (41 of 47), which is
//      where the set came from. Before 2026-11-27 the search was handed the
//      building's own saved row and often copied it back as its "last sale",
//      which no building outside the corpus gets. The prompt no longer offers
//      a target its own row, but a hit rate measured on this set is still not
//      the hit rate on a stranger's building: measure that on addresses the
//      corpus has never held.
//
// AND ONE RULE FOR RUNNING IT: this spends real money at a real rate, on the
// same account every member's search runs on. On 2026-11-27 four passes of
// this set in ninety minutes, the last two at double rate, tripped the
// search account's spend-based rate limit, and for three minutes every search
// on the site failed. So it runs two at a time by default, it STOPS after
// three refusals in a row instead of hammering an account that has said no,
// and `--cached` re-scores the reports the last run left in the cache without
// a single billed call. Reach for `--replay` first: a change to the MATH
// needs no request at all (`--raw <dir>` keeps the reports for exactly that).
// ---------------------------------------------------------------------------

"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BULK = require(path.join(ROOT, "bulk.js"));
const BACKTEST = require(path.join(ROOT, "backtest.js"));
const VALUATION = require(path.join(ROOT, "valuation.js"));

const BASE = String(process.env.TRUTH_BASE || "https://compninja.co").replace(/\/+$/, "");

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (v, d) => (v == null ? "-" : (v * 100).toFixed(d == null ? 1 : d) + "%");

// Is this row the subject's own building? Either reading saying yes is
// enough: the backtest's street-line key, or the valuation's own matcher
// (number ranges, units, the place). Taking out one comp too many costs a
// comp; leaving the subject's sale in grades the report on a price it was
// shown.
const sameBuilding = (a, b) => BACKTEST.normAddress(a) === BACKTEST.normAddress(b) || VALUATION.sameBuilding(a, b);

// The answer-key checks (scripts/truth-set.json). "asking" is not a sale.
const CHECKS = ["confirmed", "unverified", "asking"];

// One report, scored twice (see the header). Pure: test/truth-test.test.js.
function scoreReport(target, report, now) {
  const rep = report || {};
  const comps = Array.isArray(rep.comps) ? rep.comps : [];
  const isOwn = (c) => Boolean(c && sameBuilding(c.address, target.address));
  const own = comps.filter(isOwn).length;
  const clean = comps.filter((c) => !isOwn(c));
  const size = Number(String(rep.subject_size_sqft || "").replace(/[^0-9.]/g, "")) || 0;
  const opts = { subjectSizeSqft: size, asOf: now, note: "", propertyType: target.type };

  // COMPS ONLY: nothing of the building's own sale is left in the report.
  const hidden = { ...rep, comps: clean };
  delete hidden.subject_last_sale;
  const v = BULK.valueFromReport(hidden, opts);
  const likely = v && Number(v.value_likely) > 0 ? Number(v.value_likely) : null;

  // AS SHOWN: the same comps, and the sale the server settled, under the rule
  // the page applies (the address is what lets a sale be matched to the
  // building at all). A report written before the server stamped its sale
  // leans on nothing, so for those this equals the first score.
  const s = BULK.valueFromReport({ ...rep, comps: clean }, { ...opts, address: target.address });
  const shownLikely = s && Number(s.value_likely) > 0 ? Number(s.value_likely) : null;
  const os = (s && s.own_sale) || null;
  const leaned = Boolean(os && os.anchored);

  const call = rep._call || {};
  return {
    address: target.address, type: target.type, sold: target.sold,
    check: CHECKS.includes(target.check) ? target.check : null,
    likely, miss: likely ? (likely - target.sold) / target.sold : null,
    inRange: v && likely ? target.sold >= v.value_low && target.sold <= v.value_high : null,
    shownLikely, shownMiss: shownLikely ? (shownLikely - target.sold) / target.sold : null,
    shownInRange: s && shownLikely ? target.sold >= s.value_low && target.sold <= s.value_high : null,
    leaned,
    ownSale: os ? { weight: os.weight, half: os.half, refused: os.refused, why: os.why, price: os.price, date: os.date } : null,
    size, sizeTruth: target.size || null,
    saleComps: v ? v.sale_comps : 0, comps: clean.length, ownSaleRemoved: own,
    setAside: rep.set_aside_counts || null,
    wider: rep.wider_search || null,
    calls: call.billed_calls || 0, cost: call.cost_usd || 0,
  };
}

// The same seven figures for any group of rows and either score.
function stats(rows, missKey, rangeKey) {
  const scored = rows.filter((r) => r[missKey] != null);
  const abs = scored.map((r) => Math.abs(r[missKey]));
  const share = (n) => (scored.length ? n / scored.length : null);
  return {
    n: scored.length,
    medianMiss: median(abs),
    // A handful of 300% misses would own a plain mean; cap each at 100%.
    meanMiss: mean(abs.map((a) => Math.min(a, 1))),
    within10: share(abs.filter((a) => a <= 0.10).length),
    within20: share(abs.filter((a) => a <= 0.20).length),
    over50: share(abs.filter((a) => a > 0.50).length),
    bias: median(scored.map((r) => r[missKey])),
    inRange: share(scored.filter((r) => r[rangeKey]).length),
  };
}

// The top-level figures are the COMPS ONLY score over every real sale, which
// is what this summary has always held. `confirmed` is the same score over
// the rows a second look at the web confirmed; `shown` is the other score.
function summarize(rows) {
  const real = rows.filter((r) => r.check !== "asking");
  const blind = stats(real, "miss", "inRange");
  const confirmedRows = real.filter((r) => r.check === "confirmed");
  const leanedRows = real.filter((r) => r.leaned);
  const refusals = {};
  for (const r of real) {
    if (r.error || r.leaned) continue;
    const why = r.ownSale && r.ownSale.refused ? r.ownSale.refused : "none_found";
    refusals[why] = (refusals[why] || 0) + 1;
  }
  const { n, ...blindFigures } = blind;
  return {
    buildings: rows.length,
    notASale: rows.length - real.length,
    valued: n,
    failed: rows.filter((r) => r.error).length,
    ...blindFigures,
    confirmed: stats(confirmedRows, "miss", "inRange"),
    shown: {
      all: stats(real, "shownMiss", "shownInRange"),
      confirmed: stats(confirmedRows, "shownMiss", "shownInRange"),
      leaned: stats(leanedRows, "shownMiss", "shownInRange"),
      notLeaned: stats(real.filter((r) => !r.leaned), "shownMiss", "shownInRange"),
      refusals,
    },
    saleComps: mean(real.filter((r) => !r.error).map((r) => r.saleComps)),
    seconds: median(rows.filter((r) => r.seconds > 0).map((r) => r.seconds)),
    slowest: rows.reduce((m, r) => Math.max(m, r.seconds || 0), 0),
    overMinute: rows.filter((r) => r.seconds > 60).length,
    cost: rows.reduce((s, r) => s + (r.cost || 0), 0),
    calls: rows.reduce((s, r) => s + (r.calls || 0), 0),
  };
}

function line(name, s) {
  return `    ${name.padEnd(22)} median miss ${pct(s.medianMiss).padStart(6)}   within 10% ${pct(s.within10, 0).padStart(4)}   `
    + `within 20% ${pct(s.within20, 0).padStart(4)}   over 50% ${pct(s.over50, 0).padStart(4)}   sold price inside Low-High ${pct(s.inRange, 0).padStart(4)}`;
}

function printSummary(label, s) {
  console.log(`\n${label}`);
  console.log(`  buildings ${s.buildings}, valued ${s.valued}, failed ${s.failed}`
    + (s.notASale ? `, left out as not a sale ${s.notASale}` : ""));
  console.log(`\n  COMPS ONLY (the building's own sale hidden). This is the accuracy figure.`);
  console.log(line(`all ${s.valued}`, s));
  if (s.confirmed && s.confirmed.n) console.log(line(`confirmed sales ${s.confirmed.n}`, s.confirmed));
  console.log(`    mean miss (capped) ${pct(s.meanMiss)}   bias ${pct(s.bias)}`);
  // A run saved before the split has no second score to print.
  const sh = s.shown;
  if (sh && sh.all && sh.all.n) {
    console.log(`\n  AS SHOWN (the building's own sale used where the report found and vetted one).`);
    console.log(`    leaned on its own sale: ${sh.leaned.n} of ${sh.all.n}. Those START from the answer, so this is an echo, not accuracy:`);
    if (sh.leaned.n) console.log(line(`leaned ${sh.leaned.n}`, sh.leaned));
    if (sh.notLeaned.n) console.log(line(`not leaned ${sh.notLeaned.n}`, sh.notLeaned));
    const why = Object.entries(sh.refusals || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
    if (why) console.log(`    why not: ${why}`);
  }
  console.log(`\n  sale comps per report ${s.saleComps == null ? "-" : s.saleComps.toFixed(1)}   median time ${s.seconds == null ? "-" : s.seconds.toFixed(0) + "s"}   slowest ${s.slowest.toFixed(0)}s   over a minute ${s.overMinute}`);
  console.log(`  billed calls ${s.calls}   cost $${s.cost.toFixed(2)}`);
}

// Two saved runs, building for building, on the COMPS ONLY score. Only
// buildings valued in BOTH count, so a failure in one run cannot pass for an
// improvement in the other.
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

// The rows a run spends a search on: every one that is a real sale. A row
// whose "sale" turned out to be an asking price has no answer to be scored
// against (`all` keeps it, for looking at what a report says about it).
function runnable(targets, all) {
  return all ? targets.slice() : targets.filter((t) => t.check !== "asking");
}

// Saved raw reports (`--raw <dir>` wrote them), scored again with no request:
// a change to the math needs nothing else. Each is valued as of the day it
// was fetched, so a saved report's figures do not drift as it ages, and takes
// its `check` from the truth set as it stands NOW, so a row vetted after the
// run is read with what is known today. Pure but for the reads.
function replayRows(dir, set) {
  const key = (t) => BACKTEST.normAddress(t.address) + "|" + t.type;
  const current = new Map(((set && set.targets) || []).map((t) => [key(t), t]));
  const rows = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch (e) { continue; }
    if (!saved || !saved.target || !saved.report) continue;
    const target = { ...saved.target, ...(current.get(key(saved.target)) || {}) };
    const at = Date.parse(saved.fetchedAt || "");
    rows.push({ ...scoreReport(target, saved.report, Number.isFinite(at) ? at : Date.now()), seconds: 0, replayed: name });
  }
  return rows;
}

// `flags.cached` leaves `fresh` off, so the server answers from its cache
// when it holds this exact search (it does after any earlier run of the set)
// and nothing is billed. A cache MISS on that path IS a billed search, which
// is why the run still goes through the same limits.
async function runOne(target, flags) {
  const started = Date.now();
  const base = { address: target.address, type: target.type, sold: target.sold, check: target.check || null };
  try {
    const body = { address: target.address, type: target.type, months: flags.months, maxComps: 12 };
    if (!flags.cached) body.fresh = true;
    const r = await post(body);
    const seconds = (Date.now() - started) / 1000;
    let report;
    try { report = JSON.parse(r.text); } catch (e) { return { ...base, seconds, error: "unreadable answer (" + r.status + ")" }; }
    if (r.status !== "200") return { ...base, seconds, error: r.status + " " + String(report.error || "").slice(0, 120) };
    if (flags.raw) {
      fs.mkdirSync(flags.raw, { recursive: true });
      fs.writeFileSync(path.join(flags.raw, rawName(target)), JSON.stringify({ target, fetchedAt: new Date().toISOString(), report }, null, 1));
    }
    return { ...scoreReport(target, report, Date.now()), seconds };
  } catch (err) {
    return { ...base, seconds: (Date.now() - started) / 1000, error: String(err && err.message || err).slice(0, 160) };
  }
}

function save(flags, rows, s) {
  const out = flags.out || path.join(ROOT, "truth-runs", flags.label + "-" + Date.now() + ".json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ label: flags.label, base: flags.replay ? "replay of " + flags.replay : BASE, at: new Date().toISOString(), summary: s, rows }, null, 1));
  console.log("\nSaved " + out);
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
    else if (a === "--replay") flags.replay = argv[++i];
    else if (a === "--cached") flags.cached = true;
    else if (a === "--all") flags.all = true;
    else if (a === "--compare") flags.compare = true;
    else files.push(a);
  }
  if (flags.compare) {
    if (files.length !== 2) { console.error("usage: node scripts/truth-test.js --compare a.json b.json"); process.exit(2); }
    const [a, b] = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
    printSummary(a.label, summarize(a.rows));
    printSummary(b.label, summarize(b.rows));
    const c = compare(a, b);
    console.log(`\nSame ${c.pairs} buildings, valued in both, on the COMPS ONLY score:`);
    console.log(`  median miss ${pct(c.medianA)} -> ${pct(c.medianB)}   mean (capped) ${pct(c.meanA)} -> ${pct(c.meanB)}`);
    console.log(`  closer on ${c.better}, further on ${c.worse}   a building moved ${pct(c.medianSwing)} between the two runs (median)`);
    console.log(`  sale comps per report ${c.compsA.toFixed(1)} -> ${c.compsB.toFixed(1)}`);
    return;
  }
  const set = JSON.parse(fs.readFileSync(flags.set, "utf8"));
  if (flags.replay) {
    const rows = replayRows(flags.replay, set);
    console.log(`${rows.length} saved reports from ${flags.replay}, scored again. Nothing is requested and nothing is billed.`);
    const s = summarize(rows);
    printSummary(flags.label, s);
    save(flags, rows, s);
    return;
  }
  const pool = runnable(set.targets, flags.all);
  const targets = (flags.limit > 0 ? pool.slice(0, flags.limit) : pool);
  console.log(`${targets.length} buildings against ${BASE}, ${flags.concurrency} at a time. `
    + (flags.cached ? "From the server's cache where it has them: only a miss is billed." : "Every one is a billed search."));
  const rows = new Array(targets.length);
  let next = 0, refusals = 0, stopped = false;
  await Promise.all(Array.from({ length: flags.concurrency }, async () => {
    for (;;) {
      const i = next++;
      if (i >= targets.length) return;
      if (stopped) {
        rows[i] = { address: targets[i].address, type: targets[i].type, sold: targets[i].sold, check: targets[i].check || null, seconds: 0, error: "not run: stopped after " + REFUSALS_TO_STOP + " refusals in a row" };
        continue;
      }
      rows[i] = await runOne(targets[i], flags);
      const r = rows[i];
      // The account saying no (a 429 from the provider reaches us as a 502
      // "busy", our own cap as a 429) is not a failure to retry through.
      if (isRefusal(r)) { refusals += 1; if (refusals >= REFUSALS_TO_STOP) stopped = true; } else refusals = 0;
      console.log((r.error ? "FAILED  " : pct(r.miss).padStart(8)) + "  "
        + (r.error ? "        " : (r.leaned ? pct(r.shownMiss).padStart(7) + "*" : "       -")) + "  "
        + r.seconds.toFixed(0).padStart(3) + "s  "
        + String(r.saleComps == null ? "-" : r.saleComps).padStart(2) + " comps  " + r.address + (r.error ? "  [" + r.error + "]" : ""));
    }
  }));
  console.log("\n  columns: comps-only miss, then the miss as shown where the report leaned on the building's own sale (*)");
  if (stopped) console.log(`\n!! Stopped: the search account refused ${REFUSALS_TO_STOP} searches in a row. Wait before running this again, and run it slower.`);
  const s = summarize(rows);
  printSummary(flags.label, s);
  save(flags, rows, s);
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });

module.exports = { scoreReport, summarize, stats, compare, median, isRefusal, rawName, runnable, replayRows, sameBuilding, CHECKS, REFUSALS_TO_STOP };
