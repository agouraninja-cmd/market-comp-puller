// test/permit-areas-run.test.js
// Area alerts (2026-10-01, step 2, Draft B), actually run: a real server.js
// against the stand-in PostgREST + Resend, the shared portal stub, and a stub
// standing in for the Census geocoder (through the test-only CENSUS_API_URL).
//
// What this proves that permit-alerts.test.js cannot: an alert's address is
// placed when it is saved and an address the geocoder cannot find is refused;
// the weekday email takes only the permits inside the circle; the sweep's
// locate step places stored permits by their address, marks a miss so it is
// not asked again, and marks NOTHING when the geocoder is down.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const { startPortal } = require("./helpers/permit-portal-stub");

const KEY = "admin-test-key";
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 864e5).toISOString();
const PRO = { id: "5a1e9a1e-0000-4000-8000-00000000a2e1", email: "pro@example.com", name: "Pro" };
const today = new Date().toISOString().slice(0, 10);

// The Census stand-in: a few known streets; "OUTAGE" in the address is a 500.
const PLACES = {
  "8000 S FEDERAL WAY": [43.53002, -116.15082, "8000 S FEDERAL WAY, BOISE, ID, 83716"],
  "6100 S EISENMAN RD": [43.5345, -116.1415, "6100 S EISENMAN RD, BOISE, ID, 83716"],
  "150 N CAPITOL BLVD": [43.61539, -116.20186, "150 N CAPITOL BLVD, BOISE, ID, 83702"],
};
function startCensus() {
  const asked = [];
  const srv = http.createServer((req, res) => {
    const address = String(new URL(req.url, "http://x").searchParams.get("address") || "").toUpperCase();
    asked.push(address);
    if (address.includes("OUTAGE")) { res.writeHead(500); return res.end("down"); }
    const hit = Object.keys(PLACES).find((k) => address.startsWith(k));
    const matches = hit ? [{ coordinates: { y: PLACES[hit][0], x: PLACES[hit][1] }, matchedAddress: PLACES[hit][2] }] : [];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ result: { addressMatches: matches } }));
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${srv.address().port}/geocode`, asked, stop: () => new Promise((x) => srv.close(x)) })));
}

const filing = (n, over) => ({
  id: crypto.randomUUID(), jurisdiction: "boise", permit_number: `BLD26-1${n}`, permit_type: "Tenant Improvement",
  status: "In Review", applied_date: today, address: `${n} W MAIN ST, Boise ID 83702`, description: "Office",
  market: "Boise, ID", is_industrial: false, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
  source_url: `https://permits.example/${n}`, ...over,
});

async function bootWith(census, tablesExtra) {
  const portal = await startPortal();
  const db = await fake.start({ tables: {
    users: [{ ...PRO, pro_tester: true, vault_beta: false, digest_optout: false }],
    sessions: [{ token_hash: sha256("tok-" + PRO.id), user_id: PRO.id, expires_at: YEAR_OUT }],
    subscriptions: [], orgs: [], org_members: [], analytics_events: [],
    permit_filings: [], permit_filing_events: [], permit_watches: [], permit_watch_events: [], permit_watch_mutes: [],
    permit_alerts: [], ...tablesExtra,
  } });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", ADMIN_KEY: KEY, PRO_ENABLED: "on", PRO_TRIAL_DAYS: "0",
    PERMIT_PORTAL_ORIGIN: portal.url, PERMIT_SWEEP_PAUSE_MS: "0", CENSUS_API_URL: census.url,
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    RESEND_API_KEY: "resend-key", EMAIL_FROM: "CompNinja <reports@compninja.co>", RESEND_API_URL: db.resendUrl,
    SITE_URL: "https://compninja.co",
  });
  return { db, srv, stop: async () => { srv.stop(); await db.stop(); await portal.stop(); } };
}
const api = (srv, method, url, body) => fetch(srv.base + url, {
  method, headers: { "content-type": "application/json", cookie: `cn_session=tok-${PRO.id}` },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const sweep = (srv, body) => fetch(srv.base + "/api/permits/sweep", {
  method: "POST", headers: { "content-type": "application/json", "x-admin-key": KEY }, body: JSON.stringify(body || {}),
});

test("area alerts: placed when saved, matched by distance, and the permits placed by the sweep", async (t) => {
  const census = await startCensus();
  t.after(() => census.stop());
  const ctx = await bootWith(census, {});
  t.after(() => ctx.stop());
  const { db, srv } = ctx;
  let alertId;

  await t.test("an alert's address is placed when it is saved; one the map cannot find is refused", async (t) => {
    const r = await api(srv, "POST", "/api/permits/alerts", { jurisdiction: "boise", areaAddress: "8000 S Federal Way", areaMiles: 1 });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.alert.name, "Every permit within 1 mile of 8000 S FEDERAL WAY");
    assert.match(j.alert.describe, /within 1 mile of 8000 S FEDERAL WAY/);
    assert.deepEqual(j.alert.area, { address: "8000 S FEDERAL WAY, BOISE, ID, 83716", lat: 43.53002, lng: -116.15082, miles: 1 });
    assert.ok(census.asked.some((a) => a === "8000 S FEDERAL WAY, BOISE, ID"), "a bare street line got the alert's city");
    alertId = j.alert.id;
    const nowhere = await api(srv, "POST", "/api/permits/alerts", { jurisdiction: "boise", areaAddress: "1 Nowhere Ln", areaMiles: 1 });
    assert.equal(nowhere.status, 400);
    assert.match((await nowhere.json()).error, /couldn't find “1 Nowhere Ln” on the map/);
    assert.equal((await api(srv, "POST", "/api/permits/alerts", { areaAddress: "8000 S Federal Way", areaMiles: 3 })).status, 400);
    assert.equal(db.tables.permit_alerts.length, 1);
  });

  await t.test("the sweep places stored permits by address, emails only those inside the circle, and marks a miss", async (t) => {
    db.tables.permit_alerts[0].notified_through = new Date(Date.now() - 3600e3).toISOString();
    db.tables.permit_filings.push(
      filing(1, { address: "6100 S EISENMAN RD, Boise ID 83716" }), // 0.6 miles from Micron
      filing(2, { address: "150 N CAPITOL BLVD, Boise ID 83702" }), // downtown, six miles off
      filing(3, { address: "77 UNKNOWN ST, Boise ID 83702" }),      // Census has no match
      filing(4, { address: null }),                                  // nothing to look up
      filing(5, { lat: 43.5293, lng: -116.147, geo_source: "parcel", address: "8000 S FEDERAL WAY" }), // the sweep's parcel point
    );
    const s = await (await sweep(srv, { days: 1 })).json();
    assert.deepEqual(s.errors, []);
    assert.deepEqual(s.located.errors, []);
    assert.equal(s.located.placed, 2);
    assert.equal(s.located.missed, 2);
    const row = (n) => db.tables.permit_filings.find((f) => f.permit_number === `BLD26-1${n}`);
    assert.equal(row(1).geo_source, "address");
    assert.equal(row(1).lat, 43.5345);
    assert.equal(row(3).geo_source, "none", "a miss is marked, so it is not asked again");
    assert.equal(row(4).geo_source, "none");
    assert.equal(row(5).geo_source, "parcel", "a permit already placed is left alone");
    assert.equal(s.alerts.emailed, 1);
    const [mail] = await fake.waitForMail(db, 1);
    assert.match(mail.text, /BLD26-11\b/);
    assert.match(mail.text, /BLD26-15\b/);
    assert.doesNotMatch(mail.text, /BLD26-1[234]\b/, "outside the circle, or nowhere on the map");
    const again = await (await sweep(srv, { days: 1 })).json();
    assert.equal(again.located.tried, 0, "nothing left to place");
  });

  await t.test("changing an alert to anywhere in the city drops its area", async (t) => {
    const r = await api(srv, "PATCH", `/api/permits/alerts?id=${alertId}`, { jurisdiction: "boise", propertyType: "", kind: "", words: "", areaAddress: "", areaMiles: 1, name: "" });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.alert.area, null);
    assert.equal(j.alert.name, "Every permit in Boise");
    assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));
  });
});

test("with the geocoder down, the locate step stops and marks nothing", async (t) => {
  const census = await startCensus();
  t.after(() => census.stop());
  const rows = [1, 2, 3, 4].map((n) => filing(n, { address: `${n} OUTAGE ST, Boise ID 83702` }));
  const ctx = await bootWith(census, { permit_filings: rows });
  t.after(() => ctx.stop());
  const s = await (await sweep(ctx.srv, { days: 1 })).json();
  assert.equal(s.located.placed, 0);
  assert.equal(s.located.missed, 0);
  assert.match(s.located.errors[0], /stopped after 3 geocoder failures/);
  assert.ok(ctx.db.tables.permit_filings.every((f) => f.geo_source == null), "an outage never marks a permit unplaceable");
  assert.deepEqual(s.errors, [], "and it never fails the city sweep");
});
