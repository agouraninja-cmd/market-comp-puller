const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const VAULT = require("../broker-vault");

// A publisher is reviewed once.
//
// Until 2026-11-14 every comp a member published was written to
// comp_submissions as "approved", so a brand-new account could type any firm
// name and any license number and its first comp wore "Verified · via <firm>"
// in other people's reports with nobody having looked. The rule now
// (broker-vault.js, publisherStanding): until the owner has approved one of an
// account's published comps, what it publishes waits as "pending", a few at a
// time, and the verified layer reads status=eq.approved, so a pending row is
// in no report.
//
// The pure half is asserted first; the route half boots the real server
// against the fake PostgREST, because the vault has no file fallback and the
// question that matters is what row actually landed in comp_submissions.

const DAY = 86400000;
const TOKEN = "test-session-token";
const TOKEN_HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function comp(n, over) {
  return {
    id: UUID(n), user_id: "u1", market: "Boise, ID", property_type: "Industrial",
    address: `${n}00 Main St, Boise, ID`, address_key: `${n}00 main st`,
    deal_date: "2026-03-14", transaction: "sale",
    price: 1000000 + n, size_sqft: 10000, price_per_sqft: 100,
    published: false, published_at: null, published_submission_id: null, ...over,
  };
}

function tablesWith(comps, submissions, profile) {
  return {
    users: [
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
      { id: "p1", user_id: "u1", email: "broker@example.com", display_name: "",
        company: "Northgate Realty", license_number: "DB12345", public: false, ...(profile || {}) },
    ],
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

const post = (srv, path, body) => fetch(srv.base + path, {
  method: "POST",
  headers: { cookie: `cn_session=${TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const readVault = (srv) => fetch(srv.base + "/api/vault?limit=1000", {
  headers: { cookie: `cn_session=${TOKEN}` },
}).then(async (r) => ({ status: r.status, body: await r.json() }));

test("the row a publish writes is pending unless the caller says approved", () => {
  const c = comp(1);
  assert.equal(VAULT.submissionRowFrom(c, { creditName: "Firm", email: "a@b.co" }).status, "pending",
    "an omitted status must never mean approved");
  assert.equal(VAULT.submissionRowFrom(c, { creditName: "Firm", email: "a@b.co", status: "Approved" }).status,
    "pending", "only the literal word approves");
  assert.equal(VAULT.submissionRowFrom(c, { creditName: "Firm", email: "a@b.co", status: "approved" }).status,
    "approved");
});

test("a publisher's standing comes from their own published comps", () => {
  assert.deepEqual(VAULT.publisherStanding([]),
    { approved: false, waiting: 0, room: VAULT.PUBLISH_REVIEW_CAP });
  assert.equal(VAULT.publisherStanding(["pending", "pending"]).room, VAULT.PUBLISH_REVIEW_CAP - 2);
  assert.equal(VAULT.publisherStanding(["rejected", "pending"]).approved, false,
    "a rejected comp approves nobody");
  assert.equal(VAULT.publisherStanding(new Array(VAULT.PUBLISH_REVIEW_CAP).fill("rejected")).room, 0,
    "a refused publisher cannot refill the queue");
  const ok = VAULT.publisherStanding(["pending", "approved"]);
  assert.equal(ok.approved, true);
  assert.equal(ok.room, Infinity);
  assert.equal(VAULT.publisherStanding(null).approved, false);
});

test("publishing waits for a one-time review", async (t) => {
  await t.test("a new publisher's first comp is stored pending and says so", async () => {
    const { db, srv, stop } = await bootWithDb(tablesWith([comp(1)], []));
    try {
      const { status, body } = await post(srv, "/api/vault/publish", { id: UUID(1), publish: true });
      assert.equal(status, 200);
      assert.equal(body.published, true);
      assert.equal(body.inReview, true, "the page is told the comp is waiting, not live");
      assert.equal(db.tables.comp_submissions.length, 1);
      assert.equal(db.tables.comp_submissions[0].status, "pending",
        "nothing a new account publishes may reach the verified layer unreviewed");
      assert.equal(db.tables.broker_comps[0].published, true, "it is still theirs to withdraw");

      const read = await readVault(srv);
      assert.equal(read.body.comps[0].review, "pending", "their own page can call it In review");
      assert.deepEqual(db.unparsed, [],
        "every filter this sent must be one the fake understands, or the read is unproven");
    } finally { await stop(); }
  });

  await t.test("once one comp is approved, the next publishes straight away", async () => {
    const tables = tablesWith(
      [comp(1, { published: true, published_submission_id: "sub-1" }), comp(2)],
      [{ id: "sub-1", status: "approved", broker_email: "broker@example.com", address: "100 Main St" }]);
    const { db, srv, stop } = await bootWithDb(tables);
    try {
      const { status, body } = await post(srv, "/api/vault/publish", { id: UUID(2), publish: true });
      assert.equal(status, 200);
      assert.equal(body.inReview, undefined);
      const added = db.tables.comp_submissions.find((s) => s.id !== "sub-1");
      assert.equal(added.status, "approved");
      const read = await readVault(srv);
      assert.ok(read.body.comps.every((c) => c.review === undefined),
        "an approved comp carries no review state");
    } finally { await stop(); }
  });

  // The scoping that matters. Standing is read from the CALLER's own comps, so
  // somebody else's approved submission, even one filed under the caller's
  // email address, approves nobody.
  await t.test("another account's approval, or one under the same email, does not count", async () => {
    const tables = tablesWith(
      [comp(1), comp(9, { user_id: "u2", published: true, published_submission_id: "sub-2" })],
      [
        { id: "sub-2", status: "approved", broker_email: "other@example.com", address: "900 Main St" },
        { id: "sub-3", status: "approved", broker_email: "broker@example.com", address: "A form submission" },
      ]);
    const { db, srv, stop } = await bootWithDb(tables);
    try {
      const { body } = await post(srv, "/api/vault/publish", { id: UUID(1), publish: true });
      assert.equal(body.inReview, true);
      const added = db.tables.comp_submissions.find((s) => s.id !== "sub-2" && s.id !== "sub-3");
      assert.equal(added.status, "pending");
    } finally { await stop(); }
  });

  await t.test("a publisher in review can only have a few comps waiting", async () => {
    const waiting = [];
    const subs = [];
    for (let n = 1; n <= VAULT.PUBLISH_REVIEW_CAP; n++) {
      waiting.push(comp(n, { published: true, published_submission_id: `sub-${n}` }));
      subs.push({ id: `sub-${n}`, status: n === 1 ? "rejected" : "pending", address: `${n}00 Main St` });
    }
    const { db, srv, stop } = await bootWithDb(tablesWith(waiting.concat([comp(50)]), subs));
    try {
      const { status, body } = await post(srv, "/api/vault/publish", { id: UUID(50), publish: true });
      assert.equal(status, 400);
      assert.equal(body.code, "review_pending");
      assert.equal(db.tables.comp_submissions.length, VAULT.PUBLISH_REVIEW_CAP, "nothing was written");
      assert.equal(db.tables.broker_comps.find((c) => c.id === UUID(50)).published, false);
    } finally { await stop(); }
  });

  await t.test("a batch from a new publisher sends the first few and skips the rest with the reason", async () => {
    const comps = [];
    for (let n = 1; n <= VAULT.PUBLISH_REVIEW_CAP + 3; n++) comps.push(comp(n));
    const { db, srv, stop } = await bootWithDb(tablesWith(comps, []));
    try {
      const { status, body } = await post(srv, "/api/vault/publish-many", { ids: comps.map((c) => c.id) });
      assert.equal(status, 200);
      assert.equal(body.published, VAULT.PUBLISH_REVIEW_CAP);
      assert.equal(body.inReview, true);
      assert.equal(body.skippedCount, 3);
      assert.equal(body.skipped[0].reason, VAULT.REVIEW_FULL_REASON);
      assert.equal(db.tables.comp_submissions.length, VAULT.PUBLISH_REVIEW_CAP);
      assert.ok(db.tables.comp_submissions.every((s) => s.status === "pending"));
      assert.equal(db.tables.broker_comps.filter((c) => c.published).length, VAULT.PUBLISH_REVIEW_CAP);
    } finally { await stop(); }
  });

  await t.test("a batch from an approved publisher is not capped", async () => {
    const comps = [comp(1, { published: true, published_submission_id: "sub-1" })];
    for (let n = 2; n <= VAULT.PUBLISH_REVIEW_CAP + 4; n++) comps.push(comp(n));
    const { db, srv, stop } = await bootWithDb(tablesWith(comps,
      [{ id: "sub-1", status: "approved", address: "100 Main St" }]));
    try {
      const { body } = await post(srv, "/api/vault/publish-many", { ids: comps.map((c) => c.id) });
      assert.equal(body.published, VAULT.PUBLISH_REVIEW_CAP + 3);
      assert.equal(body.inReview, undefined);
      assert.ok(db.tables.comp_submissions.every((s) => s.status === "approved"));
    } finally { await stop(); }
  });

  // The owner's side of it. The queue on /admin is where the decision is made,
  // and the decision is about the license number, so a member's row carries
  // it. A row from the public form has no account behind it and carries none.
  await t.test("the owner's queue shows the license number on a member's row only", async () => {
    const tables = tablesWith(
      [comp(1, { published: true, published_submission_id: 501 }),
       comp(9, { user_id: "u2", published: true, published_submission_id: 502 })],
      [
        { id: 501, ts: "2026-11-14T10:00:00Z", status: "pending", broker_name: "Northgate Realty", address: "100 Main St" },
        { id: 502, ts: "2026-11-14T09:00:00Z", status: "pending", broker_name: "No Profile LLC", address: "900 Main St" },
        { id: 503, ts: "2026-11-14T08:00:00Z", status: "pending", broker_name: "A Form Sender", address: "5 Form Rd" },
      ]);
    const db = await fake.start({ tables });
    const srv = await shared.boot({
      ACCOUNT_WALL: "off", PRO_ENABLED: "on", ADMIN_KEY: "admin-test-key",
      SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    });
    try {
      const r = await fetch(srv.base + "/api/admin/submissions", { headers: { "x-admin-key": "admin-test-key" } });
      assert.equal(r.status, 200);
      const rows = (await r.json()).rows;
      const by = Object.fromEntries(rows.map((x) => [x.id, x]));
      assert.equal(by[501].member, true);
      assert.equal(by[501].license, "DB12345");
      assert.equal(by[502].member, true);
      assert.equal(by[502].license, "", "a member with no profile row shows as not on file, never as checked");
      assert.equal(by[503].member, undefined);
      assert.equal(by[503].license, undefined);
      assert.deepEqual(db.unparsed, []);

      const anon = await fetch(srv.base + "/api/admin/submissions");
      assert.equal(anon.status, 401, "a license number is never served without the admin key");
    } finally { srv.stop(); await db.stop(); }
  });

  // Withdrawing is the same click whether the comp is live or waiting, and it
  // must take the pending row out of the owner's queue with it.
  await t.test("a comp in review can be withdrawn, and leaves the queue", async () => {
    const { db, srv, stop } = await bootWithDb(tablesWith([comp(1)], []));
    try {
      await post(srv, "/api/vault/publish", { id: UUID(1), publish: true });
      assert.equal(db.tables.comp_submissions.length, 1);
      const { status, body } = await post(srv, "/api/vault/publish", { id: UUID(1), publish: false });
      assert.equal(status, 200);
      assert.equal(body.published, false);
      assert.equal(db.tables.comp_submissions.length, 0);
    } finally { await stop(); }
  });
});
