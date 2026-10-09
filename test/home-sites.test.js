// home-sites.js — a development firm's deals and holdings, worked in place on
// Home's Properties tab (2026-10-09; it was /vault's Sites tab). The numbers
// it shows are tested here; the drawing is checked by eye on a seeded page,
// and the rules a future edit could quietly break are pinned against the
// source at the end.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const HS = require("../home-sites.js");
const SITES = require("../sites.js");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "home-sites.js"), "utf8");
const TODAY = "2026-10-09";
const deal = (o) => Object.assign({ id: "s1", address: "2410 W Amity Rd, Meridian, ID 83642", property_type: "Land", stage: "contract",
  acres: 18.4, asking_price: 3450000, dates: [], stage_dates: {}, portfolio_item_id: null }, o);

test("money, short figures, acres and the price per acre", () => {
  assert.equal(HS.money(3450000), "$3,450,000");
  assert.equal(HS.money(null), "");
  assert.equal(HS.short(22050000), "$22.05M");
  assert.equal(HS.short(4000000), "$4M");
  assert.equal(HS.short(187500), "$188K");
  assert.equal(HS.acres(133.33), "133.3");
  assert.equal(HS.acres(""), "");
  assert.equal(HS.perAcre(deal({})), 187500);
  assert.equal(HS.perAcre(deal({ acres: null })), null, "no acreage, no per-acre figure");
  assert.equal(HS.perAcre(deal({ asking_price: null })), null);
});

test("dates read the way the rest of the site writes them, and a week out is hot", () => {
  assert.equal(HS.dayLabel("2026-10-23", TODAY), "Oct 23");
  assert.equal(HS.dayLabel("2027-01-04", TODAY), "Jan 4, 2027", "another year says so");
  assert.equal(HS.dayLabel("", TODAY), "");
  assert.deepEqual(HS.countdown("2026-10-09", TODAY), { text: "Today", hot: true });
  assert.deepEqual(HS.countdown("2026-10-10", TODAY), { text: "Tomorrow", hot: true });
  assert.deepEqual(HS.countdown("2026-10-16", TODAY), { text: "7 days", hot: true });
  assert.deepEqual(HS.countdown("2026-10-17", TODAY), { text: "8 days", hot: false });
  assert.equal(HS.countdown("2026-10-01", TODAY), null, "a date gone by has no countdown");
});

test("the Buying figures add up the deals in progress, and the line beside the heading says them", () => {
  const list = [
    deal({ dates: [{ on: "2026-10-23", label: "Due diligence ends" }] }),
    deal({ id: "s2", acres: 9.6, asking_price: 2880000, dates: [{ on: "2026-10-15", label: "LOI response due" }] }),
    deal({ id: "s3", acres: null, asking_price: null }),
  ];
  const f = HS.figures(list, TODAY);
  assert.equal(f.count, 3);
  assert.equal(f.acres, 28);
  assert.equal(f.asking, 6330000);
  assert.deepEqual(f.next, { on: "2026-10-15", label: "LOI response due" });
  assert.equal(HS.figuresLine(list, TODAY), "28 acres · $6.33M asking");
  assert.equal(HS.figuresLine([deal({ acres: null, asking_price: null })], TODAY), "", "nothing to add up, nothing said");
});

test("the tracker: steps behind are done, the stage is now, and each says the day it was reached", () => {
  const st = HS.steps("contract", { prospect: "2026-08-08", loi: "2026-09-01", contract: "2026-09-23" }, TODAY);
  assert.deepEqual(st.map((x) => x.state), ["done", "done", "now", "", ""]);
  assert.deepEqual(st.map((x) => x.label), ["Prospect", "LOI", "Under contract", "Entitlements", "Owned"]);
  assert.deepEqual(st.map((x) => x.when), ["Aug 8", "Sep 1", "Sep 23", "", ""]);
  // The steps are sites.js's: a renamed or added stage has to be met here too.
  assert.deepEqual(st.map((x) => x.key), SITES.STEPS);
  assert.ok(HS.steps("", {}, TODAY).every((x) => x.state === ""), "a passed deal sits on no step");
});

test("a held property: its newest value, the change since the check before, and a year-old check flagged", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const item = { id: "p1", address: "1450 S Eagle Rd, Meridian, ID", snapshots: [
    { ts: "2025-09-04T00:00:00Z", likely: 5600000 }, { ts: "2026-07-11T00:00:00Z", likely: 5950000, low: 5500000, high: 6400000 },
    { ts: "2026-07-12T00:00:00Z", likely: 6120000, low: 5700000, high: 6550000 }], movement: { line: "Up 3.9% since you last checked" } };
  const h = HS.held(item, null, now);
  assert.equal(h.stage, "owned", "Owned unless a status row says Tracking");
  assert.equal(h.likely, 6120000);
  assert.ok(Math.abs(h.chg - (6120000 - 5950000) / 5950000 * 100) < 1e-9, "against the check before, not the first");
  assert.equal(h.stale, false);
  assert.equal(h.movement, "Up 3.9% since you last checked");
  assert.equal(HS.held(item, { stage: "tracking" }, now).stage, "tracking");
  const old = HS.held({ snapshots: [{ ts: "2025-08-05T00:00:00Z", likely: 3300000 }] }, null, now);
  assert.equal(old.stale, true);
  assert.equal(old.chg, null, "one check has no change");
  assert.equal(HS.held({ snapshots: [] }, null, now).likely, null, "never valued");
});

test("a held property's status is the newest row naming it; the firm door hides once it is on the list", () => {
  const sites = [{ id: "a", portfolio_item_id: "p1", stage: "owned", updated_at: "2026-09-01" },
    { id: "b", portfolio_item_id: "p1", stage: "tracking", updated_at: "2026-10-01" }, { id: "c", portfolio_item_id: null, stage: "loi" }];
  assert.equal(HS.statusFor(sites, "p1").id, "b");
  assert.equal(HS.statusFor(sites, "p9"), null);
  const item = { address: "3205 N Ten Mile Rd, Meridian, ID 83646", verified_key: "" };
  assert.ok(HS.onFirmList(item, [{ address: " 3205 n ten mile rd, meridian, id 83646 " }]));
  assert.ok(HS.onFirmList({ address: "x", verified_key: "vk1" }, [{ address: "y", verifiedKey: "vk1" }]));
  assert.ok(!HS.onFirmList(item, [{ address: "615 S Capitol Blvd, Boise, ID" }]));
  assert.ok(!HS.onFirmList(item, null));
});

// ---- rules held against the source ------------------------------------------------

test("built with createElement and textContent, never markup from a string (Home's standing rule)", () => {
  assert.doesNotMatch(SRC, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
});

test("a private address goes only to our own routes, in a body, never into a URL", () => {
  // Every fetch is to one of our own /api routes; an address only ever rides
  // in a JSON body (CLAUDE.md rule 7). The report links carry it into OUR
  // page's address, which is how a comp report has always been started.
  const urls = [...SRC.matchAll(/send\("(?:GET|POST|DELETE)", ("[^"]*"|[^,)]*)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 8, "the writes moved: " + urls.length);
  for (const u of urls) assert.match(u, /^"\/api\/(sites|sites\/update|portfolio)|^"\/api\/(sites|portfolio)\?id=" \+ encodeURIComponent\(/, u);
  assert.equal((SRC.match(/\bfetch\(/g) || []).length, 1, "every request goes through send()");
  assert.doesNotMatch(SRC, /nominatim|\/api\/geocode/i, "this file places nothing on a map: Home does, through its own geocoder");
});

test("closing a deal adds the property first, then makes the deal its Owned status", () => {
  const move = SRC.slice(SRC.indexOf("function move("), SRC.indexOf("function removeDeal("));
  const pf = move.indexOf('send("POST", "/api/portfolio"'), up = move.indexOf('send("POST", "/api/sites/update", { id: s.id, stage: "owned", portfolio_item_id: pid })');
  assert.ok(pf > 0 && up > pf, "Owned without the property first would be refused by validatePatch");
});

test("a refused edit keeps what was typed, and a failure says nothing was lost", () => {
  const edit = SRC.slice(SRC.indexOf("function editForm("), SRC.indexOf("function move("));
  assert.match(edit, /if \(r\.s !== 200\) \{ b\.disabled = false; said\.textContent = /, "a refusal must not rebuild the form");
  assert.ok((SRC.match(/Nothing has been lost/g) || []).length >= 6);
});
