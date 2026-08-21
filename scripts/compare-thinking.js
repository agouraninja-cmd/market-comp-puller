#!/usr/bin/env node
"use strict";

// Run the THINKING_LEVEL A/B end to end: boot an isolated server, score every
// eval target at the vendor's default depth, reboot at a lower depth, score
// again, and print the trade. One command instead of the six-step dance in
// run-eval.js's header, which existed only because the launch had to be done
// by hand.
//
// WHY THIS SCRIPT EXISTS AT ALL — it removes a documented, expensive trap.
// run-eval.js warns that in PowerShell `$env:SUPABASE_URL = ""` DELETES the
// variable rather than emptying it, so server.js's .env loader (which only
// fills vars that are `undefined`) then restores whatever the worktree's
// symlinked .env holds, and an "isolated" run writes straight into production's
// cache, corpus and market pages. Spawning the child with an explicit env makes
// that impossible by construction: an empty string passed here really is an
// empty string, on every platform.
//
// It also enforces the restart the comparison depends on. THINKING_LEVEL and
// MODEL are read once at startup, and findKnownSubjectSize keeps an in-memory
// map that no file wipe can clear, so run B has to be a genuinely new process
// or it inherits run A's subject sizes and a shrunken search budget with them.
//
// Usage (from the MAIN checkout, pointing at an isolated worktree):
//   node scripts/compare-thinking.js --dir ../cn-eval-thinking --admin-key KEY \
//        --key-var GEMINI_API_KEY --key AIza... --candidate low --per-type 2 --yes
//
// Nothing is spent without --yes; without it this prints the plan and the
// estimated bill and exits.

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const HEALTH_TIMEOUT_MS = 30000;
const HEALTH_POLL_MS = 250;
// Measured 2026-08-10 on gemini-3.7-flash: ~$0.031 per report at the
// introductory rate. Used only to state the bill before spending it, so an
// out-of-date figure costs nothing but a slightly wrong warning.
const USD_PER_REPORT = 0.031;

const args = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = args.indexOf("--" + name);
  if (i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--")) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq !== undefined ? eq.slice(name.length + 3) : dflt;
};
const has = (name) => args.includes("--" + name);

// Reject unknown flags before anything is spent — run-eval.js learned this the
// expensive way, where a silently-ignored "--only=2" turned an intended $0.72
// plumbing check into a full run.
const KNOWN = ["dir", "admin-key", "key-var", "key", "candidate", "baseline",
  "per-type", "only", "port", "yes", "help"];
for (const a of args) {
  if (!a.startsWith("--")) continue;
  const name = a.slice(2).split("=")[0];
  if (!KNOWN.includes(name)) {
    console.error(`Unrecognized flag: ${a}`);
    console.error(`Known flags: ${KNOWN.map((k) => "--" + k).join(", ")}`);
    process.exit(1);
  }
}

if (has("help") || !args.length) {
  console.log(fs.readFileSync(__filename, "utf8").split("\n")
    .filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}

const DIR = path.resolve(flag("dir", ""));
const ADMIN_KEY = flag("admin-key", process.env.ADMIN_KEY || "");
const KEY_VAR = flag("key-var", "GEMINI_API_KEY");
const API_KEY = flag("key", process.env[KEY_VAR] || "");
const CANDIDATE = flag("candidate", "low");
const BASELINE = flag("baseline", "");     // "" = the vendor's own default
const PORT = Number(flag("port", "3170"));
const perType = flag("per-type", null);
const only = flag("only", null);

function die(msg) { console.error("⛔ " + msg); process.exit(1); }

if (!flag("dir", "")) die("--dir is required: the isolated worktree to run the server from.");
if (!fs.existsSync(path.join(DIR, "server.js"))) die(`No server.js in ${DIR}.`);
// Isolation is the contract. Running against the main checkout would point the
// server at the real .env, and every fallback file is relative to the server's
// own directory — so the run would write its cache, corpus rows and market
// pages into the checkout you develop in.
if (path.resolve(DIR) === path.resolve(__dirname, "..")) {
  die("--dir is the main checkout. Make a worktree first: node scripts/worktree.js eval-thinking");
}
if (!ADMIN_KEY) die("--admin-key is required: it is what makes the eval an internal caller.");
if (!API_KEY) die(`--key is required (or set ${KEY_VAR}): the isolated server needs the provider's own key.`);

const targetCount = only ? Number(only) : (perType ? Number(perType) * 6 : 12);
const bill = targetCount * 2 * USD_PER_REPORT;

console.log(`\nTHINKING_LEVEL comparison`);
console.log(`  server dir   ${DIR}`);
console.log(`  port         ${PORT}`);
console.log(`  baseline     ${BASELINE || "(vendor default)"}`);
console.log(`  candidate    ${CANDIDATE}`);
console.log(`  targets      ${targetCount} per run, 2 runs`);
console.log(`  estimated    ~$${bill.toFixed(2)} of real API spend\n`);

if (!has("yes")) {
  console.log("Nothing spent. Re-run with --yes to go ahead.\n");
  process.exit(0);
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server.js exited (code ${child.exitCode}) before it was healthy — see the log above.`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  throw new Error(`Server did not answer ${url} within ${HEALTH_TIMEOUT_MS / 1000}s.`);
}

function startServer(thinkingLevel) {
  // The whole point of this function: an EXPLICIT env. Empty strings for the
  // Supabase pair are real empty strings here, so server.js's .env loader
  // (which only fills `undefined`) cannot refill them from the worktree's
  // symlinked .env. Passing through the parent env wholesale would undo that.
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    SUPABASE_URL: "",
    SUPABASE_SERVICE_KEY: "",
    PORT: String(PORT),
    ADMIN_KEY,
    [KEY_VAR]: API_KEY,
  };
  if (thinkingLevel) env.THINKING_LEVEL = thinkingLevel;
  if (KEY_VAR === "ANTHROPIC_API_KEY") env.SEARCH_PROVIDER = "anthropic";
  // process.execPath, never the string "node": the owner's Node is a portable
  // no-admin copy that is not on PATH (see CLAUDE.md "Running it").
  return spawn(process.execPath, [path.join(DIR, "server.js")], {
    cwd: DIR, env, stdio: ["ignore", "inherit", "inherit"],
  });
}

function runEval(label) {
  return new Promise((resolve, reject) => {
    const a = ["run-eval.js", "--label", label];
    if (perType) a.push("--per-type", String(perType));
    if (only) a.push("--only", String(only));
    const child = spawn(process.execPath, a, {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, EVAL_BASE: `http://127.0.0.1:${PORT}`, ADMIN_KEY },
      stdio: "inherit",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`run-eval exited ${code}`))));
  });
}

// The newest summary carrying this label. run-eval timestamps its filenames so
// a same-day rerun cannot clobber a possibly-good baseline, which means the
// name is a prefix rather than a path we can predict.
function newestSummary(label) {
  const dir = path.resolve(__dirname, "..", "docs", "evals");
  const hits = fs.readdirSync(dir)
    .filter((f) => f.includes(`-${label}-`) && f.endsWith(".json"))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((x, y) => y.t - x.t);
  if (!hits.length) throw new Error(`No summary written for label "${label}".`);
  return path.join(dir, hits[0].f);
}

async function phase(label, level) {
  console.log(`\n=== ${label} (thinking: ${level || "vendor default"}) ===`);
  const child = startServer(level);
  try {
    const health = await waitForHealth(`http://127.0.0.1:${PORT}/healthz`, child);
    // Prove the server really is running what we asked for BEFORE spending.
    // A silently-ignored level would make both runs identical and the whole
    // comparison would read as "thinking depth does not matter".
    const got = health && typeof health.thinking_level === "string" ? health.thinking_level : null;
    if (got === null) throw new Error("Server does not report thinking_level — it predates this feature.");
    if (got !== (level || "")) throw new Error(`Asked for "${level || "(default)"}" but the server reports "${got}".`);
    console.log(`server up: ${health.provider} / ${health.model} / thinking ${got || "(vendor default)"}`);
    await runEval(label);
  } finally {
    child.kill();
    // The restart is load-bearing, so make sure the process is really gone
    // before the next one binds the same port.
    await new Promise((r) => { child.on("exit", r); setTimeout(r, 5000); });
  }
  return newestSummary(label);
}

(async () => {
  try {
    const stamp = Date.now();
    const a = await phase(`thinking-${BASELINE || "default"}-${stamp}`, BASELINE);
    const b = await phase(`thinking-${CANDIDATE}-${stamp}`, CANDIDATE);
    console.log("\n=== comparison ===");
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["run-eval.js", "--compare", a, b], {
        cwd: path.resolve(__dirname, ".."), stdio: "inherit",
      });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`compare exited ${code}`))));
    });
    console.log(`baseline summary:  ${a}`);
    console.log(`candidate summary: ${b}\n`);
  } catch (err) {
    console.error("\n⛔ " + (err && err.message));
    process.exit(1);
  }
})();
