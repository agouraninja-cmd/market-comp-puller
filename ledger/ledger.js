#!/usr/bin/env node
// ---------------------------------------------------------------------------
// CompNinja financial ledger — revenue in, money out, one Excel workbook.
//
//   node ledger/ledger.js                 # last 12 months -> CompNinja-Ledger.xlsx
//   node ledger/ledger.js --from 2026-01 --to 2026-08
//   node ledger/ledger.js --daily         # one Anthropic row per day, not per month
//   node ledger/ledger.js --out ~/Desktop/ledger.xlsx
//
// WHERE THE NUMBERS COME FROM
//
//   Money out (Anthropic)  Admin Usage & Cost API, GET /v1/organizations/cost_report.
//                          These are BILLED amounts — the same figures the Cost page
//                          in the Console shows, split into tokens vs web search.
//                          Needs ANTHROPIC_ADMIN_KEY (an sk-ant-admin01-... key, NOT
//                          the sk-ant-api03-... key the app runs on). If it is unset
//                          the script falls back to ESTIMATING from the app's own
//                          analytics — see estimateAnthropicCost() — and marks every
//                          such row "estimate" so a guess can never be mistaken for
//                          an invoice.
//
//   Money in (Stripe)      GET /v1/balance_transactions. Gross, fee and net are all
//                          on the same object, so the ledger gets both the revenue
//                          line and the processing-fee line from one call.
//
//   Everything else        ledger/recurring.csv (fixed monthly costs — Render,
//                          Supabase, the domain) and ledger/manual-entries.csv
//                          (one-offs). Both are plain CSV you edit by hand; nothing
//                          in this script ever rewrites them.
//
// SIGN CONVENTION: revenue is positive, costs are negative. Every subtotal in the
// workbook is therefore a plain SUM, and net profit is the sum of the whole column.
// A cost typed as a positive number in the CSVs is negated on the way in.
//
// Zero npm dependencies, like the rest of the repo.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { workbook, colLetter, S } = require("./xlsx");

const ROOT = path.join(__dirname, "..");

// --- tiny .env loader (same trick server.js uses) ---------------------------
(function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      let v = m[2].trim().replace(/^["']|["']$/g, "");
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch (_) { /* no .env is fine — hosts set real env vars */ }
})();

// --- categories -------------------------------------------------------------
// The Summary sheet SUMIFS against these exact strings, so they are the contract
// between the fetchers and the workbook. Add one here AND to SUMMARY_ROWS below,
// or the row will silently total zero.
const CAT = {
  SUBSCRIPTIONS: "Subscriptions",
  ONE_TIME: "One-time sales",
  REFUNDS: "Refunds",

  AI_TOKENS: "AI — tokens",
  AI_SEARCH: "AI — web search",
  AI_CODE: "AI — code execution",
  AI_SESSION: "AI — session usage",
  PAYMENT_FEES: "Payment processing",
  MAPS: "Maps / Street View",

  // Development AI spend is an OPERATING cost, not a cost of revenue. Four people
  // build CompNinja with Claude, and their tooling usage bills to the same
  // organization as the production server. Left in COGS it inflates cost-per-
  // search — the July figure read $1.55/search when the marginal cost of serving
  // one customer was nearer $0.67 — and cost-per-search is the number the whole
  // pricing model rests on. R&D does not scale with customers; serving does.
  AI_DEV: "AI — development",

  // LLC formation, the registered agent, state franchise fees, an accountant.
  // Filed under "Other" these vanish into a bucket that answers no question;
  // as their own line they answer "what does simply existing as a company cost
  // us", which is a figure with a different shape from infrastructure — mostly
  // annual, mostly unavoidable, and independent of traffic.
  LEGAL: "Legal & professional",

  HOSTING: "Hosting",
  DATABASE: "Database",
  EMAIL: "Email",
  DOMAIN: "Domain",
  OTHER: "Other",
};

const REVENUE_CATS = [CAT.SUBSCRIPTIONS, CAT.ONE_TIME, CAT.REFUNDS];
const COGS_CATS = [CAT.AI_TOKENS, CAT.AI_SEARCH, CAT.AI_CODE, CAT.AI_SESSION, CAT.PAYMENT_FEES, CAT.MAPS];
const OPEX_CATS = [CAT.AI_DEV, CAT.LEGAL, CAT.HOSTING, CAT.DATABASE, CAT.EMAIL, CAT.DOMAIN, CAT.OTHER];
const COST_CATS = new Set([...COGS_CATS, ...OPEX_CATS]);

// Published list prices, used ONLY by the estimate fallback and shown on the
// Rates sheet so an estimate is auditable. Verified against platform.claude.com
// on 2026-08-03; re-check before trusting a big estimate.
const RATES = {
  model: "claude-sonnet-4-6",
  inputPerMTok: 3.00,
  outputPerMTok: 15.00,
  cacheWriteMultiplier: 1.25,
  cacheReadMultiplier: 0.10,
  webSearchPer1k: 10.00,        // $0.01 per search
};

// --- args -------------------------------------------------------------------
function parseArgs(argv) {
  const out = { daily: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--daily") out.daily = true;
    else if (a === "--from") out.from = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--export-csv") out.exportCsv = argv[++i] || true;
    else if (a === "--workspace") out.workspace = argv[++i];
    else if (a === "--list-workspaces") out.listWorkspaces = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

// --- month helpers ----------------------------------------------------------
const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

function monthRange(fromKey, toKey) {
  const [fy, fm] = fromKey.split("-").map(Number);
  const [ty, tm] = toKey.split("-").map(Number);
  const out = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

const monthStart = (key) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1));
const monthEnd = (key) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 1));

// ---------------------------------------------------------------------------
// Anthropic — billed cost via the Admin Usage & Cost API
// ---------------------------------------------------------------------------

// The cost endpoint only does 1d buckets and caps a page at ~31 of them, so one
// request per calendar month is both the natural chunk and the safe one.
async function fetchAnthropicCost(adminKey, months, { daily, workspace }) {
  const rows = [];
  const warnings = [];
  const seenWorkspaces = new Set();

  for (const mk of months) {
    const qs = new URLSearchParams({
      starting_at: monthStart(mk).toISOString(),
      ending_at: monthEnd(mk).toISOString(),
      bucket_width: "1d",
      limit: "31",
    });
    // group_by[]=description is what splits tokens from web search and names
    // the model; without it every day collapses to one opaque number.
    qs.append("group_by[]", "description");
    // workspace_id matters even when you don't filter on it. The cost report
    // covers the WHOLE organization, so if CompNinja shares an org with other
    // projects their spend lands in this ledger unnoticed. Grouping lets the
    // caller both scope to one workspace and detect when scoping is needed.
    qs.append("group_by[]", "workspace_id");

    let page = null;
    let guard = 0;
    do {
      const url = `https://api.anthropic.com/v1/organizations/cost_report?${qs}${page ? `&page=${encodeURIComponent(page)}` : ""}`;
      let r;
      try {
        r = await fetch(url, {
          headers: {
            "anthropic-version": "2023-06-01",
            "x-api-key": adminKey,
            "user-agent": "CompNinja-Ledger/1.0",
          },
        });
      } catch (e) {
        warnings.push(`Anthropic cost fetch failed for ${mk}: ${e.message}`);
        break;
      }

      const text = await r.text();
      if (!r.ok) {
        let msg = text.slice(0, 300);
        try { msg = JSON.parse(text).error.message; } catch (_) {}
        warnings.push(`Anthropic cost API ${r.status} for ${mk}: ${msg}`);
        // A 401/403 will fail identically for every other month — stop asking.
        if (r.status === 401 || r.status === 403 || r.status === 404) return { rows, warnings, fatal: true };
        break;
      }

      let body;
      try { body = JSON.parse(text); } catch (e) {
        warnings.push(`Anthropic cost API returned non-JSON for ${mk}`);
        break;
      }

      for (const bucket of body.data || []) {
        const day = new Date(bucket.starting_at);
        for (const res of bucket.results || []) {
          // amount is a decimal string in the lowest currency unit (cents).
          const usd = Number(res.amount) / 100;
          if (!Number.isFinite(usd) || usd === 0) continue;
          // null workspace_id means the org's default workspace.
          const ws = res.workspace_id || "default";
          seenWorkspaces.add(ws);
          if (workspace && ws !== workspace) continue;
          rows.push({
            date: day,
            month: monthKey(day),
            category: categoryForCostType(res.cost_type),
            vendor: "Anthropic",
            description: res.description || labelForCostType(res.cost_type, res),
            model: res.model || "",
            workspace: ws,
            amount: -Math.abs(usd),
            source: "anthropic-cost-api",
          });
        }
      }

      page = body.has_more ? body.next_page : null;
    } while (page && ++guard < 50);
  }

  // Shared-org guard. Costs from another project are indistinguishable from your
  // own once they are summed, so refuse to be quiet about it.
  if (!workspace && seenWorkspaces.size > 1) {
    warnings.push(
      `This organization has billed API costs across ${seenWorkspaces.size} workspaces ` +
      `(${[...seenWorkspaces].join(", ")}), and ALL of them are included above. If CompNinja is ` +
      "only one of them, this ledger is overstating its cost — re-run with --workspace <id> to " +
      "scope it. Use --list-workspaces to see the names."
    );
  }
  if (workspace && !seenWorkspaces.has(workspace)) {
    warnings.push(
      `--workspace ${workspace} matched no costs. Check the id with --list-workspaces; ` +
      "the ledger's Anthropic cost is $0 as a result."
    );
  }

  return { rows: daily ? rows : rollUpMonthly(rows), warnings, fatal: false, workspaces: seenWorkspaces };
}

// Names for the workspace ids the cost report returns, so --workspace takes a
// value you can actually recognize rather than a wrkspc_01… blob.
async function listWorkspaces(adminKey) {
  const r = await fetch("https://api.anthropic.com/v1/organizations/workspaces?limit=100", {
    headers: { "anthropic-version": "2023-06-01", "x-api-key": adminKey },
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 200);
    try { msg = JSON.parse(text).error.message; } catch (_) {}
    throw new Error(`Workspace list failed (${r.status}): ${msg}`);
  }
  return JSON.parse(text).data || [];
}

function categoryForCostType(t) {
  switch (t) {
    case "web_search": return CAT.AI_SEARCH;
    case "code_execution": return CAT.AI_CODE;
    case "session_usage": return CAT.AI_SESSION;
    case "tokens":
    default: return CAT.AI_TOKENS;
  }
}

function labelForCostType(t, res) {
  const bits = [t || "tokens"];
  if (res.model) bits.push(res.model);
  if (res.token_type) bits.push(res.token_type);
  return bits.join(" · ");
}

// One row per month per (category, model) instead of per day. A year of daily
// token rows is ~1,500 lines of noise; the Summary sheet totals identically
// either way, so daily detail is opt-in via --daily.
function rollUpMonthly(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.month}|${r.category}|${r.model}|${r.workspace || ""}`;
    const prev = byKey.get(k);
    if (prev) { prev.amount += r.amount; prev.lines++; continue; }
    byKey.set(k, {
      ...r,
      date: monthStart(r.month),
      description: r.model ? `${r.category} · ${r.model}` : r.category,
      lines: 1,
    });
  }
  return [...byKey.values()].map((r) => ({ ...r, amount: round2(r.amount) }));
}

// ---------------------------------------------------------------------------
// Anthropic — the fallback when there is no Admin API key
//
// The Admin API is not available to individual (non-organization) Anthropic
// accounts, so this path is not hypothetical. It reuses the same assumption
// /admin already shows on its cost tiles (COST_REPORT_SEARCH, default $0.75 per
// billed search) applied to the billed, non-cached searches in analytics_events.
// It is an ESTIMATE and every row it produces says so.
// ---------------------------------------------------------------------------
async function estimateAnthropicCost(months, reason, alreadyCosted = new Set()) {
  const warnings = [];
  const perSearch = Number(process.env.COST_REPORT_SEARCH) > 0 ? Number(process.env.COST_REPORT_SEARCH) : 0.75;
  const events = await readAnalyticsEvents(warnings);

  const billed = new Map();
  for (const e of events) {
    if (e.kind !== "search" || e.cached) continue;
    const mk = String(e.ts || "").slice(0, 7);
    if (!months.includes(mk)) continue;
    billed.set(mk, (billed.get(mk) || 0) + 1);
  }

  // Never estimate a month you already typed a real Anthropic figure into. Both
  // rows would land in the same SUMIFS and the month would be billed twice —
  // and reading the Console total into manual-entries.csv is the documented
  // workflow when there's no Admin key, so this collision is the normal case,
  // not an edge one.
  const rows = [];
  const skipped = [];
  for (const mk of months) {
    const n = billed.get(mk) || 0;
    if (!n) continue;
    if (alreadyCosted.has(mk)) { skipped.push(mk); continue; }
    rows.push({
      date: monthStart(mk),
      month: mk,
      category: CAT.AI_TOKENS,
      vendor: "Anthropic",
      description: `ESTIMATE · ${n} billed searches × $${perSearch.toFixed(2)}`,
      model: RATES.model,
      qty: n,
      amount: -round2(n * perSearch),
      source: "estimate",
    });
  }

  // The reason is passed in rather than assumed: "not set" and "set but rejected"
  // send you to completely different fixes, and reporting the wrong one costs an
  // afternoon.
  warnings.push(
    `${reason}, so Anthropic cost is ESTIMATED from analytics ` +
    `($${perSearch.toFixed(2)}/billed search) rather than read from your invoice. See ledger/README.md.`
  );
  if (skipped.length) {
    warnings.push(
      `Skipped estimating ${skipped.join(", ")} — those months already have an Anthropic cost ` +
      "entered by hand, which is the better number. No double counting."
    );
  }
  return { rows, warnings };
}

// Analytics lives in Supabase when configured and in analytics.jsonl otherwise;
// read whichever is available, preferring the durable one.
async function readAnalyticsEvents(warnings) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (url && key) {
    try {
      const r = await fetch(`${url}/rest/v1/analytics_events?select=ts,kind,cached&order=ts.asc&limit=100000`, {
        headers: { apikey: key, authorization: `Bearer ${key}` },
      });
      if (r.ok) return await r.json();
      warnings.push(`Supabase analytics read failed (${r.status}); falling back to analytics.jsonl`);
    } catch (e) {
      warnings.push(`Supabase analytics read failed (${e.message}); falling back to analytics.jsonl`);
    }
  }
  try {
    return fs.readFileSync(path.join(ROOT, "analytics.jsonl"), "utf8")
      .split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(Boolean);
  } catch (_) {
    warnings.push("No analytics source available — Anthropic cost could not even be estimated.");
    return [];
  }
}

// Search volume, for the unit-economics rows. Always worth having even when the
// billed numbers come from the Cost API: cost per search needs a denominator.
async function fetchVolume(months) {
  const warnings = [];
  const events = await readAnalyticsEvents(warnings);
  const vol = new Map(months.map((m) => [m, { billed: 0, cached: 0, leads: 0 }]));
  for (const e of events) {
    const mk = String(e.ts || "").slice(0, 7);
    const v = vol.get(mk);
    if (!v) continue;
    if (e.kind === "search") (e.cached ? v.cached++ : v.billed++);
    else if (e.kind === "lead") v.leads++;
  }
  return vol;
}

// ---------------------------------------------------------------------------
// Stripe — revenue in
// ---------------------------------------------------------------------------
async function fetchStripe(secretKey, months) {
  const rows = [];
  const warnings = [];
  const testMode = secretKey.startsWith("sk_test_");
  if (testMode) {
    warnings.push(
      "STRIPE_SECRET_KEY is a TEST-mode key. Its charges are not real money — they are " +
      "included but tagged \"stripe-test\" so you can filter them out on the Transactions sheet."
    );
  }

  const gte = Math.floor(monthStart(months[0]).getTime() / 1000);
  const lte = Math.floor(monthEnd(months[months.length - 1]).getTime() / 1000);

  let startingAfter = null;
  let guard = 0;
  do {
    const qs = new URLSearchParams({ limit: "100", "created[gte]": String(gte), "created[lte]": String(lte) });
    if (startingAfter) qs.set("starting_after", startingAfter);

    let r;
    try {
      r = await fetch(`https://api.stripe.com/v1/balance_transactions?${qs}`, {
        headers: { authorization: `Bearer ${secretKey}` },
      });
    } catch (e) {
      warnings.push(`Stripe fetch failed: ${e.message}`);
      break;
    }

    const text = await r.text();
    if (!r.ok) {
      let msg = text.slice(0, 300);
      try { msg = JSON.parse(text).error.message; } catch (_) {}
      warnings.push(`Stripe API ${r.status}: ${msg}`);
      break;
    }

    const body = JSON.parse(text);
    for (const tx of body.data || []) {
      const d = new Date(tx.created * 1000);
      const mk = monthKey(d);
      const src = testMode ? "stripe-test" : "stripe";

      // A payout is cash moving from Stripe to the bank, not income or expense.
      // Counting it would double-count every charge it settles.
      if (tx.type === "payout" || tx.type === "payout_cancel" || tx.type === "payout_failure") continue;

      if (tx.type === "charge" || tx.type === "payment") {
        rows.push({
          date: d, month: mk, category: CAT.SUBSCRIPTIONS, vendor: "Stripe",
          description: tx.description || "Subscription payment",
          amount: round2(tx.amount / 100), source: src, ref: tx.id,
        });
        if (tx.fee) {
          rows.push({
            date: d, month: mk, category: CAT.PAYMENT_FEES, vendor: "Stripe",
            description: `Processing fee · ${tx.description || tx.id}`,
            amount: -round2(tx.fee / 100), source: src, ref: tx.id,
          });
        }
      } else if (tx.type === "refund" || tx.type === "payment_refund") {
        rows.push({
          date: d, month: mk, category: CAT.REFUNDS, vendor: "Stripe",
          description: tx.description || "Refund",
          amount: -Math.abs(round2(tx.amount / 100)), source: src, ref: tx.id,
        });
      } else if (tx.type === "stripe_fee" || tx.type === "application_fee") {
        rows.push({
          date: d, month: mk, category: CAT.PAYMENT_FEES, vendor: "Stripe",
          description: tx.description || "Stripe fee",
          amount: -Math.abs(round2(tx.amount / 100)), source: src, ref: tx.id,
        });
      } else {
        rows.push({
          date: d, month: mk, category: CAT.OTHER, vendor: "Stripe",
          description: `${tx.type} · ${tx.description || tx.id}`,
          amount: round2(tx.amount / 100), source: src, ref: tx.id,
        });
      }
    }

    startingAfter = body.has_more && body.data.length ? body.data[body.data.length - 1].id : null;
  } while (startingAfter && ++guard < 100);

  return { rows, warnings };
}

// ---------------------------------------------------------------------------
// The hand-maintained CSVs
// ---------------------------------------------------------------------------

function parseCsv(text) {
  // Excel writes a UTF-8 BOM when it saves a CSV. Left in place it becomes part
  // of the first header name, so `row.date` is undefined and every row silently
  // loses its date.
  const lines = String(text).replace(/^﻿/, "")
    .split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (!lines.length) return [];
  const head = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    const row = {};
    head.forEach((h, i) => { row[h] = (cells[i] || "").trim(); });
    return row;
  });
}

// Small but real CSV splitter — quoted fields with embedded commas are the whole
// reason not to just String.split(",") here (descriptions will have commas).
function splitCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * A date from a hand-edited CSV, in whatever shape the editor left it.
 *
 * Excel is the reason this is not just `new Date(iso)`. Open manual-entries.csv
 * in Excel, type a row, save, and it rewrites every date in the sheet's locale —
 * `2026-08-01` comes back as `8/1/26`. That is not an ISO date, so the row was
 * dropped silently and an expense you entered simply never appeared. Accept the
 * formats a spreadsheet actually produces, and return null (never a guess) when
 * the shape is genuinely unrecognizable so the caller can say so out loud.
 */
function parseEntryDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  // 2026-08-01
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return utcDate(+m[1], +m[2], +m[3]);

  // 8/1/2026 or 8/1/26 — US month-first, which is what Excel writes on a
  // US-locale machine. A day-first locale would need its own handling; there is
  // no way to tell 3/4/26 apart without knowing the locale, so this assumes the
  // US form rather than silently picking one.
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    let y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    return utcDate(y, +m[1], +m[2]);
  }
  return null;
}

function utcDate(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Rejects 2026-13-45 rather than letting Date roll it into another month.
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}

function readCsvFile(name) {
  try { return parseCsv(fs.readFileSync(path.join(__dirname, name), "utf8")); }
  catch (_) { return []; }
}

function readManualEntries(months, warnings = []) {
  const rows = [];
  const known = new Set([...REVENUE_CATS, ...COGS_CATS, ...OPEX_CATS]);
  let lineNo = 1;

  for (const r of readCsvFile("manual-entries.csv")) {
    lineNo++;
    const label = `manual-entries.csv row ${lineNo}${r.description ? ` ("${r.description}")` : ""}`;
    const amt = Number(String(r.amount).replace(/[$,]/g, ""));

    // Every skip below used to be a silent `continue`. A typo'd category or an
    // Excel-reformatted date meant the expense just never appeared in the ledger,
    // with nothing anywhere saying so — the worst failure a set of books can have.
    if (!Number.isFinite(amt)) { warnings.push(`SKIPPED ${label}: amount "${r.amount}" is not a number.`); continue; }
    if (amt === 0) continue;

    const d = parseEntryDate(r.date);
    if (!d) { warnings.push(`SKIPPED ${label}: date "${r.date}" is not a date the ledger recognizes (use 2026-08-01).`); continue; }

    const mk = monthKey(d);
    if (!months.includes(mk)) {
      warnings.push(`SKIPPED ${label}: ${mk} is outside the reporting window — widen it with --from ${mk}.`);
      continue;
    }
    const category = r.category || CAT.OTHER;
    if (!known.has(category)) {
      warnings.push(
        `SKIPPED ${label}: category "${category}" is not one the ledger knows, so it would total nowhere. ` +
        `Valid: ${[...known].join(", ")}.`
      );
      continue;
    }
    rows.push({
      date: d, month: mk, category, vendor: r.vendor || "",
      description: r.description || "",
      amount: signFor(category, amt),
      source: "manual", notes: r.notes || "",
    });
  }
  return rows;
}

// Fixed monthly costs expanded across the reporting window, so a $7/mo host is
// one line in recurring.csv rather than twelve in manual-entries.csv.
function readRecurring(months) {
  const rows = [];
  for (const r of readCsvFile("recurring.csv")) {
    const amt = Number(String(r.monthly_amount).replace(/[$,]/g, ""));
    if (!Number.isFinite(amt) || amt === 0) continue;
    const start = (r.start_month || months[0]).slice(0, 7);
    const end = (r.end_month || months[months.length - 1]).slice(0, 7);
    const category = r.category || CAT.OTHER;
    for (const mk of months) {
      if (mk < start || mk > end) continue;
      rows.push({
        date: monthStart(mk), month: mk, category, vendor: r.vendor || "",
        description: r.description || `${r.vendor || category} (monthly)`,
        amount: signFor(category, amt),
        source: "recurring", notes: r.notes || "",
      });
    }
  }
  return rows;
}

// A cost typed as "7" instead of "-7" is the single most likely CSV mistake, and
// it would quietly turn an expense into revenue. Force the sign by category.
function signFor(category, amount) {
  const a = round2(Math.abs(amount));
  if (COST_CATS.has(category)) return -a;
  if (category === CAT.REFUNDS) return -a;
  return round2(amount);
}

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------

function buildWorkbook({ txns, months, volume, warnings, mode }) {
  const T = "Transactions";
  const nMonths = months.length;
  // Summary: col A labels, then one column per month, then a Total column.
  const firstCol = 2;
  const totalCol = firstCol + nMonths;
  const cl = (i) => colLetter(i);

  // ---- Transactions ----
  const txHeader = ["Date", "Month", "In/Out", "Category", "Vendor", "Description", "Qty", "Amount (USD)", "Source", "Notes"];
  const txRows = [txHeader.map((h) => ({ t: "s", v: h, s: S.HEADER }))];
  const sorted = [...txns].sort((a, b) => a.date - b.date || a.category.localeCompare(b.category));
  for (const r of sorted) {
    txRows.push([
      { d: r.date, s: S.DATE },
      r.month,
      r.amount >= 0 ? "In" : "Out",
      r.category,
      r.vendor || "",
      r.description || "",
      r.qty ? { v: r.qty, s: S.INT } : "",
      { v: round2(r.amount), s: S.MONEY },
      r.source || "",
      r.notes || r.ref || (r.workspace ? `workspace: ${r.workspace}` : ""),
    ]);
  }
  // Blank rows so hand-typed additions land inside the SUMIFS range and the
  // autofilter without anyone having to extend a formula.
  const SPARE = 200;
  const lastTxRow = txRows.length + SPARE;
  for (let i = 0; i < SPARE; i++) txRows.push([]);

  const txnsSheet = {
    name: T,
    rows: txRows,
    cols: [11, 9, 7, 20, 12, 46, 8, 14, 18, 30],
    freeze: 1,
    filter: `A1:J${lastTxRow}`,
  };

  // ---- Summary ----
  // SUMIFS over Transactions: month match + category match. The range is bounded
  // at lastTxRow rather than written as $H:$H — a whole-column SUMIFS repeated
  // ~20 times per month column makes Excel scan a million rows per recalc. The
  // bound still covers the SPARE blank rows, so hand-typed additions are counted.
  const sumif = (mCol, cat) =>
    `SUMIFS(${T}!$H$2:$H$${lastTxRow},${T}!$B$2:$B$${lastTxRow},${mCol}$4,${T}!$D$2:$D$${lastTxRow},"${cat}")`;

  const rows = [];
  const push = (cells) => rows.push(cells);
  const rowOf = {};           // label -> 1-based sheet row, for later formulas
  const valOf = {};           // label -> [per-month values..., total]
  const blank = () => push([]);

  // Every figure is computed here as well as expressed as a formula. The formula
  // is what keeps the sheet live when someone types a new transaction; the value
  // is what makes it readable in Protected View, in Numbers, in a preview pane —
  // anywhere Excel has not been given permission to calculate.
  const sumOf = (month, cat) => round2(
    txns.filter((t) => t.month === month && t.category === cat)
        .reduce((a, t) => a + t.amount, 0)
  );

  push([{ t: "s", v: "CompNinja — Profit & Loss", s: S.TITLE }]);
  push([{ t: "s", v: `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${mode}`, s: S.MUTED }]);
  blank();

  // header row (row 4)
  push([
    { t: "s", v: "", s: S.HEADER },
    ...months.map((m) => ({ t: "s", v: m, s: S.HEADER })),
    { t: "s", v: "Total", s: S.HEADER },
  ]);

  const section = (title) => {
    push([{ t: "s", v: title, s: S.SUBHEAD }, ...months.map(() => ({ t: "s", v: "", s: S.SUBHEAD })), { t: "s", v: "", s: S.SUBHEAD }]);
  };

  // A category line: label + one SUMIFS per month + a row total.
  const catRow = (cat) => {
    const r = rows.length + 1;
    rowOf[cat] = r;
    const v = months.map((m) => sumOf(m, cat));
    const tot = round2(v.reduce((a, b) => a + b, 0));
    valOf[cat] = [...v, tot];
    push([
      cat,
      ...months.map((_, i) => ({ f: sumif(cl(firstCol + i), cat), v: v[i], s: S.MONEY })),
      { f: `SUM(${cl(firstCol)}${r}:${cl(totalCol - 1)}${r})`, v: tot, s: S.MONEY_BOLD },
    ]);
  };

  // A subtotal line summing a contiguous block of rows above it.
  const subtotal = (label, fromRow, toRow, cats) => {
    const r = rows.length + 1;
    rowOf[label] = r;
    const v = months.map((_, i) => round2(cats.reduce((a, c) => a + valOf[c][i], 0)));
    const tot = round2(v.reduce((a, b) => a + b, 0));
    valOf[label] = [...v, tot];
    push([
      { t: "s", v: label, s: S.TOTAL },
      ...months.map((_, i) => ({ f: `SUM(${cl(firstCol + i)}${fromRow}:${cl(firstCol + i)}${toRow})`, v: v[i], s: S.MONEY_TOTAL })),
      { f: `SUM(${cl(firstCol)}${r}:${cl(totalCol - 1)}${r})`, v: tot, s: S.MONEY_TOTAL },
    ]);
    return r;
  };

  // A line that adds two named rows (e.g. gross profit = revenue + cogs).
  const derived = (label, aLabel, bLabel, style = S.MONEY_TOTAL) => {
    const r = rows.length + 1;
    rowOf[label] = r;
    const a = rowOf[aLabel], b = rowOf[bLabel];
    const v = months.map((_, i) => round2(valOf[aLabel][i] + valOf[bLabel][i]));
    const tot = round2(v.reduce((x, y) => x + y, 0));
    valOf[label] = [...v, tot];
    push([
      { t: "s", v: label, s: S.TOTAL },
      ...months.map((_, i) => ({ f: `${cl(firstCol + i)}${a}+${cl(firstCol + i)}${b}`, v: v[i], s: style })),
      { f: `SUM(${cl(firstCol)}${r}:${cl(totalCol - 1)}${r})`, v: tot, s: style },
    ]);
    return r;
  };

  section("REVENUE");
  const revStart = rows.length + 1;
  REVENUE_CATS.forEach(catRow);
  const revEnd = rows.length;
  const revRow = subtotal("Net revenue", revStart, revEnd, REVENUE_CATS);
  blank();

  section("COST OF REVENUE");
  const cogsStart = rows.length + 1;
  COGS_CATS.forEach(catRow);
  const cogsEnd = rows.length;
  const cogsRow = subtotal("Total cost of revenue", cogsStart, cogsEnd, COGS_CATS);
  blank();

  const gpRow = derived("Gross profit", "Net revenue", "Total cost of revenue");
  const gmRow = rows.length + 1;
  const gm = (i) => (valOf["Net revenue"][i] === 0 ? "" : round4(valOf["Gross profit"][i] / valOf["Net revenue"][i]));
  push([
    { t: "s", v: "Gross margin", s: S.BOLD },
    ...months.map((_, i) => ({
      f: `IF(${cl(firstCol + i)}${revRow}=0,"",${cl(firstCol + i)}${gpRow}/${cl(firstCol + i)}${revRow})`,
      v: gm(i), s: S.PERCENT,
    })),
    { f: `IF(${cl(totalCol)}${revRow}=0,"",${cl(totalCol)}${gpRow}/${cl(totalCol)}${revRow})`,
      v: gm(months.length), s: S.PERCENT },
  ]);
  blank();

  section("OPERATING COSTS");
  const opexStart = rows.length + 1;
  OPEX_CATS.forEach(catRow);
  const opexEnd = rows.length;
  const opexRow = subtotal("Total operating costs", opexStart, opexEnd, OPEX_CATS);
  blank();

  const netRow = derived("NET PROFIT / (LOSS)", "Gross profit", "Total operating costs", S.MONEY_TOTAL);
  const cumRow = rows.length + 1;
  let running = 0;
  const cum = months.map((_, i) => (running = round2(running + valOf["NET PROFIT / (LOSS)"][i])));
  push([
    { t: "s", v: "Cumulative", s: S.BOLD },
    ...months.map((_, i) => ({
      f: i === 0 ? `${cl(firstCol)}${netRow}` : `${cl(firstCol + i - 1)}${cumRow}+${cl(firstCol + i)}${netRow}`,
      v: cum[i], s: S.MONEY,
    })),
    "",
  ]);
  blank();

  section("VOLUME & UNIT ECONOMICS");
  const billed = months.map((m) => (volume.get(m) || {}).billed || 0);
  const cached = months.map((m) => (volume.get(m) || {}).cached || 0);
  const leads = months.map((m) => (volume.get(m) || {}).leads || 0);
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  const billedRow = rows.length + 1;
  push([
    "Billed searches",
    ...billed.map((n) => ({ v: n, s: S.INT })),
    { f: `SUM(${cl(firstCol)}${billedRow}:${cl(totalCol - 1)}${billedRow})`, v: sum(billed), s: S.INT },
  ]);
  const cachedRow = rows.length + 1;
  push([
    "Cached searches (free)",
    ...cached.map((n) => ({ v: n, s: S.INT })),
    { f: `SUM(${cl(firstCol)}${cachedRow}:${cl(totalCol - 1)}${cachedRow})`, v: sum(cached), s: S.INT },
  ]);
  const AI_COGS = [CAT.AI_TOKENS, CAT.AI_SEARCH, CAT.AI_CODE, CAT.AI_SESSION];
  const aiVals = months.map((_, i) => round2(AI_COGS.reduce((a, c) => a + valOf[c][i], 0)));
  const aiRow = rows.length + 1;
  push([
    // Production only — CAT.AI_DEV is deliberately absent, because dividing R&D
    // spend by customer searches does not produce a marginal cost.
    "Production AI cost (serving)",
    ...months.map((_, i) =>
      ({ f: `${cl(firstCol + i)}${rowOf[CAT.AI_TOKENS]}+${cl(firstCol + i)}${rowOf[CAT.AI_SEARCH]}+${cl(firstCol + i)}${rowOf[CAT.AI_CODE]}+${cl(firstCol + i)}${rowOf[CAT.AI_SESSION]}`,
        v: aiVals[i], s: S.MONEY })),
    { f: `SUM(${cl(firstCol)}${aiRow}:${cl(totalCol - 1)}${aiRow})`, v: round2(sum(aiVals)), s: S.MONEY },
  ]);
  const cps = (i) => (billed[i] ? round2(-aiVals[i] / billed[i]) : "");
  const cpsTotal = sum(billed) ? round2(-sum(aiVals) / sum(billed)) : "";
  const cpsRow = rows.length + 1;
  push([
    // BLENDED, not marginal. The organization has ~10 keys and production cannot
    // be isolated from the team's own tooling, so this divides ALL AI spend by
    // customer searches. It therefore runs HIGH — every hour the team spends
    // building lands in the numerator. Treat it as an upper bound on the true
    // cost of serving one search, never as the marginal cost to price against.
    "AI cost per billed search (blended)",
    ...months.map((_, i) => ({
      f: `IF(${cl(firstCol + i)}${billedRow}=0,"",-${cl(firstCol + i)}${aiRow}/${cl(firstCol + i)}${billedRow})`,
      v: cps(i), s: S.MONEY,
    })),
    { f: `IF(${cl(totalCol)}${billedRow}=0,"",-${cl(totalCol)}${aiRow}/${cl(totalCol)}${billedRow})`,
      v: cpsTotal, s: S.MONEY },
  ]);
  const leadsRow = rows.length + 1;
  push([
    "Leads captured",
    ...leads.map((n) => ({ v: n, s: S.INT })),
    { f: `SUM(${cl(firstCol)}${leadsRow}:${cl(totalCol - 1)}${leadsRow})`, v: sum(leads), s: S.INT },
  ]);
  blank();
  push([{ t: "s", v: "Break-even: searches you can serve per paying subscriber", s: S.BOLD }]);
  const beRow = rows.length + 1;
  push([
    "Searches funded by 1 mo of revenue",
    ...months.map((_, i) => ({
      f: `IF(OR(${cl(firstCol + i)}${cpsRow}="",${cl(firstCol + i)}${cpsRow}=0),"",${cl(firstCol + i)}${revRow}/${cl(firstCol + i)}${cpsRow})`,
      v: cps(i) ? Math.round(valOf["Net revenue"][i] / cps(i)) : "",
      s: S.INT,
    })),
    "",
  ]);
  void beRow;

  blank();
  push([{ t: "s", v: "Notes", s: S.BOLD }]);
  push([{ t: "s", v: "Cost per search is BLENDED: the organization's ~10 API keys cover both the production server and the team's own " +
    "development tooling, and they cannot be told apart on the Cost page. All AI spend is therefore divided by customer searches, " +
    "so the figure includes R&D and runs HIGH. It is an upper bound on the cost of serving a search, not the marginal cost.", s: S.MUTED }]);
  push([{ t: "s", v: "Costs are negative, revenue positive — every subtotal is a plain SUM.", s: S.MUTED }]);
  push([{ t: "s", v: "Every figure above is a live SUMIFS over the Transactions sheet. Type new rows there and this updates.", s: S.MUTED }]);
  for (const w of warnings) push([{ t: "s", v: `! ${w}`, s: S.MUTED }]);

  const summarySheet = {
    name: "Summary",
    rows,
    cols: [34, ...months.map(() => 13), 14],
    freeze: 4,
  };

  // ---- Rates ----
  const ratesRows = [
    [{ t: "s", v: "Rates & assumptions", s: S.TITLE }],
    [{ t: "s", v: "Anthropic list prices as published 2026-08-03. Used only by the estimate fallback; when the Admin Cost API is connected the ledger reads billed amounts and ignores these.", s: S.MUTED }],
    [],
    [{ t: "s", v: "Item", s: S.HEADER }, { t: "s", v: "Value", s: S.HEADER }, { t: "s", v: "Unit", s: S.HEADER }],
    ["Model in use", RATES.model, ""],
    ["Input tokens", { v: RATES.inputPerMTok, s: S.MONEY }, "per 1M tokens"],
    ["Output tokens", { v: RATES.outputPerMTok, s: S.MONEY }, "per 1M tokens"],
    ["Cache write", { v: RATES.cacheWriteMultiplier, s: S.DEFAULT }, "× input price"],
    ["Cache read", { v: RATES.cacheReadMultiplier, s: S.DEFAULT }, "× input price"],
    ["Web search", { v: RATES.webSearchPer1k, s: S.MONEY }, "per 1,000 searches"],
    ["Web search (each)", { v: RATES.webSearchPer1k / 1000, s: S.MONEY }, "per search"],
    [],
    [{ t: "s", v: "Estimate assumption", s: S.SUBHEAD }, { t: "s", v: "", s: S.SUBHEAD }, { t: "s", v: "", s: S.SUBHEAD }],
    ["COST_REPORT_SEARCH", { v: Number(process.env.COST_REPORT_SEARCH) > 0 ? Number(process.env.COST_REPORT_SEARCH) : 0.75, s: S.MONEY }, "assumed $ per billed comp search"],
    [{ t: "s", v: "This is the same constant /admin's cost tiles use. Once you have real invoices, tune it there and here together.", s: S.MUTED }],
    [],
    [{ t: "s", v: "Sanity check — what a 10-search report should cost", s: S.SUBHEAD }, { t: "s", v: "", s: S.SUBHEAD }, { t: "s", v: "", s: S.SUBHEAD }],
    ["Web search, 10 uses", { f: `10*B11`, s: S.MONEY }, "search fees only"],
    ["Tokens, ~40k in / ~5k out", { f: `40/1000*B6+5/1000*B7`, s: S.MONEY }, "approx, uncached"],
    [{ t: "s", v: "Total", s: S.TOTAL }, { f: `SUM(B18:B19)`, s: S.MONEY_TOTAL }, ""],
  ];

  const ratesSheet = { name: "Rates", rows: ratesRows, cols: [34, 16, 30] };

  return workbook([summarySheet, txnsSheet, ratesSheet]);
}

// ---------------------------------------------------------------------------

const HELP = `
CompNinja financial ledger

  node ledger/ledger.js [options]

  --from YYYY-MM      first month (default: 11 months before --to)
  --to   YYYY-MM      last month  (default: current month)
  --daily             one Anthropic row per day instead of per month
  --out  PATH         output file (default: ./CompNinja-Ledger.xlsx)
  --export-csv [PATH]  write a month-by-month AI cost table for pasting into
                      another spreadsheet (default: ./compninja-ai-costs.csv)
  --workspace ID      count only this Anthropic workspace's cost. Use this when
                      CompNinja shares an organization with other projects —
                      without it you get the WHOLE org's spend.
  --list-workspaces   print the organization's workspace ids and names, then exit

Environment (read from .env or the real environment):
  ANTHROPIC_ADMIN_KEY   sk-ant-admin01-... — billed Anthropic cost. Without it,
                        cost is ESTIMATED from analytics and labelled as such.
  STRIPE_SECRET_KEY     revenue + processing fees.
  SUPABASE_URL / SUPABASE_SERVICE_KEY   search volume (falls back to analytics.jsonl).
`;

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(HELP); return; }

  if (args.listWorkspaces) {
    const key = process.env.ANTHROPIC_ADMIN_KEY;
    if (!key) { console.error("--list-workspaces needs ANTHROPIC_ADMIN_KEY."); process.exitCode = 1; return; }
    const ws = await listWorkspaces(key);
    console.log("Workspaces in this organization:\n");
    console.log("  default".padEnd(34) + "(the org's default workspace)");
    for (const w of ws) console.log(`  ${String(w.id).padEnd(32)}${w.name}${w.archived_at ? " [archived]" : ""}`);
    console.log("\nScope the ledger with:  node ledger/ledger.js --workspace <id>");
    return;
  }

  const now = new Date();
  const toKey = args.to || monthKey(now);
  const fromKey = args.from || (() => {
    const d = monthStart(toKey);
    d.setUTCMonth(d.getUTCMonth() - 11);
    return monthKey(d);
  })();
  const months = monthRange(fromKey, toKey);
  if (!months.length) { console.error("Empty month range."); process.exitCode = 1; return; }

  console.log(`Ledger window: ${months[0]} → ${months[months.length - 1]} (${months.length} months)`);

  const txns = [];
  const warnings = [];
  let mode;

  // Hand-maintained rows are read FIRST so the estimator can see which months
  // already carry a real Anthropic figure and stay out of their way.
  const rec = readRecurring(months);
  const man = readManualEntries(months, warnings);
  const AI_CATS = new Set([CAT.AI_TOKENS, CAT.AI_SEARCH, CAT.AI_CODE, CAT.AI_SESSION]);
  const manuallyCosted = new Set(
    [...rec, ...man].filter((r) => AI_CATS.has(r.category)).map((r) => r.month)
  );

  // --- Anthropic ---
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  // Pasting the app key here is the easy mistake — both live in the same .env and
  // both are "the Anthropic key". Say so before spending 12 round-trips finding
  // out from a 401, whose "invalid x-api-key" gives no hint which key is wrong.
  const looksAdmin = !adminKey || adminKey.startsWith("sk-ant-admin");
  if (adminKey && !looksAdmin) {
    warnings.push(
      `ANTHROPIC_ADMIN_KEY starts "${adminKey.slice(0, 12)}…" — that is not an Admin key. ` +
      "Admin keys start sk-ant-admin01- and are created under Console > Settings > API keys > " +
      "Admin keys (a section that only exists on organization accounts). The sk-ant-api03- key " +
      "that runs the app cannot read billing."
    );
  }

  if (adminKey && looksAdmin) {
    console.log("Anthropic: reading billed cost from the Admin Cost API…");
    const res = await fetchAnthropicCost(adminKey, months, { daily: args.daily, workspace: args.workspace });
    warnings.push(...res.warnings);
    if (res.fatal || !res.rows.length) {
      const why = res.fatal
        ? "The Admin API rejected ANTHROPIC_ADMIN_KEY"
        : "The Admin API returned no cost data for this window";
      console.log(`Anthropic: ${why.toLowerCase()} — falling back to estimates.`);
      const est = await estimateAnthropicCost(months, why, manuallyCosted);
      txns.push(...est.rows);
      warnings.push(...est.warnings);
      mode = "Anthropic cost: ESTIMATED";
    } else {
      txns.push(...res.rows);
      console.log(`Anthropic: ${res.rows.length} cost rows.`);
      mode = "Anthropic cost: billed (Admin Cost API)";
    }
  } else {
    const why = adminKey
      ? "ANTHROPIC_ADMIN_KEY is not an Admin key"
      : "ANTHROPIC_ADMIN_KEY is not set";
    console.log(`Anthropic: ${why} — estimating from analytics.`);
    const est = await estimateAnthropicCost(months, why, manuallyCosted);
    txns.push(...est.rows);
    warnings.push(...est.warnings);
    mode = "Anthropic cost: ESTIMATED";
  }

  // --- Stripe ---
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey) {
    console.log("Stripe: reading balance transactions…");
    const res = await fetchStripe(stripeKey, months);
    txns.push(...res.rows);
    warnings.push(...res.warnings);
    console.log(`Stripe: ${res.rows.length} rows.`);
  } else {
    warnings.push("STRIPE_SECRET_KEY is not set — no revenue was imported. Add subscription income to manual-entries.csv, or set the key.");
    console.log("Stripe: no STRIPE_SECRET_KEY — skipping revenue import.");
  }

  // --- hand-maintained (read above, before the estimator) ---
  txns.push(...rec, ...man);
  console.log(`CSV: ${rec.length} recurring + ${man.length} manual rows.`);

  const volume = await fetchVolume(months);

  // A month-by-month AI cost table for pasting into a spreadsheet someone else
  // owns. Costs are POSITIVE here, unlike the workbook's signed convention: this
  // lands in a column already labelled "expense", where a negative number would
  // be subtracted twice.
  if (args.exportCsv) {
    const AI_ALL = [CAT.AI_TOKENS, CAT.AI_SEARCH, CAT.AI_CODE, CAT.AI_SESSION, CAT.AI_DEV];
    const sumCat = (m, c) => txns.filter((t) => t.month === m && t.category === c)
                                 .reduce((a, t) => a + t.amount, 0);
    const lines = ["Month,AI processing,Web search fees,Total AI cost,Billed searches,Cached searches,Cost per search"];
    const acc = [0, 0, 0, 0, 0];
    for (const m of months) {
      const tok = Math.abs(round2(sumCat(m, CAT.AI_TOKENS)));
      const web = Math.abs(round2(sumCat(m, CAT.AI_SEARCH)));
      const tot = Math.abs(round2(AI_ALL.reduce((a, c) => a + sumCat(m, c), 0)));
      const v = volume.get(m) || {};
      const b = v.billed || 0, ch = v.cached || 0;
      acc[0] += tok; acc[1] += web; acc[2] += tot; acc[3] += b; acc[4] += ch;
      lines.push([m, tok.toFixed(2), web.toFixed(2), tot.toFixed(2), b, ch,
        b ? (tot / b).toFixed(2) : ""].join(","));
    }
    lines.push(["Total", acc[0].toFixed(2), acc[1].toFixed(2), acc[2].toFixed(2), acc[3], acc[4],
      acc[3] ? (acc[2] / acc[3]).toFixed(2) : ""].join(","));

    const p = typeof args.exportCsv === "string"
      ? path.resolve(args.exportCsv)
      : path.join(ROOT, "compninja-ai-costs.csv");
    fs.writeFileSync(p, lines.join("\n") + "\n", "utf8");
    console.log(`\nExported AI cost summary -> ${p}`);
  }

  const buf = buildWorkbook({ txns, months, volume, warnings, mode });
  const out = args.out ? path.resolve(args.out) : path.join(ROOT, "CompNinja-Ledger.xlsx");
  fs.writeFileSync(out, buf);

  console.log(`\nWrote ${out} — ${txns.length} transactions across ${months.length} months.`);
  if (warnings.length) {
    console.log("\nWarnings (also written onto the Summary sheet):");
    for (const w of warnings) console.log(`  ! ${w}`);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}

module.exports = { parseCsv, splitCsvLine, signFor, monthRange, rollUpMonthly, readManualEntries, readRecurring, parseEntryDate, CAT, REVENUE_CATS, COGS_CATS, OPEX_CATS, RATES };
