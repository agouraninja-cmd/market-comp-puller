"use strict";

// migrations/apply.js runs DDL against the live database, so its refusals are
// the whole safety story and they are all pure. Requiring it must start
// NOTHING (the require.main guard) — this file loading it at the top and the
// suite finishing in milliseconds is itself the pin for that.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const APPLY = require("../migrations/apply.js");

// --- destructive-statement scan ---------------------------------------------

test("scanDangerous catches the statements this folder is append-only to avoid", () => {
  assert.equal(APPLY.scanDangerous("drop table users;").length, 1);
  assert.equal(APPLY.scanDangerous("DROP SCHEMA public cascade;").length, 1);
  assert.equal(APPLY.scanDangerous("alter table broker_comps drop column price;").length, 1);
  assert.equal(APPLY.scanDangerous("truncate comp_corpus;").length, 1);
  assert.equal(APPLY.scanDangerous("delete from leads;").length, 1);
  assert.equal(APPLY.scanDangerous("update users set vault_beta = true;").length, 1);
});

test("scanDangerous leaves ordinary additive migrations alone", () => {
  assert.deepEqual(APPLY.scanDangerous("create table if not exists orgs (id uuid primary key);"), []);
  assert.deepEqual(APPLY.scanDangerous("alter table users add column if not exists vault_beta boolean default false;"), []);
  // 008 does exactly this, harmlessly — a dropped NOT NULL is not a dropped column.
  assert.deepEqual(APPLY.scanDangerous("alter table report_purchases alter column comp_snapshot drop not null;"), []);
  assert.deepEqual(APPLY.scanDangerous("create index if not exists x on bulk_jobs (user_id);"), []);
});

test("a scoped write is allowed and the same write unscoped is not", () => {
  // The one-off admin SQL this repo actually runs by hand (CLAUDE.md names it
  // twice) is a single-row UPDATE. The WHERE is what separates it from wiping
  // the grant for every account.
  assert.deepEqual(APPLY.scanDangerous("update users set vault_beta = false where email = 'a@b.co';"), []);
  assert.deepEqual(APPLY.scanDangerous("delete from sessions where expires_at < now();"), []);
  assert.equal(APPLY.scanDangerous("delete from sessions;").length, 1);
});

test("SQL comments cannot trigger a refusal, and cannot hide one either", () => {
  // This folder keeps its "why" in comments, so a file explaining that it does
  // NOT drop a column is the normal case, not an edge one.
  assert.deepEqual(APPLY.scanDangerous("-- does not drop table anything\ncreate table if not exists t (id int);"), []);
  assert.deepEqual(APPLY.scanDangerous("/* truncate is never right here */\nselect 1;"), []);
  assert.equal(APPLY.scanDangerous("select 1; -- ok\ndrop table users;").length, 1);
});

// --- which files are pending -------------------------------------------------

test("pendingMigrations is everything APPLIED.md does not name", () => {
  const files = ["001-a.sql", "002-b.sql", "003-c.sql", "README.md", "verify.js"];
  const applied = "| 001-a.sql | applied | … |\n| 002-b.sql | applied | … |";
  assert.deepEqual(APPLY.pendingMigrations(files, applied), ["003-c.sql"]);
});

test("pendingMigrations sorts, so files apply in their numbered order", () => {
  assert.deepEqual(
    APPLY.pendingMigrations(["011-x.sql", "003-c.sql", "002-b.sql"], ""),
    ["002-b.sql", "003-c.sql", "011-x.sql"]
  );
});

test("the two reconstructions are never pending and never runnable", () => {
  // 000 and 010 document tables created by hand before this folder existed.
  // Running one would be the first time anybody had.
  const files = ["000-baseline-hand-created.sql", "010-market-pages.sql", "011-x.sql"];
  assert.deepEqual(APPLY.pendingMigrations(files, ""), ["011-x.sql"]);
  assert.ok(APPLY.NEVER_RUN.has("000-baseline-hand-created.sql"));
  assert.ok(APPLY.NEVER_RUN.has("010-market-pages.sql"));
});

test("a file is applied when APPLIED.md names it anywhere, not only in a row", () => {
  // 030 and 036 are discussed in prose as well as listed (both were renumbered
  // at merge time). A false "already applied" stops and someone looks; a false
  // "pending" re-runs a file, which is only safe because they are idempotent.
  assert.ok(APPLY.isLoggedApplied("030-enterprise-orgs.sql", "…renamed to 030-enterprise-orgs.sql at merge…"));
  assert.ok(!APPLY.isLoggedApplied("037-new.sql", "| 036-x.sql | applied | … |"));
});

// --- number collisions -------------------------------------------------------

test("numberCollisions finds two files sharing a number", () => {
  const c = APPLY.numberCollisions(["035-a.sql", "036-bulk.sql", "036-org.sql"]);
  assert.equal(c.length, 1);
  assert.equal(c[0].number, "036");
  assert.deepEqual(c[0].files, ["036-bulk.sql", "036-org.sql"]);
});

test("the collision already in this repo is not pending, so it does not block", () => {
  // Both 036s are applied and APPLIED.md deliberately leaves them alone. The
  // runner only refuses when the collision is in the set it is about to apply,
  // where the order would genuinely be undefined.
  const files = fs.readdirSync(path.join(__dirname, "..", "migrations")).filter((f) => f.endsWith(".sql"));
  const applied = fs.readFileSync(path.join(__dirname, "..", "migrations", "APPLIED.md"), "utf8");
  assert.ok(APPLY.numberCollisions(files).length >= 1, "036 collides on disk");
  assert.deepEqual(APPLY.numberCollisions(APPLY.pendingMigrations(files, applied)), []);
});

// --- which project ------------------------------------------------------------

test("projectRefFrom derives the ref from the app's own SUPABASE_URL", () => {
  assert.equal(APPLY.projectRefFrom("https://bqdgthxkdnpofgzfcyhl.supabase.co"), "bqdgthxkdnpofgzfcyhl");
  assert.equal(APPLY.projectRefFrom("https://bqdgthxkdnpofgzfcyhl.supabase.co/"), "bqdgthxkdnpofgzfcyhl");
});

test("projectRefFrom refuses rather than guessing a project", () => {
  // 036-bulk-valuations was pasted into the wrong project, reported Success,
  // and created two tables in a database nothing reads. Deriving the ref is
  // what makes that unexpressible — so every non-answer must be a refusal, and
  // a blank SUPABASE_URL (an eval worktree's deliberate isolation) most of all.
  assert.equal(APPLY.projectRefFrom(""), null);
  assert.equal(APPLY.projectRefFrom(undefined), null);
  assert.equal(APPLY.projectRefFrom("https://compninja.co"), null);
  assert.equal(APPLY.projectRefFrom("not a url"), null);
});

// --- logging the run ----------------------------------------------------------

test("insertAppliedRow lands after the last table row, not at end of file", () => {
  // APPLIED.md ends with prose and a <details> block; a row appended to the
  // file would sit outside the table and read as applied to nobody.
  const text = [
    "| File | Status | Evidence |",
    "|---|---|---|",
    "| 001-a.sql | applied | … |",
    "| 002-b.sql | applied | … |",
    "",
    "After a re-run, update the date above.",
  ].join("\n");
  const out = APPLY.insertAppliedRow(text, "| 003-c.sql | applied 2026-08-21 | … |");
  const lines = out.split("\n");
  assert.equal(lines[4], "| 003-c.sql | applied 2026-08-21 | … |");
  assert.ok(out.endsWith("After a re-run, update the date above."));
});

test("insertAppliedRow answers null rather than writing somewhere wrong", () => {
  assert.equal(APPLY.insertAppliedRow("no table here", "| 003-c.sql | x | y |"), null);
});

test("the real APPLIED.md still has a table this can log into", () => {
  const text = fs.readFileSync(path.join(__dirname, "..", "migrations", "APPLIED.md"), "utf8");
  const out = APPLY.insertAppliedRow(text, "| 999-test.sql | applied | … |");
  assert.ok(out && out.includes("| 999-test.sql | applied | … |"));
});

// --- flags --------------------------------------------------------------------

test("parseArgs refuses an unknown flag rather than guessing it", () => {
  // desktop.js's rule, and this one runs DDL: --ye must never mean --yes.
  assert.equal(APPLY.parseArgs(["--ye"]).unknown, "--ye");
  assert.equal(APPLY.parseArgs(["--yes"]).unknown, undefined);
  assert.equal(APPLY.parseArgs(["--yes"]).yes, true);
  assert.equal(APPLY.parseArgs(["037-x.sql", "--yes"]).files[0], "037-x.sql");
  assert.equal(APPLY.parseArgs(["--sql", "select 1"]).sql, "select 1");
  assert.equal(APPLY.parseArgs(["--sql", "select 1"]).write, false);
});

// --- the --check query --------------------------------------------------------

test("buildCheckQuery asks information_schema about verify.js's own lists", () => {
  const V = require("../migrations/verify.js");
  const q = APPLY.buildCheckQuery(V.TABLES, V.COLUMNS);
  // One source of truth for the expected schema, two transports to ask it.
  assert.ok(q.includes("'comp_corpus'"));
  assert.ok(q.includes("'beds_baths'"));
  assert.ok(q.includes("to_regclass"));
  assert.ok(q.includes("information_schema.columns"));
});

test("buildCheckQuery escapes quotes, since names reach it as SQL literals", () => {
  const q = APPLY.buildCheckQuery([["o'brien", "x.sql"]], [["t", ["c'd"], "x.sql"]]);
  assert.ok(q.includes("'o''brien'"));
  assert.ok(q.includes("'c''d'"));
});
