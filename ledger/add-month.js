#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Record one month's Anthropic cost, read off the Console's Cost page.
//
//   node ledger/add-month.js 2026-06 --tokens 3.90 --search 0.74
//   node ledger/add-month.js 2026-08 --tokens 5.10 --search 1.30 --partial
//
// This is the whole of "phase 2" in ledger/README.md as one command. Doing it by
// hand meant typing an em dash inside a category name, getting the sign right,
// and remembering to EDIT the month-to-date line rather than add a second one.
// Each of those is a silent wrong-number bug; none of them is interesting.
//
// IDEMPOTENT: re-running for a month you already recorded REPLACES that month's
// rows instead of appending. That is what makes updating a month-to-date figure
// after the month closes safe — run it again with the final numbers.
//
// Only rows this tool wrote are ever touched. They carry an `auto:console`
// marker in the notes column; anything you typed yourself is left alone, and
// so are the file's comments.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "manual-entries.csv");
const MARKER = "auto:console";

// Must match the category strings in ledger.js exactly — em dash included.
const FIELDS = {
  tokens: "AI — tokens",
  search: "AI — web search",
  code: "AI — code execution",
  session: "AI — session usage",
};

// Production vs development. CompNinja is built by four people whose Claude
// tooling bills to the same organization as the production server, so the
// Console's "All keys" total is NOT the cost of serving customers. Splitting
// them is what keeps cost-per-search a marginal cost instead of an average that
// happens to include R&D.
const DEV_CATEGORY = "AI — development";

const HELP = `
Record one month's Anthropic cost from the Console Cost page.

  node ledger/add-month.js <YYYY-MM> --tokens <$> --search <$> [options]

  --tokens   <$>   "Total token cost"            (API key: All)
  --search   <$>   "Total web search cost"       (API key: All)
  --code     <$>   "Total code execution cost"   (optional, usually 0)
  --session  <$>   "Total session runtime cost"  (optional, usually 0)

  --prod-tokens <$>  "Total token cost" with API key = the PRODUCTION key only
  --prod-search <$>  "Total web search cost" with API key = the production key

  --partial        mark as month-to-date, not final
  --note   <text>  extra note on the rows
  --list           show what has been recorded so far, then exit

READ THE COST PAGE TWICE. CompNinja is built by four people whose Claude tooling
bills to the same organization as the production server, so "All keys" mixes
R&D into the cost of serving customers:

  1. API key = All            -> --tokens / --search
  2. API key = production key -> --prod-tokens / --prod-search

The production figures book as cost of revenue and drive cost-per-search; the
difference books as "AI — development" under operating costs. Give only the
totals and everything lands in cost of revenue, which inflates cost-per-search
by whatever the team spent building that month — the tool warns when you do.

Re-running for the same month replaces that month's rows, so updating a
month-to-date figure after the month closes is just running it again.
`;

function parseArgs(argv) {
  const out = { amounts: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--partial") out.partial = true;
    else if (a === "--list") out.list = true;
    else if (a === "--note") out.note = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--prod-")) {
      const key = a.slice(7);
      if (!(key in FIELDS)) { out.error = `Unknown option ${a}`; return out; }
      (out.prod = out.prod || {})[key] = argv[++i];
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      if (!(key in FIELDS)) { out.error = `Unknown option --${key}`; return out; }
      out.amounts[key] = argv[++i];
    } else if (!out.month) out.month = a;
    else { out.error = `Unexpected argument "${a}"`; return out; }
  }
  return out;
}

// Cost pages show "$4.64"; accept that, and commas, without complaint.
function parseMoney(raw, label) {
  const n = Number(String(raw).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) throw new Error(`--${label} "${raw}" is not a number.`);
  if (n < 0) throw new Error(`--${label} must be positive; the ledger applies the sign.`);
  return Math.round(n * 100) / 100;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// Last day of the month: costs are a whole-month accrual, so they belong on the
// month's final day rather than whenever you happened to type them in.
function lastDayOf(month) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function csvQuote(s) {
  const v = String(s == null ? "" : s);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Rows this tool wrote, as { month, category, amount, line }. */
function existingAutoRows(lines) {
  const out = [];
  lines.forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith("#")) return;
    if (!line.includes(MARKER)) return;
    const date = line.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    out.push({ index: i, month: date.slice(0, 7), line });
  });
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.error) { console.error(args.error); console.log(HELP); process.exitCode = 1; return; }
  if (args.help) { console.log(HELP); return; }

  let raw;
  try { raw = fs.readFileSync(FILE, "utf8"); }
  catch (_) { console.error(`Cannot read ${FILE}`); process.exitCode = 1; return; }
  const lines = raw.split(/\r?\n/);

  if (args.list) {
    const rows = existingAutoRows(lines);
    if (!rows.length) { console.log("No Console-recorded months yet."); return; }
    const byMonth = new Map();
    for (const r of rows) {
      const cells = r.line.split(",");
      const cat = cells[1] || "";
      const amt = Number(cells[4]) || 0;
      const m = byMonth.get(r.month) || { total: 0, parts: [] };
      m.total += amt;
      m.parts.push(`${cat.replace(/^AI — /, "")} $${amt.toFixed(2)}`);
      m.partial = m.partial || r.line.includes("month-to-date");
      byMonth.set(r.month, m);
    }
    console.log("Anthropic cost recorded from the Console:\n");
    for (const m of [...byMonth.keys()].sort()) {
      const v = byMonth.get(m);
      console.log(`  ${m}  $${v.total.toFixed(2).padStart(8)}   ${v.parts.join(" · ")}${v.partial ? "   [month-to-date]" : ""}`);
    }
    return;
  }

  if (!args.month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month)) {
    console.error("First argument must be a month as YYYY-MM, e.g. 2026-06.");
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  if (!Object.keys(args.amounts).length) {
    console.error("Give at least one amount, e.g. --tokens 3.90 --search 0.74.");
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  let amounts;
  try {
    amounts = Object.fromEntries(
      Object.entries(args.amounts).map(([k, v]) => [k, parseMoney(v, k)])
    );
  } catch (e) { console.error(e.message); process.exitCode = 1; return; }

  const date = lastDayOf(args.month);
  const monthLabel = `${MONTH_NAMES[Number(args.month.slice(5, 7)) - 1]} ${args.month.slice(0, 4)}`;
  const status = args.partial ? "month-to-date, not final" : "full month closed";
  const note = [MARKER, status, args.note].filter(Boolean).join(" · ");

  // Drop this month's previous auto rows so a re-run updates rather than doubles.
  const stale = existingAutoRows(lines).filter((r) => r.month === args.month);
  const staleIdx = new Set(stale.map((r) => r.index));
  const kept = lines.filter((_, i) => !staleIdx.has(i));

  // Trim trailing blanks so the appended block sits directly after the content.
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();

  let prod = null;
  if (args.prod) {
    try {
      prod = Object.fromEntries(
        Object.entries(args.prod).map(([k, v]) => [k, parseMoney(v, `prod-${k}`)])
      );
    } catch (e) { console.error(e.message); process.exitCode = 1; return; }

    // A production figure above the all-keys total means the two readings came
    // from different filters or different months. Booking it would produce a
    // negative development cost, which reads as income.
    for (const k of Object.keys(prod)) {
      const total = amounts[k];
      if (total === undefined) {
        console.error(`--prod-${k} given without --${k}. Both readings are needed to split the month.`);
        process.exitCode = 1; return;
      }
      if (prod[k] > total + 0.005) {
        console.error(
          `--prod-${k} ($${prod[k].toFixed(2)}) exceeds --${k} ($${total.toFixed(2)}). ` +
          "The production key's spend cannot be more than all keys combined — re-check the filter and the month."
        );
        process.exitCode = 1; return;
      }
    }
  }

  // Reader-facing wording. "Token cost" is the Console's word and it is precise,
  // but it means nothing to anyone who has not used the API — and these
  // descriptions end up on the Supporting Detail page of a statement handed to
  // someone outside the team. "AI processing" covers what the charge actually
  // is (the model reading search results and writing the report) without
  // claiming more than that; "AI analysis" would overstate the reading half.
  const label = (key) => ({
    tokens: "AI processing",
    search: "Web search fees",
    code: "Code execution",
    session: "Session runtime",
  }[key] || key);
  const added = [];
  let devTotal = 0;

  for (const [key, category] of Object.entries(FIELDS)) {
    if (!(key in amounts)) continue;
    // What belongs to serving customers: the production key alone when the month
    // was split, otherwise the whole figure.
    const serving = prod && key in prod ? prod[key] : amounts[key];
    const dev = Math.round((amounts[key] - serving) * 100) / 100;
    devTotal += dev;

    // A zero line is noise in the ledger; the Cost page shows 0.00 for code
    // execution and session runtime on virtually every account.
    // Descriptions stay plain, because this column is the one that appears on
    // the Supporting Detail page of a statement someone hands to a boss.
    // "production (unsplit)" is internal bookkeeping vocabulary that would only
    // prompt a question the reader cannot act on — it lives in notes instead,
    // where the working ledger can still see it.
    if (serving !== 0) {
      added.push([
        date, category, "Anthropic",
        `${label(key)} — ${monthLabel}`,
        serving.toFixed(2), `${note}${prod ? " · production key only" : ""}`,
      ].map(csvQuote).join(","));
    }
    if (dev !== 0) {
      added.push([
        date, DEV_CATEGORY, "Anthropic",
        `${label(key)}, team tooling — ${monthLabel}`,
        dev.toFixed(2), note,
      ].map(csvQuote).join(","));
    }
  }

  if (!added.length) {
    console.error("Every amount given was 0.00 — nothing to record.");
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(FILE, [...kept, ...added, ""].join("\n"), "utf8");

  const total = Object.values(amounts).reduce((a, b) => a + b, 0);
  console.log(`${stale.length ? "Updated" : "Recorded"} ${monthLabel}: $${total.toFixed(2)} total${args.partial ? " (month-to-date)" : ""}`);
  for (const l of added) {
    const c = l.split(",");
    const cat = (c[1] || "").replace(/^"|"$/g, "");
    console.log(`  ${cat.padEnd(22)} $${c[4]}`);
  }
  if (prod) {
    const serving = total - devTotal;
    console.log(`\n  serving customers  $${serving.toFixed(2)}   (cost of revenue — drives cost per search)`);
    console.log(`  team development   $${devTotal.toFixed(2)}   (operating cost — does not scale with customers)`);
  } else {
    // Not a warning any more. With ~10 keys covering both production and the
    // team's tooling, all-keys IS the practical basis and there is no point
    // nagging about a split that cannot be made. Cost-per-search is labelled
    // "blended" on the Summary sheet so the figure is not mistaken for marginal.
    console.log("\n  all keys · blended (production + team tooling, booked as cost of revenue)");
  }
  if (stale.length) console.log(`\n  (replaced ${stale.length} earlier row${stale.length === 1 ? "" : "s"} for this month)`);
  console.log("\nRebuild the workbook with:  node ledger/ledger.js --from 2026-06");
}

if (require.main === module) main();

module.exports = { parseMoney, lastDayOf, FIELDS, MARKER };
