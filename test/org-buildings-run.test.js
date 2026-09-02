// The firm's buildings, actually run: GET|POST|DELETE /api/org/buildings
// through the real server against the stand-in PostgREST (migration 045).
//
// A DB-only feature can only be proved this way — the routes refuse without a
// database, so a bare boot stops at the 503. What is proved here and nowhere
// else: a member adds a building from a verified portfolio row and a
// colleague reads it attributed; adding it again is idempotent and FILLS the
// verified key it lacked without rewriting anything else; an outsider is
// refused; the delete is scoped by org as well as id; the truncation flag and
// the summary line come from the whole set; and an unrun migration answers a
// 503 for these routes alone.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const VAULT = require("../broker-vault");
const PFMATCH = require("../portfolio-match");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const NOW = new Date().toISOString();
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

const BRAD = { id: "u-brad", email: "brad@colliers.com", name: "Brad" };
const MIKE = { id: "u-mike", email: "mike@colliers.com", name: "Mike" };
const OUTSIDER = { id: "u-out", email: "nobody@else.com", name: "Nobody" };
const ORG_ID = "9c1e9a1e-0000-4000-8000-000000000001";
const OTHER_ORG = "9c1e9a1e-0000-4000-8000-000000000002";

function seedTables() {
  const member = (u, org, role) => ({
    id: crypto.randomUUID(), org_id: org, email: u.email, user_id: u.id, role,
    invited_at: NOW, joined_at: NOW, removed_at: null, auto_share: null,
  });
  return {
    users: [BRAD, MIKE, OUTSIDER].map((u) => ({ ...u, pro_tester: false, vault_beta: false })),
    sessions: [BRAD, MIKE, OUTSIDER].map((u) => ({
      token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT,
    })),
    orgs: [
      { id: ORG_ID, name: "Colliers Boise", share_default: "none", seats: 5, kind: "broker" },
      { id: OTHER_ORG, name: "Elsewhere LLC", share_default: "none", seats: 5, kind: "broker" },
    ],
    org_members: [member(BRAD, ORG_ID, "owner"), member(MIKE, ORG_ID, "member"), member(OUTSIDER, OTHER_ORG, "owner")],
    org_buildings: [],
    analytics_events: [],
  };
}

const as = (user, init = {}) => ({
  ...init,
  headers: { "content-type": "application/json", cookie: `cn_session=tok-${user.id}`, ...(init.headers || {}) },
});

async function bootWithDb(tables, opts) {
  const db = await fake.start({ tables, ...(opts || {}) });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
  });
  return { db, srv, stop: async () => { srv.stop(); await db.stop(); } };
}

test("the firm's buildings, end to end", async (t) => {
  const tables = seedTables();
  const ctx = await bootWithDb(tables);
  t.after(() => ctx.stop());
  const { srv, db } = ctx;
  const url = (org, extra) => `${srv.base}/api/org/buildings?id=${encodeURIComponent(org)}${extra || ""}`;
  let firstId = null;

  await t.test("a signed-out caller is refused first", async () => {
    for (const method of ["GET", "POST", "DELETE"]) {
      const r = await fetch(url(ORG_ID), { method, headers: { "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined });
      assert.equal(r.status, 401, method);
    }
  });

  await t.test("a member adds a building from a verified portfolio row", async () => {
    const r = await fetch(url(ORG_ID), as(BRAD, {
      method: "POST",
      body: JSON.stringify({
        address: "1210 N 17th St, Boise, ID", propertyType: "industrial", sizeSqft: "12,500 SF",
        yearBuilt: "1994", verifiedKey: "1210 N 17th St, Boise, ID 83702", lat: 43.62, lng: -116.21,
      }),
    }));
    const text = await r.text();
    assert.equal(r.status, 200, text);
    const body = JSON.parse(text);
    assert.equal(body.existed, false);
    firstId = body.building.id;
    assert.equal(body.building.type, "Industrial", "the vault's vocabulary, case-corrected");
    assert.equal(body.building.sizeSqft, 12500);
    assert.equal(body.building.mine, true);
    const stored = tables.org_buildings[0];
    assert.equal(tables.org_buildings.length, 1);
    assert.equal(stored.org_id, ORG_ID);
    assert.equal(stored.address_key, VAULT.addressKey("1210 N 17th St, Boise, ID"), "the vault's key");
    assert.equal(stored.verified_key, PFMATCH.verifiedKeyFor("1210 N 17th St, Boise, ID 83702"), "the portfolio's key");
    assert.equal(stored.market, "Boise, ID");
    assert.equal(stored.added_by_user_id, BRAD.id);
    assert.equal(stored.added_by_name, "Brad", "name snapshotted, never the email");
  });

  await t.test("adding it again is idempotent, and fills what the first add lacked", async () => {
    // Seed a second building with no verified key, then re-add it from a
    // door that has one: the key is FILLED and nothing else is rewritten —
    // the first adder keeps the attribution.
    tables.org_buildings.push({
      id: "9c1e9a1e-0000-4000-8000-0000000000b2", org_id: ORG_ID,
      address: "500 Warehouse Way, Boise, ID", address_key: VAULT.addressKey("500 Warehouse Way, Boise, ID"),
      verified_key: null, market: "Boise, ID", property_type: "Industrial", size_sqft: 40000, year_built: null,
      lat: null, lng: null, added_by_user_id: MIKE.id, added_by_name: "Mike", created_at: NOW, updated_at: NOW,
    });
    const r = await fetch(url(ORG_ID), as(BRAD, {
      method: "POST",
      body: JSON.stringify({ address: "500 Warehouse Way, Boise, ID", propertyType: "Retail",
        sizeSqft: 1, verifiedKey: "500 Warehouse Way, Boise, ID 83702" }),
    }));
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.existed, true, "the second add is not an error and not a second row");
    assert.equal(tables.org_buildings.length, 2);
    const row = tables.org_buildings.find((b) => b.id === "9c1e9a1e-0000-4000-8000-0000000000b2");
    assert.equal(row.verified_key, PFMATCH.verifiedKeyFor("500 Warehouse Way, Boise, ID 83702"), "filled");
    assert.equal(row.property_type, "Industrial", "never rewritten");
    assert.equal(row.size_sqft, 40000, "never rewritten");
    assert.equal(row.added_by_name, "Mike", "the first adder keeps the attribution");
    assert.equal(body.building.mine, false, "and the response says so to the second adder");

    // A third add with no verified key changes nothing at all.
    const again = await (await fetch(url(ORG_ID), as(BRAD, {
      method: "POST", body: JSON.stringify({ address: "500 Warehouse Way, Boise, ID" }),
    }))).json();
    assert.equal(again.existed, true);
    assert.equal(tables.org_buildings.length, 2);
  });

  await t.test("a colleague reads the whole list, attributed, with the count for the whole set", async () => {
    const r = await fetch(url(ORG_ID), as(MIKE));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.buildings.length, 2);
    assert.equal(body.truncated, false);
    assert.equal(body.summary, "2 buildings · 2 Industrial");
    const first = body.buildings.find((b) => b.id === firstId);
    assert.equal(first.mine, false);
    assert.equal(first.addedBy, "Brad");
    assert.equal(first.verifiedKey, PFMATCH.verifiedKeyFor("1210 N 17th St, Boise, ID 83702"),
      "the keys ride to the browser so the desk's doors can match without a key of their own");
    for (const b of body.buildings) {
      assert.equal(Object.prototype.hasOwnProperty.call(b, "org_id"), false, "wire shape is an allowlist");
      assert.equal(Object.prototype.hasOwnProperty.call(b, "added_by_user_id"), false);
    }
  });

  await t.test("what the module refuses, the route refuses with the same words", async () => {
    const r = await fetch(url(ORG_ID), as(BRAD, { method: "POST", body: JSON.stringify({ address: "Boise, ID" }) }));
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /street number/);
    assert.equal(tables.org_buildings.length, 2, "nothing written");
  });

  await t.test("an outsider is refused, and cannot read or write another firm's board", async () => {
    const read = await fetch(url(ORG_ID), as(OUTSIDER));
    assert.equal(read.status, 403);
    const write = await fetch(url(ORG_ID), as(OUTSIDER, {
      method: "POST", body: JSON.stringify({ address: "1 Sneaky St, Boise, ID" }),
    }));
    assert.equal(write.status, 403);
    assert.equal(tables.org_buildings.length, 2);
    // Their own firm's list is empty — the other firm's rows never cross.
    const own = await (await fetch(url(OTHER_ORG), as(OUTSIDER))).json();
    assert.equal(own.buildings.length, 0);
    assert.equal(own.summary, "");
  });

  await t.test("the delete is scoped by the firm as well as the id", async () => {
    const wrongFirm = await fetch(url(OTHER_ORG, `&building=${firstId}`), as(OUTSIDER, { method: "DELETE" }));
    assert.equal(wrongFirm.status, 404, "knowing a building's id is not enough to take it off another firm's board");
    assert.equal(tables.org_buildings.length, 2);
    const bad = await fetch(url(ORG_ID, "&building=not-a-uuid"), as(MIKE, { method: "DELETE" }));
    assert.equal(bad.status, 400);
    const r = await fetch(url(ORG_ID, `&building=${firstId}`), as(MIKE, { method: "DELETE" }));
    assert.equal(r.status, 200, "any member may remove one — a building is the firm's index, and removing it is undone by adding it again");
    assert.equal(tables.org_buildings.length, 1);
    assert.equal(tables.org_buildings.some((b) => b.id === firstId), false);
  });

  await t.test("the fake refused nothing", () => {
    assert.deepEqual(db.unparsed, [], "server.js sent a filter the fake could not parse; teach it deliberately");
  });
});

test("before migration 045 runs, only the buildings routes are down", async (t) => {
  // PGRST205 for the table: the shape a real PostgREST answers, which
  // schemaMismatch detection reads. These routes answer 503; nothing else on
  // the firm surface reads the table, so nothing else is touched.
  const tables = seedTables();
  delete tables.org_buildings;
  const ctx = await bootWithDb(tables, { missingTables: ["org_buildings"] });
  t.after(() => ctx.stop());
  const r = await fetch(`${ctx.srv.base}/api/org/buildings?id=${ORG_ID}`, as(BRAD));
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /try again/i);
  const members = await fetch(`${ctx.srv.base}/api/org/members?id=${ORG_ID}`, as(BRAD));
  assert.equal(members.status, 200, "the rest of the firm surface is untouched by the unrun migration");
});
