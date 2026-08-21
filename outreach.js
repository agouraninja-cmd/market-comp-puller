// ---------------------------------------------------------------------------
// Report-first outreach. Runs a real report on each of N buildings in one
// market, publishes a public share link for each, and writes a draft message
// per building for a human to read, edit and send.
//
// Why the report comes first: "sign up and try it" asks a stranger for work
// before they have seen anything. "Here is your building, tell me what is
// wrong with it" is answerable in one line, and an answer from somebody who
// knows the market is worth more than a signup.
//
// THIS SCRIPT NEVER SENDS ANYTHING. It has no mail path and takes no recipient
// addresses. Sending is a decision about real people and it stays with the
// person whose name is on the message. It writes text and stops.
//
// It also DOUBLE-DUTIES as the cache pre-warmer (--warm-only): running the
// search is what puts the report in `search_cache`, so the same buildings
// answer instantly for 30 days afterwards. That is the whole of the
// "pre-warm a shortlist" idea, and it is deliberately bounded to a list
// somebody is about to look at — the general monthly refresh was measured and
// rejected on 2026-08-13 (needs 69% monthly repeat, actual is 23%).
//
// Usage (nothing is billed without --confirm):
//   node outreach.js --market "Boise, ID" --type Industrial            # plan only
//   node outreach.js --market "Boise, ID" --type Industrial --confirm  # runs it
//   node outreach.js --market "Boise, ID" --type Industrial --limit 5 --confirm
//   node outreach.js --market "Boise, ID" --type Industrial --warm-only --confirm
//
// Environment:
//   OUTREACH_BASE   server to drive (default http://localhost:3000)
//   ADMIN_KEY       must match that server's, or reports come back gated
// ---------------------------------------------------------------------------

"use strict";

const fs = require("fs");
const path = require("path");
const VAULT = require("./broker-vault");
const DRAFT = require("./outreach-draft");

const BASE = (process.env.OUTREACH_BASE || "http://localhost:3000").replace(/\/+$/, "");
const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();
const SEEN_FILE = path.join(__dirname, "outreach-seen.json");
const DRAFTS_FILE = path.join(__dirname, "outreach-drafts.md");

// Reject an unrecognized flag BEFORE anything is read or spent, the same rule
// run-eval.js follows: a silently ignored typo there turned an intended $0.72
// plumbing check into a $4.30 run.
const KNOWN_FLAGS = ["--market", "--type", "--limit", "--from", "--warm-only", "--confirm"];
const args = process.argv.slice(2);
for (const a of args) {
  if (!a.startsWith("--")) continue;
  const name = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
  if (!KNOWN_FLAGS.includes(name)) {
    console.error(`Unrecognized argument: ${a}`);
    console.error("Usage: node outreach.js --market \"Boise, ID\" --type Industrial [--limit N] [--from NAME] [--warm-only] [--confirm]");
    process.exit(1);
  }
}
const flag = (name) => {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1] !== undefined && !String(args[i + 1]).startsWith("--") ? args[i + 1] : "";
  const eq = args.find((a) => a.startsWith(name + "="));
  return eq !== undefined ? eq.slice(name.length + 1) : null;
};

const MARKET = (flag("--market") || "").trim();
const TYPE = (flag("--type") || "").trim();
const LIMIT = Math.max(1, Number(flag("--limit") || 20) || 20);
const FROM = (flag("--from") || "").trim();
const WARM_ONLY = args.includes("--warm-only");
const CONFIRM = args.includes("--confirm");

if (!MARKET || !TYPE) {
  console.error("Both --market and --type are required. Market is the canonical form marketOf() writes, e.g. \"Boise, ID\".");
  process.exit(1);
}

// Measured cost per report, by provider (2026-08-10 pipeline validation for
// Gemini, 2026-08-03 for Anthropic). Used only to state the bill up front.
// The Gemini figure is recomputed at Google's introductory per-token rate
// (search-provider-gemini.js's USD_PER_MTOK, in effect through 2026-12-31);
// the validation doc's original $0.092 used the standard rate that doesn't
// apply until 2027-01-01, so it overstated the real bill by ~2x.
const COST_PER_REPORT = { gemini: 0.045, anthropic: 0.36 };

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
}

async function health() {
  try {
    const r = await fetch(`${BASE}/healthz`);
    return r.ok ? await r.json() : {};
  } catch (e) { return {}; }
}

// The corpus, read through the server's own admin CSV rather than the
// database, so this script needs no Supabase credentials and cannot write.
async function loadCorpus() {
  const r = await fetch(`${BASE}/api/comp-corpus`, {
    headers: ADMIN_KEY ? { "x-admin-key": ADMIN_KEY } : {},
  });
  if (!r.ok) {
    throw new Error(`Corpus read failed (HTTP ${r.status}). ADMIN_KEY must match the server's.`);
  }
  const rows = VAULT.parseCsv(await r.text());
  const header = (rows[0] || []).map((h) => String(h).trim());
  return rows.slice(1).filter((row) => row.length > 1).map((row) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

async function runReport(address, type) {
  const r = await fetch(`${BASE}/api/comps`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Same reason gen-market-seed.js sends it: without the key the comp gate
      // truncates this to the free tier, and a message would go out pointing
      // at a report thinner than the one described in it.
      ...(ADMIN_KEY ? { "x-admin-key": ADMIN_KEY } : {}),
    },
    body: JSON.stringify({ address, type, note: "", months: 24, maxComps: 8, txFocus: "both" }),
  });
  if (!r.ok) throw new Error(`report HTTP ${r.status}`);
  const data = await r.json();
  if (Number(data.locked_count) > 0) {
    throw new Error(`report came back gated (${data.locked_count} locked) — ADMIN_KEY does not match the server's`);
  }
  return data;
}

async function publishShare(data, meta) {
  const r = await fetch(`${BASE}/api/share`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Public, deliberately: an invited share needs the recipient's email
    // address, and this script does not take one. A public link is also the
    // only kind the account wall lets a stranger open.
    body: JSON.stringify({ data, meta, visibility: "public" }),
  });
  if (!r.ok) throw new Error(`share HTTP ${r.status}`);
  return r.json();
}

(async () => {
  const [hz, corpus] = await Promise.all([health(), loadCorpus()]);
  const provider = String(hz.provider || "gemini").toLowerCase();
  const seen = readJson(SEEN_FILE, []);
  const targets = DRAFT.selectTargets(corpus, { market: MARKET, type: TYPE, limit: LIMIT, seen });

  console.log(`Server:   ${BASE} (provider ${hz.provider || "?"}, model ${hz.model || "?"})`);
  console.log(`Corpus:   ${corpus.length} rows`);
  console.log(`Market:   ${MARKET} · ${TYPE}`);
  console.log(`Already contacted: ${seen.length}`);
  console.log(`Targets:  ${targets.length}${targets.length === LIMIT ? " (capped by --limit)" : ""}`);
  for (const t of targets) console.log(`  ${t.deal_date || "?".padEnd(10)}  ${t.address}`);

  const per = COST_PER_REPORT[provider] || COST_PER_REPORT.gemini;
  const est = (targets.length * per).toFixed(2);
  console.log(`\nEach address is one billed search, about $${per.toFixed(3)} on ${provider}. Estimated: $${est}.`);
  console.log(`Cached addresses cost nothing and answer immediately.`);

  if (!targets.length) return;
  if (!CONFIRM) {
    console.log(`\nNothing run. Add --confirm to spend it.`);
    return;
  }

  const drafts = [];
  const contacted = [];
  for (const [i, t] of targets.entries()) {
    const label = `[${i + 1}/${targets.length}] ${t.address}`;
    try {
      const started = Date.now();
      const data = await runReport(t.address, TYPE);
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      if (WARM_ONLY) {
        console.log(`${label} — warmed in ${secs}s (${(data.comps || []).length} comps)`);
        continue;
      }
      const meta = { address: t.address, type: TYPE, subject: {} };
      const share = await publishShare(data, meta);
      const city = String(MARKET).split(",")[0].trim();
      const mail = DRAFT.renderEmail({ address: t.address, city, type: TYPE, url: share.url, report: data, from: FROM });
      drafts.push(`## ${t.address}\n\n**Subject:** ${mail.subject}\n\n\`\`\`\n${mail.body}\n\`\`\`\n`);
      contacted.push(DRAFT.addressKeyOf(t.address));
      console.log(`${label} — ${(data.comps || []).length} comps in ${secs}s, ${share.url}`);
    } catch (err) {
      // One bad address must not cost the rest of the run. It is skipped and
      // NOT recorded as contacted, so the next run tries it again.
      console.error(`${label} — SKIPPED: ${err.message}`);
    }
  }

  if (WARM_ONLY) {
    console.log(`\nWarmed ${targets.length} addresses. They answer from cache for 30 days.`);
    return;
  }

  if (drafts.length) {
    const header = `# Outreach drafts · ${MARKET} · ${TYPE} · ${new Date().toISOString().slice(0, 10)}\n\n` +
      `Nothing here has been sent. Read every one before you do.\n\n`;
    fs.writeFileSync(DRAFTS_FILE, header + drafts.join("\n"), "utf8");
    // Recorded only for addresses that actually produced a draft, so a run
    // that half-failed does not quietly retire the buildings it never reached.
    fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen, ...contacted], null, 2) + "\n", "utf8");
    console.log(`\n${drafts.length} draft(s) written to ${path.basename(DRAFTS_FILE)}. Nothing was sent.`);
    console.log(`${path.basename(SEEN_FILE)} updated, so a re-run skips these buildings.`);
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
