// gen-market-seed.js spends real money — one billed search per target that
// isn't cached, ~40 targets — so the two things worth pinning are that
// requiring it spends nothing, and that its target list stays well-formed.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SEED = require("../gen-market-seed.js");
const SRC = fs.readFileSync(path.join(__dirname, "..", "gen-market-seed.js"), "utf8");

test("requiring the module runs no searches", () => {
  // It had no require.main guard until 2026-08-31: importing it ran the whole
  // list at once. Reaching this line without ~40 searches having fired is the
  // assertion; the source scan below is what keeps it true.
  assert.ok(Array.isArray(SEED.TARGETS), "TARGETS should be exported");
  assert.ok(SRC.includes("require.main === module"),
    "the runner must stay behind a require.main guard");
});

test("every target names a type, a city and a state", () => {
  for (const t of SEED.TARGETS) {
    assert.ok(t.type && t.city && t.state, `incomplete target: ${JSON.stringify(t)}`);
    assert.match(t.state, /^[A-Z]{2}$/, `state should be a two-letter code: ${t.state}`);
  }
});

test("targets name property types the app actually has", () => {
  // A typo'd type bills a search and then fails the snapshot filter silently,
  // so the page never appears and nothing says why.
  const KNOWN = ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"];
  for (const t of SEED.TARGETS) {
    assert.ok(KNOWN.includes(t.type), `unknown property type: ${t.type}`);
  }
});

test("the Treasure Valley is covered", () => {
  // The first customer's whole market. market.js already groups these cities
  // as one metro for corpus retrieval, so a page missing here is a market that
  // renders nothing while the data behind it exists.
  const idaho = SEED.TARGETS.filter((t) => t.state === "ID").map((t) => `${t.type} ${t.city}`);
  for (const want of ["Industrial Boise", "Industrial Meridian", "Industrial Nampa"]) {
    assert.ok(idaho.includes(want), `missing target: ${want} (have: ${idaho.join(", ")})`);
  }
});

test("no target is listed twice", () => {
  // A duplicate is a search billed twice for one page.
  const keys = SEED.TARGETS.map((t) => `${t.type}|${t.city}|${t.state}`);
  assert.strictEqual(new Set(keys).size, keys.length, "duplicate target in TARGETS");
});
