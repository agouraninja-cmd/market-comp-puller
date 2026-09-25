// firm-skyline.js — the Workspace banner drawn as the firm's own skyline.
// Every mark on it is a claim about the firm's record (a red light says a
// date is due, a lit window says someone worked on it), so the rules are
// tested here rather than eyeballed on a banner.

const test = require("node:test");
const assert = require("node:assert");
const SKY = require("../firm-skyline.js");

const NOW = new Date(2026, 8, 25, 9, 30); // local, a Friday morning
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const B = (o) => Object.assign({ id: "b1", address: "3275 S Federal Way, Boise, ID", sizeSqft: 24000, type: "Industrial",
  createdAt: daysAgo(90), addedBy: "Brad Ellis", mine: false }, o);

test("the sky follows the greeting's clock", () => {
  assert.equal(SKY.skyFor(new Date(2026, 8, 25, 7, 0)), "dawn");
  assert.equal(SKY.skyFor(new Date(2026, 8, 25, 11, 59)), "dawn");
  assert.equal(SKY.skyFor(new Date(2026, 8, 25, 12, 0)), "day", "noon is afternoon, like the greeting");
  assert.equal(SKY.skyFor(new Date(2026, 8, 25, 16, 59)), "day");
  assert.equal(SKY.skyFor(new Date(2026, 8, 25, 17, 0)), "dusk");
  assert.equal(SKY.skyFor(new Date(2026, 8, 25, 23, 0)), "dusk");
});

test("one tower per building, oldest on the left, so the skyline grows to the right", () => {
  const t = SKY.towersFor({ now: NOW, buildings: [
    B({ id: "new", address: "2 B St", createdAt: daysAgo(2) }),
    B({ id: "old", address: "1 A St", createdAt: daysAgo(200) }),
    B({ id: "mid", address: "3 C St", createdAt: daysAgo(40) }),
    { address: "no id" }, null,
  ] });
  assert.deepEqual(t.map((x) => x.building.id), ["old", "mid", "new"]);
  assert.deepEqual(SKY.towersFor({ now: NOW, buildings: [] }), []);
  assert.deepEqual(SKY.towersFor({ now: "not a time", buildings: [B({})] }), [], "no clock, no skyline");
});

test("a tower's height is its size, on a log scale, against the firm's own largest", () => {
  const t = SKY.towersFor({ now: NOW, buildings: [
    B({ id: "s", sizeSqft: 6000 }), B({ id: "m", sizeSqft: 24000 }), B({ id: "l", sizeSqft: 180000 }),
  ] });
  const by = Object.fromEntries(t.map((x) => [x.building.id, x]));
  assert.equal(by.s.t, 0);
  assert.equal(by.l.t, 1);
  assert.ok(by.m.t > 0 && by.m.t < 1);
  assert.equal(by.l.w, 1, "the largest is also the widest");
  // A board of small buildings is not drawn as a city of skyscrapers.
  const small = SKY.towersFor({ now: NOW, buildings: [B({ id: "a", sizeSqft: 9000 }), B({ id: "b", sizeSqft: 12000 })] });
  assert.ok(small.every((x) => x.t < 0.6));
});

test("a building with no size stands at the board's middle height, and says it was not sized", () => {
  const t = SKY.towersFor({ now: NOW, buildings: [
    B({ id: "a", sizeSqft: 10000 }), B({ id: "b", sizeSqft: 40000 }), B({ id: "c", sizeSqft: 90000 }), B({ id: "x", sizeSqft: null }),
  ] });
  const x = t.find((y) => y.building.id === "x");
  const b = t.find((y) => y.building.id === "b");
  assert.equal(x.sized, false);
  assert.equal(x.t, b.t, "the median, never a guess of small or tall");
});

test("windows light up with the firm's recent work, and only with that", () => {
  const t = SKY.towersFor({ now: NOW,
    buildings: [
      B({ id: "quiet", address: "1 A St, Boise, ID" }),
      B({ id: "shelf", address: "2 B St, Boise, ID" }),
      B({ id: "added", address: "3 C St, Boise, ID", createdAt: daysAgo(10) }),
      B({ id: "busy", address: "4 D St, Boise, ID", createdAt: daysAgo(5) }),
    ],
    shelf: [
      { address: "2 b st, boise, id", createdAt: daysAgo(3) },
      { address: "2 B St, Boise, ID", createdAt: daysAgo(45) },
      { address: "4 D St, Boise, ID", createdAt: daysAgo(1) },
      { address: "4 D St, Boise ID", createdAt: daysAgo(1) },
    ],
    critical: [{ buildingId: "busy", kind: "notice", tenant: "Acme", days: 20 }] });
  const by = Object.fromEntries(t.map((x) => [x.building.id, x]));
  assert.equal(by.quiet.activity, 0);
  assert.equal(by.quiet.lit, 0.05, "a quiet building is nearly dark, never pitch black");
  assert.equal(by.shelf.activity, 1, "one report this month; last month's does not count");
  assert.equal(by.added.activity, 1, "added in the last 30 days");
  assert.equal(by.busy.activity, 3, "a report, new, and a date due; the exact address only");
  assert.ok(by.busy.lit > by.shelf.lit && by.shelf.lit > by.quiet.lit);
  assert.ok(by.busy.lit <= 0.78, "never fully lit, so a busy tower still reads as a building");
});

test("a red light is a lease date inside 90 days; a crane is a building added this calendar month", () => {
  const t = SKY.towersFor({ now: NOW,
    buildings: [B({ id: "a", createdAt: daysAgo(26) }), B({ id: "b", createdAt: daysAgo(3) }), B({ id: "c" })],
    critical: [
      { buildingId: "c", kind: "expiry", tenant: "Far Co", days: 120 },
      { buildingId: "c", kind: "notice", tenant: "Acme Logistics", days: 41 },
      { buildingId: "a", kind: "notice", days: -2 },
    ] });
  const by = Object.fromEntries(t.map((x) => [x.building.id, x]));
  assert.deepEqual(by.c.due, { what: "notice", tenant: "Acme Logistics", days: 41 });
  assert.equal(by.a.due, null, "a date already past is not due");
  assert.equal(by.a.isNew, false, "26 days before Sep 25 was August");
  assert.equal(by.b.isNew, true);
});

test("at rest the banner speaks about the soonest date, else the newest building, else nothing", () => {
  const due = SKY.towersFor({ now: NOW, buildings: [B({ id: "a", createdAt: daysAgo(1) }), B({ id: "b" }), B({ id: "c" })],
    critical: [{ buildingId: "c", kind: "notice", days: 60 }, { buildingId: "b", kind: "expiry", days: 12 }] });
  assert.equal(SKY.focusOf(due).building.id, "b");
  const fresh = SKY.towersFor({ now: NOW, buildings: [B({ id: "a", createdAt: daysAgo(6) }), B({ id: "z", createdAt: daysAgo(2) }), B({ id: "q" })] });
  assert.equal(SKY.focusOf(fresh).building.id, "z");
  assert.equal(SKY.focusOf(SKY.towersFor({ now: NOW, buildings: [B({})] })), null);
  assert.deepEqual(SKY.captionFor(fresh), { count: 3, addedThisMonth: 2 });
});

test("the layout keeps every building on the skyline, standing on the ground, inside the room", () => {
  const towers = SKY.towersFor({ now: NOW, buildings: Array.from({ length: 30 }, (_, i) =>
    B({ id: "b" + i, address: `${i} Main St`, sizeSqft: 5000 + i * 7000, createdAt: daysAgo(100 - i) })) });
  const pos = SKY.layout(towers, { x0: 400, x1: 960, ground: 230, maxHeight: 90 });
  assert.equal(pos.length, 30, "a crowded board shrinks its towers rather than dropping one");
  assert.ok(pos[0].x >= 400 - 1e-6);
  const last = pos[pos.length - 1];
  assert.ok(Math.abs(last.x + last.width - 960) < 1e-6, "anchored on the right, where new buildings rise");
  for (const p of pos) {
    assert.ok(Math.abs(p.top + p.height - 230) < 1e-9, "every tower stands on the ground");
    assert.ok(p.height <= 90 + 1e-9 && p.height >= 20);
  }
  const few = SKY.layout(towers.slice(0, 3), { x0: 400, x1: 960, ground: 230, maxHeight: 90 });
  assert.ok(few[0].x > 400, "a small board sits at the right, not stretched across");
  assert.ok(few.every((p) => p.width >= 26 && p.width <= 52));
});

test("a tower's lit windows are a fixed pattern, so it does not flicker between paints", () => {
  const a = SKY.windowPattern("b1", 0.4, 60);
  assert.deepEqual(a, SKY.windowPattern("b1", 0.4, 60));
  assert.notDeepEqual(a, SKY.windowPattern("b2", 0.4, 60));
  const on = a.filter(Boolean).length;
  assert.ok(on > 10 && on < 40, `about 40% lit, got ${on}/60`);
  assert.equal(SKY.windowPattern("b1", 0, 20).filter(Boolean).length, 0);
  assert.deepEqual(SKY.windowPattern("b1", 0.5, 0), []);
});

test("the callout says what is due, what is new and what is on the shelf, in plain words", () => {
  const [t] = SKY.towersFor({ now: NOW, buildings: [B({ createdAt: daysAgo(2), mine: true })],
    critical: [{ buildingId: "b1", kind: "notice", tenant: "Acme Logistics", days: 41 }],
    shelf: [{ address: "3275 S Federal Way, Boise, ID", createdAt: daysAgo(1) }, { address: "3275 S Federal Way, Boise, ID", createdAt: daysAgo(4) }] });
  const c = SKY.calloutFor(t);
  assert.equal(c.name, "3275 S Federal Way");
  assert.equal(c.due, "Option notice for Acme Logistics in 41 days");
  assert.equal(c.fresh, "New this month, added by you");
  assert.equal(c.meta, "2 reports this month");
  assert.equal(c.facts, `Industrial · 24,000 SF · on the board since ${SKY.shortDate(daysAgo(2))}`);
  assert.match(SKY.labelFor(t), /^3275 S Federal Way\. Industrial · 24,000 SF · on the board since [A-Z][a-z]{2} \d{1,2}\. Option notice for Acme Logistics in 41 days\. New this month, added by you\. 2 reports this month\.$/);
  const [q] = SKY.towersFor({ now: NOW, buildings: [B({ sizeSqft: null, addedBy: "" })],
    critical: [{ buildingId: "b1", kind: "expiry", tenant: "", days: 1 }] });
  const d = SKY.calloutFor(q);
  assert.equal(d.due, "Lease expires tomorrow");
  assert.equal(d.meta, "No reports this month");
  assert.doesNotMatch(d.facts, /SF/, "no size, no invented size");
});
