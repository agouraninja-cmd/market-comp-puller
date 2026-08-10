// Search-quality eval harness. Puts every target in eval-set.json through a
// REAL /api/comps search, scores each report with eval-score.js, and writes a
// summary two runs can be diffed on.
//
// This costs one billed Anthropic search per target (about $0.36 measured
// 2026-08-03), so a 12-target run is about $4.30 and a model comparison is
// two runs.
//
// ISOLATION IS THE CONTRACT. Point this at a server started from a separate
// worktree with SUPABASE_URL blank: every fallback file is relative to that
// server's own directory, so the run writes its cache, corpus rows, market
// pages, and analytics there and production sees none of it. Running it
// against the production database would both pollute it and measure the
// wrong thing.
//
// Usage:
//   EVAL_BASE=http://localhost:3170 ADMIN_KEY=... node run-eval.js --label sonnet-4-6
//   node run-eval.js --compare docs/evals/a.json docs/evals/b.json
//   ... --only 2            run just the first 2 targets (plumbing check)
// Spec: docs/superpowers/specs/2026-08-09-search-quality-eval-design.md

const fs = require("fs");
const path = require("path");
const SCORE = require("./eval-score");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] || "") : null;
};

if (args.includes("--compare")) {
  const i = args.indexOf("--compare");
  const a = JSON.parse(fs.readFileSync(args[i + 1], "utf8"));
  const b = JSON.parse(fs.readFileSync(args[i + 2], "utf8"));
  const d = SCORE.compare(a.summary, b.summary);
  const row = (label, o) => {
    const fmt = (v) => (v == null ? "n/a" : (Math.round(v * 1000) / 1000).toString());
    const arrow = o.delta == null ? "" : (o.delta > 0 ? "  +" : "   ") + fmt(o.delta);
    console.log(`  ${label.padEnd(22)} ${fmt(o.baseline).padStart(10)} -> ${fmt(o.candidate).padStart(10)}${arrow}`);
  };
  console.log(`\nbaseline: ${a.label} (${a.model || "model not recorded"}, ${a.ranAt})`);
  console.log(`candidate: ${b.label} (${b.model || "model not recorded"}, ${b.ranAt})\n`);
  row("valuation possible", d.valuationPossibleRate);
  row("subject size found", d.subjectSizeFoundRate);
  row("failures", d.failures);
  Object.keys(d.metrics).sort().forEach((k) => row(k, d.metrics[k]));
  console.log("\nDeltas only. A dozen stochastic searches per run means small moves are noise; read the direction, not the decimal.\n");
  process.exit(0);
}

const BASE = (process.env.EVAL_BASE || "").trim();
const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();
if (!BASE) {
  console.error("EVAL_BASE is required (no default, on purpose: it must not silently hit your normal dev server).");
  console.error("Start an isolated server from a worktree with SUPABASE_URL blank, then set EVAL_BASE to it.");
  process.exit(1);
}
if (!ADMIN_KEY) {
  console.error("ADMIN_KEY is required: it is what makes this an internal caller, which is what the fresh flag and the whole-report bypass are gated on.");
  process.exit(1);
}

const label = flag("--label") || "run";
const only = Number(flag("--only") || 0);
const set = JSON.parse(fs.readFileSync(path.join(__dirname, "eval-set.json"), "utf8"));
const targets = only > 0 ? set.targets.slice(0, only) : set.targets;

// The `fresh: true` flag on each request only skips the CACHE read. There is
// a second, quieter door back to a previous run's data: corpusRowsForMarket()
// reads the local comp-corpus.jsonl fallback even with no Supabase configured,
// so a prior run's harvest of e.g. "Boise, ID" hands the NEXT run corpus
// coverage for that market, which shrinks its search budget
// (searchBudgetFor()) and changes what the model is handed as candidates —
// the same cross-run contamination `fresh` exists to prevent, arriving
// through a different door. Wipe it before every run so each run starts from
// zero corpus coverage, the same way a genuinely fresh deployment would.
// This only has the intended effect when the server under test is running
// from THIS SAME WORKTREE (comp-corpus.jsonl is resolved relative to the
// server's own __dirname), which is the documented setup above.
const corpusFile = path.join(__dirname, "comp-corpus.jsonl");
let corpusWiped = false;
try {
  fs.unlinkSync(corpusFile);
  corpusWiped = true;
  console.log(`Wiped ${corpusFile} (previous run's corpus fallback would have shrunk this run's search budget).`);
} catch (e) {
  if (e.code === "ENOENT") {
    console.log(`No ${corpusFile} to wipe (clean start).`);
  } else {
    throw e;
  }
}

async function runOne(t) {
  const started = Date.now();
  const r = await fetch(`${BASE}/api/comps`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": ADMIN_KEY },
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
    throw new Error(`report came back gated (${report.locked_count} locked) — ADMIN_KEY does not match the server's`);
  }
  const metrics = SCORE.scoreReport(report, t, Date.now());
  metrics.durationMs = durationMs;
  return { report: report, metrics: metrics };
}

(async () => {
  const runDir = path.join(__dirname, "eval-runs", `${label}-${Date.now()}`);
  fs.mkdirSync(runDir, { recursive: true });
  const results = [];
  for (const t of targets) {
    const name = `${t.type} — ${t.address}`;
    process.stdout.write(`${name} ... `);
    try {
      const { report, metrics } = await runOne(t);
      fs.writeFileSync(path.join(runDir, `${results.length + 1}.json`), JSON.stringify(report, null, 2));
      results.push({ target: name, ok: true, metrics: metrics });
      console.log(`${metrics.comps} comps, ${metrics.pricedSales} priced sales, ${(metrics.durationMs / 1000).toFixed(0)}s`);
    } catch (e) {
      // A failure is data, not a reason to abandon searches already paid for.
      results.push({ target: name, ok: false, error: e.message });
      console.log(`FAILED: ${e.message}`);
    }
  }
  const summary = SCORE.summarize(results);
  const out = {
    label: label,
    model: process.env.MODEL || "(server default)",
    ranAt: new Date().toISOString(),
    base: BASE,
    setSize: targets.length,
    corpusWiped: corpusWiped,
    summary: summary,
    results: results,
  };
  const dir = path.join(__dirname, "docs", "evals");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nScored ${summary.scored}/${summary.targets} (${summary.failures} failed).`);
  console.log(`Valuation possible: ${(summary.valuationPossibleRate * 100).toFixed(0)}%`);
  console.log(`Raw reports: ${runDir}`);
  console.log(`Summary: ${file}`);
})();
