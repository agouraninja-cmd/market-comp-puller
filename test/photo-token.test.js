"use strict";

const test = require("node:test");
const assert = require("node:assert");
const T = require("../photo-token");

// photo-token.js puts an address in an img URL without putting it in the
// clear (CLAUDE.md rule 7: never an address in a URL). These pin the four
// properties the route leans on.

const SECRET = "test-street-view-key";
const ADDR = "2300 Peachtree Rd NE, Atlanta, GA 30309";

test("a token opens back to the address it sealed, normalized", () => {
  const t = T.seal(ADDR, SECRET);
  assert.ok(t);
  assert.equal(T.open(t, SECRET), "2300 peachtree rd ne, atlanta, ga 30309");
});

test("the token names no part of the address, and is URL-safe", () => {
  const t = T.seal(ADDR, SECRET);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
  for (const part of ["2300", "peachtree", "Peachtree", "atlanta", "30309"]) {
    assert.ok(!t.includes(part), `token leaks "${part}"`);
  }
});

test("the same address always seals to the same token, so the browser caches one URL", () => {
  assert.equal(T.seal(ADDR, SECRET), T.seal(ADDR, SECRET));
  assert.equal(T.seal(ADDR, SECRET), T.seal("  2300 PEACHTREE RD NE,  Atlanta, GA 30309, ", SECRET));
  assert.notEqual(T.seal(ADDR, SECRET), T.seal("2302 Peachtree Rd NE, Atlanta, GA 30309", SECRET));
});

test("a token the server did not mint opens to null", () => {
  const t = T.seal(ADDR, SECRET);
  assert.equal(T.open(t, "another-key"), null, "another key");
  const flipped = t.slice(0, 20) + (t[20] === "A" ? "B" : "A") + t.slice(21);
  assert.equal(T.open(flipped, SECRET), null, "tampered");
  assert.equal(T.open(t.slice(0, 30), SECRET), null, "truncated");
  assert.equal(T.open("2" + t.slice(1), SECRET), null, "another version");
  assert.equal(T.open("", SECRET), null);
  assert.equal(T.open(null, SECRET), null);
  assert.equal(T.open("1!!!", SECRET), null);
});

test("no secret or no address mints nothing", () => {
  assert.equal(T.seal(ADDR, ""), null);
  assert.equal(T.seal("", SECRET), null);
  assert.equal(T.open(T.seal(ADDR, SECRET), ""), null);
});
