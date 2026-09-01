// An address with no city and state is the quietest way to lose a vault comp.
//
// server.js attaches `market` with marketOf(), which hands back the string it
// was given when it cannot parse one — so "6200 W Gowen Rd" becomes a market
// called "6200 W Gowen Rd". Nothing fails. The comp is stored, and then it
// never appears in the broker's own reports (corpus retrieval keys on market),
// the vault rollup grows one bucket per building, and the gut check has no
// peers to compare it against.
//
// It is not hypothetical: a developer's or owner-operator's own tracking sheet
// keeps Address, City and State in three separate columns, and only the first
// can be mapped onto `address`.

const { test } = require("node:test");
const assert = require("node:assert");

const VAULT = require("../broker-vault.js");
const { marketOf } = require("../market.js");

const HEAD = "address,property_type,transaction,deal_date,price,size_sqft";
const bare = [HEAD, "6200 W Gowen Rd,Industrial,sale,03/15/2026,1200000,24500"].join("\n");
const whole = [HEAD, "\"6200 W Gowen Rd, Boise, ID\",Industrial,sale,03/15/2026,1200000,24500"].join("\n");

// The predicate server.js injects, restated here so this file tests the rule
// rather than a stub of it. Kept in step with addressHasMarket in server.js.
const hasMarket = (a) => /^[^,]+,\s[A-Z]{2}$/.test(marketOf(a));

test("the premise: marketOf cannot fail, it hands back what it was given", () => {
  // The whole reason this guard has to exist. If market.js ever started
  // returning "" or throwing for an unparseable address, the predicate below
  // would change meaning and this file should be re-read.
  assert.strictEqual(marketOf("6200 W Gowen Rd"), "6200 W Gowen Rd");
  assert.strictEqual(marketOf("6200 W Gowen Rd, Boise, ID"), "Boise, ID");
});

test("without the predicate, behaviour is exactly what it was before", () => {
  // Injected, never required: every existing caller must be unaffected.
  const out = VAULT.parseUpload(bare);
  assert.strictEqual(out.rows.length, 1, "a bare street address still imports when nothing checks");
  assert.strictEqual(out.rows[0].address, "6200 W Gowen Rd");
});

test("with the predicate, a city-less address is refused rather than misfiled", () => {
  const out = VAULT.parseUpload(bare, { hasMarket });
  assert.strictEqual(out.rows.length, 0, "the comp must not be stored under a market that does not exist");
  assert.strictEqual(out.skipped, 1);
  assert.strictEqual(out.errors.length, 1);
  assert.match(out.errors[0], /Line 2:/, "the broker has to be told which row");
  // "a two-letter state" specifically: market.js keeps state codes, so a
  // spelled-out "Idaho" lands here too, and "needs a city and state" alone is
  // baffling advice to somebody who can see both words in their file.
  assert.match(out.errors[0], /city and a two-letter state/, "and what is actually wrong");
  assert.match(out.errors[0], /Boise, ID/, "and what the fix looks like");
});

test("a whole address passes the predicate untouched", () => {
  const out = VAULT.parseUpload(whole, { hasMarket });
  assert.strictEqual(out.rows.length, 1);
  assert.strictEqual(marketOf(out.rows[0].address), "Boise, ID");
});

test("one bad address costs its own row, never the file", () => {
  // parseUpload's standing rule: a typo in row 400 must not reject 399 good
  // comps. The new refusal is subject to it like every other.
  const mixed = [HEAD,
    "\"6200 W Gowen Rd, Boise, ID\",Industrial,sale,03/15/2026,1200000,24500",
    "3155 E Copper Point Dr,Industrial,sale,01/02/2026,900000,18200",
    "\"805 S Progress Ave, Meridian, ID\",Industrial,sale,06/01/2025,750000,12750",
  ].join("\n");
  const out = VAULT.parseUpload(mixed, { hasMarket });
  assert.strictEqual(out.rows.length, 2, "the two whole addresses still import");
  assert.strictEqual(out.skipped, 1);
  assert.match(out.errors[0], /Line 3:/, "and the refusal points at the row Excel shows");
});

test("the predicate accepts the shapes marketOf really produces", () => {
  // Two-word cities and a Canadian province both key normally; the guard must
  // not quietly start refusing markets the corpus has always accepted.
  for (const good of ["100 Main St, Coeur d'Alene, ID", "1 King St W, Toronto, ON",
                      "500 Warehouse Way, Garden City, ID"]) {
    assert.ok(hasMarket(good), `${good} should key to a market`);
  }
  for (const bad of ["6200 W Gowen Rd", "Boise", ""]) {
    assert.ok(!hasMarket(bad), `${bad} should not`);
  }
});
