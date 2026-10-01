// test/permit-reports-run.test.js
// Nampa, swept from the reports the city publishes (2026-10-01), actually
// run: a real server.js against the stand-in PostgREST, with the Permit
// Reports page and its PDFs served through the test-only PERMIT_PORTAL_ORIGIN
// by test/helpers/nampa-reports.js — eight months of plan review reports and
// a weekly activity report, all dated relative to today.
//
// What this proves that permit-reports.test.js cannot: the weekday call reads
// the newest reports and stores their permits through the same table, key and
// market as a portal city; the history call backfills the older months once
// and then costs nothing; an issued permit's status moves on the day it was
// issued, never back; the market page draws Nampa's section from it, naming
// the reports; the tracker's feed shows Nampa's last covered month and says
// where it stops; and a Nampa permit still cannot be tracked by number.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const { startPortal } = require("./helpers/permit-portal-stub");
const N = require("./helpers/nampa-reports");
const SEED = require("../market-seed.json");

const DAY = 86400000;
const KEY = "admin-test-key";
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const MEMBER = { id: "5a1e9a1e-0000-4000-8000-00000000a7a1", email: "nampa@example.com", name: "Nampa Reader" };
const COOKIE = `cn_session=tok-${MEMBER.id}`;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// Month `back` months before this one, as { month, day(n), asOf }: its plan
// review report is dated the 3rd of the month after (never after today).
function monthBack(back, now = Date.now()) {
  const d = new Date(now);
  const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back + 1, 3);
  return { month: iso(first).slice(0, 7), day: (n) => iso(first + (n - 1) * DAY), asOf: iso(Math.min(next, now)) };
}

// One month's plan review report: two tenant build-outs and a new building
// kept; an intake failure, an occupancy-only move-in and an apartment building
// left out. Older months are partly issued; last month is all still in review.
function monthRows(back) {
  const m = monthBack(back);
  const n = (k) => `COM-${String(5000 + (12 - back) * 10 + k).padStart(5, "0")}-${m.month.slice(0, 4)}`;
  const old = back > 1;
  return {
    m,
    rows: [
      { number: n(1), dateIn: m.day(5), issueDate: old ? m.day(17) : null, status: old ? "Issued" : "In Review",
        project: `Suite ${back}01 TI`, address: `${100 + back} W Karcher Rd`, applicant: "Pat Lee, Acme Design", scope: "Tenant improvement for an office suite", valuation: 50000 },
      { number: n(2), dateIn: m.day(12), status: old ? "Corrections Pending" : "Approved - Ready to Issue",
        project: `Vanilla TI ${back}`, address: `${200 + back} N Franklin Blvd`, applicant: "Sam Ray, Ray Architects", scope: "Vanilla shell build out", valuation: 80000 },
      { number: n(3), dateIn: m.day(19), status: old ? "In Review" : "Pending",
        project: `Flex Building ${back}`, address: `${300 + back} E Amity Ave`, applicant: "Jo Kim, Kim Builders", scope: "Construct a new 12,000 sf metal warehouse building", valuation: 900000 },
      { number: n(4), dateIn: m.day(20), status: "Intake Failed", project: "Resubmitted TI", address: "1 Elm St", applicant: "x, y", scope: "Tenant improvement", valuation: 0 },
      { number: n(5), dateIn: m.day(21), status: "Approved - Ready to Issue", project: "Tacos", address: "2 Elm St", applicant: "x, y", scope: "Seeking occupancy only, no work", valuation: 0 },
      { number: n(6), dateIn: m.day(22), status: "In Review", project: "Elm 4-Plex BLDG 1", address: "3 Elm St", applicant: "x, y", scope: "4-Plex multifamily housing apartment building", valuation: 600000 },
    ],
    number: n,
  };
}

// Eight months of plan review reports, posted in order, then a weekly
// activity report that issues last month's first build-out.
function reports() {
  const state = N.nampaState();
  let id = 20000;
  const months = [];
  for (let back = 8; back >= 1; back--) {
    const { m, rows, number } = monthRows(back);
    months.push({ back, m, number });
    N.addReport(state, { id: ++id, kind: "plan", month: m.month }, N.planReportPdf({ asOf: m.asOf, rows }));
  }
  const last = months[months.length - 1];
  const from = iso(Date.now() - 6 * DAY), to = iso(Date.now() - 2 * DAY);
  N.addReport(state, { id: ++id, kind: "activity", from, to }, N.activityReportPdf({ from, to, rows: [
    { number: last.number(1), issueDate: iso(Date.now() - 3 * DAY), address: `101 W Karcher Rd Nampa, Id 83687`, project: "Suite 101 TI",
      scope: "Tenant improvement for an office suite",
      contacts: [{ roles: "Applicant", person: "Pat Lee", company: "Acme Design" }, { roles: "Registered Building Contractor", person: "Al", company: "Karcher Builders" }] },
    // Filed before the city's reports begin: counted, never stored.
    { number: "COM-04001-2025", issueDate: iso(Date.now() - 4 * DAY), address: "9 Old Rd Nampa, Id 83651", project: "Old", scope: "Tenant improvement", contacts: [] },
  ] }));
  return { state, months, nextId: () => ++id };
}

function marketPage(city) {
  const p = JSON.parse(JSON.stringify(SEED["industrial-dallas-tx"]));
  p.city = city; p.state = "ID";
  return { slug: `industrial-${city.toLowerCase()}-id`, payload: p };
}

const sweep = (base, body) => fetch(base + "/api/permits/sweep", {
  method: "POST", headers: { "content-type": "application/json", "x-admin-key": KEY }, body: JSON.stringify(body || {}),
}).then(async (r) => { const t = await r.text(); assert.equal(r.status, 200, t); return JSON.parse(t); });

async function settled(srv, path, needle, cookie) {
  for (let i = 0; i < 100; i++) {
    const r = await fetch(srv.base + path, { headers: cookie ? { cookie } : {} });
    if (r.ok) { const html = await r.text(); if (needle.test(html)) return html; }
    await new Promise((res) => setTimeout(res, 100));
  }
  const r = await fetch(srv.base + path, { headers: cookie ? { cookie } : {} });
  return r.text();
}

test("Nampa, read from its published reports: stored, backfilled once, issued on the day, shown and explained", async (t) => {
  const { state, months, nextId } = reports();
  const portal = await startPortal({ nampa: state });
  t.after(() => portal.stop());
  const db = await fake.start({ tables: {
    users: [{ ...MEMBER, pro_tester: true, vault_beta: false, digest_optout: false }],
    sessions: [{ token_hash: sha256("tok-" + MEMBER.id), user_id: MEMBER.id, expires_at: new Date(Date.now() + 365 * DAY).toISOString() }],
    subscriptions: [], orgs: [], org_members: [], comp_submissions: [], comp_corpus: [], analytics_events: [],
    market_pages: [marketPage("Nampa")],
    permit_filings: [], permit_filing_events: [], permit_watches: [], permit_watch_events: [], permit_watch_mutes: [], permit_alerts: [],
  } });
  t.after(() => db.stop());
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", ADMIN_KEY: KEY, SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    PERMIT_PORTAL_ORIGIN: portal.url, PERMIT_SWEEP_PAUSE_MS: "0",
    // Tracking is Pro (a tester here), so the refusal below is about the city.
    PRO_ENABLED: "on",
    // The locate step asks Census for Nampa's addresses; nobody answers here,
    // which it reports in summary.located and never as a city error.
    CENSUS_API_URL: "http://127.0.0.1:9/geocoder",
  });
  t.after(() => srv.stop());
  const nampaRows = () => db.tables.permit_filings.filter((r) => r.jurisdiction === "nampa");

  await t.test("the weekday call reads the newest reports and stores their permits like a portal city's", async (t) => {
    const s = await sweep(srv.base, {});
    assert.deepEqual(s.errors, []);
    const c = s.cities.nampa;
    assert.equal(c.reports, 6, "the newest six by upload: five plan review months and the weekly report");
    assert.equal(c.added, 15, "three kept permits a month for five months");
    assert.equal(c.intakeFailed, 5);
    assert.equal(c.otherWork, 10, "the occupancy-only move-in and the apartment building, each month");
    assert.equal(c.issuedUnfiled, 1, "a permit filed before the reports begin is counted, not stored");
    const rows = nampaRows();
    assert.equal(rows.length, 15);
    assert.ok(rows.every((r) => r.market === "Nampa, ID" && /^COM-\d{5}-\d{4}$/.test(r.permit_number)));
    assert.deepEqual([...new Set(rows.map((r) => r.permit_type))].sort(), ["New Commercial", "Tenant Improvement"]);
    assert.ok(rows.every((r) => /\/DocumentCenter\/View\/\d+\/Commercial-Permit---Plan-Review-Status/.test(r.source_url)),
      "each permit links the report it came from");
    const last = months[months.length - 1];
    const issued = rows.find((r) => r.permit_number === last.number(1));
    assert.equal(issued.status, "Issued", "the weekly report issued it after its plan review report's date");
    assert.equal(issued.status_changed_at, `${iso(Date.now() - 3 * DAY)}T18:00:00.000Z`, "the status is dated the day it was true");
    assert.equal(issued.address, "101 W Karcher Rd, Nampa, ID 83687");
    assert.equal(issued.contractor_company, "Karcher Builders");
    const review = rows.find((r) => r.permit_number === last.number(2));
    assert.equal(review.status, "Approved - Ready to Issue");
    assert.equal(review.status_changed_at, `${last.m.asOf}T18:00:00.000Z`, "a plan review status is dated the report's own date");
    assert.equal(review.applicant_company, "Ray Architects");
    assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));
  });

  await t.test("the history call backfills the older months once, then reads only the index", async (t) => {
    const s = await sweep(srv.base, { only: "history", history: "rotate" });
    assert.deepEqual(s.history.errors, []);
    assert.deepEqual(s.history.reports.nampa, { read: 9, added: 9, backfill: true });
    assert.equal(nampaRows().length, 24, "eight months of three");
    const hits = state.hits.length;
    const again = await sweep(srv.base, { only: "history", history: "rotate" });
    assert.deepEqual(again.history.reports.nampa, { read: 0, added: 0, backfill: false });
    assert.deepEqual(state.hits.slice(hits), ["/427/Permit-Reports"], "a filled table costs one request a day");
  });

  await t.test("a new weekly report moves a status on the day it was issued, and never back", async (t) => {
    const last = months[months.length - 1];
    const from = iso(Date.now() - 1 * DAY), to = iso(Date.now());
    N.addReport(state, { id: nextId(), kind: "activity", from, to }, N.activityReportPdf({ from, to, rows: [
      { number: last.number(2), issueDate: from, address: `${200 + 1} N Franklin Blvd Nampa, Id 83651`, project: "Vanilla TI 1", scope: "Vanilla shell build out", contacts: [] },
    ] }));
    const s = await sweep(srv.base, {});
    assert.deepEqual(s.errors, []);
    assert.equal(s.cities.nampa.added, 0, "nothing stored twice");
    assert.equal(s.cities.nampa.statusChanges, 1);
    const row = nampaRows().find((r) => r.permit_number === last.number(2));
    assert.equal(row.status, "Issued");
    const ev = db.tables.permit_filing_events.find((e) => e.filing_id === row.id);
    assert.deepEqual({ old: ev.old_status, now: ev.new_status, at: ev.detected_at },
      { old: "Approved - Ready to Issue", now: "Issued", at: `${from}T18:00:00.000Z` });
    // The older plan review reports are read again on the next run (they are
    // among the newest six): their "In Review" never walks the issue back.
    const again = await sweep(srv.base, {});
    assert.equal(again.cities.nampa.statusChanges, 0);
    assert.equal(nampaRows().find((r) => r.permit_number === last.number(1)).status, "Issued");
  });

  await t.test("the market page draws Nampa's section from its reports, and says so", async (t) => {
    const html = await settled(srv, "/market/industrial-nampa-id", /Building permits in Nampa/);
    assert.match(html, /<h2>Building permits in Nampa<\/h2>/);
    assert.match(html, /From the City of Nampa’s published permit reports, checked every weekday morning: /);
    assert.match(html, /They run about a month behind, and they carry no permit type, so build-outs and new buildings are read from each permit’s description\./);
    const last = months[months.length - 1].m.month;
    const name = new Date(last + "-15T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    assert.ok(html.includes(`through ${name}`), `the run ends at the last month the reports cover (${name})`);
    assert.doesNotMatch(html, /not yet in Nampa/);
  });

  await t.test("the tracker's feed shows Nampa's last covered month and says where it stops; Nampa is not trackable", async (t) => {
    const r = await fetch(srv.base + "/permits", { headers: { cookie: COOKIE } });
    const html = await r.text();
    const boot = JSON.parse(html.match(/var BOOT = (.*);\n/)[1]);
    assert.equal(boot.s, 200);
    // The newest kept permit is filed on the 19th, but the plan review report
    // is the whole month's intake: the coverage runs to the month's end.
    const m = monthBack(1).month;
    const monthEnd = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    assert.deepEqual(boot.j.reportCities, [{ city: "Nampa", through: monthEnd }]);
    assert.ok(boot.j.filings.some((f) => f.city === "Nampa"), "last month's permits are in the list, though older than thirty days ago may be");
    assert.equal(boot.j.cities, "Boise, Meridian and Nampa");
    assert.deepEqual(boot.mine.j.cities.map((c) => c.key), ["boise", "meridian"]);
    assert.ok(html.includes("permits come from the city’s published reports, which run about a month behind"), "the page carries the note");
    const add = await fetch(srv.base + "/api/permits/watch", {
      method: "POST", headers: { "content-type": "application/json", cookie: COOKIE },
      body: JSON.stringify({ jurisdiction: "nampa", permitNumber: months[0].number(1) }),
    });
    assert.equal(add.status, 400);
    assert.match((await add.json()).error, /Pick the city that issued the permit: Boise or Meridian\./);
  });
});

test("a Permit Reports page the city takes down is Nampa's error line, and the other cities still sweep", async (t) => {
  const state = N.quietNampa();
  state.indexStatus = 503;
  const portal = await startPortal({ nampa: state });
  t.after(() => portal.stop());
  const db = await fake.start({ tables: { permit_filings: [], permit_filing_events: [], analytics_events: [], permit_watches: [], permit_watch_events: [], permit_alerts: [] } });
  t.after(() => db.stop());
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", ADMIN_KEY: KEY, SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    PERMIT_PORTAL_ORIGIN: portal.url, PERMIT_SWEEP_PAUSE_MS: "0", CENSUS_API_URL: "http://127.0.0.1:9/geocoder",
  });
  t.after(() => srv.stop());
  const s = await sweep(srv.base, {});
  assert.deepEqual(s.errors, ["nampa: portal-error: Nampa's Permit Reports page returned 503"],
    "loud, so the scheduled job fails rather than reading as a quiet week");
  assert.ok(s.cities.boise && s.cities.meridian, "Boise and Meridian still ran");
});
