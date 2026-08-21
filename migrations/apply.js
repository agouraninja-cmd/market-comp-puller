#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Run a migration against the live database WITHOUT the SQL editor.
//
//   node migrations/apply.js                 # what is pending? (runs nothing)
//   node migrations/apply.js --yes           # apply every pending file, in order
//   node migrations/apply.js 037-foo.sql --yes
//   node migrations/apply.js --check         # is the live schema what the code expects?
//   node migrations/apply.js --sql "select count(*) from comp_corpus"
//   node migrations/apply.js --sql "update users set vault_beta = true where email = 'x'" --write
//
// Zero dependencies, like everything else here.
//
// WHY THIS EXISTS: applying a migration was a human copying SQL out of a chat
// window into a web UI, and every failure this folder records comes from that
// gap rather than from the SQL. 004 was written, committed, and never run --
// the corpus silently froze for weeks. 036-bulk-valuations was pasted into the
// WRONG PROJECT (the empty default, not "Market comp puller"), reported
// Success, and created two tables in a database nothing reads. Neither is a
// mistake anyone makes twice on purpose; both are exactly what a machine does
// not do.
//
// HOW IT REACHES THE DATABASE, and why not the way everything else does:
// PostgREST (the SUPABASE_SERVICE_KEY the app uses) cannot run DDL at all --
// it is a CRUD interface over existing tables, which is why verify.js can only
// ASK about the schema. DDL needs the Management API, which authenticates with
// a personal access token (SUPABASE_ACCESS_TOKEN, an `sbp_...` from
// https://supabase.com/dashboard/account/tokens).
//
// THAT TOKEN IS BROADER THAN THE SERVICE KEY. It is account-wide: it can
// create and delete PROJECTS, not just rows. Two guards, because the blast
// radius earned them:
//
//   1. The project ref is DERIVED from SUPABASE_URL, never passed in. The
//      runner can only ever talk to the project the app itself talks to, so
//      the 036 wrong-project incident is not expressible here. A blank
//      SUPABASE_URL refuses outright rather than defaulting to anything --
//      blanking it is the deliberate isolation trick run-eval.js documents,
//      and "no database configured" must never resolve to "some database".
//   2. Destructive statements refuse without --allow-destructive. This folder
//      is append-only and idempotent by convention (016 even has a test that
//      fails the build if a destructive statement appears in it), so a DROP
//      reaching this runner is a question, not an instruction.
//
// Nothing here is part of `npm start` or `npm test`'s runtime path, and
// requiring this module starts nothing -- the pure helpers below are what
// test/migrate-apply.test.js exercises.
// ---------------------------------------------------------------------------

"use strict";

const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = __dirname;
const APPLIED_FILE = path.join(MIGRATIONS_DIR, "APPLIED.md");
const API_ROOT = "https://api.supabase.com";

// 000 and 010 are RECONSTRUCTIONS of tables created by hand before this folder
// existed (README, "Conventions"). They document a shape that is already live;
// they were never run as files and running one now would be the first time
// anybody had. Named rather than merely skipped, so asking for one by name is
// a refusal instead of a silent no-op.
const NEVER_RUN = new Set([
  "000-baseline-hand-created.sql",
  "010-market-pages.sql",
]);

// --- pure helpers (exported; see test/migrate-apply.test.js) -----------------

// SQL comments are stripped before the danger scan, or a file explaining why
// it does NOT drop a column would refuse to run over its own prose. This
// folder keeps its "why" in comments as a matter of convention, so that is the
// normal case here rather than an edge one.
function stripSqlComments(sql) {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

// What this refuses is deliberately narrow: statements that destroy data or
// the shape holding it. An `alter ... drop not null` is not here (008 does
// exactly that, harmlessly) and neither is `drop index`.
const DANGEROUS = [
  [/\bdrop\s+(table|schema|database|view|materialized\s+view)\b/i, "drops a table or schema"],
  [/\balter\s+table\s+[\s\S]{0,120}?\bdrop\s+column\b/i, "drops a column"],
  [/\btruncate\b/i, "truncates a table"],
  [/\bdelete\s+from\b(?![\s\S]{0,200}?\bwhere\b)/i, "deletes every row (no WHERE)"],
  [/\bupdate\s+\w+\s+set\b(?![\s\S]{0,300}?\bwhere\b)/i, "updates every row (no WHERE)"],
];

function scanDangerous(sql) {
  const body = stripSqlComments(sql);
  const found = [];
  for (const [re, why] of DANGEROUS) {
    const m = body.match(re);
    if (m) found.push({ why, statement: m[0].replace(/\s+/g, " ").slice(0, 90) });
  }
  return found;
}

// A file counts as applied when APPLIED.md names it. That file is a markdown
// table maintained by hand, so this matches the NAME anywhere in the text
// rather than parsing rows -- a renamed-at-merge migration (030, 036) is
// discussed in prose as well as listed, and a false "already applied" is the
// cheaper error: it stops, and someone looks.
function isLoggedApplied(file, appliedText) {
  return String(appliedText || "").includes(file);
}

function pendingMigrations(files, appliedText) {
  return files
    .filter((f) => /^\d{3}-.+\.sql$/.test(f))
    .filter((f) => !NEVER_RUN.has(f))
    .filter((f) => !isLoggedApplied(f, appliedText))
    .sort();
}

// Two files sharing a number have no defined order, and this runner applies in
// order. It has happened twice (030 and 036 were both renumbered at merge
// time, and 036 collided anyway), so it is a real state to be in and not a
// hypothetical -- but only a blocking one when the collision is PENDING.
function numberCollisions(files) {
  const byNumber = new Map();
  for (const f of files) {
    const m = /^(\d{3})-/.exec(f);
    if (!m) continue;
    if (!byNumber.has(m[1])) byNumber.set(m[1], []);
    byNumber.get(m[1]).push(f);
  }
  return [...byNumber.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([number, group]) => ({ number, files: group.sort() }));
}

function projectRefFrom(supabaseUrl) {
  const m = /^https?:\/\/([a-z0-9]{20})\.supabase\.(co|in)\b/i.exec(String(supabaseUrl || "").trim());
  return m ? m[1].toLowerCase() : null;
}

function appliedRow(file, date, note) {
  return `| ${file} | applied ${date} | ${note} |`;
}

// APPLIED.md is a markdown table followed by prose and a <details> block, so
// the row goes after the LAST table row rather than at the end of the file.
function insertAppliedRow(text, row) {
  const lines = String(text).split("\n");
  let last = -1;
  for (let i = 0; i < lines.length; i++) if (/^\|\s*\d{3}-\S+\.sql\s*\|/.test(lines[i])) last = i;
  if (last === -1) return null;
  lines.splice(last + 1, 0, row);
  return lines.join("\n");
}

// --- the live database ------------------------------------------------------

// The same tiny .env reader server.js and verify.js use.
function loadEnv() {
  const out = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(MIGRATIONS_DIR, "..", ".env"), "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const k = t.slice(0, eq).trim();
      if (!out[k]) out[k] = t.slice(eq + 1).trim();
    }
  } catch (_) { /* exported vars are fine */ }
  return out;
}

async function runSql(ctx, query, readOnly) {
  const res = await fetch(`${API_ROOT}/v1/projects/${ctx.ref}/database/query`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ctx.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, read_only: !!readOnly }),
  });
  const text = await res.text();
  if (!res.ok) {
    // Never echo the token; the body can carry the failing statement, which is
    // the useful half and is already in the repo.
    let detail = text.slice(0, 400);
    try { const j = JSON.parse(text); detail = j.message || j.error || detail; } catch (_) {}
    throw new Error(`Supabase refused (${res.status}): ${detail}`);
  }
  try { return JSON.parse(text); } catch (_) { return []; }
}

// --check: ask information_schema for everything verify.js expects. This is
// the check APPLIED.md keeps saying it could not run -- five rows there read
// "not verified by verify.js (no service key on this machine)", because the
// keys live only on Render. The Management API token is a different door to
// the same answer, so the expected-schema list stays in verify.js and this
// only supplies a second transport.
function buildCheckQuery(tables, columns) {
  const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const tableList = tables.map(([t]) => lit(t)).join(",");
  const pairs = [];
  for (const [table, cols] of columns) for (const c of cols) pairs.push(`(${lit(table)},${lit(c)})`);
  return `
select 'table' as kind, t as name, null as col
  from unnest(array[${tableList}]) as t
 where to_regclass('public.' || t) is null
union all
select 'column', v.t, v.c
  from (values ${pairs.join(",")}) as v(t, c)
 where to_regclass('public.' || v.t) is not null
   and not exists (select 1 from information_schema.columns
                    where table_schema = 'public'
                      and table_name = v.t
                      and column_name = v.c)`;
}

async function check(ctx) {
  const V = require("./verify.js");
  const rows = await runSql(ctx, buildCheckQuery(V.TABLES, V.COLUMNS), true);
  const owner = new Map();
  for (const [t, m] of V.TABLES) owner.set(t, m);
  for (const [t, cols, m] of V.COLUMNS) for (const c of cols) owner.set(`${t}.${c}`, m);

  if (!rows.length) {
    const cols = V.COLUMNS.reduce((n, c) => n + c[1].length, 0);
    console.log(`Everything present — ${V.TABLES.length} tables, ${cols} columns. The live schema matches the code.`);
    return 0;
  }
  const byMigration = new Map();
  for (const r of rows) {
    const name = r.kind === "column" ? `${r.name}.${r.col}` : r.name;
    const m = owner.get(name) || "unknown migration";
    if (!byMigration.has(m)) byMigration.set(m, []);
    byMigration.get(m).push(name);
  }
  console.log("MISSING from the live database:");
  for (const [m, names] of byMigration) {
    console.log(`\n  ${m}  has not been run`);
    for (const n of names) console.log(`     - ${n}`);
  }
  console.log(`\nApply with:  node migrations/apply.js --yes`);
  return 1;
}

// --- the runner -------------------------------------------------------------

function parseArgs(argv) {
  const out = { files: [], yes: false, allowDestructive: false, check: false, sql: null, write: false, noLog: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--allow-destructive") out.allowDestructive = true;
    else if (a === "--check") out.check = true;
    else if (a === "--write") out.write = true;
    else if (a === "--no-log") out.noLog = true;
    else if (a === "--sql") out.sql = argv[++i] || "";
    else if (a.startsWith("-")) out.unknown = a;
    else out.files.push(a);
  }
  return out;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.unknown) {
    console.error(`Unknown flag ${args.unknown}. Flags are refused, never guessed.`);
    process.exit(2);
  }

  const env = loadEnv();
  const ref = projectRefFrom(env.SUPABASE_URL);
  const token = String(env.SUPABASE_ACCESS_TOKEN || "").trim();

  if (!ref) {
    console.error("SUPABASE_URL is missing or is not a project URL, so there is no project to apply to.");
    console.error("(A blank SUPABASE_URL is how an eval worktree isolates itself — that is not a database this should guess at.)");
    process.exit(2);
  }
  if (!token) {
    console.error("SUPABASE_ACCESS_TOKEN is required (an `sbp_...` personal access token).");
    console.error("Create one at https://supabase.com/dashboard/account/tokens and put it in .env — see .env.example.");
    console.error("It is NOT the service key: PostgREST cannot run DDL at all, which is why the SQL editor was the only door until now.");
    process.exit(2);
  }
  const ctx = { ref, token };
  console.log(`Project ${ref} (derived from SUPABASE_URL, so this can only reach the database the app uses)\n`);

  if (args.check) process.exit(await check(ctx));

  // --- ad-hoc SQL ---------------------------------------------------------
  if (args.sql !== null) {
    const danger = scanDangerous(args.sql);
    if (danger.length && !args.allowDestructive) {
      console.error("Refused — this statement is destructive:");
      for (const d of danger) console.error(`  ${d.why}: ${d.statement}`);
      console.error("\nRe-run with --allow-destructive if that is genuinely the intent.");
      process.exit(3);
    }
    if (!args.write) {
      console.log("Running READ-ONLY (pass --write for a statement that changes data):\n");
    }
    const rows = await runSql(ctx, args.sql, !args.write);
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  }

  // --- migration files ----------------------------------------------------
  const all = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const appliedText = fs.readFileSync(APPLIED_FILE, "utf8");

  let targets;
  if (args.files.length) {
    for (const f of args.files) {
      if (NEVER_RUN.has(f)) {
        console.error(`Refused — ${f} is a reconstruction of a table created by hand before this folder existed.`);
        console.error("It documents a shape that is already live; it has never been run and must not be.");
        process.exit(3);
      }
      if (!all.includes(f)) {
        console.error(`No such migration: ${f}`);
        process.exit(2);
      }
    }
    targets = args.files.slice();
  } else {
    targets = pendingMigrations(all, appliedText);
    const collisions = numberCollisions(targets);
    if (collisions.length) {
      // Order is the whole contract of a numbered folder. Two pending files
      // sharing a number have none, so this stops rather than picking.
      console.error("Refused — pending migrations share a number, so their order is undefined:");
      for (const c of collisions) console.error(`  ${c.number}: ${c.files.join(", ")}`);
      console.error("\nRenumber one (or name a file explicitly) and re-run.");
      process.exit(3);
    }
  }

  if (!targets.length) {
    console.log("Nothing pending — every migration in this folder is logged in APPLIED.md.");
    console.log("Check that the record is TRUE with:  node migrations/apply.js --check");
    process.exit(0);
  }

  console.log(`${targets.length} migration(s) to apply:\n`);
  const plan = [];
  for (const file of targets) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const danger = scanDangerous(sql);
    const statements = stripSqlComments(sql).split(";").filter((s) => s.trim()).length;
    console.log(`  ${file}  (${statements} statement${statements === 1 ? "" : "s"})`);
    for (const d of danger) console.log(`     ⚠ ${d.why}: ${d.statement}`);
    if (danger.length && !args.allowDestructive) {
      console.error(`\nRefused — ${file} is destructive and this folder is append-only by convention.`);
      console.error("Re-run with --allow-destructive if that is genuinely the intent.");
      process.exit(3);
    }
    plan.push({ file, sql });
  }

  if (!args.yes) {
    console.log("\nNothing was run. Re-run with --yes to apply.");
    process.exit(0);
  }

  console.log("");
  const applied = [];
  for (const { file, sql } of plan) {
    process.stdout.write(`  applying ${file} … `);
    try {
      await runSql(ctx, sql, false);
      console.log("ok");
      applied.push(file);
    } catch (err) {
      console.log("FAILED");
      console.error(`\n  ${err.message}\n`);
      // Stop at the first failure: a later migration may assume this one ran,
      // and a half-applied sequence logged as applied is exactly the lie this
      // folder exists to prevent.
      if (applied.length) console.error(`Applied before the failure: ${applied.join(", ")}`);
      console.error("Nothing after this file was attempted.");
      process.exit(1);
    }
  }

  // Log only what actually ran, and only after it ran -- the watchlist
  // digest's mark-after-the-send rule. A missed line costs a re-run of an
  // idempotent file; a line written first would claim a migration that failed.
  if (!args.noLog && applied.length) {
    let text = fs.readFileSync(APPLIED_FILE, "utf8");
    for (const file of applied) {
      if (isLoggedApplied(file, text)) continue;
      const note =
        `Applied by \`node migrations/apply.js\` on ${today()} via the Supabase Management API ` +
        `(project derived from SUPABASE_URL, so the wrong-project failure 036 records cannot happen here). ` +
        `The API reported success for every statement. **Verify with \`node migrations/apply.js --check\`** ` +
        `and replace this line with what the migration actually does and what its absence would have cost.`;
      const next = insertAppliedRow(text, appliedRow(file, today(), note));
      if (!next) { console.error("\nCould not find the APPLIED.md table to log into — add the row by hand."); break; }
      text = next;
    }
    fs.writeFileSync(APPLIED_FILE, text);
    console.log(`\nLogged ${applied.length} row(s) in migrations/APPLIED.md — read them before committing.`);
  }

  console.log("");
  process.exit(await check(ctx));
}

module.exports = {
  NEVER_RUN,
  stripSqlComments,
  scanDangerous,
  isLoggedApplied,
  pendingMigrations,
  numberCollisions,
  projectRefFrom,
  appliedRow,
  insertAppliedRow,
  buildCheckQuery,
  parseArgs,
};

if (require.main === module) {
  main().catch((err) => {
    console.error("apply failed:", err.message);
    process.exit(2);
  });
}
