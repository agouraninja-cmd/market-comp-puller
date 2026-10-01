// permit-reports.js and pdf-text.js — Nampa's permits, read from the reports
// the city publishes (2026-10-01).
//
// The rules with teeth, pinned against reports captured from cityofnampa.us
// on 2026-10-01 (test/fixtures/nampa-reports/, fetched with the sweep's own
// agent): the index finds every plan review and activity report and orders
// them by when the city posted them; the plan review table comes out row by
// row with each cell in its column, the page footer kept out; the activity
// report's Commercial section comes out with the companies on each permit and
// the address split so its street line is the street alone; a filing date the
// city's system did not record (the January migration) drops the permit; an
// intake failure, a multi-family building and work the portal cities never
// count are left out; and a status only replaces an older one. The synthetic
// reports test/helpers/nampa-reports.js makes for the run suites are proven
// to parse exactly like the captured ones.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const R = require("../permit-reports");
const PT = require("../pdf-text");
const H = require("./helpers/nampa-reports");

const FIX = path.join(__dirname, "fixtures", "nampa-reports");
const gz = (f) => zlib.gunzipSync(fs.readFileSync(path.join(FIX, f)));

test("the Permit Reports page: every report it links, newest upload first, absolute URLs", () => {
  const idx = R.parseReportIndex(gz("permit-reports.html.gz").toString("utf8"), "https://www.cityofnampa.us");
  assert.equal(idx.filter((r) => r.kind === "plan").length, 9, "January to August 2026, and a December 2024 straggler");
  assert.equal(idx.filter((r) => r.kind === "activity" && r.month).length, 8, "the monthly activity reports");
  assert.equal(idx.filter((r) => r.kind === "activity" && r.from).length, 36, "the weekly ones");
  assert.deepEqual(idx[0], {
    kind: "activity", id: 20813, label: "08/31/2026 - 09/04/2026", from: "2026-08-31", to: "2026-09-04",
    url: "https://www.cityofnampa.us/DocumentCenter/View/20813/Weekly-Permit-Activity-Report-08-31-2026---09-04-2026",
  });
  assert.ok(idx.every((r, i) => i === 0 || idx[i - 1].id > r.id), "ordered by DocumentCenter id: when the city posted it");
  const aug = idx.find((r) => r.kind === "plan" && r.month === "2026-08");
  assert.equal(aug.id, 20808);
  assert.ok(!idx.some((r) => /COMPREHENSIVE/i.test(r.url)), "other documents on the page are not reports");
});

test("which reports a run reads: the newest few on a weekday, the window's worth for a backfill", () => {
  const idx = R.parseReportIndex(gz("permit-reports.html.gz").toString("utf8"), "https://www.cityofnampa.us");
  assert.deepEqual(R.pickReports(idx).map((r) => r.id), [20813, 20808, 20806, 20805, 20797, 20794]);
  const all = R.pickReports(idx, { all: true, since: "2025-09" });
  assert.equal(all.filter((r) => r.kind === "plan").length, 8, "every plan review month in the window, not the 2024 one");
  assert.equal(all.filter((r) => r.kind === "activity" && r.month).length, 8, "each covered month by its one monthly report");
  assert.deepEqual(all.filter((r) => r.kind === "activity" && r.from).map((r) => r.id), [20813, 20176],
    "a weekly report only where no monthly one covers its days");
});

test("the plan review table: each cell in its column, the date it is true on, nothing from the footer", () => {
  const aug = R.parsePlanReview(gz("plan-2026-08.pdf.gz"));
  assert.equal(aug.asOf, "2026-09-03");
  assert.equal(aug.rows.length, 39);
  assert.deepEqual(aug.rows[0], {
    permit_number: "COM-05581-2026", date_in: "2026-08-03", issue_date: null, status: "Approved - Ready to Issue",
    project_name: "Taco Vinyl", address: "126 11th Ave N", applicant: "Brandon or Danielle Chandler, MTCD HOLDINGS",
    scope: "Taco Vinyl is relocating its operations from Boise to Nampa. There will be no change in the building's use, and no remodeling, only seeking occupancy.",
    valuation: 0,
  });
  const nolo = aug.rows.find((r) => r.permit_number === "COM-05589-2026");
  assert.equal(nolo.issue_date, "2026-08-27");
  assert.equal(nolo.status, "Issued");
  assert.equal(nolo.valuation, 389388);
  assert.ok(aug.rows.every((r) => !/Page \d+ of/.test(JSON.stringify(r))), "the page footer sits under the table, never in a cell");
  assert.ok(aug.rows.every((r) => /^2026-08-\d\d$/.test(r.date_in)), "a month's report is that month's intake");
});

test("a filing date the city's system did not record drops the permit (the January migration)", () => {
  const jan = R.parsePlanReview(gz("plan-2026-01.pdf.gz"));
  assert.equal(jan.asOf, "2026-02-12");
  const dropped = jan.rows.filter((r) => !R.realDateIn(r)).map((r) => r.permit_number);
  assert.deepEqual(dropped, ["COM-05117-2025", "COM-05121-2025", "COM-05034-2025", "COM-05098-2025", "COM-05100-2025", "COM-05093-2025", "COM-04897-2025"],
    "2025 permits carried into the new system with a Date In of 01/01/2026, a holiday");
  assert.equal(R.realDateIn({ date_in: "2026-03-10", issue_date: "2026-03-01" }), null, "issued before it was filed");
  assert.equal(R.realDateIn({ date_in: "2026-03-10", issue_date: "2026-03-30" }), "2026-03-10");
});

test("the activity report: the Commercial section, its companies, and the street line made the street alone", () => {
  const wk = R.parseActivityReport(gz("activity-2026-08-31.pdf.gz"));
  assert.equal(wk.from, "2026-08-31");
  assert.equal(wk.to, "2026-09-04");
  assert.equal(wk.rows.length, 7, "the residential permits in the same report are skipped");
  assert.deepEqual(wk.rows.map((r) => r.permit_number), ["COM-05510-2026", "COM-05512-2026", "COM-05551-2026", "COM-05559-2026", "COM-05573-2026", "COM-05593-2026", "COM-05617-2026"]);
  const roadhouse = wk.rows[1];
  assert.equal(roadhouse.address, "1830 Caldwell Blvd, Nampa, ID 83651", "the report prints \"1830 Caldwell Blvd Nampa, Id 83651\"");
  assert.equal(roadhouse.issue_date, "2026-09-04");
  assert.equal(roadhouse.project_name, "Texas Roadhouse-Cooler Addition");
  assert.match(roadhouse.scope, /^THE DEMOLITION OF EXISTING LANDSCAPED AREA AND SIDEWALK\. THE ADDITION OF NEW WALK-IN COOLERS AT 195 SF\. EMPs$/,
    "a scope that wraps onto a second line is read whole");
  assert.equal(wk.rows[0].contractor_company, "Intermountain West Homes", "a role wrapped onto two lines (\"Registered Building / Contractor\")");
  assert.equal(R.situsAddress("4300 E Flamingo Ave Nampa, Id 83687-1234"), "4300 E Flamingo Ave, Nampa, ID 83687-1234");
  assert.equal(R.situsAddress("126 11th Ave N"), "126 11th Ave N", "a bare street is left alone");
});

test("the kind comes from the words, and only the kinds Boise and Meridian count are kept", () => {
  const cases = [
    // [project, scope, kind] — every one a real Nampa wording.
    ["Nolo 54K MM TI Spec TI", "Provide 54,210 sqft warehouse with 2065 sqft of spec TI in Ste 2.", "Tenant Improvement"],
    ["Brooker's Founding Flavors Ice Cream", "Interior Tenant Improvement of new vanilla space for build out of an ice cream shop.", "Tenant Improvement"],
    ["Domino's Pizza Bakery & Store #7976", "New interior partitions, casework, fixed furniture, kitchen equipment for retail food bakery and store.", "Tenant Improvement"],
    ["Gold Star Foods", "Build dividing wall between Gold Star foods and adjacent space", "Tenant Improvement"],
    ["O'Reilly's Auto Parts", "Construction of a new 7,745 sq.ft. masonry and structural steel auto parts store. EMP's", "New Commercial"],
    ["Autozone Store #11023", "New AutoZone Auto Parts Store with landscaping and parking lot. EMPs", "New Commercial"],
    ["Rocky Mountain Cutting Shop", "new PEMB w/ office", "New Commercial"],
    ["Mike Corn Industrial Building", "Project is a new shell industrial flex building with associated site improvements", "New Commercial"],
    ["Steve Hill Storage - Addition", "28' x 54' single story storage building addition with trash enclosure. EMP's", "Commercial Addition"],
    ["Keller Supply-Racking", "Install high-pile storage racks within the existing warehouse.", "Rack/Shelving"],
    ["NFPD Temporary Admin", "Installing temporary mobile office trailer EM only", "Commercial Modular"],
    // Left out: the work the portal cities' sweeps never read…
    ["Taco Vinyl", "Taco Vinyl is relocating its operations from Boise to Nampa. There will be no change in the building's use, and no remodeling, only seeking occupancy.", null],
    ["MARISCOS EL VIEJON REROOF", "Remove existing roofing and install new TPO (white) and architectural shingles (black)", null],
    ["SiteOne Landscape Supply", "Moving in. No racking", null],
    ["BAJA Construction-SOLAR", "Install a new 31.28 kW-DC rooftop-canopy solar PV system", null],
    ["Middlebury North Apartments Building #9", "Construct New Carport.", null],
    ["Bell Photographers Inc", "Sales Office for School Photography", null],
    ["Nampa Crossroads", "remove existing interior door to electrical room. Add new door to the store", null],
    ["Intermountain Gas Site- CIVIL SITE ONLY", "New build that includes a 15,100 SF office", null],
    // …and multi-family, off in both portal cities' sweeps on purpose.
    ["Middlebury 4-Plex BLDG 13", "4-Plex multifamily housing apartment building. EMP's", null],
    ["GEM Sugar District - Bldg 4C", "This 3 story walk up contains 20 units, and 10 tuck under garages.", null],
    ["Almond Cove Residential Care Home", "New Construction. R4 Residential Care Home. 8 or under individual Clients.", null],
  ];
  for (const [project, scope, kind] of cases) assert.equal(R.kindOf(project, scope), kind, `${project}: ${scope}`);
});

test("a status only replaces an older one, an issue beats a snapshot that missed it, and nothing walks an issue back", () => {
  assert.equal(R.shouldReplaceStatus({ status: "In Review", asOf: "2026-09-03" }, { status: "Issued", asOf: "2026-09-02" }), true,
    "issued on Sep 2 by the activity report, though the Sep 3 plan review report still printed In Review");
  assert.equal(R.shouldReplaceStatus({ status: "Issued", asOf: "2026-08-27" }, { status: "Corrections Pending", asOf: "2026-09-03" }), false);
  assert.equal(R.shouldReplaceStatus({ status: "Issued", asOf: "2026-08-27" }, { status: "Void", asOf: "2026-09-03" }), true, "a newer void ends it");
  assert.equal(R.shouldReplaceStatus({ status: "Issued", asOf: "2026-08-27" }, { status: "Complete", asOf: "2026-09-03" }), true);
  assert.equal(R.shouldReplaceStatus({ status: "In Review", asOf: "2026-09-03" }, { status: "Corrections Pending", asOf: "2026-08-03" }), false);
  assert.equal(R.shouldReplaceStatus({ status: "In Review", asOf: "2026-09-03" }, { status: "In Review", asOf: "2026-10-03" }), false, "the same words are no change");
  assert.equal(R.statusIsNewer("2026-09-03", null), true, "anything dated beats undated");
  assert.equal(R.statusIsNewer("2026-09-03", "2026-08-27T18:00:00.000Z"), true);
  assert.equal(R.statusIsNewer("2026-08-03", "2026-08-27T18:00:00.000Z"), false, "an old report never walks a status back");
  assert.equal(R.statusIsNewer(null, "2026-08-27"), false);
  assert.equal(R.companyOf("Joseph Larrea, Babcock Design"), "Babcock Design");
  assert.equal(R.companyOf("Studio H Architects"), "Studio H Architects");
});

test("merging: one record per permit, issued from the activity report, the left-out rows counted", () => {
  const plan = { asOf: "2026-09-03", url: "u/plan", rows: [
    { permit_number: "COM-1-2026", date_in: "2026-08-03", issue_date: null, status: "In Review", project_name: "Alder TI", address: "1 A St", applicant: "Pat, Acme Design", scope: "Tenant improvement office", valuation: 10 },
    { permit_number: "COM-2-2026", date_in: "2026-08-04", issue_date: "2026-08-20", status: "Issued", project_name: "Keim Lane Building #1", address: "2 B St", applicant: "Lee, Keim LLC", scope: "A new 3,000 s.f. pre-engineered building.", valuation: 20 },
    { permit_number: "COM-3-2026", date_in: "2026-08-05", issue_date: null, status: "Intake Failed", project_name: "Big TI", address: "3 C St", applicant: "x, y", scope: "tenant improvement", valuation: 0 },
    { permit_number: "COM-4-2026", date_in: "2026-08-06", issue_date: null, status: "In Review", project_name: "Reroof", address: "4 D St", applicant: "x, y", scope: "Remove existing roofing", valuation: 0 },
  ] };
  const act = { from: "2026-08-31", to: "2026-09-04", url: "u/wk", rows: [
    { permit_number: "COM-1-2026", issue_date: "2026-09-02", address: "1 A St, Nampa, ID 83651", project_name: "Alder TI", scope: "x", applicant_company: "Acme Design", contractor_company: "Build Co" },
    { permit_number: "COM-0-2025", issue_date: "2026-09-01", address: "9 Z St, Nampa, ID 83651", project_name: "Old", scope: "x", applicant_company: null, contractor_company: "Old Co" },
  ] };
  const m = R.mergeReports({ plans: [plan], activity: [act] });
  assert.deepEqual(m.tally, { planRows: 4, activityRows: 2, droppedDates: 0, intakeFailed: 1, otherWork: 1, issuedUnfiled: 1 });
  const one = m.permits.find((p) => p.permit_number === "COM-1-2026");
  assert.equal(one.status, "Issued", "the activity report says it was issued after the plan review report's date");
  assert.equal(one.status_as_of, "2026-09-02");
  assert.equal(one.contractor_company, "Build Co");
  assert.equal(one.address, "1 A St, Nampa, ID 83651", "the activity report's full address, street line first");
  assert.equal(one.permit_type, "Tenant Improvement");
  assert.equal(one.source_url, "u/plan");
  const two = m.permits.find((p) => p.permit_number === "COM-2-2026");
  assert.equal(two.status_as_of, "2026-08-20", "an issued plan review row is true on its issue date");
  assert.equal(two.permit_type, "New Commercial");
  assert.deepEqual(m.issued.map((r) => r.permit_number), ["COM-0-2025"], "filed before the reports begin: an update for a stored permit, never a new one");
});

test("the synthetic reports the run suites serve parse exactly like the city's", () => {
  const plan = H.planReportPdf({ asOf: "2026-09-03", rows: [
    { number: "COM-05589-2026", dateIn: "2026-08-06", issueDate: "2026-08-27", status: "Issued", project: "Nolo 54K MM TI Spec TI",
      address: "216 Shannon Dr 2", applicant: "Joseph Larrea, Babcock Design", scope: "Provide 54,210 sqft warehouse with spec TI", valuation: 389388 },
    ...Array.from({ length: 11 }, (_, i) => ({ number: `COM-${String(5600 + i).padStart(5, "0")}-2026`, dateIn: "2026-08-10", status: "In Review", project: `TI ${i}`, address: `${i} A St`, applicant: "a, b", scope: "tenant improvement" })),
  ] });
  const p = R.parsePlanReview(plan);
  assert.equal(p.asOf, "2026-09-03");
  assert.equal(p.rows.length, 12, "two pages, a header on each");
  assert.deepEqual(p.rows[0], {
    permit_number: "COM-05589-2026", date_in: "2026-08-06", issue_date: "2026-08-27", status: "Issued", project_name: "Nolo 54K MM TI Spec TI",
    address: "216 Shannon Dr 2", applicant: "Joseph Larrea, Babcock Design", scope: "Provide 54,210 sqft warehouse with spec TI", valuation: 389388,
  });
  const act = R.parseActivityReport(H.activityReportPdf({ from: "2026-08-31", to: "2026-09-04", rows: [
    { number: "COM-05512-2026", issueDate: "2026-09-04", address: "1830 Caldwell Blvd Nampa, Id 83651", project: "Texas Roadhouse-Cooler Addition", scope: "Walk-in cooler addition",
      contacts: [{ roles: "Applicant", person: "Emily Bernahl", company: "Bernahl Development Services Llc" }, { roles: "Registered Building Contractor", person: "Al", company: "Roadhouse Builders" }] },
  ], residential: [{ number: "RES-1-2026", issueDate: "2026-09-01", address: "1 A St Nampa, Id 83686", project: "Pool", scope: "pool", contacts: [] }] }));
  assert.deepEqual(act, { from: "2026-08-31", to: "2026-09-04", rows: [{
    permit_number: "COM-05512-2026", issue_date: "2026-09-04", address: "1830 Caldwell Blvd, Nampa, ID 83651", project_name: "Texas Roadhouse-Cooler Addition",
    scope: "Walk-in cooler addition", valuation: 0, applicant_company: "Bernahl Development Services Llc", contractor_company: "Roadhouse Builders",
  }] });
});

test("pdf-text: strings, escapes, kerned runs and the ToUnicode map", () => {
  const [lit] = PT.parseValue("(a\\(b\\) c\\101 \\\\)", 0);
  assert.equal(lit.str, "a(b) cA \\");
  const [dict] = PT.parseValue("<< /Type /Page /Kids [1 0 R 2 0 R] /Name#20X (s) >>", 0);
  assert.deepEqual(dict.Kids, [{ ref: 1 }, { ref: 2 }]);
  assert.equal(dict.Type.name, "Page");
  assert.equal(dict["Name X"].str, "s");
  const cmap = PT.parseCMap("begincodespacerange <00> <FF> endcodespacerange beginbfchar <41> <0042> endbfchar beginbfrange <61> <63> <0078> endbfrange");
  assert.equal(cmap.map.get(0x41), "B");
  assert.deepEqual([0x61, 0x62, 0x63].map((c) => cmap.map.get(c)), ["x", "y", "z"]);
  const doc = PT.readPdf(H.tinyPdf([{ width: 300, height: 200, texts: [{ x: 10, top: 20, str: "Hello (world)" }, { x: 10, top: 40, str: "Two" }], vlines: [{ x: 50, top1: 10, top2: 150 }] }]));
  assert.deepEqual(doc.pages[0].items.map((i) => [i.x, i.top, i.str]), [[10, 20, "Hello (world)"], [10, 40, "Two"]]);
  assert.deepEqual(doc.pages[0].vlines, [{ x: 50, top1: 10, top2: 150 }]);
  assert.throws(() => PT.readPdf(Buffer.from("not a pdf")), /pdf-unsupported/);
});
