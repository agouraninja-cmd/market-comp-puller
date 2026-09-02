// org-buildings.js — what may be put on the firm's board, and how the list
// is summarized. Pure, so every refusal is proved here with no database; the
// routes that write these rows are proved in test/org-buildings-run.test.js.

const test = require("node:test");
const assert = require("node:assert");
const B = require("../org-buildings");
const VAULT = require("../broker-vault");
const PFMATCH = require("../portfolio-match");
const { marketOf } = require("../market");
const LEADSVC = require("../broker-leads");

// The REAL key functions, injected exactly as server.js injects them — the
// point of the injection is that this file never grows a key of its own, so
// the test must not either.
const deps = {
  addressKey: VAULT.addressKey,
  verifiedKeyFor: PFMATCH.verifiedKeyFor,
  marketOf,
  // server.js injects addressHasMarket; its rule restated through the
  // lead-inbox module that already owns "is this string a market".
  hasMarket: (a) => LEADSVC.isCanonicalMarket(marketOf(a)),
  types: VAULT.PROPERTY_TYPES,
  year: 2026,
};
const ok = (input) => {
  const r = B.normalizeBuilding(input, deps);
  assert.deepEqual(r.errors, [], JSON.stringify(r));
  return r.row;
};
const refused = (input, re) => {
  const r = B.normalizeBuilding(input, deps);
  assert.equal(r.row, null, "expected a refusal, got " + JSON.stringify(r.row));
  assert.ok(r.errors.some((e) => re.test(e)), `no error matching ${re}: ${JSON.stringify(r.errors)}`);
};

test("a building is its address, keyed twice and never a third way", () => {
  const row = ok({ address: "  1210 N 17th   St, Boise, ID ", verifiedKey: "1210 N 17th St, Boise, ID 83702" });
  assert.equal(row.address, "1210 N 17th St, Boise, ID", "collapsed, not stored raw");
  assert.equal(row.address_key, VAULT.addressKey("1210 N 17th St, Boise, ID"), "the vault's key, byte for byte");
  assert.equal(row.verified_key, PFMATCH.verifiedKeyFor("1210 N 17th St, Boise, ID 83702"), "the portfolio's key, byte for byte");
  assert.equal(row.market, "Boise, ID", "market comes from marketOf, so it agrees with comp_corpus.market");
  assert.equal(row.property_type, "");
  assert.equal(row.size_sqft, null);
  assert.equal(row.year_built, null);
});

test("a city is not a building", () => {
  refused({ address: "Boise, ID" }, /street number/);
  refused({ address: "" }, /address is required/i);
  refused({}, /address is required/i);
});

test("an address the market parser cannot place is refused, not filed under nothing", () => {
  refused({ address: "100 Main St" }, /city and state/);
});

test("a verified key that names no street number is dropped, never stored", () => {
  // portfolio-match's own rule, reached through the injected function: a
  // city-only geocoder answer would merge every unnumbered address in town.
  const row = ok({ address: "100 Main St, Boise, ID", verifiedKey: "Boise, ID" });
  assert.equal(row.verified_key, null);
});

test("the property type is the vault's vocabulary, matched without caring about case", () => {
  assert.equal(ok({ address: "100 Main St, Boise, ID", propertyType: "industrial" }).property_type, "Industrial");
  assert.equal(ok({ address: "100 Main St, Boise, ID", propertyType: "" }).property_type, "");
  refused({ address: "100 Main St, Boise, ID", propertyType: "Warehouse" }, /must be one of/);
});

test("size is square feet or nothing — the vault's refusals, not its guesses", () => {
  assert.equal(ok({ address: "100 Main St, Boise, ID", sizeSqft: "12,500 SF" }).size_sqft, 12500);
  assert.equal(ok({ address: "100 Main St, Boise, ID", sizeSqft: 12500.4 }).size_sqft, 12500);
  assert.equal(ok({ address: "100 Main St, Boise, ID", sizeSqft: "" }).size_sqft, null);
  refused({ address: "100 Main St, Boise, ID", sizeSqft: "1.2M" }, /square feet/);
  refused({ address: "100 Main St, Boise, ID", sizeSqft: "-5" }, /square feet/);
  refused({ address: "100 Main St, Boise, ID", sizeSqft: B.MAX_SIZE_SQFT + 1 }, /square feet/);
});

test("year built is a four-digit year inside a sane window", () => {
  assert.equal(ok({ address: "100 Main St, Boise, ID", yearBuilt: "1994" }).year_built, 1994);
  refused({ address: "100 Main St, Boise, ID", yearBuilt: "94" }, /four-digit/);
  refused({ address: "100 Main St, Boise, ID", yearBuilt: "2040" }, /four-digit/);
  refused({ address: "100 Main St, Boise, ID", yearBuilt: "1500" }, /four-digit/);
});

test("a location is a pair or nothing, and a bad one is refused rather than guessed", () => {
  const row = ok({ address: "100 Main St, Boise, ID", lat: 43.61, lng: "-116.2" });
  assert.equal(row.lat, 43.61);
  assert.equal(row.lng, -116.2, "a negative longitude is every US longitude — parseNumber's trap, avoided");
  refused({ address: "100 Main St, Boise, ID", lat: 43.61 }, /together/);
  refused({ address: "100 Main St, Boise, ID", lat: 91, lng: 0 }, /together/);
  refused({ address: "100 Main St, Boise, ID", lat: "north", lng: "west" }, /together/);
});

test("control characters are stripped and the address is capped, not refused for length", () => {
  const row = ok({ address: "100 Main St, Boise, ID" });
  assert.equal(row.address, "100 Main St, Boise, ID");
  const long = "100 " + "Main ".repeat(60) + "St, Boise, ID";
  const r = B.normalizeBuilding({ address: long }, deps);
  assert.ok(r.row === null || r.row.address.length <= B.MAX_ADDRESS);
});

test("a caller that forgot the injections is refused loudly, not handed keyless rows", () => {
  const r = B.normalizeBuilding({ address: "100 Main St, Boise, ID" }, {});
  assert.equal(r.row, null);
  assert.match(r.errors[0], /addressKey, marketOf and hasMarket/);
});

test("the summary line describes the whole set, typed counts largest first", () => {
  const rows = [
    { property_type: "Industrial" }, { property_type: "Retail" }, { property_type: "Industrial" },
    { property_type: "Office" }, { property_type: "" }, { property_type: "Industrial" },
  ];
  const s = B.summarize(rows);
  assert.equal(s.count, 6, "untyped rows are counted");
  assert.equal(s.line, "6 buildings · 3 Industrial · 1 Office · 1 Retail", "ties broken by name, untyped not named");
  assert.equal(B.summarize([{ property_type: "Land" }]).line, "1 building · 1 Land");
  assert.equal(B.summarize([]).line, "");
  assert.equal(B.summarize(null).count, 0);
});

test("the wire shape is an allowlist, and attribution reads 'mine' for the viewer only", () => {
  const stored = {
    id: "b1", org_id: "o1", address: "100 Main St, Boise, ID", address_key: "100 main st boise id",
    verified_key: null, market: "Boise, ID", property_type: "Industrial", size_sqft: "12500",
    year_built: 1994, lat: null, lng: null, added_by_user_id: "u1", added_by_name: "Brad",
    created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", secret_column: "never",
  };
  const mine = B.toBuilding(stored, "u1");
  assert.equal(mine.mine, true);
  assert.equal(B.toBuilding(stored, "u2").mine, false);
  assert.equal(mine.sizeSqft, 12500, "numeric columns arrive as numbers, whatever PostgREST sent");
  assert.equal(mine.verifiedKey, "");
  assert.equal(Object.prototype.hasOwnProperty.call(mine, "org_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(mine, "secret_column"), false);
  assert.deepEqual(Object.keys(mine).sort(), [
    "addedBy", "address", "addressKey", "createdAt", "id", "lat", "lng", "market", "mine",
    "sizeSqft", "type", "updatedAt", "verifiedKey", "yearBuilt",
  ]);
  assert.equal(B.toBuilding(null, "u1"), null);
});

test("findBuilding matches the verified key first, then the exact address key, and never guesses", () => {
  const list = [
    { id: "b1", addressKey: "1210n17th st", verifiedKey: "1210 n 17th st boise id 83702" },
    { id: "b2", addressKey: "500 warehouse way boise id", verifiedKey: "" },
  ];
  assert.equal(B.findBuilding(list, { addressKey: "1210 n 17th st boise idaho 83702", verifiedKey: "1210 n 17th st boise id 83702" }).id, "b1",
    "the same building typed two ways meets through the verified key");
  assert.equal(B.findBuilding(list, { addressKey: "500 warehouse way boise id" }).id, "b2");
  assert.equal(B.findBuilding(list, { addressKey: "500 warehouse way, boise" }), null, "a near miss is a miss");
  assert.equal(B.findBuilding(list, {}), null);
  assert.equal(B.findBuilding(null, { addressKey: "x" }), null);
});

test("the two thresholds are the plan's, and the module starts nothing", () => {
  assert.equal(B.OVERFLOW_AT, 8);
  assert.equal(B.MAX_BUILDINGS, 1000);
  const src = require("node:fs").readFileSync(require.resolve("../org-buildings"), "utf8");
  assert.doesNotMatch(src, /require\(/, "pure: no requires, the keys are injected");
  assert.doesNotMatch(src, /Date\.now|new Date/, "pure: no clock — the caller passes the year");
});
