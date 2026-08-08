// test/bov-log.test.js
// The BOV tracker's rules. Pure like broker-leads.js: no I/O, no clock
// (rollup takes `now`), which is what lets npm test cover the practice
// log's math with no database.
// Spec: docs/superpowers/specs/2026-08-08-bov-tracking-design.md

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const BOV = require("../bov-log");

// The vocabulary is the contract the check constraints in migration 019
// and the UI's <select>s both restate. Pin it exactly.
test("source and status vocabularies", () => {
  assert.deepEqual(BOV.SOURCES, ["compninja", "referral", "repeat_client", "other"]);
  assert.deepEqual(BOV.STATUSES, ["open", "delivered", "won", "lost"]);
  assert.ok(BOV.isSource("referral"));
  assert.ok(!BOV.isSource("Referral"));   // exact, the UI select is the caller
  assert.ok(!BOV.isSource(""));
  assert.ok(BOV.isStatus("lost"));
  assert.ok(!BOV.isStatus("cancelled"));
  assert.ok(!BOV.isStatus(null));
});

test("cleanNotes and cleanAddress trim, cap, and null out emptiness", () => {
  assert.equal(BOV.cleanNotes("  called twice  "), "called twice");
  assert.equal(BOV.cleanNotes(""), null);
  assert.equal(BOV.cleanNotes(null), null);
  assert.equal(BOV.cleanNotes("x".repeat(600)).length, 500);
  assert.equal(BOV.cleanAddress("x".repeat(400)).length, 300);
  assert.equal(BOV.cleanAddress("   "), null);
});

// ISO only. The form's <input type=date> emits exactly this; anything else
// is refused rather than guessed (the vault importer's rule).
test("cleanReceivedOn accepts ISO, refuses everything else, allows empty", () => {
  assert.deepEqual(BOV.cleanReceivedOn("2026-08-08"), { ok: true, value: "2026-08-08" });
  assert.deepEqual(BOV.cleanReceivedOn(""), { ok: true, value: null });
  assert.deepEqual(BOV.cleanReceivedOn(undefined), { ok: true, value: null });
  assert.equal(BOV.cleanReceivedOn("2026-02-30").ok, false);  // not a real date
  assert.equal(BOV.cleanReceivedOn("8/5/2026").ok, false);    // not ISO
  assert.equal(BOV.cleanReceivedOn("45000").ok, false);       // Excel serial
});

test("rollup counts statuses, the year, and holds the win rate to the floor", () => {
  const now = Date.parse("2026-08-08T12:00:00Z");
  const rows = [
    { status: "open",      received_on: "2026-01-05" },
    { status: "delivered", received_on: "2026-03-01" },
    { status: "won",       received_on: "2025-11-20" },   // last year
    { status: "lost",      created_at: "2026-02-02T00:00:00Z" }, // no received_on
  ];
  const r = BOV.rollup(rows, now);
  assert.equal(r.total, 4);
  assert.equal(r.thisYear, 3);      // the 2025 row is out
  assert.equal(r.open, 1);
  assert.equal(r.delivered, 1);
  assert.equal(r.won, 1);
  assert.equal(r.lost, 1);
  assert.equal(r.decided, 2);
  // 2 decided is under the floor of 3: a rate over so few reads as a joke.
  assert.equal(r.winRate, null);
});

test("rollup shows a win rate at the floor, and survives junk rows", () => {
  const now = Date.parse("2026-08-08T12:00:00Z");
  const rows = [
    { status: "won", received_on: "2026-01-01" },
    { status: "won", received_on: "2026-01-02" },
    { status: "lost", received_on: "2026-01-03" },
    null,
    { status: "nonsense", received_on: "2026-01-04" },  // counted in total only
  ];
  const r = BOV.rollup(rows, now);
  assert.equal(r.decided, 3);
  assert.ok(Math.abs(r.winRate - 2 / 3) < 1e-9);
  assert.equal(r.total, 4);   // null skipped, junk-status row still a row
});

test("rollup of an empty log is all zeros and no rate", () => {
  const r = BOV.rollup([], Date.parse("2026-08-08T00:00:00Z"));
  assert.deepEqual(r, { total: 0, thisYear: 0, open: 0, delivered: 0,
    won: 0, lost: 0, decided: 0, winRate: null });
});

// Seeding: the caller (server.js) supplies intro requests joined to their
// leads with `market` already computed by marketOf(). This module never
// parses an address; it takes the canonical-market predicate as an
// argument rather than growing a second copy of broker-leads.js's regex.
test("seedFromIntroRequests shapes rows, dedupes, and drops bad markets", () => {
  const { isCanonicalMarket } = require("../broker-leads");
  const joined = [
    { lead_id: 7, market: "Boise, ID", property_type: "Industrial",
      size_sqft: 42000, ts: "2026-08-01T10:00:00Z" },
    { lead_id: 7, market: "Boise, ID", property_type: "Industrial",
      size_sqft: 42000, ts: "2026-08-01T10:00:00Z" },          // duplicate id
    { lead_id: 8, market: "123 Main St", property_type: "Office",
      size_sqft: null, ts: "2026-08-02T10:00:00Z" },           // marketOf fallback junk
    { lead_id: 9, market: "Meridian, ID", property_type: "",
      size_sqft: null, ts: "bad" },                            // no type
    { lead_id: 10, market: "Meridian, ID", property_type: "Retail",
      size_sqft: null, ts: "not-a-date" },
  ];
  const rows = BOV.seedFromIntroRequests(joined, isCanonicalMarket);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    lead_id: 7, market: "Boise, ID", property_type: "Industrial",
    size_sqft: 42000, received_on: "2026-08-01",
    source: "compninja", status: "open",
  });
  // An unparseable ts seeds with no received_on rather than an invented one.
  assert.equal(rows[1].received_on, null);
  assert.equal(rows[1].lead_id, 10);
});

// Migration 019 guard: purely additive, because there is no staging
// database to rehearse against (016's rule, applied to the new file).
test("migration 019 contains no destructive statement", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "migrations", "019-broker-bovs.sql"), "utf8").toLowerCase();
  for (const forbidden of ["drop table", "drop column", "rename to",
                           "rename column", "truncate", "delete from"]) {
    assert.ok(!sql.includes(forbidden), "019 contains destructive statement: " + forbidden);
  }
});
