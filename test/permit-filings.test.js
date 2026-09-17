// test/permit-filings.test.js
// The rules for what the permit sweep stores and how a filing is matched to
// a building on a firm's board. Pure; the two keys are injected from the
// modules that own them, exactly as server.js injects them.
// Spec: docs/superpowers/specs/2026-09-16-permit-signals-design.md §4-5

const test = require("node:test");
const assert = require("node:assert");

const F = require("../permit-filings");
const P = require("../permit-portals");
const Z = require("../permit-zoning");
const { addressKey } = require("../broker-vault");
const { marketOf } = require("../market");

const deps = { addressKey, marketOf, flagIndustrial: P.flagIndustrial, industrialFor: Z.industrialFor };
const boise = P.JURISDICTIONS.boise;

test("SUPPORTED_MARKETS is exactly the registry's cities, spelled the way marketOf spells them", () => {
  const fromRegistry = P.JURISDICTION_KEYS.map((k) => marketOf(P.marketLabel(P.JURISDICTIONS[k])));
  assert.deepEqual([...F.SUPPORTED_MARKETS].sort(), fromRegistry.sort());
  assert.equal(F.isSupportedMarket("Boise, ID"), true);
  assert.equal(F.isSupportedMarket("boise, id"), false, "the key is canonical, not case-folded");
  assert.equal(F.isSupportedMarket("Dallas, TX"), false);
});

test("streetKey: a portal's bare street and a board's full address key the same", () => {
  const portal = F.streetKey("8000 S FEDERAL WAY, Boise ID 83716", addressKey);
  const board = F.streetKey("8000 S. Federal Way, Boise, ID 83716", addressKey);
  assert.equal(portal, board);
  assert.equal(portal, "8000 s federal way");
  // A comma-less portal string is its own street line; the market check is
  // what keeps it apart from another city's "100 Main St".
  assert.equal(F.streetKey("3468 CENTREPOINT", addressKey), "3468 centrepoint");
  assert.throws(() => F.streetKey("x"), /addressKey/);
});

test("streetKey does NOT expand abbreviations — miss rather than guess", () => {
  assert.notEqual(F.streetKey("100 Main Street", addressKey), F.streetKey("100 Main St", addressKey));
});

test("normalizeFiling: a discovered Boise row becomes the stored shape, market from the jurisdiction", () => {
  const raw = {
    permit_number: "bld26-02789", permit_type: "New/Added Commercial",
    description: "Elevated walk way", project_name: "MICRON SWG Bridge",
    address: "8000 S FEDERAL WAY, Boise ID 83716", applied_date: "2026-09-16",
    status: "Applicant Upload", ref: { detailUrl: "https://permits.cityofboise.org/x" },
  };
  const row = F.normalizeFiling(raw, boise, { applicant_company: "Micron Technology Inc", parcel_number: "S1607212409", zoning: "I-3" }, deps);
  assert.equal(row.jurisdiction, "boise");
  assert.equal(row.permit_number, "BLD26-02789", "uppercased");
  assert.equal(row.market, "Boise, ID");
  assert.equal(row.street_key, "8000 s federal way");
  assert.equal(row.is_industrial, true, "I-3 zoning decides, whatever the words say");
  assert.equal(row.applicant_company, "Micron Technology Inc");
  assert.equal(row.contractor_company, null);
  assert.equal(row.applied_date, "2026-09-16");
  assert.equal(row.status, "Applicant Upload");
  assert.equal(row.source_url, "https://permits.cityofboise.org/x");
  assert.equal(row.parcel_number, "S1607212409");
});

test("normalizeFiling: keyword flag carries a row with no zoning; blanks are null; bad dates are null", () => {
  const raw = { permit_number: "X1", description: "New WAREHOUSE shell", address: "", applied_date: "09/16/2026", ref: {} };
  const row = F.normalizeFiling(raw, boise, {}, deps);
  assert.equal(row.is_industrial, true);
  assert.equal(row.address, null);
  assert.equal(row.street_key, null);
  assert.equal(row.applied_date, null);
  assert.equal(row.status, null);
  assert.equal(row.source_url, boise.portalUrl, "no detail URL falls back to the portal home");
  const office = F.normalizeFiling({ permit_number: "X2", description: "office TI", ref: {} }, boise, { zoning: "L-O" }, deps);
  assert.equal(office.is_industrial, false);
});

test("normalizeFiling: the enrichment's description fills a listing that had none, never overrides one", () => {
  const a = F.normalizeFiling({ permit_number: "N1", description: "", ref: {} }, boise, { description: "From detail" }, deps);
  assert.equal(a.description, "From detail");
  const b = F.normalizeFiling({ permit_number: "N2", description: "From grid", ref: {} }, boise, { description: "From detail" }, deps);
  assert.equal(b.description, "From grid");
});

test("normalizeFiling refuses without a permit number or a jurisdiction, and without the injected keys", () => {
  assert.equal(F.normalizeFiling({ permit_number: "" }, boise, {}, deps), null);
  assert.equal(F.normalizeFiling({ permit_number: "A" }, null, {}, deps), null);
  assert.throws(() => F.normalizeFiling({ permit_number: "A" }, boise, {}, {}), /addressKey and marketOf/);
});

test("splitKnown: fresh vs already-stored, keyed on jurisdiction + number", () => {
  const rows = [
    { jurisdiction: "boise", permit_number: "A1", status: "In Review" },
    { jurisdiction: "boise", permit_number: "A2", status: "Prescreen" },
    { jurisdiction: "meridian", permit_number: "A1", status: "In Progress" },
  ];
  const stored = [{ id: "r1", jurisdiction: "boise", permit_number: "A1", status: "Prescreen" }];
  const { fresh, seen } = F.splitKnown(rows, stored);
  assert.deepEqual(fresh.map((r) => `${r.jurisdiction}/${r.permit_number}`), ["boise/A2", "meridian/A1"]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].stored.id, "r1");
});

test("statusChange: a real move is recorded; blanks and no-ops are not", () => {
  const now = Date.UTC(2026, 8, 16, 12);
  assert.deepEqual(F.statusChange("Prescreen", "In Review", now),
    { old_status: "Prescreen", new_status: "In Review", detected_at: "2026-09-16T12:00:00.000Z" });
  assert.equal(F.statusChange("In Review", "In Review", now), null);
  assert.equal(F.statusChange("In Review", "", now), null, "a portal that stopped printing the column is not a change");
  assert.equal(F.statusChange(null, "In Review", now), null);
});

test("sweepWindow: Boise-local dates, a bounded lookback, the tracker's 4-day default", () => {
  // 2026-09-16 05:30 UTC is still 2026-09-15 in Boise (UTC-6 in September).
  const now = Date.UTC(2026, 8, 16, 5, 30);
  const w = F.sweepWindow(now);
  assert.deepEqual(w, { from: "2026-09-11", to: "2026-09-15", days: 4 });
  assert.equal(F.sweepWindow(now, 7).from, "2026-09-08");
  assert.equal(F.sweepWindow(now, 0).days, 4, "out of range falls back to the default");
  assert.equal(F.sweepWindow(now, 400).days, 4);
  assert.equal(F.sweepWindow(now, "abc").days, 4);
  assert.equal(F.sweepWindow(now, 60).days, 60, "the ceiling is inclusive");
});

test("matchFilingsToBuildings: same market AND same street key, nothing looser", () => {
  const filings = [
    { id: "f1", market: "Boise, ID", street_key: "8000 s federal way" },
    { id: "f2", market: "Meridian, ID", street_key: "8000 s federal way" },
    { id: "f3", market: "Boise, ID", street_key: "3468 centrepoint" },
    { id: "f4", market: "Boise, ID", street_key: null },
  ];
  const buildings = [
    { id: "b1", market: "Boise, ID", address: "8000 S. Federal Way, Boise, ID 83716" },
    { id: "b2", market: "Boise, ID", address: "8000 S Federal Way" },   // two board rows, same building
    { id: "b3", market: "Nampa, ID", address: "3468 Centrepoint, Nampa, ID" },
    { id: "b4", market: "Boise, ID", address: "" },
  ];
  const hits = F.matchFilingsToBuildings(filings, buildings, addressKey);
  assert.deepEqual(hits.map((h) => `${h.filing.id}->${h.building.id}`).sort(), ["f1->b1", "f1->b2"]);
});

test("filingKey is case-insensitive on the number and separates jurisdictions", () => {
  assert.equal(F.filingKey({ jurisdiction: "boise", permit_number: "bld26-1" }), F.filingKey({ jurisdiction: "boise", permit_number: "BLD26-1" }));
  assert.notEqual(F.filingKey({ jurisdiction: "boise", permit_number: "A" }), F.filingKey({ jurisdiction: "meridian", permit_number: "A" }));
});
