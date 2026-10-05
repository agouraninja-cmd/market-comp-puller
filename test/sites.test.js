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
