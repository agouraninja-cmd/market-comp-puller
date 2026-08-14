"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pickExploreAddresses, streetKey, MAX_ADDRESSES } = require("../explore-addresses");

function isAggregateAddress(address) {
  return /\bmedian\b/i.test(String(address || ""));
}
function parseDealDate(s) {
  const t = String(s || "");
  if (t === "Mar 2026") return 2026.2;
  if (t === "Jan 2026") return 2026.04;
  if (t === "Jun 2025") return 2025.46;
  if (t === "Jan 2025") return 2025.04;
  return 0;
}
function pick(rows, extra) {
  return pickExploreAddresses(rows, {
    market: "Boise, ID",
    isAggregateAddress,
    parseDealDate,
    ...extra,
  });
}

const IND = (addr, date) => ({ address: addr, property_type: "Industrial", deal_date: date });
const OFF = (addr, date) => ({ address: addr, property_type: "Office", deal_date: date });
const RET = (addr, date) => ({ address: addr, property_type: "Retail", deal_date: date });

test("a typed request still returns only that type", () => {
  const out = pick([
    IND("100 Warehouse Way, Boise, ID", "Mar 2026"),
    OFF("200 Capitol Blvd, Boise, ID", "Mar 2026"),
    IND("300 Dock St, Boise, ID", "Jan 2026"),
  ], { type: "Industrial" });
  assert.equal(out.length, 2);
  assert.ok(out.every((a) => a.type === "Industrial"));
  assert.equal(out[0].address, "100 Warehouse Way, Boise, ID");
});

test("a type-less request labels every address and mixes classes", () => {
  const out = pick([
    IND("100 Warehouse Way, Boise, ID", "Mar 2026"),
    IND("101 Warehouse Way, Boise, ID", "Jan 2026"),
    IND("102 Warehouse Way, Boise, ID", "Jun 2025"),
    OFF("200 Capitol Blvd, Boise, ID", "Mar 2026"),
    RET("300 Grove St, Boise, ID", "Jan 2026"),
  ]);
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((a) => a.type), [
    "Industrial", "Office", "Retail", "Industrial", "Industrial",
  ]);
  assert.ok(out.every((a) => a.address && a.type));
});

test("the same street under two types keeps the newer deal's class", () => {
  const out = pick([
    IND("100 Main St, Boise, ID", "Jan 2025"),
    OFF("100 Main Street, Boise, ID", "Mar 2026"),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "Office");
  assert.equal(streetKey("100 Main St"), streetKey("100 Main Street"));
});

test("aggregate rows, portfolio rows, and quantity 'addresses' are skipped", () => {
  const out = pick([
    IND("Boise industrial median", "Mar 2026"),
    IND("3351 E Philadelphia St & 4450 E Lowell St, Boise, ID", "Mar 2026"),
    IND("10000 SF warehouse, Boise, ID", "Mar 2026"),
    IND("12 units, Boise, ID", "Mar 2026"),
    OFF("200 Capitol Blvd, Boise, ID", "Mar 2026"),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].address, "200 Capitol Blvd, Boise, ID");
});

test("a street-only row gets the market appended", () => {
  const out = pick([IND("100 Warehouse Way", "Mar 2026")]);
  assert.equal(out[0].address, "100 Warehouse Way, Boise, ID");
});

test("the list is capped", () => {
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push(IND(`${100 + i} Warehouse Way, Boise, ID`, "Mar 2026"));
    rows.push(OFF(`${200 + i} Capitol Blvd, Boise, ID`, "Mar 2026"));
  }
  const out = pick(rows);
  assert.equal(out.length, MAX_ADDRESSES);
  assert.equal(out.filter((a) => a.type === "Industrial").length, 4);
  assert.equal(out.filter((a) => a.type === "Office").length, 4);
});

test("empty or garbage input is an empty list, never a throw", () => {
  assert.deepEqual(pickExploreAddresses(null, {}), []);
  assert.deepEqual(pickExploreAddresses(undefined), []);
  assert.deepEqual(pick([{ address: "", property_type: "Industrial" }]), []);
});
