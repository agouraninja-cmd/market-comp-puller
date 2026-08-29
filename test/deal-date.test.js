"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseDealDate } = require("../deal-date");

test("parseDealDate returns null for empty and on-market sentinels", () => {
  assert.equal(parseDealDate(""), null);
  assert.equal(parseDealDate("   "), null);
  assert.equal(parseDealDate(null), null);
  assert.equal(parseDealDate("Active"), null);
  assert.equal(parseDealDate("Listed Mar 2025"), null);
  assert.equal(parseDealDate("Listed Apr 2026"), null);
  assert.equal(parseDealDate("Active listing 2025-2026"), null);
  assert.equal(parseDealDate("2024-2025"), null);
  // The vault's own dateless sentinel (042). It never reaches the corpus
  // (canPublish refuses an undated comp), but the word must stay unparseable
  // here the way "Active" is — a sentinel a date parser could read would stop
  // being a sentinel.
  assert.equal(parseDealDate("undated"), null);
});

test("parseDealDate still parses closed-looking month-year strings", () => {
  assert.equal(parseDealDate("Mar 2025"), 2025 + (3 - 0.5) / 12);
  assert.equal(parseDealDate("Jul 2026"), 2026 + (7 - 0.5) / 12);
  assert.equal(parseDealDate("2025"), 2025.5);
});
