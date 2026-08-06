// Which brokers cover which markets — the public directory rules.
//
// Two rules here are about a real person's consent and a real person's contact
// details, so these tests are written to prove them rather than illustrate
// them. The negative cases are the point.

const test = require("node:test");
const assert = require("node:assert");

const { brokersForMarket, publicBrokerRow, PUBLIC_BROKER_FIELDS } = require("../broker-directory");

function profile(over = {}) {
  return {
    id: "p-1",
    user_id: "u-1",
    slug: "jane-doe",
    display_name: "Jane Doe",
    company: "Doe Industrial",
    public: true,
    // Everything below must never reach a public page.
    email: "jane@example.com",
    created_at: "2026-01-01",
    updated_at: "2026-01-02",
    ...over,
  };
}

function coverage(over = {}) {
  return { user_id: "u-1", market: "Boise, ID", property_type: "Industrial", source: "chosen", ...over };
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

test("A BROKER WHO HAS NOT OPTED IN IS NEVER LISTED", () => {
  // broker_coverage records which markets a broker wants LEADS from. It is not
  // permission to put them on a public web page. broker_profiles.public is.
  assert.equal(publicBrokerRow(profile({ public: false })), null);
  assert.equal(publicBrokerRow(profile({ public: undefined })), null);
  assert.equal(publicBrokerRow(profile({ public: null })), null);
});

test("only a literal true opts a broker in", () => {
  // Truthy is not consent. A stray "false" string or a 1 from some future
  // import must not read as permission.
  for (const v of ["true", "yes", 1, {}, []]) {
    assert.equal(publicBrokerRow(profile({ public: v })), null, `${JSON.stringify(v)} was treated as consent`);
  }
});

test("covering a market is not consent to be listed in it", () => {
  const out = brokersForMarket([coverage()], new Map([["u-1", profile({ public: false })]]));
  assert.deepEqual(out, []);
});

// ---------------------------------------------------------------------------
// Contact details
// ---------------------------------------------------------------------------

test("A PUBLIC LISTING CARRIES NO CONTACT DETAILS", () => {
  // Routing is owner-mediated: broker contact details go to the owner, never
  // the reverse. A public directory is the reverse by definition.
  const row = publicBrokerRow(profile({ phone: "555-0100" }));
  const seen = JSON.stringify(row);
  for (const secret of ["jane@example.com", "555-0100", "@example"]) {
    assert.equal(seen.includes(secret), false, `"${secret}" reached a public listing`);
  }
  assert.equal("email" in row, false);
  assert.equal("phone" in row, false);
});

test("a future column on broker_profiles cannot appear by default", () => {
  // Allowlist, not delete. Adding a field to a public listing should be an
  // edit somebody makes on purpose and a reviewer can see.
  const row = publicBrokerRow(profile({ personal_mobile: "555-0199", internal_note: "SECRET" }));
  assert.equal(JSON.stringify(row).includes("SECRET"), false);
  assert.equal(JSON.stringify(row).includes("555-0199"), false);
  for (const k of Object.keys(row)) {
    assert.ok([...PUBLIC_BROKER_FIELDS, "url"].includes(k), `unexpected field on a public listing: ${k}`);
  }
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test("a listing links to the profile page the broker opted into", () => {
  assert.equal(publicBrokerRow(profile()).url, "/broker/jane-doe");
});

test("no slug means no listing, because there is nothing to link to", () => {
  assert.equal(publicBrokerRow(profile({ slug: "" })), null);
  assert.equal(publicBrokerRow(profile({ slug: undefined })), null);
});

test("a listing with neither name nor company is dropped", () => {
  assert.equal(publicBrokerRow(profile({ display_name: "", company: "" })), null);
  // Company alone is fine — plenty of brokers list under a firm.
  assert.equal(publicBrokerRow(profile({ display_name: "" })).company, "Doe Industrial");
});

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

test("brokers covering the market are listed once each", () => {
  const out = brokersForMarket(
    [coverage(), coverage(), coverage({ user_id: "u-2" })],
    new Map([
      ["u-1", profile()],
      ["u-2", profile({ user_id: "u-2", slug: "adam-smith", display_name: "Adam Smith" })],
    ]));
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((b) => b.slug), ["adam-smith", "jane-doe"]);
});

test("the order is alphabetical, not a ranking", () => {
  // A directory, not a league table. Ordering by contribution would be a
  // promise about quality that nothing here can support.
  const out = brokersForMarket(
    [coverage({ user_id: "u-2" }), coverage({ user_id: "u-1" })],
    new Map([
      ["u-1", profile({ display_name: "Zoe" })],
      ["u-2", profile({ user_id: "u-2", slug: "adam", display_name: "Adam" })],
    ]));
  assert.deepEqual(out.map((b) => b.display_name), ["Adam", "Zoe"]);
});

test("coverage with no matching profile lists nobody", () => {
  assert.deepEqual(brokersForMarket([coverage({ user_id: "ghost" })], new Map()), []);
});

test("a plain object works as well as a Map", () => {
  const out = brokersForMarket([coverage()], { "u-1": profile() });
  assert.equal(out.length, 1);
});

test("junk in does not throw", () => {
  assert.deepEqual(brokersForMarket(null, null), []);
  assert.deepEqual(brokersForMarket("nonsense", new Map()), []);
  assert.deepEqual(brokersForMarket([null, {}, { user_id: null }], new Map()), []);
  assert.equal(publicBrokerRow(null), null);
  assert.equal(publicBrokerRow("nonsense"), null);
});

test("an empty market lists nobody rather than erroring", () => {
  assert.deepEqual(brokersForMarket([], new Map()), []);
});
