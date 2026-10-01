// test/permit-alerts-run.test.js
// Permit alerts (2026-10-01, Draft B), actually run: a real server.js against
// the stand-in PostgREST + Resend, and the shared portal stub standing in for
// the city portals (the sweep's own searches find nothing there).
//
// What this proves that permit-alerts.test.js cannot: every route is scoped to
// the signed-in member; adding and changing are Pro while deleting is not;
// /permits boots the list beside the feed; and the weekday sweep mails each
// member their alerts' new permits ONCE, moves the mark only after the send,
// leaves it when mail is off, and never runs on the history-only call.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const { startPortal } = require("./helpers/permit-portal-stub");

const KEY = "admin-test-key";
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 864e5).toISOString();
const PRO = { id: "5a1e9a1e-0000-4000-8000-00000000a1e1", email: "pro@example.com", name: "Pro" };
const OTHER = { id: "5a1e9a1e-0000-4000-8000-00000000a1e2", email: "other@example.com", name: "Other" };
const FREE = { id: "5a1e9a1e-0000-4000-8000-00000000a1e3", email: "free@example.com", name: "Free" };
const today = new Date().toISOString().slice(0, 10);
const tables = () => ({
  users: [{ ...PRO, pro_tester: true }, { ...OTHER, pro_tester: true }, { ...FREE, pro_tester: false }]
    .map((u) => ({ vault_beta: false, digest_optout: false, ...u })),
  sessions: [PRO, OTHER, FREE].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
  subscriptions: [], orgs: [], org_members: [], analytics_events: [],
  permit_filings: [], permit_filing_events: [], permit_watches: [], permit_watch_events: [], permit_watch_mutes: [],
  permit_alerts: [],
});

async function bootWith(extraEnv) {
  const portal = await startPortal();
  const db = await fake.start({ tables: tables() });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", ADMIN_KEY: KEY, PRO_ENABLED: "on", PRO_TRIAL_DAYS: "0",
    PERMIT_PORTAL_ORIGIN: portal.url, PERMIT_SWEEP_PAUSE_MS: "0",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    RESEND_API_KEY: "resend-key", EMAIL_FROM: "CompNinja <reports@compninja.co>", RESEND_API_URL: db.resendUrl,
    SITE_URL: "https://compninja.co",
    ...extraEnv,
  });
  return { portal, db, srv, stop: async () => { srv.stop(); await db.stop(); await portal.stop(); } };
}
const as = (u) => (u ? { cookie: `cn_session=tok-${u.id}` } : {});
const api = (srv, method, url, user, body) => fetch(srv.base + url, {
  method, headers: { "content-type": "application/json", ...as(user) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const sweep = (srv, body) => fetch(srv.base + "/api/permits/sweep", {
  method: "POST", headers: { "content-type": "application/json", "x-admin-key": KEY }, body: JSON.stringify(body || {}),
});
const filing = (n, over) => ({
  id: crypto.randomUUID(), jurisdiction: "boise", permit_number: `BLD26-0${n}`, permit_type: "Tenant Improvement",
  status: "In Review", applied_date: today, address: `${n} W MAIN ST, Boise ID 83702`, description: "Warehouse office",
  market: "Boise, ID", is_industrial: true, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
  source_url: `https://permits.example/${n}`, ...over,
});

test("permit alerts: the routes, the page and the weekday email", async (t) => {
  const ctx = await bootWith({});
  t.after(() => ctx.stop());
  const { db, srv } = ctx;
  let alertId = null;

  await t.test("signed out is refused; a free account cannot add; bad filters and an eleventh alert are refused", async (t) => {
    assert.equal((await api(srv, "POST", "/api/permits/alerts", null, {})).status, 401);
    const free = await api(srv, "POST", "/api/permits/alerts", FREE, { jurisdiction: "boise" });
    assert.equal(free.status, 403);
    assert.equal((await free.json()).code, "pro_required");
    const nampa = await api(srv, "POST", "/api/permits/alerts", PRO, { jurisdiction: "nampa" });
    assert.equal(nampa.status, 400);
    assert.match((await nampa.json()).error, /city we read/);
    assert.equal(db.tables.permit_alerts.length, 0);
  });

  await t.test("a Pro member adds an alert, named from its filters, marked from now", async (t) => {
    const before = Date.now();
    const r = await api(srv, "POST", "/api/permits/alerts", PRO, { jurisdiction: "boise", propertyType: "Industrial", kind: "ti" });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.alert.name, "Industrial build-outs in Boise");
    assert.equal(j.alert.describe, "Tenant build-outs · Industrial · Boise");
    assert.equal(j.alert.email, true);
    alertId = j.alert.id;
    const row = db.tables.permit_alerts.find((a) => a.id === alertId);
    assert.equal(row.user_id, PRO.id);
    assert.ok(Date.parse(row.notified_through) >= before - 1000, "saving an alert never mails the past");
  });

  await t.test("an eleventh alert is refused", async (t) => {
    for (let i = 0; i < 10; i++) {
      assert.equal((await api(srv, "POST", "/api/permits/alerts", OTHER, { words: `street ${i}` })).status, 200);
    }
    const r = await api(srv, "POST", "/api/permits/alerts", OTHER, { words: "one more" });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /up to 10 alerts/);
    // Clear them so the email below concerns the one member only.
    for (const a of db.tables.permit_alerts.filter((x) => x.user_id === OTHER.id)) {
      assert.equal((await api(srv, "DELETE", `/api/permits/alerts?id=${a.id}`, OTHER)).status, 200);
    }
  });

  await t.test("another member cannot change or delete it", async (t) => {
    assert.equal((await api(srv, "PATCH", `/api/permits/alerts?id=${alertId}`, OTHER, { name: "mine now" })).status, 404);
    assert.equal((await api(srv, "DELETE", `/api/permits/alerts?id=${alertId}`, OTHER)).status, 404);
    assert.equal(db.tables.permit_alerts.length, 1);
  });

  await t.test("/permits boots the member's alerts beside the feed, with the section", async (t) => {
    const html = await (await fetch(srv.base + "/permits", { headers: as(PRO) })).text();
    assert.match(html, /id="paSec"/);
    assert.match(html, /"alerts":\{"s":200,"j":\{"alerts":\[\{"id":"[^"]+","name":"Industrial build-outs in Boise"/);
    assert.match(html, /"canTrack":true/);
    const free = await (await fetch(srv.base + "/permits", { headers: as(FREE) })).text();
    assert.match(free, /"alerts":\{"s":200,"j":\{"alerts":\[\],"canTrack":false/);
  });

  await t.test("the weekday sweep mails the member their new permits once, and moves the mark only after the send", async (t) => {
    const row = db.tables.permit_alerts.find((a) => a.id === alertId);
    row.notified_through = new Date(Date.now() - 3600e3).toISOString();
    db.tables.permit_filings.push(
      filing(101),                                                    // new, matches
      filing(102, { permit_type: "New/Added Commercial" }),          // a new building, not a build-out
      filing(103, { jurisdiction: "meridian", market: "Meridian, ID" }),
      filing(104, { applied_date: "2026-03-02" }),                    // stored now by the history pass, filed in March
      filing(105, { first_seen_at: new Date(Date.now() - 7200e3).toISOString() }), // before the mark
    );
    const s = await (await sweep(srv, { days: 1 })).json();
    assert.deepEqual(s.errors, []);
    assert.equal(s.alerts.alerts, 1);
    assert.equal(s.alerts.emailed, 1);
    const sent = await fake.waitForMail(db, 1);
    assert.equal(sent.length, 1);
    assert.ok(JSON.stringify(sent[0].to).includes(PRO.email));
    assert.equal(sent[0].subject, "1 new permit: Industrial build-outs in Boise");
    assert.match(sent[0].text, /BLD26-0101/);
    assert.doesNotMatch(sent[0].text, /BLD26-010[2-5]/);
    assert.ok(Date.parse(row.notified_through) > Date.now() - 60e3, "the mark moved");
    assert.ok(row.last_emailed_at);

    const again = await (await sweep(srv, { days: 1 })).json();
    assert.equal(again.alerts.emailed, 0, "nothing new since");
    await fake.waitForMail(db, 2, { timeoutMs: 400 });
    assert.equal(db.sent.length, 1);

    const hist = await (await sweep(srv, { only: "history", history: "rotate" })).json();
    assert.equal(hist.alerts, undefined, "the history-only call sends nothing");
  });

  await t.test("changing the filters moves the mark; a lapsed member can still delete but not change", async (t) => {
    const r = await api(srv, "PATCH", `/api/permits/alerts?id=${alertId}`, PRO, { jurisdiction: "", propertyType: "", kind: "", words: "main st", name: "", email: false });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.alert.name, "Every permit in every city mentioning “main st”");
    assert.equal(j.alert.email, false);
    db.tables.users.find((u) => u.id === PRO.id).pro_tester = false;
    assert.equal((await api(srv, "PATCH", `/api/permits/alerts?id=${alertId}`, PRO, { name: "x" })).status, 403);
    assert.equal((await api(srv, "DELETE", `/api/permits/alerts?id=${alertId}`, PRO)).status, 200);
    assert.equal(db.tables.permit_alerts.length, 0);
    assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));
  });
});

test("with outbound mail off the alert email waits and nothing is marked", async (t) => {
  const ctx = await bootWith({ EMAIL_FROM: "", RESEND_API_KEY: "" });
  t.after(() => ctx.stop());
  const { db, srv } = ctx;
  const mark = new Date(Date.now() - 3600e3).toISOString();
  db.tables.permit_alerts.push({ id: crypto.randomUUID(), user_id: PRO.id, name: "Everything", jurisdiction: null, property_type: null,
    kind: null, words: null, notify_email: true, notified_through: mark, created_at: mark });
  db.tables.permit_filings.push(filing(201));
  const s = await (await sweep(srv, { days: 1 })).json();
  assert.equal(s.alerts.mailOff, true);
  assert.equal(s.alerts.pending, 1);
  assert.equal(s.alerts.emailed, 0);
  assert.equal(db.tables.permit_alerts[0].notified_through, mark, "the next run sends them");
  assert.equal(db.sent.length, 0);
});
