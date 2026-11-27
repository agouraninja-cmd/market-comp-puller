// comp-fit.js: which comps value THIS property, and when to search wider.
// The fixture is the report that started it (2026-11-17): a 32,000 SF
// industrial building at 76 Inverness Dr E, Englewood CO, valued on two
// ~7,200 SF buildings, a condo unit cited to a parked domain, and comps
// ~9 miles off.
const test = require("node:test");
const assert = require("node:assert/strict");
const FIT = require("../comp-fit");

const PARKED = "https://innovatecre.com/recent-transactions";

function inverness() {
  return {
    subject_size_sqft: "32000",
    comps: [
      { address: "9500 E Easter Ave, Centennial, CO", transaction: "Sale", size_sqft: "7,200", price_or_rate: "$1,900,000", source_type: "listing", source_url: "https://example.com/a", distance_mi: 3.1 },
      { address: "9510 E Easter Ave, Centennial, CO", transaction: "Sale", size_sqft: "7,260", price_or_rate: "$1,950,000", source_type: "listing", source_url: "https://example.com/b", distance_mi: 3.2 },
      { address: "67 Inverness Dr E, Unit C, Englewood, CO", transaction: "Sale", size_sqft: "30,000", price_or_rate: "$6,000,000", source_type: "listing", source_url: PARKED, distance_mi: 0.1 },
      { address: "4900 Ward Rd, Wheat Ridge, CO", transaction: "Sale", size_sqft: "40,000", price_or_rate: "$9,600,000", source_type: "news", source_url: "https://example.com/d", distance_mi: 9.2 },
    ],
  };
}

test("the Inverness report: unit/dead source and the two tiny buildings are set aside, the floor keeps a number", () => {
  const r = inverness();
  const out = FIT.applyCompFit(r, { subjectSqft: 32000, propertyType: "Industrial", subjectAddress: "76 Inverness Dr E, Englewood, CO", deadUrls: new Set([PARKED]) });
  // The dead-sourced condo is cut for its source first (that reason wins).
  assert.equal(r.set_aside.find((c) => c.address.includes("67 Inverness")).set_aside, "dead_source");
  // Only one priced sale is left on size alone, so the floor brings back the
  // two small ones rather than leave a report with no number...
  assert.equal(r.comps.length, 3);
  // ...and that thin set is exactly what asks for a wider search.
  assert.equal(FIT.goodSaleCount(r, 32000), 1);
  assert.equal(FIT.needsWiderSearch(r, { propertyType: "Industrial", txFocus: "both", subjectSqft: 32000 }), true);
  assert.deepEqual(out.counts, { dead_source: 1 });
  assert.deepEqual(r.set_aside_counts, { dead_source: 1 });
});

test("once right-sized sales exist, off-size comps are cut and stay cut", () => {
  const r = inverness();
  r.comps.push(
    { address: "1 A St, Englewood, CO", transaction: "Sale", size_sqft: "28,000", price_or_rate: "$7,000,000", distance_mi: 1 },
    { address: "2 B St, Englewood, CO", transaction: "Sale", size_sqft: "35,000", price_or_rate: "$8,500,000", distance_mi: 2 },
  );
  FIT.applyCompFit(r, { subjectSqft: 32000, propertyType: "Industrial", deadUrls: [PARKED] });
  const cutSizes = r.set_aside.filter((c) => c.set_aside === "size").map((c) => c.size_sqft);
  assert.deepEqual(cutSizes.sort(), ["7,200", "7,260"]);
  assert.equal(r.comps.every((c) => !/Easter/.test(c.address)), true);
  assert.equal(FIT.goodSaleCount(r, 32000), 3);
  // Three right-sized sales is still under WIDER_SEARCH_BELOW (4); a fourth ends the hunt.
  assert.equal(FIT.needsWiderSearch(r, { propertyType: "Industrial", subjectSqft: 32000 }), true);
  r.comps.push({ address: "3 C St, Englewood, CO", transaction: "Sale", size_sqft: "33,000", price_or_rate: "$8,000,000" });
  assert.equal(FIT.needsWiderSearch(r, { propertyType: "Industrial", subjectSqft: 32000 }), false);
});

test("a far comp is cut only when enough near ones stand in for it", () => {
  const near = (i) => ({ address: `${i} Near St, Englewood, CO`, transaction: "Sale", size_sqft: "30000", price_or_rate: "$7,000,000", distance_mi: 1 + i / 10 });
  const far = { address: "9 Far Rd, Golden, CO", transaction: "Sale", size_sqft: "30000", price_or_rate: "$7,000,000", distance_mi: 9.2 };
  const thin = { comps: [near(1), near(2), far] };
  FIT.applyCompFit(thin, { subjectSqft: 32000, propertyType: "Industrial" });
  assert.equal(thin.comps.includes(far), true, "with 2 near comps the 9-mile one stays");
  const full = { comps: [near(1), near(2), near(3), near(4), far] };
  FIT.applyCompFit(full, { subjectSqft: 32000, propertyType: "Industrial" });
  assert.equal(full.comps.includes(far), false);
  assert.equal(full.set_aside[0].set_aside, "distance");
  // A typed radius wider than the cut keeps comps inside it.
  const typed = { comps: [near(1), near(2), near(3), near(4), far] };
  FIT.applyCompFit(typed, { subjectSqft: 32000, propertyType: "Industrial", radiusMiles: 15 });
  assert.equal(typed.comps.includes(far), true);
  // An unplaced comp is never cut for distance.
  const unplaced = { comps: [near(1), near(2), near(3), near(4), { ...far, distance_mi: undefined }] };
  FIT.applyCompFit(unplaced, { subjectSqft: 32000, propertyType: "Industrial" });
  assert.equal(unplaced.comps.length, 5);
});

test("unit sales: cut against a whole building, kept as leases and for a unit subject", () => {
  assert.equal(FIT.unitOf("67 Inverness Dr E, Unit C, Englewood, CO 80112"), "Unit C");
  assert.equal(FIT.unitOf("400 Main St Suite 200, Boise, ID"), "Suite 200");
  assert.equal(FIT.unitOf("12 Oak Ave #4, Boise, ID"), "#4");
  // A building in a park is a whole building; a ZIP is not a "#".
  assert.equal(FIT.unitOf("5600 Building C Way, Denver, CO 80239"), null);
  assert.equal(FIT.unitOf("100 Industrial Pkwy Building 3, Denver, CO"), null);
  assert.equal(FIT.unitOf("76 Inverness Dr E, Englewood, CO 80112"), null);
  assert.equal(FIT.unitOf("1200 United Ave, Denver, CO"), null);
  assert.equal(FIT.isUnitSale({ address: "5 Elm St, Denver, CO", transaction: "Sale", notes: "Office condo sale" }), true);

  const sale = { address: "10 X St Suite 5, Denver, CO", transaction: "Sale", size_sqft: "30000", price_or_rate: "$5,000,000" };
  const lease = { address: "11 X St Suite 6, Denver, CO", transaction: "Lease", size_sqft: "30000", price_per_sqft: "$12" };
  const r = { comps: [sale, lease] };
  FIT.applyCompFit(r, { subjectSqft: 30000, propertyType: "Office", subjectAddress: "1 Y St, Denver, CO" });
  assert.deepEqual(r.comps, [lease]);
  assert.equal(r.set_aside[0].set_aside, "unit");
  const unitSubject = { comps: [sale] };
  FIT.applyCompFit(unitSubject, { subjectSqft: 30000, propertyType: "Office", subjectAddress: "1 Y St Suite 9, Denver, CO" });
  assert.deepEqual(unitSubject.comps, [sale]);
});

test("dead sources and unit sales never come back under the floor; verified comps are never touched", () => {
  const r = { comps: [
    { address: "1 A St, Denver, CO", transaction: "Sale", size_sqft: "30000", price_or_rate: "$5,000,000", source_url: PARKED },
    { address: "2 B St Unit 4, Denver, CO", transaction: "Sale", size_sqft: "30000", price_or_rate: "$5,000,000" },
    { address: "3 C St, Denver, CO", transaction: "Sale", size_sqft: "1000", price_or_rate: "$500,000", verified: true, source_url: PARKED },
  ] };
  FIT.applyCompFit(r, { subjectSqft: 30000, propertyType: "Industrial", deadUrls: [PARKED] });
  assert.deepEqual(r.comps.map((c) => c.address), ["3 C St, Denver, CO"]);
  assert.deepEqual(r.set_aside_counts, { dead_source: 1, unit: 1 });
});

test("types the size rule does not apply to, and a missing subject size, cut nothing for size", () => {
  const tiny = { address: "1 A St, Boise, ID", transaction: "Sale", size_sqft: "800", price_or_rate: "$300,000" };
  for (const type of ["Residential", "Land", "Multifamily"]) {
    const r = { comps: [{ ...tiny }] };
    FIT.applyCompFit(r, { subjectSqft: 30000, propertyType: type });
    assert.equal(r.comps.length, 1, type);
  }
  const r = { comps: [{ ...tiny }] };
  FIT.applyCompFit(r, { subjectSqft: 0, propertyType: "Industrial" });
  assert.equal(r.comps.length, 1);
  assert.equal(FIT.needsWiderSearch(r, { propertyType: "Industrial", subjectSqft: 0 }), false);
  assert.equal(FIT.needsWiderSearch({ comps: [] }, { propertyType: "Industrial", subjectSqft: 30000, txFocus: "leases" }), false);
  assert.equal(FIT.needsWiderSearch({ comps: [] }, { propertyType: "Residential", subjectSqft: 2000 }), false);
});

test("the wider search's comps merge without repeats, including ones already set aside", () => {
  const r = inverness();
  FIT.applyCompFit(r, { subjectSqft: 32000, propertyType: "Industrial", deadUrls: [PARKED] });
  const known = FIT.knownAddresses(r);
  assert.equal(known.some((a) => a.includes("67 Inverness")), true, "set-aside addresses are excluded from the wider search too");
  const wider = { currency: "USD", comps: [
    { address: "67 INVERNESS DR E UNIT C, ENGLEWOOD, CO", transaction: "Sale" },
    { address: "1 New St, Englewood, CO", transaction: "Sale", size_sqft: "30000", price_or_rate: "$7,000,000" },
    { address: "1 New St, Englewood, CO", transaction: "Sale", size_sqft: "30000", price_or_rate: "$7,000,000" },
  ] };
  assert.equal(FIT.mergeWiderComps(r, wider, 12), 1);
  assert.equal(FIT.mergeWiderComps(r, { currency: "CAD", comps: [{ address: "2 X St, Toronto, ON" }] }, 12), 0);
  assert.equal(FIT.mergeWiderComps(r, { comps: [{ address: "3 Cap St, Denver, CO" }] }, r.comps.length), 0, "capped at maxComps");
});

test("set-aside comps: only size and distance are harvested, and a viewer gets counts, never the comps", () => {
  const r = inverness();
  r.comps.push(
    { address: "1 A St, Englewood, CO", transaction: "Sale", size_sqft: "28,000", price_or_rate: "$7,000,000" },
    { address: "2 B St, Englewood, CO", transaction: "Sale", size_sqft: "35,000", price_or_rate: "$8,500,000" },
  );
  FIT.applyCompFit(r, { subjectSqft: 32000, propertyType: "Industrial", deadUrls: [PARKED] });
  const harvest = FIT.harvestableSetAside(r);
  assert.deepEqual(harvest.map((c) => c.set_aside).sort(), ["size", "size"]);
  const served = FIT.stripSetAside(r);
  assert.equal("set_aside" in served, false);
  assert.deepEqual(served.set_aside_counts, { dead_source: 1, size: 2 });
  assert.equal(Array.isArray(r.set_aside), true, "the cached object keeps its list");
  const plain = { comps: [] };
  assert.equal(FIT.stripSetAside(plain), plain);
});

test("server.js wires the fit inside getComps, strips set_aside at serialization, and harvests the right ones", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "server.js"), "utf8");
  const getComps = src.slice(src.indexOf("async function getComps("), src.indexOf("function progressFor("));
  // Both paths: after the link check, before the report is returned (and so
  // before the cache write, the harvest and the snapshot in runCompSearch).
  assert.equal((getComps.match(/await refineComps\(/g) || []).length, 2);
  assert.ok(getComps.indexOf("applySourceLinkCheck(report") < getComps.indexOf("refineComps(report"));
  const viewer = src.slice(src.indexOf("async function finishReportForViewer("), src.indexOf("async function runCompSearch("));
  assert.match(viewer, /rep = COMPFIT\.stripSetAside\(rep\);\s*let merged = rep;/);
  // Before the first read of `rep` past the internal exit (the radius blend).
  assert.ok(viewer.indexOf("rep = COMPFIT.stripSetAside(rep)") < viewer.indexOf("blendNearbyComps(rep"));
  const harvest = src.slice(src.indexOf("async function harvestComps("), src.indexOf("async function harvestComps(") + 3000);
  assert.match(harvest, /COMPFIT\.harvestableSetAside\(payload\)/);
  // The rollbacks exist and the wider search is its own lane.
  assert.match(src, /process\.env\.COMP_FIT/);
  assert.match(src, /process\.env\.COMP_WIDER_SEARCH/);
  assert.match(src, /const compsOnly = lane === "records" \|\| lane === "wider";/);
  // A corrected address names the market a snapshot publishes under.
  assert.equal((src.match(/maybePublishMarketSnapshot\(typeOk, [a-z.]*subject_address_corrected \|\| addressOk/gi) || []).length, 3);
});

// index.html's half: the set-aside sentence and the corrected address, run
// out of the page's own source.
function pageFn(name) {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "index.html"), "utf8");
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, name + " is in index.html");
  let depth = 0, i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

test("the page says what was set aside, in counts, and nothing when nothing was", () => {
  const say = new Function(pageFn("setAsideSentence") + "; return setAsideSentence;")();
  assert.equal(say(null, null), "");
  assert.equal(say({}, { added: 0 }), "");
  assert.equal(say({ size: 1 }), "We left out 1 comp the search found: 1 was a very different size from your property.");
  assert.equal(say({ size: 2, unit: 1, dead_source: 1 }, { added: 3 }),
    "We left out 4 comps the search found: 2 were a very different size from your property; 1 was a condo or unit sale rather than a whole building; and 1 cited a source page that was dead or a parked domain. A second, wider search added 3 sales closer to your property's size.");
  assert.equal(say({ distance: 2 }), "We left out 2 comps the search found: 2 were farther away than closer sales we found.");
  assert.equal(say({}, { added: 1 }), "A second, wider search added 1 sale closer to your property's size.");
  assert.equal(say({ size: "<b>" }), "", "a non-number is no count");
});

test("the page adopts a corrected address once and keeps what was typed", () => {
  const box = { value: "76 Inverness Dr E, Inglewood, CO" };
  const document = { getElementById: (id) => (id === "address" ? box : null) };
  const adopt = new Function("document", pageFn("adoptCorrectedAddress") + "; return adoptCorrectedAddress;")(document);
  const meta = { address: "76 Inverness Dr E, Inglewood, CO" };
  const parsed = { subject_address_corrected: "76 Inverness Dr E, Englewood, CO 80112" };
  adopt(parsed, meta);
  assert.equal(meta.address, "76 Inverness Dr E, Englewood, CO 80112");
  assert.equal(meta.addressTyped, "76 Inverness Dr E, Inglewood, CO");
  assert.equal(box.value, "76 Inverness Dr E, Englewood, CO 80112");
  adopt(parsed, meta);   // a re-render
  assert.equal(meta.addressTyped, "76 Inverness Dr E, Inglewood, CO");
  const plain = { address: "1 A St, Boise, ID" };
  adopt({}, plain);
  assert.deepEqual(plain, { address: "1 A St, Boise, ID" });
});

// Net lease (2026-11-23): a single-tenant net-leased subject is valued on its
// comps' cap rates, which building size does not set.
test("a net-leased subject keeps off-size comps and never asks for a size-matched wider search", () => {
  const mk = () => ({
    comps: [
      { address: "1 Pad Way, Boise, ID", transaction: "Sale", size_sqft: "1,400", price_or_rate: "$1,600,000", cap_rate: "6%", source_url: "https://example.com/1" },
      { address: "2 Pad Way, Boise, ID", transaction: "Sale", size_sqft: "1,500", price_or_rate: "$1,700,000", cap_rate: "6.25%", source_url: "https://example.com/2" },
      { address: "3 Box Rd, Boise, ID", transaction: "Sale", size_sqft: "14,000", price_or_rate: "$5,000,000", cap_rate: "6.5%", source_url: "https://example.com/3" },
      { address: "4 Box Rd, Boise, ID", transaction: "Sale", size_sqft: "15,000", price_or_rate: "$5,200,000", cap_rate: "6.75%", source_url: "https://example.com/4" },
      { address: "5 Mid St, Boise, ID", transaction: "Sale", size_sqft: "3,400", price_or_rate: "$2,000,000", cap_rate: "7%", source_url: "https://example.com/5" },
      { address: "6 Mid St, Boise, ID", transaction: "Sale", size_sqft: "3,800", price_or_rate: "$2,100,000", cap_rate: "7%", source_url: "https://example.com/6" },
      { address: "7 Mid St, Boise, ID", transaction: "Sale", size_sqft: "4,000", price_or_rate: "$2,200,000", cap_rate: "7%", source_url: "https://example.com/7" },
    ],
  });
  const base = { subjectSqft: 3600, propertyType: "Retail", subjectAddress: "347 Main St, Boise, ID" };
  // Without the flag the two pads (0.39x, 0.42x is kept) and the two boxes are a different size class.
  const plain = mk();
  FIT.applyCompFit(plain, base);
  assert.ok(plain.set_aside && plain.set_aside.some((c) => c.set_aside === "size"), "the ordinary Retail rule still cuts on size");
  // With it, every comp stays: they are the cap-rate evidence.
  const nl = mk();
  const out = FIT.applyCompFit(nl, { ...base, netLease: true });
  assert.equal(nl.comps.length, 7);
  assert.equal(out.setAside, 0);
  assert.equal(nl.set_aside, undefined);
  // A dead source and a unit sale are still not evidence about anything.
  const dead = mk();
  dead.comps[0].source_url = PARKED;
  dead.comps[1].address = "2 Pad Way, Unit B, Boise, ID";
  FIT.applyCompFit(dead, { ...base, netLease: true, deadUrls: new Set([PARKED]) });
  assert.deepEqual(dead.set_aside_counts, { dead_source: 1, unit: 1 });
  // And a thin net-lease set does not buy a search for size-matched sales.
  const thin = { comps: mk().comps.slice(0, 2) };
  assert.equal(FIT.needsWiderSearch(thin, { propertyType: "Retail", subjectSqft: 3600 }), true);
  assert.equal(FIT.needsWiderSearch(thin, { propertyType: "Retail", subjectSqft: 3600, netLease: true }), false);
});

test("the search and the fit are told a subject is net leased, from the one definition", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(src, /const VALUATION = require\("\.\/valuation"\);/);
  const refine = src.slice(src.indexOf("async function refineComps(report, ctx) {"), src.indexOf("async function refineComps(report, ctx) {") + 3500);
  assert.match(refine, /const netLease = VALUATION\.isNetLease\(type, subjectDetails\);/);
  assert.match(refine, /radiusMiles: RADIUSBLEND\.parseRadiusMiles\(note\), netLease,/);
  assert.match(refine, /COMPFIT\.needsWiderSearch\(report, \{ propertyType: type, txFocus, subjectSqft, netLease \}\)/);
  const prompt = src.slice(src.indexOf("function buildPrompt("), src.indexOf("function buildPrompt(") + 40000);
  assert.match(prompt, /const netLease = VALUATION\.isNetLease\(type, subjectDetails\) && txFocus !== "leases" && lane !== "wider";/);
  assert.match(prompt, /\n    netLeaseBlock,\n/, "the block is in the prompt, not only built");
  assert.ok(prompt.indexOf("    netLeaseBlock,") > prompt.indexOf("`SIZE FIT:"), "after the rule it overrides");
  // A cap rate is computed from a page's own figures or left blank, never
  // estimated: an invented rate would move the value by a multiple.
  assert.match(prompt, /Never estimate a cap rate for a comp from market averages/);
});

// ---------------------------------------------------------------------------
// 2026-11-27: the price-basis rule, the blended re-fit and the time budget.
// ---------------------------------------------------------------------------

test("priceBasisOf reads the caveats the prompt asks for, and only as caveats", () => {
  const of = (notes, transaction = "Sale") => FIT.priceBasisOf({ transaction, notes });
  // What the prompt names: "portfolio or partial-interest sale, related-party
  // transfer, distressed or auction sale".
  assert.equal(of("Portfolio sale; price allocated."), "portfolio");
  assert.equal(of("Part of a 3-building portfolio sold to an investor."), "portfolio");
  assert.equal(of("One of a two-building package."), "portfolio");
  assert.equal(of("Partial-interest sale."), "partial_interest");
  assert.equal(of("50% interest sold to the co-owner."), "partial_interest");
  assert.equal(of("Related-party transfer between affiliates."), "related_party");
  assert.equal(of("Not arm's length: sold to an affiliated entity."), "related_party");
  assert.equal(of("Sold at auction after foreclosure."), "distressed");
  assert.equal(of("Bank-owned (REO) sale."), "distressed");
  assert.equal(of("Sold out of bankruptcy."), "distressed");
  assert.equal(of("Distressed sale; lender-directed."), "distressed");
  // The same words when they are not a statement about the sale. Each of
  // these is the false positive its pattern was narrowed to refuse.
  assert.equal(of("Buyer adds it to its regional portfolio."), null);
  assert.equal(of("Leased to an auto auction operator; NNN."), null);
  assert.equal(of("Auction yard tenant on a ground lease."), null);
  assert.equal(of("Tenant in bankruptcy; sold vacant."), null);
  assert.equal(of("Reo Blvd frontage, corner lot."), null);
  assert.equal(of("Sale-leaseback with the seller."), null);
  // A caveat that is ruled out is not a caveat.
  assert.equal(of("Not a portfolio sale. Owner-user buyer."), null);
  assert.equal(of("Non-distressed arm's-length sale."), null);
  assert.equal(of("No distress; stabilized at sale."), null);
  // An asking price is weighed as a listing, not set aside here.
  assert.equal(of("Asking price, not a closed sale."), null);
  // Sales only, and silence is not a caveat.
  assert.equal(of("Portfolio sale.", "Lease"), null);
  assert.equal(of(""), null);
  assert.equal(FIT.priceBasisOf(null), null);
});

function plainSale(i, extra) {
  return { address: `${i} Plain St, Boise, ID`, transaction: "Sale", size_sqft: "30000",
           price_or_rate: "$6,000,000", source_url: "https://example.com/p" + i, ...extra };
}

test("a sale whose notes say its price is not a market price is set aside, for every type", () => {
  for (const propertyType of ["Industrial", "Multifamily", "Land", "Residential"]) {
    const r = { comps: [plainSale(1), plainSale(2), plainSale(3),
      plainSale(4, { notes: "Sold at auction after foreclosure." }),
      plainSale(5, { notes: "Part of a 4-property portfolio; price allocated." })] };
    const out = FIT.applyCompFit(r, { subjectSqft: 30000, propertyType });
    assert.equal(r.comps.length, 3, propertyType);
    assert.deepEqual(out.counts, { price_basis: 2 }, propertyType);
    assert.deepEqual(r.set_aside.map((c) => c.set_aside), ["price_basis", "price_basis"]);
  }
  // A lease that mentions a portfolio is still a lease comp.
  const lease = { comps: [plainSale(1), { address: "9 Lease Ln, Boise, ID", transaction: "Lease", price_per_sqft: "$12", notes: "Portfolio sale pending." }] };
  FIT.applyCompFit(lease, { subjectSqft: 30000, propertyType: "Industrial" });
  assert.equal(lease.comps.length, 2);
  // A broker-verified comp is never second-guessed.
  const vouched = { comps: [plainSale(1, { verified: true, notes: "Sold at auction." })] };
  FIT.applyCompFit(vouched, { propertyType: "Industrial" });
  assert.equal(vouched.comps.length, 1);
});

test("under the floor a caveated sale comes back last, and a partial interest never does", () => {
  // Two plain sales, one off-size, one foreclosure: the floor needs one more
  // priced sale, and the off-size building is the better evidence.
  const r = { comps: [plainSale(1), plainSale(2),
    plainSale(3, { size_sqft: "9000", price_or_rate: "$2,400,000" }),
    plainSale(4, { notes: "Foreclosure sale." })] };
  FIT.applyCompFit(r, { subjectSqft: 30000, propertyType: "Industrial" });
  assert.deepEqual(r.comps.map((c) => c.address), ["1 Plain St, Boise, ID", "2 Plain St, Boise, ID", "3 Plain St, Boise, ID"]);
  assert.deepEqual(r.set_aside_counts, { price_basis: 1 });
  // With nothing else to bring back, the foreclosure is still a real price.
  const thin = { comps: [plainSale(1), plainSale(2), plainSale(4, { notes: "Foreclosure sale." })] };
  FIT.applyCompFit(thin, { subjectSqft: 30000, propertyType: "Industrial" });
  assert.equal(thin.comps.length, 3);
  assert.equal(thin.set_aside, undefined);
  // Half a building's price over the whole building's size is not a $/SF.
  const half = { comps: [plainSale(1), plainSale(2), plainSale(4, { notes: "50% interest sold." })] };
  FIT.applyCompFit(half, { subjectSqft: 30000, propertyType: "Industrial" });
  assert.equal(half.comps.length, 2);
  assert.deepEqual(half.set_aside_counts, { price_basis: 1 });
});

// The blended re-fit. `from_corpus` is what blend-corpus.js's toReportComp
// stamps on a saved deal.
function saved(address, extra) {
  return { address, transaction: "Sale", size_sqft: "30000", price_or_rate: "$6,300,000",
           date: "2026-06", source_type: "listing", from_corpus: true, distance_mi: 2, ...extra };
}
const BLEND_OPTS = { subjectSqft: 32000, propertyType: "Industrial", subjectAddress: "76 Inverness Dr E, Englewood, CO" };

test("a comp this report's search set aside does not come back as a saved deal", () => {
  const cached = inverness();
  cached.comps.push(
    { address: "1 A St, Englewood, CO", transaction: "Sale", size_sqft: "28,000", price_or_rate: "$7,000,000", distance_mi: 1 },
    { address: "2 B St, Englewood, CO", transaction: "Sale", size_sqft: "35,000", price_or_rate: "$8,500,000", distance_mi: 2 });
  FIT.applyCompFit(cached, { ...BLEND_OPTS, deadUrls: [PARKED] });
  assert.deepEqual(cached.set_aside_counts, { dead_source: 1, size: 2 });
  const barred = FIT.setAsideAddresses(cached);
  assert.equal(barred.length, 3);
  // What the viewer's copy looks like after the blend: the two small
  // buildings are back, harvested (respelled, as a corpus row can be) and
  // saved.
  const blended = { ...FIT.stripSetAside(cached), corpus_count: 3, comps: [...cached.comps,
    saved("9500 E Easter Ave, Centennial, CO", { size_sqft: "7200", price_or_rate: "$1,900,000" }),
    saved("9510 e easter ave,  Centennial, CO", { size_sqft: "7260", price_or_rate: "$1,950,000" }),
    saved("500 Other Way, Englewood, CO")] };
  const out = FIT.refitBlended(blended, { ...BLEND_OPTS, setAsideAddresses: barred });
  assert.ok(!out.comps.some((c) => /easter ave/i.test(c.address)));
  assert.ok(out.comps.some((c) => c.address === "500 Other Way, Englewood, CO"));
  assert.equal(out.corpus_count, 1);
  // Counts are "comps the search found": unchanged by a saved deal that
  // never joined the report.
  assert.deepEqual(out.set_aside_counts, { dead_source: 1, size: 2 });
  assert.equal("set_aside" in out, false);
  // Never a write to the object it was handed (it may be the cached one).
  assert.equal(blended.comps.length, cached.comps.length + 3);
  assert.equal(blended.corpus_count, 3);
});

test("a saved condo unit or caveated sale is not blended; a saved deal of another size is", () => {
  const search = [1, 2, 3].map((i) => ({ address: `${i} Near St, Englewood, CO`, transaction: "Sale", size_sqft: "30000", price_or_rate: "$7,000,000", distance_mi: 1 }));
  const blended = { summary: "s", corpus_count: 4, comps: [...search,
    saved("8 Flex Ct, Unit 4, Englewood, CO"),
    saved("9 Bank Rd, Englewood, CO", { notes: "Bank-owned (REO) sale." }),
    saved("10 Small Rd, Englewood, CO", { size_sqft: "6000", price_or_rate: "$1,500,000" }),
    saved("11 Big Rd, Englewood, CO", { size_sqft: "200000", price_or_rate: "$24,000,000" })] };
  const out = FIT.refitBlended(blended, BLEND_OPTS);
  assert.deepEqual(out.comps.filter((c) => c.from_corpus).map((c) => c.address),
    ["10 Small Rd, Englewood, CO", "11 Big Rd, Englewood, CO"],
    "the size-class cut is NOT applied to saved deals (comp-fit.js says why, with the measurement)");
  assert.equal(out.corpus_count, 2);
  assert.equal(out.set_aside_counts, undefined, "nothing the search found was left out");
  assert.equal(out.summary, "s");
  // The cut is one option away, for the day a lab run supports it.
  const strict = FIT.refitBlended(blended, { ...BLEND_OPTS, sizeRule: true });
  assert.deepEqual(strict.comps.filter((c) => c.from_corpus), []);
  assert.equal("corpus_count" in strict, false);
  // A net-leased subject's saved deals are never size-cut, even then.
  const nl = FIT.refitBlended(blended, { ...BLEND_OPTS, propertyType: "Retail", sizeRule: true, netLease: true });
  assert.equal(nl.comps.filter((c) => c.from_corpus).length, 2);
});

test("saved deals nearby let a far comp of the search's own be set aside, and that one is counted", () => {
  const far = { address: "9 Far Rd, Golden, CO", transaction: "Sale", size_sqft: "30000", price_or_rate: "$7,000,000", distance_mi: 9.2 };
  const near = { address: "1 Near St, Englewood, CO", transaction: "Sale", size_sqft: "30000", price_or_rate: "$7,000,000", distance_mi: 1 };
  // Alone, the search keeps its far comp: one near comp cannot stand in.
  const alone = { comps: [near, far] };
  FIT.applyCompFit(alone, BLEND_OPTS);
  assert.equal(alone.comps.length, 2);
  const blended = { comps: [near, far, saved("2 S St, Englewood, CO"), saved("3 S St, Englewood, CO"),
    saved("4 S St, Englewood, CO"), saved("12 Far Saved Rd, Golden, CO", { distance_mi: 9.6 })], corpus_count: 4 };
  const out = FIT.refitBlended(blended, BLEND_OPTS);
  assert.ok(!out.comps.some((c) => /Far/.test(c.address)));
  assert.deepEqual(out.set_aside_counts, { distance: 1 }, "the search's far comp is counted, the saved one is not");
  assert.equal(out.corpus_count, 3);
  // A typed radius past eight miles keeps both, as it does in the first pass.
  const wide = FIT.refitBlended(blended, { ...BLEND_OPTS, radiusMiles: 12 });
  assert.equal(wide, blended, "nothing changed, so the same object comes back");
});

test("refitBlended leaves a report with no saved deals, or nothing to cut, exactly as it was", () => {
  const plain = { comps: [plainSale(1, { notes: "Foreclosure sale." })] };
  assert.equal(FIT.refitBlended(plain, BLEND_OPTS), plain, "no saved deals: the first pass already decided");
  const fine = { comps: [plainSale(1), saved("5 S St, Boise, ID")], corpus_count: 1 };
  assert.equal(FIT.refitBlended(fine, BLEND_OPTS), fine);
  assert.equal(FIT.refitBlended(null, BLEND_OPTS), null);
  assert.deepEqual(FIT.setAsideAddresses({ comps: [] }), []);
});

test("the wider search starts only when it should finish inside the search's time budget", () => {
  const A = FIT.widerSearchAllowance;
  // The live case: a 10 s first leg, checked and placed by 15.5 s.
  assert.deepEqual(A({ budgetMs: 60000, elapsedMs: 15500, firstLegMs: 10000, afterMs: 6000 }),
    { run: true, deadlineMs: 38500 });
  // A 34 s first leg (the measured cost of deeper reasoning) leaves 14.5 s
  // for a call expected to take 34: it is skipped, not started and cut.
  assert.deepEqual(A({ budgetMs: 60000, elapsedMs: 39500, firstLegMs: 34000, afterMs: 6000 }),
    { run: false, deadlineMs: null, leftMs: 14500, expectedMs: 34000 });
  // The boundary: exactly enough runs, one millisecond short does not.
  assert.equal(A({ budgetMs: 60000, elapsedMs: 24000, firstLegMs: 30000, afterMs: 6000 }).run, true);
  assert.equal(A({ budgetMs: 60000, elapsedMs: 24001, firstLegMs: 30000, afterMs: 6000 }).run, false);
  // A first leg too quick to trust as an estimate still needs a real window.
  assert.equal(A({ budgetMs: 60000, elapsedMs: 50000, firstLegMs: 200, afterMs: 6000 }).run, false);
  assert.equal(A({ budgetMs: 60000, elapsedMs: 49000, firstLegMs: 200, afterMs: 6000 }).run, true);
  // No budget is no ceiling: the behaviour before the budget existed.
  assert.deepEqual(A({ budgetMs: 0, elapsedMs: 999999, firstLegMs: 999999 }), { run: true, deadlineMs: null });
  assert.deepEqual(A(), { run: true, deadlineMs: null });
});

test("server.js fits the blended set before the paywall and governs the wider search by the clock", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "server.js"), "utf8");
  const viewer = src.slice(src.indexOf("async function finishReportForViewer("), src.indexOf("async function runCompSearch("));
  // The set-aside addresses are read before the list is stripped...
  assert.ok(viewer.indexOf("COMPFIT.setAsideAddresses(rep)") > 0);
  assert.ok(viewer.indexOf("COMPFIT.setAsideAddresses(rep)") < viewer.indexOf("rep = COMPFIT.stripSetAside(rep)"));
  // ...the re-fit runs after the blend and before the gate, so a free
  // report's locked_basis is the fitted set...
  const refit = viewer.indexOf("COMPFIT.refitBlended(merged");
  assert.ok(refit > viewer.indexOf("blendNearbyComps(rep"));
  assert.ok(refit < viewer.indexOf("GATE.gateReport(merged"));
  // ...behind the step's own rollback, with the one net-lease definition,
  // and never with the size cut switched on by accident.
  assert.match(viewer, /if \(COMP_FIT && merged && merged\.corpus_count\)/);
  assert.match(viewer, /netLease: VALUATION\.isNetLease\(typeOk, detailsOk\)/);
  assert.doesNotMatch(viewer, /sizeRule/);
  // Both callers hand it the subject's details.
  assert.match(src, /txFocusOk, detailsOk,\s*corpusRadiusRows, vaultRows, firmCompRows,/);
  assert.match(src, /detailsOk: sanitizeSubjectDetails\(job\.property_type/);
  // The internal (eval) exit is still ahead of all of it.
  assert.ok(viewer.indexOf("if (internal)") < viewer.indexOf("COMPFIT.setAsideAddresses(rep)"));

  const refine = src.slice(src.indexOf("async function refineComps(report, ctx) {"), src.indexOf("function progressFor("));
  assert.match(refine, /COMPFIT\.widerSearchAllowance\(\{\s*budgetMs: SEARCH_TIME_BUDGET_MS, afterMs: WIDER_AFTER_MS,/);
  assert.ok(refine.indexOf("if (!allowance.run)") < refine.indexOf('"wider", WIDER_SEARCH_USES'), "decided before the billed call");
  assert.match(refine, /deadlineMs: allowance\.deadlineMs/);
  assert.match(src, /process\.env\.SEARCH_TIME_BUDGET_SECONDS/);
  // The lane's deadline can only shorten the derived one, and only the
  // wider lane passes one: the report's own call is never cut short.
  assert.match(src, /Math\.min\(searchTimeoutMsFor\(deadlineUses, PROVIDER\.deadlineTokens\(body\)\), laneDeadlineMs\)/);
  assert.equal((src.match(/deadlineMs: allowance\.deadlineMs/g) || []).length, 1);
});

test("the page words the price-basis reason", () => {
  const say = new Function(pageFn("setAsideSentence") + "; return setAsideSentence;")();
  assert.equal(say({ price_basis: 1 }),
    "We left out 1 comp the search found: 1 was not an ordinary open-market sale (a portfolio, partial-interest, related-party, foreclosure or auction sale).");
  assert.equal(say({ size: 1, price_basis: 2 }),
    "We left out 3 comps the search found: 1 was a very different size from your property; and 2 were not an ordinary open-market sale (a portfolio, partial-interest, related-party, foreclosure or auction sale).");
});
