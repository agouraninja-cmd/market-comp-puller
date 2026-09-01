// Two things a spreadsheet leaves out because everyone at the firm already
// knows them, and one screen that lets the broker say them once.
//
// A developer's or owner-operator's own tracking sheet keeps Address, City and
// State in three columns, names no property type (every row is the one thing
// they build), names no deal type (every row is a lease), and quotes a rent
// without ever saying annual or monthly. All four are the same shape of
// omission: context the file's readers share and the file therefore never
// states.

const { test } = require("node:test");
const assert = require("node:assert");

const VAULT = require("../broker-vault.js");
const { marketOf } = require("../market.js");

const hasMarket = (a) => /^[^,]+,\s[A-Z]{2}$/.test(marketOf(a));

// The file as a developer actually exports it.
const SHEET = [
  "Property Address,City,State,Tenant,Square Feet,Lease Rate,Type,Commencement",
  "6200 W Gowen Rd,Boise,ID,Mountain West Logistics,24500,$0.72,NNN,03/15/2026",
  "805 S Progress Ave,Meridian,ID,Redline Fabrication,12750,$0.81,NNN,06/01/2025",
].join("\n");

const MAPPING = {
  property_address: "address", city: "address_city", state: "address_state",
  square_feet: "size_sqft", lease_rate: "rent_psf", type: "lease_type",
  commencement: "deal_date",
};
const ANSWERS = { property_type: "Industrial", transaction: "Lease", rent_basis: "Monthly" };

test("a developer's own lease sheet imports as exported", () => {
  const out = VAULT.parseUpload(SHEET, { mapping: MAPPING, constants: ANSWERS, hasMarket });
  assert.strictEqual(out.rows.length, 2, out.errors.join(" | "));
  const [a, b] = out.rows;
  assert.strictEqual(a.address, "6200 W Gowen Rd, Boise, ID");
  assert.strictEqual(marketOf(a.address), "Boise, ID");
  assert.strictEqual(marketOf(b.address), "Meridian, ID");
  assert.strictEqual(a.property_type, "Industrial");
  assert.strictEqual(a.transaction, "lease");
  assert.strictEqual(a.rent_basis, "monthly");
  // The stored annual figure, because a book holding two bases quotes three
  // rents for one lease. 0.72/month is 8.64/year.
  assert.strictEqual(a.rent_psf_yr, 8.64);
});

test("the address parts are used and then gone — they are not fields", () => {
  const out = VAULT.parseUpload(SHEET, { mapping: MAPPING, constants: ANSWERS, hasMarket });
  for (const row of out.rows) {
    assert.ok(!("address_city" in row), "address_city must not be stored");
    assert.ok(!("address_state" in row), "address_state must not be stored");
  }
});

test("the address parts are deliberately NOT storable fields", () => {
  // MAPPABLE_TARGETS and VAULT_FIELD_KEYS are checked against the broker_comps
  // schema in both directions, so an address_city in either would correctly
  // fail that test. The fix is this separate list, never a looser check.
  for (const part of VAULT.ADDRESS_PART_TARGETS) {
    assert.ok(!VAULT.MAPPABLE_TARGETS.includes(part), `${part} must stay out of MAPPABLE_TARGETS`);
    assert.ok(!VAULT.VAULT_FIELD_KEYS.includes(part), `${part} must stay out of VAULT_FIELD_KEYS`);
  }
});

test("composeAddress only ever appends what is missing", () => {
  const c = VAULT.composeAddress;
  assert.strictEqual(c("6200 W Gowen Rd", "Boise", "ID"), "6200 W Gowen Rd, Boise, ID");
  // A sheet that repeats the city inside the address column must not double it.
  assert.strictEqual(c("6200 W Gowen Rd, Boise", "Boise", "ID"), "6200 W Gowen Rd, Boise, ID");
  assert.strictEqual(c("6200 W Gowen Rd, Boise, ID", "Boise", "ID"), "6200 W Gowen Rd, Boise, ID");
  // Missing parts are simply absent, never the string "undefined".
  assert.strictEqual(c("6200 W Gowen Rd", "", ""), "6200 W Gowen Rd");
  assert.strictEqual(c("6200 W Gowen Rd", "Boise", ""), "6200 W Gowen Rd, Boise");
});

test("a spelled-out state is left alone, not invented into a code", () => {
  // market.js keeps state CODES and reads "..., Boise, Idaho" as a market
  // called "Idaho". Expanding it here would be this module inventing geography
  // it deliberately knows nothing about, so the row is refused downstream
  // instead — where the message names the two-letter code as the fix.
  assert.strictEqual(VAULT.composeAddress("1 A St", "Boise", "Idaho"), "1 A St, Boise, Idaho");
  const out = VAULT.parseUpload([
    "Property Address,City,State,Kind,SF,Closed",
    "1 A St,Boise,Idaho,Industrial,1000,03/15/2026",
  ].join("\n"), {
    mapping: { property_address: "address", city: "address_city", state: "address_state",
               kind: "property_type", sf: "size_sqft", closed: "deal_date" },
    constants: { transaction: "Sale" }, hasMarket,
  });
  assert.strictEqual(out.rows.length, 0);
  assert.match(out.errors[0], /two-letter/);
});

test("a value in the row always beats the whole-file answer", () => {
  // The file is the record; the answer is only what the file left unsaid.
  const out = VAULT.parseUpload([
    "address,property_type,transaction,deal_date,price,size_sqft",
    '"1 A St, Boise, ID",Office,sale,03/15/2026,1000000,10000',
    '"2 B St, Boise, ID",,sale,03/16/2026,2000000,20000',
  ].join("\n"), { constants: { property_type: "Industrial" } });
  assert.strictEqual(out.rows.length, 2, out.errors.join(" | "));
  assert.strictEqual(out.rows[0].property_type, "Office", "the row said Office");
  assert.strictEqual(out.rows[1].property_type, "Industrial", "and the blank took the answer");
});

test("a rent basis never lands on a row with no rent", () => {
  // Stamping it onto the sale rows of a mixed book would attach a rent basis
  // to deals that have no rent.
  const out = VAULT.parseUpload([
    "address,property_type,transaction,deal_date,price,size_sqft,rent_psf",
    '"1 A St, Boise, ID",Industrial,sale,03/15/2026,1000000,10000,',
    '"2 B St, Boise, ID",Industrial,lease,03/16/2026,,20000,0.75',
  ].join("\n"), { constants: { rent_basis: "Monthly" } });
  assert.strictEqual(out.rows.length, 2, out.errors.join(" | "));
  assert.strictEqual(out.rows[0].rent_basis, null, "the sale row keeps no basis");
  assert.strictEqual(out.rows[1].rent_basis, "monthly");
});

test("a whole-file answer clears the same bar a column would have", () => {
  // Otherwise "Industral" is accepted here and refused once per row, forty
  // times, with the screen still showing it as the answer.
  const out = VAULT.parseUpload(SHEET, {
    mapping: MAPPING, constants: { property_type: "Industral" }, hasMarket,
  });
  assert.strictEqual(out.rows.length, 0);
  assert.ok(out.errors.some((e) => /Industral/.test(e)), out.errors.join(" | "));
});

test("only the three closed-vocabulary fields may be answered once", () => {
  // A price or a date answered once would be wrong per row and invisible.
  for (const key of ["deal_date", "price", "address", "size_sqft"]) {
    const out = VAULT.parseUpload(SHEET, {
      mapping: MAPPING, constants: { [key]: "whatever" }, hasMarket,
    });
    assert.ok(out.errors.some((e) => e.includes("cannot be answered once")),
      `${key} should not be answerable for a whole file`);
  }
  assert.deepStrictEqual(VAULT.SHEET_CONSTANT_TARGETS,
    ["property_type", "transaction", "rent_basis"]);
});

test("answering a field a column already supplies is a contradiction, not a preference", () => {
  const out = VAULT.parseUpload([
    "Property Address,City,State,Kind,SF,Closed",
    "1 A St,Boise,ID,Office,1000,03/15/2026",
  ].join("\n"), {
    mapping: { property_address: "address", city: "address_city", state: "address_state",
               kind: "property_type", sf: "size_sqft", closed: "deal_date" },
    constants: { property_type: "Industrial", transaction: "Sale" }, hasMarket,
  });
  assert.strictEqual(out.rows.length, 0);
  assert.ok(out.errors.some((e) => /both mapped .* and answered/.test(e)), out.errors.join(" | "));
});

test("an untouched select reads as no answer, never as a refusal", () => {
  // The screen renders these with nothing chosen; an empty one must be absent.
  const check = VAULT.validateConstants({ property_type: "", transaction: "   " });
  assert.deepStrictEqual(check.errors, []);
  assert.deepStrictEqual(check.constants, {});
});

test("with no answers and no parts, nothing about an import changes", () => {
  const plain = [
    "address,property_type,transaction,deal_date,price,size_sqft",
    '"1 A St, Boise, ID",Industrial,sale,03/15/2026,1000000,10000',
  ].join("\n");
  const before = VAULT.parseUpload(plain);
  const after = VAULT.parseUpload(plain, { constants: null });
  assert.deepStrictEqual(after.rows, before.rows);
  assert.strictEqual(before.rows.length, 1);
});
