#!/usr/bin/env node
// Runs the size-band A/B end to end: an isolated server, the band-off
// baseline, a MANDATORY restart, the band-on candidate, and the comparison.
//
// Why a script rather than four commands: the restart between the two runs is
// not optional and is invisible when forgotten. findKnownSubjectSize() keeps
// an in-memory Map that run-eval.js's file wipe cannot reach, so a second run
// against a still-warm server gets a shrunken search budget and a backfilled
// subject_size_sqft — the run looks fine and the comparison is measuring the
// warm-up, not the band. Here the restart is a step the script owns.
//
// ISOLATION IS BY CONSTRUCTION HERE. The child server is started with
// SUPABASE_URL and SUPABASE_SERVICE_KEY forced to the empty STRING, and
// server.js's .env loader only fills variables that are `undefined` — so a
// SUPABASE_* line left in this worktree's .env cannot re-enter through it.
// That is the one part of the documented setup that is easiest to get wrong
// (in PowerShell `$env:SUPABASE_URL = ""` deletes the variable instead of
// emptying it, and the .env value comes straight back).
//
// Still run it from a SEPARATE WORKTREE: every fallback file (search cache,
// corpus, market pages, analytics) is written relative to the server's own
// directory, and this fills them.
//
// Usage:
//   node scripts/eval-size-band.js              # prints the plan and the cost, spends nothing
//   node scripts/eval-size-band.js --yes        # full 12 targets x 2 runs (~$8.60)
//   node scripts/eval-size-band.js --yes --only 6   # half the sample (~$4.30)
//   node scripts/eval-size-band.js --yes --only 1   # plumbing check (~$0.72)
//   ... --band 50                               # candidate band, default 30
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--")) return args[i + 1];
  const eq = args.find((a) => a.startsWith(name + "="));
  return eq !== undefined ? eq.slice(name.length + 1) : fallback;
};

const KNOWN = ["--yes", "--only", "--band", "--port", "--admin-key"];
for (const a of args) {
  if (!a.startsWith("--")) continue;
  const name = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
  if (!KNOWN.includes(name)) {
    console.error(`Unrecognized argument: ${a}\nKnown: ${KNOWN.join(" ")}`);
    process.exit(1);
  }
}

const only = Number(flag("--only", 0)) || 0;
const band = flag("--band", "30");
const port = flag("--port", "3170");
const adminKey = flag("--admin-key", "eval-" + Math.random().toString(36).slice(2, 10));

// eval-set.json is the source of truth for the target count, so the cost
// estimate cannot drift from the set the way a hardcoded 12 would.
const setSize = JSON.parse(fs.readFileSync(path.join(ROOT, "eval-set.json"), "utf8")).targets.length;
const perRun = only > 0 ? Math.min(only, setSize) : setSize;
// $0.36/target measured 2026-08-03 on Anthropic. Gemini differs; this is a
// scale, not an invoice.
const cost = (perRun * 2 * 0.36).toFixed(2);

// The provider key never gets read or printed here — the child server loads
// its own .env. This only checks that SOMETHING is there, so the run fails
// now rather than twelve searches into a run where every one of them 401s.
function keyLooksPresent() {
  if (process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY) return true;
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    return /^\s*(GEMINI_API_KEY|ANTHROPIC_API_KEY)\s*=\s*\S/m.test(env);
  } catch (_) { return false; }
}

console.log(`\nSize-band A/B`);
console.log(`  worktree:  ${ROOT}`);
console.log(`  targets:   ${perRun} per run x 2 runs = ${perRun * 2} billed searches`);
console.log(`  estimate:  ~$${cost} (at $0.36/search, measured on Anthropic)`);
console.log(`  baseline:  no band stated`);
console.log(`  candidate: --size-band ${band}`);
console.log(`  isolation: SUPABASE_URL forced empty on the child server\n`);

if (!args.includes("--yes")) {
  console.log("Nothing spent. Re-run with --yes to start.\n");
  process.exit(0);
}
if (!keyLooksPresent()) {
  console.error("No GEMINI_API_KEY or ANTHROPIC_API_KEY found in the environment or this worktree's .env.");
  console.error("Copy ONLY the provider key line into .env — never the whole file, since a copied");
  console.error("SUPABASE_* pair is exactly what turns an isolated run into one that writes to production.");
  process.exit(1);
}

const BASE = `http://localhost:${port}`;

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
      cwd: ROOT,
      env: {
        ...process.env,
        // Empty STRING, not deleted: server.js's .env loader fills only what
        // is `undefined`, so this is what actually holds the isolation.
        SUPABASE_URL: "",
        SUPABASE_SERVICE_KEY: "",
        PORT: String(port),
        ADMIN_KEY: adminKey,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const watch = (buf) => {
      out += buf.toString();
      // Worth surfacing: it is the proof the band is actually on for the
      // candidate run, and the per-search line is the proof it bit.
      for (const line of buf.toString().split("\n")) {
        if (/Comp size band|Size band:|⛔|Anthropic call|Gemini call/.test(line)) console.log(`    [server] ${line.trim()}`);
      }
    };
    child.stdout.on("data", watch);
    child.stderr.on("data", watch);
    child.on("exit", (code) => reject(new Error(`server exited early (${code})\n${out.slice(-800)}`)));

    (async () => {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const r = await fetch(`${BASE}/healthz`);
          if (r.ok) {
            child.removeAllListeners("exit");
            const h = await r.json();
            console.log(`    server up on ${port} (provider ${h.provider}, model ${h.model})`);
            return resolve(child);
          }
        } catch (_) { /* not up yet */ }
      }
      child.kill();
      reject(new Error("server did not answer /healthz within 30s"));
    })();
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill();
    setTimeout(resolve, 5000).unref?.();
  });
}

// Runs run-eval.js, echoing its output live, and returns the summary path it
// reports. Parsed from its own "Summary: <file>" line rather than by guessing
// at the newest file in docs/evals, which would pick up an unrelated run.
function runEval(extra) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "run-eval.js"), ...extra], {
      cwd: ROOT,
      env: { ...process.env, EVAL_BASE: BASE, ADMIN_KEY: adminKey },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (b) => { out += b; process.stdout.write(b); });
    child.stderr.on("data", (b) => { out += b; process.stderr.write(b); });
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`run-eval exited ${code}`));
      const m = out.match(/^Summary: (.+)$/m);
      if (!m) return reject(new Error("run-eval did not report a summary path"));
      resolve(m[1].trim());
    });
  });
}

(async () => {
  let child = null;
  try {
    const onlyArgs = only > 0 ? ["--only", String(only)] : [];

    console.log("[1/3] baseline — no band stated");
    child = await startServer();
    const baseline = await runEval(["--label", "band-off", ...onlyArgs]);
    await stopServer(child);
    child = null;

    // The restart this script exists for.
    console.log("\n[2/3] restart, then candidate — the subject-size memo lives in memory");
    child = await startServer();
    const candidate = await runEval(["--label", `band-${band}`, "--size-band", String(band), ...onlyArgs]);
    await stopServer(child);
    child = null;

    console.log("\n[3/3] comparison");
    await new Promise((resolve, reject) => {
      const c = spawn(process.execPath, [path.join(ROOT, "run-eval.js"), "--compare", baseline, candidate],
        { cwd: ROOT, stdio: "inherit" });
      c.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`--compare exited ${code}`))));
    });

    console.log(`\nbaseline summary:  ${baseline}`);
    console.log(`candidate summary: ${candidate}`);
    console.log(`\nRead "valuation possible" first: the hero needs two priced sale comps, so a band`);
    console.log(`that starves it shows up there and in "priced sales". A dozen stochastic searches`);
    console.log(`are noisy — treat a small delta as noise.\n`);
  } catch (err) {
    console.error(`\nFailed: ${err.message}`);
    console.error("Any searches already billed are recorded under eval-runs/ and docs/evals/.");
    await stopServer(child);
    process.exit(1);
  }
})();
