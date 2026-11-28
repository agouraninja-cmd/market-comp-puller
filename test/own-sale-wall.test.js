// The walls around the building's own sale (2026-11-27): the small modules
// the rule leans on outside valuation.js.
//
//   link-check.js    does the cited page STATE the sale price? A sale can now
//                    carry up to 90% of a value, so one page that says "terms
//                    were not disclosed" must refuse it, and a page that simply
//                    fails to show the figure must cost it nothing.
//   blend-corpus.js  a saved sale of the subject's own building is not laid
//                    back into its comps once the server has settled the sale,
//                    or the building is valued against itself twice.
//   comp-fit.js      the own-sale row taken out of the comps is still a real
//                    deal and is still harvested for the next building.
//
// Rules: .claude/rules/search-pipeline.md ("The building's own sale: asked
// for, settled and stamped") and corpus.md (the radius blend).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { pageText, priceForms, pageStatesPrice } = require("../link-check.js");
const { blendNearbyComps } = require("../blend-corpus.js");
const COMPFIT = require("../comp-fit.js");

const SERVER_SRC = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

// ---------------------------------------------------------------------------
// link-check.js: pageStatesPrice
// ---------------------------------------------------------------------------

// A page under 200 characters is treated as no page at all, so every fixture
// is padded with filler that names no number and no property.
const FILLER = " The industrial market in the region stayed active through the quarter.".repeat(4);
function page(body) {
  return `<!doctype html><html><head><title>Deal news</title></head><body><article>${body}</article><p>${FILLER}</p></body></html>`;
}
const ADDRESS = "100 Main St, Boise, ID 83702";

test("a price written the ways a deal page writes it is found as stated", () => {
  const cases = [
    ["Sold for $12,450,000 in March.", 12450000],
    ["Sold for 12450000 dollars.", 12450000],
    ["A 12.45 million dollar sale.", 12450000],
    ["The buyer paid $12.45M for it.", 12450000],
    ["The buyer paid $12.45 MM for it.", 12450000],
    ["A $12.45-million sale closed.", 12450000],
    ["The deal was $12.4 mln.", 12450000],
    ["The deal was $12.5 million.", 12450000],   // 12.5 is 0.4% off: a headline rounding
    ["It traded for $2.1 million.", 2100000],
    ["It traded for $975K.", 975000],
    ["Headline: warehouse goes for $69M.", 69400000],
  ];
  for (const [body, price] of cases) {
    assert.equal(pageStatesPrice(page(body), price, ADDRESS), "states", `${JSON.stringify(body)} for ${price}`);
  }
});

// The 1% rounding allowance is what lets "$12.5 million" stand for
// $12,450,000. Past it, a figure is another number and must not vouch for the
// sale: "13 million" is not how anyone writes $12.6M.
test("a rounding further than 1% from the price is not the price", () => {
  assert.equal(pageStatesPrice(page("Sold for 13 million."), 12600000, ADDRESS), "unknown");
  assert.equal(pageStatesPrice(page("Sold for $2 million."), 2100000, ADDRESS), "unknown");
  assert.equal(pageStatesPrice(page("Sold for $21 million."), 2100000, ADDRESS), "unknown");
});

// $20,000,000 written short is "20 million". Stripping its trailing zeros
// into "2" would let a page about a $2,000,000 deal vouch for a $20,000,000
// sale: a tenfold error in the figure that carries the value.
test("a price with trailing zeros is never read as a shorter number", () => {
  assert.deepEqual(priceForms(20000000).slice(0, 2), ["20,000,000", "20000000"]);
  assert.equal(pageStatesPrice(page("Sold for $2,000,000."), 20000000, ADDRESS), "unknown");
  assert.equal(pageStatesPrice(page("Sold for $2 million."), 20000000, ADDRESS), "unknown");
  assert.equal(pageStatesPrice(page("Sold for 2000000."), 20000000, ADDRESS), "unknown");
  assert.equal(pageStatesPrice(page("Sold for $20 million."), 20000000, ADDRESS), "states");
  assert.equal(pageStatesPrice(page("Sold for $20M."), 20000000, ADDRESS), "states");
  assert.equal(pageStatesPrice(page("Sold for $20,000,000."), 20000000, ADDRESS), "states");
});

test("a price inside a longer number, or a unit that is not a unit, is not the price", () => {
  assert.equal(pageStatesPrice(page("Sold for $112,450,000."), 12450000, ADDRESS), "unknown");
  assert.equal(pageStatesPrice(page("Sold for $12,450,0001."), 12450000, ADDRESS), "unknown");
  assert.equal(pageStatesPrice(page("Fiber at 12.45 Mbps."), 12450000, ADDRESS), "unknown");
});

test("tags, entities and odd whitespace do not hide a stated price", () => {
  assert.equal(pageStatesPrice(page("Sold for <strong>&#36;12,450,000</strong>."), 12450000, ADDRESS), "states");
  assert.equal(pageStatesPrice(page("Sold for &dollar;12.45&nbsp;million."), 12450000, ADDRESS), "states");
  assert.equal(pageStatesPrice(page("Sold for $12.45\n\t  million."), 12450000, ADDRESS), "states");
  assert.equal(pageStatesPrice(page("Sold FOR $12.45 MILLION."), 12450000, ADDRESS), "states");
});

// A page that draws its article in the browser holds the words in a script.
// Missing the figure there would refuse a good sale, so the price is looked
// for in the whole document.
test("a price held only in a script still counts as stated", () => {
  const html = page('<div id="app"></div><script>window.__DATA__={"headline":"Warehouse sells for $12,450,000"}</script>');
  assert.equal(pageStatesPrice(html, 12450000, ADDRESS), "states");
});

// "undisclosed" is the one answer that refuses the sale, so it needs the page
// to be about this property AND to say in words that there is no price.
test("a page about the property that says the terms were not disclosed answers undisclosed", () => {
  assert.equal(pageStatesPrice(page("<p>100 Main Street in Boise sold this spring. Terms were not disclosed.</p>"), 12450000, ADDRESS), "undisclosed");
  assert.equal(pageStatesPrice(page("<p>The building at 100 Main St sold for an undisclosed sum.</p>"), 12450000, ADDRESS), "undisclosed");
  assert.equal(pageStatesPrice(page("<p>100 North Main Street traded; the seller declined to disclose the price.</p>"), 12450000, "100 N Main St, Boise, ID"), "undisclosed");
});

test("a stated price wins over undisclosed wording on the same page", () => {
  const html = page("<p>100 Main St sold for $12,450,000. Financing terms were not disclosed.</p>");
  assert.equal(pageStatesPrice(html, 12450000, ADDRESS), "states");
});

// "unknown" costs the sale nothing. A paywalled article and a county page
// that loads its sale history later both name the property and show no
// price, and both may state it.
test("anything short of words saying there is no price answers unknown", () => {
  assert.equal(pageStatesPrice(page("<p>100 Main St sold this spring. Subscribe to keep reading.</p>"), 12450000, ADDRESS), "unknown",
    "names the property, shows no price, says nothing about disclosure");
  assert.equal(pageStatesPrice(page("<p>200 Oak Ave sold. Terms were not disclosed.</p>"), 12450000, ADDRESS), "unknown",
    "another property's undisclosed deal");
  assert.equal(pageStatesPrice(page("<p>1100 Main St sold. Terms were not disclosed.</p>"), 12450000, ADDRESS), "unknown",
    "1100 is not 100");
  assert.equal(pageStatesPrice(page('<p>100 Main St sold.</p><script>var t="terms were not disclosed";</script>'), 12450000, ADDRESS), "unknown",
    "the disclosure words must be in what a reader sees, not a script");
  assert.equal(pageStatesPrice(page("<p>Terms were not disclosed.</p>"), 12450000, "Boise, ID"), "unknown",
    "an address with no street number cannot be matched");
});

test("an empty, missing or tiny body answers unknown", () => {
  assert.equal(pageStatesPrice("", 12450000, ADDRESS), "unknown");
  assert.equal(pageStatesPrice(null, 12450000, ADDRESS), "unknown");
  assert.equal(pageStatesPrice(undefined, 12450000, ADDRESS), "unknown");
  assert.equal(pageStatesPrice("<p>$12,450,000</p>", 12450000, ADDRESS), "unknown", "under 200 characters is not a page");
});

test("a price that is missing or under a thousand dollars has no forms and answers unknown", () => {
  for (const p of [NaN, null, undefined, 0, 999, "abc"]) {
    assert.deepEqual(priceForms(p), [], `priceForms(${String(p)})`);
    assert.equal(pageStatesPrice(page("<p>100 Main St sold. Terms were not disclosed.</p>"), p, ADDRESS), "unknown", String(p));
  }
});

test("a huge body is read to the end and still answers", () => {
  const html = "<html><body><p>" + "filler words here ".repeat(120000) + "</p><p>Closed at $12,450,000.</p></body></html>";
  assert.ok(html.length > 2000000, "the fixture is over 2 MB");
  assert.equal(pageStatesPrice(html, 12450000, ADDRESS), "states");
});

test("pageText drops scripts, styles and tags, decodes the entities and folds whitespace and case", () => {
  assert.equal(pageText("<div>A&nbsp;&amp;\n\tB</div><script>x()</script><style>p{}</style>&#36;5"), " a & b $5");
  assert.equal(pageText(null), "");
});

// ---------------------------------------------------------------------------
// blend-corpus.js: the subject's own saved sale is not blended back in
// ---------------------------------------------------------------------------

const BOISE = { lat: 43.615, lng: -116.2023 };
const NOW = Date.parse("2026-08-14T00:00:00Z");
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseDealDate(s) {
  const m = String(s || "").trim().match(/^([A-Za-z]{3})[a-z]*\s+((?:19|20)\d{2})$/);
  const mo = m && MONTHS[m[1].toLowerCase()];
  return mo ? Number(m[2]) + (mo - 0.5) / 12 : null;
}
function savedRow(over = {}) {
  return {
    address: "500 Nearby Rd, Boise, ID",
    deal_date: "Mar 2026",
    transaction: "Sale",
    price_or_rate: "$2,500,000",
    size_sqft: "29400",
    source_type: "public_record",
    lat: String(BOISE.lat + 0.005),
    lng: String(BOISE.lng),
    ...over,
  };
}
function searchReport(sale, over = {}) {
  return {
    subject_lat: String(BOISE.lat),
    subject_lng: String(BOISE.lng),
    comps: [{ address: "1 Search Ave, Boise, ID", date: "Feb 2026", price_or_rate: "$3,000,000", source_type: "listing" }],
    subject_last_sale: sale,
    ...over,
  };
}
const SETTLED = { date: "Jan 2025", price: "$2,500,000", source_type: "public_record", settled: 1 };
const UNSETTLED = { date: "Jan 2025", price: "$2,500,000", source_type: "public_record" };
const BLEND_OPTS = { months: 12, now: NOW, parseDealDate, propertyType: "Industrial", subjectAddress: "100 Main Street, Boise, ID" };
const blendedAddresses = (out) => out.comps.filter((c) => c.from_corpus).map((c) => c.address);

// The search's own copy of the subject's sale was taken out of the comps by
// the server and is weighed by name. The saved copy, spelled "St" with a ZIP,
// would put the building among its own comps a second time.
test("a saved sale of the subject's own building is not blended in when the report's sale is settled", () => {
  const own = savedRow({ address: "100 Main St, Boise, ID 83702" });
  const out = blendNearbyComps(searchReport(SETTLED), [own, savedRow()], BLEND_OPTS);
  assert.deepEqual(blendedAddresses(out), ["500 Nearby Rd, Boise, ID"]);
  assert.equal(out.corpus_count, 1);
});

// The search may correct a typed city. The saved row is filed under the
// corrected one, so the typed address alone would never match it.
test("the subject's own saved sale is matched through the corrected address too", () => {
  const opts = { ...BLEND_OPTS, subjectAddress: "100 Main St, Garden City, ID" };
  const own = savedRow({ address: "100 Main Street, Boise, ID 83702" });
  const corrected = searchReport(SETTLED, { subject_address_corrected: "100 Main St, Boise, ID" });
  assert.deepEqual(blendedAddresses(blendNearbyComps(corrected, [own], opts)), [],
    "matched by the corrected address");
  assert.deepEqual(blendedAddresses(blendNearbyComps(searchReport(SETTLED), [own], opts)), ["100 Main Street, Boise, ID 83702"],
    "control: without the correction, a Garden City subject is not this Boise building");
});

// Nothing leans on a sale without the stamp: a house, a leases-only search
// and every report cached before 2026-11-27 blend exactly as they always did.
test("the same saved sale IS blended when the report's sale is not settled", () => {
  const own = savedRow({ address: "100 Main St, Boise, ID 83702" });
  for (const [label, sale] of [["unstamped", UNSETTLED], ["no sale", undefined], ["string stamp", { ...SETTLED, settled: "1" }], ["boolean stamp", { ...SETTLED, settled: true }]]) {
    const out = blendNearbyComps(searchReport(sale), [own], BLEND_OPTS);
    assert.deepEqual(blendedAddresses(out), ["100 Main St, Boise, ID 83702"], label);
  }
});

test("a lease at the subject's own address is still blended on a settled report", () => {
  const lease = savedRow({ address: "100 Main St, Boise, ID 83702", transaction: "Lease", price_or_rate: "$9.00/SF/yr NNN" });
  const out = blendNearbyComps(searchReport(SETTLED), [lease], BLEND_OPTS);
  assert.deepEqual(blendedAddresses(out), ["100 Main St, Boise, ID 83702"]);
});

// The app's sale test: anything not written as a lease is a sale.
test("a saved row at the subject's address with a blank transaction is treated as a sale and skipped", () => {
  const blank = savedRow({ address: "100 Main St, Boise, ID 83702", transaction: "" });
  assert.deepEqual(blendedAddresses(blendNearbyComps(searchReport(SETTLED), [blank], BLEND_OPTS)), []);
});

test("a neighbour at a different street number, or another street, is still blended", () => {
  const rows = [
    savedRow({ address: "102 Main St, Boise, ID 83702" }),
    savedRow({ address: "100 Main Ave, Boise, ID 83702" }),
    savedRow({ address: "100 Main St Unit 5, Boise, ID" }),
  ];
  const out = blendNearbyComps(searchReport(SETTLED), rows, BLEND_OPTS);
  assert.deepEqual(blendedAddresses(out), rows.map((r) => r.address));
});

test("the blend never mutates the report it is handed", () => {
  const rep = searchReport(SETTLED);
  const before = JSON.stringify(rep);
  blendNearbyComps(rep, [savedRow({ address: "100 Main St, Boise, ID 83702" }), savedRow()], BLEND_OPTS);
  assert.equal(JSON.stringify(rep), before);
});

// ---------------------------------------------------------------------------
// comp-fit.js: the own-sale row is still harvested
// ---------------------------------------------------------------------------

// The set is not exported, so its literal is read from the source; the
// behaviour it drives is the next test.
test("HARVESTABLE_REASONS holds own_sale beside the size and distance reasons it had", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "comp-fit.js"), "utf8");
  const m = src.match(/const HARVESTABLE_REASONS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, "HARVESTABLE_REASONS literal not found in comp-fit.js");
  const reasons = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(reasons, ["distance", "own_sale", "size"]);
});

test("harvestableSetAside keeps an own_sale row and still drops the reasons that are not real comps", () => {
  const report = {
    set_aside: [
      { address: "100 Main St, Boise, ID", set_aside: "own_sale" },
      { address: "2 Big Rd, Boise, ID", set_aside: "size" },
      { address: "3 Far Rd, Nampa, ID", set_aside: "distance" },
      { address: "4 Dead Link Rd, Boise, ID", set_aside: "dead_source" },
      { address: "5 Condo Ct Unit 2, Boise, ID", set_aside: "unit" },
      { address: "6 Auction Way, Boise, ID", set_aside: "price_basis" },
    ],
  };
  assert.deepEqual(COMPFIT.harvestableSetAside(report).map((c) => c.address),
    ["100 Main St, Boise, ID", "2 Big Rd, Boise, ID", "3 Far Rd, Nampa, ID"]);
});

// The set only matters if harvest reads it, and only for the reason the
// server actually writes. Both live in server.js, so they are pinned by source.
test("server.js harvests the set-aside rows through harvestableSetAside and writes the own_sale reason by that name", () => {
  assert.match(SERVER_SRC, /\.concat\(COMPFIT\.harvestableSetAside\(payload\)\)/,
    "harvestComps must add COMPFIT.harvestableSetAside(payload) to the comps it harvests");
  assert.match(SERVER_SRC, /:\s*"own_sale"\s*\)/, "settleOwnSale must write the reason \"own_sale\"");
});

// ---------------------------------------------------------------------------
// server.js: the settle runs before the comp fit at every exit of getComps
// ---------------------------------------------------------------------------

// refineComps feeds the cache write, the harvest and the snapshot. The sale
// must be settled (and the own-sale row out of the comps) before it, or a
// building is fitted, and cached, with itself among its comps.
test("getComps awaits checkLinksAndSettle on the same report before every refineComps call", () => {
  const start = SERVER_SRC.indexOf("async function getComps(");
  assert.ok(start >= 0, "getComps not found");
  const end = SERVER_SRC.indexOf("\n}\n", start);
  const body = SERVER_SRC.slice(start, end);
  const calls = [...body.matchAll(/await refineComps\((\w+),\s*\{([^}]*)\}/g)];
  assert.ok(calls.length >= 2, `expected both exits to call refineComps, found ${calls.length}`);
  for (const call of calls) {
    const [, target, ctx] = call;
    const before = body.slice(0, call.index);
    const settle = [...before.matchAll(/const (\w+) = await checkLinksAndSettle\((\w+),/g)].pop();
    assert.ok(settle, `no checkLinksAndSettle before refineComps(${target})`);
    assert.equal(settle[2], target, `checkLinksAndSettle settled ${settle[2]} but refineComps refines ${target}`);
    assert.ok(!/refineComps\(/.test(before.slice(settle.index)), "another refineComps call sits between the settle and this one");
    assert.match(ctx, new RegExp("deadUrls:\\s*" + settle[1] + "\\b"), "refineComps must be handed the settle's dead URLs");
  }
  const everywhere = (SERVER_SRC.match(/\brefineComps\(/g) || []).length;
  assert.equal(everywhere, calls.length + 1, "refineComps is called outside getComps; that caller must settle first too");
});
