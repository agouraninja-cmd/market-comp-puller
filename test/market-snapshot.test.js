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
  rentFromComps, leaseQuoteBasis, opexRangeFrom, trendPctFrom, directionFrom,
  freshDirection, DIRECTION_MAX_AGE_DAYS,
} = require("../market-snapshot");

const snap = (generatedAt, count) => ({ generatedAt, ppsf: { count } });

// ---------------------------------------------------------------------------
// One copy of the rent math, in both runtimes (2026-08-21).
//
// A leases-only report headlines rentFromComps, and the report is rendered in
// the browser and recomputed whenever a reader excludes a comp, so the figure
// cannot be computed once on the server and shipped. The module is therefore
// dual-exported the way valuation.js, gut-check.js and explore-query.js are.
//
// This runs the FILE, in a context with no `module`, and checks the global it
// leaves behind answers identically. A copy-paste of leaseRentPsfYr into
// index.html would be two answers to "is this rate monthly or annual" — the
// exact parse the function exists to get right — and nothing else would catch
// the day they diverged.
// ---------------------------------------------------------------------------
test("market-snapshot.js loads in a browser as MARKETSNAP, with the same answers", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const src = fs.readFileSync(path.join(__dirname, "..", "market-snapshot.js"), "utf8");
  const sandbox = {};
  sandbox.self = sandbox;                      // a browser, so no `module`
  vm.createContext(sandbox);
  new vm.Script(src, { filename: "market-snapshot.js" }).runInContext(sandbox);

  const browser = sandbox.MARKETSNAP;
  assert.ok(browser, "index.html calls MARKETSNAP and would throw on load without it");
  for (const fn of ["rentFromComps", "leaseRentPsfYr", "isLease"]) {
    assert.equal(typeof browser[fn], "function", fn);
  }

  // The monthly/annual trap, asked of both copies at once.
  const comps = [
    { transaction: "Lease", price_or_rate: "$1.08/SF/month NNN ($12.96/SF/yr NNN)" },
    { transaction: "Lease", price_per_sqft: 14 },
    { transaction: "Lease", price_per_sqft: 16 },
    { transaction: "Sale", price_per_sqft: 240 },
  ];
  assert.deepEqual(browser.rentFromComps(comps), rentFromComps(comps));
  assert.equal(browser.rentFromComps(comps).count, 3, "the sale comp is not a rent");
  assert.deepEqual(comps.map(browser.leaseRentPsfYr), comps.map(leaseRentPsfYr));
  assert.equal(typeof browser.leaseQuoteBasis, "function");
});

// ---------------------------------------------------------------------------
// Which basis a market QUOTES in (2026-08-21).
//
// The figure stays annual — that half never bends, for broker-vault.js 029's
// reason. This is the display half of the same rule: California industrial and
// retail quote monthly, so "$16.20/SF/yr" in Fontana is a number nobody there
// says out loud, while $1.35/SF is an ordinary monthly rent and an impossible
// annual one.
//
// The vault REFUSES to default `rent_basis` because it writes a stored figure
// and a wrong guess is 12x wrong forever. This may default, because nothing is
// stored and the annual number is already correct — at worst unidiomatic,
// never incorrect. These pin that asymmetry.
// ---------------------------------------------------------------------------
test("a market's quoting basis is read off the comps, never guessed", () => {
  const L = (rate) => ({ transaction: "Lease", price_or_rate: rate });

  // The LEADING quote wins. This exact string is how a monthly market's comps
  // actually arrive, and counting both halves would make it one vote each.
  assert.equal(leaseQuoteBasis([
    L("$1.08/SF/month NNN ($12.96/SF/yr NNN)"),
    L("$1.15/SF/mo"),
  ]), "monthly");

  assert.equal(leaseQuoteBasis([L("$13.50/SF/yr"), L("$15.00/SF/year")]), "annual");

  // Evidence only. A bare numeric price_per_sqft states no basis and votes for
  // neither, so a whole set of them falls back to annual rather than to the
  // last thing anyone happened to see.
  assert.equal(leaseQuoteBasis([
    { transaction: "Lease", price_per_sqft: 14 },
    { transaction: "Lease", price_per_sqft: 16 },
  ]), "annual");
  assert.equal(leaseQuoteBasis([]), "annual");
  assert.equal(leaseQuoteBasis(null), "annual");

  // A tie is not a monthly market. Monthly has to WIN, not merely appear,
  // because annual is the safe direction to be wrong in.
  assert.equal(leaseQuoteBasis([L("$1.08/SF/mo"), L("$13.50/SF/yr")]), "annual");

  // Sales are not leases, whatever they are quoted in.
  assert.equal(leaseQuoteBasis([{ transaction: "Sale", price_or_rate: "$240/SF/mo" }]), "annual");

  // And the basis is a DISPLAY choice that never touches the figure: the same
  // comps annualize identically whichever way they were quoted.
  const monthlyQuoted = [
    { transaction: "Lease", price_or_rate: "$1.00/SF/month ($12.00/SF/yr)" },
    { transaction: "Lease", price_or_rate: "$1.50/SF/month ($18.00/SF/yr)" },
  ];
  assert.equal(leaseQuoteBasis(monthlyQuoted), "monthly");
  assert.equal(rentFromComps(monthlyQuoted).median, 15,
    "the median is annual in a monthly market too — one canonical figure, 029's rule");
});

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
  // Provenance: a search-supplied read is marked as one, so the backfill script
  // can tell it apart from a direction derived off the market_trend sentence.
  assert.equal(snapshot.direction_source, "price_discovery");
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
  assert.equal("direction_source" in snapshot, false);
  assert.equal("rent" in snapshot, false);
});

// ---------------------------------------------------------------------------
// A monthly rate must never be banked as an annual one
//
// price_per_sqft is a bare number with no basis of its own, and the prompt asks
// the model to put THE QUOTED RATE there — which in California industrial and
// retail is the monthly figure. Reading it first meant the same lease answered
// 1.08 or 12.96 depending only on which field it arrived in, and leaseQuoteBasis
// (correctly reading the comp as monthly-quoted) then divided the already-
// monthly figure by 12 again for display: $0.09/SF/mo on a $1.08 market.
// ---------------------------------------------------------------------------

test("the same lease reads the same whichever field carries the rate", () => {
  const withPsf = {
    transaction: "Lease", price_per_sqft: "$1.08",
    price_or_rate: "$1.08/SF/month NNN ($12.96/SF/yr NNN)",
  };
  const withoutPsf = {
    transaction: "Lease",
    price_or_rate: "$1.08/SF/month NNN ($12.96/SF/yr NNN)",
  };
  assert.equal(leaseRentPsfYr(withPsf), 12.96);
  assert.equal(leaseRentPsfYr(withoutPsf), 12.96);
  assert.equal(leaseRentPsfYr(withPsf), leaseRentPsfYr(withoutPsf),
    "one lease, one rent — the shape it arrived in cannot change it");

  const band = rentFromComps([withPsf, withoutPsf]);
  assert.equal(band.median, 12.96, "and the market median is a rent, not the mean of two units");
});

test("a monthly-only quote is refused even when price_per_sqft carries it", () => {
  // Refusing monthly-only is this file’s existing decision (see the test
  // higher up this file) and it stands. What was broken is that the refusal
  // was reachable ONLY when price_per_sqft happened to be empty: with the bare
  // number read first, the very same comp came back as an annual band 12x too
  // low, and leaseQuoteBasis then divided it by 12 again for display.
  assert.ok(Number.isNaN(leaseRentPsfYr({
    transaction: "Lease", price_per_sqft: "$1.35", price_or_rate: "$1.35/SF/mo NNN",
  })), "the monthly figure must not be banked as an annual one");
  assert.ok(Number.isNaN(leaseRentPsfYr({
    transaction: "Lease", price_per_sqft: "$1.35", price_or_rate: "$1.35/SF/month",
  })));
});

test("a stated annual rate wins even when price_per_sqft holds the other figure", () => {
  // The string names its unit; the bare number does not, so the string decides.
  assert.equal(leaseRentPsfYr({
    transaction: "Lease", price_per_sqft: "$12.96",
    price_or_rate: "$1.08/SF/month ($12.96/SF/yr)",
  }), 12.96, "never 12.96 x 12");
});

test("price_per_sqft is still read as annual when nothing states a basis", () => {
  // The one case with nothing better to do, and the pre-existing behaviour.
  assert.equal(leaseRentPsfYr({
    transaction: "Lease", price_per_sqft: "$14.50", price_or_rate: "$14.50 NNN",
  }), 14.5);
});

test("the figure and the display basis agree about the same comp", () => {
  // The two halves of migration 029's rule: the stored figure is annual, the
  // display converts. They disagreeing is what printed $0.09/SF/mo.
  const comp = {
    transaction: "Lease", price_per_sqft: "$1.08",
    price_or_rate: "$1.08/SF/month NNN ($12.96/SF/yr NNN)",
  };
  assert.equal(leaseQuoteBasis([comp]), "monthly");
  assert.equal((leaseRentPsfYr(comp) / 12).toFixed(2), "1.08",
    "displayed in the basis the market quotes, back at the rate on the lease");
});
