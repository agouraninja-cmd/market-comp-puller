// building-day.js — which building opens the Workspace each morning, and why.
// The banner's picture is a claim about the firm's own record ("this one
// needs you"), so the rule is tested here rather than eyeballed on a banner.

const test = require("node:test");
const assert = require("node:assert");
const DAY = require("../building-day.js");

const NOW = new Date("2026-09-25T15:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const B = (o) => Object.assign({ id: "b1", address: "3275 S Federal Way, Boise, ID", lat: 43.572128, lng: -116.190925,
  createdAt: daysAgo(60), addedBy: "Brad Ellis", mine: false }, o);

test("only a building with a location is ever shown", () => {
  const order = DAY.orderForDay({ now: NOW, buildings: [
    B({ id: "a", lat: null, lng: null }),
    B({ id: "b", lat: 43.6, lng: "" }),
    B({ id: "c", lat: 0, lng: 0 }),
    B({ id: "d", lat: 91, lng: -116 }),
    B({ id: "e", address: "450 W Main St, Boise, ID", lat: "43.61386", lng: "-116.199328" }),
  ] });
  assert.deepEqual(order.map((o) => o.building.id), ["e"], "strings that parse count; blanks, nulls, 0,0 and off-planet do not");
  assert.deepEqual(DAY.orderForDay({ now: NOW, buildings: [B({ lat: null })] }), []);
  assert.deepEqual(DAY.orderForDay({ now: NOW }), []);
  assert.deepEqual(DAY.orderForDay({ now: "not a time", buildings: [B({})] }), [], "no clock, no pick");
});

test("a lease date inside 90 days wins, soonest first", () => {
  const order = DAY.orderForDay({ now: NOW,
    buildings: [B({ id: "far", address: "1 A St, Boise, ID" }), B({ id: "near", address: "2 B St, Boise, ID" }),
      B({ id: "new", address: "3 C St, Boise, ID", createdAt: daysAgo(1) })],
    critical: [
      { buildingId: "far", kind: "expiry", tenant: "Far Co", days: 80 },
      { buildingId: "near", kind: "notice", tenant: "Acme Logistics", days: 41 },
      { buildingId: "near", kind: "expiry", tenant: "Acme Logistics", days: 130 },
    ] });
  assert.equal(order[0].building.id, "near");
  assert.equal(order[0].picked, true);
  assert.deepEqual(order[0].reason, { kind: "due", what: "notice", tenant: "Acme Logistics", days: 41 });
  assert.equal(order.filter((o) => o.picked).length, 1);
  assert.deepEqual(order.slice(1).map((o) => o.building.id), ["far", "new"], "the rest by address, each keeping its own reason");
  assert.equal(order[1].reason.kind, "due");
  assert.equal(order[2].reason.kind, "new");
});

test("a date past 90 days, or already past, is not due", () => {
  const order = DAY.orderForDay({ now: NOW, buildings: [B({})],
    critical: [{ buildingId: "b1", kind: "notice", days: 120 }, { buildingId: "b1", kind: "expiry", days: -3 }] });
  assert.notEqual(order[0].reason.kind, "due");
});

test("with nothing due, the newest building of the last two weeks leads", () => {
  const order = DAY.orderForDay({ now: NOW,
    buildings: [B({ id: "old", address: "1 A St, Boise, ID", createdAt: daysAgo(40) }),
      B({ id: "week", address: "2 B St, Boise, ID", createdAt: daysAgo(6), mine: true }),
      B({ id: "yday", address: "3 C St, Boise, ID", createdAt: daysAgo(1), addedBy: "Luis Moreno" })],
    shelf: [{ address: "3 c st, boise, id", createdAt: daysAgo(0) }] });
  assert.equal(order[0].building.id, "yday");
  assert.deepEqual(order[0].reason, { kind: "new", mine: false, addedBy: "Luis Moreno", date: "Sep 24", reports: 1 });
  assert.equal(order.find((o) => o.building.id === "week").reason.mine, true);
});

test("then the building with the most reports this month, then the day's turn", () => {
  const shelf = [
    { address: "2 B St, Boise, ID", createdAt: daysAgo(3) },
    { address: "2 b st, boise, id", createdAt: daysAgo(12) },
    { address: "1 A St, Boise, ID", createdAt: daysAgo(5) },
    { address: "1 A St, Boise, ID", createdAt: daysAgo(45) },
    { address: "1 A St, Boise ID", createdAt: daysAgo(1) },
  ];
  const bs = [B({ id: "a", address: "1 A St, Boise, ID" }), B({ id: "b", address: "2 B St, Boise, ID" }), B({ id: "c", address: "3 C St, Boise, ID" })];
  const order = DAY.orderForDay({ now: NOW, buildings: bs, shelf });
  assert.equal(order[0].building.id, "b", "two reports this month beat one; the exact address only, any case");
  assert.deepEqual(order[0].reason, { kind: "reports", count: 2 });
  const quiet = (now) => DAY.orderForDay({ now, buildings: bs })[0].building.id;
  const seen = new Set([0, 1, 2].map((d) => quiet(new Date(NOW.getTime() + d * 86400000))));
  assert.equal(seen.size, 3, "a quiet board turns over one building a day");
  assert.equal(quiet(NOW), quiet(new Date(NOW.getTime() + 60000)), "and holds the same one all day");
});

test("the order does not depend on the order the board arrived in", () => {
  const bs = [B({ id: "a", address: "1 A St, Boise, ID" }), B({ id: "b", address: "2 B St, Boise, ID" }), B({ id: "c", address: "3 C St, Boise, ID" })];
  const one = DAY.orderForDay({ now: NOW, buildings: bs }).map((o) => o.building.id);
  const two = DAY.orderForDay({ now: NOW, buildings: bs.slice().reverse() }).map((o) => o.building.id);
  assert.deepEqual(one, two);
});

test("the reason reads as a sentence, with the due date as the part set in red", () => {
  assert.deepEqual(DAY.reasonText({ kind: "due", what: "notice", tenant: "Acme Logistics", days: 41 }),
    { rest: "The option notice for Acme Logistics is due ", lead: "in 41 days." });
  assert.deepEqual(DAY.reasonText({ kind: "due", what: "expiry", tenant: "", days: 1 }),
    { rest: "The lease expires ", lead: "tomorrow." });
  assert.equal(DAY.reasonText({ kind: "due", what: "notice", tenant: "X", days: 0 }).lead, "today.");
  assert.equal(DAY.reasonText({ kind: "new", mine: true, addedBy: "Ana", date: "Sep 22", reports: 1 }).rest,
    "New on the board, added by you on Sep 22. 1 report on the shelf already.");
  assert.equal(DAY.reasonText({ kind: "new", mine: false, addedBy: "", date: "Sep 22", reports: 0 }).rest,
    "New on the board since Sep 22.", "no name, no guess at one");
  assert.equal(DAY.reasonText({ kind: "reports", count: 2 }).rest, "2 reports on the firm's shelf in the last 30 days.");
  assert.equal(DAY.reasonText({ kind: "since", date: "Aug 23" }).rest, "On the board since Aug 23.");
  assert.equal(DAY.reasonText({ kind: "since", date: "" }).rest, "On the firm's board.");
  assert.equal(DAY.reasonText(null).lead, "");
});

test("the aerial is centred where it is asked to be, and never stretched", () => {
  const url = DAY.aerialUrl({ lat: 43.572128, lng: -116.190925, width: 1000, height: 250, groundMeters: 500, fx: 0.56, fy: 0.42 });
  assert.match(url, /^https:\/\/services\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/export\?/);
  const q = new URLSearchParams(url.split("?")[1]);
  assert.equal(q.get("bboxSR"), "3857");
  assert.equal(q.get("imageSR"), "3857");
  assert.equal(q.get("size"), "1000,250");
  const [xmin, ymin, xmax, ymax] = q.get("bbox").split(",").map(Number);
  assert.ok(Math.abs((xmax - xmin) / (ymax - ymin) - 4) < 1e-3, "the box has the picture's own shape");
  const R = 6378137, rad = Math.PI / 180;
  const x = R * -116.190925 * rad, y = R * Math.log(Math.tan(Math.PI / 4 + 43.572128 * rad / 2));
  assert.ok(Math.abs((x - xmin) / (xmax - xmin) - 0.56) < 1e-3, "across");
  assert.ok(Math.abs((ymax - y) / (ymax - ymin) - 0.42) < 1e-3, "down");
  const ground = (xmax - xmin) * Math.cos(43.572128 * rad);
  assert.ok(Math.abs(ground - 500) < 1, "about as wide on the ground as asked");
  assert.equal(new URLSearchParams(DAY.aerialUrl({ lat: 43.6, lng: -116.2, width: 8000, height: 2000 }).split("?")[1]).get("size"),
    "4096,1024", "Esri's 4096 limit, keeping the shape");
  assert.equal(DAY.aerialUrl({ lat: null, lng: 1, width: 10, height: 10 }), "");
  assert.equal(DAY.aerialUrl({ lat: 89, lng: 1, width: 10, height: 10 }), "", "no picture past Mercator's edge");
});

test("dates are the calendar day that was stored, the same on every machine", () => {
  assert.equal(DAY.shortDate("2026-09-22T15:40:00.192Z"), "Sep 22");
  assert.equal(DAY.shortDate("nope"), "");
});
