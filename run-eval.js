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
// SETTING UP THE ISOLATED SERVER'S .env: copy ONLY the line holding the
// PROVIDER'S OWN key -- GEMINI_API_KEY since the default flipped on
// 2026-08-10, ANTHROPIC_API_KEY only if the isolated server is launched with
// SEARCH_PROVIDER=anthropic. Copying the wrong one boots a server that
// authenticates nothing, and every target fails after the preflight has
// already said the run is safe to spend.
// Copy that line and nothing else, never the whole file: a copied SUPABASE_URL /
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
//   ... --per-type 2        at most 2 targets of each property type (10 of
//                           the 12), which is the flag to reach for when the
//                           question is per-type quality. --only cannot
//                           answer that: eval-set.json leads with four
//                           Industrial targets, so "--only 2" is two
//                           Industrial searches.
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
const KNOWN_FLAGS = ["--compare", "--label", "--only", "--per-type"];
for (const a of args) {
  if (!a.startsWith("--")) continue; // positional value (e.g. a --compare file path)
  const name = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
  if (!KNOWN_FLAGS.includes(name)) {
    console.error(`Unrecognized argument: ${a}`);
    console.error("Usage:");
    console.error("  EVAL_BASE=... ADMIN_KEY=... node run-eval.js --label <name> [--per-type <n>] [--only <n>]");
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
  // "" is a recorded answer (the vendor default), null is "not recorded", and
  // the two must not read the same - a comparison whose only real difference
  // was the thinking level would otherwise be attributed to the model.
  const think = (r) => (r.thinkingLevel == null ? "" : `, thinking ${r.thinkingLevel || "vendor default"}`);
  console.log(`\nbaseline: ${a.label} (${a.model || "model not recorded"}${think(a)}, ${a.ranAt})`);
  console.log(`candidate: ${b.label} (${b.model || "model not recorded"}${think(b)}, ${b.ranAt})\n`);
  // Two runs over different target sets are not comparable target-for-target:
  // the full set carries four Industrial targets against one Land, so a
  // per-type slice reweights every aggregate below for reasons that have
  // nothing to do with the model. Older summaries predate this field, so an
  // absent selection is reported as unknown rather than assumed to match.
  const selA = a.targetSelection || (a.setSize ? `unrecorded (${a.setSize} targets)` : "unrecorded");
  const selB = b.targetSelection || (b.setSize ? `unrecorded (${b.setSize} targets)` : "unrecorded");
  if (selA !== selB) {
    console.log(`  ! Target selections differ: baseline "${selA}" vs candidate "${selB}".`);
    console.log(`    These aggregates are over different target sets. Treat the deltas as indicative only.\n`);
  }
  row("valuation possible", d.valuationPossibleRate);
  row("subject size found", d.subjectSizeFoundRate);
  row("failures", d.failures);
  Object.keys(d.metrics).sort().forEach((k) => row(k, d.metrics[k]));

  // The averages above are the raw record and stay exactly as they were. This
  // block is the DECISION: a speed/cost change is only ever worth taking if
  // the quality it was bought with held, and reading that off an alphabetical
  // list of eighteen averages is how a provenance drop gets missed next to an
  // exciting duration delta. So the two are put side by side, per report,
  // in the units the question is actually asked in.
  const m = (k) => (d.metrics[k] || { baseline: null, candidate: null });
  const pctMove = (o) => (o.baseline ? ((o.candidate - o.baseline) / o.baseline) * 100 : null);
  const has = (k) => m(k).baseline != null && m(k).candidate != null;
  if (has("durationMs") || has("costUsd")) {
    console.log("\n  --- per report ---");
    const line = (label, o, fmtv) => {
      if (o.baseline == null || o.candidate == null) return;
      const pc = pctMove(o);
      const tag = pc == null ? "" : `   ${pc > 0 ? "+" : ""}${pc.toFixed(1)}%`;
      console.log(`  ${label.padEnd(22)} ${fmtv(o.baseline).padStart(10)} -> ${fmtv(o.candidate).padStart(10)}${tag}`);
    };
    const secs = (v) => (v / 1000).toFixed(1) + "s";
    const usd = (v) => "$" + v.toFixed(4);
    const tok = (v) => Math.round(v).toLocaleString("en-US");
    line("time", m("durationMs"), secs);
    line("cost", m("costUsd"), usd);
    line("tokens generated", m("outputTokens"), tok);
    line("  of which thinking", m("thoughtTokens"), tok);
    line("  the report itself", m("reportTokens"), tok);
    line("thinking share", m("thoughtShare"), (v) => (v * 100).toFixed(1) + "%");
    // Cost is per report, so the number the owner actually budgets against is
    // what a month of them costs. Stated at a round volume rather than a
    // guessed one, so it reads as arithmetic instead of a forecast.
    const cb = m("costUsd");
    if (cb.baseline != null && cb.candidate != null) {
      console.log(`  per 1,000 reports      ${("$" + (cb.baseline * 1000).toFixed(2)).padStart(10)} -> ${("$" + (cb.candidate * 1000).toFixed(2)).padStart(10)}`);
    }
    // Quality is what a speed change is being traded against, so it is printed
    // in the same breath and never left to be looked up elsewhere.
    console.log("\n  --- what it cost in quality (higher is better, except the two rates) ---");
    line("priced sale comps", m("pricedSales"), (v) => v.toFixed(2));
    line("provenance score", m("provenanceScore"), (v) => v.toFixed(3));
    line("comps returned", m("comps"), (v) => v.toFixed(2));
    line("estimate rate", m("estimateRate"), (v) => (v * 100).toFixed(1) + "%");
    line("aggregate rate", m("aggregateRate"), (v) => (v * 100).toFixed(1) + "%");
    line("in-window rate", m("inWindowRate"), (v) => (v * 100).toFixed(1) + "%");
    line("market match rate", m("marketMatchRate"), (v) => (v * 100).toFixed(1) + "%");
    const vp = d.valuationPossibleRate || {};
    if (vp.baseline != null && vp.candidate != null) {
      console.log(`  valuation possible     ${(vp.baseline * 100).toFixed(0).padStart(9)}% -> ${(vp.candidate * 100).toFixed(0).padStart(9)}%`);
    }
    console.log("\n  Read it as a trade: the top block is what you gained, the bottom is what you paid.");
    console.log("  valuation possible and priced sale comps are the two that decide it — a faster,");
    console.log("  cheaper report that cannot value the building is not a cheaper report.");
  } else if (!has("costUsd")) {
    // Silence here would read as "no cost difference" rather than "no cost
    // data", which is the same misreport-absence-as-a-value trap the corpus
    // health alarm and the lead inbox each had to fix.
    console.log("\n  ! No spend data in one or both runs, so cost is not compared.");
    console.log("    Cost accounting rides on an internal-caller field added 2026-08-21; a run made");
    console.log("    before that, or one served entirely from cache, carries none.");
  }
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
const perType = Number(flag("--per-type") || 0);
const set = JSON.parse(fs.readFileSync(path.join(__dirname, "eval-set.json"), "utf8"));

// Target selection, in a fixed order: --per-type first (a balanced slice
// across property types), then --only (a plain head cap for a plumbing
// check). --only alone takes eval-set.json's order, which is Industrial
// heavy by design -- "--only 2" is two Industrial targets, NOT one target
// each from two types, so it can never answer "how does this model do per
// property type". --per-type is the flag for that question.
//
// Both change WHICH targets ran, which makes the summary no longer
// comparable target-for-target against a full-set baseline, so the
// selection is recorded in the summary (`targetSelection`) and --compare
// warns when two runs disagree on it. A per-type run and a full-set run
// weight the types differently -- the full set carries four Industrial
// targets against one Land -- so their aggregate metrics move for reasons
// that have nothing to do with the model.
function selectTargets(all) {
  let picked = all;
  if (perType > 0) {
    const seen = new Map();
    picked = picked.filter((t) => {
      const n = (seen.get(t.type) || 0) + 1;
      seen.set(t.type, n);
      return n <= perType;
    });
  }
  if (only > 0) picked = picked.slice(0, only);
  return picked;
}
const targets = selectTargets(set.targets);
// The COUNT is part of the selection, not decoration: eval-set.json is
// designed to be added to over time, so two runs can both say "full set" and
// still be over different targets. Without the count the --compare guard
// below would pass them as comparable.
const selectionName = perType > 0
  ? `per-type ${perType}${only > 0 ? `, capped at ${only}` : ""}`
  : (only > 0 ? `first ${only}` : "full set");
const targetSelection = `${selectionName} (${targets.length} targets)`;

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

// Which model actually served this run. MODEL is a startup constant on the
// server, overridable by an env var this script cannot read, so recording
// `process.env.MODEL || "(server default)"` records what the RUNNER was
// told, not what answered -- and "(server default)" is exactly what four of
// the five runs in docs/evals say, which is why "was 3.7 Flash ever scored?"
// could not be answered from the committed record on 2026-08-19. /healthz
// reports the live provider and model for this reason; ask it.
// Never fatal: a summary with an unknown model still beats losing the run.
async function liveModel() {
  try {
    const r = await fetch(`${BASE}/healthz`);
    if (!r.ok) return null;
    const h = await r.json();
    return h && h.model
      ? { model: h.model, provider: h.provider || null,
          // "" is the vendor default and is a real answer, so null (not "")
          // is what "this build does not report it" means. Only an OLDER
          // server, predating the field, yields null here.
          thinkingLevel: typeof h.thinking_level === "string" ? h.thinking_level : null }
      : null;
  } catch (e) {
    return null;
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

    // Asked before any billing, and printed, so the operator sees which
    // model is about to be scored while there is still time to stop.
    const live = await liveModel();
    console.log(live
      ? `Target server reports: ${live.provider || "provider unknown"} / ${live.model}` +
        (live.thinkingLevel == null ? "" : ` / thinking ${live.thinkingLevel || "vendor default"}`)
      : "Target server did not report a model (/healthz unreachable or older build); recording the runner's MODEL instead.");
    console.log(`Targets: ${targets.length} (${targetSelection})`);

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
      // What the server said it was running, with the runner's own MODEL as
      // the fallback when /healthz could not be reached.
      model: (live && live.model) || process.env.MODEL || "(server default)",
      provider: (live && live.provider) || null,
      // The reasoning depth the server was running. Recorded for the same
      // reason `model` is: it is the largest wall-clock setting on the box and
      // it is invisible in the report, so a --compare pair that differs only
      // in this would otherwise look like unexplained noise. null means the
      // server did not report it; "" means the vendor's own default.
      thinkingLevel: live ? live.thinkingLevel : null,
      ranAt: new Date().toISOString(),
      base: BASE,
      setSize: targets.length,
      targetSelection: targetSelection,
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
