// The market-page refresh rule.
//
// Market pages are the public SEO surface, and until 2026-08-06 they were
// write-once in practice: all 27 curated seed pages carried generatedAt
// 2026-07-14 and nothing could ever replace them. `isBetterSnapshot` is what
// unfreezes them, so it is also the thing standing between a good page and a
// worse one. A bad swap is more damaging than a stale page, which is why the
// rule refuses far more often than it accepts.
//
// Cost: zero. Pure function, no server, no database, no clock.

const test = require("node:test");
const assert = require("node:assert");
const {
  isBetterSnapshot, distillMarketSnapshot, safeHttpUrl, leaseRentPsfYr,
  rentFromComps, opexRangeFrom, trendPctFrom, directionFrom,
  freshDirection, DIRECTION_MAX_AGE_DAYS,
} = require("../market-snapshot");

const snap = (generatedAt, count) => ({ generatedAt, ppsf: { count } });

test("market snapshot refresh rule", async (t) => {
  await t.test("newer and equally deep replaces", () => {
    assert.equal(isBetterSnapshot(snap("2026-08-06", 9), snap("2026-07-14", 9)), true);
  });

  await t.test("newer and deeper replaces", () => {
    assert.equal(isBetterSnapshot(snap("2026-08-06", 12), snap("2026-07-14", 9)), true);
  });

  await t.test("newer but THINNER does not replace", () => {
    // The failure this rule exists to prevent: a quiet market returns three
    // comps, and a twelve-comp page is overwritten with it and called an
    // update. Fresher is not automatically better.
    assert.equal(isBetterSnapshot(snap("2026-08-06", 3), snap("2026-07-14", 12)), false);
  });

  await t.test("older never replaces, however deep", () => {
    assert.equal(isBetterSnapshot(snap("2026-06-01", 40), snap("2026-07-14", 4)), false);
  });

  await t.test("same day never replaces", () => {
    // Equal stamps mean a second search the same day rewrites nothing. Without
    // this, every repeat search in a covered market would churn a DB write and
    // bump the sitemap's lastmod for no new information.
    assert.equal(isBetterSnapshot(snap("2026-07-14", 20), snap("2026-07-14", 4)), false);
  });

  await t.test("anything replaces nothing", () => {
    assert.equal(isBetterSnapshot(snap("2026-08-06", 3), null), true);
    assert.equal(isBetterSnapshot(snap("2026-08-06", 3), undefined), true);
    assert.equal(isBetterSnapshot(snap("2026-08-06", 3), {}), true);
  });

  await t.test("a candidate with no stamp is refused", () => {
    // Fails CLOSED: an undated snapshot cannot be shown to be newer, and
    // accepting it would also write an empty lastmod into the sitemap.
    assert.equal(isBetterSnapshot({ ppsf: { count: 99 } }, snap("2026-07-14", 2)), false);
    assert.equal(isBetterSnapshot(null, snap("2026-07-14", 2)), false);
  });

  await t.test("a missing comp count reads as zero, not as a pass", () => {
    // A malformed candidate must not slip through on a NaN comparison.
    assert.equal(isBetterSnapshot({ generatedAt: "2026-08-06" }, snap("2026-07-14", 5)), false);
    // ...and it may still replace a current page that is equally countless.
    assert.equal(isBetterSnapshot({ generatedAt: "2026-08-06" }, { generatedAt: "2026-07-14" }), true);
  });

  await t.test("ISO date strings compare correctly as strings", () => {
    // The rule leans on lexicographic order, which is only safe for
    // zero-padded YYYY-MM-DD. Pin it so nobody swaps in a looser format.
    assert.equal(isBetterSnapshot(snap("2026-10-01", 5), snap("2026-09-30", 5)), true);
    assert.equal(isBetterSnapshot(snap("2026-09-30", 5), snap("2026-10-01", 5)), false);
    assert.equal(isBetterSnapshot(snap("2027-01-01", 5), snap("2026-12-31", 5)), true);
  });
});

test("safeHttpUrl refuses anything that should not become an href", () => {
  assert.equal(safeHttpUrl("https://example.com/deal"), "https://example.com/deal");
  assert.equal(safeHttpUrl("http://example.com/a"), "http://example.com/a");
  assert.equal(safeHttpUrl("https://example.com/a?q=1&x=2"), "https://example.com/a?q=1&x=2");
  assert.equal(safeHttpUrl(" javascript:alert(1) "), "");
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpUrl("data:text/html,hi"), "");
  assert.equal(safeHttpUrl("/relative"), "");
  assert.equal(safeHttpUrl("https://user:pass@example.com/secret"), "");
  assert.equal(safeHttpUrl(""), "");
  assert.equal(safeHttpUrl(null), "");
});

test("lease rent parses annual $/SF/yr and refuses monthly-only strings", () => {
  assert.equal(leaseRentPsfYr({ price_per_sqft: "$12.96" }), 12.96);
  assert.equal(leaseRentPsfYr({ price_or_rate: "$12.96/SF/yr NNN" }), 12.96);
  assert.ok(Number.isNaN(leaseRentPsfYr({
    price_or_rate: "$1.08/SF/month NNN",
  })), "monthly-only must not be stored as an annual band");
  // The parenthetical annual figure is the fallback when price_per_sqft is empty.
  assert.equal(leaseRentPsfYr({
    price_or_rate: "$1.08/SF/month NNN ($12.96/SF/yr NNN)",
  }), 12.96);
});

test("rentFromComps under-claims below two priced leases", () => {
  assert.equal(rentFromComps([]), null);
  assert.equal(rentFromComps([
    { transaction: "Lease", price_per_sqft: "12" },
  ]), null);
  const rent = rentFromComps([
    { transaction: "Sale", price_per_sqft: "200" },
    { transaction: "Lease", price_per_sqft: "12.96" },
    { transaction: "Lease", price_per_sqft: "15.00" },
    { transaction: "Lease", price_per_sqft: "15.60" },
  ]);
  assert.equal(rent.count, 3);
  assert.equal(rent.median, 15);
  assert.ok(rent.low <= rent.median && rent.median <= rent.high);
});

test("opex and trend omit rather than invent", () => {
  assert.equal(opexRangeFrom({}), null);
  assert.equal(opexRangeFrom({ market_opex_range: { low: "32%" } }), null);
  const opex = opexRangeFrom({ market_opex_range: { low: "32%", high: "38%", note: "assumes NNN" } });
  assert.deepEqual(opex, { low: "32%", high: "38%", note: "assumes NNN" });
  assert.equal(trendPctFrom({}), null);
  assert.equal(trendPctFrom({ annual_price_trend_pct: "0" }), null);
  assert.equal(trendPctFrom({ annual_price_trend_pct: "31" }), null);
  assert.equal(trendPctFrom({ annual_price_trend_pct: "-6.5%" }), -6.5);
  assert.equal(trendPctFrom({ annual_price_trend_pct: "4" }), 4);
});

test("directionFrom takes only the three words, and omits otherwise", () => {
  assert.equal(directionFrom({}), null);
  assert.equal(directionFrom({ price_discovery: null }), null);
  assert.equal(directionFrom({ price_discovery: { direction: "" } }), null);
  assert.equal(directionFrom({ price_discovery: { direction: "  Contracting " } }), "contracting");
  assert.equal(directionFrom({ price_discovery: { direction: "EXPANDING" } }), "expanding");
  assert.equal(directionFrom({ price_discovery: { direction: "flat" } }), "flat");
  // A near-miss is dropped, not passed through: this string becomes a colour
  // in the Explorer dropdown, and a colour is a claim.
  assert.equal(directionFrom({ price_discovery: { direction: "booming" } }), null);
  assert.equal(directionFrom({ price_discovery: { direction: "expanding slightly" } }), null);
  // Inherited keys are not a direction.
  assert.equal(directionFrom({ price_discovery: { direction: "constructor" } }), null);
});

test("a direction speaks for 90 days and then goes quiet", () => {
  const now = Date.parse("2026-08-20T00:00:00Z");
  const page = (generatedAt, direction = "expanding") => ({ direction, generatedAt });
  assert.equal(DIRECTION_MAX_AGE_DAYS, 90);
  assert.equal(freshDirection(page("2026-08-20"), now), "expanding");
  assert.equal(freshDirection(page("2026-08-19", "contracting"), now), "contracting");
  // The boundary itself is INCLUSIVE — exactly 90 days still speaks, 91 does not.
  assert.equal(freshDirection(page("2026-05-22"), now), "expanding");
  assert.equal(freshDirection(page("2026-05-21"), now), null);
  // Unknown age is not young. A snapshot with no readable stamp cannot show a
  // read of "right now", so it shows nothing.
  assert.equal(freshDirection({ direction: "flat" }, now), null);
  assert.equal(freshDirection(page(""), now), null);
  assert.equal(freshDirection(page("last Tuesday"), now), null);
  // The word is still validated here, not just at write time: these payloads
  // come back out of a database that a hand-edit can reach.
  assert.equal(freshDirection(page("2026-08-19", "booming"), now), null);
  assert.equal(freshDirection(page("2026-08-19", "constructor"), now), null);
  assert.equal(freshDirection(null, now), null);
  // Every seeded page was stamped the same July day; none of them has aged out
  // yet, so turning the gate on changes nothing that is live today.
  assert.equal(freshDirection(page("2026-07-14"), now), "expanding");
});

const sale = (over = {}) => ({
  address: "100 Main St, Boise, ID", date: "Mar 2026", transaction: "Sale",
  size_sqft: "20000", price_or_rate: "$2,000,000", price_per_sqft: "$100",
  source_type: "listing", ...over,
});

test("distillMarketSnapshot keeps a citable URL and drops the rest", () => {
  const { snapshot, pricedSaleCount } = distillMarketSnapshot(
    { type: "Industrial", city: "Boise", state: "ID" },
    {
      summary: "Firm.",
      market_trend: "Up a bit.",
      value_drivers: ["Low vacancy"],
      market_cap_rate_range: { low: "5.5%", high: "6.5%" },
      market_opex_range: { low: "28%", high: "34%", note: "assumes NNN" },
      annual_price_trend_pct: "4.5",
      price_discovery: { direction: "expanding", note: "Buyers are paying up." },
      comps: [
        sale({
          source_url: "https://example.com/deal",
          cap_rate: "6.1%", tenancy: "NNN", year_built: "2019",
          notes: "do not store me", verified: true, lat: "43.6", lng: "-116.2",
        }),
        sale({ address: "200 Main St, Boise, ID", price_per_sqft: "$110",
          source_url: "javascript:alert(1)" }),
        sale({ address: "300 Main St, Boise, ID", price_per_sqft: "$90",
          source_url: "https://user:secret@evil.example/x" }),
        { transaction: "Lease", address: "1 Lease St, Boise, ID", date: "Feb 2026",
          size_sqft: "10000", price_or_rate: "$12/SF/yr NNN", price_per_sqft: "$12",
          source_url: "https://example.com/lease" },
        { transaction: "Lease", address: "2 Lease St, Boise, ID", date: "Jan 2026",
          size_sqft: "8000", price_or_rate: "$14/SF/yr", price_per_sqft: "$14",
          source_url: "" },
      ],
    },
  );
  assert.equal(pricedSaleCount, 3);
  assert.ok(snapshot);
  assert.equal(snapshot.comps[0].source_url, "https://example.com/deal");
  assert.equal(snapshot.comps[0].cap_rate, "6.1%");
  assert.equal(snapshot.comps[0].tenancy, "NNN");
  assert.equal(snapshot.comps[0].year_built, "2019");
  assert.equal("notes" in snapshot.comps[0], false);
  assert.equal("verified" in snapshot.comps[0], false);
  assert.equal("lat" in snapshot.comps[0], false);
  assert.equal(snapshot.comps[1].source_url, "");
  assert.equal(snapshot.comps[2].source_url, "");
  assert.deepEqual(snapshot.market_opex_range, { low: "28%", high: "34%", note: "assumes NNN" });
  assert.equal(snapshot.annual_price_trend_pct, 4.5);
  assert.equal(snapshot.direction, "expanding");
  // The note stays out: the Explorer shows a word, and storing prose would
  // put a second, unrendered market narrative into every committed snapshot.
  assert.equal("price_discovery" in snapshot, false);
  assert.equal(snapshot.rent.count, 2);
  assert.equal(snapshot.rent.median, 13);
});

test("distillMarketSnapshot omits analyst extras when the search did not earn them", () => {
  const { snapshot } = distillMarketSnapshot(
    { type: "Industrial", city: "Boise", state: "ID" },
    { comps: [sale(), sale({ address: "2 St", price_per_sqft: "$120" })] },
  );
  assert.equal("market_opex_range" in snapshot, false);
  assert.equal("annual_price_trend_pct" in snapshot, false);
  assert.equal("direction" in snapshot, false);
  assert.equal("rent" in snapshot, false);
});
