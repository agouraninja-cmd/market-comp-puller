// Comp search accuracy harness. Scores whether the comps a search returns are
// internally consistent, and whether they match deals we independently know.
//
// The impure runner for comp-accuracy.js, zero deps like run-eval.js and
// gen-market-seed.js. Four modes, and only ONE of them spends money:
//
//   --validate                 Check truth-set.json. Free, no network.
//   --corpus                   Family 1 over every harvested comp, pulled from
//                              GET /api/comp-corpus. Free, read-only, and the
//                              mode that produces a real number on day one
//                              with an empty answer key.
//   --offline <dir>            Family 1 (and family 2 where the key covers it)
//                              over raw reports already on disk, including the
//                              eval-runs/ output earlier billed runs paid for.
//   --seed-from-submissions    Merge approved broker submissions into the
//                              answer key as broker_verified. Read-only GET.
//   (default)                  Real searches over the targets the answer key
//                              implies. One billed search per market+type.
//   --compare <a.json> <b.json>  Deltas between two summaries.
//
// ISOLATION applies to the default mode only, and it is the same contract
// run-eval.js runs under, shared rather than copied: see eval-isolation.js.
// The read-only modes (--corpus, --seed-from-submissions) issue GETs and
// write nothing, so they are safe to point at production; give them
// ACCURACY_BASE, or --from <url>, so a production read can never be confused
// with the isolated server EVAL_BASE names.
//
// Usage:
//   node run-accuracy.js --validate
//   ACCURACY_BASE=https://compninja.co ADMIN_KEY=... node run-accuracy.js --corpus
//   node run-accuracy.js --offline eval-runs/sonnet-5-1786380859522
//   EVAL_BASE=http://localhost:3170 ADMIN_KEY=... node run-accuracy.js --label sonnet-5
// Spec: docs/superpowers/specs/2026-08-16-comp-search-accuracy-design.md

"use strict";

const fs = require("fs");
const path = require("path");
const ACC = require("./comp-accuracy");
const VAULT = require("./broker-vault");
const ISO = require("./eval-isolation");

const args = process.argv.slice(2);

const flag = (name) => {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1] !== undefined ? args[i + 1] : "";
  const eq = args.find((a) => a.startsWith(name + "="));
  return eq !== undefined ? eq.slice(name.length + 1) : null;
};

// Reject an unrecognized flag BEFORE touching the network or spending
// anything, the same reason run-eval.js does: a silently-ignored typo like
// "--corpus-only" falls through to the DEFAULT mode, which is the one that
// bills a search per market in the answer key.
const KNOWN_FLAGS = ["--validate", "--corpus", "--offline", "--seed-from-submissions",
  "--compare", "--label", "--from", "--only", "--write"];
for (const a of args) {
  if (!a.startsWith("--")) continue; // positional value (a path, a URL)
  const name = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
  if (!KNOWN_FLAGS.includes(name)) {
    console.error(`Unrecognized argument: ${a}`);
    console.error("Modes: --validate | --corpus | --offline <dir> | --seed-from-submissions | --compare <a> <b> | (default: billed run)");
    process.exit(1);
  }
}

const TRUTH_FILE = path.join(__dirname, "truth-set.json");
const readTruth = () => JSON.parse(fs.readFileSync(TRUTH_FILE, "utf8"));
const truthDeals = (set) => (Array.isArray(set && set.deals) ? set.deals : []);

const fmt = (v) => (v == null ? "n/a" : (Math.round(v * 1000) / 1000).toString());
const pct = (v) => (v == null ? "n/a" : `${Math.round(v * 1000) / 10}%`);

function reportSummary(summary) {
  console.log(`\n  comps scored          ${summary.comps}`);
  console.log(`  self-consistency      ${pct(summary.consistencyScore)}`);
  ACC.FINDING_KEYS.forEach((k) => {
    const n = summary.findings[k];
    if (n) console.log(`    ${k.padEnd(20)} ${n}`);
  });
  if (summary.truthExpected) {
    console.log(`\n  known deals in range  ${summary.truthExpected}`);
    console.log(`  recall                ${pct(summary.recall)} (${summary.truthFound} found)`);
    console.log(`  price agrees          ${pct(summary.priceAgreeRate)} (within ${pct(ACC.PRICE_TOLERANCE)})`);
    console.log(`  size agrees           ${pct(summary.sizeAgreeRate)} (within ${pct(ACC.SIZE_TOLERANCE)})`);
    console.log(`  date agrees           ${pct(summary.dateAgreeRate)} (within ${ACC.DATE_TOLERANCE_DAYS} days)`);
    console.log(`  contradictions        ${summary.contradictions}`);
    // Named carefully, every time it is printed. This is not an error rate:
    // the answer key holds the deals we happen to know, not every deal in the
    // market, so a comp missing from it is unproven rather than wrong.
    console.log(`  unverified            ${summary.unverified} comps had no entry in the answer key (not errors: the key is partial)`);
  } else {
    // Printing an "unverified" count here would be trivially every comp, and
    // a number that large sitting under the word unverified reads as a
    // finding rather than as an empty answer key.
    console.log("\n  No known deals covered this run, so nothing was scored against the answer key.");
    console.log("  Populate truth-set.json (--seed-from-submissions, or by hand) to measure recall.");
  }
}

function printFlagged(flagged, limit) {
  const shown = flagged.slice(0, limit || 20);
  if (!shown.length) return;
  console.log("\n  Findings:");
  shown.forEach((f) => {
    console.log(`    [${f.key}] ${f.address || "(no address)"}`);
    console.log(`        ${f.detail}`);
  });
  if (flagged.length > shown.length) {
    console.log(`    ... and ${flagged.length - shown.length} more.`);
  }
}

// The base for the read-only modes. Deliberately its own variable: those
// modes are safe against production, and reusing EVAL_BASE for them would
// blur the line that keeps a BILLED run off the production database.
function readOnlyBase() {
  const base = (flag("--from") || process.env.ACCURACY_BASE || process.env.EVAL_BASE || "").trim();
  const adminKey = (process.env.ADMIN_KEY || "").trim();
  if (!base) {
    console.error("Set ACCURACY_BASE (or pass --from <url>) to the server to read from. This mode only issues GETs and writes nothing, so production is a fine target.");
    process.exit(1);
  }
  if (!adminKey) {
    console.error("ADMIN_KEY is required: the corpus and submission downloads are admin-gated.");
    process.exit(1);
  }
  return { base: base.replace(/\/+$/, ""), adminKey: adminKey };
}

async function fetchCsv(base, adminKey, route) {
  const r = await fetch(`${base}${route}`, { headers: { "x-admin-key": adminKey } });
  if (!r.ok) throw new Error(`GET ${route} -> HTTP ${r.status}`);
  const rows = VAULT.parseCsv(await r.text());
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h || "").trim());
  return rows.slice(1).map((cells) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = cells[i] === undefined ? "" : cells[i]; });
    return o;
  });
}

// --- Modes ----------------------------------------------------------------

function modeValidate() {
  const set = readTruth();
  const v = ACC.validateTruthSet(set);
  console.log(`truth-set.json: ${v.deals} deal(s).`);
  if (!v.ok) {
    v.errors.forEach((e) => console.error(`  ${e}`));
    console.error(`\n${v.errors.length} problem(s). The answer key must be clean: a wrong answer scores a right comp as an error.`);
    process.exit(1);
  }
  const targets = ACC.targetsFromTruthSet(set, { now: Date.now() });
  console.log("Valid.");
  if (targets.length) {
    console.log(`\nA billed run would search ${targets.length} target(s):`);
    targets.forEach((t) => {
      console.log(`  ${t.type} / ${t.address}  (${t.months}mo, ${t.knownDeals} known deal(s))`);
    });
  } else {
    console.log("No deals yet, so a billed run would search nothing. Family 1 still works: try --corpus or --offline.");
  }
}

async function modeCorpus() {
  const { base, adminKey } = readOnlyBase();
  console.log(`Reading the comp corpus from ${base} (read-only).`);
  const rows = await fetchCsv(base, adminKey, "/api/comp-corpus");
  // The corpus CSV names the deal date `deal_date`; every other field
  // already carries its comp-shape name.
  const comps = rows.map((r) => Object.assign({}, r, { date: r.deal_date }));
  const consistency = ACC.checkComps(comps, { now: Date.now() });
  const summary = ACC.summarizeAccuracy([{ consistency: consistency, truth: {} }]);
  console.log(`\nHarvested comps: ${comps.length}`);
  reportSummary(summary);
  printFlagged(consistency.flagged, 25);
  console.log("\nThis is the self-consistency family only: a comp flagged here contradicts ITSELF, with no answer key involved.");
  console.log("It says nothing about whether an unflagged comp is real. corpus-audit.js scores citations; this scores arithmetic.\n");
}

function modeOffline(dir) {
  if (!dir) {
    console.error("--offline needs a directory of raw report JSON files (e.g. eval-runs/<run>).");
    process.exit(1);
  }
  const set = readTruth();
  const deals = truthDeals(set);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) {
    console.error(`No .json reports in ${dir}.`);
    process.exit(1);
  }
  const now = Date.now();
  const rows = [];
  const flagged = [];
  for (const f of files) {
    let report;
    try {
      report = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch (e) {
      console.log(`${f}: unreadable (${e.message})`);
      continue;
    }
    // A saved report does not record the target it was run for, so the
    // subject address is recovered from the report itself where it exists.
    // Where it does not, the truth family simply finds no expected deals,
    // which is reported as "not measured" rather than as a miss.
    const target = {
      address: report.subject_address || report.address || "",
      type: report.property_type || report.type || "",
      months: Number(report.months || 24),
    };
    const row = ACC.scoreAccuracy(report, { now: now, truth: deals, target: target });
    rows.push(row);
    row.consistency.flagged.forEach((x) => flagged.push(Object.assign({ file: f }, x)));
    console.log(`${f}: ${row.consistency.total} comps, ${row.consistency.total - row.consistency.clean} flagged`);
  }
  const summary = ACC.summarizeAccuracy(rows);
  reportSummary(summary);
  printFlagged(flagged, 25);
}

async function modeSeed() {
  const { base, adminKey } = readOnlyBase();
  console.log(`Reading approved broker submissions from ${base} (read-only).`);
  const rows = await fetchCsv(base, adminKey, "/api/comp-submissions");
  const set = readTruth();
  const existing = new Set(truthDeals(set).map((d) => `${String(d.address).toLowerCase()}|${d.date}`));

  const candidates = [];
  for (const r of rows) {
    // Approved only. Approval is what already publishes a submission's deal
    // facts into customer-facing reports, so an approved row's numbers are
    // public; a pending or rejected one's are not, and this repo is public.
    if (String(r.status || "").toLowerCase() !== "approved") continue;
    const deal = {
      address: String(r.address || "").trim(),
      city_state: "",
      type: String(r.property_type || "").trim(),
      transaction: String(r.transaction || "Sale").trim(),
      date: String(r.deal_date || "").trim(),
      price: Number(String(r.price_or_rate || "").replace(/[^0-9.]/g, "")),
      size_sqft: Number(String(r.size_sqft || "").replace(/[^0-9.]/g, "")) || "",
      basis: "broker_verified",
      // No broker name, email, phone or company travels. The credit for a
      // published comp lives in comp_submissions; an answer key in a public
      // repo needs the deal, not the person.
      source_url: "",
      added: new Date().toISOString().slice(0, 10),
      note: "Seeded from an approved broker submission.",
    };
    if (!deal.address || !deal.date) continue;
    if (existing.has(`${deal.address.toLowerCase()}|${deal.date}`)) continue;
    const errors = ACC.validateDeal(deal, candidates.length);
    if (errors.length) {
      console.log(`  skipped ${deal.address || "(no address)"}: ${errors[0]}`);
      continue;
    }
    candidates.push(deal);
  }

  if (!candidates.length) {
    console.log("\nNothing new to add. (Approved submissions only, and anything already in the key is skipped.)");
    return;
  }
  console.log(`\n${candidates.length} new deal(s) ready:`);
  candidates.forEach((d) => console.log(`  ${d.type} / ${d.address} / ${d.date} / ${d.price}`));

  if (!args.includes("--write")) {
    console.log("\nDry run. Re-run with --write to merge these into truth-set.json, then read the git diff as the review.");
    return;
  }
  set.deals = truthDeals(set).concat(candidates);
  fs.writeFileSync(TRUTH_FILE, JSON.stringify(set, null, 2) + "\n");
  console.log(`\nMerged into ${TRUTH_FILE}. Review the diff before committing: this is an answer key, and a wrong answer scores a right comp as an error.`);
}

function modeCompare() {
  const i = args.indexOf("--compare");
  const a = JSON.parse(fs.readFileSync(args[i + 1], "utf8"));
  const b = JSON.parse(fs.readFileSync(args[i + 2], "utf8"));
  const d = ACC.compareAccuracy(a.summary, b.summary);
  const row = (label, o) => {
    const arrow = o.delta == null ? "" : (o.delta > 0 ? "  +" : "   ") + fmt(o.delta);
    console.log(`  ${label.padEnd(22)} ${fmt(o.baseline).padStart(10)} -> ${fmt(o.candidate).padStart(10)}${arrow}`);
  };
  console.log(`\nbaseline: ${a.label} (${a.model || "model not recorded"}, ${a.ranAt})`);
  console.log(`candidate: ${b.label} (${b.model || "model not recorded"}, ${b.ranAt})\n`);
  Object.keys(d.metrics).forEach((k) => row(k, d.metrics[k]));
  console.log("\n  findings:");
  Object.keys(d.findings).forEach((k) => row("  " + k, d.findings[k]));
  console.log("\nSelf-consistency findings are defects and a rise is unambiguous. Recall and the agreement rates are a small sample: read the direction, not the decimal.\n");
}

async function runOne(base, adminKey, t) {
  const started = Date.now();
  const r = await fetch(`${base}/api/comps`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": adminKey },
    body: JSON.stringify({
      address: t.address, type: t.type, months: t.months, maxComps: t.maxComps,
      txFocus: "both",
      // Never serve this run a report an earlier run wrote.
      fresh: true,
    }),
  });
  const durationMs = Date.now() - started;
  if (!r.ok) {
    let detail = "";
    try { detail = ((await r.json()) || {}).error || ""; } catch (_) {}
    throw new Error(`HTTP ${r.status}${detail ? ": " + detail : ""}`);
  }
  const report = await r.json();
  if (Number(report.locked_count) > 0) {
    throw new Error(`report came back gated (${report.locked_count} locked): ADMIN_KEY does not match the server's`);
  }
  return { report: report, durationMs: durationMs };
}

async function modeBilled() {
  const set = readTruth();
  const v = ACC.validateTruthSet(set);
  if (!v.ok) {
    console.error("Refusing to spend anything: the answer key does not validate. Run --validate to see why.");
    process.exit(1);
  }
  const label = flag("--label") || "run";
  const only = Number(flag("--only") || 0);
  const all = ACC.targetsFromTruthSet(set, { now: Date.now() });
  if (!all.length) {
    console.error("The answer key is empty, so there is nothing to search for. Populate truth-set.json first (--seed-from-submissions), or use --corpus / --offline, which need no key.");
    process.exit(1);
  }
  const targets = only > 0 ? all.slice(0, only) : all;

  const { base: BASE, adminKey: ADMIN_KEY } = ISO.requireEnv();
  const runDir = path.join(__dirname, "accuracy-runs", `${label}-${Date.now()}`);
  try {
    await ISO.preflightDbCheck(BASE, ADMIN_KEY);
    const { corpusWiped, subjectSizesWiped } = ISO.wipeCrossRunState(__dirname);
    fs.mkdirSync(runDir, { recursive: true });

    const deals = truthDeals(set);
    const rows = [];
    const flagged = [];
    for (const t of targets) {
      // Plain separator, not an em dash: standing house rule against em
      // dashes in written output, and this string ends up in the committed
      // summary JSON.
      const name = `${t.type} / ${t.address}`;
      process.stdout.write(`${name} ... `);
      try {
        const { report, durationMs } = await runOne(BASE, ADMIN_KEY, t);
        // Score FIRST. This reflects a billed search that already happened
        // and must never be discarded by a later local I/O failure turning a
        // real, paid-for result into a recorded failure.
        const row = ACC.scoreAccuracy(report, { now: Date.now(), truth: deals, target: t });
        row.target = name;
        row.ok = true;
        row.durationMs = durationMs;
        rows.push(row);
        row.consistency.flagged.forEach((x) => flagged.push(Object.assign({ target: name }, x)));
        try {
          fs.writeFileSync(path.join(runDir, `${rows.length}.json`), JSON.stringify(report, null, 2));
        } catch (writeErr) {
          console.log(`(raw report not saved: ${writeErr.message}) `);
        }
        const t2 = row.truth;
        console.log(`${row.consistency.total} comps, ${row.consistency.total - row.consistency.clean} flagged, ${t2.found}/${t2.expected} known deals found, ${(durationMs / 1000).toFixed(0)}s`);
      } catch (e) {
        // A failure is data, not a reason to abandon searches already paid for.
        rows.push({ target: name, ok: false, error: e.message });
        console.log(`FAILED: ${e.message}`);
      }
    }

    const summary = ACC.summarizeAccuracy(rows);
    reportSummary(summary);
    printFlagged(flagged, 25);
    const out = {
      label: label,
      model: process.env.MODEL || "(server default)",
      ranAt: new Date().toISOString(),
      base: BASE,
      targets: targets.length,
      truthDeals: deals.length,
      corpusWiped: corpusWiped,
      subjectSizesWiped: subjectSizesWiped,
      summary: summary,
      results: rows,
    };
    const dir = path.join(__dirname, "docs", "accuracy");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}-${label}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`\nRaw reports: ${runDir}`);
    console.log(`Summary: ${file}\n`);
  } catch (err) {
    // Everything above this catch runs after billing may already have
    // started. A throw here must never silently swallow searches already
    // paid for.
    console.error(`\nAccuracy run failed: ${err.message}`);
    console.error(`Raw reports, if any were written, are under: ${runDir}`);
    process.exit(1);
  }
}

(async () => {
  try {
    if (args.includes("--compare")) return modeCompare();
    if (args.includes("--validate")) return modeValidate();
    if (args.includes("--corpus")) return await modeCorpus();
    if (args.includes("--seed-from-submissions")) return await modeSeed();
    const offline = flag("--offline");
    if (offline !== null) return modeOffline(offline);
    return await modeBilled();
  } catch (e) {
    console.error(`\n${e.message}`);
    process.exit(1);
  }
})();
