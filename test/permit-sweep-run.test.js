// test/permit-sweep-run.test.js
// The permit sweep, actually run: a real server.js against the fake PostgREST
// and a stub standing in for the Boise and Meridian portals AND the Ada County
// parcel layer, all on one origin through the test-only PERMIT_PORTAL_ORIGIN
// (the RESEND_API_URL / CENSUS_API_URL precedent). The stub serves the pages
// captured from the live portals on 2026-09-16, so what this proves is the
// whole path from those bytes to rows in permit_filings — the gate, the dry
// run, the dedupe, the enrichment, the zoning verdict, the status event —
// none of which the unit suites can reach.
//
// Spec: docs/superpowers/specs/2026-09-16-permit-signals-design.md (§3, §5)

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const P = require("../permit-portals");

const FIX = path.join(__dirname, "fixtures", "permit-portals");
const readGz = (f) => zlib.gunzipSync(fs.readFileSync(path.join(FIX, f))).toString("utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(FIX, "manifest.json"), "utf8"));
const slugOf = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const KEY = "admin-test-key";

// Meridian's tenant-improvement grid really did have a second page; the stub
// answers the Next postback with the same grid, numbers re-suffixed and the
// Next link gone, so the pager is followed exactly once.
const page2 = (html) => html
  .replace(/<a class="aca_simple_text font11px" href="javascript:__doPostBack\(&#39;[^&]+&#39;,&#39;&#39;\)">Next &gt;<\/a>/, "<span>Next &gt;</span>")
  .replace(/(lblPermitNumber1"[^>]*>)([^<]*)</g, (m, a, num) => `${a}${num}-P2<`);

// One origin, three services. Paths are the real portals' paths because
// withOrigin() keeps them.
function startPortal() {
  const hits = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      hits.push({ method: req.method, path: url.pathname, body });
      const html = (s) => { res.writeHead(200, { "content-type": "text/html" }); res.end(s); };
      if (/Ada_County_Parcels\/FeatureServer\/142\/query$/.test(url.pathname)) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(readGz("ada.parcel.json.gz"));
      }
      const city = url.pathname.startsWith("/CitizenAccess/") ? "boise"
        : url.pathname.startsWith("/MERIDIAN/") ? "meridian" : null;
      if (!city) { res.writeHead(404); return res.end("no such portal"); }
      const root = city === "boise" ? "/CitizenAccess" : "/MERIDIAN";
      if (/CapDetail\.aspx$/.test(url.pathname)) {
        const which = url.searchParams.get("fixture");
        return html(which ? readGz(`${city}.${which}.results.html.gz`) : readGz(`${city}.detail.html.gz`));
      }
      if (/CapHome\.aspx$/.test(url.pathname)) {
        if (req.method === "GET") return html(readGz(`${city}.search.html.gz`));
        const form = new URLSearchParams(body);
        const type = form.get("ctl00$PlaceHolderMain$generalSearchForm$ddlGSPermitType");
        const t = P.JURISDICTIONS[city].discovery.types.find((x) => x.value === type);
        if (!t) { res.writeHead(500); return res.end("unknown type " + type); }
        const page = readGz(`${city}.${slugOf(t.label)}.results.html.gz`);
        if (/ctl13\$ctl04/.test(form.get("__EVENTTARGET") || "")) return html(page2(page));
        // A single exact hit: the real portal 302s to the record's detail
        // page, and fetch follows, so res.url is the CapDetail URL.
        if (/lblRecordStatus"/.test(page)) {
          res.writeHead(302, { location: `${root}/Cap/CapDetail.aspx?fixture=${slugOf(t.label)}` });
          return res.end();
        }
        return html(page);
      }
      res.writeHead(404); res.end("no route");
    });
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${srv.address().port}`,
    hits,
    stop: () => new Promise((r) => srv.close(r)),
  })));
}

const sweep = (base, body, key = KEY) => fetch(base + "/api/permits/sweep", {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-key": key },
  body: JSON.stringify(body || {}),
});

const EXPECTED = manifest.cities.boise.rows + manifest.cities.meridian.rows + 10; // + the synthetic page 2

test("the route does not exist without ADMIN_KEY, and refuses a wrong key", async (t) => {
  const dark = await shared.boot({ ACCOUNT_WALL: "off" });
  t.after(() => dark.stop());
  const r = await sweep(dark.base, {});
  assert.equal(r.status, 404);

  const lit = await shared.boot({ ACCOUNT_WALL: "off", ADMIN_KEY: KEY });
  t.after(() => lit.stop());
  const bad = await sweep(lit.base, {}, "wrong");
  assert.equal(bad.status, 401);
});

test("without a database a real sweep is refused (503) but a dry run still reads the portals and writes nothing", async (t) => {
  const portal = await startPortal();
  t.after(() => portal.stop());
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", ADMIN_KEY: KEY,
    PERMIT_PORTAL_ORIGIN: portal.url, PERMIT_SWEEP_PAUSE_MS: "0",
  });
  t.after(() => srv.stop());
  const refused = await sweep(srv.base, {});
  assert.equal(refused.status, 503);
  assert.match((await refused.json()).error, /needs a database/);

  const r = await sweep(srv.base, { dryRun: true, days: 7 });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  const s = JSON.parse(text);
  assert.equal(s.dryRun, true);
  assert.equal(s.discovered, EXPECTED);
  assert.equal(s.added, EXPECTED, "with no table everything is new");
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.truncated, []);
  assert.deepEqual(s.skipped, [{ city: "nampa", reason: P.JURISDICTIONS.nampa.blocked }]);
  assert.ok(portal.hits.some((h) => h.method === "POST" && h.path === "/MERIDIAN/Cap/CapHome.aspx"), "Meridian was searched");
  assert.ok(portal.hits.every((h) => !/Ada_County/.test(h.path) || h.method === "GET"));
  const micron = s.cities.boise.sample.find((x) => x.permit_number === "BLD26-02789");
  assert.ok(micron, "the dry run's sample carries a real, enriched row");
  assert.equal(micron.applicant_company, "Micron Technology Inc");
  assert.equal(micron.zoning, "I-3");
  assert.equal(micron.is_industrial, true);
});

test("a real sweep stores every filing once, enriched and zoned; a second sweep adds nothing; a status change is an event", async (t) => {
  const portal = await startPortal();
  t.after(() => portal.stop());
  const db = await fake.start({ tables: { permit_filings: [], permit_filing_events: [], analytics_events: [] } });
  t.after(() => db.stop());
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", ADMIN_KEY: KEY,
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    PERMIT_PORTAL_ORIGIN: portal.url, PERMIT_SWEEP_PAUSE_MS: "0",
  });
  t.after(() => srv.stop());

  // --- first sweep: everything is new -----------------------------------
  const r1 = await sweep(srv.base, { days: 7 });
  const text1 = await r1.text();
  assert.equal(r1.status, 200, text1);
  const s1 = JSON.parse(text1);
  assert.deepEqual(s1.errors, []);
  assert.equal(s1.discovered, EXPECTED);
  assert.equal(s1.added, EXPECTED);
  assert.equal(s1.seen, 0);
  assert.equal(s1.statusChanges, 0);
  assert.equal(db.tables.permit_filings.length, EXPECTED);
  assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));

  const rows = db.tables.permit_filings;
  const keys = new Set(rows.map((r) => `${r.jurisdiction}/${r.permit_number}`));
  assert.equal(keys.size, rows.length, "one row per (jurisdiction, number)");
  assert.deepEqual([...new Set(rows.map((r) => r.market))].sort(), ["Boise, ID", "Meridian, ID"],
    "market comes from the jurisdiction, never the portal string");
  for (const r of rows) {
    assert.ok(r.first_seen_at && r.last_seen_at, "stamped on insert");
    assert.equal(r.status_changed_at, undefined, "first sight is not a change");
    assert.ok(r.source_url.startsWith("http"), r.source_url);
    if (r.address) assert.equal(r.street_key, r.address.split(",")[0].toLowerCase().replace(/[.,#]/g, "").replace(/\s+/g, " ").trim());
  }
  const micron = rows.find((r) => r.permit_number === "BLD26-02789");
  assert.equal(micron.jurisdiction, "boise");
  assert.equal(micron.address, "8000 S FEDERAL WAY, Boise ID 83716");
  assert.equal(micron.street_key, "8000 s federal way");
  assert.equal(micron.applicant_company, "Micron Technology Inc");
  assert.equal(micron.parcel_number, "S1607212409");
  assert.equal(micron.zoning, "I-3", "the Ada County layer was asked, through the redirected origin");
  assert.equal(micron.is_industrial, true);
  assert.equal(micron.status, "Applicant Upload");
  assert.equal(micron.applied_date, "2026-09-16");
  const shell = rows.find((r) => r.permit_number === "C-SHELL-2026-0029");
  assert.equal(shell.jurisdiction, "meridian");
  assert.equal(shell.address, "3468 CENTREPOINT", "the exact-hit detail page, footnote asterisk dropped");
  assert.equal(shell.applied_date, null, "a detail page prints no applied date and none is guessed");
  assert.equal(rows.filter((r) => /-P2$/.test(r.permit_number)).length, 10, "the pager's second page landed");
  assert.equal(rows.filter((r) => r.jurisdiction === "meridian" && r.contractor_company).length > 0, true,
    "Meridian's plain-text Licensed Professional block was read");
  assert.equal(db.tables.permit_filing_events.length, 0);

  // Politeness: every detail-page GET follows a pause we set to zero, but the
  // stub still saw one GET per new row, never a burst per city.
  const detailGets = portal.hits.filter((h) => h.method === "GET" && /CapDetail/.test(h.path) && !/fixture=/.test(h.path));
  assert.ok(detailGets.length >= EXPECTED - 2, `one detail read per new filing (${detailGets.length})`);

  // --- second sweep: nothing new, last_seen_at moves -----------------------
  const before = micron.last_seen_at;
  await new Promise((r) => setTimeout(r, 5));
  const r2 = await sweep(srv.base, { days: 7 });
  const s2 = await r2.json();
  assert.equal(r2.status, 200);
  assert.equal(s2.added, 0);
  assert.equal(s2.seen, EXPECTED);
  assert.equal(s2.statusChanges, 0);
  assert.equal(db.tables.permit_filings.length, EXPECTED, "ignore-duplicates held");
  assert.ok(micron.last_seen_at > before, "a re-seen row is touched");
  assert.equal(db.tables.permit_filing_events.length, 0);

  // --- a status move on the portal becomes one event and one PATCH --------
  micron.status = "Prescreen";
  const r3 = await sweep(srv.base, { days: 7 });
  const s3 = await r3.json();
  assert.equal(s3.statusChanges, 1);
  assert.equal(micron.status, "Applicant Upload", "the row now says what the portal says");
  assert.ok(micron.status_changed_at, "and when it changed");
  assert.equal(db.tables.permit_filing_events.length, 1);
  const ev = db.tables.permit_filing_events[0];
  assert.equal(ev.filing_id, micron.id);
  assert.equal(ev.old_status, "Prescreen");
  assert.equal(ev.new_status, "Applicant Upload");

  // --- /api/stats carries the count; /admin carries the card -------------
  const stats = await (await fetch(srv.base + "/api/stats", { headers: { "x-admin-key": KEY } })).json();
  assert.equal(stats.permits.db, true);
  assert.equal(stats.permits.filings, EXPECTED);
  assert.equal(stats.permits.byCity.boise, manifest.cities.boise.rows);
  assert.equal(stats.permits.lastRun.statusChanges, 1);
  assert.ok(stats.permits.cities.find((c) => c.key === "nampa" && !c.swept && /403/.test(c.blocked)));
  const admin = await (await fetch(srv.base + "/admin")).text();
  assert.equal(admin.split('"/api/permits/sweep"').length - 1, 1,
    "the sweep route is named exactly once on /admin — inside the click handler, never on load");
});

test("a sweep survives one city's portal failing: the other city's rows still land and the error is named", async (t) => {
  const portal = await startPortal();
  t.after(() => portal.stop());
  // Kill Meridian: its search page comes back without a form.
  const realHits = portal.hits;
  const broken = http.createServer((req, res) => {
    if (req.url.startsWith("/MERIDIAN/")) { res.writeHead(200, { "content-type": "text/html" }); return res.end("<html><body>Scheduled maintenance</body></html>"); }
    // Proxy everything else to the healthy stub.
    fetch(portal.url + req.url, { method: req.method, headers: req.headers, body: req.method === "POST" ? req : undefined, duplex: "half", redirect: "manual" })
      .then(async (up) => {
        res.writeHead(up.status, Object.fromEntries(up.headers));
        res.end(Buffer.from(await up.arrayBuffer()));
      }).catch((e) => { res.writeHead(502); res.end(String(e)); });
  });
  await new Promise((r) => broken.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => broken.close(r)));
  const db = await fake.start({ tables: { permit_filings: [], permit_filing_events: [], analytics_events: [] } });
  t.after(() => db.stop());
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", ADMIN_KEY: KEY,
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    PERMIT_PORTAL_ORIGIN: `http://127.0.0.1:${broken.address().port}`, PERMIT_SWEEP_PAUSE_MS: "0",
  });
  t.after(() => srv.stop());
  const s = await (await sweep(srv.base, { days: 7 })).json();
  assert.equal(s.errors.length, 1);
  assert.match(s.errors[0], /^meridian: portal-changed/);
  assert.equal(s.cities.boise.fresh, manifest.cities.boise.rows);
  assert.equal(db.tables.permit_filings.length, manifest.cities.boise.rows);
  assert.ok(realHits.length > 0);
});
