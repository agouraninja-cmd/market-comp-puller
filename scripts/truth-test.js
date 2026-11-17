#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The truth test: run the real report on buildings whose closed price is
// known, and measure how far it landed.
//
//   node scripts/truth-test.js                 # the plan and the bill; spends nothing
//   node scripts/truth-test.js --yes           # the real run
//   node scripts/truth-test.js --yes --only 2  # prove the plumbing on two first
//   node scripts/truth-test.js --yes --type Industrial
//   node scripts/truth-test.js --yes --ids a,b # just these entries
//   node scripts/truth-test.js --yes --typed-size   # send each building's true size, as an owner who knows it would
//   node scripts/truth-test.js --yes --thinking low # match production's reasoning depth
//   node scripts/truth-test.js --rescore eval-runs/truth-.../run.json   # re-score a saved run; free
//   node scripts/truth-test.js --compare a.json b.json                  # two runs, pair for pair
//   node scripts/truth-test.js --init-private  # start truth-set.private.json
//
// THE ANSWER KEY is truth-set.json (committed: sales whose price is public)
// plus truth-set.private.json when it exists (git-ignored: closed deals whose
// price is NOT public, which in a non-disclosure state like Idaho is all of
// them). THE TRUTH FILE IS THE TEST: key every price from the closing
// document or the public record, never from a CompNinja report, or the
// scorecard grades the tool against itself.
//
// WHAT IT COSTS. One billed search per building: about $0.03 on Gemini (the
// default provider), about $0.36 on Anthropic. Nothing is spent without --yes.
//
// IT CANNOT TOUCH PRODUCTION, by construction rather than by care. It starts
// its own server.js on a free port with a private DATA_DIR and with
// SUPABASE_URL / SUPABASE_SERVICE_KEY assigned EMPTY (server.js's .env loader
// fills only what is undefined, so an empty string stays empty; a delete
// would be refilled from .env, the trap run-eval.js documents), and it
// refuses to search unless that server then confirms it has no database. So
// no cache entry, corpus row, market page or analytics event reaches the real
// tables. The provider's own key is read from .env by that server, as on any
// local start.
//
// EVERY BUILDING GETS A NEW SERVER, with a new empty DATA_DIR. One server for
// the whole run was the first build, and it leaked: a search saves its comps
// (harvestComps) and the next search in that market is handed them
// (corpus-first retrieval), so building two's prompt carried what building
// one's search found, building one's own sale among it. In production that is
// the corpus doing its job. In a test it is one question's answer riding into
// the next, and it made the result depend on the order of the file. So each
// report here is a COLD search: no saved comps, no cache, no remembered
// building size. That is the floor a production report starts from, not a
// copy of production, which also blends in saved deals nearby.
//
// THE PRICE NEVER LEAVES THIS MACHINE. Each request carries the address, the
// type and the usual window, exactly as a customer's search does. The truth
// price is read only by truth-score.js, after the report is back.
//
// TWO WAYS TO USE IT
//
//   Looking back   Enter sales that have already closed. Fast, and good for
//                  comparing two versions of the tool. Its limit: the search
//                  looks up the subject's own last sale on purpose, so for a
//                  sale the web already holds the model usually knows the
//                  answer. The math never reads it, and the report says how
//                  often it knew and how it scored when it did not, but the
//                  clean number comes from sales the web does NOT hold
//                  (the private file) or from:
//   Looking ahead  Enter a building that is under contract or listed, with no
//                  sale_price. The run stores its prediction. When it closes,
//                  fill in the price and --rescore that run: a figure the
//                  model could not have peeked at, because it did not exist.
//
// Output: the scorecard on screen; the full run (reports included) under the
// git-ignored eval-runs/, which is what --rescore reads; and a summary in
// docs/evals/ to commit, in which a private entry keeps its percentages and
// loses its address, its price and every dollar figure.
//
// Scoring rules and what each number means: truth-score.js's header.
// ---------------------------------------------------------------------------

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const TRUTH = require(path.join(ROOT, "truth-score.js"));

// Used only to quote the bill before spending it. Measured figures from
// docs/evals (2026-08-10 and 2026-08-22); an out-of-date one costs a slightly
// wrong warning and nothing else. The real spend is read off each report.
const USD_PER_REPORT = { gemini: 0.031, anthropic: 0.36 };
const HEALTH_TIMEOUT_MS = 30000;
const SEARCH_TIMEOUT_MS = 6 * 60 * 1000;

const args = process.argv.slice(2);
const VALUE_FLAGS = ["set", "private", "out", "label", "only", "type", "ids", "thinking", "focus", "port", "rescore"];
const BOOL_FLAGS = ["yes", "typed-size", "init-private", "help", "compare"];
const flag = (name) => {
  const i = args.indexOf("--" + name);
  if (i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--")) return args[i + 1];
  const eq = args.find((a) => a.startsWith("--" + name + "="));
  return eq !== undefined ? eq.slice(name.length + 3) : null;
};
const has = (name) => args.includes("--" + name);
function die(msg) { console.error("\n" + msg); process.exit(1); }

// Unknown flags are refused before anything is read or spent: a silently
// ignored "--onyl 2" would be a full run nobody meant (run-eval.js's lesson).
for (const a of args) {
  if (!a.startsWith("--")) continue;
  const name = a.slice(2).split("=")[0];
  if (!VALUE_FLAGS.includes(name) && !BOOL_FLAGS.includes(name)) {
    die("Unrecognized flag: " + a + "\nKnown flags: " + VALUE_FLAGS.concat(BOOL_FLAGS).map((k) => "--" + k).join(", "));
  }
}

// ---- printing --------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const money = (v) => (v == null ? "-" : "$" + Math.round(v).toLocaleString("en-US"));
const pct = (v, d) => (v == null ? "-" : (v * 100).toFixed(d == null ? 1 : d) + "%");
const signed = (v) => (v == null ? "-" : (v > 0 ? "+" : "") + (v * 100).toFixed(1) + "%");
const range = (iv) => (iv ? "  [90%: " + pct(iv.lo) + " to " + pct(iv.hi) + "]" : "");

function printRows(rows) {
  console.log("\n" + pad("building", 24) + pad("type", 13) + lpad("sold for", 14) + lpad("low", 14)
    + lpad("LIKELY", 14) + lpad("high", 14) + lpad("miss", 9) + "  in range");
  rows.forEach((r) => {
    if (r.status === "failed") {
      console.log(pad(r.id, 24) + pad(r.type, 13) + "  the search failed: " + r.error);
      return;
    }
    const s = r.served;
    const tail = r.status === "scored" ? lpad(signed(r.miss.error), 9) + "  " + (r.miss.inRange ? "yes" : "no")
      : r.status === "open" ? "   prediction stored (not closed yet)"
      : r.status === "unsized" ? "   no building size found, so no dollar range"
      : "   too few priced sales to value it";
    console.log(pad(r.id, 24) + pad(r.type, 13) + lpad(money(r.truth && r.truth.price), 14)
      + lpad(s ? money(s.low) : "-", 14) + lpad(s ? money(s.likely) : "-", 14) + lpad(s ? money(s.high) : "-", 14) + tail);
  });
}

function printReading(label, rd) {
  if (!rd || !rd.n) { console.log("  " + pad(label, 34) + "-"); return; }
  console.log("  " + pad(label, 34) + lpad(pct(rd.medianAbsError), 7) + "  (" + rd.n + ")" + range(rd.interval));
}

function printSummary(s) {
  const h = s.headline;
  console.log("\nHOW CLOSE (as a customer sees it: the report's own size, valued today)");
  if (!h.n) {
    console.log("  Nothing to score yet: no building in this run has both a dollar range and a closed price.");
  } else {
    if (s.belowFloor) {
      console.log("  !! Only " + s.scored + " scored; under " + s.minScored + " a median swings too far to tune against. Read it as a first look.");
    }
    console.log("  " + pad("Typical miss (median)", 34) + lpad(pct(h.medianAbsError), 7) + range(h.interval));
    console.log("  " + pad("Within 10% of the real price", 34) + lpad(pct(h.within10, 0), 7));
    console.log("  " + pad("Within 20%", 34) + lpad(pct(h.within20, 0), 7));
    console.log("  " + pad("Leans", 34) + lpad(signed(h.bias), 7) + "  (" + (h.bias > 0 ? "runs high" : h.bias < 0 ? "runs low" : "centered") + ")");
    console.log("  " + pad("Real price between Low and High", 34) + lpad(pct(h.rangeCoverage, 0), 7)
      + "  (the range is " + pct(h.medianRangeWidth, 0) + " of Likely wide)");
  }
  console.log("  " + pad("Could put a dollar range on it", 34) + lpad(pct(s.hitRate, 0), 7)
    + "  (" + s.unsized + " with no size found, " + s.noValue + " with too few sales"
    + (s.failed ? ", and " + s.failed + " failed searches not counted" : "") + ")");

  console.log("\nWHERE THE MISS COMES FROM");
  printReading("With the true size typed in", s.trueSize);
  const z = s.sizeLookup;
  console.log("  " + pad("The size lookup itself", 34)
    + (z.n ? lpad(pct(z.medianAbsError), 7) + "  off, typically (" + z.n + "); within 10% on " + pct(z.within10, 0) : "-")
    + (z.wanted ? "; none found on " + z.missing + " of " + z.wanted : ""));
  printReading("Only comps from before the sale", s.asOfSale);

  const p = s.peek;
  console.log("\nDID IT ALREADY KNOW THE ANSWER");
  console.log("  The report found the building's own sale on " + p.ownSaleFound + ", at the true price on " + p.ownSaleMatched
    + ". Comps that were the building itself, removed before valuing: " + p.leakedComps + ".");
  printReading("Miss when it knew the price", p.knewPrice);
  printReading("Miss when it did not", p.didNotKnow);
  printReading("Predicted before the closing", p.prospective);

  if (s.byType.length > 1) {
    console.log("\nBY TYPE" + lpad("n", 23) + lpad("miss", 9) + lpad("<=20%", 8) + lpad("leans", 9) + lpad("in range", 10));
    s.byType.forEach((t) => console.log("  " + pad(t.type, 22) + lpad(t.n, 5) + lpad(pct(t.medianAbsError), 9)
      + lpad(pct(t.within20, 0), 8) + lpad(signed(t.bias), 9) + lpad(pct(t.rangeCoverage, 0), 10)));
  }
  if (s.worst.length) {
    console.log("\nFARTHEST OFF: " + s.worst.map((w) => w.id + " " + signed(w.error)).join(", "));
  }
  if (s.unchecked) {
    console.log("\n" + s.unchecked + " of these entries are not marked \"checked\": nobody has confirmed their price against the source.");
  }
}

// ---- pure modes ------------------------------------------------------------

if (has("help")) {
  console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1)
    .filter((l, i, all) => all.slice(0, i + 1).every((x) => x.startsWith("//")))
    .map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

if (has("compare")) {
  const files = args.slice(args.indexOf("--compare") + 1).filter((a) => !a.startsWith("--"));
  if (files.length !== 2) die("--compare takes two files: a baseline summary and a candidate summary (docs/evals/*-truth-*.json).");
  const a = readJson(files[0]), b = readJson(files[1]);
  const c = TRUTH.compare(a.rows, b.rows);
  const who = (r) => (r.label || "run") + " (" + (r.model || "model not recorded")
    + (r.thinkingLevel ? ", thinking " + r.thinkingLevel : "") + ", " + (r.ranAt || "") + ")";
  console.log("\nbaseline:  " + who(a) + "\ncandidate: " + who(b));
  console.log("\nBuildings scored in both: " + c.pairs
    + (c.onlyInBase || c.onlyInCand ? "  (left out: " + c.onlyInBase + " only in the baseline, " + c.onlyInCand + " only in the candidate)" : ""));
  if (!c.pairs) die("Nothing in common to compare.");
  console.log("Typical miss: " + pct(c.baseMedian) + " -> " + pct(c.candMedian) + "   change " + signed(c.change)
    + (c.interval ? "  [90%: " + signed(c.interval.lo) + " to " + signed(c.interval.hi) + "]" : ""));
  console.log("Closer on " + c.better + ", farther on " + c.worse + ".");
  console.log(c.interval && c.interval.hi < 0 ? "The candidate is better, and the interval stays below zero."
    : c.interval && c.interval.lo > 0 ? "The candidate is worse, and the interval stays above zero."
    : "Inside the noise: the interval straddles zero, so this is a coin flip, not a result.");
  process.exit(0);
}

// ---- the answer key --------------------------------------------------------

const SET_FILE = path.resolve(flag("set") || path.join(ROOT, "truth-set.json"));
const PRIVATE_ARG = flag("private");
const PRIVATE_FILE = PRIVATE_ARG === "none" ? null : path.resolve(PRIVATE_ARG || path.join(ROOT, "truth-set.private.json"));
const OUT = path.resolve(flag("out") || ROOT);

if (has("init-private")) {
  const file = PRIVATE_FILE || path.join(ROOT, "truth-set.private.json");
  if (fs.existsSync(file)) die(file + " already exists. Refusing to overwrite a hand-keyed answer key.");
  fs.writeFileSync(file, JSON.stringify({
    _how: "Closed deals whose price is NOT public. This file is git-ignored and must stay that way. Key each price from the closing statement. Give each entry a neutral id (deal-01), because ids are the one thing about a private entry that reaches the committed summary. Leave sale_price and sale_date out for a deal that has not closed yet: its prediction is stored, and filling them in later scores it with --rescore.",
    _fields: "id, address (\"123 Main St, City, ST 12345\"), type (" + TRUTH.TYPES.join(" | ") + "), sale_price, sale_date (YYYY-MM or YYYY-MM-DD), size_sqft (building; the lot for Land), units (Multifamily), lot_acres (Land), source, checked (true once confirmed), note",
    sales: [
      { id: "deal-01", address: "", type: "Industrial", sale_price: null, sale_date: null, size_sqft: null, source: "closing statement", checked: false, note: "" },
    ],
  }, null, 2) + "\n");
  console.log("Wrote " + file + ". Fill in the deals, then run: node scripts/truth-test.js");
  process.exit(0);
}

function loadSet(file, isPrivate) {
  let raw;
  try { raw = readJson(file); } catch (e) { die("Could not read " + file + ": " + e.message); }
  const list = Array.isArray(raw) ? raw : raw.sales;
  // A stub row nobody has filled in is not a problem to report.
  const filled = (Array.isArray(list) ? list : []).filter((r) => r && String(r.address || "").trim());
  const r = TRUTH.normalizeSet(filled, { private: isPrivate });
  return { entries: r.entries, problems: r.problems.map((p) => path.basename(file) + ": " + p),
    leads: Array.isArray(raw && raw.leads) ? raw.leads.length : 0 };
}

function loadTruth() {
  if (!fs.existsSync(SET_FILE)) die("No answer key at " + SET_FILE + ".");
  const pub = loadSet(SET_FILE, false);
  const priv = PRIVATE_FILE && fs.existsSync(PRIVATE_FILE) ? loadSet(PRIVATE_FILE, true) : { entries: [], problems: [], leads: 0 };
  const problems = pub.problems.concat(priv.problems);
  const seen = new Set(pub.entries.map((e) => e.id));
  priv.entries.forEach((e) => { if (seen.has(e.id)) problems.push(e.id + ": the same id is in both answer keys"); });
  return { entries: pub.entries.concat(priv.entries), problems, leads: pub.leads, privateCount: priv.entries.length };
}

function select(entries) {
  let picked = entries;
  const type = flag("type"), ids = flag("ids"), only = Number(flag("only") || 0);
  const parts = [];
  if (type) {
    if (!TRUTH.TYPES.includes(type)) die("--type must be one of " + TRUTH.TYPES.join(", "));
    picked = picked.filter((e) => e.type === type); parts.push("type " + type);
  }
  if (ids) {
    const want = ids.split(",").map((s) => s.trim()).filter(Boolean);
    const missing = want.filter((id) => !entries.some((e) => e.id === id));
    if (missing.length) die("No such entry: " + missing.join(", "));
    picked = picked.filter((e) => want.includes(e.id)); parts.push("ids " + want.join(","));
  }
  if (only > 0) { picked = picked.slice(0, only); parts.push("first " + only); }
  return { picked, selection: (parts.join(", ") || "whole set") + " (" + picked.length + ")" };
}

// ---- writing a run ---------------------------------------------------------

function writeOutputs(run, rows, summary, selection) {
  const stamp = Date.now();
  const runDir = path.join(OUT, "eval-runs", "truth-" + run.label + "-" + stamp);
  fs.mkdirSync(runDir, { recursive: true });
  const runFile = path.join(runDir, "run.json");
  fs.writeFileSync(runFile, JSON.stringify(run, null, 2));
  const dir = path.join(OUT, "docs", "evals");
  fs.mkdirSync(dir, { recursive: true });
  // Timestamped, so a same-day rerun never clobbers a baseline (run-eval.js's rule).
  const file = path.join(dir, new Date().toISOString().slice(0, 10) + "-truth-" + run.label + "-" + stamp + ".json");
  fs.writeFileSync(file, JSON.stringify({
    kind: "truth-test", label: run.label, ranAt: run.ranAt,
    provider: run.provider, model: run.model, thinkingLevel: run.thinkingLevel,
    focus: run.focus, typedSize: run.typedSize, targetSelection: selection,
    costUsd: run.costUsd,
    summary,
    // Private entries: percentages only. See TRUTH.publicRow.
    rows: rows.map(TRUTH.publicRow),
  }, null, 2) + "\n");
  return { runFile, file };
}

// ---- --rescore: a saved run against the answer key as it is now ------------

if (flag("rescore")) {
  const run = readJson(path.resolve(flag("rescore")));
  if (run.kind !== "truth-run") die("--rescore reads an eval-runs/truth-*/run.json, and this is not one.");
  const truth = loadTruth();
  if (truth.problems.length) die("The answer key has problems:\n  " + truth.problems.join("\n  "));
  const byId = new Map(truth.entries.map((e) => [e.id, e]));
  const rows = [], gone = [];
  run.items.forEach((it) => {
    const t = byId.get(it.id);
    if (!t) { gone.push(it.id); return; }
    rows.push(it.report
      // `ranAt` is the ORIGINAL search's: the valuation is the one made then,
      // which is what makes a prediction filled in later an honest one.
      ? TRUTH.scoreTarget(it.report, t, { ranAt: it.ranAt, typedSize: run.typedSize && t.size_sqft > 0 })
      : { id: t.id, type: t.type, market: t.market, address: t.address, private: t.private, checked: t.checked, status: "failed", error: it.error || "no report saved" });
  });
  const summary = TRUTH.summarize(rows);
  console.log("Re-scored " + rows.length + " buildings from " + run.label + " (" + run.model + ", ran " + run.ranAt + "). No search ran."
    + (gone.length ? "\nNo longer in the answer key, left out: " + gone.join(", ") : ""));
  printRows(rows);
  printSummary(summary);
  const out = writeOutputs(Object.assign({}, run, { label: run.label + "-rescored" }), rows, summary, "rescored (" + rows.length + ")");
  console.log("\nSummary to commit: " + out.file);
  process.exit(0);
}

// ---- the plan --------------------------------------------------------------

const truth = loadTruth();
if (truth.problems.length) {
  die("The answer key has problems. Nothing runs until they are fixed, because a typo in the answer key is a wrong score that looks like a right one:\n  "
    + truth.problems.join("\n  "));
}
const focus = flag("focus") || "both";
if (!["both", "sales"].includes(focus)) die("--focus is both (what a customer gets by default) or sales.");
const typedSize = has("typed-size");
const label = (flag("label") || "run").replace(/[^a-zA-Z0-9._-]/g, "-");
const { picked, selection } = select(truth.entries);

console.log("The truth test: " + picked.length + " building" + (picked.length === 1 ? "" : "s") + " (" + selection + ")"
  + (truth.privateCount ? ", " + picked.filter((e) => e.private).length + " from the private answer key" : ""));
if (!picked.length) {
  console.log("\nThe answer key is empty, so there is nothing to test yet. Add closed sales to:\n  " + SET_FILE
    + "  (prices that are public)\n  " + (PRIVATE_FILE || "truth-set.private.json") + "  (prices that are not; start it with --init-private)"
    + (truth.leads ? "\n" + truth.leads + " unconfirmed leads are waiting in truth-set.json under \"leads\": open each link, read the figures off the page, and move it to \"sales\"." : ""));
  process.exit(has("yes") ? 1 : 0);
}
{
  const byType = {};
  picked.forEach((e) => { byType[e.type] = (byType[e.type] || 0) + 1; });
  const closed = picked.filter((e) => e.sale_price);
  const now = Date.now();
  const stale = closed.filter((e) => (now - TRUTH.saleMs(TRUTH.parseSaleDate(e.sale_date))) / (30.44 * 86400000) > TRUTH.STALE_MONTHS);
  const unchecked = picked.filter((e) => !e.checked);
  console.log("  " + Object.keys(byType).sort().map((t) => t + " " + byType[t]).join(", "));
  console.log("  " + closed.length + " closed, " + (picked.length - closed.length) + " still open (their predictions are stored for later)");
  if (unchecked.length) console.log("  " + unchecked.length + " not marked \"checked\": " + unchecked.map((e) => e.id).join(", "));
  if (stale.length) {
    console.log("  " + stale.length + " closed more than " + TRUTH.STALE_MONTHS + " months ago (" + stale.map((e) => e.id).join(", ")
      + "): today's report is held against an old price there, so read \"Only comps from before the sale\" for those.");
  }
  if (closed.length < TRUTH.MIN_SCORED) {
    console.log("  Under " + TRUTH.MIN_SCORED + " closed sales: the headline will be a first look, not a figure to tune against.");
  }
  console.log("  Each is one real search. About $" + (picked.length * USD_PER_REPORT.gemini).toFixed(2) + " on Gemini (the default), about $"
    + (picked.length * USD_PER_REPORT.anthropic).toFixed(2) + " on Anthropic."
    + (typedSize ? " Sending each building's true size with the request." : ""));
}
if (!has("yes")) {
  console.log("\nNothing was spent. Add --yes to run it.");
  process.exit(0);
}

// ---- the server under test -------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, () => { const p = srv.address().port; srv.close((e) => (e ? reject(e) : resolve(p))); });
  });
}

async function bootServer() {
  const port = Number(flag("port")) || await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cn-truth-"));
  // A key only this run knows. It is what makes these searches an internal
  // caller: whole reports, the `fresh` flag, the call's real cost attached.
  const adminKey = crypto.randomBytes(24).toString("hex");
  const thinking = flag("thinking");
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      ADMIN_KEY: adminKey,
      // Assigned empty, never deleted. See the header.
      SUPABASE_URL: "", SUPABASE_SERVICE_KEY: "",
      APP_PASSWORD: "",
      // A test run must not mail anyone or reach a payment account.
      RESEND_API_KEY: "", EMAIL_FROM: "", STRIPE_SECRET_KEY: "", PRO_ENABLED: "",
      SHUTDOWN_GRACE_SECONDS: "5",
      ...(thinking ? { THINKING_LEVEL: thinking } : {}),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "", exited = null;
  child.stderr.on("data", (c) => { if (stderr.length < 8192) stderr += c; });
  child.on("close", (code) => { exited = code == null ? "signal" : code; });
  const base = "http://localhost:" + port;
  const stop = async () => {
    if (exited == null) {
      child.kill("SIGTERM");
      const t0 = Date.now();
      while (exited == null && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 100));
      if (exited == null) child.kill("SIGKILL");
    }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* a temp dir; the OS clears it */ }
  };
  // Throws rather than exits: a server that will not start for building nine
  // must not throw away the eight searches already paid for.
  const t0 = Date.now();
  for (;;) {
    if (exited != null) {
      await stop();
      throw new Error("the test server exited before it was ready (code " + exited + ").\n" + stderr.trim().slice(-800));
    }
    try {
      const r = await fetch(base + "/healthz");
      if (r.ok) { const health = await r.json(); return { base, adminKey, health, stop }; }
    } catch (_) { /* not listening yet */ }
    if (Date.now() - t0 > HEALTH_TIMEOUT_MS) {
      await stop();
      throw new Error("the test server did not answer /healthz within 30 seconds.\n" + stderr.trim().slice(-800));
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

// The server must SAY it has no database before anything is spent. It was
// started with none, so this is belt and braces, and it is run-eval.js's
// rule: an unreadable signal is not evidence of isolation.
async function confirmIsolated(srv) {
  let db;
  try {
    const r = await fetch(srv.base + "/api/stats", { headers: { "x-admin-key": srv.adminKey } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const stats = await r.json();
    db = stats && stats.introRequests ? stats.introRequests.db : undefined;
  } catch (e) { db = "unreadable: " + e.message; }
  if (db !== false) {
    const err = new Error("the test server did not confirm it has no database (introRequests.db = " + JSON.stringify(db) + ")");
    err.notIsolated = true;
    throw err;
  }
}

async function searchOne(srv, t) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SEARCH_TIMEOUT_MS);
  try {
    const r = await fetch(srv.base + "/api/comps", {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json", "x-admin-key": srv.adminKey },
      // The address, the type and the customer's own defaults. NEVER the
      // price: it would be the answer in the prompt.
      body: JSON.stringify({
        address: t.address, type: t.type, months: t.months, maxComps: 12, txFocus: focus,
        // Never a report an earlier run wrote (run-eval.js's flag).
        fresh: true,
        ...(typedSize && t.size_sqft > 0 ? { subjectSizeSqft: Math.round(t.size_sqft) } : {}),
      }),
    });
    if (!r.ok) {
      let detail = "";
      try { detail = ((await r.json()) || {}).error || ""; } catch (_) { /* no body */ }
      const err = new Error("HTTP " + r.status + (detail ? ": " + detail : ""));
      err.missingKey = r.status === 500 && /missing the .* environment variable/i.test(detail);
      throw err;
    }
    const report = await r.json();
    if (Number(report.locked_count) > 0) throw new Error("the report came back gated (" + report.locked_count + " locked)");
    return report;
  } finally { clearTimeout(timer); }
}

(async () => {
  let current = null, stopping = false;
  const bail = async (code) => {
    if (stopping) return;
    stopping = true;
    if (current) await current.stop();
    process.exit(code);
  };
  process.on("SIGINT", () => { bail(130); });
  process.on("SIGTERM", () => { bail(143); });

  const run = {
    kind: "truth-run", label, ranAt: new Date().toISOString(),
    provider: null, model: null, thinkingLevel: null,
    focus, typedSize, costUsd: 0, items: [],
  };
  const rows = [];
  const failRow = (t, msg) => {
    rows.push({ id: t.id, type: t.type, market: t.market, address: t.address, private: t.private, checked: t.checked, status: "failed", error: msg });
    run.items.push({ id: t.id, ranAt: Date.now(), report: null, error: msg });
  };

  for (let i = 0; i < picked.length; i++) {
    const t = picked[i];
    // A new server, and a new empty DATA_DIR, for every building. See the header.
    try {
      current = await bootServer();
      await confirmIsolated(current);
    } catch (e) {
      if (current) { await current.stop(); current = null; }
      // Before the first search, or from a server that will not say it is cut
      // off: stop. Later, keep what has been paid for and score it.
      if (i === 0 || e.notIsolated) die("Refusing to run: " + e.message + "\nNothing more was spent.");
      console.log("  " + (i + 1) + "/" + picked.length + "  " + t.id + " ... FAILED: " + e.message.split("\n")[0]);
      failRow(t, "the test server would not start");
      continue;
    }
    if (i === 0) {
      const h = current.health || {};
      run.provider = h.provider || null;
      run.model = h.model || null;
      run.thinkingLevel = typeof h.thinking_level === "string" ? h.thinking_level : null;
      console.log("\nTest server: " + (h.provider || "provider unknown") + " / " + (h.model || "model unknown")
        + (typeof h.thinking_level === "string" ? " / thinking " + (h.thinking_level || "vendor default") : "")
        + ", no database, nothing saved, a new one for each building.");
      if (h.provider === "gemini" && h.thinking_level !== "low") {
        console.log("  Production runs thinking \"low\" (set on Render). Add --thinking low to test what customers get.");
      }
    }
    process.stdout.write("  " + (i + 1) + "/" + picked.length + "  " + t.id + " ... ");
    const started = Date.now();
    try {
      const report = await searchOne(current, t);
      const ranAt = Date.now();
      const row = TRUTH.scoreTarget(report, t, { ranAt, typedSize: typedSize && t.size_sqft > 0 });
      rows.push(row);
      const cost = report._call && Number(report._call.cost_usd) > 0 ? Number(report._call.cost_usd) : 0;
      run.costUsd += cost;
      run.items.push({ id: t.id, ranAt, durationMs: ranAt - started, costUsd: cost, report });
      console.log(row.comps + " comps, " + row.saleComps + " sales, " + ((ranAt - started) / 1000).toFixed(0) + "s"
        + (row.miss ? ", miss " + signed(row.miss.error) : ", " + row.status.replace("_", " ")));
    } catch (e) {
      const msg = e.name === "AbortError" ? "no answer in 6 minutes" : e.message;
      console.log("FAILED: " + msg);
      if (e.missingKey) {
        await current.stop();
        die("The test server has no provider key. Put it in .env (GEMINI_API_KEY for the default provider) and run again. Nothing was spent.");
      }
      // A failure is data, not a reason to abandon searches already paid for.
      failRow(t, msg);
    }
    await current.stop();
    current = null;
  }

  const summary = TRUTH.summarize(rows);
  printRows(rows);
  printSummary(summary);
  let out;
  try { out = writeOutputs(run, rows, summary, selection); }
  catch (e) { die("The run finished but could not be saved: " + e.message); }
  console.log("\nSpent: " + (run.costUsd > 0 ? "$" + run.costUsd.toFixed(2) : "not reported by this provider"));
  console.log("Full run (git-ignored; --rescore reads it): " + out.runFile);
  console.log("Summary to commit: " + out.file);
  process.exit(0);
})().catch((e) => die("The truth test failed: " + (e && e.stack || e)));
