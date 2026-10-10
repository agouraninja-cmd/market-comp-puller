// board.js — The Board on the Markets page (2026-10-09): a watchlist of the
// markets a member follows and the properties they watch, read the way a
// brokerage app lists tickers. The numbers it shows are tested here; the
// drawing was checked by eye on a seeded page, and the rules a future edit
// could quietly break are pinned against the source at the end.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const BOARD = require("../board.js");
const BR = require("../buying-read.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "board.js"), "utf8");
const NOW = Date.parse("2026-10-09T12:00:00Z");

test("a market's trend line is the median of each recent quarter, oldest first, and a thin quarter is left out", () => {
  // nowFrac for October 2026 on parseDealDate's scale (month + 0.5) / 12.
  const now = 2026 + 9.5 / 12;
  const at = (y, m, psf) => ({ yearFrac: y + (m - 0.5) / 12, psf });
  const dated = [
    at(2026, 10, 170), at(2026, 9, 168), at(2026, 8, 160),          // Q4 2026 has two (Oct), Q3 has two
    at(2026, 4, 150), at(2026, 5, 152), at(2026, 6, 154),           // Q2 2026: three
    at(2026, 1, 140),                                                // Q1 2026: one, left out
    at(2024, 8, 120), at(2024, 9, 121),                              // Q3 2024: two years back, outside
    at(2027, 1, 999), at(2027, 2, 999),                              // the future: outside
    { yearFrac: null, psf: 100 }, { yearFrac: 2026.5, psf: 0 },      // undated, unpriced
  ];
  dated.push(at(2026, 11, 172));
  const q = BOARD.quarterSeries(dated, now);
  assert.deepEqual(q.map((x) => x.label), ["Q2 2026", "Q3 2026", "Q4 2026"]);
  assert.deepEqual(q.map((x) => x.psf), [152, 168, 172], "the upper-middle median, the feed's own formula");
  assert.deepEqual(q.map((x) => x.n), [3, 2, 2]);
  assert.deepEqual(BOARD.quarterSeries([], now), []);
  assert.deepEqual(BOARD.quarterSeries(dated, NaN), []);
  assert.equal(BOARD.QUARTERS, 8);
  assert.equal(BOARD.QUARTER_MIN, 2);
});

test("a market row: its median $/SF, the six-month move, the trend, the read and its page", () => {
  const item = { id: "w1", market: "Boise, ID", property_type: "Industrial", median_psf: 165, new_count: 3,
    median_trend: { current: 165, prior: 173 }, direction: "flat", market_page: { slug: "boise-id-industrial" },
    spark: [{ label: "Q1 2026", psf: 171 }, { label: "Q2 2026", psf: 168 }, { label: "Q3 2026", psf: 165 }] };
  const r = BOARD.marketRow(item, BR.buyingRead);
  assert.equal(r.kind, "market");
  assert.equal(r.name, "Boise, ID");
  assert.equal(r.sub, "Industrial");
  assert.equal(r.priceText, "$165/SF");
  assert.deepEqual(r.move, { dir: "down", text: "▼ 4.6%" });
  assert.deepEqual(r.spark, [171, 168, 165]);
  assert.equal(r.read.lean, "good", "prices down and a flat market page read favorable for a buyer");
  assert.equal(r.href, "/market/boise-id-industrial");
  assert.equal(r.newCount, 3);
  // No trend, no read, no page: the row says less, never something made up.
  const bare = BOARD.marketRow({ id: "w2", market: "Star, ID", property_type: "Land", median_psf: null }, BR.buyingRead);
  assert.equal(bare.move, null);
  assert.equal(bare.read, null);
  assert.equal(bare.href, "");
  assert.equal(bare.priceText, "");
  assert.equal(BOARD.marketRow(item, null).read, null, "without the read's script there is no read");
  assert.equal(BOARD.marketRow({ ...item, market_page: { slug: "../x" } }).href, "", "a slug is a slug or nothing");
});

test("a watched property row: its value at the last check, the move against the check before, every check as its line", () => {
  const item = { id: "p1", address: "1550 S Federal Way, Boise, ID 83716", property_type: "Industrial",
    snapshots: [{ ts: "2026-03-01T00:00:00Z", likely: 6000000 }, { ts: "2026-06-01T00:00:00Z", likely: 6200000 },
      { ts: "2026-09-01T00:00:00Z", likely: 6400000, low: 6000000, high: 6800000 }],
    movement: { line: "Boise, ID industrial median $/SF is down 4.6% since you last checked" } };
  const r = BOARD.propertyRow(item, { id: "s9", stage: "tracking" }, NOW);
  assert.equal(r.kind, "property");
  assert.equal(r.name, "1550 S Federal Way");
  assert.equal(r.sub, "Boise, ID · Industrial");
  assert.equal(r.market, "Boise, ID");
  assert.equal(r.priceText, "$6.4M");
  assert.deepEqual(r.move, { dir: "up", text: "▲ 3.2%" }, "against the check before, not the first");
  assert.deepEqual(r.spark, [6000000, 6200000, 6400000]);
  assert.equal(r.statusId, "s9");
  assert.equal(r.stale, false);
  assert.match(r.movement, /down 4.6%/);
  const never = BOARD.propertyRow({ id: "p2", address: "12 Main St, Star, ID 83669", property_type: "Land", snapshots: [] }, null, NOW);
  assert.equal(never.priceText, "");
  assert.equal(never.move, null);
  const old = BOARD.propertyRow({ id: "p3", address: "1 A St, Boise, ID", snapshots: [{ ts: "2025-08-01T00:00:00Z", likely: 1e6 }] }, null, NOW);
  assert.equal(old.stale, true);
});

test("watched means the newest status says Tracking; Owned, and no status at all, are Home's", () => {
  const portfolio = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const sites = [
    { id: "1", portfolio_item_id: "a", stage: "tracking", updated_at: "2026-10-01" },
    { id: "2", portfolio_item_id: "b", stage: "owned", updated_at: "2026-10-01" },
    { id: "3", portfolio_item_id: "c", stage: "tracking", updated_at: "2026-09-01" },
    { id: "4", portfolio_item_id: "c", stage: "owned", updated_at: "2026-10-05" },
    { id: "5", portfolio_item_id: null, stage: "prospect" },
  ];
  assert.deepEqual(BOARD.watched(portfolio, sites).map((w) => [w.item.id, w.status.id]), [["a", "1"]]);
  assert.deepEqual(BOARD.watched(portfolio, null), []);
  assert.deepEqual(BOARD.watched(null, sites), []);
});

test("the line over the list counts each kind and the favorable markets", () => {
  const rows = [
    { kind: "market", read: { lean: "good" } }, { kind: "market", read: { lean: "bad" } }, { kind: "market", read: null },
    { kind: "property" },
  ];
  assert.equal(BOARD.summary(rows), "3 markets · 1 property · 1 favorable for buying");
  assert.equal(BOARD.summary([{ kind: "market", read: null }]), "1 market", "no read anywhere, no claim about buying");
  assert.equal(BOARD.summary([]), "");
});

test("the add box tells a market from an address, and refuses rather than guesses", () => {
  assert.deepEqual(BOARD.parseAdd("boise, id"), { ok: true, kind: "market", market: "Boise, ID" });
  assert.deepEqual(BOARD.parseAdd("  Salt Lake City,UT "), { ok: true, kind: "market", market: "Salt Lake City, UT" });
  assert.deepEqual(BOARD.parseAdd("1550 S Federal Way, Boise, ID 83716"), { ok: true, kind: "property", address: "1550 S Federal Way, Boise, ID 83716" });
  assert.equal(BOARD.parseAdd("").ok, false);
  assert.match(BOARD.parseAdd("1550 S Federal Way").error, /full address/, "a street with no city is not a property we can value");
  assert.match(BOARD.parseAdd("Boise").error, /two-letter state/);
  assert.match(BOARD.parseAdd("Boise, Idaho").error, /two-letter state/);
});

test("prices and moves read the way the rest of the site writes them", () => {
  assert.equal(BOARD.psfLabel(165), "$165/SF");
  assert.equal(BOARD.psfLabel(9.5), "$9.50/SF");
  assert.equal(BOARD.short(22050000), "$22.05M");
  assert.deepEqual(BOARD.move(0.04), { dir: "flat", text: "0.0%" });
  assert.equal(BOARD.move(null), null);
  assert.equal(BOARD.marketOf("1550 S Federal Way, Boise, ID 83716"), "Boise, ID");
  assert.equal(BOARD.marketOf("1550 S Federal Way"), "");
  // A comp's figure: a bare number is dollars, a written-out rate is left alone.
  assert.equal(BOARD.figure("5379000"), "$5,379,000");
  assert.equal(BOARD.figure("$9.50/SF/yr"), "$9.50/SF/yr");
  assert.equal(BOARD.figure(null), "");
});

// ---- rules held against the source ------------------------------------------------

test("built with createElement and textContent, never markup from a string", () => {
  assert.doesNotMatch(SRC, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
});

test("every request is one of our own routes, and a private address rides only in a body", () => {
  const urls = [...SRC.matchAll(/(?:getJson|send)\((?:"(?:GET|POST|DELETE)", )?("[^"]*"|[^,)]*)/g)].map((m) => m[1])
    .filter((u) => u !== "url" && u !== "method");   // the two helpers' own definitions
  assert.ok(urls.length >= 9, "the reads and writes moved: " + urls.length);
  for (const u of urls) assert.match(u, /^"\/api\/(watchlist(\/feed|\/seen)?|portfolio|sites(\/update)?)(\?id=)?"$/, u);
  // An id in a URL is always encoded; nothing else ever is put in one.
  assert.doesNotMatch(SRC, /\?id=" \+ (?!encodeURIComponent\()/);
  assert.equal((SRC.match(/\bfetch\(/g) || []).length, 2, "every request goes through getJson() or send()");
  assert.doesNotMatch(SRC, /nominatim|\/api\/geocode|google/i);
});

test("watching a property that fails half way changes nothing, and one the member owns is left on Home", () => {
  const add = SRC.slice(SRC.indexOf("function submitAdd("), SRC.indexOf("function removeMarket("));
  assert.match(add, /if \(r\.j\.existed && \(!had \|\| had\.stage === "owned"\)\)/, "an owned property must not be turned into a watched one");
  assert.match(add, /const undo = r\.j\.existed \? Promise\.resolve\(null\) : send\("DELETE", "\/api\/portfolio\?id=" \+ encodeURIComponent\(pid\)\);/,
    "a refused status must take a new item back out, or it lands on Home as owned");
});

test("reading the feed marks it seen, so news read on The Board is not mailed again", () => {
  const load = SRC.slice(SRC.indexOf("function load()"), SRC.indexOf("// ---- drawing ----"));
  assert.match(load, /if \(f\.s === 200 && f\.j\.unseen\) send\("POST", "\/api\/watchlist\/seen"\)/);
  assert.match(SRC, /Not investment advice\./);
  assert.ok((SRC.match(/Nothing has been lost/g) || []).length >= 4);
});
