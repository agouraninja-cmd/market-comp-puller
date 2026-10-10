// home-map.js — what Home's map workspace lists. Every row is a claim about a
// member's record (this deal is yours, this building is the firm's, this date
// needs you), so the rules are tested here rather than eyeballed on a map.

const test = require("node:test");
const assert = require("node:assert");
const HM = require("../home-map.js");

const TODAY = "2026-10-07";
// Deals are a development firm's (2026-10-09): a test that lists one says so.
const DEV = "development";
const B = (o) => Object.assign({ id: "b1", address: "1450 S Eagle Rd, Meridian, ID 83642", type: "Industrial", sizeSqft: 48000, lat: null, lng: null }, o);
const SITE = (o) => Object.assign({ id: "s1", address: "2410 W Amity Rd, Meridian, ID 83642", property_type: "Land", stage: "contract",
  acres: 18.4, asking_price: 3450000, dates: [], portfolio_item_id: null }, o);
const HELD = (o) => Object.assign({ id: "p1", address: "1450 S Eagle Rd, Meridian, ID 83642", property_type: "Industrial",
  snapshots: [{ likely: 5600000 }, { likely: 6120000 }] }, o);

test("an address key is the street and the city, and nothing else", () => {
  assert.equal(HM.addressKey("725 W Franklin Rd, Meridian, ID 83642"), "725 w franklin rd|meridian");
  assert.equal(HM.addressKey("725 W. Franklin Rd., Meridian, Idaho"), "725 w franklin rd|meridian", "punctuation and the state never split a building");
  assert.notEqual(HM.addressKey("727 W Franklin Rd, Meridian, ID"), HM.addressKey("725 W Franklin Rd, Meridian, ID"), "a different number is a different building");
  assert.notEqual(HM.addressKey("725 W Franklin Rd, Boise, ID"), HM.addressKey("725 W Franklin Rd, Meridian, ID"), "or a different city");
  assert.equal(HM.addressKey(""), "");
  assert.equal(HM.addressKey(null), "");
});

test("one row per property: a firm building that is also yours is one row that knows both", () => {
  const rows = HM.properties({ today: TODAY, buildings: [B({})], portfolio: [HELD({})] });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.firm, true);
  assert.equal(r.you, true);
  assert.equal(HM.scopeOf(r), "both");
  assert.equal(r.group, "owned", "your holding decides its group; the firm only adds that it can see it");
  assert.equal(r.value, 6120000, "the newest valuation");
  assert.ok(Math.abs(r.change - (6120000 - 5600000) / 5600000) < 1e-9, "change since the first valuation");
  assert.equal(r.size, 48000, "the firm's size rides along");
});

test("every row says who can see it", () => {
  const rows = HM.properties({ today: TODAY, firmKind: DEV,
    buildings: [B({ id: "b9", address: "615 S Capitol Blvd, Boise, ID 83702" })],
    sites: [SITE({})],
  });
  const by = Object.fromEntries(rows.map((r) => [HM.street(r.address), HM.scopeOf(r)]));
  assert.equal(by["615 S Capitol Blvd"], "firm");
  assert.equal(by["2410 W Amity Rd"], "you");
});

test("a deal's next date is its soonest date still ahead; a passed deal is left out", () => {
  const rows = HM.properties({ today: TODAY, firmKind: DEV, sites: [
    SITE({ dates: [{ on: "2026-09-21", label: "Under contract" }, { on: "2026-12-21", label: "Closing" }, { on: "2026-10-21", label: "Due diligence ends" }] }),
    SITE({ id: "s2", address: "2600 E Gowen Rd, Boise, ID", stage: "passed" }),
  ] });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].next, { on: "2026-10-21", label: "Due diligence ends" });
  assert.equal(rows[0].group, "buying");
  assert.equal(rows[0].valueNote, "asking");
});

test("Owned is the status of a held property, not a second row; a Tracking one is The Board's, not Home's", () => {
  const cole = HELD({ id: "p2", address: "2850 S Cole Rd, Boise, ID 83709" });
  let rows = HM.properties({ today: TODAY, portfolio: [cole],
    sites: [SITE({ id: "s3", address: "2850 S Cole Rd, Boise, ID 83709", stage: "owned", portfolio_item_id: "p2" })] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stage, "owned");
  assert.equal(rows[0].group, "owned");
  assert.equal(rows[0].portfolioId, "p2");
  assert.equal(rows[0].siteId, "s3");
  // Watched, not owned (2026-10-09): on The Board, so not listed here, and
  // not listed again as a plain holding either.
  rows = HM.properties({ today: TODAY, portfolio: [cole],
    sites: [SITE({ id: "s3", address: "2850 S Cole Rd, Boise, ID 83709", stage: "tracking", portfolio_item_id: "p2" })] });
  assert.deepEqual(rows, []);
  // The NEWEST status decides, whichever order the read returns them in.
  const two = [SITE({ id: "a", stage: "tracking", portfolio_item_id: "p2", updated_at: "2026-10-01" }),
    SITE({ id: "b", stage: "owned", portfolio_item_id: "p2", updated_at: "2026-10-08" })];
  assert.deepEqual(HM.properties({ today: TODAY, portfolio: [cole], sites: two }).map((r) => [r.stage, r.siteId]), [["owned", "b"]]);
  assert.deepEqual(HM.properties({ today: TODAY, portfolio: [cole], sites: two.slice().reverse() }).map((r) => [r.stage, r.siteId]), [["owned", "b"]]);
  two[1].updated_at = "2026-09-01";
  assert.deepEqual(HM.properties({ today: TODAY, portfolio: [cole], sites: two }), [], "watched since it was owned");
});

test("a firm building's next date is its soonest lease date", () => {
  const rows = HM.properties({ today: TODAY, buildings: [B({})], critical: [
    { buildingId: "b1", date: "2027-05-05", kind: "expiry", tenant: "Acme Logistics" },
    { buildingId: "b1", date: "2026-10-26", kind: "notice", tenant: "Acme Logistics" },
  ] });
  assert.deepEqual(rows[0].next, { on: "2026-10-26", label: "Option notice · Acme Logistics" });
  assert.equal(rows[0].stage, "firm");
});

test("a building's coordinates are used only when both are real", () => {
  const rows = HM.properties({ today: TODAY, buildings: [
    B({ id: "a", address: "1 A St, Boise, ID", lat: 43.6, lng: -116.2 }),
    B({ id: "b", address: "2 B St, Boise, ID", lat: 0, lng: 0 }),
    B({ id: "c", address: "3 C St, Boise, ID", lat: 43.6, lng: null }),
  ] });
  const by = Object.fromEntries(rows.map((r) => [HM.street(r.address), r]));
  assert.equal(by["1 A St"].lat, 43.6);
  assert.equal(by["2 B St"].lat, null, "Null Island is not a coordinate");
  assert.equal(by["3 C St"].lat, null, "half a coordinate is none");
});

test("rows sort: deals first by deadline, then what you own, then the firm's other buildings", () => {
  const rows = HM.properties({ today: TODAY, firmKind: DEV,
    buildings: [B({ id: "f", address: "615 S Capitol Blvd, Boise, ID" })],
    portfolio: [HELD({})],
    sites: [SITE({ dates: [{ on: "2026-10-21", label: "DD" }] }), SITE({ id: "s9", address: "12500 W Floating Feather Rd, Star, ID", stage: "prospect", dates: [{ on: "2026-10-10", label: "Call" }] })],
  });
  assert.deepEqual(rows.map((r) => HM.street(r.address)), ["12500 W Floating Feather Rd", "2410 W Amity Rd", "1450 S Eagle Rd", "615 S Capitol Blvd"]);
});

test("the agenda: unread first, then lease dates inside 90 days and deal dates inside 30, soonest first, numbered", () => {
  const items = HM.agenda({ today: TODAY, firmKind: DEV,
    threads: [{ id: "t1", label: "Jordan Lee", preview: "Want me to call Dana?", unread: 1 }, { id: "t2", label: "Old", unread: 0 }],
    critical: [
      { buildingId: "b1", address: "1450 S Eagle Rd, Meridian, ID", date: "2026-10-26", kind: "notice", tenant: "Acme", suite: "A" },
      { buildingId: "b2", address: "2850 S Cole Rd, Boise, ID", date: "2027-02-14", kind: "expiry", tenant: "Far off" },
      { buildingId: "b3", address: "1 Past St, Boise, ID", date: "2026-10-01", kind: "expiry", tenant: "Gone" },
    ],
    sites: [
      SITE({ dates: [{ on: "2026-10-10", label: "Call the owner back" }, { on: "2026-11-20", label: "Too far" }] }),
      SITE({ id: "s2", stage: "passed", dates: [{ on: "2026-10-09", label: "Passed deal" }] }),
    ],
  });
  assert.deepEqual(items.map((x) => x.label), ["Jordan Lee", "Call the owner back", "Option notice"]);
  assert.deepEqual(items.map((x) => x.num), [null, 1, 2], "a message has no address, so no pin number");
  assert.deepEqual(items.map((x) => x.scope), ["firm", "you", "firm"]);
  assert.equal(items[2].href, "/building/b1");
  assert.equal(HM.thisWeek(items), 2, "the message and Friday's call");
});

test("new BOV requests come after messages, newest first, with no number and no pin", () => {
  const items = HM.agenda({ today: TODAY, firmKind: DEV,
    threads: [{ id: "t1", label: "Jordan Lee", unread: 1 }],
    leads: [
      { id: "l1", ts: "2026-10-01T15:00:00Z", type: "Industrial", size_sqft: 24000, market: "Boise, ID", is_1031: false, intro_requested: false },
      { id: "l2", ts: "2026-10-06T22:10:00Z", type: "Retail", size_sqft: null, market: "Meridian, ID", is_1031: true, intro_requested: false },
      { id: "l3", ts: "2026-10-05T09:00:00Z", type: "Office", market: "Boise, ID", intro_requested: true },
      { id: "l4", ts: "2026-09-20T09:00:00Z", type: "Office", market: "Boise, ID", intro_requested: false },
      // UTC evening, the member's afternoon: tomorrow by the stamp, today here.
      { id: "l5", ts: "2026-10-08T01:30:00Z", type: "Flex", market: "Nampa, ID", intro_requested: false },
    ],
    sites: [SITE({ dates: [{ on: "2026-10-10", label: "Call the owner back" }] })],
  });
  assert.deepEqual(items.map((x) => x.id || x.label), ["Jordan Lee", "l5", "l2", "l1", "Call the owner back"],
    "an answered request (l3) and one older than BOV_DAYS (l4) are not new");
  const bov = items.filter((x) => x.kind === "bov");
  assert.deepEqual(bov.map((x) => x.num), [null, null, null], "a request carries no address, so no pin");
  assert.deepEqual(bov.map((x) => x.n), [0, -1, -6]);
  assert.equal(bov[1].who, "1031 exchange");
  assert.equal(bov[2].place, "Industrial · 24,000 SF · Boise, ID");
  assert.equal(bov[1].place, "Retail · Meridian, ID", "no size, no size");
  assert.ok(bov.every((x) => x.scope === "you" && x.href === "/vault#pipeline"), "the member's own pipeline");
  assert.equal(items[4].num, 1, "the first dated row is still pin 1");
  assert.equal(HM.inDays(-1), "yesterday");
});

test("deals are a development firm's: listed, dated and passed on only for its member (2026-10-09)", () => {
  const sites = [
    SITE({ dates: [{ on: "2026-10-10", label: "Call the owner back" }] }),
    SITE({ id: "s2", address: "2600 E Gowen Rd, Boise, ID", stage: "passed", updated_at: "2026-10-01" }),
    SITE({ id: "s4", address: "900 N Ten Mile Rd, Meridian, ID", stage: "passed", updated_at: "2026-10-05" }),
    SITE({ id: "s3", address: "2850 S Cole Rd, Boise, ID 83709", stage: "tracking", portfolio_item_id: "p2" }),
  ];
  const portfolio = [HELD({ id: "p2", address: "2850 S Cole Rd, Boise, ID 83709" })];
  assert.ok(HM.dealsOn("development"));
  for (const k of ["broker", "", undefined]) {
    assert.ok(!HM.dealsOn(k));
    const rows = HM.properties({ today: TODAY, firmKind: k, sites, portfolio });
    // No Buying row outside a development firm; and the Tracking status is
    // the PROPERTY's, read for anyone: it puts Cole Rd on The Board.
    assert.deepEqual(rows, []);
    assert.deepEqual(HM.agenda({ today: TODAY, firmKind: k, sites }), [], "and no deal dates in Today");
    assert.deepEqual(HM.passedDeals({ sites, firmKind: k }), []);
  }
  const rows = HM.properties({ today: TODAY, firmKind: DEV, sites, portfolio });
  assert.deepEqual(rows.map((r) => r.group), ["buying"]);
  // A deal's date opens the deal itself, on Home's Properties tab.
  const due = HM.agenda({ today: TODAY, firmKind: DEV, sites });
  assert.deepEqual(due.map((x) => [x.kind, x.href]), [["deal", "/desk#properties"]]);
  // Passed deals, newest first, for the fold; a passed status row is no deal.
  assert.deepEqual(HM.passedDeals({ sites, firmKind: DEV }).map((s) => s.id), ["s4", "s2"]);
  assert.equal(HM.stageLabel("passed"), "Passed");
});

test("adding a property of your own: on Home for a development firm, your own page for one you own, no deal elsewhere", () => {
  assert.equal(HM.addWhere("buy", "development"), "home");
  assert.equal(HM.addWhere("own", "development"), "home");
  assert.equal(HM.addWhere("own", "broker"), "/vault?add=own#properties");
  assert.equal(HM.addWhere("own", undefined), "/vault?add=own#properties", "no firm at all");
  assert.equal(HM.addWhere("buy", "broker"), "", "a deal is not offered outside a development firm");
  assert.equal(HM.addWhere("buy", ""), "");
  // The Board's deal wall and /vault's Sites tab are gone: nothing links to them.
  assert.equal(HM.dealsHref, undefined);
  assert.equal(HM.addHref, undefined);
});

test("the status line says what is due, never what the page is", () => {
  assert.match(HM.statusLine({ items: [{ n: -1 }, { n: 3 }] }), /^2 things this week/);
  assert.match(HM.statusLine({ items: [{ n: 20 }] }), /^Nothing due this week\. 1 date coming up\./);
  assert.equal(HM.statusLine({ items: [], propertyCount: 4 }), "Nothing needs you right now.");
  assert.match(HM.statusLine({ items: [], propertyCount: 0, hasFirm: false }), /lands on this map/);
});

test("Home lists no comps: a comp row left with the Comps tab (2026-10-09)", () => {
  // The owner's call: "Remove Comps from the Homepage". A member's comps are
  // on /vault; Home has no comp row to build, so nothing can draw one.
  assert.equal(HM.compRow, undefined);
});

test("money and dates read the way the rest of the site writes them", () => {
  assert.equal(HM.money(4920000), "$4.92M");
  assert.equal(HM.money(19400000), "$19.4M");
  assert.equal(HM.money(560000), "$560K");
  assert.equal(HM.money(0), "");
  assert.equal(HM.shortDate("2026-10-26"), "Oct 26");
  assert.equal(HM.daysUntil("2026-10-10", TODAY), 3);
  assert.equal(HM.inDays(0), "today");
  assert.equal(HM.inDays(1), "tomorrow");
  assert.equal(HM.inDays(19), "in 19 days");
  assert.equal(HM.stageLabel("loi"), "LOI");
  assert.equal(HM.stageLabel("firm"), "Firm building");
  assert.equal(HM.place("725 W Franklin Rd, Meridian, ID 83642"), "Meridian, ID");
});

// ---- What the map shows (2026-10-08) ----------------------------------------

test("the map's layers: Properties alone by default, and anything unreadable is the default", () => {
  assert.deepEqual(HM.readLayers(null), { properties: true, permits: false });
  assert.deepEqual(HM.readLayers(""), HM.LAYER_DEFAULT);
  assert.deepEqual(HM.readLayers("{not json"), HM.LAYER_DEFAULT, "a corrupt stored value is the default, never a throw");
  assert.deepEqual(HM.readLayers('{"permits":true}'), { properties: true, permits: true });
  assert.deepEqual(HM.readLayers({ properties: false, permits: true }), { properties: false, permits: true });
  assert.deepEqual(HM.readLayers('{"permits":1,"extra":true}'), HM.LAYER_DEFAULT,
    "only real booleans count, and an unknown key is dropped");
  // Comps was a layer until 2026-10-09: a browser that stored it on keeps
  // its other choices and simply loses that one.
  assert.deepEqual(HM.readLayers('{"properties":false,"comps":true,"permits":true}'), { properties: false, permits: true });
  assert.deepEqual(HM.LAYERS, ["properties", "permits"]);
});

test("opening a tab turns on the layer its rows are pins of, and Today and People turn on nothing", () => {
  assert.equal(HM.tabLayer("properties"), "properties");
  assert.equal(HM.tabLayer("comps"), null, "Comps is not a tab of Home any more");
  assert.equal(HM.tabLayer("today"), null, "Today's numbered pins are its own rows, drawn whatever the layers say");
  assert.equal(HM.tabLayer("people"), null);
  assert.equal(HM.tabLayer("reports"), null, "Reports is not a tab of Home any more");
});

const FILING = (o) => Object.assign({ id: "f1", permitNumber: "C-TI-2026-0412", type: "Tenant Improvement",
  description: "Suite B demising wall", projectName: "", address: "1450 S EAGLE RD, Meridian ID 83642", city: "Meridian",
  status: "In Review", stage: "open", appliedDate: "2026-10-04", applicant: "Petra Inc", contractor: "",
  sourceUrl: "https://permits.example/412", onBoard: null, lat: 43.5955, lng: -116.354 }, o);

test("a permit is a pin only where the sweep placed it, and carries only what its card shows", () => {
  const p = HM.permitPin(FILING({}));
  assert.equal(p.street, "1450 S Eagle Rd", "the portal's capitals, in the tracker's case");
  assert.equal(p.city, "Meridian");
  assert.equal(p.type, "Tenant Improvement");
  assert.equal(p.what, "Suite B demising wall");
  assert.equal(p.filed, "2026-10-04");
  assert.equal(p.href, "https://permits.example/412");
  assert.equal(HM.permitPin(FILING({ lat: null })), null, "no place, no pin");
  assert.equal(HM.permitPin(FILING({ lat: 0, lng: 0 })), null, "Null Island is not a place");
  assert.equal(HM.permitPin(FILING({ lat: "", lng: "" })), null);
  assert.equal(HM.permitPin(null), null);
  assert.equal(HM.permitPin(FILING({ projectName: "Ridge Commerce Park" })).what, "Ridge Commerce Park", "a project's name beats its description");
  assert.equal(HM.permitPin(FILING({ sourceUrl: "javascript:alert(1)" })).href, "", "only an http(s) record becomes a link");
  assert.equal(HM.permitPin(FILING({ stage: "bogus" })).stage, "open", "an unknown stage under-claims");
  assert.deepEqual(HM.permitPin(FILING({ onBoard: { id: 7, address: "1450 S Eagle Rd, Meridian, ID 83642" } })).board,
    { id: 7, address: "1450 S Eagle Rd, Meridian, ID 83642" });
});

test("a permit's stage reads in the tracker's own words", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "permits-page.js"), "utf8");
  const m = src.match(/var STAGE_NAMES=(\{[^}]*\})/);
  assert.ok(m, "permits-page.js no longer declares STAGE_NAMES where this test looks");
  assert.deepEqual(JSON.parse(m[1].replace(/([a-z]+):/g, '"$1":')), HM.PERMIT_STAGES,
    "Home's permit cards and the tracker name a stage two different ways");
  assert.equal(HM.permitStageLabel("issued"), "Issued or finaled");
  assert.equal(HM.permitStageLabel(undefined), "Open");
});

test("a permit is at one of your properties only on the same street line in the same city", () => {
  const rows = HM.properties({ today: TODAY, firmKind: DEV, buildings: [B({})], sites: [SITE({})] });
  const pin = HM.permitPin(FILING({}));
  assert.equal(HM.permitAt(pin, rows).key, "1450 s eagle rd|meridian", "the portal's capitals and its missing comma do not split one building");
  assert.equal(HM.permitAt(HM.permitPin(FILING({ address: "1450 S EAGLE RD, Boise ID 83709", city: "Boise" })), rows), null,
    "the same street in another city is another building");
  assert.equal(HM.permitAt(HM.permitPin(FILING({ address: "1450 S EAGLE ROAD, Meridian ID" })), rows), null,
    "no abbreviation expansion: a miss, never a guess");
  assert.equal(HM.permitAt(HM.permitPin(FILING({ address: "1452 S EAGLE RD, Meridian ID" })), rows), null);
  assert.equal(HM.permitAt(null, rows), null);
});

test("a layer that is on and has nothing to draw here says why, and never reads as 'nothing was filed'", () => {
  const on = { properties: true, permits: true };
  const cities = "Boise, Meridian and Nampa";
  assert.deepEqual(HM.layerNotes({ layers: on, permits: null }), [], "nothing is said while a read is still out");
  assert.deepEqual(HM.layerNotes({ layers: { properties: true }, permits: false }), [],
    "a layer that is off says nothing");
  const [failed] = HM.layerNotes({ layers: on, permits: false, cities });
  assert.equal(failed.layer, "permits");
  assert.match(failed.text, /Couldn't read permits/);
  // Our cities, nothing filed: said as such, naming the cities.
  assert.equal(HM.layerNotes({ layers: on, permits: [], permitsFiled: 0, cities })[0].text,
    "No commercial permits were filed in Boise, Meridian and Nampa in the last 30 days.");
  // Filed, but none placed: never "none were filed".
  assert.match(HM.layerNotes({ layers: on, permits: [], permitsFiled: 12, cities })[0].text,
    /^None of the 12 permits filed in Boise, Meridian and Nampa .* has a map location yet\.$/);
  // Pins exist, none in view (a member in Dallas): names where we read, and can show them.
  const away = HM.layerNotes({ layers: on, permits: [{}], permitsInView: 0, cities });
  assert.equal(away[0].show, true);
  assert.match(away[0].text, /in this part of the map .* CompNinja reads permits in Boise, Meridian and Nampa\./);
  assert.deepEqual(HM.layerNotes({ layers: on, permits: [{}], permitsInView: 3, cities }), []);
  // Comps left Home on 2026-10-09: an old caller's Comps layer says nothing.
  assert.deepEqual(HM.layerNotes({ layers: { comps: true }, comps: false }), []);
});

test("a portal's capitals read the way the permit tracker shows them", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  // The tracker's own tidy(), lifted out of permits-page.js and run beside
  // Home's copy on the same inputs (⚠ pair).
  const src = fs.readFileSync(path.join(__dirname, "..", "permits-page.js"), "utf8");
  const m = src.match(/  function tidy\(s\)\{[\s\S]*?\n  \}/);
  assert.ok(m, "permits-page.js no longer declares tidy() where this test looks");
  const ctx = vm.createContext({});
  new vm.Script(m[0] + "\nthis.tidy = tidy;").runInContext(ctx);
  for (const s of ["1450 S EAGLE RD", "8000 S FEDERAL WAY", "120 12TH AVE S", "PO BOX 44", "3900 W CHINDEN BLVD STE 2B",
    "1450 S Eagle Rd", "", "O'BRIEN & SONS"]) {
    assert.equal(HM.tidyCaps(s), ctx.tidy(s), `Home and the tracker disagree on ${JSON.stringify(s)}`);
  }
  assert.equal(HM.tidyCaps("1450 S EAGLE RD"), "1450 S Eagle Rd");
  assert.equal(HM.permitPin(FILING({})).street, "1450 S Eagle Rd", "a permit's card shows the tidied street");
});
