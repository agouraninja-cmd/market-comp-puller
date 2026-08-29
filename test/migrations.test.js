// The migrations folder's two paper rules, made into build failures.
//
// 1. Migration numbers are unique. Two branches in flight both took 036
//    (bulk-valuations and org-shop-kind, merged an hour apart); APPLIED.md's
//    036 row asks that a future migration "start at 037" — a request nothing
//    enforced. That one collision is grandfathered BY EXACT FILENAME, so a
//    third 036, or any new pair, fails the suite (and therefore CI) instead
//    of being caught by a human reading APPLIED.md after the fact.
//
// 2. verify.js's TABLES list is complete. Its own comment says "KEEP IN STEP
//    WITH APPLIED.md — a new migration adds a line here", and nothing checked
//    it: 019 (broker_bovs), 021 (broker_csv_mappings) and 039 (org_contacts)
//    all created tables verify.js never asked about, so a run could answer
//    "Everything present" while three tables were absent. The list of
//    expected tables is read from the migration FILES, the way
//    helpers/migration-columns.js reads columns — a hand-written copy here
//    would be the same drift one shelf over.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "migrations");
const { TABLES, COLUMNS } = require("../migrations/verify.js");

const sqlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith(".sql")).sort();

// The one collision that already happened, both files applied to production
// (see APPLIED.md's 036 rows). Exact filenames, so nothing else rides in.
const GRANDFATHERED = new Set(["036-bulk-valuations.sql", "036-org-shop-kind.sql"]);

test("every migration file carries a zero-padded number prefix", () => {
  for (const f of sqlFiles) {
    assert.match(f, /^\d{3}-[a-z0-9-]+\.sql$/,
      `${f} does not follow the NNN-kebab-name.sql convention`);
  }
});

test("migration numbers are unique (beyond the recorded 036 pair)", () => {
  const byNumber = new Map();
  for (const f of sqlFiles) {
    const n = f.slice(0, 3);
    if (!byNumber.has(n)) byNumber.set(n, []);
    byNumber.get(n).push(f);
  }
  for (const [n, files] of byNumber) {
    if (files.length === 1) continue;
    const excused = files.every((f) => GRANDFATHERED.has(f));
    assert.ok(excused && files.length === GRANDFATHERED.size,
      `migration number ${n} is claimed by ${files.join(" and ")} — ` +
      `renumber before merging (APPLIED.md's 036 row is why this test exists)`);
  }
});

// Comment-stripped table names, migration-columns.js's approach: a table
// named only in prose must not count as created.
function tablesCreatedBy(file) {
  const sql = fs.readFileSync(path.join(ROOT, file), "utf8");
  const live = sql.split("\n").map((l) => l.split("--")[0]).join("\n");
  const out = [];
  const re = /create table (?:if not exists )?(?:public\.)?([a-z_]+)\s*\(/gi;
  for (let m; (m = re.exec(live)); ) out.push(m[1]);
  return out;
}

test("every table a migration creates is in verify.js's TABLES list", () => {
  const listed = new Map(TABLES.map(([t, m]) => [t, m]));
  for (const f of sqlFiles) {
    for (const t of tablesCreatedBy(f)) {
      assert.ok(listed.has(t),
        `${f} creates table "${t}" but migrations/verify.js's TABLES has no ` +
        `row for it — a verify run would answer "Everything present" with ` +
        `that table missing from production`);
    }
  }
});

test("every TABLES row names a table some migration actually creates, from the right file", () => {
  const created = new Map();
  for (const f of sqlFiles) for (const t of tablesCreatedBy(f)) created.set(t, f);
  for (const [t, m] of TABLES) {
    assert.ok(created.has(t),
      `verify.js's TABLES names "${t}" but no migration file creates it`);
    assert.strictEqual(created.get(t), m,
      `verify.js credits "${t}" to ${m} but it is created by ${created.get(t)}`);
  }
});

test("every migration named in verify.js exists as a file", () => {
  const files = new Set(sqlFiles);
  for (const [t, m] of TABLES) {
    assert.ok(files.has(m), `TABLES row "${t}" names missing file ${m}`);
  }
  for (const [t, cols, m] of COLUMNS) {
    assert.ok(files.has(m), `COLUMNS row "${t}.${cols[0]}" names missing file ${m}`);
  }
});

test("requiring verify.js runs nothing", () => {
  // The require at the top of this file already proved it — a network check
  // at require time would have thrown or hung the suite — but say so where a
  // future editor moving main() out of its require.main guard will read it.
  assert.ok(Array.isArray(TABLES) && TABLES.length >= 46);
  assert.ok(Array.isArray(COLUMNS) && COLUMNS.length >= 25);
});
