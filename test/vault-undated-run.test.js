// The undated sentinel (migration 042), actually run: a d04-shaped rows
// payload — real deals from a document with no date column — through the real
// server against the stand-in PostgREST. The pure tests prove normalizeRow's
// verdicts; only a boot can prove what the ROW that lands in the table looks
// like (explicit null, uniform keys in the batch insert), that the export
// route opts into the sentinel, and that the firm share refuses by name
// instead of answering ok while sharing nothing.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const DAY = 86400000;
const NOW = new Date().toISOString();
const TOKEN = "test-session-token";
const TOKEN_HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");
const ORG_ID = "9c1e9a1e-0000-4000-8000-000000000001";

function baseTables() {
  return {
    users: [{ id: "u1", email: "broker@example.com", name: "Brad", vault_beta: true }],
    sessions: [
      { id: "s1", user_id: "u1", token_hash: TOKEN_HASH,
        expires_at: new Date(Date.now() + 30 * DAY).toISOString() },
    ],
    broker_comps: [], broker_uploads: [], broker_properties: [],
    broker_profiles: [
      { id: "p1", user_id: "u1", email: "broker@example.com",
        display_name: "Brad", company: "Test & Co", public: false },
    ],
    orgs: [{ id: ORG_ID, name: "Colliers Boise", share_default: "none", seats: 5, kind: "broker" }],
    org_members: [
      { id: "9c1e9a1e-0000-4000-8000-000000000011", org_id: ORG_ID,
        email: "broker@example.com", user_id: "u1", role: "owner",
        invited_at: NOW, joined_at: NOW, removed_at: null, auto_share: null },
    ],
    org_comps: [],
  };
}

const as = (init = {}) => ({
  ...init,
  headers: { "content-type": "application/json", cookie: `cn_session=${TOKEN}`, ...(init.headers || {}) },
});

test("the undated sentinel, end to end", async (t) => {
  const tables = baseTables();
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    // The upload's fire-and-forget geocode must not reach the real Census
    // endpoint from a test; a 404ing stub path is swallowed by design.
    CENSUS_API_URL: db.url + "/census-stub",
  });
  t.after(async () => { srv.stop(); await db.stop(); });

  let undatedId = null;
  let datedId = null;

  await t.test("a dateless document's deals import, stored as an explicit null", async () => {
    const r = await fetch(srv.base + "/api/vault/upload", as({
      method: "POST",
      body: JSON.stringify({
        filename: "d04.pdf",
        rows: [
          { address: "200 Cottontail Lane, Somerset, NJ", property_type: "Industrial",
            transaction: "sale", deal_date: "undated", price: "21500000", size_sqft: "347000" },
          { address: "1501 Cottontail Lane, Somerset, NJ", property_type: "Industrial",
            transaction: "sale", deal_date: "2026-02-14", price: "9800000", size_sqft: "120000" },
        ],
      }),
    }));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.imported, 2, JSON.stringify(body));
    const undated = tables.broker_comps.find((c) => c.address_key.startsWith("200 cottontail"));
    const dated = tables.broker_comps.find((c) => c.address_key.startsWith("1501 cottontail"));
    assert.ok(undated && dated, "both rows landed");
    undatedId = undated.id; datedId = dated.id;
    assert.equal(undated.deal_date, null, "stored as SQL null, not a string");
    assert.equal(Object.prototype.hasOwnProperty.call(undated, "deal_date"), true,
      "the key is present — a mixed batch must keep uniform keys for PostgREST");
    assert.equal(undated.dedupe_key, "200 cottontail lane somerset nj||21500000");
    assert.equal(dated.deal_date, "2026-02-14", "the dated row is untouched by the sentinel");
  });

  await t.test("re-importing the book's own export is a no-op, not a refusal", async () => {
    const exp = await fetch(srv.base + "/api/vault/export.csv", as());
    assert.equal(exp.status, 200);
    const csv = await exp.text();
    assert.match(csv, /undated/, "the export writes the sentinel for the stored null");
    const r = await fetch(srv.base + "/api/vault/upload", as({
      method: "POST", body: JSON.stringify({ filename: "book.csv", csv }),
    }));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.imported, 0, "every exported row deduped against itself: " + JSON.stringify(body));
    assert.equal(tables.broker_comps.length, 2, "and nothing was double-stored");
  });

  await t.test("sharing an undated comp with the firm refuses by name", async () => {
    const r = await fetch(srv.base + "/api/vault/firm", as({
      method: "POST", body: JSON.stringify({ orgId: ORG_ID, compIds: [undatedId] }),
    }));
    assert.equal(r.status, 400,
      "a 200 here would show 'Shared' for a comp no colleague's report can ever window in");
    const body = await r.json();
    assert.match(body.error, /undated/i);
    assert.match(body.error, /deal date/i, "and it says what fixes it");
    assert.equal(tables.org_comps.length, 0, "nothing landed on the shelf");
  });

  await t.test("a dated comp still shares — the refusal is the sentinel's, not the route's", async () => {
    const r = await fetch(srv.base + "/api/vault/firm", as({
      method: "POST", body: JSON.stringify({ orgId: ORG_ID, compIds: [datedId] }),
    }));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.count, 1);
    assert.equal(tables.org_comps.length, 1);
  });

  await t.test("editing a shared comp to undated pulls the firm's copy rather than leaving it stale", async () => {
    const r = await fetch(srv.base + `/api/vault/comp?id=${datedId}`, as({
      method: "PATCH", body: JSON.stringify({ deal_date: "undated" }),
    }));
    assert.equal(r.status, 200, await r.text());
    const row = tables.broker_comps.find((c) => c.id === datedId);
    assert.equal(row.deal_date, null, "the edit landed");
    assert.equal(tables.org_comps.length, 0,
      "the firm copy is withdrawn — a stale dated copy would misstate the broker's own record");
  });

  await t.test("an undated comp stays editable — the stored null round-trips", async () => {
    const r = await fetch(srv.base + `/api/vault/comp?id=${undatedId}`, as({
      method: "PATCH", body: JSON.stringify({ price: "22000000" }),
    }));
    assert.equal(r.status, 200,
      "fixing an undated comp's PRICE must not 400 on its date — the uneditable-comp trap");
    const row = tables.broker_comps.find((c) => c.id === undatedId);
    assert.equal(row.price, 22000000);
    assert.equal(row.deal_date, null, "and it is still undated");
  });
});
