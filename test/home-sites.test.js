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
  // Since 2026-10-21 a deal's pane also reads the permits near it, by the
  // deal's id alone, and its one-click alert POSTs the address to our own
  // permit-alert route, which places it through our own geocoder.
  for (const u of urls) assert.match(u, /^"\/api\/(sites|sites\/update|portfolio|permits\/alerts)"$|^"\/api\/(sites|portfolio|sites\/permits)\?id="$/, u);
  for (const m of SRC.matchAll(/send\("GET", "\/api\/sites\/permits\?id=" \+ ([^)]*\))/g)) assert.equal(m[1], "encodeURIComponent(s.id)", "the deal's id, never its address");
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

test("a building watched rather than owned is The Board's: Home neither adds one nor keeps one (2026-10-09)", () => {
  assert.doesNotMatch(SRC, /I'm tracking it|"track"/, "the add form offers tracking again");
  const pane = SRC.slice(SRC.indexOf("function heldPane("), SRC.indexOf("function removeHeld("));
  assert.match(pane, /btn\("Watch it on The Board instead", "", \(e\) => \{ e\.currentTarget\.disabled = true; setHeld\(key, it, status, "tracking"\); \}\)/);
  // It leaves Home, so its pane closes and the member is told where it went.
  assert.match(pane, /\? after\(null, street\(it\.address\) \+ " is on The Board now, on the Markets page\."\)/);
});

test("Run a land report opens the comp report tool filled in from the deal, and carries no price (2026-10-21)", () => {
  // It linked to "/?type=&address=", which since Home lost its report form
  // (2026-10-08) opened Home and ran nothing.
  const href = HS.reportHref(deal({ address: "5600 W Overland Rd, Boise, ID 83709", acres: 9.2, zoning: "R-3", asking_price: 5800000, earnest_money: 50000 }));
  assert.equal(href, "/bulk?address=5600%20W%20Overland%20Rd%2C%20Boise%2C%20ID%2083709&type=Land&acres=9.2&zoning=R-3");
  assert.doesNotMatch(href, /5800000|50000|asking|earnest/, "a deal's figures stay out of an address");
  // A deal missing a fact simply leaves it out.
  assert.equal(HS.reportHref(deal({ address: "1 Main St, Boise, ID", acres: null, zoning: "", property_type: "Multifamily" })),
    "/bulk?address=1%20Main%20St%2C%20Boise%2C%20ID&type=Multifamily");
  const pane = SRC.slice(SRC.indexOf("function dealPane("), SRC.indexOf("function editForm("));
  assert.match(pane, /h\("a", \{ class: "hm-btn", href: reportHref\(s, \{ site: !ro \}\) \}, "Run a " \+ type\.toLowerCase\(\) \+ " report"\)/);
  assert.doesNotMatch(SRC, /href: "\/\?type="/, "the dead link came back");
});

test("the owner's report link names the deal, so the estimate comes back onto it; a colleague's never does (2026-10-21)", () => {
  const id = "0b7c2d1e-4f5a-4b6c-8d9e-0f1a2b3c4d5e";
  const s = deal({ id, address: "5600 W Overland Rd, Boise, ID 83709", acres: 9.2 });
  assert.match(HS.reportHref(s, { site: true }), new RegExp("&site=" + id + "$"));
  assert.doesNotMatch(HS.reportHref(s), /site=/, "no opt-in, no deal id");
  assert.doesNotMatch(HS.reportHref(deal({ id: "../x", address: "1 Main St" }), { site: true }), /site=/, "only a real id rides along");
});

test("a deal's pane reads its nearby permits once, when drawn, and its alert is an ordinary area alert (2026-10-21)", () => {
  const pane = SRC.slice(SRC.indexOf("function dealPane("), SRC.indexOf("function editForm("));
  assert.ok(pane.indexOf("nearBlock(key, s),") > pane.indexOf('blk("Notes"'), "under the key terms, dates and notes");
  assert.ok(pane.indexOf("nearBlock(key, s),") < pane.indexOf('h("div", { class: "hs-foot" }'), "above the pane's buttons");
  assert.match(pane, /send\("GET", "\/api\/sites\/permits\?id=" \+ encodeURIComponent\(s\.id\)\)/);
  assert.match(pane, /if \(!s \|\| !s\.id \|\| !\("lat" in s \|\| "geo_source" in s\) \|\| !S\.isBuying\(s\.stage\)\) return null;/,
    "before 061 a deal has no place, and no block; nor does a passed deal, which the tracker does not measure from");
  // Found in review: the answer landing redrew the whole pane (wiping an Edit
  // or a date half typed), and its cache ignored the address, so an edited
  // deal showed its old address's permits.
  const near = SRC.slice(SRC.indexOf("const nearby = {};"), SRC.indexOf("function nearBlock("));
  assert.match(near, /const nearKey = \(s\) => \[s\.id, s\.address, s\.lat, s\.lng, s\.geo_source\]/);
  assert.match(near, /nearby\[k\] = r;\s*placeNear\(s\.id\);/, "only the block is swapped when the answer lands");
  assert.doesNotMatch(near, /refill\(/);
  assert.match(near, /if \(!cur \|\| cur\.id !== id \|\| !old\) return;/, "a form showing (no block) is left alone");
  assert.match(pane, /send\("POST", "\/api\/permits\/alerts", \{ areaAddress: s\.address, areaMiles: S\.NEAR_MILES \|\| 1,/);
  assert.match(pane, /href: "\/permits\?near=1#filings" \}, "See them on Permits →"/);
  assert.match(pane, /CompNinja reads permits in /, "an empty answer names the cities it looked in");
  assert.doesNotMatch(SRC.slice(SRC.indexOf("function mount("), SRC.indexOf("function dealPane(")), /api\/sites\/permits/,
    "nothing reads permits before a pane is drawn");
});
