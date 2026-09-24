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

// ---------------------------------------------------------------------------
// Slices 3 and 4: the read shapes (spec §2, §7).
// ---------------------------------------------------------------------------
const NOW = Date.parse("2026-09-23T15:00:00Z"); // a Wednesday
const row = (over) => ({
  id: "f1", jurisdiction: "boise", permit_number: "BLD26-1", permit_type: "Tenant Improvement",
  address: "8000 S FEDERAL WAY", street_key: F.streetKey("8000 S FEDERAL WAY", addressKey), market: "Boise, ID",
  is_industrial: true, zoning: "I-1", applicant_company: "Acme", applied_date: "2026-09-20", status: "In Review",
  status_changed_at: null, source_url: "https://aca-prod.accela.com/BOISE/x", ...over,
});
const bldg = { id: "b1", address: "8000 S Federal Way, Boise, ID 83716", market: "Boise, ID" };
const swept = ["Boise, ID", "Meridian, ID"];

test("businessDayBefore skips the weekend, and freshness says so", () => {
  assert.equal(F.businessDayBefore(Date.parse("2026-09-21T15:00:00Z")), Date.parse("2026-09-18T15:00:00Z"), "Monday -> Friday");
  assert.equal(F.businessDayBefore(NOW), Date.parse("2026-09-22T15:00:00Z"));
  assert.equal(F.sweepFreshness("2026-09-23T06:00:00Z", NOW).stale, false);
  assert.equal(F.sweepFreshness("2026-09-21T06:00:00Z", NOW).stale, true);
  // Monday morning after a Friday-afternoon sweep is NOT stale.
  assert.equal(F.sweepFreshness("2026-09-18T20:00:00Z", Date.parse("2026-09-21T15:00:00Z")).stale, false);
  assert.deepEqual(F.sweepFreshness(null, NOW), { lastSweptAt: null, never: true, stale: true });
});

test("citiesLine joins the way a sentence does", () => {
  assert.equal(F.citiesLine([]), "");
  assert.equal(F.citiesLine(["Boise"]), "Boise");
  assert.equal(F.citiesLine(["Boise", "Meridian"]), "Boise and Meridian");
  assert.equal(F.citiesLine(["Boise", "Meridian", "Nampa"]), "Boise, Meridian and Nampa");
});

test("toFilingView drops a non-http source url rather than render it as a link", () => {
  assert.equal(F.toFilingView(row({ source_url: "javascript:alert(1)" })).sourceUrl, "");
  assert.equal(F.toFilingView(row()).sourceUrl, "https://aca-prod.accela.com/BOISE/x");
  assert.equal(F.toFilingView(row(), (k) => (k === "boise" ? "Boise" : "")).city, "Boise");
  assert.equal("street_key" in F.toFilingView(row()), false, "plumbing stays server-side");
});

test("sheetPermits: null outside the swept cities, never an empty section", () => {
  const dallas = { id: "b2", address: "100 Main St, Dallas, TX", market: "Dallas, TX" };
  assert.equal(F.sheetPermits({ building: dallas, supportedMarkets: swept, addressKey, filings: [row()], now: NOW }), null);
  // Nampa has a registry entry but is not swept, so it is not supported here.
  const nampa = { id: "b3", address: "1 Main St, Nampa, ID", market: "Nampa, ID" };
  assert.equal(F.sheetPermits({ building: nampa, supportedMarkets: swept, addressKey, filings: [], now: NOW }), null);
});

test("sheetPermits re-matches, so a filing fetched too wide cannot land on this sheet", () => {
  const other = row({ id: "f2", permit_number: "BLD-NEXT-DOOR", address: "8002 S FEDERAL WAY",
    street_key: F.streetKey("8002 S FEDERAL WAY", addressKey) });
  const meridianTwin = row({ id: "f3", permit_number: "MER-1", market: "Meridian, ID", jurisdiction: "meridian" });
  const out = F.sheetPermits({ building: bldg, supportedMarkets: swept, addressKey, now: NOW,
    lastSweptAt: "2026-09-23T06:00:00Z", filings: [row(), other, meridianTwin],
    events: [{ filing_id: "f1", old_status: "In Review", new_status: "Issued", detected_at: "2026-09-22T00:00:00Z" },
             { filing_id: "f2", old_status: "x", new_status: "y", detected_at: "2026-09-22T00:00:00Z" }] });
  assert.deepEqual(out.filings.map((f) => f.permitNumber), ["BLD26-1"]);
  assert.deepEqual(out.filings[0].history, [{ from: "In Review", to: "Issued", at: "2026-09-22T00:00:00Z" }]);
  assert.equal(out.stale, false);
});

test("boardPermitActivity: filed or moved inside the window, most recent first, one row per filing", () => {
  const b2 = { id: "b2", address: "450 W Main St, Boise, ID", market: "Boise, ID" };
  const filings = [
    row({ id: "a", permit_number: "FILED-3D", applied_date: "2026-09-20" }),
    row({ id: "b", permit_number: "MOVED-1D", address: "450 W MAIN ST", street_key: F.streetKey("450 W MAIN ST", addressKey),
      applied_date: "2026-06-01", status: "Issued", status_changed_at: "2026-09-22T10:00:00Z" }),
    row({ id: "c", permit_number: "OLD", applied_date: "2026-06-01" }),
  ];
  const out = F.boardPermitActivity({ filings, buildings: [bldg, b2], addressKey, now: NOW });
  assert.deepEqual(out.map((a) => [a.permitNumber, a.kind, a.daysAgo, a.buildingId]),
    [["MOVED-1D", "status", 1, "b2"], ["FILED-3D", "filed", 3, "b1"]]);
  assert.deepEqual(F.boardPermitActivity({ filings, buildings: [], addressKey, now: NOW }), [], "no board, no rows");
});

test("newFilingsFeed: industrial only, inside the window, newest first, capped", () => {
  const out = F.newFilingsFeed({ now: NOW, filings: [
    row({ id: "1", permit_number: "A", applied_date: "2026-09-18" }),
    row({ id: "2", permit_number: "B", applied_date: "2026-09-22" }),
    row({ id: "3", permit_number: "OFFICE", applied_date: "2026-09-22", is_industrial: false }),
    row({ id: "4", permit_number: "OLD", applied_date: "2026-08-01" }),
    row({ id: "5", permit_number: "UNDATED", applied_date: null }),
  ] });
  assert.deepEqual(out.map((f) => f.permitNumber), ["B", "A"]);
  const many = Array.from({ length: 60 }, (_, i) => row({ id: "m" + i, permit_number: "M" + i }));
  assert.equal(F.newFilingsFeed({ now: NOW, filings: many }).length, F.FEED_MAX);
});
