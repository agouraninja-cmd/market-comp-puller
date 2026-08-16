// Search-quality eval harness. Puts every target in eval-set.json through a
// REAL /api/comps search, scores each report with eval-score.js, and writes a
// summary two runs can be diffed on.
//
// This costs one billed Anthropic search per target (about $0.36 measured
// 2026-08-03), so a 12-target run is about $4.30 and a model comparison is
// two runs.
//
// ISOLATION IS THE CONTRACT, and it lives in eval-isolation.js, shared with
// run-accuracy.js: point this at a server started from a separate worktree
// with SUPABASE_URL blank, so the run writes its cache, corpus rows, market
// pages, and analytics there and production sees none of it. Running it
// against the production database would both pollute it and measure the
// wrong thing. That module owns the preflight probe, the two cross-run wipes,
// and the setup instructions; read its header before changing anything about
// how this run is isolated.
//
// Usage:
//   EVAL_BASE=http://localhost:3170 ADMIN_KEY=... node run-eval.js --label sonnet-4-6
//   node run-eval.js --compare docs/evals/a.json docs/evals/b.json
//   ... --only 2            run just the first 2 targets (plumbing check)
//   ... --only=2            equals form, also accepted
// Spec: docs/superpowers/specs/2026-08-09-search-quality-eval-design.md

const fs = require("fs");
const path = require("path");
const SCORE = require("./eval-score");
const ISO = require("./eval-isolation");

const args = process.argv.slice(2);

// Supports both "--only 2" and "--only=2".
const flag = (name) => {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1] !== undefined ? args[i + 1] : "";
  const eq = args.find((a) => a.startsWith(name + "="));
  return eq !== undefined ? eq.slice(name.length + 1) : null;
};

// Reject anything that isn't a recognized flag, BEFORE touching EVAL_BASE,
// ADMIN_KEY, or the network. A silently-ignored typo like "--only=2" (the
// old indexOf-only flag() never matched the equals form) would fall through
// to a default full run: an intended ~$0.72 plumbing check turning into a
// ~$4.30 run with nobody meaning it to.
const KNOWN_FLAGS = ["--compare", "--label", "--only"];
for (const a of args) {
  if (!a.startsWith("--")) continue; // positional value (e.g. a --compare file path)
  const name = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
  if (!KNOWN_FLAGS.includes(name)) {
    console.error(`Unrecognized argument: ${a}`);
    console.error("Usage:");
    console.error("  EVAL_BASE=... ADMIN_KEY=... node run-eval.js --label <name> [--only <n>|--only=<n>]");
    console.error("  node run-eval.js --compare <a.json> <b.json>");
    process.exit(1);
  }
}

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

const { base: BASE, adminKey: ADMIN_KEY } = ISO.requireEnv();

const label = flag("--label") || "run";
const only = Number(flag("--only") || 0);
const set = JSON.parse(fs.readFileSync(path.join(__dirname, "eval-set.json"), "utf8"));
const targets = only > 0 ? set.targets.slice(0, only) : set.targets;

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
    throw new Error(`report came back gated (${report.locked_count} locked): ADMIN_KEY does not match the server's`);
  }
  const metrics = SCORE.scoreReport(report, t, Date.now());
  metrics.durationMs = durationMs;
  return { report: report, metrics: metrics };
}

(async () => {
  const runDir = path.join(__dirname, "eval-runs", `${label}-${Date.now()}`);
  try {
    await ISO.preflightDbCheck(BASE, ADMIN_KEY);

    // Wipe the two doors back to a previous run's data that `fresh: true`
    // does not close (the corpus fallback and the subject-size memo). Both
    // reasons, and the "restart the server too" caveat that a file delete
    // cannot satisfy, are in eval-isolation.js's header.
    const { corpusWiped, subjectSizesWiped } = ISO.wipeCrossRunState(__dirname);

    fs.mkdirSync(runDir, { recursive: true });
    const results = [];
    for (const t of targets) {
      // Plain separator, not an em dash: standing house rule against em
      // dashes in written output, and this string ends up in the committed
      // summary JSON.
      const name = `${t.type} / ${t.address}`;
      process.stdout.write(`${name} ... `);
      try {
        const { report, metrics } = await runOne(t);
        // Record the score FIRST. metrics reflects a billed search that
        // already happened and must never be discarded by a later local I/O
        // failure (e.g. a full disk on the raw-report write below) turning a
        // real, paid-for result into a recorded failure.
        results.push({ target: name, ok: true, metrics: metrics });
        try {
          fs.writeFileSync(path.join(runDir, `${results.length}.json`), JSON.stringify(report, null, 2));
        } catch (writeErr) {
          console.log(`(raw report not saved: ${writeErr.message}) `);
        }
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
      subjectSizesWiped: subjectSizesWiped,
      summary: summary,
      results: results,
    };
    const dir = path.join(__dirname, "docs", "evals");
    fs.mkdirSync(dir, { recursive: true });
    // Timestamped so a same-day, same-label rerun cannot silently clobber a
    // possibly-good baseline the way "<date>-<label>.json" alone would.
    const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}-${label}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`\nScored ${summary.scored}/${summary.targets} (${summary.failures} failed).`);
    console.log(`Valuation possible: ${(summary.valuationPossibleRate * 100).toFixed(0)}%`);
    console.log(`Raw reports: ${runDir}`);
    console.log(`Summary: ${file}`);
  } catch (err) {
    // Everything above this catch runs after billing may already have
    // started. A throw here (e.g. the docs/evals write itself failing) must
    // never silently swallow searches that were already paid for.
    console.error(`\nEval run failed: ${err.message}`);
    console.error(`Raw reports, if any were written, are under: ${runDir}`);
    process.exit(1);
  }
})();
