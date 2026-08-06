// The property dimension — migrations/016-broker-comps-star.sql
//
// The rule these pin is that the JS derivation and the SQL backfill in 016
// describe a building the SAME way. If they drift, a comp imported today gets
// a different property row from one imported yesterday, and the dimension
// stops being a dimension.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { propertyRowsFrom, indexById, isMoreRecent } = require("../broker-properties");

function comp(over = {}) {
  return {
    user_id: "u-1",
    address_key: "1450 mission ave",
    address: "1450 Mission Ave",
    market: "Boise, ID",
    property_type: "Industrial",
    deal_date: "2026-03-14",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

test("repeat deals on one building collapse to one property row", () => {
  const rows = propertyRowsFrom([
    comp({ deal_date: "2024-01-01" }),
    comp({ deal_date: "2025-06-01" }),
    comp({ deal_date: "2026-03-14" }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].address_key, "1450 mission ave");
});

test("the date range spans every deal, not just the newest", () => {
  const [row] = propertyRowsFrom([
    comp({ deal_date: "2025-06-01" }),
    comp({ deal_date: "2024-01-01" }),
    comp({ deal_date: "2026-03-14" }),
  ]);
  assert.equal(row.first_seen, "2024-01-01");
  assert.equal(row.last_seen, "2026-03-14");
});

test("the description follows the MOST RECENT deal", () => {
  // Brokers re-import with the address typed differently. The newest spelling
  // is the closest to how they write it today — and it is the rule 016's
  // backfill uses, so the two must agree.
  const [row] = propertyRowsFrom([
    comp({ deal_date: "2024-01-01", address: "1450 Mission Avenue", property_type: "Office" }),
    comp({ deal_date: "2026-03-14", address: "1450 Mission Ave", property_type: "Industrial" }),
  ]);
  assert.equal(row.address, "1450 Mission Ave");
  assert.equal(row.property_type, "Industrial");
});

test("input order does not change the result", () => {
  const a = propertyRowsFrom([
    comp({ deal_date: "2024-01-01", address: "Old spelling" }),
    comp({ deal_date: "2026-03-14", address: "New spelling" }),
  ]);
  const b = propertyRowsFrom([
    comp({ deal_date: "2026-03-14", address: "New spelling" }),
    comp({ deal_date: "2024-01-01", address: "Old spelling" }),
  ]);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// The privacy wall
// ---------------------------------------------------------------------------

test("TWO BROKERS ON THE SAME BUILDING GET SEPARATE PROPERTY ROWS", () => {
  // Deduplicating across brokers would make one broker's activity inferable
  // from another's row. That is exactly the inference the vault exists to
  // prevent — a shared property row is not a saving, it is a leak.
  const rows = propertyRowsFrom([
    comp({ user_id: "broker-a" }),
    comp({ user_id: "broker-b" }),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.user_id).sort(), ["broker-a", "broker-b"]);
});

test("a row with no user_id is never grouped", () => {
  assert.deepEqual(propertyRowsFrom([comp({ user_id: null })]), []);
});

// ---------------------------------------------------------------------------
// Junk
// ---------------------------------------------------------------------------

test("a row with no address_key is skipped, not grouped under empty string", () => {
  // Such a row could never be matched back to a comp, so it would be a
  // permanent orphan in the dimension.
  assert.deepEqual(propertyRowsFrom([comp({ address_key: "" })]), []);
  assert.deepEqual(propertyRowsFrom([comp({ address_key: undefined })]), []);
});

test("comps with no date still produce a property row", () => {
  const [row] = propertyRowsFrom([comp({ deal_date: null })]);
  assert.equal(row.address_key, "1450 mission ave");
  assert.equal(row.first_seen, null);
  assert.equal(row.last_seen, null);
});

test("a dated deal beats an undated one for the description", () => {
  assert.equal(isMoreRecent(comp({ deal_date: "2020-01-01" }), comp({ deal_date: null })), true);
  assert.equal(isMoreRecent(comp({ deal_date: null }), comp({ deal_date: "2020-01-01" })), false);
});

test("junk in does not throw", () => {
  assert.deepEqual(propertyRowsFrom(null), []);
  assert.deepEqual(propertyRowsFrom("nonsense"), []);
  assert.deepEqual(propertyRowsFrom([null, undefined, "x", 5]), []);
});

test("the internal bookkeeping field never reaches the database row", () => {
  const [row] = propertyRowsFrom([comp()]);
  assert.equal("_newest" in row, false);
  assert.deepEqual(Object.keys(row).sort(),
    ["address", "address_key", "first_seen", "last_seen", "market", "property_type", "user_id"]);
});

// ---------------------------------------------------------------------------
// indexById
// ---------------------------------------------------------------------------

test("the returned rows become an address_key -> id lookup", () => {
  const idx = indexById([
    { id: "p-1", address_key: "1450 mission ave" },
    { id: "p-2", address_key: "9 other st" },
    { id: null, address_key: "no id" },
    null,
  ]);
  assert.equal(idx.get("1450 mission ave"), "p-1");
  assert.equal(idx.get("9 other st"), "p-2");
  assert.equal(idx.has("no id"), false);
  assert.equal(idx.size, 2);
});

// ---------------------------------------------------------------------------
// Agreement with the migration
// ---------------------------------------------------------------------------

test("the migration is additive: it drops and renames nothing", () => {
  // The vault holds brokers' uploaded books and there is no staging database
  // to rehearse against. If this file ever grows a destructive statement,
  // that is a decision someone should have to make on purpose.
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "migrations", "016-broker-comps-star.sql"), "utf8");
  const live = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").toLowerCase();
  for (const forbidden of ["drop table", "drop column", "rename to", "rename column", "truncate", "delete from"]) {
    assert.equal(live.includes(forbidden), false,
      `016 contains "${forbidden}" outside a comment — it is meant to be purely additive`);
  }
});

test("the migration keeps property_id nullable", () => {
  // NOT NULL would break every upload in the window between applying the
  // migration by hand and deploying the code that populates it.
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "migrations", "016-broker-comps-star.sql"), "utf8");
  const addCol = /add column if not exists property_id[^;]*/i.exec(sql)[0].toLowerCase();
  assert.equal(addCol.includes("not null"), false);
});
