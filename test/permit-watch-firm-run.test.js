// test/permit-watch-firm-run.test.js
// Permit tracking as a Pro tool, and a tracked permit shared with the whole
// firm (2026-09-29; migration 055), actually run: a real server.js against the
// stand-in PostgREST + Resend and the portal stub.
//
// What this proves that the unit tests cannot: a free account is refused at
// the door but keeps the way out of a list it already has; only a firm's OWNER
// can attach the firm; a colleague sees the firm's permit, attributed; the
// weekday sweep copies the notice to every Pro colleague — not to a free one,
// not to one who muted it, and not twice to one who tracks it themselves; the
// email says it came through the firm; and switching the firm off takes the
// colleagues' copies with it.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const { startPortal } = require("./helpers/permit-portal-stub");

const KEY = "admin-test-key";
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 864e5).toISOString();
const JOINED = "2026-01-05T00:00:00.000Z";
const ORG = "0a9e0000-0000-4000-8000-0000000000c1";
const OTHER_ORG = "0a9e0000-0000-4000-8000-0000000000c2";

const u = (n, email, name, pro) => ({ id: `5a1e9a1e-0000-4000-8000-00000000f0${n}`, email, name, pro });
const BRAD = u("01", "brad@colliers.com", "Brad", true);   // the firm's owner
const ANN = u("02", "ann@colliers.com", "Ann", true);      // a Pro colleague
const CY = u("03", "cy@colliers.com", "Cy", false);        // a free colleague
const DEE = u("04", "dee@colliers.com", "Dee", true);      // mutes the firm permit
const EVE = u("05", "eve@colliers.com", "Eve", true);      // tracks the same permit herself
const ADA = u("06", "ada@colliers.com", "Ada", true);      // the firm's admin, not its owner
const ZED = u("07", "zed@elsewhere.com", "Zed", true);     // another firm entirely
const FREE = u("08", "free@nowhere.com", "Free", false);   // no firm, no Pro
const PEOPLE = [BRAD, ANN, CY, DEE, EVE, ADA, ZED, FREE];

const member = (p, role, org = ORG) => ({
  id: crypto.randomUUID(), org_id: org, email: p.email, role, user_id: p.id,
  invited_at: JOINED, joined_at: JOINED, removed_at: null, auto_share: null,
});
const tables = () => ({
  users: PEOPLE.map((p) => ({ id: p.id, email: p.email, name: p.name, pro_tester: p.pro, vault_beta: false, digest_optout: false, created_at: JOINED })),
  sessions: PEOPLE.map((p) => ({ token_hash: sha256("tok-" + p.id), user_id: p.id, expires_at: YEAR_OUT })),
  subscriptions: [],
  orgs: [
    { id: ORG, name: "Colliers Boise", kind: "broker", share_default: "none", seats: null, created_at: JOINED },
    { id: OTHER_ORG, name: "Elsewhere Realty", kind: "broker", share_default: "none", seats: null, created_at: JOINED },
  ],
  org_members: [
    member(BRAD, "owner"), member(ANN, "member"), member(CY, "member"), member(DEE, "member"),
    member(EVE, "member"), member(ADA, "admin"), member(ZED, "owner", OTHER_ORG),
  ],
  org_subscriptions: [],
  permit_filings: [], permit_filing_events: [], permit_watches: [], permit_watch_events: [], permit_watch_mutes: [],
  analytics_events: [],
});

const as = (p) => (p ? { cookie: `cn_session=tok-${p.id}` } : {});

test("permit tracking is Pro, and an owner can track a permit for the whole firm", async (t) => {
  const portal = await startPortal();
  const db = await fake.start({ tables: tables() });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", ADMIN_KEY: KEY, PRO_ENABLED: "on",
    PERMIT_PORTAL_ORIGIN: portal.url, PERMIT_SWEEP_PAUSE_MS: "0",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    RESEND_API_KEY: "resend-key", EMAIL_FROM: "CompNinja <reports@compninja.co>", RESEND_API_URL: db.resendUrl,
    SITE_URL: "https://compninja.co",
  });
  t.after(async () => { srv.stop(); await db.stop(); await portal.stop(); });

  const api = async (method, url, p, body) => {
    const r = await fetch(srv.base + url, {
      method, headers: { "content-type": "application/json", ...as(p) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };
  const mine = async (p) => (await api("GET", "/api/permits/mine", p)).j;
  const unread = async (p) => (await api("GET", "/api/permits/unread", p)).j.count;
  const sweep = async () => {
    const r = await fetch(srv.base + "/api/permits/sweep", {
      method: "POST", headers: { "content-type": "application/json", "x-admin-key": KEY }, body: JSON.stringify({ days: 1 }),
    });
    return { status: r.status, j: await r.json() };
  };
  const eventsOf = (p, watchId) => db.tables.permit_watch_events.filter((e) => e.user_id === p.id && (!watchId || e.watch_id === watchId));

  portal.statusOf["BLD26-00010"] = "In Review";
  portal.statusOf["BLD26-00011"] = "In Review";
  let firmWatch = null;

  await t.test("a free account sees the Pro door and cannot add or change a permit", async () => {
    const m = await mine(FREE);
    assert.equal(m.canTrack, false);
    assert.equal(m.firm, null);
    const add = await api("POST", "/api/permits/watch", FREE, { jurisdiction: "boise", permitNumber: "BLD26-00011" });
    assert.equal(add.status, 403);
    assert.equal(add.j.code, "pro_required");
    assert.equal(db.tables.permit_watches.length, 0, "nothing stored");
    assert.equal(portal.hits.length, 0, "a refused add never reaches the city's portal");
  });

  await t.test("a lapsed member keeps the way out of a list they already have", async () => {
    // FREE tracked a permit while on Pro; the plan has since lapsed.
    db.tables.permit_watches.push({
      id: "11111111-2222-4333-8444-555555555555", user_id: FREE.id, org_id: null, jurisdiction: "boise",
      permit_number: "BLD26-00011", label: null, status: "In Review", passed_steps: ["submitted", "review"],
      notify_steps: ["issued"], notify_any: false, notify_alerts: true, notify_email: true, notify_app: true,
      created_at: JOINED, last_checked_at: JOINED,
    });
    const m = await mine(FREE);
    assert.equal(m.watches.length, 1, "the list is kept");
    const id = m.watches[0].id;
    assert.equal((await api("PATCH", `/api/permits/watch?id=${id}`, FREE, { label: "x" })).status, 403);
    assert.equal((await api("DELETE", `/api/permits/watch?id=${id}`, FREE)).status, 200, "stopping is never Pro");
    assert.equal(db.tables.permit_watches.length, 0);
  });

  await t.test("the owner adds a permit and tracks it for the firm", async () => {
    const m = await mine(BRAD);
    assert.equal(m.canTrack, true);
    assert.deepEqual(m.firm, { id: ORG, name: "Colliers Boise" });
    const add = await api("POST", "/api/permits/watch", BRAD, { jurisdiction: "boise", permitNumber: "BLD26-00010", label: "Federal Way" });
    assert.equal(add.status, 200, JSON.stringify(add.j));
    const on = await api("PATCH", `/api/permits/watch?id=${add.j.watch.id}`, BRAD, { firm: true });
    assert.equal(on.status, 200, JSON.stringify(on.j));
    assert.equal(on.j.watch.firm, "Colliers Boise");
    assert.equal(on.j.watch.label, "Federal Way", "the firm switch touches nothing else");
    firmWatch = on.j.watch.id;
    assert.equal(db.tables.permit_watches.find((w) => w.id === firmWatch).org_id, ORG);
  });

  await t.test("an admin is not the owner: the firm switch refuses", async () => {
    assert.equal((await mine(ADA)).firm, null);
    portal.statusOf["BLD26-00012"] = "In Review";
    const add = await api("POST", "/api/permits/watch", ADA, { jurisdiction: "boise", permitNumber: "BLD26-00012" });
    assert.equal(add.status, 200);
    const on = await api("PATCH", `/api/permits/watch?id=${add.j.watch.id}`, ADA, { firm: true });
    assert.equal(on.status, 403);
    assert.equal(db.tables.permit_watches.find((w) => w.id === add.j.watch.id).org_id, null);
  });

  await t.test("a Pro colleague sees the firm's permit, attributed; a free one and another firm do not", async () => {
    const ann = (await mine(ANN)).watches.find((w) => w.id === firmWatch);
    assert.ok(ann, "on Ann's list");
    assert.equal(ann.mine, false);
    assert.equal(ann.sharedBy, "Brad");
    assert.equal(ann.firm, "Colliers Boise");
    assert.equal(ann.muted, false);
    assert.equal((await mine(CY)).watches.length, 0, "a free colleague gets no firm permits");
    assert.equal((await mine(ZED)).watches.length, 0, "another firm's owner sees nothing");
    assert.equal((await api("PATCH", `/api/permits/watch?id=${firmWatch}`, ANN, { label: "mine" })).status, 404, "a colleague cannot change it");
    assert.equal((await api("DELETE", `/api/permits/watch?id=${firmWatch}`, ANN)).status, 404, "or remove it");
  });

  await t.test("muting is the member's own, and only for their firm's permits", async () => {
    assert.equal((await api("POST", "/api/permits/mute", DEE, { id: firmWatch, muted: true })).status, 200);
    assert.equal((await mine(DEE)).watches.find((w) => w.id === firmWatch).muted, true);
    assert.equal((await api("POST", "/api/permits/mute", ZED, { id: firmWatch, muted: true })).status, 404, "not Zed's firm");
    assert.equal((await api("POST", "/api/permits/mute", BRAD, { id: firmWatch, muted: true })).status, 404, "an owner changes their own settings instead");
    assert.equal(db.tables.permit_watch_mutes.length, 1);
  });

  await t.test("a member who tracks the same permit herself", async () => {
    const add = await api("POST", "/api/permits/watch", EVE, { jurisdiction: "boise", permitNumber: "BLD26-00010" });
    assert.equal(add.status, 200, JSON.stringify(add.j));
  });

  await t.test("the sweep copies the notice to each Pro colleague once, mails them, and spares the muted and the free", async () => {
    portal.statusOf["BLD26-00010"] = "Issued";
    const s = await sweep();
    assert.equal(s.status, 200, JSON.stringify(s.j));
    assert.deepEqual(s.j.watches.errors, []);

    assert.equal(eventsOf(BRAD, firmWatch).length, 1, "the owner's own");
    const ann = eventsOf(ANN, firmWatch);
    assert.equal(ann.length, 1);
    assert.equal(ann[0].app, true);
    assert.equal(ann[0].notice, "Steps complete: Approved and Issued");
    const dee = eventsOf(DEE, firmWatch);
    assert.equal(dee.length, 1, "muted: the history is still written");
    assert.equal(dee[0].app, false);
    assert.equal(dee[0].email_due, false);
    assert.equal(eventsOf(CY).length, 0, "a free colleague is not told");
    assert.equal(eventsOf(ADA, firmWatch).length, 1, "the admin is a Pro colleague too");
    assert.equal(eventsOf(EVE).length, 1, "Eve hears once, from her own watch");
    assert.notEqual(eventsOf(EVE)[0].watch_id, firmWatch);
    assert.equal(eventsOf(ZED).length, 0);
    assert.equal(s.j.watches.firmNotices, 2, "Ann and Ada");

    const sent = await fake.waitForMail(db, 4);
    const to = (p) => sent.filter((m) => JSON.stringify(m.to).includes(p.email));
    assert.equal(to(BRAD).length, 1);
    assert.doesNotMatch(to(BRAD)[0].text, /Tracked for/, "the owner reads it as their own");
    assert.equal(to(ANN).length, 1);
    assert.match(to(ANN)[0].text, /permit your firm is tracking/);
    assert.match(to(ANN)[0].text, /Tracked for Colliers Boise/);
    assert.match(to(ANN)[0].text, /mute any of them on the Permit tracker/);
    assert.equal(to(ADA).length, 1);
    assert.equal(to(EVE).length, 1);
    assert.equal(to(DEE).length, 0, "muted");
    assert.equal(to(CY).length, 0, "free");
    assert.ok(eventsOf(ANN, firmWatch)[0].emailed_at, "stamped after the send");

    assert.equal(await unread(ANN), 1);
    assert.equal(await unread(DEE), 0);
  });

  await t.test("switching the firm off takes the colleagues' copies with it", async () => {
    const off = await api("PATCH", `/api/permits/watch?id=${firmWatch}`, BRAD, { firm: false });
    assert.equal(off.status, 200);
    assert.equal(off.j.watch.firm, "");
    assert.equal(eventsOf(ANN, firmWatch).length, 0);
    assert.equal(await unread(ANN), 0, "no phantom dot for a permit Ann can no longer open");
    assert.equal(eventsOf(BRAD, firmWatch).length, 1, "the owner's own history stays");
    assert.equal((await mine(ANN)).watches.some((w) => w.id === firmWatch), false);
  });
});
