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
// wrong thing. Isolation is enforced only by however the server was
// launched, so this script also probes the server before spending anything
// (see "Database preflight" below) and refuses if it looks database-backed.
//
// SETTING UP THE ISOLATED SERVER'S .env: copy ONLY the ANTHROPIC_API_KEY line
// into this worktree's .env, never the whole file: a copied SUPABASE_URL /
// SUPABASE_SERVICE_KEY pair is exactly what turns an "isolated" run into one
// that writes to production. On Windows, if you launch the server from
// PowerShell, `$env:SUPABASE_URL = ""` DELETES the variable rather than
// setting it to empty, so server.js's .env loader (which only fills vars that
// are `undefined`) then restores whatever value the worktree's own .env
// holds. Prefer a `node -e` launcher that sets `process.env.SUPABASE_URL =
// ""` (and `SUPABASE_SERVICE_KEY`) explicitly before `require("./server.js")`,
// since an explicit empty string is never treated as unset.
//
// Usage:
//   EVAL_BASE=http://localhost:3170 ADMIN_KEY=... node run-eval.js --label sonnet-4-6
//   node run-eval.js --compare docs/evals/a.json docs/evals/b.json
//   ... --only 2            run just the first 2 targets (plumbing check)
//   ... --only=2            equals form, also accepted
//   ... --size-band 30      state the comp size band for this run (or "off")
//
// MEASURING THE SIZE BAND. This harness is an internal caller (the admin key
// is what buys it `fresh` and an ungated report), and internal callers take
// no band unless they state one -- so a run WITHOUT --size-band is the
// band-off baseline and a run WITH it is the candidate. Both halves of the
// feature are exercised: the prompt states the window, and the filter runs
// (server.js applies the band even for an internal caller, precisely so this
// measures what a customer would get). The numbers that answer "is 30% safe"
// are valuationPossibleRate and pricedSales -- the hero needs two priced
// sale comps, so a band that starves it shows up in both.
// Spec: docs/superpowers/specs/2026-08-09-search-quality-eval-design.md

const fs = require("fs");
const path = require("path");
const SCORE = require("./eval-score");

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
const KNOWN_FLAGS = ["--compare", "--label", "--only", "--size-band"];
for (const a of args) {
  if (!a.startsWith("--")) continue; // positional value (e.g. a --compare file path)
  const name = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
  if (!KNOWN_FLAGS.includes(name)) {
    console.error(`Unrecognized argument: ${a}`);
    console.error("Usage:");
    console.error("  EVAL_BASE=... ADMIN_KEY=... node run-eval.js --label <name> [--only <n>|--only=<n>] [--size-band <pct|off>]");
    console.error("  node run-eval.js --compare <a.json> <b.json>");
    process.exit(1);
  }
}

// Absent means the band is not stated at all, which for an internal caller is
// the band-off baseline -- deliberately NOT the same as "off", which states it.
// Both resolve to no filtering here; keeping them distinct is what lets the
// summary say which run was which instead of guessing.
const sizeBandFlag = flag("--size-band");
if (sizeBandFlag !== null && sizeBandFlag !== "" && !/^(off|\d+(\.\d+)?)$/i.test(sizeBandFlag)) {
  console.error(`--size-band takes a percentage (e.g. 30) or "off", got: ${sizeBandFlag}`);
  process.exit(1);
}
const sizeBand = sizeBandFlag === null || sizeBandFlag === "" ? null : sizeBandFlag;

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
  const band = (o) => `size band ${o.sizeBand === undefined ? "(run predates the band)" : o.sizeBand}`;
  console.log(`\nbaseline: ${a.label} (${a.model || "model not recorded"}, ${band(a)}, ${a.ranAt})`);
  console.log(`candidate: ${b.label} (${b.model || "model not recorded"}, ${band(b)}, ${b.ranAt})\n`);
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

// Database preflight. Isolation (SUPABASE_URL blank on the server under
// test) is enforced only by whoever launched that server, and there is no
// way for this script to see the server's actual environment variables.
// What it CAN see is whether the server BELIEVES it has a database, via
// GET /api/stats's introRequests.db field (any x-admin-key caller can read
// it; introRequests.db is `false` only when SUPABASE_URL/SUPABASE_SERVICE_KEY
// are genuinely unconfigured, `true` when a database is configured and
// reachable, and the field is absent/null when a database is configured but
// the read itself failed, which is still a database being live). If it comes
// back true, this run would write cache entries, corpus rows, analytics,
// subject sizes, and permanent public market pages into that database, and
// would read ITS corpus coverage into the search budgets this run is trying
// to measure. Fails closed both ways: a probe that cannot be completed at
// all (non-2xx, unparseable JSON, or the field simply missing) is refused
// exactly like a confirmed database, because an unreadable signal is not
// evidence of isolation. EVAL_SKIP_DB_CHECK=1 is the deliberate override for
// someone who has already verified the database really is disposable.
async function preflightDbCheck() {
  if (String(process.env.EVAL_SKIP_DB_CHECK || "") === "1") {
    console.log("EVAL_SKIP_DB_CHECK=1 set: skipping the database preflight probe.");
    return;
  }
  let stats = null;
  let probeError = null;
  try {
    const r = await fetch(`${BASE}/api/stats`, { headers: { "x-admin-key": ADMIN_KEY } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    stats = await r.json();
  } catch (e) {
    probeError = e.message;
  }
  const db = stats && stats.introRequests ? stats.introRequests.db : undefined;
  if (probeError || typeof db !== "boolean") {
    console.error(`Database preflight probe could not be completed (${probeError || "introRequests.db missing from the response"}).`);
    console.error("Refusing to run: an unreadable signal is not evidence this server is isolated from production.");
    console.error("If you have verified the database really is disposable, set EVAL_SKIP_DB_CHECK=1 to override.");
    process.exit(1);
  }
  if (db === true) {
    console.error(`Refusing to run: the server at ${BASE} has a database configured (GET /api/stats -> introRequests.db === true).`);
    console.error("This run would write cache entries, corpus rows, analytics, subject sizes and permanent public market pages into that database, and would read its corpus coverage into the budgets this run is trying to measure.");
    console.error("If this really is a disposable eval database, set EVAL_SKIP_DB_CHECK=1 to override.");
    process.exit(1);
  }
  console.log("Database preflight: no database configured on the target server. Proceeding.");
}

async function runOne(t) {
  const started = Date.now();
  const r = await fetch(`${BASE}/api/comps`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": ADMIN_KEY },
    body: JSON.stringify({
      address: t.address, type: t.type, months: t.months, maxComps: t.maxComps,
      txFocus: "both",
      // Stated only when the run asked for it: an absent field is what makes
      // an internal caller's run the band-off baseline.
      ...(sizeBand === null ? {} : { sizeTolerancePct: sizeBand }),
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
    await preflightDbCheck();

    // The `fresh: true` flag on each request only skips the CACHE read.
    // There are two quieter doors back to a previous run's data, and both
    // are wiped here before every run so each run starts from zero, the
    // same way a genuinely fresh deployment would:
    //
    // 1. corpusRowsForMarket() reads the local comp-corpus.jsonl fallback
    //    even with no Supabase configured, so a prior run's harvest of e.g.
    //    "Boise, ID" hands the NEXT run corpus coverage for that market,
    //    which shrinks its search budget (searchBudgetFor()) and changes
    //    what the model is handed as candidates.
    // 2. findKnownSubjectSize() does the same for the building-size lookup:
    //    no eval target supplies subjectSizeSqft, so run A's size lookup is
    //    persisted by rememberSubjectSize() into subject-sizes.json, and run
    //    B then finds that size, which both shrinks run B's search budget
    //    (the size rides the request, skipping the 2-search lookup) and
    //    backfills result.subject_size_sqft regardless of what run B's model
    //    actually did, biasing subjectSizeFoundRate and durationMs toward
    //    whichever run went second.
    //
    // Both are the same class of cross-run contamination `fresh` exists to
    // prevent, arriving through a different door. Wiping the FILE is not
    // enough for the subject-size memo, though: findKnownSubjectSize() also
    // keeps an in-memory Map (subjectSizesMem) that a file delete cannot
    // touch, so THE SERVER MUST BE RESTARTED between two runs being
    // compared, not just have its files wiped. (The corpus read hits disk
    // per call with no in-memory layer, so it does not need this.) A model
    // comparison already forces a restart on its own, because MODEL is read
    // once at server startup: this restart requirement mainly matters for
    // an A/A run pair meant to measure noise, where nothing else would force
    // a restart between them.
    //
    // Both wipes only have their intended effect when the server under test
    // is running from THIS SAME WORKTREE (both files are resolved relative
    // to the server's own __dirname), which is the documented setup above.
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

    const subjectSizesFile = path.join(__dirname, "subject-sizes.json");
    let subjectSizesWiped = false;
    try {
      fs.unlinkSync(subjectSizesFile);
      subjectSizesWiped = true;
      console.log(`Wiped ${subjectSizesFile} (previous run's subject-size memo would have shrunk this run's search budget and faked subjectSizeFound). Restart the server too if comparing this run against another.`);
    } catch (e) {
      if (e.code === "ENOENT") {
        console.log(`No ${subjectSizesFile} to wipe (clean start).`);
      } else {
        throw e;
      }
    }

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
      // "(not stated)" rather than null, so a comparison of two summaries can
      // never read a missing field as "this run had no band" by accident.
      sizeBand: sizeBand === null ? "(not stated)" : sizeBand,
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
    console.log(`Valuation possible: ${(summary.valuationPossibleRate * 100).toFixed(0)}% (size band: ${sizeBand === null ? "not stated" : sizeBand})`);
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
