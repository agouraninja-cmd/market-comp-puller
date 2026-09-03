// Suggesting a "City, ST" for the bare addresses in a file (2026-09-02).
//
// test/vault-address-market.test.js proves the REFUSAL: an address with no
// city and state is not filed under a market called "6200 W Gowen Rd". This
// file proves the other half — that a broker whose spreadsheet omits the city
// because everyone at the firm knows it is offered the completion rather than
// told to go edit the file, and that nothing about that offer ever writes an
// address on its own. Pure module only; the routes and the page have their
// own suites.

const { test } = require("node:test");
const assert = require("node:assert");

const VAULT = require("../broker-vault.js");
const { marketOf } = require("../market.js");

// server.js's addressHasMarket, restated (see vault-address-market.test.js).
const hasMarket = (a) => /^[^,]+,\s[A-Z]{2}$/.test(marketOf(a));
const deps = { hasMarket, marketOf };

const HEAD = "address,property_type,transaction,deal_date,price,size_sqft";
const row = (addr, date = "03/15/2026") => `"${addr}",Industrial,sale,${date},1200000,24500`;

// --- csvAddresses -----------------------------------------------------------

test("csvAddresses reads the address column the way parseUpload does", () => {
  const csv = [HEAD, row("6200 W Gowen Rd"), "# a note line", row("805 S Progress Ave, Meridian, ID")].join("\n");
  const out = VAULT.csvAddresses(csv);
  assert.deepStrictEqual(out, [
    { line: 2, address: "6200 W Gowen Rd" },
    { line: 4, address: "805 S Progress Ave, Meridian, ID" },
  ]);
});

test("csvAddresses composes a mapped City and State onto the street", () => {
  const csv = "Street,Town,ST,Type\n6200 W Gowen Rd,Boise,ID,Industrial\n3155 E Copper Point Dr,,,Industrial\n";
  const mapping = { street: "address", town: "address_city", st: "address_state" };
  const out = VAULT.csvAddresses(csv, { mapping });
  assert.deepStrictEqual(out.map((r) => r.address),
    ["6200 W Gowen Rd, Boise, ID", "3155 E Copper Point Dr"]);
  // A mapping still missing required targets (no property_type, no date) is
  // the state the mapper is in while it asks — this must not refuse it.
  assert.strictEqual(out.length, 2);
});

test("csvAddresses skips blank streets and refuses to guess between two address columns", () => {
  const csv = "a,b\n,x\n1 Main St,y\n";
  assert.deepStrictEqual(VAULT.csvAddresses(csv, { mapping: { a: "address" } }),
    [{ line: 3, address: "1 Main St" }]);
  assert.deepStrictEqual(VAULT.csvAddresses(csv, { mapping: { a: "address", b: "address" } }), []);
  assert.deepStrictEqual(VAULT.csvAddresses("", {}), []);
  assert.deepStrictEqual(VAULT.csvAddresses("price\n1\n"), [], "no address column, nothing to read");
});

test("csvAddresses line numbers are parseCsv's own stamps", () => {
  // A spacer row: the address on line 4 must be reported as line 4.
  const csv = [HEAD, row("1 A St, Boise, ID"), "", row("2 B St")].join("\n");
  const out = VAULT.csvAddresses(csv);
  assert.deepStrictEqual(out.map((r) => r.line), [2, 4]);
});

// --- suggestMarketCompletion -------------------------------------------------

test("only a street-numbered address with no market counts as incomplete", () => {
  const out = VAULT.suggestMarketCompletion([
    { line: 2, address: "6200 W Gowen Rd" },
    { line: 3, address: "Boise" },            // no street number: normalizeRow's problem
    { line: 4, address: "1 A St, Boise, ID" },
    { line: 5, address: "" },
  ], deps);
  assert.deepStrictEqual(out.incomplete, [{ line: 2, address: "6200 W Gowen Rd" }]);
});

test("candidates rank the file first, then the vault, then coverage, each deduped", () => {
  const out = VAULT.suggestMarketCompletion([
    { address: "1 A St, Meridian, ID" },
    { address: "2 B St, Boise, ID" },
    { address: "3 C St, Meridian, ID" },
    { address: "4 D St" },
  ], { ...deps, vaultMarkets: ["Nampa, ID", "Boise, ID"], coverageMarkets: ["Nampa, ID", "Caldwell, ID"] });
  assert.deepStrictEqual(out.candidates, [
    { market: "Meridian, ID", source: "file", count: 2 },
    { market: "Boise, ID", source: "file", count: 1 },
    { market: "Nampa, ID", source: "vault", count: 0 },
    { market: "Caldwell, ID", source: "coverage", count: 0 },
  ]);
});

test("a market string that is not canonical is never offered back", () => {
  // A vault row misfiled before hasMarket existed carries a market called
  // "6200 W Gowen Rd"; a coverage row is validated on write, but be sure.
  const out = VAULT.suggestMarketCompletion([{ address: "4 D St" }],
    { ...deps, vaultMarkets: ["6200 W Gowen Rd", "Idaho", ""], coverageMarkets: ["Boise, ID"] });
  assert.deepStrictEqual(out.candidates, [{ market: "Boise, ID", source: "coverage", count: 0 }]);
});

test("nothing incomplete means no candidates, and no predicate means nothing at all", () => {
  const whole = [{ address: "1 A St, Boise, ID" }];
  assert.deepStrictEqual(VAULT.suggestMarketCompletion(whole, { ...deps, vaultMarkets: ["Nampa, ID"] }),
    { incomplete: [], candidates: [] });
  assert.deepStrictEqual(VAULT.suggestMarketCompletion([{ address: "4 D St" }], {}),
    { incomplete: [], candidates: [] });
});

test("max caps the candidate list", () => {
  const vaultMarkets = ["A, ID", "B, ID", "C, ID", "D, ID"];
  const out = VAULT.suggestMarketCompletion([{ address: "4 D St" }], { ...deps, vaultMarkets, max: 2 });
  assert.strictEqual(out.candidates.length, 2);
});

// --- parseUpload + completeWith ----------------------------------------------

test("completeWith files a bare address under the chosen market", () => {
  const csv = [HEAD, row("6200 W Gowen Rd")].join("\n");
  const out = VAULT.parseUpload(csv, { hasMarket, completeWith: "Boise, ID" });
  assert.strictEqual(out.rows.length, 1);
  assert.strictEqual(out.rows[0].address, "6200 W Gowen Rd, Boise, ID");
  assert.strictEqual(marketOf(out.rows[0].address), "Boise, ID");
  assert.strictEqual(out.completed, 1);
  assert.strictEqual(out.skipped, 0);
});

test("completeWith never touches an address that already has its market, and never doubles a city", () => {
  const csv = [HEAD, row("1 A St, Meridian, ID"), row("2 B St, Boise")].join("\n");
  const out = VAULT.parseUpload(csv, { hasMarket, completeWith: "Boise, ID" });
  assert.deepStrictEqual(out.rows.map((r) => r.address), ["1 A St, Meridian, ID", "2 B St, Boise, ID"]);
  assert.strictEqual(out.completed, 1, "only the row that was missing something was completed");
});

test("a mapped City cell that is filled wins over the whole-file answer; a blank one is completed", () => {
  const csv = "Street,Town,ST,Type,Deal,Date\n1 A St,Meridian,ID,Industrial,sale,03/15/2026\n2 B St,,,Industrial,sale,03/15/2026\n";
  const mapping = { street: "address", town: "address_city", st: "address_state",
                    type: "property_type", deal: "transaction", date: "deal_date" };
  const out = VAULT.parseUpload(csv, { hasMarket, mapping, completeWith: "Boise, ID" });
  assert.deepStrictEqual(out.rows.map((r) => r.address), ["1 A St, Meridian, ID", "2 B St, Boise, ID"]);
  assert.strictEqual(out.completed, 1);
});

test("completed counts stored rows only", () => {
  const csv = [HEAD, row("6200 W Gowen Rd"), row("3155 E Copper Point Dr", "not a date")].join("\n");
  const out = VAULT.parseUpload(csv, { hasMarket, completeWith: "Boise, ID" });
  assert.strictEqual(out.rows.length, 1);
  assert.strictEqual(out.completed, 1, "the row the date check refused is not a completion the broker got");
  assert.strictEqual(out.skipped, 1);
});

test("completeWith is inert without the predicate", () => {
  const csv = [HEAD, row("6200 W Gowen Rd")].join("\n");
  const out = VAULT.parseUpload(csv, { completeWith: "Boise, ID" });
  assert.strictEqual(out.rows[0].address, "6200 W Gowen Rd");
  assert.strictEqual(out.completed, 0);
});

test("a completion this module cannot read is refused with the ordinary message", () => {
  const csv = [HEAD, row("6200 W Gowen Rd")].join("\n");
  for (const bad of ["Boise", "Boise, Idaho"]) {
    const out = VAULT.parseUpload(csv, { hasMarket, completeWith: bad });
    assert.strictEqual(out.rows.length, 0, `${bad} must not file the row anywhere`);
    assert.strictEqual(out.completed, 0);
    assert.match(out.errors[0], /needs a city and a two-letter state/);
  }
  // And the message names the string the completion PRODUCED, so the broker
  // sees what "Boise, Idaho" turned their row into.
  const out = VAULT.parseUpload(csv, { hasMarket, completeWith: "Boise, Idaho" });
  assert.match(out.errors[0], /6200 W Gowen Rd, Boise, Idaho/);
});

test("the refusal fragment the page mirrors is exported and still the message's own", () => {
  const csv = [HEAD, row("6200 W Gowen Rd")].join("\n");
  const out = VAULT.parseUpload(csv, { hasMarket });
  assert.strictEqual(VAULT.MARKET_REFUSAL, "needs a city and a two-letter state");
  assert.ok(out.errors[0].includes(VAULT.MARKET_REFUSAL));
});

// --- classifyExtractRows -----------------------------------------------------

const extractRow = (address, extra = {}) => ({
  address, property_type: "Industrial", transaction: "sale", deal_date: "2026-03-15", price: "1200000", ...extra,
});

test("classifyExtractRows marks a bare street address not ready, with the refusal", () => {
  const out = VAULT.classifyExtractRows([extractRow("6200 W Gowen Rd")], { hasMarket });
  assert.strictEqual(out[0].needsMarket, true);
  assert.ok(out[0].error.includes(VAULT.MARKET_REFUSAL));
});

test("a whole address is ready, with no flag at all", () => {
  const out = VAULT.classifyExtractRows([extractRow("6200 W Gowen Rd, Boise, ID")], { hasMarket });
  assert.strictEqual(out[0].error, null);
  assert.ok(!("needsMarket" in out[0]));
});

test("a bare address with another problem carries both errors", () => {
  const out = VAULT.classifyExtractRows([extractRow("6200 W Gowen Rd", { deal_date: "soon" })], { hasMarket });
  assert.strictEqual(out[0].needsMarket, true);
  const parts = out[0].error.split("; ");
  assert.strictEqual(parts.length, 2);
  assert.ok(parts[1].includes(VAULT.MARKET_REFUSAL), "the market refusal is last, so the page can strip it alone");
});

test("a row with no street number is normalizeRow's refusal, not this one", () => {
  const out = VAULT.classifyExtractRows([extractRow("Boise")], { hasMarket });
  assert.ok(!("needsMarket" in out[0]));
  assert.match(out[0].error, /no street number/);
});

test("without the option, classifyExtractRows is exactly what it was", () => {
  const out = VAULT.classifyExtractRows([extractRow("6200 W Gowen Rd")]);
  assert.deepStrictEqual(Object.keys(out[0]), ["values", "error"]);
  assert.strictEqual(out[0].error, null);
});
