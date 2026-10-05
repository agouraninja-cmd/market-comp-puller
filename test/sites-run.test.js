// The /api/sites routes (migration 060), actually run: the real server against
// the stand-in PostgREST. sites.js's own suite proves the rules; only a boot
// can prove the gate is wired in the right order, that every read and write
// is scoped to the caller, that a status can only be attached to the caller's
// OWN property, and that an unrun migration costs the Sites tab and nothing
// else.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const DAY = 86400000;
const NOW = new Date().toISOString();
const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
const P_MAYA = "6f0d3c1e-1111-4111-8111-000000000001";
const P_MAYA_2 = "6f0d3c1e-1111-4111-8111-000000000002";
const P_OTHER = "6f0d3c1e-2222-4222-8222-000000000003";

function baseTables() {
  const session = (id, user) => ({ id, user_id: user, token_hash: hash("tok-" + user),
    expires_at: new Date(Date.now() + 30 * DAY).toISOString() });
  return {
    users: [
      { id: "u-maya", email: "maya@ridgeline.example", name: "Maya", vault_beta: true },
      { id: "u-pro2", email: "sam@other.example", name: "Sam", vault_beta: true },
      { id: "u-free", email: "jo@free.example", name: "Jo", vault_beta: false },
    ],
    sessions: [session("s1", "u-maya"), session("s2", "u-pro2"), session("s3", "u-free")],
    portfolio_items: [
      { id: P_MAYA, user_id: "u-maya", address: "1450 S Eagle Rd, Meridian, ID 83642", property_type: "Industrial",
        payload: {}, snapshots: [], created_at: NOW, updated_at: NOW },
      { id: P_MAYA_2, user_id: "u-maya", address: "2850 S Cole Rd, Boise, ID 83709", property_type: "Industrial",
        payload: {}, snapshots: [], created_at: NOW, updated_at: NOW },
      { id: P_OTHER, user_id: "u-pro2", address: "9 Other St, Boise, ID 83702", property_type: "Office",
        payload: {}, snapshots: [], created_at: NOW, updated_at: NOW },
    ],
    user_sites: [],
  };
}

const as = (user, init = {}) => ({
  ...init,
  headers: { "content-type": "application/json", cookie: `cn_session=tok-${user}`, ...(init.headers || {}) },
});
const post = (srv, path, user, body) => fetch(srv.base + path, as(user, { method: "POST", body: JSON.stringify(body) }));

async function bootWith(t, opts) {
  const tables = baseTables();
  const db = await fake.start({ tables, ...(opts || {}) });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
  });
  t.after(async () => { srv.stop(); await db.stop(); });
  return { tables, db, srv };
}

test("the Sites routes, end to end", async (t) => {
  const { tables, db, srv } = await bootWith(t);
  let dealId = null;

  await t.test("the gate refuses in order: no session, then no Pro", async () => {
    const anon = await fetch(srv.base + "/api/sites");
    assert.equal(anon.status, 401);
    const free = await fetch(srv.base + "/api/sites", as("u-free"));
    assert.equal(free.status, 403);
    assert.match((await free.json()).error, /part of Pro/);
  });

  await t.test("a new deal lands on Prospect, today, scoped to its owner", async () => {
    const r = await post(srv, "/api/sites", "u-maya", { address: "2410 W Amity Rd, Meridian, ID 83642",
      acres: "18.4", zoning: "R-8", asking_price: "$3,450,000",
      dates: [{ on: "2099-10-18", label: "Due diligence ends" }] });
    assert.equal(r.status, 200);
    const { site } = await r.json();
    assert.ok(site && site.id, "the stored row came back");
    dealId = site.id;
    const row = tables.user_sites.find((s) => s.id === dealId);
    assert.equal(row.user_id, "u-maya");
    assert.equal(row.stage, "prospect");
    assert.equal(row.market, "Meridian, ID", "the market is computed server-side");
    assert.equal(row.asking_price, 3450000);
    assert.equal(row.portfolio_item_id, null);
    assert.equal(Object.keys(row.stage_dates)[0], "prospect");
    assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));
  });

  await t.test("a figure the rules refuse is a 400 with the sentence, and nothing is stored", async () => {
    const before = tables.user_sites.length;
    const r = await post(srv, "/api/sites", "u-maya", { address: "1 Main St, Boise, ID", asking_price: "3.4M" });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /full figure/);
    assert.equal(tables.user_sites.length, before);
  });

  await t.test("the list answers the caller's own rows and the server's today", async () => {
    const mine = await (await fetch(srv.base + "/api/sites", as("u-maya"))).json();
    assert.equal(mine.sites.length, 1);
    assert.match(mine.today, /^\d{4}-\d{2}-\d{2}$/);
    const theirs = await (await fetch(srv.base + "/api/sites", as("u-pro2"))).json();
    assert.deepEqual(theirs.sites, [], "another member read Maya's deal");
  });

  await t.test("a stage move stamps the day and keeps the history", async () => {
    const r = await post(srv, "/api/sites/update", "u-maya", { id: dealId, stage: "contract" });
    assert.equal(r.status, 200);
    const { site } = await r.json();
    assert.equal(site.stage, "contract");
    assert.deepEqual(Object.keys(site.stage_dates).sort(), ["contract", "prospect"]);
  });

  await t.test("another member can neither edit nor delete Maya's deal", async () => {
    const edit = await post(srv, "/api/sites/update", "u-pro2", { id: dealId, stage: "passed" });
    assert.equal(edit.status, 404);
    const del = await fetch(srv.base + "/api/sites?id=" + dealId, as("u-pro2", { method: "DELETE" }));
    assert.equal(del.status, 200, "a foreign id answers ok: no existence oracle");
    const row = tables.user_sites.find((s) => s.id === dealId);
    assert.ok(row, "the delete reached another member's row");
    assert.equal(row.stage, "contract");
  });

  await t.test("a deal becomes Owned only with the caller's own property", async () => {
    const alone = await post(srv, "/api/sites/update", "u-maya", { id: dealId, stage: "owned" });
    assert.equal(alone.status, 400);
    const foreign = await post(srv, "/api/sites/update", "u-maya", { id: dealId, stage: "owned", portfolio_item_id: P_OTHER });
    assert.equal(foreign.status, 404, "a status was attached to somebody else's building");
    const ok = await post(srv, "/api/sites/update", "u-maya", { id: dealId, stage: "owned", portfolio_item_id: P_MAYA });
    assert.equal(ok.status, 200);
    const row = tables.user_sites.find((s) => s.id === dealId);
    assert.equal(row.stage, "owned");
    assert.equal(row.portfolio_item_id, P_MAYA);
  });

  await t.test("marking a held property Tracking twice keeps one status row", async () => {
    const body = { address: "2850 S Cole Rd, Boise, ID 83709", property_type: "Industrial",
      stage: "tracking", portfolio_item_id: P_MAYA_2 };
    const first = await post(srv, "/api/sites", "u-maya", body);
    assert.equal(first.status, 200);
    const again = await post(srv, "/api/sites", "u-maya", body);
    assert.equal(again.status, 200);
    assert.equal((await again.json()).existed, true);
    assert.equal(tables.user_sites.filter((s) => s.portfolio_item_id === P_MAYA_2).length, 1);
    const foreign = await post(srv, "/api/sites", "u-maya", { ...body, portfolio_item_id: P_OTHER });
    assert.equal(foreign.status, 404);
  });

  await t.test("the owner removes a row", async () => {
    const del = await fetch(srv.base + "/api/sites?id=" + dealId, as("u-maya", { method: "DELETE" }));
    assert.equal(del.status, 200);
    assert.ok(!tables.user_sites.some((s) => s.id === dealId));
    assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));
  });
});

test("an unrun migration costs the Sites tab and nothing else", async (t) => {
  const { srv } = await bootWith(t, { missingTables: ["user_sites"] });
  const r = await fetch(srv.base + "/api/sites", as("u-maya"));
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /Couldn't load your sites/);
  // The Properties read the tab sits beside is untouched.
  const pf = await fetch(srv.base + "/api/portfolio", as("u-maya"));
  assert.equal(pf.status, 200);
  assert.equal((await pf.json()).items.length, 2);
});
