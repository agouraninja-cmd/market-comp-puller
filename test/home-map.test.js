// home-map.js — what Home's map workspace lists. Every row is a claim about a
// member's record (this deal is yours, this building is the firm's, this date
// needs you), so the rules are tested here rather than eyeballed on a map.

const test = require("node:test");
const assert = require("node:assert");
const HM = require("../home-map.js");

const TODAY = "2026-10-07";
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
  const rows = HM.properties({ today: TODAY,
    buildings: [B({ id: "b9", address: "615 S Capitol Blvd, Boise, ID 83702" })],
    sites: [SITE({})],
  });
  const by = Object.fromEntries(rows.map((r) => [HM.street(r.address), HM.scopeOf(r)]));
  assert.equal(by["615 S Capitol Blvd"], "firm");
  assert.equal(by["2410 W Amity Rd"], "you");
});

test("a deal's next date is its soonest date still ahead; a passed deal is left out", () => {
  const rows = HM.properties({ today: TODAY, sites: [
    SITE({ dates: [{ on: "2026-09-21", label: "Under contract" }, { on: "2026-12-21", label: "Closing" }, { on: "2026-10-21", label: "Due diligence ends" }] }),
    SITE({ id: "s2", address: "2600 E Gowen Rd, Boise, ID", stage: "passed" }),
  ] });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].next, { on: "2026-10-21", label: "Due diligence ends" });
  assert.equal(rows[0].group, "buying");
  assert.equal(rows[0].valueNote, "asking");
});

test("Owned and Tracking are the status of a held property, not a second row", () => {
  const rows = HM.properties({ today: TODAY,
    portfolio: [HELD({ id: "p2", address: "2850 S Cole Rd, Boise, ID 83709" })],
    sites: [SITE({ id: "s3", address: "2850 S Cole Rd, Boise, ID 83709", stage: "tracking", portfolio_item_id: "p2" })],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stage, "tracking");
  assert.equal(rows[0].group, "owned");
  assert.equal(rows[0].portfolioId, "p2");
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
  const rows = HM.properties({ today: TODAY,
    buildings: [B({ id: "f", address: "615 S Capitol Blvd, Boise, ID" })],
    portfolio: [HELD({})],
    sites: [SITE({ dates: [{ on: "2026-10-21", label: "DD" }] }), SITE({ id: "s9", address: "12500 W Floating Feather Rd, Star, ID", stage: "prospect", dates: [{ on: "2026-10-10", label: "Call" }] })],
  });
  assert.deepEqual(rows.map((r) => HM.street(r.address)), ["12500 W Floating Feather Rd", "2410 W Amity Rd", "1450 S Eagle Rd", "615 S Capitol Blvd"]);
});

test("the agenda: unread first, then lease dates inside 90 days and deal dates inside 30, soonest first, numbered", () => {
  const items = HM.agenda({ today: TODAY,
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

test("the status line says what is due, never what the page is", () => {
  assert.match(HM.statusLine({ items: [{ n: -1 }, { n: 3 }] }), /^2 things this week/);
  assert.match(HM.statusLine({ items: [{ n: 20 }] }), /^Nothing due this week\. 1 date coming up\./);
  assert.equal(HM.statusLine({ items: [], propertyCount: 4 }), "Nothing needs you right now.");
  assert.match(HM.statusLine({ items: [], propertyCount: 0, hasFirm: false }), /lands on this map/);
});

test("a comp always reads as a past deal: its date and its price per unit", () => {
  const sale = HM.compRow({ id: "c1", address: "3400 S Meridian Rd, Meridian, ID 83642", property_type: "Industrial", transaction: "sale",
    deal_date: "2026-08-14", price: 2400000, size_sqft: 16000, price_per_sqft: 150 });
  assert.equal(sale.deal, "Sale");
  assert.equal(sale.when, "Aug 2026");
  assert.equal(sale.figure, "$150/SF");
  assert.equal(sale.price, "$2.4M");
  assert.equal(sale.size, "16,000 SF");
  const land = HM.compRow({ address: "1730 W Amity Rd, Meridian, ID", property_type: "Land", transaction: "sale", deal_date: "2025-12-02",
    price: 3920000, lot_acres: 24.5, price_per_acre: 160000 });
  assert.equal(land.figure, "$160K/acre");
  assert.equal(land.size, "24.5 ac");
  const lease = HM.compRow({ address: "5795 W Ustick Rd, Meridian, ID", property_type: "Industrial", transaction: "lease", deal_date: "2025-11-01",
    rent_psf: 0.86, rent_basis: "monthly", size_sqft: 29500 });
  assert.equal(lease.deal, "Lease");
  assert.equal(lease.figure, "$10.32/SF/yr", "a monthly rent is shown a year at a time");
  assert.equal(lease.price, "", "a lease has no sale price");
  assert.equal(HM.compRow(null), null);
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
