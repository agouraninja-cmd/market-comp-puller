// A checkout that SUCCEEDS, driven end to end against a stub Stripe.
//
// Run: npm test
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
// Every other checkout test in this repo is a REFUSAL: not signed in, not the
// owner, unknown plan, seats below the headcount, seats below the minimum.
// Each one returns before Stripe is ever called, and org-run.test.js says so
// in its own header ("Nothing here reaches Stripe's API"). That left the most
// important path in the billing code — the one where somebody actually buys
// something — covered by nothing at all.
//
// It cost five days of unbuyable product. On 2026-08-21 the $20 single-report
// unlock was retired and its `reportId` variable deleted, but one reference to
// it survived as the idempotency-key argument of the Stripe call. A bare
// undeclared identifier is a ReferenceError, not undefined, so from that
// moment EVERY checkout that got as far as Stripe threw, and /api/checkout
// answered 502 "Could not start checkout" to every would-be subscriber — Pro
// monthly, founding annual and firm seats alike. The suite stayed green
// throughout. It was found on 2026-08-26 by a human trying to buy seats.
//
// So the rule this file enforces is simply: the call is made, and what comes
// back is handed to the customer. STRIPE_API_URL (stripe.js) is what makes
// that reachable, and it is RESEND_API_URL's and SEARCH_API_URL's precedent.
//
// NOTHING HERE REACHES STRIPE. The stub below answers every request, and the
// secret key is a fake string.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const ORG = require("../org-access");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 864e5).toISOString();

const OWNER = { id: "11111111-1111-4111-8111-111111111111", email: "owner@firm.test", name: "Ivy Owner" };

const as = (user, init = {}) => ({
  ...init,
  headers: { "content-type": "application/json", cookie: `cn_session=tok-${user.id}`, ...(init.headers || {}) },
});

// Records what Stripe was asked for, because "did it carry the right quantity"
// is the other question this file can finally answer. Answers every path with
// a session-shaped body; the handler only reads `url` and `id`.
async function startStubStripe() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      calls.push({
        path: req.url,
        idempotencyKey: req.headers["idempotency-key"] || null,
        // Stripe takes form-encoded bodies, so this is the wire format itself
        // rather than a re-serialization of it. `rawBody` keeps it exactly as
        // sent, which is what the idempotency key is hashed from; `body` is the
        // readable copy the assertions match against.
        rawBody: body,
        body: decodeURIComponent(body),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "cs_test_session",
        url: "https://checkout.stripe.com/c/pay/cs_test_session",
        customer: "cus_stub",
      }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  return {
    base: `http://localhost:${server.address().port}/v1`,
    calls,
    stop: () => new Promise((r) => server.close(r)),
  };
}

async function bootAll() {
  const org = { id: "22222222-2222-4222-8222-222222222222", name: "Ivy & Co", kind: "broker", seats: 200, created_by: OWNER.id };
  const tables = {
    users: [{ ...OWNER, pro_tester: false, vault_beta: false }],
    sessions: [{ token_hash: sha256("tok-" + OWNER.id), user_id: OWNER.id, expires_at: YEAR_OUT }],
    subscriptions: [],
    orgs: [org],
    org_members: [{ id: "33333333-3333-4333-8333-333333333333", org_id: org.id, email: OWNER.email, user_id: OWNER.id, role: "owner", joined_at: new Date().toISOString(), removed_at: null }],
    org_subscriptions: [],
    analytics_events: [],
  };
  const db = await fake.start({ tables });
  const stub = await startStubStripe();
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
    STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
    STRIPE_PRICE_PRO_MONTHLY: "price_pro_monthly",
    STRIPE_PRICE_FIRM_MONTHLY: "price_firm_monthly",
    STRIPE_API_URL: stub.base,
  });
  return { db, srv, stub, tables, org, stop: async () => { srv.stop(); await stub.stop(); await db.stop(); } };
}

test("a checkout that succeeds reaches Stripe and returns its URL", async (t) => {
  const ctx = await bootAll();
  t.after(() => ctx.stop());
  const { srv, stub, org } = ctx;

  const buy = (body) => fetch(srv.base + "/api/checkout",
    as(OWNER, { method: "POST", body: JSON.stringify(body) }));

  await t.test("firm seats: the session is created and handed back", async () => {
    const before = stub.calls.length;
    const res = await buy({ plan: "firm_monthly", orgId: org.id, seats: 4 });
    assert.equal(res.status, 200, "a valid firm checkout must not 502 — this is the 2026-08-21 regression");
    const body = await res.json();
    assert.equal(body.url, "https://checkout.stripe.com/c/pay/cs_test_session");
    assert.equal(body.id, "cs_test_session");
    assert.equal(stub.calls.length, before + 1, "Stripe should have been called exactly once");
  });

  await t.test("it asks Stripe for the seats the firm bought, not for one", async () => {
    const call = stub.calls[stub.calls.length - 1];
    assert.match(call.path, /\/checkout\/sessions$/);
    assert.match(call.body, /line_items\[0\]\[price\]=price_firm_monthly/);
    assert.match(call.body, /line_items\[0\]\[quantity\]=4/,
      "quantity IS the seat count; a fixed 1 would bill a four-seat firm for one");
    assert.match(call.idempotencyKey || "", /^[0-9a-f]{64}$/,
      "every create carries a key derived from the request itself");
  });

  await t.test("org_id rides on BOTH the session and the subscription", async () => {
    // The webhook routes a later event to the firm's table on this metadata,
    // and a subscription event months later carries only its own copy.
    const call = stub.calls[stub.calls.length - 1];
    assert.match(call.body, new RegExp(`metadata\\[org_id\\]=${org.id}`));
    assert.match(call.body, new RegExp(`subscription_data\\[metadata\\]\\[org_id\\]=${org.id}`));
    assert.match(call.body, /subscription_data\[metadata\]\[user_id\]=/);
  });

  await t.test("a personal Pro checkout works too — the same line broke both", async () => {
    const before = stub.calls.length;
    const res = await buy({ plan: "pro_monthly" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).url, "https://checkout.stripe.com/c/pay/cs_test_session");
    const call = stub.calls[stub.calls.length - 1];
    assert.equal(stub.calls.length, before + 1);
    assert.match(call.body, /line_items\[0\]\[price\]=price_pro_monthly/);
    assert.match(call.body, /line_items\[0\]\[quantity\]=1/);
    assert.ok(!/metadata\[org_id\]/.test(call.body), "a personal plan carries no firm");
  });

  await t.test("the refusals still return before Stripe is called", async () => {
    // The other half of the contract: this file must not make it possible to
    // reach Stripe with a request that should have been refused.
    const before = stub.calls.length;
    for (const body of [
      { plan: "single_report", address: "1 Main St", type: "Industrial" },
      { plan: "nonsense" },
      { plan: "firm_monthly", orgId: org.id, seats: 1 },
      { plan: "firm_monthly", orgId: "not-my-firm", seats: 4 },
    ]) {
      const res = await buy(body);
      assert.ok(res.status >= 400, `${body.plan} should be refused`);
    }
    assert.equal(stub.calls.length, before, "a refused checkout must never reach Stripe");
  });

  await t.test("the seat minimum is the module's, not a number typed here", async () => {
    const res = await buy({ plan: "firm_monthly", orgId: org.id, seats: ORG.MIN_SEATS });
    assert.equal(res.status, 200, "the smallest allowed plan must actually be buyable");
  });

  // --- The idempotency key ---------------------------------------------------
  //
  // What it is for: a firm owner double-clicks "Add seats", two requests race,
  // and Stripe makes two subscriptions. `org_subscriptions` is keyed on org_id,
  // so the second webhook OVERWRITES the first — the firm is billed twice and
  // every screen shows one plan. Invisible double-billing is the failure worth
  // spending a hash on.
  //
  // The key is a hash of the encoded request, so these two properties come as a
  // pair and cannot drift apart: identical request -> identical key, and any
  // difference -> a different key. The second half matters as much as the
  // first, because Stripe REFUSES a key reused with different parameters.
  // ---------------------------------------------------------------------------
  await t.test("the same purchase, clicked twice, sends Stripe the same key", async () => {
    const body = { plan: "firm_monthly", orgId: org.id, seats: 3 };
    const [a, b] = await Promise.all([buy(body), buy(body)]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const two = stub.calls.slice(-2);
    assert.equal(two[0].idempotencyKey, two[1].idempotencyKey,
      "a double-click must present one key, or Stripe makes two subscriptions");
    assert.equal(two[0].body, two[1].body, "and it must be the same request behind it");
  });

  await t.test("changing the seat count changes the key", async () => {
    // The other direction, and the one a hand-built key gets wrong: buying more
    // seats later is a DIFFERENT purchase. Reusing a key here would have Stripe
    // refuse the call outright.
    await buy({ plan: "firm_monthly", orgId: org.id, seats: 3 });
    const three = stub.calls[stub.calls.length - 1];
    await buy({ plan: "firm_monthly", orgId: org.id, seats: 5 });
    const five = stub.calls[stub.calls.length - 1];
    assert.notEqual(three.idempotencyKey, five.idempotencyKey);
    assert.match(five.body, /line_items\[0\]\[quantity\]=5/);
  });

  await t.test("two different plans never share a key", async () => {
    await buy({ plan: "pro_monthly" });
    const pro = stub.calls[stub.calls.length - 1];
    await buy({ plan: "firm_monthly", orgId: org.id, seats: 3 });
    const firm = stub.calls[stub.calls.length - 1];
    assert.notEqual(pro.idempotencyKey, firm.idempotencyKey);
  });

  await t.test("the key is the hash of the body Stripe actually received", () => {
    // Pins the derivation to the wire format rather than to some parallel
    // serialization that could quietly diverge from it.
    const STRIPE = require("../stripe.js");
    const call = stub.calls[stub.calls.length - 1];
    const raw = crypto.createHash("sha256").update(call.rawBody).digest("hex");
    assert.equal(call.idempotencyKey, raw);
    assert.equal(typeof STRIPE.idempotencyKeyFor({ a: 1 }), "string");
  });

  await t.test("the fake never had to guess at a query it did not understand", () => {
    assert.deepEqual(ctx.db.unparsed, []);
  });
});
