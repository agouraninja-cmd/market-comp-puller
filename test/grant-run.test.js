// scripts/grant.js, run for real against the stand-in PostgREST.
//
// Its pure helpers are covered in test/grant.test.js, but every refusal there
// is argued in a function that never touched a database. This tool's whole job
// is production, and the first time it was going to make a real query was
// during a customer's onboarding — so this runs the actual script, as a child
// process, against the fake.
//
// The load-bearing assertion is `unparsed`: the fake refuses a filter shape it
// does not understand rather than matching everything, so an empty unparsed
// list is proof that every query grant.js sends is one PostgREST would answer.
// A typo'd column or a filter nobody has taught it shows up here as a 400
// instead of as a support ticket six weeks from now.

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { execFile } = require("node:child_process");

const fake = require("./helpers/fake-supabase");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "grant.js");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

function seed() {
  return {
    users: [
      { id: "u1", email: "owner@adler.test", pro_tester: false, vault_beta: false },
      { id: "u2", email: "colleague@adler.test", pro_tester: false, vault_beta: false },
    ],
    subscriptions: [],
    orgs: [
      { id: "o1", name: "Adler Industrial", kind: "development", seats: 200,
        share_default: "none", created_at: "2026-08-01T00:00:00.000Z" },
      { id: "o2", name: "Paid Firm", kind: "broker", seats: 5,
        share_default: "none", created_at: "2026-08-02T00:00:00.000Z" },
    ],
    org_members: [
      { id: "m1", org_id: "o1", email: "owner@adler.test", role: "owner",
        joined_at: "2026-08-01T00:00:00.000Z", removed_at: null },
      { id: "m2", org_id: "o1", email: "colleague@adler.test", role: "member",
        joined_at: null, removed_at: null },
    ],
    // A firm that really pays us, for the Stripe guard.
    org_subscriptions: [
      { org_id: "o2", plan: "firm_monthly", status: "active",
        stripe_subscription_id: "sub_live_1", stripe_customer_id: "cus_live_1",
        current_period_end: YEAR_OUT, cancel_at_period_end: false },
    ],
    analytics_events: [],
  };
}

function run(db, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        SUPABASE_URL: db.url,
        // Not a JWT, so grant.js sends it as `apikey` only — the same branch
        // production takes for a new-style sb_secret_... key.
        SUPABASE_SERVICE_KEY: "service-key",
      },
    }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code || 1) : 0, out: String(stdout), errOut: String(stderr) });
    });
  });
}

test("grant.js against a real PostgREST wire", async (t) => {
  const db = await fake.start({ tables: seed() });
  t.after(() => db.stop());

  await t.test("status reads the account, its plan and its firms", async () => {
    const r = await run(db, ["status", "owner@adler.test"]);
    assert.equal(r.code, 0, r.errOut);
    assert.match(r.out, /vault_beta {4}false/);
    assert.match(r.out, /subscription {2}none/);
    assert.match(r.out, /Adler Industrial — owner/);
    assert.match(r.out, /seats 200 · kind development/);
    // The colleague who has not accepted must read as invited, not as a member.
    const c = await run(db, ["status", "colleague@adler.test"]);
    assert.match(c.out, /INVITED, not accepted/);
  });

  await t.test("an email that capitalises differently still finds the row", async () => {
    // Identity is the email, normalized. A grant typed from a business card
    // must land on the account signup created.
    const r = await run(db, ["status", "  Owner@Adler.TEST "]);
    assert.match(r.out, /Account owner@adler\.test/);
  });

  await t.test("a dry run writes nothing at all", async () => {
    const before = db.requests.filter((q) => q.method !== "GET").length;
    const r = await run(db, ["vault", "owner@adler.test"]);
    assert.equal(r.code, 0, r.errOut);
    assert.match(r.out, /DRY RUN/);
    assert.match(r.out, /GRANT vault_beta/);
    assert.equal(db.requests.filter((q) => q.method !== "GET").length, before,
      "a run without --confirm sent a write");
    assert.equal(db.tables.users[0].vault_beta, false);
  });

  await t.test("--confirm sets the flag the onboarding actually needs", async () => {
    const r = await run(db, ["vault", "owner@adler.test", "--confirm"]);
    assert.equal(r.code, 0, r.errOut);
    assert.equal(db.tables.users[0].vault_beta, true,
      "the grant that lets somebody CREATE their firm did not land");
    // Idempotent: running it twice is a no-op, not a second write.
    const again = await run(db, ["vault", "owner@adler.test", "--confirm"]);
    assert.match(again.out, /already has vault_beta = true/);
  });

  await t.test("a comped firm plan reaches every seated member", async () => {
    const r = await run(db, ["firm", "Adler Industrial", "--months", "6", "--confirm"]);
    assert.equal(r.code, 0, r.errOut);
    assert.match(r.out, /development shop/);
    assert.match(r.out, /1 people today/);
    assert.match(r.out, /the 1 who have not accepted/);
    const sub = db.tables.org_subscriptions.find((s) => s.org_id === "o1");
    assert.ok(sub, "no subscription row was written for the firm");
    assert.equal(sub.status, "active");
    assert.equal(sub.plan, "firm_monthly");
    assert.ok(Date.parse(sub.current_period_end) > Date.now(), "the comp is already expired");
    assert.ok(!sub.stripe_subscription_id, "a comped row must carry no Stripe id");
  });

  await t.test("a firm Stripe knows about is refused in both directions", async () => {
    for (const args of [["firm", "Paid Firm", "--confirm"],
                        ["firm", "Paid Firm", "--revoke", "--confirm"]]) {
      const r = await run(db, args);
      assert.equal(r.code, 1, "a paying firm was not refused: " + r.out);
      assert.match(r.errOut, /Stripe/);
    }
    const sub = db.tables.org_subscriptions.find((s) => s.org_id === "o2");
    assert.equal(sub.stripe_subscription_id, "sub_live_1", "a real subscription was touched");
  });

  await t.test("revoking a comped plan removes the row", async () => {
    const r = await run(db, ["firm", "Adler Industrial", "--revoke", "--confirm"]);
    assert.equal(r.code, 0, r.errOut);
    assert.ok(!db.tables.org_subscriptions.find((s) => s.org_id === "o1"),
      "the comped row survived a revoke");
  });

  await t.test("an unknown account is named, never created", async () => {
    const before = db.tables.users.length;
    const r = await run(db, ["vault", "nobody@adler.test", "--confirm"]);
    assert.equal(r.code, 1);
    assert.match(r.errOut, /no account for nobody@adler\.test/);
    assert.equal(db.tables.users.length, before, "this tool created a person");
  });

  await t.test("an unknown firm lists the firms that do exist", async () => {
    const r = await run(db, ["firm", "Adler Industriall", "--confirm"]);
    assert.equal(r.code, 0, r.errOut);
    assert.match(r.out, /No firm named/);
    assert.match(r.out, /Adler Industrial/);
  });

  await t.test("every query it sends is one PostgREST would understand", () => {
    // The whole point of this file. The fake 400s a filter it cannot parse
    // rather than matching everything, so anything here is a query shape that
    // would have failed against the real database.
    assert.deepEqual(db.unparsed, [],
      "grant.js sent a query the stand-in PostgREST refused:\n" +
      JSON.stringify(db.unparsed, null, 2));
  });
});
