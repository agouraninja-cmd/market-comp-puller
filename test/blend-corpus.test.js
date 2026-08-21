// Radius corpus blend — saved public deals inside a nearby report.
//
// Spec: docs/superpowers/specs/2026-08-14-radius-corpus-blend-design.md

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  blendNearbyComps,
  toReportComp,
  parseCoords,
  milesBetween,
  RADIUS_MILES,
  RESIDENTIAL_RADIUS_MILES,
  radiusMilesFor,
  impliedSubjectPsf,
  samePriceTier,
  attachCompDistances,
} = require("../blend-corpus");

const BOISE = { lat: 43.615, lng: -116.2023 };
const NOW = Date.parse("2026-08-14T00:00:00Z");

function parseDealDate(s) {
  const t = String(s || "").trim();
  const m = t.match(/^([A-Za-z]{3,9})\s+((?:19|20)\d{2})$/);
  if (!m) return null;
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const mo = months[m[1].slice(0, 3).toLowerCase()];
  return mo ? Number(m[2]) + (mo - 0.5) / 12 : null;
}

function keyOf(c) {
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  return [norm(c.address), norm(c.date || c.deal_date), norm(c.price_or_rate)].join("|");
}

function offsetMiles(from, milesNorth) {
  return { lat: from.lat + milesNorth / 69, lng: from.lng };
}

function row(over = {}) {
  const ll = over.ll || offsetMiles(BOISE, 5);
  return {
    address: "500 Nearby Rd, Garden City, ID",
    deal_date: "Mar 2026",
    transaction: "Sale",
    price_or_rate: "2500000",
    price_per_sqft: "85",
    size_sqft: "29400",
    source_type: "public_record",
    lat: String(ll.lat),
    lng: String(ll.lng),
    ...over,
    ll: undefined,
  };
}

function report(over = {}) {
  return {
    subject_lat: String(BOISE.lat),
    subject_lng: String(BOISE.lng),
    comps: [
      { address: "1 Search Ave, Boise, ID", date: "Feb 2026", price_or_rate: "3000000", source_type: "listing" },
    ],
    ...over,
  };
}

const OPTS = {
  months: 12,
  now: NOW,
  parseDealDate,
  keyOf,
  subjectAddress: "100 Subject St, Boise, ID",
};

test("parseCoords refuses missing, one-sided, blank, and Null Island", () => {
  assert.equal(parseCoords(null), null);
  assert.equal(parseCoords({}), null);
  assert.equal(parseCoords({ lat: "43.6" }), null);
  assert.equal(parseCoords({ lat: "", lng: "-116.2" }), null);
  assert.equal(parseCoords({ lat: null, lng: "-116.2" }), null);
  assert.equal(parseCoords({ lat: 0, lng: 0 }), null);
  const ll = parseCoords({ lat: "43.615", lng: "-116.2023" });
  assert.equal(ll.lat, 43.615);
  assert.equal(ll.lng, -116.2023);
});

test("milesBetween uses the same 3959-mile haversine as the report map", () => {
  const five = offsetMiles(BOISE, 5);
  const mi = milesBetween(BOISE, five);
  assert.ok(mi > 4.9 && mi < 5.1, `expected ~5 miles, got ${mi}`);
});

test("an in-range dated sale is appended as an ordinary report comp", () => {
  const out = blendNearbyComps(report(), [row()], OPTS);
  assert.equal(out.comps.length, 2);
  assert.equal(out.corpus_count, 1);
  const added = out.comps[1];
  assert.equal(added.address, "500 Nearby Rd, Garden City, ID");
  assert.equal(added.date, "Mar 2026");
  assert.equal(added.deal_date, undefined);
  assert.equal(added.from_corpus, true);
  assert.equal(added.source_type, "public_record");
  assert.equal(typeof added.distance_mi, "number");
  assert.ok(added.distance_mi > 4 && added.distance_mi < 6);
});

test("empty extras return the same object, with no corpus_count key", () => {
  const rep = report();
  const out = blendNearbyComps(rep, [], OPTS);
  assert.equal(out, rep);
  assert.equal("corpus_count" in out, false);
});

test("a deal more than 10 miles away is dropped", () => {
  const far = row({ ll: offsetMiles(BOISE, 15) });
  const out = blendNearbyComps(report(), [far], OPTS);
  assert.equal(out.comps.length, 1);
  assert.equal("corpus_count" in out, false);
});

test("the 10-mile boundary is inclusive", () => {
  const edge = offsetMiles(BOISE, 0);
  // Walk north until haversine says just inside / just outside.
  let inner = null, outer = null;
  for (let mi = 9.7; mi <= 10.4; mi += 0.05) {
    const pt = offsetMiles(BOISE, mi);
    const d = milesBetween(BOISE, pt);
    if (d <= RADIUS_MILES) inner = pt;
    if (d > RADIUS_MILES && !outer) outer = pt;
  }
  assert.ok(inner && outer, "need points on both sides of 10 miles");
  const inRep = blendNearbyComps(report(), [row({ ll: inner })], OPTS);
  const outRep = blendNearbyComps(report(), [row({ ll: outer })], OPTS);
  assert.equal(inRep.corpus_count, 1);
  assert.equal("corpus_count" in outRep, false);
});

test("a deal outside the lookback is dropped", () => {
  const old = row({ deal_date: "Mar 2024" });
  const out = blendNearbyComps(report(), [old], OPTS);
  assert.equal("corpus_count" in out, false);
});

test("an unparseable date (Active listing) is dropped", () => {
  const live = row({ deal_date: "Active" });
  const out = blendNearbyComps(report(), [live], OPTS);
  assert.equal("corpus_count" in out, false);
});

test("an unpriced row is dropped", () => {
  const out = blendNearbyComps(report(), [row({ price_or_rate: "", price_per_sqft: "" })], OPTS);
  assert.equal("corpus_count" in out, false);
});

test("an aggregate address is dropped", () => {
  const out = blendNearbyComps(report(), [row({ address: "Boise industrial market average" })], OPTS);
  assert.equal("corpus_count" in out, false);
});

test("a row with no coordinates is dropped, not guessed as same-city", () => {
  const out = blendNearbyComps(report(), [row({ lat: "", lng: "" })], OPTS);
  assert.equal("corpus_count" in out, false);
});

test("the subject property is never added as a comp of itself", () => {
  const self = row({ address: "100 Subject St, Boise, ID" });
  const out = blendNearbyComps(report(), [self], OPTS);
  assert.equal("corpus_count" in out, false);
});

test("a duplicate of a search comp is not added twice", () => {
  const dup = row({
    address: "1 Search Ave, Boise, ID",
    deal_date: "Feb 2026",
    price_or_rate: "3000000",
  });
  const out = blendNearbyComps(report(), [dup], OPTS);
  assert.equal(out.comps.length, 1);
});

test("estimate, news, and lease rows that pass the bars are kept", () => {
  const rows = [
    row({ address: "10 Guess St, Boise, ID", source_type: "estimate" }),
    row({ address: "11 News St, Boise, ID", source_type: "news", ll: offsetMiles(BOISE, 4) }),
    row({ address: "12 Lease St, Boise, ID", transaction: "Lease", ll: offsetMiles(BOISE, 3) }),
  ];
  const out = blendNearbyComps(report(), rows, OPTS);
  assert.equal(out.corpus_count, 3);
});

test("missing subject coordinates leave the report untouched", () => {
  const rep = report({ subject_lat: "", subject_lng: "" });
  const out = blendNearbyComps(rep, [row()], { ...OPTS, subject: null });
  assert.equal(out, rep);
});

test("opts.subject is used when the report has no subject_lat", () => {
  const rep = report({ subject_lat: "", subject_lng: "" });
  const out = blendNearbyComps(rep, [row()], { ...OPTS, subject: BOISE });
  assert.equal(out.corpus_count, 1);
});

test("toReportComp never carries corpus plumbing columns", () => {
  const c = toReportComp(row({
    dedupe_key: "x", user_id: "nope", market: "Boise, ID", ts: "2026-08-14",
  }));
  assert.equal(c.dedupe_key, undefined);
  assert.equal(c.user_id, undefined);
  assert.equal(c.market, undefined);
  assert.equal(c.ts, undefined);
  assert.equal(c.from_corpus, true);
});

test("attachCompDistances stamps miles onto comps that already have a point", () => {
  const near = offsetMiles(BOISE, 2);
  const rep = report({
    comps: [{ address: "9 Old Cache Rd, Boise, ID", lat: String(near.lat), lng: String(near.lng) }],
  });
  const out = attachCompDistances(rep);
  assert.notEqual(out, rep, "must not mutate the cached report object");
  assert.equal(rep.comps[0].distance_mi, undefined);
  assert.equal(typeof out.comps[0].distance_mi, "number");
  assert.ok(out.comps[0].distance_mi > 1 && out.comps[0].distance_mi < 3);
});

test("attachCompDistances leaves unplaced comps and already-stamped comps alone", () => {
  const rep = report({
    comps: [
      { address: "no pin", date: "Feb 2026" },
      { address: "already", distance_mi: 3.1, lat: String(BOISE.lat), lng: String(BOISE.lng) },
    ],
  });
  const out = attachCompDistances(rep);
  assert.equal(out, rep);
  assert.equal(out.comps[0].distance_mi, undefined);
  assert.equal(out.comps[1].distance_mi, 3.1);
});

test("radiusMilesFor keeps CRE at 10 miles and houses at 1", () => {
  assert.equal(radiusMilesFor("Industrial"), RADIUS_MILES);
  assert.equal(radiusMilesFor("Office"), RADIUS_MILES);
  assert.equal(radiusMilesFor("Residential"), RESIDENTIAL_RADIUS_MILES);
  assert.equal(radiusMilesFor(""), RADIUS_MILES);
});

test("a market note of 2.5 miles is the house blend radius, not the 1-mile default", () => {
  assert.equal(radiusMilesFor("Residential", "2.5 miles"), 2.5);
  assert.equal(radiusMilesFor("Residential", "within 2.5 mi"), 2.5);
  const inner = row({ ll: offsetMiles(BOISE, 2.4), address: "40 Note Rd, Boise, ID" });
  const out = blendNearbyComps(report(), [inner], {
    ...OPTS, propertyType: "Residential", marketNote: "2.5 miles",
  });
  assert.equal(out.corpus_count, 1);
  const far = row({ ll: offsetMiles(BOISE, 5), address: "41 Past Rd, Boise, ID" });
  const past = blendNearbyComps(report(), [far], {
    ...OPTS, propertyType: "Residential", marketNote: "2.5 miles",
  });
  assert.equal("corpus_count" in past, false);
});

test("a Residential report drops a deal 5 miles out that CRE would keep", () => {
  const five = row({ ll: offsetMiles(BOISE, 5) });
  const house = blendNearbyComps(report(), [five], { ...OPTS, propertyType: "Residential" });
  const warehouse = blendNearbyComps(report(), [five], { ...OPTS, propertyType: "Industrial" });
  assert.equal("corpus_count" in house, false);
  assert.equal(warehouse.corpus_count, 1);
});

test("a Residential report keeps a deal inside one mile", () => {
  const inner = row({ ll: offsetMiles(BOISE, 0.6), address: "12 Next St, Boise, ID" });
  const out = blendNearbyComps(report(), [inner], { ...OPTS, propertyType: "Residential" });
  assert.equal(out.corpus_count, 1);
  assert.ok(out.comps[1].distance_mi < 1);
});

test("impliedSubjectPsf is ask divided by size, and opts.subjectPsf wins", () => {
  const rep = report({
    subject_asking: { price: "$2,000,000" },
    subject_size_sqft: "4000",
  });
  assert.equal(impliedSubjectPsf(rep), 500);
  assert.equal(impliedSubjectPsf(rep, { subjectPsf: 450 }), 450);
  assert.equal(impliedSubjectPsf(report()), 0);
});

test("samePriceTier treats missing data as a match and a 2x miss as a different pocket", () => {
  assert.equal(samePriceTier(0, 500), true);
  assert.equal(samePriceTier(500, 0), true);
  assert.equal(samePriceTier(500, 500), true);
  assert.equal(samePriceTier(600, 500), true);   // 1.2x, inside 1.5x
  assert.equal(samePriceTier(250, 500), false);  // 2x, the $2M house vs $1M extras
});

test("Residential extras 2x off the asking $/SF are dropped even inside a mile", () => {
  const cheap = row({
    ll: offsetMiles(BOISE, 0.4),
    address: "8 Cheaper Ln, Boise, ID",
    price_or_rate: "1000000",
    size_sqft: "4000",
    price_per_sqft: "250",
  });
  const peer = row({
    ll: offsetMiles(BOISE, 0.5),
    address: "9 Peer St, Boise, ID",
    price_or_rate: "1900000",
    size_sqft: "4000",
    price_per_sqft: "475",
  });
  const rep = report({
    subject_asking: { price: "$2,000,000" },
    subject_size_sqft: "4000",
  });
  const out = blendNearbyComps(rep, [cheap, peer], { ...OPTS, propertyType: "Residential" });
  assert.equal(out.corpus_count, 1);
  assert.equal(out.comps[1].address, "9 Peer St, Boise, ID");
});

test("Residential extras of any price join when there is no ask to compare", () => {
  const cheap = row({
    ll: offsetMiles(BOISE, 0.4),
    address: "8 Cheaper Ln, Boise, ID",
    price_per_sqft: "250",
  });
  const out = blendNearbyComps(report(), [cheap], { ...OPTS, propertyType: "Residential" });
  assert.equal(out.corpus_count, 1);
});
