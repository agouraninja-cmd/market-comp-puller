// ---------------------------------------------------------------------------
// The isolation contract shared by every harness that spends real money
// against a real server: run-eval.js (search quality) and run-accuracy.js
// (comp accuracy).
//
// This was inline in run-eval.js until 2026-08-16 and moved here the moment
// a second runner needed it. A second COPY is the one duplication this repo
// genuinely cannot afford: if someone tightened one runner's preflight and
// not the other's, the loose one would quietly write cache entries, corpus
// rows, analytics and permanent public market pages into PRODUCTION, and the
// only symptom would be a slightly better-looking score. Behavior is byte for
// byte what run-eval.js did: same probe, same messages, same exit codes, same
// wipe order, same reasons.
//
// ISOLATION IS THE CONTRACT. Point a runner at a server started from a
// separate worktree with SUPABASE_URL blank: every fallback file is relative
// to that server's own directory, so the run writes its cache, corpus rows,
// market pages and analytics there and production sees none of it.
//
// SETTING UP THE ISOLATED SERVER'S .env: copy ONLY the ANTHROPIC_API_KEY line
// into that worktree's .env, never the whole file: a copied SUPABASE_URL /
// SUPABASE_SERVICE_KEY pair is exactly what turns an "isolated" run into one
// that writes to production. On Windows, if you launch the server from
// PowerShell, `$env:SUPABASE_URL = ""` DELETES the variable rather than
// setting it to empty, so server.js's .env loader (which only fills vars that
// are `undefined`) then restores whatever value the worktree's own .env
// holds. Prefer a `node -e` launcher that sets `process.env.SUPABASE_URL =
// ""` (and `SUPABASE_SERVICE_KEY`) explicitly before `require("./server.js")`,
// since an explicit empty string is never treated as unset.
// ---------------------------------------------------------------------------

"use strict";

const fs = require("fs");
const path = require("path");

// Database preflight. Isolation (SUPABASE_URL blank on the server under
// test) is enforced only by whoever launched that server, and there is no
// way for a script to see the server's actual environment variables. What it
// CAN see is whether the server BELIEVES it has a database, via GET
// /api/stats's introRequests.db field (any x-admin-key caller can read it;
// introRequests.db is `false` only when SUPABASE_URL/SUPABASE_SERVICE_KEY are
// genuinely unconfigured, `true` when a database is configured and reachable,
// and the field is absent/null when a database is configured but the read
// itself failed, which is still a database being live). If it comes back
// true, the run would write cache entries, corpus rows, analytics, subject
// sizes and permanent public market pages into that database, and would read
// ITS corpus coverage into the search budgets the run is trying to measure.
// Fails closed both ways: a probe that cannot be completed at all (non-2xx,
// unparseable JSON, or the field simply missing) is refused exactly like a
// confirmed database, because an unreadable signal is not evidence of
// isolation. EVAL_SKIP_DB_CHECK=1 is the deliberate override for someone who
// has already verified the database really is disposable.
async function preflightDbCheck(base, adminKey) {
  if (String(process.env.EVAL_SKIP_DB_CHECK || "") === "1") {
    console.log("EVAL_SKIP_DB_CHECK=1 set: skipping the database preflight probe.");
    return;
  }
  let stats = null;
  let probeError = null;
  try {
    const r = await fetch(`${base}/api/stats`, { headers: { "x-admin-key": adminKey } });
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
    console.error(`Refusing to run: the server at ${base} has a database configured (GET /api/stats -> introRequests.db === true).`);
    console.error("This run would write cache entries, corpus rows, analytics, subject sizes and permanent public market pages into that database, and would read its corpus coverage into the budgets this run is trying to measure.");
    console.error("If this really is a disposable eval database, set EVAL_SKIP_DB_CHECK=1 to override.");
    process.exit(1);
  }
  console.log("Database preflight: no database configured on the target server. Proceeding.");
}

// The `fresh: true` flag on each request only skips the CACHE read. There are
// two quieter doors back to a previous run's data, and both are wiped before
// every run so each run starts from zero, the same way a genuinely fresh
// deployment would:
//
// 1. corpusRowsForMarket() reads the local comp-corpus.jsonl fallback even
//    with no Supabase configured, so a prior run's harvest of e.g. "Boise,
//    ID" hands the NEXT run corpus coverage for that market, which shrinks
//    its search budget (searchBudgetFor()) and changes what the model is
//    handed as candidates.
// 2. findKnownSubjectSize() does the same for the building-size lookup: no
//    target supplies subjectSizeSqft, so run A's size lookup is persisted by
//    rememberSubjectSize() into subject-sizes.json, and run B then finds that
//    size, which both shrinks run B's search budget (the size rides the
//    request, skipping the 2-search lookup) and backfills
//    result.subject_size_sqft regardless of what run B's model actually did,
//    biasing subjectSizeFoundRate and durationMs toward whichever run went
//    second.
//
// Both are the same class of cross-run contamination `fresh` exists to
// prevent, arriving through a different door. Wiping the FILE is not enough
// for the subject-size memo, though: findKnownSubjectSize() also keeps an
// in-memory Map (subjectSizesMem) that a file delete cannot touch, so THE
// SERVER MUST BE RESTARTED between two runs being compared, not just have its
// files wiped. (The corpus read hits disk per call with no in-memory layer,
// so it does not need this.) A model comparison already forces a restart on
// its own, because MODEL is read once at server startup: this restart
// requirement mainly matters for an A/A run pair meant to measure noise,
// where nothing else would force a restart between them.
//
// Both wipes only have their intended effect when the server under test is
// running from THIS SAME WORKTREE (both files are resolved relative to the
// server's own __dirname), which is the documented setup above.
function wipeCrossRunState(dir) {
  const root = dir || __dirname;
  const wipe = (file, why) => {
    const full = path.join(root, file);
    try {
      fs.unlinkSync(full);
      console.log(`Wiped ${full} (${why}).`);
      return true;
    } catch (e) {
      if (e.code === "ENOENT") {
        console.log(`No ${full} to wipe (clean start).`);
        return false;
      }
      throw e;
    }
  };
  const corpusWiped = wipe("comp-corpus.jsonl",
    "previous run's corpus fallback would have shrunk this run's search budget");
  const subjectSizesWiped = wipe("subject-sizes.json",
    "previous run's subject-size memo would have shrunk this run's search budget and faked subjectSizeFound. Restart the server too if comparing this run against another");
  return { corpusWiped: corpusWiped, subjectSizesWiped: subjectSizesWiped };
}

// Both runners take the same two required inputs and refuse for the same
// reasons. EVAL_BASE has no default on purpose: it must not silently hit a
// normal dev server, which would be database-backed.
function requireEnv() {
  const base = (process.env.EVAL_BASE || "").trim();
  const adminKey = (process.env.ADMIN_KEY || "").trim();
  if (!base) {
    console.error("EVAL_BASE is required (no default, on purpose: it must not silently hit your normal dev server).");
    console.error("Start an isolated server from a worktree with SUPABASE_URL blank, then set EVAL_BASE to it.");
    process.exit(1);
  }
  if (!adminKey) {
    console.error("ADMIN_KEY is required: it is what makes this an internal caller, which is what the fresh flag and the whole-report bypass are gated on.");
    process.exit(1);
  }
  return { base: base, adminKey: adminKey };
}

module.exports = { preflightDbCheck, wipeCrossRunState, requireEnv };
