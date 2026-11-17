// A deal room guest's name (2026-11-17, migration 063), against a real
// server and the stand-in database.
//
// A guest invited by address with no account was named everywhere by the
// start of that address. Now the room's owner can give them a name, on the
// invitation or later, and the list, the room and its messages use it. The
// column is PROBED: before 063 runs, every deal room route keeps working and
// names are simply not offered.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

const OWNER = { id: "u-owner", email: "owner@firm.example", name: "Olive Owner" };
const OTHER = { id: "u-other", email: "other@firm.example", name: "Otto Other" };
const GUEST = "jordan@guest.example";

function seedTables() {
  return {
    users: [OWNER, OTHER].map((u) => ({ ...u, pro_tester: false, vault_beta: false, digest_optout: false })),
    sessions: [OWNER, OTHER].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
    subscriptions: [OWNER, OTHER].map((u) => ({ user_id: u.id, plan: "pro_monthly", status: "active",
      current_period_end: YEAR_OUT, cancel_at_period_end: false })),
    orgs: [{ id: "org-1", name: "Test Firm", kind: "broker", share_default: "none", seats: 10 }],
    org_members: [OWNER, OTHER].map((u, i) => ({ id: "m-" + u.id, org_id: "org-1", email: u.email, user_id: u.id,
      role: i ? "member" : "owner", invited_at: "2026-08-01T00:00:00.000Z", joined_at: "2026-08-01T00:00:00.000Z", removed_at: null })),
    broker_comps: [], broker_properties: [],
    msg_threads: [], msg_thread_members: [], msg_messages: [], msg_comps: [], msg_comp_saves: [],
    hubs: [{ id: "hubNAME01", owner_user_id: OWNER.id, title: "Warehouse search", market: "Boise, ID",
      property_type: "Industrial", subject_address: null, status: "active", closed_at: null,
      created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z" }],
    hub_participants: [{ id: "hp1", hub_id: "hubNAME01", email: GUEST, role: "tenant", user_id: null,
      token_hash: "x", invited_at: "2026-11-01T00:00:00.000Z", first_viewed_at: null, last_seen_at: null, removed_at: null }],
    hub_items: [], hub_messages: [], hub_notify: [], hub_email_prefs: [],
    analytics_events: [], export_usage: [], report_purchases: [],
  };
}

async function bootWith(t, opts) {
  const tables = seedTables();
  const db = await fake.start({ tables, ...(opts || {}) });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key", SITE_URL: "https://compninja.co",
  });
  t.after(async () => { srv.stop(); await db.stop(); });
  const call = async (user, method, url, body) => {
    const r = await fetch(srv.base + url, { method, headers: { "content-type": "application/json",
      cookie: "cn_session=tok-" + user.id }, body: body ? JSON.stringify(body) : undefined });
    return { s: r.status, j: await r.json().catch(() => ({})) };
  };
  return { tables, call };
}

test("the owner names a guest, and the room is called by that name", async (t) => {
  const { tables, call } = await bootWith(t);
  const before = await call(OWNER, "GET", "/api/messages");
  assert.equal(before.s, 200);
  assert.equal(before.j.external[0].label, "jordan", "the start of the address, until named");

  const hub = await call(OWNER, "GET", "/api/hub?id=hubNAME01");
  assert.equal(hub.j.guestNames, true, "the page is not told names can be saved");
  assert.equal(hub.j.people[0].name, "");

  // Renaming goes through the same list route with the list unchanged.
  const put = await call(OWNER, "PUT", "/api/hub/participants", { id: "hubNAME01", emails: [GUEST], names: { [GUEST.toUpperCase()]: "  Jordan   Lee " } });
  assert.equal(put.s, 200);
  assert.deepEqual(put.j.invites, [], "naming somebody re-invited them");
  assert.equal(tables.hub_participants[0].name, "Jordan Lee", "trimmed and folded to one space");

  const after = await call(OWNER, "GET", "/api/messages");
  assert.equal(after.j.external[0].label, "Jordan Lee");
  assert.equal(after.j.external[0].people[0].name, "Jordan Lee");
  assert.equal(after.j.external[0].people[0].given, "Jordan Lee");
  assert.equal((await call(OWNER, "GET", "/api/hub?id=hubNAME01")).j.people[0].name, "Jordan Lee");

  // A name over 80 characters is refused, not cut, and leaves the old one.
  await call(OWNER, "PUT", "/api/hub/participants", { id: "hubNAME01", emails: [GUEST], names: { [GUEST]: "x".repeat(81) } });
  assert.equal(tables.hub_participants[0].name, "Jordan Lee");
  // A request that names nobody leaves names alone; an empty name clears it.
  await call(OWNER, "PUT", "/api/hub/participants", { id: "hubNAME01", emails: [GUEST] });
  assert.equal(tables.hub_participants[0].name, "Jordan Lee");
  await call(OWNER, "PUT", "/api/hub/participants", { id: "hubNAME01", emails: [GUEST], names: { [GUEST]: "" } });
  assert.equal(tables.hub_participants[0].name, null);
});

test("a name is given with the invitation, and only by the room's owner", async (t) => {
  const { tables, call } = await bootWith(t);
  const add = await call(OWNER, "PUT", "/api/hub/participants", { id: "hubNAME01",
    emails: [GUEST, "sam@guest.example"], names: { "sam@guest.example": "Sam Park" } });
  assert.equal(add.s, 200);
  assert.equal(tables.hub_participants.find((p) => p.email === "sam@guest.example").name, "Sam Park");
  // A colleague who does not own the room cannot name its guests.
  const no = await call(OTHER, "PUT", "/api/hub/participants", { id: "hubNAME01", emails: [GUEST], names: { [GUEST]: "Nope" } });
  assert.notEqual(no.s, 200);
  assert.ok(!tables.hub_participants.some((p) => p.name === "Nope"));
  // A new room carries a name given at creation.
  const made = await call(OWNER, "POST", "/api/hubs", { title: "", participants: ["ana@guest.example"], names: { "ana@guest.example": "Ana Ruiz" } });
  assert.equal(made.s, 201);
  assert.equal(tables.hub_participants.find((p) => p.email === "ana@guest.example").name, "Ana Ruiz");
});

test("before migration 063 every deal room route works and names are not offered", async (t) => {
  const { tables, call } = await bootWith(t, { missingColumns: { hub_participants: ["name"] } });
  const list = await call(OWNER, "GET", "/api/messages");
  assert.equal(list.s, 200, "the list read named a column that is not there");
  assert.equal(list.j.external[0].label, "jordan");
  const hub = await call(OWNER, "GET", "/api/hub?id=hubNAME01");
  assert.equal(hub.s, 200);
  assert.equal(hub.j.guestNames, false);
  const put = await call(OWNER, "PUT", "/api/hub/participants", { id: "hubNAME01", emails: [GUEST, "new@guest.example"], names: { "new@guest.example": "New Person" } });
  assert.equal(put.s, 200, "inviting with a name failed before the column exists");
  assert.ok(tables.hub_participants.every((p) => !("name" in p)), "a name was written to a column that is not there");
  const made = await call(OWNER, "POST", "/api/hubs", { title: "", participants: ["ana@guest.example"], names: { "ana@guest.example": "Ana Ruiz" } });
  assert.equal(made.s, 201);
});
