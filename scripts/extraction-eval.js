#!/usr/bin/env node
// The extraction test, as one command — sequence step 1 of the Business Model
// Transition Plan, and the gate on the whole Archive block (spec §9 in
// docs/superpowers/specs/2026-08-21-archive-email-ingestion-design.md).
//
//   node scripts/extraction-eval.js                 # dry run: lists the plan, spends nothing
//   node scripts/extraction-eval.js --yes           # the real run
//   node scripts/extraction-eval.js --init          # writes extract-eval/truth.json to fill in
//   node scripts/extraction-eval.js --dir other/    # a different eval folder
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

async function extractOne(cookie, file) {
  const bytes = fs.readFileSync(path.join(DIR, file));
  const body = JSON.stringify({ filename: file, file: bytes.toString("base64") });
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(URL_BASE + "/api/vault/extract", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body,
    });
    if (r.status === 429 && attempt <= 5) {
      // The route is rate-limited per IP (8 per 5-minute window); a 20-file
      // run legitimately trips it. Waiting is correct, not a failure.
      const wait = 45 * attempt;
      console.log(`  rate-limited — waiting ${wait}s (attempt ${attempt}/5)`);
      await new Promise((res) => setTimeout(res, wait * 1000));
      continue;
    }
    const json = await r.json().catch(() => ({}));
    if (!r.ok) return { failed: `${r.status}: ${json.error || "request failed"}` };
    return { rows: Array.isArray(json.rows) ? json.rows : [] };
  }
}

const pct = (x) => (x == null ? "n/a" : (100 * x).toFixed(1) + "%");

(async () => {
  const truth = loadTruth();
  const onDisk = new Set(listFiles());
  const missing = truth.filter((e) => !onDisk.has(e.file));
  if (missing.length) {
    console.error(`truth.json names file(s) not in ${DIR}/: ${missing.map((e) => e.file).join(", ")}`);
    process.exit(1);
  }
  const totalDeals = truth.reduce((n, e) => n + e.deals.length, 0);
  console.log(`Extraction test: ${truth.length} file(s), ${totalDeals} hand-keyed deal(s), against ${URL_BASE}`);
  console.log(`Each file is one billed vendor call (a few cents; nothing is stored server-side).`);
  if (!flag("--yes")) {
    console.log(`\nDry run — nothing spent. Rerun with --yes to run it.`);
    process.exit(0);
  }

  const cookie = await signIn();
  const perFile = [];
  const raw = [];
  for (const entry of truth) {
    process.stdout.write(`  ${entry.file} … `);
    const started = Date.now();
    const res = await extractOne(cookie, entry.file);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (res.failed) {
      console.log(`FAILED (${res.failed}) — scored as zero rows`);
      raw.push({ file: entry.file, failed: res.failed });
      perFile.push({ file: entry.file, failed: res.failed, score: SCORE.scoreFile([], entry.deals) });
      continue;
    }
    const score = SCORE.scoreFile(res.rows, entry.deals);
    console.log(`${res.rows.length} row(s) in ${secs}s · matched ${score.matched}/${score.truthDeals}` +
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
  lines.push(`Target ${URL_BASE} · ${t.files} files · ${t.truthDeals} hand-keyed deals`);
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
  itemize("Failed requests", perFile.filter((p) => p.failed).map((p) => `${p.file}: ${p.failed}`));
  lines.push(`## The other half, by hand`);
  lines.push(`- Correction time (a person, a stopwatch, per 10-comp file): ______`);
  lines.push(`- Verdict against spec §9's pass condition (<60s review, recall high enough not to re-read the PDF, fabrication ~zero): **PASS / FAIL** ______`);
  lines.push("");
  fs.mkdirSync(path.join("docs", "evals"), { recursive: true });
  const out = path.join("docs", "evals", `extract-${stamp}.md`);
  fs.writeFileSync(out, lines.join("\n"));

  console.log(`\nRecall ${pct(t.recall)} · field precision ${pct(t.fieldPrecision)} · FABRICATION ${pct(t.fabricationRate)} · ${t.refusalCount} refused`);
  console.log(`Scorecard: ${out}\nRaw responses: eval-runs/extract-${stamp}.json`);
  if (t.fabricationRate != null && t.fabricationRate > 0) {
    console.log(`\n⚠ Fabrication above zero. Spec §9: fatal regardless of the other numbers — read the itemized list before any migration is written.`);
  }
})().catch((err) => { console.error("extraction-eval failed:", err.message); process.exit(1); });
