const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

// Citation counts, actually joined.
//
// vault-page.test.js proves the page RENDERS a cited_count it is handed, and
// vault-api.test.js proves the contract may carry one. Neither can reach the
// part that decides whether the number is real: attachCitedCounts reads
// comp_submissions and maps it onto the broker's comps, and the vault has no
// file fallback, so with no database that code path stops at a 503 and every
// assertion about it would be an assertion about a stub.
//
// This boots the real server against the fake PostgREST and asks
// GET /api/vault the way the page does. It is the closest thing available to
// opening /vault on the live site, which this environment's network policy
// cannot reach.
//
// The fake 400s on any filter shape it does not understand rather than
// matching everything, so a user-scoped read that stopped being scoped would
// fail here instead of quietly returning another broker's book.

const DAY = 86400000;
const TOKEN = "test-session-token";
const TOKEN_HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");

function baseTables(comps, submissions) {
  return {
    users: [
      // vault_beta is the comped-vault grant (migration 023): the broker
      // surfaces only, no Pro report features, and it does not ride the
      // subscription lapse rules. It is the cheapest honest way to open a
      // vault in a test.
      { id: "u1", email: "broker@example.com", vault_beta: true },
      { id: "u2", email: "other@example.com", vault_beta: true },
    ],
    sessions: [
      { id: "s1", user_id: "u1", token_hash: TOKEN_HASH,
        expires_at: new Date(Date.now() + 30 * DAY).toISOString() },
    ],
    broker_comps: comps,
    comp_submissions: submissions,
    broker_uploads: [],
    broker_profiles: [
      { id: "p1", user_id: "u1", email: "broker@example.com",
        display_name: "", company: "Adler & Co", public: false },
    ],
  };
}

function comp(over) {
  return {
    id: "bc1", user_id: "u1", market: "Boise, ID", property_type: "Industrial",
    address: "100 Main St", deal_date: "2026-03-14", transaction: "sale",
    price: 1000000, size_sqft: 10000, price_per_sqft: 100,
    published: false, published_submission_id: null, ...over,
  };
}

async function bootWithDb(tables) {
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
  });
  return { db, srv, stop: async () => { srv.stop(); await db.stop(); } };
}

const readVault = (srv) => fetch(srv.base + "/api/vault?limit=1000", {
  headers: { cookie: `cn_session=${TOKEN}` },
}).then(async (r) => ({ status: r.status, body: await r.json() }));

test("citation counts are joined onto the broker's own comps", async (t) => {
  await t.test("a published comp carries the count its submission holds", async () => {
    const tables = baseTables(
      [comp({ id: "bc1", published: true, published_submission_id: "sub-1" })],
      [{ id: "sub-1", status: "approved", broker_email: "broker@example.com",
         address: "100 Main St", cited_count: 7 }]);
    const { db, srv, stop } = await bootWithDb(tables);
    try {
      const { status, body } = await readVault(srv);
      assert.equal(status, 200);
      assert.equal(body.comps.length, 1);
      assert.equal(body.comps[0].cited_count, 7,
        "the number a broker sees must come from the submission, not from nowhere");
      assert.deepEqual(db.unparsed, [],
        "every filter this sent must be one the fake understands, or the read is unproven");
    } finally { await stop(); }
  });

  await t.test("an unpublished comp gets no count at all", async () => {
    const tables = baseTables([comp({ id: "bc1", published: false })], []);
    const { srv, stop } = await bootWithDb(tables);
    try {
      const { body } = await readVault(srv);
      assert.equal(body.comps[0].cited_count, undefined,
        "a comp that was never published has nothing to have been cited for");
    } finally { await stop(); }
  });

  // The scoping that matters. Comp ids are opaque, but the join reads
  // comp_submissions by id — so if it ever stopped starting from the CALLER's
  // own comps, another broker's citations would ride back on this response.
  await t.test("another broker's comps and citations never appear", async () => {
    const tables = baseTables([
      comp({ id: "bc1", published: true, published_submission_id: "sub-1" }),
      comp({ id: "bc2", user_id: "u2", address: "999 Elsewhere Rd",
             published: true, published_submission_id: "sub-2" }),
    ], [
      { id: "sub-1", status: "approved", broker_email: "broker@example.com", cited_count: 3 },
      { id: "sub-2", status: "approved", broker_email: "other@example.com", cited_count: 500 },
    ]);
    const { srv, stop } = await bootWithDb(tables);
    try {
      const { body } = await readVault(srv);
      assert.equal(body.comps.length, 1, "the read is scoped by user_id first and always");
      assert.equal(body.comps[0].address, "100 Main St");
      assert.equal(body.comps[0].cited_count, 3);
      assert.ok(!JSON.stringify(body).includes("999 Elsewhere Rd"));
      assert.ok(!JSON.stringify(body).includes("500"));
    } finally { await stop(); }
  });

  await t.test("several comps each get their own count, not a total", async () => {
    const tables = baseTables([
      comp({ id: "bc1", published: true, published_submission_id: "sub-1" }),
      comp({ id: "bc2", address: "200 Oak Ave", published: true, published_submission_id: "sub-2" }),
      comp({ id: "bc3", address: "300 Pine St" }),
    ], [
      { id: "sub-1", status: "approved", broker_email: "broker@example.com", cited_count: 4 },
      { id: "sub-2", status: "approved", broker_email: "broker@example.com", cited_count: 1 },
    ]);
    const { srv, stop } = await bootWithDb(tables);
    try {
      const { body } = await readVault(srv);
      const by = Object.fromEntries(body.comps.map((c) => [c.address, c.cited_count]));
      assert.equal(by["100 Main St"], 4);
      assert.equal(by["200 Oak Ave"], 1);
      assert.equal(by["300 Pine St"], undefined);
    } finally { await stop(); }
  });

  // attachCitedCounts swallows its errors on purpose: a citation count is a
  // reward, not part of the book, and a vault that would not open because that
  // read failed is a strictly worse trade. Proven by pointing the comp at a
  // submission that is not there.
  await t.test("a missing submission costs the count, never the vault", async () => {
    const tables = baseTables(
      [comp({ id: "bc1", published: true, published_submission_id: "sub-gone" })], []);
    const { srv, stop } = await bootWithDb(tables);
    try {
      const { status, body } = await readVault(srv);
      assert.equal(status, 200, "the book still opens");
      assert.equal(body.comps.length, 1);
      assert.equal(body.comps[0].cited_count, undefined);
    } finally { await stop(); }
  });
});
