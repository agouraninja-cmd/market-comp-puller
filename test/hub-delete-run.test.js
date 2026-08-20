// Deleting a hub, actually done.
//
// hub-routes.test.js reads the route's SHAPE out of server.js — that the
// owner is in the DELETE's own filter, that the children are left to the FK
// cascade. This runs it, because the property that matters here is not a
// shape: a hub id is a short public string every participant already holds,
// so "another broker cannot delete my hub" has to be executed to be believed.
//
// The fake understands only the query shapes server.js sends and 400s on
// anything else, so a filter it stops understanding fails a test rather than
// quietly matching every row — which for a DELETE is the difference between
// proving a scoped delete and proving nothing at all.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 86400000).toISOString();

const OWNER = { id: "11111111-1111-1111-1111-111111111111", email: "owner@firm.com", name: "Owner" };
const OTHER = { id: "22222222-2222-2222-2222-222222222222", email: "other@firm.com", name: "Other" };

function seed() {
  return {
    users: [OWNER, OTHER].map((u) => ({ ...u, pro_tester: false, vault_beta: true, digest_optout: false })),
    sessions: [OWNER, OTHER].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
    hubs: [
      { id: "hubaaa111", owner_user_id: OWNER.id, title: "Warehouse requirement", market: "Boise, ID",
        property_type: "Industrial", status: "active", created_at: YEAR_OUT, updated_at: YEAR_OUT },
      { id: "hubbbb222", owner_user_id: OTHER.id, title: "Somebody else's", market: "Boise, ID",
        property_type: "Industrial", status: "active", created_at: YEAR_OUT, updated_at: YEAR_OUT },
    ],
    hub_participants: [], hub_items: [], hub_messages: [], analytics_events: [],
  };
}

const as = (user, init = {}) => ({
  ...init,
  headers: { "content-type": "application/json", cookie: `cn_session=tok-${user.id}`, ...(init.headers || {}) },
});

test("deleting a hub", async (t) => {
  const tables = seed();
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
  });
  t.after(async () => { srv.stop(); await db.stop(); });

  await t.test("an anonymous caller cannot delete anything", async () => {
    const r = await fetch(srv.base + "/api/hub?id=hubaaa111", { method: "DELETE" });
    assert.equal(r.status, 401);
    assert.equal(tables.hubs.length, 2);
  });

  await t.test("another broker's delete removes nothing and reveals nothing", async () => {
    // 404, the same answer an id that never existed gets. Anything else
    // confirms to a stranger that this hub is real.
    const r = await fetch(srv.base + "/api/hub?id=hubaaa111", as(OTHER, { method: "DELETE" }));
    assert.equal(r.status, 404);
    assert.equal(tables.hubs.length, 2, "and the hub is still there");
    assert.ok(tables.hubs.some((h) => h.id === "hubaaa111"));
  });

  await t.test("a malformed id is refused before any query", async () => {
    for (const id of ["", "short", "not a hub id at all!!"]) {
      const r = await fetch(srv.base + "/api/hub?id=" + encodeURIComponent(id), as(OWNER, { method: "DELETE" }));
      assert.equal(r.status, 400, JSON.stringify(id));
    }
    assert.equal(tables.hubs.length, 2);
  });

  await t.test("the owner's delete removes their hub and only theirs", async () => {
    const r = await fetch(srv.base + "/api/hub?id=hubaaa111", as(OWNER, { method: "DELETE" }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).deleted, true);
    assert.deepEqual(tables.hubs.map((h) => h.id), ["hubbbb222"],
      "the other broker's hub must be untouched");
  });

  await t.test("deleting the same hub twice is a 404, not a 500", async () => {
    const r = await fetch(srv.base + "/api/hub?id=hubaaa111", as(OWNER, { method: "DELETE" }));
    assert.equal(r.status, 404);
  });

  await t.test("it deletes the hub row only — the children are the database's job", async () => {
    // Migration 024 gives every child table `on delete cascade`. Deleting them
    // by hand here would reintroduce a half-deleted state that one failed
    // request could leave behind; this asserts the route does not try.
    const deletes = db.requests.filter((q) => q.method === "DELETE");
    assert.ok(deletes.length, "there should have been a delete");
    assert.deepEqual([...new Set(deletes.map((q) => q.table))], ["hubs"]);
  });

  await t.test("the fake was never asked a query shape it could not parse", async () => {
    assert.deepEqual(db.unparsed, []);
  });
});

test("closing is still a different act from deleting", async (t) => {
  // The two endings must not converge: closing leaves everyone with what they
  // were shown, which is the honest end to a conversation a client relied on.
  const tables = seed();
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
  });
  t.after(async () => { srv.stop(); await db.stop(); });

  const r = await fetch(srv.base + "/api/hub/close",
    as(OWNER, { method: "POST", body: JSON.stringify({ id: "hubaaa111" }) }));
  assert.equal(r.status, 200);
  assert.equal(tables.hubs.length, 2, "closing deletes nothing");
  assert.equal(tables.hubs.find((h) => h.id === "hubaaa111").status, "closed");
});
