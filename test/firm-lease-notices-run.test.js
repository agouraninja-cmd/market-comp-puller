// The firm's lease reminders, actually run (2026-11-20), against the stand-in
// PostgREST and the Resend stand-in. renewal-watch.test.js proves the copy
// and the due rule; this proves who is mailed, that a lease is mailed about
// once, that an edit to its dates brings the reminder round again, and that
// nobody outside the firm, pending or opted out is told about a tenant.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const NOW = new Date().toISOString();
const YEAR_OUT = new Date(Date.now() + 365 * 86400000).toISOString();
const ymd = (daysFromNow) => new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

const OWNER = { id: "u-owner", email: "owner@firm.example", name: "Olive" };
const FILER = { id: "u-filer", email: "filer@firm.example", name: "Finn" };
const OTHER = { id: "u-other", email: "other@firm.example", name: "Oscar" };
const PENDING = { id: "u-pending", email: "pending@firm.example", name: "Penny" };
const GONE = { id: "u-gone", email: "gone@firm.example", name: "Gus" };
const RIVAL = { id: "u-rival", email: "rival@elsewhere.example", name: "Rita" };
const ORG_ID = "9c1e9a1e-0000-4000-8000-0000000000a1";
const RIVAL_ORG = "9c1e9a1e-0000-4000-8000-0000000000a2";
const B1 = "9c1e9a1e-0000-4000-8000-0000000000b1";
const L1 = "9c1e9a1e-0000-4000-8000-0000000000c1";
const L2 = "9c1e9a1e-0000-4000-8000-0000000000c2";

function lease(over) {
  return {
    id: L1, org_id: ORG_ID, building_id: B1, tenant: "Acme Logistics", suite: "200", size_sqft: 12500,
    term_start: null, lease_expiry: ymd(300), option_notice_date: ymd(60),
    rent_psf: 18.5, rent_basis: "annual", lease_type: "NNN", status: "active", notes: null,
    added_by_user_id: FILER.id, added_by_name: "Finn", renewal_notified_at: null,
    created_at: NOW, updated_at: NOW, ...over,
  };
}

function tables(leases, userOver) {
  const member = (u, org, role, over) => ({ id: crypto.randomUUID(), org_id: org, email: u.email, user_id: u.id, role,
    invited_at: NOW, joined_at: NOW, removed_at: null, auto_share: null, ...over });
  const people = [OWNER, FILER, OTHER, PENDING, GONE, RIVAL];
  return {
    users: people.map((u) => ({ ...u, pro_tester: false, vault_beta: false, digest_optout: false, ...((userOver || {})[u.id] || {}) })),
    sessions: people.map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
    orgs: [{ id: ORG_ID, name: "Northside Brokers", share_default: "none", seats: 5, kind: "broker" },
           { id: RIVAL_ORG, name: "Elsewhere LLC", share_default: "none", seats: 5, kind: "broker" }],
    org_members: [
      member(OWNER, ORG_ID, "owner"), member(FILER, ORG_ID, "member"), member(OTHER, ORG_ID, "member"),
      member(PENDING, ORG_ID, "member", { joined_at: null }),
      member(GONE, ORG_ID, "owner", { removed_at: NOW }),
      member(RIVAL, RIVAL_ORG, "owner"),
    ],
    org_buildings: [{ id: B1, org_id: ORG_ID, address: "1210 N 17th St, Boise, ID", address_key: "1210 n 17th st boise id",
      verified_key: null, market: "Boise, ID", property_type: "Industrial", size_sqft: 12500, year_built: 1994,
      lat: null, lng: null, added_by_user_id: OWNER.id, added_by_name: "Olive", created_at: NOW, updated_at: NOW }],
    org_leases: leases,
    analytics_events: [],
  };
}

async function boot(tbl, extraEnv) {
  const db = await fake.start({ tables: tbl });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on", ADMIN_KEY: "lease-key",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    RESEND_API_KEY: "resend-key", EMAIL_FROM: "CompNinja <reports@compninja.co>",
    RESEND_API_URL: db.resendUrl, SITE_URL: "https://compninja.co", ...extraEnv,
  });
  return { db, srv, stop: async () => { srv.stop(); await db.stop(); } };
}
const run = (srv, body, key) => fetch(srv.base + "/api/org/leases/notices", {
  method: "POST",
  headers: { "content-type": "application/json", ...(key === null ? {} : { "x-admin-key": key || "lease-key" }) },
  body: JSON.stringify(body || {}),
});

test("the firm's lease reminders actually run", async (t) => {
  await t.test("the owner and the filer are mailed, once, and nobody else", async (t) => {
    const tbl = tables([lease()]);
    const { db, srv, stop } = await boot(tbl);
    t.after(stop);

    const summary = await (await run(srv)).json();
    assert.equal(summary.firms, 1);
    assert.equal(summary.due, 1);
    assert.equal(summary.sent, 2, "the owner and the member who filed it");
    assert.equal(summary.leases, 1);
    assert.equal(summary.failed, 0);

    const mails = await fake.waitForMail(db, 2);
    const to = mails.map((m) => m.to[0]).sort();
    assert.deepEqual(to, [FILER.email, OWNER.email],
      "never a colleague who did not file it, a pending invite, a removed owner or another firm");
    const owner = mails.find((m) => m.to[0] === OWNER.email);
    assert.match(owner.subject, /Option notice coming up: Acme Logistics at 1210 N 17th St/);
    assert.match(owner.text, /Acme Logistics, Suite 200/);
    assert.match(owner.text, /Option notice due .*, in 60 days/);
    assert.match(owner.text, /12,500 SF at \$18\.50\/SF\/yr NNN/);
    assert.match(owner.text, new RegExp("https://compninja\\.co/building/" + B1));
    assert.match(owner.text, /you are an owner of Northside Brokers/);
    assert.match(mails.find((m) => m.to[0] === FILER.email).text, /you filed this lease for Northside Brokers/);

    assert.ok(tbl.org_leases[0].renewal_notified_at, "the lease is marked as told");
    const again = await (await run(srv)).json();
    assert.equal(again.sent, 0, "the second run mails nobody");
    assert.equal(db.sent.length, 2);
  });

  await t.test("changing a lease's dates brings the reminder round again", async (t) => {
    const tbl = tables([lease({ renewal_notified_at: NOW })]);
    const { db, srv, stop } = await boot(tbl);
    t.after(stop);
    assert.equal((await (await run(srv)).json()).sent, 0, "already told");
    const r = await fetch(`${srv.base}/api/org/leases?id=${ORG_ID}&lease=${L1}`, {
      method: "PATCH", headers: { "content-type": "application/json", cookie: `cn_session=tok-${OWNER.id}` },
      body: JSON.stringify({ optionNoticeDate: ymd(45) }),
    });
    assert.equal(r.status, 200);
    assert.equal(tbl.org_leases[0].renewal_notified_at, null, "the mark is cleared");
    assert.equal(db.sent.length, 0, "and the edit itself mails nobody");
    assert.equal((await (await run(srv)).json()).sent, 2);
    // An edit that leaves the dates alone leaves the mark alone.
    await fetch(`${srv.base}/api/org/leases?id=${ORG_ID}&lease=${L1}`, {
      method: "PATCH", headers: { "content-type": "application/json", cookie: `cn_session=tok-${OWNER.id}` },
      body: JSON.stringify({ notes: "Called the tenant." }),
    });
    assert.ok(tbl.org_leases[0].renewal_notified_at);
  });

  await t.test("far out, already passed, vacated: nobody is mailed and nothing is marked", async (t) => {
    const tbl = tables([
      lease({ option_notice_date: ymd(200), lease_expiry: ymd(400) }),
      lease({ id: L2, option_notice_date: null, lease_expiry: ymd(30), status: "vacated" }),
      lease({ id: "9c1e9a1e-0000-4000-8000-0000000000c3", option_notice_date: null, lease_expiry: ymd(-3) }),
    ]);
    const { db, srv, stop } = await boot(tbl);
    t.after(stop);
    const summary = await (await run(srv)).json();
    assert.equal(summary.due, 0);
    assert.equal(db.sent.length, 0);
    assert.ok(tbl.org_leases.every((l) => l.renewal_notified_at === null));
  });

  await t.test("a lapsed option notice hands over to an expiry that is still ahead", async (t) => {
    const tbl = tables([lease({ option_notice_date: ymd(-10), lease_expiry: ymd(40), added_by_user_id: OWNER.id })]);
    const { db, srv, stop } = await boot(tbl);
    t.after(stop);
    assert.equal((await (await run(srv)).json()).sent, 1);
    const [mail] = await fake.waitForMail(db, 1);
    assert.match(mail.text, /Lease expires .*, in 40 days/);
    assert.equal(/Option notice due/.test(mail.text), false);
  });

  await t.test("somebody who turned CompNinja emails off is not mailed; the lease is still marked by the other send", async (t) => {
    const tbl = tables([lease()], { [OWNER.id]: { digest_optout: true } });
    const { db, srv, stop } = await boot(tbl);
    t.after(stop);
    const summary = await (await run(srv)).json();
    assert.equal(summary.optedOut, 1);
    assert.equal(summary.sent, 1);
    const [mail] = await fake.waitForMail(db, 1);
    assert.deepEqual(mail.to, [FILER.email]);
  });

  await t.test("a dry run builds the copy, sends nothing and marks nothing", async (t) => {
    const tbl = tables([lease()]);
    const { db, srv, stop } = await boot(tbl);
    t.after(stop);
    const summary = await (await run(srv, { dryRun: true })).json();
    assert.equal(summary.previews.length, 2);
    assert.equal(summary.sent, 0);
    assert.equal(db.sent.length, 0);
    assert.equal(tbl.org_leases[0].renewal_notified_at, null);
  });

  await t.test("a send the provider refuses leaves the lease unmarked for the next run", async (t) => {
    const tbl = tables([lease()]);
    const db = await fake.start({ tables: tbl, resendStatus: 500 });
    const srv = await shared.boot({ ACCOUNT_WALL: "off", ADMIN_KEY: "lease-key", SUPABASE_URL: db.url,
      SUPABASE_SERVICE_KEY: "service-key", RESEND_API_KEY: "resend-key",
      EMAIL_FROM: "CompNinja <reports@compninja.co>", RESEND_API_URL: db.resendUrl });
    t.after(async () => { srv.stop(); await db.stop(); });
    const summary = await (await run(srv)).json();
    assert.equal(summary.sent, 0);
    assert.equal(summary.failed, 2);
    assert.equal(tbl.org_leases[0].renewal_notified_at, null);
  });

  await t.test("a lease told 90 days out gets one last reminder inside 14 days, then nothing", async (t) => {
    const told = new Date(Date.now() - 80 * 86400000).toISOString();
    const tbl = tables([lease({ option_notice_date: ymd(10), renewal_notified_at: told })]);
    const { db, srv, stop } = await boot(tbl);
    t.after(stop);
    const summary = await (await run(srv)).json();
    assert.equal(summary.sent, 2);
    const mails = await fake.waitForMail(db, 2);
    assert.ok(mails.every((m) => /^Reminder: Option notice coming up/.test(m.subject)));
    assert.match(mails[0].text, /in 10 days/);
    assert.notEqual(tbl.org_leases[0].renewal_notified_at, told, "the mark moves to this send");
    assert.equal((await (await run(srv)).json()).sent, 0, "and a third run mails nobody");
  });

  await t.test("a firm that turned reminders off is skipped whole, and its leases stay unmarked", async (t) => {
    const tbl = tables([lease()]);
    tbl.orgs[0].lease_reminders = false;
    const { db, srv, stop } = await boot(tbl);
    t.after(stop);
    const summary = await (await run(srv)).json();
    assert.equal(summary.firmsOff, 1);
    assert.equal(summary.sent, 0);
    assert.equal(db.sent.length, 0);
    assert.equal(tbl.org_leases[0].renewal_notified_at, null, "turned back on, the reminder still comes");
  });

  await t.test("an owner or admin turns reminders off in firm settings; a member cannot", async (t) => {
    const tbl = tables([lease()]);
    const { db, srv, stop } = await boot(tbl);
    t.after(stop);
    const settings = (user, body) => fetch(srv.base + "/api/org/settings", {
      method: "POST", headers: { "content-type": "application/json", cookie: `cn_session=tok-${user.id}` },
      body: JSON.stringify({ orgId: ORG_ID, ...body }),
    });
    const org = async (user) => (await (await fetch(srv.base + "/api/org",
      { headers: { cookie: `cn_session=tok-${user.id}` } })).json()).orgs[0];

    assert.equal((await org(OWNER)).leaseReminders, true, "on until somebody turns it off");
    assert.equal((await settings(FILER, { leaseReminders: false })).status, 403, "a member cannot");
    assert.equal((await settings(OWNER, { leaseReminders: "no" })).status, 400, "a yes or no, nothing else");
    const r = await settings(OWNER, { leaseReminders: false });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).leaseReminders, false);
    assert.equal(tbl.orgs[0].lease_reminders, false);
    assert.equal((await org(FILER)).leaseReminders, false, "every member reads the firm's answer");

    // The Buildings page says so under its dates.
    const page = await (await fetch(srv.base + "/buildings", { headers: { cookie: `cn_session=tok-${OWNER.id}` } })).text();
    assert.match(page, /"leaseReminders":false/);
    assert.match(page, /id="blCritNote"/);

    assert.equal((await (await run(srv)).json()).firmsOff, 1, "and the run honours it");
    assert.equal(db.sent.length, 0);
    assert.equal((await settings(OWNER, { leaseReminders: true })).status, 200);
    assert.equal((await (await run(srv)).json()).sent, 2, "back on: the lease is mailed");
  });

  await t.test("before migration 065 runs: the run mails as before, and the switch says it cannot yet", async (t) => {
    const tbl = tables([lease()]);
    const db = await fake.start({ tables: tbl, missingColumns: { orgs: ["lease_reminders"] } });
    const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", ADMIN_KEY: "lease-key",
      SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key", RESEND_API_KEY: "resend-key",
      EMAIL_FROM: "CompNinja <reports@compninja.co>", RESEND_API_URL: db.resendUrl, SITE_URL: "https://compninja.co" });
    t.after(async () => { srv.stop(); await db.stop(); });
    assert.equal((await (await run(srv)).json()).sent, 2, "a missing column is on for everyone");
    const r = await fetch(srv.base + "/api/org/settings", {
      method: "POST", headers: { "content-type": "application/json", cookie: `cn_session=tok-${OWNER.id}` },
      body: JSON.stringify({ orgId: ORG_ID, leaseReminders: false }),
    });
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /can't be turned off just yet/);
    const me = await (await fetch(srv.base + "/api/org", { headers: { cookie: `cn_session=tok-${OWNER.id}` } })).json();
    assert.equal(me.orgs[0].leaseReminders, true, "the firm read still answers");
  });

  await t.test("the /admin card: opening the page sends nothing, and it says when it last ran", async (t) => {
    const tbl = tables([lease()]);
    const { srv, stop } = await boot(tbl);
    t.after(stop);
    const html = await (await fetch(srv.base + "/admin")).text();
    assert.equal(html.split('"/api/org/leases/notices"').length - 1, 1, "one fetch call site, inside run()");
    const loader = html.slice(html.indexOf("function load(key)"), html.indexOf("function load(key)") + 1200);
    assert.equal(/leases\/notices/.test(loader), false, "the loader never touches the route");
    assert.match(html, /renderLeaseCard\(\)/, "the idle card takes no arguments and fetches nothing");
    assert.match(html, /confirm\("Send the lease reminders now\?[^"]*cannot be recalled/);
    const runFn = html.slice(html.indexOf("function renderLeaseCard"));
    assert.match(runFn.slice(runFn.indexOf("var run=function(dry)"), runFn.indexOf("var run=function(dry)") + 300),
      /if\(!dry&&!confirm\(/, "only the real send asks first");

    const stats = async () => (await (await fetch(srv.base + "/api/stats",
      { headers: { "x-admin-key": "lease-key" } })).json()).leaseNoticeRuns;
    assert.deepEqual(await stats(), { runs: 0, previews: 0, lastAt: null, lastOutcome: "" });
    await run(srv, { dryRun: true });
    assert.equal((await stats()).previews, 1);
    assert.equal((await stats()).runs, 0, "a preview is not a run");
    await run(srv);
    const after = await stats();
    assert.equal(after.runs, 1);
    assert.equal(after.lastOutcome, "sent:2");
  });

  await t.test("it is the admin's route, and it refuses without outbound mail", async (t) => {
    const tbl = tables([lease()]);
    const { db, srv, stop } = await boot(tbl, { EMAIL_FROM: "" });
    t.after(stop);
    assert.equal((await run(srv, {}, null)).status, 401);
    assert.equal((await run(srv, {}, "wrong")).status, 401);
    assert.equal((await run(srv)).status, 503, "no outbound mail: refuse rather than mark");
    assert.equal(tbl.org_leases[0].renewal_notified_at, null);
    assert.equal(db.sent.length, 0);
  });
});
