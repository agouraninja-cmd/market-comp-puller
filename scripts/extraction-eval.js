#!/usr/bin/env node
// The extraction test, as one command — sequence step 1 of the Business Model
// Transition Plan, and the gate on the whole Archive block (spec §9 in
// docs/superpowers/specs/2026-08-21-archive-email-ingestion-design.md).
//
//   node scripts/extraction-eval.js                 # dry run: lists the plan, spends nothing
//   node scripts/extraction-eval.js --yes           # the real run
//   node scripts/extraction-eval.js --init          # writes extract-eval/truth.json to fill in
//   node scripts/extraction-eval.js --limit 2       # prove the pipeline on two files first
//   node scripts/extraction-eval.js --dir other/    # a different eval folder
//   node scripts/extraction-eval.js --pace 7        # calls per 5 min (default 7 of the route's 8)
//
// Setup (once):
//   1. mkdir extract-eval/            (git-ignored — real broker files, never commit)
//   2. drop the 20 PDFs/screenshots in it
//   3. --init, then hand-key every deal in truth.json. THE TRUTH FILE IS THE
//      TEST — key it from the source document, never from a previous run's
//      output, or the scorecard grades the model against itself.
//   4. have a server running with a signed-in vault-capable account:
//        EXTRACT_EVAL_URL      target (default http://localhost:3000)
//        EXTRACT_EVAL_EMAIL    account email    } the harness signs in itself
//        EXTRACT_EVAL_PASSWORD account password }
//        EXTRACT_EVAL_COOKIE   a cn_session=... cookie, instead of the pair
//
// Targeting PRODUCTION is acceptable here, unlike run-eval.js, and the spec
// says why: /api/vault/extract WRITES NOTHING — it sends the file to the
// vendor and returns rows for a confirm table that never renders. The only
// side effects are the vendor bill (a few cents per file) and a PII-free
// vault_extract analytics event.
//
// What this cannot measure: correction time. That half of the pass condition
// is a person with a stopwatch fixing a 10-comp file's rows by hand; the
// scorecard leaves a blank for it rather than pretending.
//
// Summaries land in docs/evals/ (committed, timestamped in the filename so a
// rerun can never clobber a baseline — run-eval.js's rule); raw responses go
// to the git-ignored eval-runs/.

const fs = require("fs");
const path = require("path");
const SCORE = require("../extract-score");
const VAULT = require("../broker-vault");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const DIR = path.resolve(opt("--dir", "extract-eval"));
const URL_BASE = (process.env.EXTRACT_EVAL_URL || "http://localhost:3000").replace(/\/+$/, "");
const TRUTH_PATH = path.join(DIR, "truth.json");
const EXTS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);

function listFiles() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => EXTS.has(path.extname(f).toLowerCase())).sort();
}

// --init: one truth stub per file on disk, with the field vocabulary inline
// so the person keying it never has to open broker-vault.js to learn it.
if (flag("--init")) {
  fs.mkdirSync(DIR, { recursive: true });
  const files = listFiles();
  if (fs.existsSync(TRUTH_PATH) && !flag("--force")) {
    console.error(`${TRUTH_PATH} already exists — refusing to overwrite hand-keyed truth (use --force if you mean it).`);
    process.exit(1);
  }
  const stub = {
    "_how": "One entry per file. Key every deal FROM THE SOURCE DOCUMENT, never from a run's output. Omit a field the document does not state — an omitted truth field is how fabrication is caught. Dates YYYY-MM-DD; plain numbers (1250000, never 1.2M).",
    "_fields": VAULT.EXTRACT_KEYS.join(", "),
    "_types": VAULT.PROPERTY_TYPES.join(", "),
    files: files.map((file) => ({ file, deals: [
      { address: "", property_type: "", transaction: "", deal_date: "", price: "", size_sqft: "" },
    ] })),
  };
  fs.writeFileSync(TRUTH_PATH, JSON.stringify(stub, null, 2) + "\n");
  console.log(`Wrote ${TRUTH_PATH} with stubs for ${files.length} file(s). Key the deals, then rerun with --yes.`);
  process.exit(0);
}

function loadTruth() {
  if (!fs.existsSync(TRUTH_PATH)) {
    console.error(`No ${TRUTH_PATH}. Put the files in ${DIR}/ and run --init first.`);
    process.exit(1);
  }
  const t = JSON.parse(fs.readFileSync(TRUTH_PATH, "utf8"));
  const entries = Array.isArray(t.files) ? t.files : [];
  const bad = entries.filter((e) => !e.file || !Array.isArray(e.deals) ||
    e.deals.some((d) => !String(d.address || "").trim()));
  if (bad.length) {
    console.error(`truth.json has ${bad.length} entr(ies) with no file name or a deal missing its address — every deal needs one; it is the match key.`);
    process.exit(1);
  }
  return entries;
}

async function signIn() {
  if (process.env.EXTRACT_EVAL_COOKIE) return process.env.EXTRACT_EVAL_COOKIE;
  const email = process.env.EXTRACT_EVAL_EMAIL, password = process.env.EXTRACT_EVAL_PASSWORD;
  if (!email || !password) {
    console.error("Set EXTRACT_EVAL_EMAIL + EXTRACT_EVAL_PASSWORD (or EXTRACT_EVAL_COOKIE). The account needs vault access — the route answers 403 without it.");
    process.exit(1);
  }
  const r = await fetch(URL_BASE + "/api/account/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    console.error(`Sign-in to ${URL_BASE} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const cookie = (r.headers.get("set-cookie") || "").match(/cn_session=[^;]+/);
  if (!cookie) { console.error("Sign-in returned no cn_session cookie."); process.exit(1); }
  return cookie[0];
}

// The route is rate-limited per IP at 8 calls per rolling 5 minutes — and
// server.js's rateLimited() APPENDS A HIT EVEN WHEN IT REFUSES, so retrying
// into a 429 slides the window forward and digs the hole deeper. The fix is
// to never trip it: keep our own record of what we sent and wait until there
// is room. PACE_MAX is 7, not 8, so a browser tab left open on /vault does
// not collide with the run.
const PACE_MAX = Number(opt("--pace", "7"));
const PACE_WINDOW_MS = 5 * 60 * 1000;
const sentAt = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForSlot() {
  for (;;) {
    const now = Date.now();
    while (sentAt.length && now - sentAt[0] >= PACE_WINDOW_MS) sentAt.shift();
    if (sentAt.length < PACE_MAX) return;
    const waitMs = PACE_WINDOW_MS - (now - sentAt[0]) + 500;
    console.log(`  pacing: ${Math.ceil(waitMs / 1000)}s until the rate-limit window opens`);
    await sleep(waitMs);
  }
}

// Why a failure taxonomy instead of "no rows": the scorecard's recall,
// precision and fabrication rate decide whether the Archive gets built, and
// scoring an infrastructure failure as an empty extraction reports 0% recall
// for a file the model was never shown. Only `no_table` is a real answer
// about extraction quality — the model read the file and found nothing — and
// only that is scored. Everything else is excluded and named.
function classifyFailure(status, error) {
  const msg = String(error || "");
  if (status === 429) return "rate_limited";
  if (status >= 500 || status === 0) return "unavailable";
  if (status === 400) {
    // checkExtractFile's three refusals: the file never reached the model, so
    // this is a fixture problem, not a measurement.
    if (/can't be read yet|isn't something we can read|too large to read/i.test(msg)) return "file_refused";
    // Anything else at 400 is the extractor having read it and produced
    // nothing usable — a real, scoreable miss.
    return "no_table";
  }
  return "unavailable";
}

async function extractOne(cookie, file) {
  const bytes = fs.readFileSync(path.join(DIR, file));
  const body = JSON.stringify({ filename: file, file: bytes.toString("base64") });
  await waitForSlot();
  sentAt.push(Date.now());
  let r;
  try {
    r = await fetch(URL_BASE + "/api/vault/extract", {
      method: "POST", headers: { "content-type": "application/json", cookie }, body,
    });
  } catch (err) {
    return { kind: "unavailable", detail: err.message };
  }
  const json = await r.json().catch(() => ({}));
  if (r.ok) return { rows: Array.isArray(json.rows) ? json.rows : [] };
  const kind = classifyFailure(r.status, json.error);
  // A real empty extraction IS the answer, so it is scored as zero rows and
  // counts against recall exactly as it should.
  if (kind === "no_table") return { rows: [], emptyReason: json.error || "no deals table found" };
  return { kind, detail: `${r.status}: ${json.error || "request failed"}` };
}

const pct = (x) => (x == null ? "n/a" : (100 * x).toFixed(1) + "%");

(async () => {
  let truth = loadTruth();
  const onDisk = new Set(listFiles());
  const missing = truth.filter((e) => !onDisk.has(e.file));
  if (missing.length) {
    console.error(`truth.json names file(s) not in ${DIR}/: ${missing.map((e) => e.file).join(", ")}`);
    process.exit(1);
  }
  // Spend two files' worth before twenty: --limit proves the whole pipeline
  // (sign-in, pacing, scoring, the scorecard) for a few cents.
  const lim = Number(opt("--limit", "0"));
  if (lim > 0) truth = truth.slice(0, lim);
  const totalDeals = truth.reduce((n, e) => n + e.deals.length, 0);
  console.log(`Extraction test: ${truth.length} file(s), ${totalDeals} hand-keyed deal(s), against ${URL_BASE}`);
  console.log(`Each file is one billed vendor call (a few cents; nothing is stored server-side).`);
  // Say the wall clock before the run, not during it: most of it is this
  // script deliberately WAITING so it never trips the route's 8-per-5-minutes
  // limiter (which counts refused calls too, so tripping it costs more than
  // pausing). A run that looks hung is a run somebody kills.
  const paceWaitMin = Math.max(0, Math.ceil((truth.length - PACE_MAX) / PACE_MAX) * 5);
  console.log(`Expect roughly ${Math.ceil(truth.length * 0.25) + paceWaitMin} min: ~15s per file plus about ` +
    `${paceWaitMin} min of pacing, so the rate limiter is never tripped. Pauses are normal.`);
  if (!flag("--yes")) {
    console.log(`\nDry run — nothing spent. Rerun with --yes to run it.`);
    process.exit(0);
  }

  const cookie = await signIn();
  const perFile = [];
  const excluded = [];
  const raw = [];
  for (const entry of truth) {
    process.stdout.write(`  ${entry.file} … `);
    const started = Date.now();
    const res = await extractOne(cookie, entry.file);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (res.kind) {
      // EXCLUDED, never scored. See classifyFailure: counting an
      // infrastructure failure as an empty extraction would report 0% recall
      // for a file the model never saw, on the number that decides the block.
      console.log(`EXCLUDED (${res.kind}: ${res.detail})`);
      excluded.push({ file: entry.file, kind: res.kind, detail: res.detail, deals: entry.deals.length });
      raw.push({ file: entry.file, excluded: res });
      continue;
    }
    if (res.emptyReason) console.log(`no deals found (${res.emptyReason}) — scored as a miss`);
    const score = SCORE.scoreFile(res.rows, entry.deals);
    if (!res.emptyReason) console.log(`${res.rows.length} row(s) in ${secs}s · matched ${score.matched}/${score.truthDeals}` +
      (score.fabricatedRows.length ? ` · ${score.fabricatedRows.length} FABRICATED ROW(S)` : "") +
      (score.refusals.length ? ` · ${score.refusals.length} refused` : ""));
    raw.push({ file: entry.file, rows: res.rows });
    perFile.push({ file: entry.file, score });
  }

  const t = SCORE.summarize(perFile.map((p) => p.score));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  fs.mkdirSync("eval-runs", { recursive: true });
  fs.writeFileSync(path.join("eval-runs", `extract-${stamp}.json`),
    JSON.stringify({ url: URL_BASE, perFile, totals: t, raw }, null, 2));

  const lines = [];
  lines.push(`# Extraction test — ${stamp}`);
  lines.push("");
  lines.push(`Target ${URL_BASE} · **${t.files} of ${truth.length} files scored** · ${t.truthDeals} hand-keyed deals`);
  if (excluded.length) {
    lines.push("");
    lines.push(`> ⚠ ${excluded.length} file(s) were EXCLUDED and are not in any figure below. ` +
      `An infrastructure failure is not an extraction result; see "Excluded files".`);
  }
  lines.push("");
  lines.push(`| Measure | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Recall (deals found) | ${pct(t.recall)} (${t.matched}/${t.truthDeals}) |`);
  lines.push(`| Field precision | ${pct(t.fieldPrecision)} (${t.fieldsCorrect}/${t.fieldsCompared}) |`);
  lines.push(`| **Fabrication rate** | **${pct(t.fabricationRate)}** (${t.fieldsFabricated} field(s) + ${t.fabricatedRowCount} row(s)) |`);
  lines.push(`| Omitted fields | ${t.fieldsOmitted} |`);
  lines.push(`| Refused rows | ${t.refusalCount} |`);
  lines.push("");
  lines.push(`## Per field`);
  lines.push(`| Field | Correct | Compared | Fabricated | Omitted |`);
  lines.push(`|---|---|---|---|---|`);
  for (const [f, c] of Object.entries(t.perField).sort()) {
    lines.push(`| ${f} | ${c.correct} | ${c.compared} | ${c.fabricated} | ${c.omitted} |`);
  }
  lines.push("");
  const itemize = (title, rows) => {
    if (!rows.length) return;
    lines.push(`## ${title}`);
    for (const r of rows) lines.push(`- ${r}`);
    lines.push("");
  };
  itemize("Missed deals", perFile.flatMap((p) => p.score.missed.map((a) => `${p.file}: ${a}`)));
  itemize("Fabricated rows", perFile.flatMap((p) => p.score.fabricatedRows.map((a) => `${p.file}: ${a}`)));
  itemize("Fabricated fields", perFile.flatMap((p) => p.score.fabricatedFields.map((x) => `${p.file}: ${x.address} · ${x.field} = ${JSON.stringify(x.value)}`)));
  itemize("Wrong values", perFile.flatMap((p) => p.score.wrong.map((x) => `${p.file}: ${x.address} · ${x.field}: got ${JSON.stringify(x.got)}, source says ${JSON.stringify(x.want)}`)));
  itemize("Refusals (sort by hand: bad data vs good value the parser could not read)",
    perFile.flatMap((p) => p.score.refusals.map((x) => `${p.file}: ${x.address} — ${x.error}`)));
  itemize("Excluded files (NOT scored — rerun these before trusting the verdict)",
    excluded.map((e) => `${e.file}: ${e.kind} — ${e.detail} (${e.deals} hand-keyed deal(s) not measured)`));
  lines.push(`## The other half, by hand`);
  lines.push(`- Correction time (a person, a stopwatch, per 10-comp file): ______`);
  lines.push(`- Verdict against spec §9's pass condition (<60s review, recall high enough not to re-read the PDF, fabrication ~zero): **PASS / FAIL** ______`);
  lines.push("");
  fs.mkdirSync(path.join("docs", "evals"), { recursive: true });
  const out = path.join("docs", "evals", `extract-${stamp}.md`);
  fs.writeFileSync(out, lines.join("\n"));

  console.log(`\nScored ${t.files} of ${truth.length} file(s)` + (excluded.length ? ` · ${excluded.length} EXCLUDED` : ""));
  console.log(`Recall ${pct(t.recall)} · field precision ${pct(t.fieldPrecision)} · FABRICATION ${pct(t.fabricationRate)} · ${t.refusalCount} refused`);
  console.log(`Scorecard: ${out}\nRaw responses: eval-runs/extract-${stamp}.json`);
  if (excluded.length) {
    console.log(`\n⚠ ${excluded.length} file(s) never reached the model (${[...new Set(excluded.map((e) => e.kind))].join(", ")}).`);
    console.log(`  The figures above cover only what ran. Fix and rerun before declaring a verdict.`);
    process.exitCode = 2;
  }
  if (t.fabricationRate != null && t.fabricationRate > 0) {
    console.log(`\n⚠ Fabrication above zero. Spec §9: fatal regardless of the other numbers — read the itemized list before any migration is written.`);
  }
})().catch((err) => { console.error("extraction-eval failed:", err.message); process.exit(1); });
