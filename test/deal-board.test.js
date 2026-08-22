// The deal board's counting, exhaustively. Pure like org-access.test.js: no
// server, no database, no clock — `now` is handed in.
//
// The rules worth breaking a build over are the three fail-closed ones in
// deal-board.js's header — attribution never guesses, an unreadable date is
// counted but not placed, truncation travels — plus the one this board exists
// to keep honest: it counts contribution, and contribution is share time, not
// deal time.
const test = require("node:test");
const assert = require("node:assert");
const BOARD = require("../deal-board.js");

const NOW = Date.parse("2026-08-22T18:00:00Z"); // a Saturday in Q3

const report = (over = {}) => ({
  id: over.id || "r1",
  market: "Los Angeles, CA",
  at: "2026-08-20T10:00:00Z",
  sharedBy: "Mike Rossi",
  sharedById: "u-mike",
  mine: false,
  ...over,
});
const comp = (over = {}) => ({
  id: over.id || "c1",
  market: "Los Angeles, CA",
  at: "2026-08-19T10:00:00Z",
  sharedBy: "Spencer Yu",
  sharedById: "u-spencer",
  mine: false,
  ...over,
});

// --- nothing to say --------------------------------------------------------

test("an empty firm gets null, not an empty board", () => {
  assert.equal(BOARD.build({ reports: [], comps: [], now: NOW }), null);
  assert.equal(BOARD.build({ now: NOW }), null);
  assert.equal(BOARD.build(), null);
});

test("one row anywhere is enough to build", () => {
  assert.ok(BOARD.build({ reports: [report()], now: NOW }));
  assert.ok(BOARD.build({ comps: [comp()], now: NOW }));
});

// --- fail-closed 1: attribution never guesses ------------------------------

test("the same person is one row across both sources, keyed on id", () => {
  const b = BOARD.build({
    reports: [report({ id: "r1", sharedById: "u-mike", sharedBy: "Mike Rossi" })],
    comps: [comp({ id: "c1", sharedById: "u-mike", sharedBy: "Mike Rossi" })],
    now: NOW,
  });
  assert.equal(b.members.length, 1);
  assert.equal(b.members[0].reports, 1);
  assert.equal(b.members[0].comps, 1);
  assert.equal(b.members[0].total, 2);
});

test("a renamed member does not split into two rows", () => {
  // 032 denormalizes shared_by_name at write time, so two rows from one person
  // legitimately carry different names. The id is what makes them one member.
  const b = BOARD.build({
    reports: [report({ sharedById: "u-mike", sharedBy: "Mike Rossi" })],
    comps: [comp({ sharedById: "u-mike", sharedBy: "Michael Rossi" })],
    now: NOW,
  });
  assert.equal(b.members.length, 1);
  assert.equal(b.members[0].total, 2);
});

test("two departed colleagues do not merge into one row", () => {
  // shared_by_user_id is SET NULL on account deletion (032) but the name
  // survives, so the name is the only key left and it must still separate them.
  const b = BOARD.build({
    comps: [
      comp({ id: "c1", sharedById: null, sharedBy: "Dana Wu" }),
      comp({ id: "c2", sharedById: null, sharedBy: "Ray Ortiz" }),
    ],
    now: NOW,
  });
  assert.equal(b.members.length, 2);
  assert.deepEqual(b.members.map((m) => m.total), [1, 1]);
});

test("rows with neither id nor name land in one declared bucket, not on a colleague", () => {
  const b = BOARD.build({
    reports: [
      report({ id: "r1", sharedById: "u-mike", sharedBy: "Mike Rossi" }),
      report({ id: "r2", sharedById: null, sharedBy: "" }),
      report({ id: "r3", sharedById: "", sharedBy: "   " }),
    ],
    now: NOW,
  });
  const anon = b.members.find((m) => m.key === BOARD.ANON_KEY);
  assert.ok(anon, "the unattributed bucket exists");
  assert.equal(anon.total, 2);
  assert.equal(anon.name, "", "the wire carries the absence; index.html picks the words");
  assert.equal(b.members.find((m) => m.key === "u:u-mike").total, 1);
});

// --- fail-closed 2: an unreadable date is counted but not placed -----------

test("an undated row still counts for its member, its market and the total", () => {
  const b = BOARD.build({
    reports: [report({ id: "r1", at: "" }), report({ id: "r2", at: "not a date" })],
    now: NOW,
  });
  assert.equal(b.totals.total, 2);
  assert.equal(b.totals.undated, 2);
  assert.equal(b.members[0].total, 2);
  assert.equal(b.markets[0].total, 2);
  assert.equal(b.months.length, 0, "and is absent from the month breakdown");
});

test("the month breakdown never silently disagrees with the total", () => {
  const b = BOARD.build({
    reports: [report({ id: "r1", at: "2026-08-20T10:00:00Z" }), report({ id: "r2", at: "" })],
    now: NOW,
  });
  const placed = b.months.reduce((n, m) => n + m.total, 0);
  assert.equal(placed + b.totals.undated, b.totals.total);
});

test("an undated row is not counted into a leaderboard window", () => {
  const b = BOARD.build({ reports: [report({ at: "" })], now: NOW });
  assert.equal(b.leaderboard.month.rows.length, 0);
  assert.equal(b.leaderboard.quarter.rows.length, 0);
});

// --- fail-closed 3: truncation travels -------------------------------------

test("truncation is re-emitted, not inferred", () => {
  assert.equal(BOARD.build({ reports: [report()], now: NOW }).truncated, false);
  assert.equal(BOARD.build({ reports: [report()], now: NOW, truncated: true }).truncated, true);
});

// --- the month is the share date, not the deal date ------------------------

test("bucketing is by the date handed in, in UTC", () => {
  assert.equal(BOARD.monthKey("2026-08-20T10:00:00Z"), "2026-08");
  assert.equal(BOARD.monthKey("2026-01-01T00:00:00Z"), "2026-01");
  // The last instant of July UTC stays in July, whatever the reader's zone.
  assert.equal(BOARD.monthKey("2026-07-31T23:59:59Z"), "2026-07");
  assert.equal(BOARD.monthKey("2026-08-01T00:00:00Z"), "2026-08");
  assert.equal(BOARD.monthKey(""), "");
  assert.equal(BOARD.monthKey(null), "");
  assert.equal(BOARD.monthKey("whenever"), "");
});

test("a decade of old deals imported today counts as this month", () => {
  // The reason the board reads created_at rather than deal_date: `at` is share
  // time, so a bulk import shows up as contribution now, not as closings then.
  const b = BOARD.build({
    comps: [
      comp({ id: "c1", at: "2026-08-22T09:00:00Z" }),
      comp({ id: "c2", at: "2026-08-22T09:00:01Z" }),
    ],
    now: NOW,
  });
  assert.equal(b.months[0].month, "2026-08");
  assert.equal(b.months[0].total, 2);
  assert.equal(b.leaderboard.month.rows[0].total, 2);
});

// --- windows are calendar-aligned ------------------------------------------

test("this month and this quarter are calendar-aligned, not rolling", () => {
  assert.equal(new Date(BOARD.startOfMonth(NOW)).toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(new Date(BOARD.startOfQuarter(NOW)).toISOString(), "2026-07-01T00:00:00.000Z");
  // Every quarter boundary, so the floor-by-3 cannot drift.
  const q = (iso) => new Date(BOARD.startOfQuarter(Date.parse(iso))).toISOString().slice(0, 10);
  assert.equal(q("2026-01-15T00:00:00Z"), "2026-01-01");
  assert.equal(q("2026-03-31T23:59:59Z"), "2026-01-01");
  assert.equal(q("2026-04-01T00:00:00Z"), "2026-04-01");
  assert.equal(q("2026-09-30T23:59:59Z"), "2026-07-01");
  assert.equal(q("2026-12-31T23:59:59Z"), "2026-10-01");
});

test("last month's share is on the board but not in this month's leaderboard", () => {
  const b = BOARD.build({
    reports: [
      report({ id: "r1", sharedById: "u-mike", at: "2026-08-20T10:00:00Z" }),
      report({ id: "r2", sharedById: "u-dana", sharedBy: "Dana Wu", at: "2026-07-05T10:00:00Z" }),
    ],
    now: NOW,
  });
  assert.equal(b.members.length, 2, "both are on the board");
  assert.deepEqual(b.leaderboard.month.rows.map((r) => r.key), ["u:u-mike"]);
  // July is the same quarter as August, so the quarter board holds both.
  assert.equal(b.leaderboard.quarter.rows.length, 2);
});

test("the windows declare where they start", () => {
  const b = BOARD.build({ reports: [report()], now: NOW });
  assert.equal(b.leaderboard.month.since, "2026-08-01T00:00:00.000Z");
  assert.equal(b.leaderboard.quarter.since, "2026-07-01T00:00:00.000Z");
});

// --- ordering is stable ----------------------------------------------------

test("members sort by contribution, and ties break by name so nothing reshuffles", () => {
  const b = BOARD.build({
    reports: [
      report({ id: "r1", sharedById: "u-z", sharedBy: "Zoe Adams" }),
      report({ id: "r2", sharedById: "u-a", sharedBy: "Adam Zeller" }),
      report({ id: "r3", sharedById: "u-m", sharedBy: "Mike Rossi" }),
      report({ id: "r4", sharedById: "u-m" }),
    ],
    now: NOW,
  });
  assert.deepEqual(b.members.map((m) => m.name), ["Mike Rossi", "Adam Zeller", "Zoe Adams"]);
  // Same input, same order, twice.
  const again = BOARD.build({
    reports: [
      report({ id: "r2", sharedById: "u-a", sharedBy: "Adam Zeller" }),
      report({ id: "r1", sharedById: "u-z", sharedBy: "Zoe Adams" }),
      report({ id: "r4", sharedById: "u-m", sharedBy: "Mike Rossi" }),
      report({ id: "r3", sharedById: "u-m", sharedBy: "Mike Rossi" }),
    ],
    now: NOW,
  });
  assert.deepEqual(again.members.map((m) => m.name), b.members.map((m) => m.name));
});

test("months come back recent first", () => {
  const b = BOARD.build({
    reports: [
      report({ id: "r1", at: "2026-06-10T00:00:00Z" }),
      report({ id: "r2", at: "2026-08-10T00:00:00Z" }),
      report({ id: "r3", at: "2026-07-10T00:00:00Z" }),
    ],
    now: NOW,
  });
  assert.deepEqual(b.months.map((m) => m.month), ["2026-08", "2026-07", "2026-06"]);
});

// --- markets ----------------------------------------------------------------

test("markets count both sources and skip rows with no market", () => {
  const b = BOARD.build({
    reports: [report({ id: "r1", market: "Los Angeles, CA" }), report({ id: "r2", market: "" })],
    comps: [comp({ id: "c1", market: "Los Angeles, CA" }), comp({ id: "c2", market: "Phoenix, AZ" })],
    now: NOW,
  });
  assert.equal(b.markets.length, 2);
  assert.equal(b.markets[0].market, "Los Angeles, CA");
  assert.equal(b.markets[0].reports, 1);
  assert.equal(b.markets[0].comps, 1);
  assert.equal(b.totals.total, 4, "the market-less row still counts in the total");
});

test("a member's market count is distinct markets, not rows", () => {
  const b = BOARD.build({
    reports: [
      report({ id: "r1", market: "Los Angeles, CA" }),
      report({ id: "r2", market: "Los Angeles, CA" }),
      report({ id: "r3", market: "Phoenix, AZ" }),
    ],
    now: NOW,
  });
  assert.equal(b.members[0].markets, 2);
});

// --- display caps are caps on the panel, never on the count ----------------

test("more than twelve months is capped and says so", () => {
  const reports = [];
  for (let i = 0; i < 14; i++) {
    const m = String((i % 12) + 1).padStart(2, "0");
    const y = 2025 + Math.floor(i / 12);
    reports.push(report({ id: "r" + i, at: `${y}-${m}-05T00:00:00Z` }));
  }
  const b = BOARD.build({ reports, now: NOW });
  assert.equal(b.months.length, BOARD.MAX_MONTHS);
  assert.equal(b.monthsTruncated, true);
  assert.equal(b.totals.total, 14, "the total is still every row");
});

test("the leaderboard caps at ten but the member list does not", () => {
  const reports = [];
  for (let i = 0; i < 15; i++) {
    reports.push(report({ id: "r" + i, sharedById: "u-" + i, sharedBy: "Member " + i }));
  }
  const b = BOARD.build({ reports, now: NOW });
  assert.equal(b.leaderboard.month.rows.length, BOARD.MAX_LEADERS);
  assert.equal(b.members.length, 15);
  assert.equal(b.totals.members, 15);
});

// --- the caller's own rows are flagged --------------------------------------

test("mine survives onto the member row and the leaderboard", () => {
  const b = BOARD.build({
    reports: [report({ id: "r1", sharedById: "u-mike", mine: true }), report({ id: "r2", sharedById: "u-mike" })],
    comps: [comp({ id: "c1", sharedById: "u-spencer" })],
    now: NOW,
  });
  assert.equal(b.members.find((m) => m.key === "u:u-mike").mine, true);
  assert.equal(b.members.find((m) => m.key === "u:u-spencer").mine, false);
  assert.equal(b.leaderboard.month.rows.find((r) => r.key === "u:u-mike").mine, true);
});

// --- lastAt -----------------------------------------------------------------

test("lastAt is the member's most recent share across both sources", () => {
  const b = BOARD.build({
    reports: [report({ sharedById: "u-mike", at: "2026-08-01T00:00:00Z" })],
    comps: [comp({ sharedById: "u-mike", at: "2026-08-18T00:00:00Z" })],
    now: NOW,
  });
  assert.equal(b.members[0].lastAt, "2026-08-18T00:00:00Z");
});

// --- junk in the row array does not take the board down ---------------------

test("null rows are skipped rather than thrown on", () => {
  const b = BOARD.build({ reports: [null, report(), undefined], comps: [null], now: NOW });
  assert.equal(b.members.length, 1);
  assert.equal(b.members[0].total, 1);
});

test("a non-array source is treated as empty", () => {
  const b = BOARD.build({ reports: report(), comps: [comp()], now: NOW });
  assert.equal(b.totals.reports, 0);
  assert.equal(b.totals.comps, 1);
});
