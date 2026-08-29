// Coordinates on the property dimension — the storage half of
// docs/superpowers/specs/2026-08-06-private-comp-geocoding.md.
//
// These are the obligations §6 of that spec asks for, written against the pure
// modules so they need no database and no browser.
//
// The one thing these CANNOT prove is the claim the change exists to make —
// "no private comp's address appears in any outbound request". That is decided
// by renderMap() in index.html, which is the display half and is not built
// yet. Until it lands, these columns are stored and ignored, exactly as §2 of
// the spec says. What is pinned here is everything the storage half is allowed
// to get wrong on its own.

const test = require("node:test");
const assert = require("node:assert");

const V = require("../broker-vault");
const PROPS = require("../broker-properties");
const { toReportComp } = require("../blend-comps");

// A one-row upload with whatever lat/lng cells we want to try.
const upload = (lat, lng) =>
  V.parseUpload(
    "address,property_type,transaction,deal_date,price,lat,lng\n" +
    `"1450 Mission Ave, Boise, ID",Industrial,sale,2026-03-14,4250000,${lat},${lng}\n`
  );

const firstRow = (r) => (r.rows && r.rows[0]) || null;
const firstError = (r) => (r.errors && r.errors[0]) || "";

// ---------------------------------------------------------------------------
// Accepting what the broker supplied
// ---------------------------------------------------------------------------

test("a valid pair is stored, and a US longitude survives", () => {
  // The regression that matters most: parseNumber() rejects negatives, so
  // reusing it (as the spec's section 3 suggested) would have refused every
  // longitude in the United States — including the spec's own example.
  const row = firstRow(upload("43.6150", "-116.2023"));
  assert.ok(row, `expected the row to import: ${firstError(upload("43.6150", "-116.2023"))}`);
  assert.equal(row._lat, 43.615);
  assert.equal(row._lng, -116.2023);
});

test("coordinates ride on carried keys, never as comp columns", () => {
  // broker_comps has no lat column. A `lat` key on the insert payload is a
  // PostgREST 400, which on the upload path refuses the broker's whole file.
  const row = firstRow(upload("43.6150", "-116.2023"));
  assert.ok(!("lat" in row), "lat must not be a broker_comps column");
  assert.ok(!("lng" in row), "lng must not be a broker_comps column");
  const insertable = PROPS.stripCarriedKeys(row);
  assert.ok(!("_lat" in insertable) && !("_lng" in insertable),
    "carried keys must be stripped before the comp insert");
  // And nothing else was lost on the way through.
  assert.equal(insertable.address, "1450 Mission Ave, Boise, ID");
  assert.equal(insertable.price, 4250000);
});

test("an upload with no coordinates is byte-identical to before", () => {
  // The feature is invisible until it has something to show, which is what
  // makes it safe to ship ahead of the display half.
  const withCols = PROPS.stripCarriedKeys(firstRow(upload("", "")));
  const without = firstRow(V.parseUpload(
    "address,property_type,transaction,deal_date,price\n" +
    `"1450 Mission Ave, Boise, ID",Industrial,sale,2026-03-14,4250000\n`
  ));
  assert.deepEqual(withCols, without);
});

// ---------------------------------------------------------------------------
// Refusing, with a line number, rather than guessing
// ---------------------------------------------------------------------------

for (const [name, lat, lng, needle] of [
  ["latitude above 90", "91", "-116.2023", "outside -90 to 90"],
  ["latitude below -90", "-90.1", "-116.2023", "outside -90 to 90"],
  ["longitude above 180", "43.615", "180.5", "outside -180 to 180"],
  ["longitude below -180", "43.615", "-181", "outside -180 to 180"],
  ["latitude with no longitude", "43.615", "", "must be given together"],
  ["longitude with no latitude", "", "-116.2023", "must be given together"],
  ["0,0 (Null Island)", "0", "0", "Null Island"],
  ["degrees-minutes-seconds", "43 36 54 N", "-116.2023", "decimal-degrees"],
  ["a word", "somewhere", "-116.2023", "decimal-degrees"],
]) {
  test(`refused with a line number: ${name}`, () => {
    const result = upload(lat, lng);
    assert.equal(result.rows.length, 0, `${name} should not have imported`);
    const err = firstError(result);
    assert.match(err, /^Line 2:/, `errors carry the spreadsheet line: got "${err}"`);
    assert.ok(err.includes(needle), `expected "${needle}" in: ${err}`);
  });
}

test("a bad coordinate rejects its own row, not the whole file", () => {
  // The module's standing rule: one typo in row 400 must not reject 399 good
  // comps. Coordinates are held to it too.
  const result = V.parseUpload(
    "address,property_type,transaction,deal_date,price,lat,lng\n" +
    `"1 Good St, Boise, ID",Industrial,sale,2026-03-14,100,43.6,-116.2\n` +
    `"2 Bad St, Boise, ID",Industrial,sale,2026-03-15,200,999,-116.2\n` +
    `"3 Good St, Boise, ID",Industrial,sale,2026-03-16,300,43.7,-116.3\n`
  );
  assert.equal(result.rows.length, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /^Line 3:/);
});

// ---------------------------------------------------------------------------
// One building, one location
// ---------------------------------------------------------------------------

const comp = (addressKey, date, lat, lng) => ({
  user_id: "u-1", address_key: addressKey, address: addressKey,
  market: "Boise, ID", property_type: "Industrial", deal_date: date,
  ...(lat === undefined ? {} : { _lat: lat, _lng: lng }),
});

test("three deals on one building yield one coordinate row", () => {
  // The reason coordinates live on the property and not the comp: storing them
  // per deal would keep three copies and let them disagree.
  const out = PROPS.propertyCoordsFrom([
    comp("1450 mission ave", "2024-01-01", 43.61, -116.20),
    comp("1450 mission ave", "2025-01-01", 43.61, -116.20),
    comp("1450 mission ave", "2026-01-01", 43.61, -116.20),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].geo_source, "broker");
});

test("the newest deal's coordinates win", () => {
  // Same rule the descriptive fields follow in propertyRowsFrom: if a broker
  // re-typed them on a later deal, the later typing is what they believe now.
  const out = PROPS.propertyCoordsFrom([
    comp("1450 mission ave", "2026-01-01", 43.99, -116.99),
    comp("1450 mission ave", "2024-01-01", 43.11, -116.11),
  ]);
  assert.deepEqual([out[0].lat, out[0].lng], [43.99, -116.99]);
});

test("buildings with no coordinates contribute nothing to write", () => {
  // No entry means no PATCH, which means an upload without coordinates cannot
  // touch a building that already has them.
  assert.deepEqual(PROPS.propertyCoordsFrom([comp("1450 mission ave", "2026-01-01")]), []);
});

test("the spreadsheet path writes 'broker', never 'census'", () => {
  // Step 2 (import-time geocoding) was built 2026-08-29, and 'census' is now
  // written — but only by server.js's scheduleVaultGeocode, for buildings the
  // spreadsheet left unlocated. This function describes what the broker
  // themselves supplied, so its answer stays 'broker' forever; the census
  // PATCH is guarded lat=is.null, so the broker's value always wins.
  // test/vault-geocode-run.test.js covers the census half.
  const out = PROPS.propertyCoordsFrom([comp("1450 mission ave", "2026-01-01", 43.6, -116.2)]);
  assert.equal(out[0].geo_source, "broker");
});

test("a comp missing one half of the pair is not written", () => {
  const half = { ...comp("1450 mission ave", "2026-01-01"), _lat: 43.6 };
  assert.deepEqual(PROPS.propertyCoordsFrom([half]), []);
});

// ---------------------------------------------------------------------------
// propertiesNeedingGeocode — the import-time geocode's pure filter (step 2)
// ---------------------------------------------------------------------------

const prop = (over) => ({
  id: "p1", address_key: "1450 mission ave", address: "1450 Mission Ave",
  lat: null, lng: null, ...over,
});

test("only unlocated rows with a real address are attempted", () => {
  const rows = [
    prop({ id: "p1" }),
    prop({ id: "p2", lat: 43.6, lng: -116.2 }),   // already located: skip
    prop({ id: "p3", address: "   " }),            // nothing to send: skip
    prop({ id: "p4", address: undefined }),        // nothing to send: skip
    { id: null, address: "5 Elm St", lat: null },  // nothing to PATCH: skip
  ];
  assert.deepEqual(PROPS.propertiesNeedingGeocode(rows, 10).map((r) => r.id), ["p1"]);
});

test("lat 0 is a located building, not a missing one", () => {
  // Number(null) === 0 is the Null Island bug this file already documents on
  // the stitch path; the filter must only treat NULL as unlocated, or a real
  // (if nautical) coordinate at the equator would be rewritten.
  assert.deepEqual(PROPS.propertiesNeedingGeocode([prop({ lat: 0, lng: 0 })], 10), []);
});

test("the cap bounds the attempt, not the truth", () => {
  const rows = [prop({ id: "p1" }), prop({ id: "p2" }), prop({ id: "p3" })];
  assert.equal(PROPS.propertiesNeedingGeocode(rows, 2).length, 2);
  // Rows past the cap are postponed, not lost: every trigger re-reads
  // whatever is still null, so the next upload or vault read picks them up.
  assert.equal(PROPS.propertiesNeedingGeocode(rows, 10).length, 3);
});

test("a non-array and a nonsense cap both answer nothing", () => {
  assert.deepEqual(PROPS.propertiesNeedingGeocode(null, 5), []);
  assert.deepEqual(PROPS.propertiesNeedingGeocode([prop({})], 0), []);
  assert.deepEqual(PROPS.propertiesNeedingGeocode([prop({})], NaN), []);
});

// ---------------------------------------------------------------------------
// Reaching the report
// ---------------------------------------------------------------------------

test("a blended comp carries the coordinates through", () => {
  // `lat`/`lng` are names index.html already understands, so the display half
  // needs no new rendering path — only the guard that stops it geocoding
  // anyway.
  const out = toReportComp({
    address: "1450 Mission Ave", deal_date: "2026-03-14", transaction: "sale",
    price: 4250000, size_sqft: 31000, price_per_sqft: 137,
    lat: 43.615, lng: -116.2023, geo_source: "broker",
  });
  assert.equal(out.lat, 43.615);
  assert.equal(out.lng, -116.2023);
  assert.equal(out.geo_source, "broker");
  assert.equal(out.private, true);
});

test("a blended comp with no coordinates is shaped exactly as before", () => {
  const base = {
    address: "1450 Mission Ave", deal_date: "2026-03-14", transaction: "sale",
    price: 4250000, size_sqft: 31000, price_per_sqft: 137,
  };
  const out = toReportComp(base);
  assert.ok(!("lat" in out), "absent coordinates must not become null keys");
  assert.ok(!("lng" in out));
  assert.ok(!("geo_source" in out));
});
