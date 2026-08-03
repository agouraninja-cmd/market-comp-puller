#!/usr/bin/env node
// ---------------------------------------------------------------------------
// A one-page Statement of Profit and Loss, for handing to someone.
//
//   node ledger/statement.js
//   node ledger/statement.js --from 2026-06 --to 2026-08 --partial-through "August 3, 2026"
//
// Deliberately NOT the same document as CompNinja-Ledger.xlsx. That workbook is
// a working tool: fifteen categories, a transactions register, live formulas,
// warning text. This is a statement — one sheet, six expense lines, plain
// English, every figure traceable to a bill someone can produce on request.
//
// The guiding rule is that the person presenting it has to be able to explain
// every number out loud. A statement its author cannot defend is worth less
// than a simpler one they can, so internal distinctions that would invite a
// question without informing the answer (blended vs marginal cost of a search,
// tokens vs web-search fees) are summed into one honest line here and left to
// the working ledger.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { workbook, S } = require("./xlsx");
const {
  readManualEntries, readRecurring, monthRange, CAT, REVENUE_CATS,
} = require("./ledger.js");

const ROOT = path.join(__dirname, "..");
const round2 = (n) => Math.round(n * 100) / 100;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

// The presentation groups. Each maps one readable line to the internal
// categories behind it — the mapping is the whole translation layer between the
// working ledger's vocabulary and a reader's.
const GROUPS = [
  { label: "AI search costs (Anthropic)", cats: [CAT.AI_TOKENS, CAT.AI_SEARCH, CAT.AI_CODE, CAT.AI_SESSION, CAT.AI_DEV] },
  { label: "Legal & company formation", cats: [CAT.LEGAL] },
  { label: "Hosting & infrastructure", cats: [CAT.HOSTING, CAT.DATABASE, CAT.EMAIL, CAT.DOMAIN, CAT.MAPS] },
  { label: "Payment processing", cats: [CAT.PAYMENT_FEES] },
  { label: "Other", cats: [CAT.OTHER] },
];

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") out.from = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--partial-through") out.partialThrough = argv[++i];
    else if (a === "--company") out.company = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const HELP = `
One-page Statement of Profit and Loss.

  node ledger/statement.js [options]

  --from YYYY-MM             first month (default 2026-06)
  --to   YYYY-MM             last month  (default current month)
  --partial-through "TEXT"   note that the final month is incomplete,
                             e.g. --partial-through "August 3, 2026"
  --company NAME             name on the statement (default CompNinja)
  --out PATH                 default ./CompNinja-Profit-and-Loss.xlsx

Reads the same ledger/*.csv files as ledger.js, so the two documents can
never disagree.
`;

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(HELP); return; }

  const now = new Date();
  const from = args.from || "2026-06";
  const to = args.to || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const months = monthRange(from, to);
  const company = args.company || "CompNinja";

  const warnings = [];
  const txns = [...readRecurring(months), ...readManualEntries(months, warnings)];

  const sumCats = (m, cats) => round2(
    txns.filter((t) => t.month === m && cats.includes(t.category))
        .reduce((a, t) => a + t.amount, 0)
  );

  const revenue = months.map((m) => sumCats(m, REVENUE_CATS));
  const groups = GROUPS.map((g) => ({
    label: g.label,
    vals: months.map((m) => sumCats(m, g.cats)),
  }));
  // A line that is zero in every period is noise on a statement — except the
  // infrastructure line, whose zero is itself the point worth showing.
  const shown = groups.filter((g) =>
    g.vals.some((v) => v !== 0) || g.label.startsWith("Hosting"));

  const expenseTotal = months.map((_, i) => round2(shown.reduce((a, g) => a + g.vals[i], 0)));
  const net = months.map((_, i) => round2(revenue[i] + expenseTotal[i]));
  const tot = (a) => round2(a.reduce((x, y) => x + y, 0));

  const label = (mk) => `${MONTHS[Number(mk.slice(5, 7)) - 1].slice(0, 3)} ${mk.slice(0, 4)}`;
  const firstLabel = `${MONTHS[Number(months[0].slice(5, 7)) - 1]} 1, ${months[0].slice(0, 4)}`;
  const lastLabel = args.partialThrough
    || `${MONTHS[Number(to.slice(5, 7)) - 1]} ${new Date(Date.UTC(+to.slice(0, 4), +to.slice(5, 7), 0)).getUTCDate()}, ${to.slice(0, 4)}`;

  const rows = [];
  const money = (v, s = S.ACC) => ({ v, s });

  rows.push([{ t: "s", v: company, s: S.TITLE }]);
  rows.push([{ t: "s", v: "Statement of Profit and Loss", s: S.BOLD }]);
  rows.push([{ t: "s", v: `For the period ${firstLabel} through ${lastLabel}`, s: S.MUTED }]);
  rows.push([{ t: "s", v: "All amounts in US dollars. Expenses shown in parentheses.", s: S.MUTED }]);
  rows.push([]);

  rows.push([
    { t: "s", v: "", s: S.HEADER },
    ...months.map((m) => ({ t: "s", v: label(m), s: S.HEADER })),
    { t: "s", v: "Total", s: S.HEADER },
  ]);

  rows.push([{ t: "s", v: "REVENUE", s: S.SUBHEAD }, ...months.map(() => ({ t: "s", v: "", s: S.SUBHEAD })), { t: "s", v: "", s: S.SUBHEAD }]);
  rows.push(["Subscription and report sales", ...revenue.map((v) => money(v)), money(tot(revenue), S.ACC_BOLD)]);
  rows.push([]);

  rows.push([{ t: "s", v: "OPERATING EXPENSES", s: S.SUBHEAD }, ...months.map(() => ({ t: "s", v: "", s: S.SUBHEAD })), { t: "s", v: "", s: S.SUBHEAD }]);
  for (const g of shown) {
    rows.push([g.label, ...g.vals.map((v) => money(v)), money(tot(g.vals), S.ACC_BOLD)]);
  }
  rows.push([
    { t: "s", v: "Total operating expenses", s: S.TOTAL },
    ...expenseTotal.map((v) => money(v, S.ACC_TOTAL)),
    money(tot(expenseTotal), S.ACC_TOTAL),
  ]);
  rows.push([]);

  rows.push([
    { t: "s", v: tot(net) < 0 ? "NET LOSS" : "NET PROFIT", s: S.TOTAL },
    ...net.map((v) => money(v, S.ACC_TOTAL)),
    money(tot(net), S.ACC_TOTAL),
  ]);
  rows.push([]);
  rows.push([]);

  rows.push([{ t: "s", v: "Notes", s: S.BOLD }]);
  const notes = [];
  const aiTotal = tot(shown.find((g) => g.label.startsWith("AI")) ?.vals || [0]);
  notes.push(`1.  AI search costs are billed usage of the Anthropic API, which powers the property ` +
    `comparable search. Figures are taken from the Anthropic billing console and total ` +
    `$${Math.abs(aiTotal).toFixed(2)} for the period.`);
  const legal = shown.find((g) => g.label.startsWith("Legal"));
  if (legal && tot(legal.vals) !== 0) {
    notes.push(`2.  Legal and company formation covers LLC registration and related filing fees.`);
  }
  notes.push(`${legal && tot(legal.vals) !== 0 ? "3" : "2"}.  Hosting, database and email services are provided at no cost under ` +
    `free service tiers, and are shown at zero rather than omitted.`);
  notes.push(`${legal && tot(legal.vals) !== 0 ? "4" : "3"}.  No revenue has been recognized. Paid subscriptions remain in a pre-launch ` +
    `test configuration and are not yet available for purchase.`);
  if (args.partialThrough) {
    notes.push(`${legal && tot(legal.vals) !== 0 ? "5" : "4"}.  ${label(months[months.length - 1])} figures are partial, covering ` +
      `${args.partialThrough} only.`);
  }
  for (const n of notes) rows.push([{ t: "s", v: n, s: S.MUTED }]);
  rows.push([]);
  rows.push([{ t: "s", v: `Prepared ${MONTHS[now.getUTCMonth()]} ${now.getUTCDate()}, ${now.getUTCFullYear()}.`, s: S.MUTED }]);

  const sheet = {
    name: "Profit and Loss",
    rows,
    cols: [34, ...months.map(() => 14), 15],
  };

  // ---- Supporting detail -------------------------------------------------
  // The statement summarises five lines; this is every transaction behind them.
  // It exists because "what is the $96.96?" is the first question anyone asks,
  // and a statement that cannot answer it from its own pages is asking to be
  // taken on trust. Presentation labels are used here too, so a reader moving
  // between the two sheets never meets a word the statement did not use.
  const groupFor = (cat) => (GROUPS.find((g) => g.cats.includes(cat)) || {}).label || "Other";

  // Rows that share a month, a statement line AND a vendor are collapsed into
  // one. The case this exists for is the Anthropic charge, which the ledger
  // stores as two rows — the model's processing and the per-search fee — because
  // that ratio is worth watching internally. On a statement it is one payment to
  // one vendor for one month, and splitting it invites a question about a
  // distinction the reader cannot act on. The split survives untouched in
  // CompNinja-Ledger.xlsx.
  const byKey = new Map();
  for (const t of [...txns].sort((a, b) => a.date - b.date)) {
    const line = groupFor(t.category);
    const key = `${t.month}|${line}|${t.vendor || ""}`;
    const prev = byKey.get(key);
    if (prev) { prev.amount = round2(prev.amount + t.amount); prev.merged++; continue; }
    byKey.set(key, { ...t, line, merged: 1 });
  }
  const detail = [...byKey.values()]
    .map((t) => ({
      ...t,
      // A merged row must not keep one component's description as if it were
      // the whole: "AI processing — June" would understate a figure that now
      // also contains the search fees.
      // The vendor has its own column, so a parenthetical vendor in the label
      // would say it twice.
      description: t.merged > 1
        ? `${t.line.replace(/\s*\([^)]*\)\s*$/, "")} — ${MONTHS[Number(t.month.slice(5, 7)) - 1]} ${t.month.slice(0, 4)}`
        : t.description,
    }))
    .sort((a, b) => a.date - b.date || a.line.localeCompare(b.line));

  const dRows = [
    [{ t: "s", v: "Supporting Detail", s: S.TITLE }],
    [{ t: "s", v: `All transactions, ${firstLabel} through ${lastLabel}`, s: S.MUTED }],
    [{ t: "s", v: "Each amount below is traceable to a vendor invoice or receipt.", s: S.MUTED }],
    [],
    [
      { t: "s", v: "Date", s: S.HEADER },
      { t: "s", v: "Description", s: S.HEADER },
      { t: "s", v: "Vendor", s: S.HEADER },
      { t: "s", v: "Statement line", s: S.HEADER },
      { t: "s", v: "Amount", s: S.HEADER },
    ],
  ];
  for (const t of detail) {
    dRows.push([
      { d: t.date, s: S.DATE },
      t.description || "",
      t.vendor || "—",
      t.line,
      { v: round2(t.amount), s: S.ACC },
    ]);
  }
  dRows.push([
    { t: "s", v: "", s: S.TOTAL },
    { t: "s", v: "Total", s: S.TOTAL },
    { t: "s", v: "", s: S.TOTAL },
    { t: "s", v: "", s: S.TOTAL },
    { v: round2(detail.reduce((a, t) => a + t.amount, 0)), s: S.ACC_TOTAL },
  ]);
  dRows.push([]);
  dRows.push([{ t: "s", v: "Monthly AI figures are taken from the Anthropic billing console and recorded as a " +
    "single amount per month per cost type; the console retains the underlying daily detail.", s: S.MUTED }]);

  const detailSheet = {
    name: "Supporting Detail",
    rows: dRows,
    cols: [12, 44, 16, 28, 14],
    freeze: 5,
  };

  const out = args.out ? path.resolve(args.out) : path.join(ROOT, "CompNinja-Profit-and-Loss.xlsx");
  fs.writeFileSync(out, workbook([sheet, detailSheet]));
  console.log(`Wrote ${out}`);
  console.log(`  Revenue          $${tot(revenue).toFixed(2)}`);
  console.log(`  Expenses         $${Math.abs(tot(expenseTotal)).toFixed(2)}`);
  console.log(`  Net              $${tot(net).toFixed(2)}`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (require.main === module) main();
