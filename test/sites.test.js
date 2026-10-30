// Sites rules (sites.js): pure, so every rule the /api/sites routes and the
// Sites tab lean on runs here with no database and no browser.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const SITES = require("../sites");

const TODAY = "2026-10-05";
const types = (t) => ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"].includes(t);

test("the stages, the five-step tracker and the two sections agree with each other", () => {
  assert.deepEqual(SITES.STEPS, ["prospect", "loi", "contract", "entitle", "owned"]);
  for (const s of SITES.STEPS) assert.ok(SITES.isStage(s), s);
  for (const s of SITES.BUYING) assert.ok(SITES.STEPS.includes(s) && !SITES.isHeld(s), s);
  assert.deepEqual(SITES.HELD, ["owned", "tracking"]);
  for (const s of SITES.STAGES) assert.ok(SITES.labelOf(s), "no label for " + s);
  assert.equal(SITES.labelOf("contract"), "Under contract");
  assert.equal(SITES.nextStage("contract"), "entitle");
  assert.equal(SITES.nextStage("entitle"), "owned");
  assert.equal(SITES.nextStage("owned"), null, "Owned is the last step");
  assert.equal(SITES.nextStage("passed"), null, "Passed is off the tracker");
});

test("the migration's CHECK lists exactly the stages sites.js knows, and it destroys nothing", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "060-user-sites.sql"), "utf8");
  const code = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  const m = /stage in \(([^)]*)\)/.exec(code);
  assert.ok(m, "no stage CHECK in 060");
  const listed = m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(listed, SITES.STAGES);
  assert.ok(!/\b(drop|truncate|delete\s+from|alter\s+table\s+\w+\s+drop)\b/i.test(code),
    "060 must stay purely additive: there is no staging database to rehearse against");
  assert.match(code, /enable row level security/, "a private table without RLS is readable through PostgREST");
});

test("061 only adds the five columns server.js probes for, and its index", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "061-user-sites-firm.sql"), "utf8");
  const code = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.ok(!/\b(drop|truncate|delete\s+from|update\s+\w+\s+set)\b/i.test(code), "061 changes no existing row or column");
  const added = [...code.matchAll(/alter table user_sites add column if not exists (\w+)/g)].map((m) => m[1]);
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const probed = JSON.parse(/const SITES_V2_COLS = (\[[^\]]*\]);/.exec(src)[1]);
  assert.deepEqual(added, probed, "the probe names exactly what 061 adds");
});

test("a new deal starts on Prospect, today, with its fields cleaned", () => {
  const r = SITES.validateNew({ address: " 2410 W Amity Rd, Meridian, ID 83642 ", acres: "18.4 ac",
    zoning: "R-8", asking_price: "$3,450,000", notes: "Sewer at the road." }, { isPropertyType: types, today: TODAY });
  assert.ok(r.ok, r.error);
  assert.equal(r.row.address, "2410 W Amity Rd, Meridian, ID 83642");
  assert.equal(r.row.stage, "prospect");
  assert.deepEqual(r.row.stage_dates, { prospect: TODAY });
  assert.equal(r.row.acres, 18.4);
  assert.equal(r.row.asking_price, 3450000);
  assert.equal(r.row.property_type, "Land", "a site defaults to Land");
  assert.equal(r.row.portfolio_item_id, null);
  assert.deepEqual(r.row.dates, []);
});

test("a figure written with a suffix is refused, never multiplied out", () => {
  for (const bad of ["3.4M", "450k", "three million", "$3,450,000.505"]) {
    const r = SITES.validateNew({ address: "1 Main St", asking_price: bad }, { isPropertyType: types, today: TODAY });
    assert.equal(r.ok, false, bad + " was accepted");
    assert.match(r.error, /full figure/);
  }
  const acres = SITES.validateNew({ address: "1 Main St", acres: "0" }, { isPropertyType: types, today: TODAY });
  assert.equal(acres.ok, false, "zero acres was accepted");
});

test("an address is required and a property type must be one we know", () => {
  assert.equal(SITES.validateNew({}, { isPropertyType: types }).ok, false);
  assert.equal(SITES.validateNew({ address: "   " }, { isPropertyType: types }).ok, false);
  const t = SITES.validateNew({ address: "1 Main St", property_type: "Castle" }, { isPropertyType: types });
  assert.equal(t.ok, false);
  assert.match(t.error, /property type/);
});

test("Owned and Tracking must name a held property, and a deal must not", () => {
  const pid = "7a1c2e3f-1111-4222-8333-944455566677";
  assert.equal(SITES.validateNew({ address: "1 Main St", stage: "tracking" }, { isPropertyType: types }).ok, false);
  const ok = SITES.validateNew({ address: "1 Main St", stage: "tracking", portfolio_item_id: pid, property_type: "Industrial" },
    { isPropertyType: types, today: TODAY });
  assert.ok(ok.ok, ok.error);
  assert.equal(ok.row.portfolio_item_id, pid);
  const deal = SITES.validateNew({ address: "1 Main St", stage: "loi", portfolio_item_id: pid }, { isPropertyType: types });
  assert.equal(deal.ok, false, "a deal carried a portfolio id");
  assert.equal(SITES.validateNew({ address: "1 Main St", stage: "tracking", portfolio_item_id: "p1" },
    { isPropertyType: types }).ok, false, "a non-uuid property id reached the database");
  assert.equal(SITES.validateNew({ address: "1 Main St", stage: "closed" }, { isPropertyType: types }).ok, false,
    "an unknown stage was accepted");
});

test("key dates need a real date and a label, and come back soonest first", () => {
  const r = SITES.validateNew({ address: "1 Main St", dates: [
    { on: "2026-12-18", label: "Closing" }, { on: "2026-10-18", label: "Due diligence ends" }] },
  { isPropertyType: types, today: TODAY });
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.row.dates.map((d) => d.on), ["2026-10-18", "2026-12-18"]);
  for (const bad of [[{ on: "10/18/2026", label: "DD" }], [{ on: "2026-02-30", label: "DD" }], [{ on: "2026-10-18", label: " " }], "soon"]) {
    assert.equal(SITES.validateNew({ address: "1 Main St", dates: bad }, { isPropertyType: types }).ok, false,
      JSON.stringify(bad) + " was accepted");
  }
  const many = Array.from({ length: SITES.MAX_DATES + 1 }, (_, i) => ({ on: "2026-11-01", label: "d" + i }));
  assert.equal(SITES.validateNew({ address: "1 Main St", dates: many }, { isPropertyType: types }).ok, false);
});

test("the next deadline is the soonest date from today on", () => {
  const dates = [{ on: "2026-09-18", label: "Under contract" }, { on: "2026-12-18", label: "Closing" },
    { on: "2026-10-18", label: "Due diligence ends" }];
  assert.deepEqual(SITES.nextDeadline(dates, TODAY), { on: "2026-10-18", label: "Due diligence ends" });
  assert.deepEqual(SITES.nextDeadline(dates, "2026-10-18"), { on: "2026-10-18", label: "Due diligence ends" },
    "a deadline due today is still the next one");
  assert.equal(SITES.nextDeadline(dates, "2027-01-01"), null);
  assert.equal(SITES.nextDeadline(null, TODAY), null);
  assert.equal(SITES.daysUntil("2026-10-18", TODAY), 13);
  assert.equal(SITES.daysUntil("2026-10-01", TODAY), -4);
});

test("moving a stage stamps today and keeps the days earlier stages were reached", () => {
  const existing = { stage: "loi", stage_dates: { prospect: "2026-08-03", loi: "2026-08-27" }, portfolio_item_id: null };
  const r = SITES.validatePatch(existing, { stage: "contract" }, { isPropertyType: types, today: TODAY });
  assert.ok(r.ok, r.error);
  assert.equal(r.patch.stage, "contract");
  assert.deepEqual(r.patch.stage_dates, { prospect: "2026-08-03", loi: "2026-08-27", contract: TODAY });
  const same = SITES.validatePatch(existing, { stage: "loi", notes: "x" }, { isPropertyType: types, today: TODAY });
  assert.ok(same.ok);
  assert.equal(same.patch.stage_dates, undefined, "re-saving the same stage rewrote its date");
});

test("a deal becomes Owned only together with the property it became", () => {
  const existing = { stage: "entitle", stage_dates: {}, portfolio_item_id: null };
  const alone = SITES.validatePatch(existing, { stage: "owned" }, { isPropertyType: types, today: TODAY });
  assert.equal(alone.ok, false);
  const pid = "7a1c2e3f-1111-4222-8333-944455566677";
  const r = SITES.validatePatch(existing, { stage: "owned", portfolio_item_id: pid }, { isPropertyType: types, today: TODAY });
  assert.ok(r.ok, r.error);
  assert.equal(r.patch.portfolio_item_id, pid);
  assert.deepEqual(r.patch.stage_dates, { owned: TODAY });
});

test("an edit validates each field it carries, and an empty edit is refused", () => {
  const ex = { stage: "prospect", stage_dates: {} };
  assert.equal(SITES.validatePatch(ex, { asking_price: "2.1M" }, { isPropertyType: types }).ok, false);
  assert.equal(SITES.validatePatch(ex, { address: "" }, { isPropertyType: types }).ok, false);
  assert.equal(SITES.validatePatch(ex, {}, { isPropertyType: types }).ok, false);
  const r = SITES.validatePatch(ex, { seller: "Amity Farms LLC", earnest_money: "75,000" }, { isPropertyType: types });
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.patch, { seller: "Amity Farms LLC", earnest_money: 75000 });
});

test("control characters are stripped from free text that reaches the page", () => {
  const r = SITES.validateNew({ address: "1 Main\u0000 St", notes: "a\u0007b" }, { isPropertyType: types, today: TODAY });
  assert.ok(r.ok);
  assert.ok(!/[\u0000-\u001f]/.test(r.row.address + r.row.notes));
});

test("near a deal: a mile by great circle, a missing place is no place, and the nearest deal wins", () => {
  // 2026-10-21, the owner's #5. Number(null) is 0, so a deal or permit with no
  // place must never be measured from 0,0.
  assert.equal(SITES.milesBetween(43.5893, -116.265, null, null), null);
  assert.equal(SITES.milesBetween(43.5893, -116.265, "", 0), null);
  assert.equal(SITES.milesBetween(43.5893, -116.265, 43.5893, -116.265), 0);
  assert.ok(Math.abs(SITES.milesBetween(43.5893, -116.265, 43.5893, -116.24) - 1.25) < 0.02);
  const deals = [{ id: "a", address: "5600 W Overland Rd", lat: 43.5893, lng: -116.265 },
    { id: "b", address: "5900 W Overland Rd", lat: 43.5893, lng: -116.272 }, { id: "c", address: "Unplaced", lat: null, lng: null }];
  assert.deepEqual(SITES.nearestSite(43.5899, -116.2705, deals), { id: "b", address: "5900 W Overland Rd", miles: 0.1 });
  assert.equal(SITES.nearestSite(43.7, -116.265, deals), null, "past a mile is not near");
  assert.equal(SITES.nearestSite(null, null, deals), null, "a permit with no place is near nothing");
  assert.equal(SITES.NEAR_MILES, 1);
});

test("a deal's permits: within the mile, newest day first and nearest within a day; an alert covers it only from the same spot", () => {
  const site = { id: "a", lat: 43.5893, lng: -116.265 };
  const f = (id, lat, lng, appliedDate) => ({ id, lat, lng, appliedDate });
  const near = SITES.permitsNear(site, [f(1, 43.5895, -116.266, "2026-10-01"), f(2, 43.5893, -116.24, "2026-10-09"),
    f(3, 43.594, -116.27, "2026-10-08"), f(4, 43.5894, -116.2651, "2026-10-08"), f(5, null, null, "2026-10-10")]);
  assert.deepEqual(near.map((x) => [x.id, x.miles]), [[4, 0], [3, 0.4], [1, 0.1]]);
  assert.deepEqual(SITES.permitsNear({ id: "u", lat: null, lng: null }, [f(1, 43.5895, -116.266, "x")]), []);
  const area = (lat, lng, miles) => ({ id: "al", area: { lat, lng, miles } });
  assert.deepEqual(SITES.alertCovering(site, [area(43.5894, -116.2652, 1)]), { id: "al", miles: 1 });
  assert.deepEqual(SITES.alertCovering(site, [area(43.5894, -116.2652, 2)]), { id: "al", miles: 2 }, "a wider circle covers it too");
  assert.equal(SITES.alertCovering(site, [area(43.5894, -116.2652, 0.5)]), null, "half a mile is less than the pane shows");
  assert.deepEqual(SITES.alertCovering(site, [area(43.6, -116.265, 5)]), { id: "al", miles: 5 }, "a wide circle nearby holds the whole mile");
  assert.equal(SITES.alertCovering(site, [area(43.6, -116.265, 1)]), null, "a mile centred most of a mile away does not");
  assert.equal(SITES.alertCovering(site, [area(43.7, -116.265, 5)]), null, "nor a wide one too far off");
  assert.equal(SITES.alertCovering(site, [{ id: "plain", area: null }]), null, "a city alert is not an area alert");
});

test("an estimate is refused rather than repaired: dollars only, a whole dollar or more (2026-10-21)", () => {
  // Found in review: Number() took true as 1, [5] as 5 and "0x10" as 16, and
  // the positive check ran before rounding, so 0.4 was stored as a likely $0.
  const ok = SITES.cleanEstimate({ low: "5075000", likely: 5775000.4, high: 6275000 }, { today: "2026-10-21" });
  assert.deepEqual(ok, { ok: true, value: { low: 5075000, likely: 5775000, high: 6275000, report: null, at: "2026-10-21" } });
  for (const likely of [0.4, 0, -5, true, [5], "0x10", "1e6", "5,000,000", "$5000000", NaN, Infinity, {}]) {
    assert.equal(SITES.cleanEstimate({ likely }, {}).ok, false, JSON.stringify(likely));
  }
  assert.equal(SITES.cleanEstimate({ likely: 5000000, low: true }, {}).ok, false, "every figure, not just likely");
  assert.deepEqual(SITES.cleanEstimate(null, {}), { ok: true, value: null }, "null still clears it");
});
