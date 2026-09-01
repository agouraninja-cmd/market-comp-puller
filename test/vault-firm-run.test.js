// The push, actually run: POST /api/vault/firm-many through the real server
// against the stand-in PostgREST. The vault's promise is "your space, pushed
// to the firm when you are comfortable", and until this route the push was
// one click and one confirm per comp. A no-file-fallback feature can only be
// proved this way — the route refuses without a database, so a bare boot
// stops at the 503 and everything below it stays an argument in a comment.
//
// What is proved here and nowhere else: the per-row skip report (an undated
// comp and an addressless one are named, by reason, while the good rows
// still land), the 200-per-request cap and its `remaining` count, that a
// re-run is a no-op rather than a duplicate, that a comp id from somebody
// else's vault is neither shared nor mentioned, that the membership check
// holds, and that bulk UNSHARE needs no route of its own because the
// existing DELETE already takes an array.

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
const OTHER_ORG = "9c1e9a1e-0000-4000-8000-000000000002";

// A stored comp, shaped as the upload path stores it. Seeded directly rather
// than uploaded because the cap test needs two hundred of them and the row
// shape is not what is under test here.
function stored(over) {
  const address = over.address === undefined ? "100 Main St, Boise, ID" : over.address;
  const deal_date = over.deal_date === undefined ? "2026-03-14" : over.deal_date;
  return {
    id: crypto.randomUUID(), user_id: "u1", upload_id: null, property_id: null,
    address, address_key: String(address).toLowerCase(), market: "Boise, ID",
    property_type: "Industrial", transaction: "sale", deal_date,
    price: 1250000, size_sqft: 12500, price_per_sqft: 100, published: false,
    dedupe_key: String(address).toLowerCase() + "|" + deal_date + "|1250000",
    ...over,
  };
}

function baseTables() {
  return {
    users: [
      { id: "u1", email: "broker@example.com", name: "Brad", vault_beta: true },
      { id: "u2", email: "other@example.com", name: "Mike", vault_beta: true },
    ],
    sessions: [
      { id: "s1", user_id: "u1", token_hash: TOKEN_HASH,
        expires_at: new Date(Date.now() + 30 * DAY).toISOString() },
    ],
    broker_comps: [], broker_uploads: [], broker_properties: [],
    broker_profiles: [
      { id: "p1", user_id: "u1", email: "broker@example.com",
        display_name: "Brad", company: "Test & Co", public: false },
    ],
    orgs: [
      { id: ORG_ID, name: "Colliers Boise", share_default: "none", seats: 5, kind: "broker" },
      { id: OTHER_ORG, name: "Somebody Else's Firm", share_default: "none", seats: 5, kind: "broker" },
    ],
    org_members: [
      { id: "9c1e9a1e-0000-4000-8000-000000000011", org_id: ORG_ID,
        email: "broker@example.com", user_id: "u1", role: "owner",
        invited_at: NOW, joined_at: NOW, removed_at: null, auto_share: null },
      { id: "9c1e9a1e-0000-4000-8000-000000000012", org_id: OTHER_ORG,
        email: "other@example.com", user_id: "u2", role: "owner",
        invited_at: NOW, joined_at: NOW, removed_at: null, auto_share: null },
    ],
    org_comps: [],
  };
}

const as = (init = {}) => ({
  ...init,
  headers: { "content-type": "application/json", cookie: `cn_session=${TOKEN}`, ...(init.headers || {}) },
});

test("the push, end to end", async (t) => {
  const tables = baseTables();
  const dated = [
    stored({ address: "100 Main St, Boise, ID" }),
    stored({ address: "220 Fairview Ave, Boise, ID", deal_date: "2026-02-02" }),
    stored({ address: "7 Linder Rd, Meridian, ID", deal_date: "2025-11-20", market: "Meridian, ID" }),
  ];
  const undated = stored({ address: "15 Eagle Rd, Meridian, ID", deal_date: null, market: "Meridian, ID" });
  // A hand-written row with no address: broker-vault.js refuses one at the
  // door, so this is the guard against a row that never came through it.
  const addressless = stored({ address: "", address_key: "" });
  const theirs = stored({ user_id: "u2", address: "900 Private Way, Boise, ID" });
  tables.broker_comps.push(...dated, undated, addressless, theirs);

  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
  });
  t.after(async () => { srv.stop(); await db.stop(); });

  const post = (body, init) => fetch(srv.base + "/api/vault/firm-many", as({
    method: "POST", body: JSON.stringify(body), ...(init || {}),
  }));

  await t.test("an anonymous caller is refused before anything else", async () => {
    const r = await fetch(srv.base + "/api/vault/firm-many", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: ORG_ID, ids: [dated[0].id] }),
    });
    assert.equal(r.status, 401);
  });

  await t.test("a firm the caller is not in is refused, and nothing lands", async () => {
    const r = await post({ orgId: OTHER_ORG, ids: dated.map((c) => c.id) });
    assert.equal(r.status, 403);
    assert.equal(tables.org_comps.length, 0);
  });

  await t.test("the good rows land and the bad rows are named, by reason", async () => {
    const r = await post({
      orgId: ORG_ID,
      ids: [...dated.map((c) => c.id), undated.id, addressless.id],
    });
    const text = await r.text();
    assert.equal(r.status, 200, text);
    const body = JSON.parse(text);
    assert.equal(body.ok, true);
    assert.equal(body.shared, 3, JSON.stringify(body));
    assert.equal(body.firm, "Colliers Boise", "the response names the firm the comps went to");
    assert.equal(body.skippedCount, 2);
    assert.equal(body.remaining, 0);
    const reasons = Object.fromEntries(body.skipped.map((s) => [s.id, s.reason]));
    assert.equal(reasons[undated.id], "no deal date",
      "an undated comp is skipped and SAID — colleagues' reports pick comps by date, so it could never reach one");
    assert.equal(reasons[addressless.id], "no address");
    assert.equal(body.skipped.find((s) => s.id === undated.id).address, undated.address,
      "the skip names the comp so the broker can find it");

    assert.equal(tables.org_comps.length, 3, "three rows on the shelf, no more");
    for (const row of tables.org_comps) {
      assert.equal(row.org_id, ORG_ID);
      assert.equal(row.shared_by_user_id, "u1");
      assert.equal(row.shared_by_name, "Test & Co",
        "the badge name is the stated credit identity, the same string a publish would credit");
      assert.ok(row.deal_date, "nothing undated reached org_comps");
      // The privacy wall in one payload: nothing that is the vault's own
      // plumbing rides along to the firm's table.
      for (const k of ["user_id", "dedupe_key", "address_key", "upload_id", "property_id", "published"]) {
        assert.equal(Object.prototype.hasOwnProperty.call(row.comp, k), false, k + " leaked into the firm copy");
      }
    }
  });

  await t.test("re-running the same push is a no-op, not a duplicate", async () => {
    const r = await post({ orgId: ORG_ID, ids: dated.map((c) => c.id) });
    assert.equal(r.status, 200);
    assert.equal(tables.org_comps.length, 3, "the upsert on (org_id, source_comp_id) absorbed the re-run");
    const ids = tables.org_comps.map((c) => c.source_comp_id).sort();
    assert.deepEqual(ids, dated.map((c) => c.id).sort());
  });

  await t.test("a comp from somebody else's vault is neither shared nor mentioned", async () => {
    const r = await post({ orgId: ORG_ID, ids: [theirs.id, dated[0].id] });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(tables.org_comps.some((c) => c.source_comp_id === theirs.id), false,
      "knowing another broker's comp id must not be enough to put it on your firm's shelf");
    assert.equal(body.skipped.some((s) => s.id === theirs.id), false,
      "and the response must not confirm the id exists by naming it as skipped");
  });

  await t.test("an all-skipped batch answers 200 with the reasons, not a 400", async () => {
    // The single route 400s here, rightly: one click, one comp, "Shared"
    // would be a lie. For a batch, "none of these could be" is an answer.
    const r = await post({ orgId: ORG_ID, ids: [undated.id] });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.shared, 0);
    assert.equal(body.skippedCount, 1);
    assert.equal(body.skipped[0].reason, "no deal date");
  });

  await t.test("over the cap, it shares what fits and says how many are left", async () => {
    const many = Array.from({ length: 205 }, (_, i) =>
      stored({ address: `${i + 1} Cap Test Rd, Boise, ID`, deal_date: "2026-01-0" + ((i % 9) + 1) }));
    tables.broker_comps.push(...many);
    const before = tables.org_comps.length;
    const r = await post({ orgId: ORG_ID, ids: many.map((c) => c.id) });
    const text = await r.text();
    assert.equal(r.status, 200, text);
    const body = JSON.parse(text);
    assert.equal(body.shared, 200);
    assert.equal(body.remaining, 5);
    assert.equal(tables.org_comps.length, before + 200);

    // "Run it again" is safe advice because the page recounts what is on
    // screen and NOT yet shared, so the second click sends only the
    // leftover five — and the upsert would absorb the rest even if it sent
    // them all.
    const onShelf = new Set(tables.org_comps.map((c) => c.source_comp_id));
    const leftover = many.filter((c) => !onShelf.has(c.id)).map((c) => c.id);
    assert.equal(leftover.length, 5);
    const r2 = await post({ orgId: ORG_ID, ids: leftover });
    const body2 = await r2.json();
    assert.equal(body2.shared, 5);
    assert.equal(body2.remaining, 0);
    assert.equal(tables.org_comps.length, before + 205, "every one of the 205 is on the shelf exactly once");
  });

  await t.test("taking them back needs no new route: the existing DELETE takes the array", async () => {
    const ids = dated.map((c) => c.id);
    const r = await fetch(srv.base + "/api/vault/firm", as({
      method: "DELETE", body: JSON.stringify({ compIds: ids }),
    }));
    assert.equal(r.status, 200);
    for (const id of ids) {
      assert.equal(tables.org_comps.some((c) => c.source_comp_id === id), false, "pulled from the shelf");
    }
    assert.equal(tables.org_comps.length, 205, "and only those — the cap-test rows are untouched");
  });

  await t.test("an empty or malformed list is refused before any read", async () => {
    for (const ids of [[], ["not-a-uuid"], undefined]) {
      const r = await post({ orgId: ORG_ID, ids });
      assert.equal(r.status, 400, JSON.stringify(ids));
    }
  });

  await t.test("the fake refused nothing — every query shape was one it knows", () => {
    assert.deepEqual(db.unparsed, [],
      "server.js sent a filter the fake could not parse; teach it deliberately, never loosen it");
  });
});
