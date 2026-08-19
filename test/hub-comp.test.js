// A comp a participant typed in. Pure, so no database and no server.
//
// Spec: docs/superpowers/specs/2026-08-13-messaging-hub-design.md (slice 2, Q4)
//
// The tests that matter most here are the REJECTIONS. This is the only path in
// the product where comp data arrives from someone who is not a broker and has
// no vault row behind them, so "reject, never guess" is doing more work than
// anywhere except the CSV importer it borrows its parsers from.

const test = require("node:test");
const assert = require("node:assert");
const { normalizeManualComp } = require("../hub-comp.js");

const ok = (input) => {
  const r = normalizeManualComp(input);
  assert.deepEqual(r.errors, [], "expected no errors");
  return r.comp;
};
const bad = (input) => {
  const r = normalizeManualComp(input);
  assert.equal(r.comp, null, "a rejected comp must not come back");
  assert.ok(r.errors.length, "a rejection must say why");
  return r.errors;
};

test("an address alone is a valid comp", () => {
  // A tenant who knows only the building must still be able to add it; every
  // other field is optional and an empty one is never an error.
  assert.deepEqual(ok({ address: "5142 Kanan Rd" }), { address: "5142 Kanan Rd" });
});

test("no address is the one hard refusal", () => {
  // A comp with no address is a note, and the hub already has notes.
  bad({ notes: "the one near the freeway" });
  bad({});
  bad({ address: "   " });
});

test("the vault's own parsers decide, so a broker's CSV and this box agree", () => {
  const c = ok({
    address: "1 A St", property_type: "industrial", transaction: "sale",
    deal_date: "2026-05-14", price: "2,850,000", size_sqft: "24,500 SF",
  });
  assert.equal(c.property_type, "Industrial");
  assert.equal(c.transaction, "sale");
  assert.equal(c.price, 2850000);
  assert.equal(c.size_sqft, 24500);
});

test("shorthand money is REFUSED, in the importer's own words", () => {
  // The bug this test exists for: broker-vault's parsers answer {ok, value},
  // not a bare value, and the first draft treated the result object AS the
  // value — so "1.2M" was accepted and stored as an object. Silent, total,
  // and exactly what the module promises not to do.
  const errs = bad({ address: "1 A St", price: "1.2M" });
  assert.match(errs[0], /1200000/, "the importer's own guidance should come through");
});

test("an unreadable field never lands as an object", () => {
  // The general form of the same bug: whatever a parser returns, only a real
  // VALUE may reach the comp.
  for (const input of [
    { address: "1 A St", price: "about a million" },
    { address: "1 A St", size_sqft: "big" },
    { address: "1 A St", deal_date: "last spring" },
    { address: "1 A St", property_type: "warehouse-ish" },
    { address: "1 A St", transaction: "swap" },
  ]) {
    const r = normalizeManualComp(input);
    assert.equal(r.comp, null, JSON.stringify(input));
    for (const v of Object.values(r.comp || {})) {
      assert.notEqual(typeof v, "object", "a parser result reached the comp");
    }
  }
});

test("$/SF is computed for a sale and never for a lease", () => {
  // broker-vault.js's rule, for its reason: an annual rent over size is
  // $/SF/year, a different unit, and it would corrupt the column it sits in.
  assert.equal(ok({ address: "1 A St", transaction: "sale", price: "2850000", size_sqft: "24500" }).price_per_sqft, 116.33);
  assert.equal(ok({ address: "1 A St", transaction: "lease", price: "100000", size_sqft: "10000" }).price_per_sqft, undefined);
  assert.equal(ok({ address: "1 A St", transaction: "sale", price: "2850000" }).price_per_sqft, undefined, "no size, no rate");
});

test("a price with no deal type is refused, because nothing can read it", () => {
  // The gap a real client found on 2026-08-17: the form's deal select defaults
  // to "Not sure", so a comp went in at $1,200,000 with no sale-or-lease and
  // therefore no $/SF, landing as a bare figure in the column every other row
  // is compared down. Sale or lease is required ONLY once money is typed.
  const errs = bad({ address: "1 A St", price: "1200000", size_sqft: "24500" });
  assert.ok(errs.some((e) => /sale or a lease/.test(e)), errs.join(" "));

  // The case the box exists for is untouched: an address on its own, with or
  // without a size, still needs nothing else.
  ok({ address: "1 A St" });
  ok({ address: "1 A St", size_sqft: "24500" });
  ok({ address: "1 A St", price: "1200000", transaction: "lease" });

  // One complaint per field. A price with an UNREADABLE deal type is already
  // being refused for that; it must not also be told it said nothing.
  const two = bad({ address: "1 A St", price: "1200000", transaction: "swap" });
  assert.equal(two.length, 1, two.join(" "));
});

test("a link must be http(s), because it becomes an anchor other people click", () => {
  bad({ address: "1 A St", source_url: "javascript:alert(1)" });
  bad({ address: "1 A St", source_url: "data:text/html,<script>" });
  bad({ address: "1 A St", source_url: "ftp://x.example" });
  assert.equal(ok({ address: "1 A St", source_url: "https://x.example/listing" }).source_url,
    "https://x.example/listing");
});

test("the comp CLAIMS NO PROVENANCE, ever", () => {
  // A tenant pasting a listing is the weakest evidence in the product, and the
  // whole provenance system exists to stop weak evidence wearing strong
  // clothes. Who added it is recorded on the ROW, never inside the snapshot.
  const c = ok({
    address: "1 A St", verified: true, source_type: "verified",
    verified_by: "Some Brokerage", private: true, added_by_email: "x@y.com",
  });
  assert.deepEqual(Object.keys(c), ["address"]);
});

test("nothing throws on garbage", () => {
  for (const input of [null, undefined, "string", 42, [], { address: { nested: true } }]) {
    assert.doesNotThrow(() => normalizeManualComp(input), JSON.stringify(input));
  }
});

test("over-long text is refused rather than silently truncated", () => {
  bad({ address: "x".repeat(301) });
  bad({ address: "1 A St", notes: "n".repeat(501) });
});
