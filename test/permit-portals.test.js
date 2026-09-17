// test/permit-portals.test.js
// The city permit portal clients, replayed against responses captured from
// the LIVE Boise and Meridian portals on 2026-09-16 by
// scripts/capture-permit-fixtures.js (gzipped under test/fixtures/
// permit-portals/). The parsers were written against markup somebody saw on a
// given day; a fresh capture that fails here names the selector that moved,
// which is the whole point of pinning them to real pages rather than to
// hand-typed HTML.
//
// Nampa (EnerGov) has no live capture: the portal answered 403 to a
// non-browser user agent that day (see the registry entry), so its parsers
// are pinned to a synthetic fixture shaped from the field names the tracker
// verified live on 2026-07-28..08-10.
//
// Spec: docs/superpowers/specs/2026-09-16-permit-signals-design.md

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const P = require("../permit-portals");

const FIX = path.join(__dirname, "fixtures", "permit-portals");
const readGz = (f) => zlib.gunzipSync(fs.readFileSync(path.join(FIX, f))).toString("utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(FIX, "manifest.json"), "utf8"));

// A scripted fetch: `script` is an array of responders tried in order; the
// first whose `when(url, init)` matches answers. Every call is logged.
function scriptedFetch(script) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || "GET", init });
    const hit = script.find((s) => s.when(String(url), init || {}));
    if (!hit) throw new Error(`unscripted fetch: ${(init && init.method) || "GET"} ${url}`);
    const body = typeof hit.body === "function" ? hit.body(String(url), init || {}) : hit.body;
    return {
      ok: (hit.status || 200) < 400, status: hit.status || 200, url: hit.finalUrl || String(url),
      headers: { getSetCookie: () => hit.cookies || [] },
      text: async () => body, json: async () => JSON.parse(body),
    };
  };
  fn.calls = calls;
  return fn;
}

const formField = (init, name) => new URLSearchParams(init.body).get(name);

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test("registry: three Idaho cities, two platforms, and only the two Accela cities are swept today", () => {
  assert.deepEqual(P.JURISDICTION_KEYS, ["boise", "meridian", "nampa"]);
  assert.deepEqual(P.SWEEP_KEYS, ["boise", "meridian"]);
  assert.equal(P.JURISDICTIONS.nampa.sweep, false);
  assert.match(P.JURISDICTIONS.nampa.blocked, /403/);
  for (const k of P.JURISDICTION_KEYS) {
    const j = P.JURISDICTIONS[k];
    assert.equal(j.key, k);
    assert.equal(j.state, "ID");
    assert.ok(/^https:\/\//.test(j.base) && /^https:\/\//.test(j.portalUrl), k);
    assert.equal(P.marketLabel(j), `${j.label}, ID`);
  }
  assert.equal(P.getJurisdiction("BOISE"), P.JURISDICTIONS.boise);
  assert.equal(P.getJurisdiction("tulsa"), null);
});

test("withOrigin re-points the base and only the base, keeping the path (the test-only redirect)", () => {
  const j = P.withOrigin(P.JURISDICTIONS.boise, "http://127.0.0.1:4321/");
  assert.equal(j.base, "http://127.0.0.1:4321/CitizenAccess");
  assert.equal(j.portalUrl, P.JURISDICTIONS.boise.portalUrl, "the display URL is untouched");
  assert.equal(P.withOrigin(P.JURISDICTIONS.boise, ""), P.JURISDICTIONS.boise);
  assert.equal(P.accelaSearchUrl(j), "http://127.0.0.1:4321/CitizenAccess/Cap/CapHome.aspx?module=Building&TabName=Building");
});

test("the fixture manifest records a capture the parsers below are actually pinned to", () => {
  assert.equal(manifest.window.to, "2026-09-16", "Boise-local; the UTC capture stamp is past midnight");
  assert.equal(manifest.cities.boise.rows, 16);
  assert.equal(manifest.cities.meridian.rows, 13);
  assert.match(manifest.cities.nampa.errors[0], /403/);
});

// ---------------------------------------------------------------------------
// Accela parsers on the live captures
// ---------------------------------------------------------------------------

test("harvestForm reads every replayable field off the Boise search page, VIEWSTATE included", () => {
  const fields = P.harvestForm(readGz("boise.search.html.gz"));
  assert.ok(Object.keys(fields).length > 20, "the whole form, not a handful");
  assert.equal(fields.__VIEWSTATE, "FIXTURE-VIEWSTATE", "the capture shortens it; the parser needs it present");
  assert.ok("ctl00$PlaceHolderMain$generalSearchForm$txtGSPermitNumber" in fields);
  assert.ok("ctl00$PlaceHolderMain$generalSearchForm$ddlGSPermitType" in fields, "the type dropdown is a select");
  for (const [name] of Object.entries(fields)) {
    assert.doesNotMatch(name, /btnNewSearch$/, "submit buttons are not replayed");
  }
});

test("harvestForm: unchecked boxes are left out, checked ones and selected options are kept", () => {
  const html = `<form>
    <input type="hidden" name="__VIEWSTATE" value="vs" />
    <input type="checkbox" name="a" value="1" />
    <input type="checkbox" name="b" value="2" checked />
    <input type="submit" name="go" value="Go" />
    <select name="s"><option value="x">x</option><option value="y" selected>y</option></select>
    <select name="t"><option value="first">f</option><option value="second">s</option></select>
  </form>`;
  assert.deepEqual(P.harvestForm(html), { __VIEWSTATE: "vs", b: "2", s: "y", t: "first" });
});

test("parseAccelaGrid reads Boise's tenant-improvement grid: 11 rows with number, status, address, date and a detail link", () => {
  const rows = P.parseAccelaGrid(readGz("boise.tenant-improvement.results.html.gz"), P.JURISDICTIONS.boise.base);
  assert.equal(rows.length, 11);
  for (const r of rows) {
    assert.match(r.permit_number, /^BLD26-\d{5}$/, r.permit_number);
    assert.ok(r.status, "status is read off the grid");
    assert.match(r.applied_date, /^2026-09-\d{2}$/);
    assert.match(r.ref.detailUrl, /^https:\/\/permits\.cityofboise\.org\/CitizenAccess\/Cap\/CapDetail\.aspx\?/);
    assert.match(r.address, /, /, "the grid prints street, city and zip");
  }
});

test("parseAccelaGrid reads Meridian's grid, whose ids are the same and whose address format has no zip on some rows", () => {
  const rows = P.parseAccelaGrid(readGz("meridian.new-commercial.results.html.gz"), P.JURISDICTIONS.meridian.base);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.permit_number), ["C-NEW-2026-0052", "C-NEW-2026-0051"]);
  assert.equal(rows[1].project_name, "7Brew Coffee");
  assert.equal(rows[1].address, "3570 E FAIRVIEW AVE, MERIDIAN ID 83642");
});

test("an exact hit redirects to the detail page, and parseAccelaDetail reads it — asterisk dropped, city rejoined with a comma", () => {
  const boise = P.parseAccelaDetail(readGz("boise.commercial-modular.results.html.gz"), "u");
  assert.equal(boise.permit_number, "BLD26-02710");
  assert.equal(boise.status, "Prescreen");
  assert.equal(boise.address, "3845 E MEMORY RD, BOISE ID", "street then city, comma-joined like the grid prints it");
  assert.match(boise.description, /Wet Modular at Micron/);
  const meridian = P.parseAccelaDetail(readGz("meridian.commercial-shell-only.results.html.gz"), "u");
  assert.equal(meridian.permit_number, "C-SHELL-2026-0029");
  assert.equal(meridian.address, "3468 CENTREPOINT", "the portal's blue footnote asterisk is not part of the address");
  assert.equal(meridian.status, "In Progress");
  assert.equal(P.parseParcelNumber(readGz("meridian.commercial-shell-only.results.html.gz")), "R1343770152");
});

test("stripFootnote / detailAddress edge cases", () => {
  assert.equal(P.stripFootnote("  3468 CENTREPOINT *  "), "3468 CENTREPOINT");
  assert.equal(P.stripFootnote("A * B"), "A * B", "only a TRAILING asterisk is a footnote");
  assert.equal(P.detailAddress("<div>no address block</div>"), "");
  assert.equal(P.detailAddress(`<span id="x_label_address1"></span><table><tr><td class='td_child_left'></td><td>plain text only</td></tr></table>`), "plain text only");
});

test("parseAccelaCompanies: Boise's classed applicant span, and Meridian's plain-text Licensed Professional block", () => {
  const boise = P.parseAccelaCompanies(readGz("boise.detail.html.gz"));
  assert.deepEqual(boise, { applicant_company: "Micron Technology Inc", parcel_number: "S1607212409" });
  const meridian = P.parseAccelaCompanies(readGz("meridian.detail.html.gz"));
  assert.equal(meridian.applicant_company, "Brandon Byington", "no business name -> the person");
  assert.equal(meridian.contractor_company, "KREIZENBECK LLC DBA KREIZENBECK CONSTRUCTORS", "the line after the email");
  assert.equal(meridian.parcel_number, "S0436449775");
  assert.deepEqual(P.parseAccelaCompanies("<html></html>"), {});
});

test("parseAccelaStatus: detail page, no-results line, a grid with our number, a grid without it, and a redesign", () => {
  assert.deepEqual(P.parseAccelaStatus(readGz("boise.detail.html.gz"), "BLD26-02789"), { found: true, status: "Applicant Upload" });
  assert.deepEqual(P.parseAccelaStatus(readGz("boise.rack-shelving.results.html.gz"), "X"), { found: false });
  const grid = readGz("boise.tenant-improvement.results.html.gz");
  const first = P.parseAccelaGrid(grid, "")[0];
  assert.deepEqual(P.parseAccelaStatus(grid, first.permit_number.toLowerCase()), { found: true, status: first.status });
  assert.deepEqual(P.parseAccelaStatus(grid, "BLD00-00000"), { found: false });
  assert.throws(() => P.parseAccelaStatus("<html><body>maintenance</body></html>", "X"), /portal-changed/);
});

test("nextPageTarget: Meridian's 10-row grid has a Next link, Boise's 11-row grid does not, a bare pager table does not", () => {
  assert.equal(P.nextPageTarget(readGz("meridian.tenant-improvement.results.html.gz")),
    "ctl00$PlaceHolderMain$dgvPermitList$gdvPermitList$ctl13$ctl04");
  assert.equal(P.nextPageTarget(readGz("boise.tenant-improvement.results.html.gz")), "");
  // The pagination table renders on a single page too — with a "1" and no
  // anchor — so its presence must not read as truncation.
  const onePage = `<table class="aca_pagination"><tr><td class="aca_pagination_td"><span class="SelectedPageButton">1</span></td>
    <td class="aca_pagination_td aca_pagination_PrevNext"><span class="aca_simple_text">Next &gt;</span></td></tr></table>`;
  assert.equal(P.nextPageTarget(onePage), "");
});

test("date helpers", () => {
  assert.equal(P.usToIsoDate("09/16/2026"), "2026-09-16");
  assert.equal(P.usToIsoDate("9/16/2026"), "", "the grid prints two-digit fields; anything else is unknown");
  assert.equal(P.isoToUsDate("2026-09-16"), "09/16/2026");
  assert.equal(P.isoToUsDate("nope"), "");
});

// ---------------------------------------------------------------------------
// Accela discovery, end to end against the captures
// ---------------------------------------------------------------------------

// Serve the captured pages the way the portal did: the search page on GET,
// each type's result page on the POST that names that type, and — for the
// Meridian tenant-improvement pager — a synthetic page 2 (the same grid with
// its Next link removed and its numbers re-suffixed) on the Next postback.
function accelaScript(city) {
  const j = P.JURISDICTIONS[city];
  const results = manifest.cities[city].results;
  const bySlug = {};
  for (const t of j.discovery.types) {
    const slug = t.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    bySlug[t.value] = { slug, html: readGz(`${city}.${slug}.results.html.gz`), finalUrl: results[slug].finalUrl };
  }
  const page2 = (html) => html
    .replace(/<a class="aca_simple_text font11px" href="javascript:__doPostBack\(&#39;[^&]+&#39;,&#39;&#39;\)">Next &gt;<\/a>/, "<span>Next &gt;</span>")
    .replace(/(lblPermitNumber1"[^>]*>)([^<]*)</g, (m, a, num) => `${a}${num}-P2<`);
  return [
    { when: (u, i) => i.method !== "POST" && /CapHome\.aspx/.test(u), body: readGz(`${city}.search.html.gz`), cookies: ["ASP.NET_SessionId=abc; path=/"] },
    { when: (u, i) => i.method === "POST" && /Page\$|gdvPermitList\$ctl13\$ctl04/.test(formField(i, "__EVENTTARGET") || ""),
      body: (u, i) => page2(bySlug[formField(i, "ctl00$PlaceHolderMain$generalSearchForm$ddlGSPermitType")].html) },
    { when: (u, i) => i.method === "POST" && bySlug[formField(i, "ctl00$PlaceHolderMain$generalSearchForm$ddlGSPermitType")],
      body: (u, i) => bySlug[formField(i, "ctl00$PlaceHolderMain$generalSearchForm$ddlGSPermitType")].html,
      finalUrl: undefined },
  ];
}

// finalUrl varies per type, so the third responder above cannot carry one;
// wrap the scripted fetch to answer it from the manifest.
function accelaFetch(city) {
  const j = P.JURISDICTIONS[city];
  const results = manifest.cities[city].results;
  const inner = scriptedFetch(accelaScript(city));
  const f = async (url, init) => {
    const res = await inner(url, init);
    if (init && init.method === "POST") {
      const type = formField(init, "ctl00$PlaceHolderMain$generalSearchForm$ddlGSPermitType");
      const t = j.discovery.types.find((x) => x.value === type);
      const slug = t && t.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      if (slug && results[slug] && !/ctl13\$ctl04/.test(formField(init, "__EVENTTARGET") || "")) res.url = results[slug].finalUrl;
    }
    return res;
  };
  f.calls = inner.calls;
  return f;
}

test("discoverAccela(boise): four type searches, 16 unique rows, the exact hit read off its detail page, no pager", async () => {
  const fetch = accelaFetch("boise");
  let slept = 0;
  const { rows, truncated } = await P.discoverAccela({ from: "2026-09-09", to: "2026-09-16" }, P.JURISDICTIONS.boise, { fetch, sleep: async () => { slept += 1; } });
  assert.equal(truncated, false);
  assert.equal(rows.length, manifest.cities.boise.rows);
  const posts = fetch.calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 4, "one POST per configured type");
  assert.equal(slept, 3, "a pause between type searches, none before the first");
  // The whole form is replayed with the date window and type set.
  const first = posts[0].init;
  assert.equal(formField(first, "ctl00$PlaceHolderMain$generalSearchForm$txtGSStartDate"), "09/09/2026");
  assert.equal(formField(first, "ctl00$PlaceHolderMain$generalSearchForm$txtGSEndDate"), "09/16/2026");
  assert.equal(formField(first, "__EVENTTARGET"), "ctl00$PlaceHolderMain$btnNewSearch");
  assert.equal(formField(first, "__VIEWSTATE"), "FIXTURE-VIEWSTATE");
  assert.match(posts[0].init.headers.Cookie, /ASP\.NET_SessionId=abc/, "the session cookie rides the postback");
  const modular = rows.find((r) => r.permit_type === "Commercial Modular");
  assert.equal(modular.permit_number, "BLD26-02710", "the single exact hit came from the detail redirect");
  assert.equal(modular.address, "3845 E MEMORY RD, BOISE ID");
  assert.equal(rows.filter((r) => r.permit_type === "Tenant Improvement").length, 11);
  assert.equal(new Set(rows.map((r) => r.permit_number)).size, rows.length, "deduped on number");
});

test("discoverAccela(meridian): follows the tenant-improvement pager once, replaying the RESULT page's form", async () => {
  const fetch = accelaFetch("meridian");
  const { rows, truncated } = await P.discoverAccela({ from: "2026-09-09", to: "2026-09-16" }, P.JURISDICTIONS.meridian, { fetch });
  assert.equal(truncated, false, "the synthetic page 2 has no Next, so the pager was exhausted");
  const ti = rows.filter((r) => r.permit_type === "Tenant Improvement");
  assert.equal(ti.length, 20, "10 on page 1 + 10 on page 2");
  assert.equal(ti.filter((r) => /-P2$/.test(r.permit_number)).length, 10);
  const pager = fetch.calls.find((c) => /ctl13\$ctl04/.test(formField(c.init, "__EVENTTARGET") || ""));
  assert.ok(pager, "the Next postback was sent");
  assert.equal(formField(pager.init, "__EVENTARGUMENT"), "");
  assert.equal(rows.length, manifest.cities.meridian.rows + 10);
});

test("discoverAccela stops at MAX_PAGES and reports truncated when the pager never ends", async () => {
  const grid = readGz("meridian.tenant-improvement.results.html.gz");
  const j = { ...P.JURISDICTIONS.meridian, discovery: { types: [P.JURISDICTIONS.meridian.discovery.types[2]] } };
  let n = 0;
  const fetch = scriptedFetch([
    { when: (u, i) => i.method !== "POST", body: readGz("meridian.search.html.gz") },
    { when: () => true, body: () => { n += 1; return grid.replace(/(lblPermitNumber1"[^>]*>)([^<]*)</g, (m, a, num) => `${a}${num}-${n}<`); } },
  ]);
  const { rows, truncated } = await P.discoverAccela({ from: "2026-09-09", to: "2026-09-16" }, j, { fetch });
  assert.equal(truncated, true);
  assert.equal(rows.length, 10 * P.MAX_PAGES);
});

test("discoverAccela: a re-rendered empty search form is zero results (Meridian's quirk), a page that lost the form is a redesign", async () => {
  const j = { ...P.JURISDICTIONS.meridian, discovery: { types: [P.JURISDICTIONS.meridian.discovery.types[0]] } };
  const search = readGz("meridian.search.html.gz");
  const quiet = scriptedFetch([{ when: () => true, body: search }]);
  const out = await P.discoverAccela({ from: "2026-09-09", to: "2026-09-16" }, j, { fetch: quiet });
  assert.deepEqual(out, { rows: [], truncated: false });
  const broken = scriptedFetch([
    { when: (u, i) => i.method !== "POST", body: search },
    { when: () => true, body: "<html><body>Under maintenance</body></html>" },
  ]);
  await assert.rejects(P.discoverAccela({ from: "2026-09-09", to: "2026-09-16" }, j, { fetch: broken }), /portal-changed/);
});

test("discoverAccela: a search page with no VIEWSTATE, a non-200, and an Error.aspx landing are all named failures", async () => {
  const j = { ...P.JURISDICTIONS.boise, discovery: { types: [P.JURISDICTIONS.boise.discovery.types[0]] } };
  await assert.rejects(P.discoverAccela({ from: "a", to: "b" }, j, { fetch: scriptedFetch([{ when: () => true, body: "<html><form></form></html>" }]) }), /no __VIEWSTATE/);
  await assert.rejects(P.discoverAccela({ from: "a", to: "b" }, j, { fetch: scriptedFetch([{ when: () => true, status: 503, body: "" }]) }), /search page returned 503/);
  const err = scriptedFetch([
    { when: (u, i) => i.method !== "POST", body: readGz("boise.search.html.gz") },
    { when: () => true, body: "", finalUrl: "https://permits.cityofboise.org/CitizenAccess/Error.aspx" },
  ]);
  await assert.rejects(P.discoverAccela({ from: "a", to: "b" }, j, { fetch: err }), /Error\.aspx/);
});

test("fetchAccelaCompanies never throws and enrichFiling routes to it for an Accela city", async () => {
  const detail = readGz("meridian.detail.html.gz");
  const ok = scriptedFetch([{ when: () => true, body: detail }]);
  assert.equal((await P.enrichFiling("meridian", { detailUrl: "https://x/CapDetail.aspx" }, { fetch: ok })).contractor_company,
    "KREIZENBECK LLC DBA KREIZENBECK CONSTRUCTORS");
  const boom = async () => { throw new Error("reset"); };
  assert.deepEqual(await P.enrichFiling("meridian", { detailUrl: "https://x" }, { fetch: boom }), {});
  assert.deepEqual(await P.enrichFiling("meridian", null, { fetch: boom }), {});
  assert.deepEqual(await P.enrichFiling("nowhere", { detailUrl: "https://x" }, { fetch: boom }), {});
});

test("fetchFilingStatus(boise) replays the number search and reads the detail page; unknown cities throw", async () => {
  const fetch = scriptedFetch([
    { when: (u, i) => i.method !== "POST", body: readGz("boise.search.html.gz") },
    { when: () => true, body: readGz("boise.detail.html.gz"), finalUrl: "https://permits.cityofboise.org/CitizenAccess/Cap/CapDetail.aspx?x" },
  ]);
  assert.deepEqual(await P.fetchFilingStatus("boise", "BLD26-02789", { fetch }), { found: true, status: "Applicant Upload" });
  const post = fetch.calls.find((c) => c.method === "POST");
  assert.equal(formField(post.init, "ctl00$PlaceHolderMain$generalSearchForm$txtGSPermitNumber"), "BLD26-02789");
  await assert.rejects(P.fetchFilingStatus("tulsa", "X", { fetch }), /unknown jurisdiction/);
});

// ---------------------------------------------------------------------------
// EnerGov (Nampa) — synthetic fixture, shaped from the tracker's verified fields
// ---------------------------------------------------------------------------

const ENERGOV_SEARCH = {
  Result: {
    TotalPages: 1,
    EntityResults: [
      { CaseId: "c-1", CaseNumber: "COM-05103-2025 ", CaseType: "Commercial New Building Shell", CaseWorkclass: "New", CaseStatus: "Issued",
        Description: "", ProjectName: "Nampa Logistics 3", AddressDisplay: "2222 E KARCHER RD", ApplyDate: "2026-09-12T00:00:00" },
      { CaseId: "c-2", CaseNumber: "COM-05104-2025", CaseType: "Certificate of Completion - Commercial", CaseWorkclass: "", CaseStatus: "Complete",
        Description: "", ProjectName: "", AddressDisplay: "1 MAIN ST", ApplyDate: "2026-09-12T00:00:00" },
      { CaseId: "c-3", CaseNumber: "RES-0001-2025", CaseType: "Residential Addition", CaseWorkclass: "", CaseStatus: "Issued",
        Description: "", ProjectName: "", AddressDisplay: "9 ELM", ApplyDate: "2026-09-12T00:00:00" },
      { CaseId: "c-4", CaseNumber: "ELE-18509-2022", CaseType: "Electrical Commercial", CaseWorkclass: "", CaseStatus: "Issued",
        Description: "", ProjectName: "", AddressDisplay: "9 ELM", ApplyDate: "2026-09-12T00:00:00" },
      { CaseId: "c-5", CaseNumber: "COM-05105-2025", CaseType: "Commercial Tenant Improvement (Certificate of Completion)", CaseWorkclass: "Alteration", CaseStatus: "In Review",
        Description: "TI for dental office", ProjectName: "", AddressDisplay: "300 11TH AVE N", ApplyDate: "2026-09-14T00:00:00" },
    ],
  },
};
const ENERGOV_CONTACTS = { Result: [
  { ContactTypeName: "Applicant", GlobalEntityName: "", FirstName: "Dana", LastName: "Lee" },
  { ContactTypeName: "Contractor", GlobalEntityName: "Idaho Builders LLC" },
  { ContactTypeName: "Contractor", GlobalEntityName: "Second Co" },
] };
const ENERGOV_PERMIT = { Result: { Description: "New 120,000 SF distribution shell", ProjectName: "Nampa Logistics 3" } };

test("energovSearchBody keeps the SPA's verbatim shape: keyword mode 1, permits-only filter, string sentinels", () => {
  const b = P.energovSearchBody("COM-1");
  assert.equal(b.SearchModule, 1);
  assert.equal(b.FilterModule, 2);
  assert.equal(b.PermitCriteria.PermitTypeId, "none");
  assert.equal(b.PermitCriteria.PermitStatusId, "none");
  assert.equal(b.PageSize, 10);
  assert.equal(P.energovHeaders(P.JURISDICTIONS.nampa)["Tyler-TenantUrl"], "NampaIDProd");
  assert.equal(P.energovHeaders(P.JURISDICTIONS.nampa).tenantId, "1");
});

test("keepEnergovRow: commercial in, closeouts / residential / trade permits out, anchors respected", () => {
  const rows = P.parseEnergovSearchRows(ENERGOV_SEARCH.Result);
  assert.deepEqual(rows.filter(P.keepEnergovRow).map((r) => r.permit_number), ["COM-05103-2025", "COM-05105-2025"]);
  assert.equal(rows[0].permit_number, "COM-05103-2025", "space-padded numbers are trimmed");
  assert.equal(rows[0].status, "Issued");
  assert.equal(rows[0].applied_date, "2026-09-12");
});

test("discoverFilings(nampa) pages, filters, and enrichFiling merges contacts with the detail description", async () => {
  const j = P.JURISDICTIONS.nampa;
  const fetch = scriptedFetch([
    { when: (u) => u.endsWith(P.ENERGOV_SEARCH_PATH), body: JSON.stringify(ENERGOV_SEARCH) },
    { when: (u) => u.endsWith(P.ENERGOV_CONTACTS_PATH), body: JSON.stringify(ENERGOV_CONTACTS) },
    { when: (u) => u.includes(P.ENERGOV_PERMIT_PATH), body: JSON.stringify(ENERGOV_PERMIT) },
  ]);
  const { rows, truncated } = await P.discoverFilings("nampa", { from: "2026-09-09", to: "2026-09-16" }, { fetch });
  assert.equal(truncated, false);
  assert.deepEqual(rows.map((r) => r.permit_number), ["COM-05103-2025", "COM-05105-2025"]);
  const body = JSON.parse(fetch.calls[0].init.body);
  assert.equal(body.SearchModule, 2, "criteria search, not keyword search");
  assert.equal(body.PermitCriteria.ApplyDateFrom, "2026-09-09T00:00:00.000Z");
  assert.equal(body.PermitCriteria.PageSize, 100);
  assert.equal(fetch.calls[0].init.headers.tenantName, "NampaIDProd");
  const e = await P.enrichFiling("nampa", rows[0].ref, { fetch });
  assert.deepEqual(e, { description: "New 120,000 SF distribution shell", project_name: "Nampa Logistics 3",
    applicant_company: "Dana Lee", contractor_company: "Idaho Builders LLC" });
  assert.equal(j.sweep, false, "and none of this runs in a sweep until the 403 is resolved");
});

test("fetchFilingStatus(nampa): only the exact trimmed number counts; a missing EntityResults is a redesign", async () => {
  const fetch = scriptedFetch([{ when: () => true, body: JSON.stringify(ENERGOV_SEARCH) }]);
  assert.deepEqual(await P.fetchFilingStatus("nampa", "com-05103-2025", { fetch }), { found: true, status: "Issued" });
  assert.deepEqual(await P.fetchFilingStatus("nampa", "05103", { fetch }), { found: false });
  const odd = scriptedFetch([{ when: () => true, body: JSON.stringify({ Result: {} }) }]);
  await assert.rejects(P.fetchFilingStatus("nampa", "X", { fetch: odd }), /portal-changed/);
  const down = scriptedFetch([{ when: () => true, status: 403, body: "<html>403 Forbidden</html>" }]);
  await assert.rejects(P.fetchFilingStatus("nampa", "X", { fetch: down }), /returned 403/);
});

test("flagIndustrial: the keyword fallback, word-bounded", () => {
  assert.equal(P.flagIndustrial({ description: "New warehouse shell" }), true);
  assert.equal(P.flagIndustrial({ project_name: "Flex building B" }), true);
  assert.equal(P.flagIndustrial({ description: "Dental office TI" }), false);
  assert.equal(P.flagIndustrial({ description: "Shellfish restaurant" }), false, "word boundary");
  assert.equal(P.flagIndustrial({}), false);
});
