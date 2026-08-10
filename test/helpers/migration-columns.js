// Parse the columns a table actually has, straight out of the migration
// files, rather than restating them in a hand-written list a future migration
// could silently drift out of step with. Shared by every test that checks a
// storage contract against the real schema (vault-api.test.js's original
// use, and broker-vault.test.js's write-payload check) — a second
// hand-written copy would itself become the kind of list this exists to
// avoid trusting.
//
// Scans EVERY migration rather than naming the ones that exist today. The
// first version of this named 013 and 014 explicitly, which meant migration
// 016 added a column and the check happily reported the contract complete —
// the exact failure it was written to prevent, in its own implementation.
const fs = require("node:fs");
const path = require("node:path");

function migrationColumns(table = "broker_comps") {
  const root = path.join(__dirname, "..", "..", "migrations");
  const files = fs.readdirSync(root).filter((f) => f.endsWith(".sql")).sort();
  const cols = [];
  for (const f of files) {
    const sql = fs.readFileSync(path.join(root, f), "utf8");
    // Strip comments first, so a column named only in prose is not counted.
    const live = sql.split("\n").map((l) => l.split("--")[0]).join("\n");

    const create = new RegExp(
      `create table (?:if not exists )?${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i").exec(live);
    if (create) {
      for (const rawLine of create[1].split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        if (/^(unique|primary key|constraint|foreign key|check)\b/i.test(line)) continue;
        for (const part of line.split(",")) {
          const m = /^([a-z_]+)\s+(uuid|text|numeric|date|boolean|timestamptz|bigint|int)\b/.exec(part.trim());
          if (m) cols.push(m[1]);
        }
      }
    }
    // ALTER TABLE <table> ... ADD COLUMN [IF NOT EXISTS] <name>
    for (const alter of live.matchAll(new RegExp(`alter table\\s+${table}\\b([\\s\\S]*?);`, "gi"))) {
      for (const m of alter[1].matchAll(/add column\s+(?:if not exists\s+)?([a-z_]+)/gi)) {
        cols.push(m[1]);
      }
    }
  }
  return [...new Set(cols)];
}

module.exports = { migrationColumns };
