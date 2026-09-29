// test/member-card-run.test.js
// The member profile card (2026-09-29, Draft A), actually run: a real
// server.js against the stand-in PostgREST.
//
// What this proves that member-card.test.js cannot: the card is behind an
// active membership of THAT firm; an invitation and another firm's member
// have no card; every count reads a firm table scoped by the firm, so a
// colleague's private vault and their work for another firm never show; the
// seat line reaches an owner only; a title can be saved and read back; and a
// colleague's photo is served only inside the firm.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 864e5).toISOString();
const J = "2026-01-05T00:00:00.000Z";
const ORG = "0a9e0000-0000-4000-8000-0000000000d1";
const OTHER = "0a9e0000-0000-4000-8000-0000000000d2";
const P = (n, email, name) => ({ id: `5a1e9a1e-0000-4000-8000-00000000e0${n}`, email, name });
const BRAD = P("01", "brad@colliers.com", "Brad Nolan");
const MIKE = P("02", "mike@colliers.com", "Mike Chen");
const ZED = P("03", "zed@elsewhere.com", "Zed Ortiz");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const row = (id, org, p, role, extra) => ({ id, org_id: org, email: p.email, role, user_id: p.id, invited_at: J, joined_at: J, removed_at: null, ...extra });
const tables = () => ({
  users: [BRAD, MIKE, ZED].map((p) => ({ id: p.id, email: p.email, name: p.name, pro_tester: false, vault_beta: false, digest_optout: false, created_at: J, avatar_rev: p === MIKE ? "rev1" : "" })),
  sessions: [BRAD, MIKE, ZED].map((p) => ({ token_hash: sha256("tok-" + p.id), user_id: p.id, expires_at: YEAR_OUT })),
  subscriptions: [{ user_id: BRAD.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false }],
  orgs: [
    { id: ORG, name: "Colliers Boise", kind: "broker", share_default: "none", seats: null, created_at: J },
    { id: OTHER, name: "Elsewhere Realty", kind: "broker", share_default: "none", seats: null, created_at: J },
  ],
  org_members: [
    row("mem-brad", ORG, BRAD, "owner"),
    row("mem-mike", ORG, MIKE, "member"),
    row("mem-pend", ORG, { email: "new@colliers.com", id: null }, "member", { joined_at: null }),
    row("mem-zed", OTHER, ZED, "owner"),
    row("mem-mike2", OTHER, MIKE, "member"),
  ],
  org_subscriptions: [],
  user_avatars: [{ user_id: MIKE.id, data_uri: PNG }],
  broker_coverage: [
    { id: "c1", user_id: MIKE.id, market: "Meridian, ID", property_type: "Industrial" },
    { id: "c2", user_id: MIKE.id, market: "Boise, ID", property_type: "Office" },
  ],
  shared_reports: [
    { id: "r1", org_id: ORG, visibility: "org", revoked_at: null, user_id: MIKE.id, payload: {} },
    { id: "r2", org_id: ORG, visibility: "org", revoked_at: null, user_id: MIKE.id, payload: {} },
    { id: "r3", org_id: ORG, visibility: "org", revoked_at: "2026-02-01", user_id: MIKE.id, payload: {} },
    { id: "r4", org_id: OTHER, visibility: "org", revoked_at: null, user_id: MIKE.id, payload: {} },
    { id: "r5", org_id: null, visibility: "public", revoked_at: null, user_id: MIKE.id, payload: {} },
  ],
  org_comps: [
    { id: "oc1", org_id: ORG, shared_by_user_id: MIKE.id },
    { id: "oc2", org_id: OTHER, shared_by_user_id: MIKE.id },
  ],
  // Mike's private vault: never counted on any card.
  broker_comps: [1, 2, 3].map((i) => ({ id: `bc${i}`, user_id: MIKE.id, market: "Boise, ID", property_type: "Industrial" })),
  org_buildings: [{ id: "b1", org_id: ORG, added_by_user_id: MIKE.id, address_key: "1 main st" }],
  permit_watches: [],
});

test("the member profile card, end to end", async (t) => {
  const db = await fake.start({ tables: tables() });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
  });
  t.after(async () => { srv.stop(); await db.stop(); });
  const get = async (url, p) => {
    const r = await fetch(srv.base + url, { headers: p ? { cookie: `cn_session=tok-${p.id}` } : {} });
    const type = r.headers.get("content-type") || "";
    return { status: r.status, type, j: type.includes("json") ? await r.json() : null };
  };
  const card = (org, id, p) => get(`/api/org/person?org=${org}&id=${id}`, p);

  await t.test("the roster names people and says who has a photo", async () => {
    const r = await get(`/api/org/members?id=${ORG}`, BRAD);
    assert.equal(r.status, 200);
    const mike = r.j.members.find((m) => m.email === MIKE.email);
    assert.equal(mike.name, "Mike Chen");
    assert.equal(mike.photoRev, "rev1");
    assert.equal(r.j.members.find((m) => m.pending).name, "", "an invitation is an address, not yet a person");
  });

  await t.test("only a member of that firm opens a card, and only for an accepted member of it", async () => {
    assert.equal((await card(ORG, "mem-mike", null)).status, 401);
    assert.equal((await card(ORG, "mem-mike", ZED)).status, 403, "another firm's owner");
    assert.equal((await card(ORG, "mem-pend", BRAD)).status, 404, "an invitation has no card");
    assert.equal((await card(ORG, "mem-zed", BRAD)).status, 404, "another firm's member, asked through this firm");
  });

  await t.test("an owner sees coverage, firm-only counts and the seat line", async () => {
    const r = await card(ORG, "mem-mike", BRAD);
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.name, "Mike Chen");
    assert.equal(r.j.role, "member");
    assert.deepEqual(r.j.covers, [{ market: "Boise, ID", type: "Office" }, { market: "Meridian, ID", type: "Industrial" }]);
    assert.deepEqual(r.j.shared, { reports: 2, comps: 1, buildings: 1, permits: 0 },
      "a revoked share, a public link, the other firm's work and the private vault are none of this firm's count");
    assert.deepEqual(r.j.seat, { pro: false, viaFirm: false });
    assert.equal(JSON.stringify(r.j).includes("bc1"), false);
  });

  await t.test("a member reading the owner's card is not told the owner's plan", async () => {
    const r = await card(ORG, "mem-brad", MIKE);
    assert.equal(r.status, 200);
    assert.equal(r.j.seat, null);
    assert.equal(r.j.self, false);
    assert.equal((await card(ORG, "mem-brad", BRAD)).j.self, true);
  });

  await t.test("a title is saved on your own account and shows on your card", async () => {
    const put = (title) => fetch(srv.base + "/api/account/profile", {
      method: "PATCH", headers: { "content-type": "application/json", cookie: `cn_session=tok-${MIKE.id}` }, body: JSON.stringify({ title }),
    });
    assert.equal((await put("x".repeat(81))).status, 400);
    const ok = await put("  Associate · Industrial ");
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).title, "Associate · Industrial");
    assert.equal((await card(ORG, "mem-mike", BRAD)).j.title, "Associate · Industrial");
    assert.equal(db.tables.users.find((u) => u.id === BRAD.id).title, undefined, "nobody else's row moved");
  });

  await t.test("a colleague's photo is served inside the firm only", async () => {
    const ok = await get(`/api/org/person/photo?org=${ORG}&id=mem-mike&v=rev1`, BRAD);
    assert.equal(ok.status, 200);
    assert.match(ok.type, /image\/png/);
    assert.equal((await get(`/api/org/person/photo?org=${ORG}&id=mem-mike`, ZED)).status, 403);
    assert.equal((await get(`/api/org/person/photo?org=${ORG}&id=mem-brad`, MIKE)).status, 404, "no photo is a 404");
  });

  await t.test("the fake never had to guess at a filter it did not understand", () => {
    assert.deepEqual(db.unparsed, []);
  });
});
