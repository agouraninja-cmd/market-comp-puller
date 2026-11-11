// The Stripe webhook, actually run: signed events posted to a real server.js
// child, a stand-in Stripe behind STRIPE_API_URL, and the stand-in database.
//
// Run: npm test
//
// WHY THIS FILE EXISTS. Until 2026-11-10 nothing posted an event at the route.
// stripe.js and entitlements.js each passed their own tests, and the pair,
// wired together by handleStripeEvent, gave Pro away three ways:
//   - a card declined at checkout (the subscription is "incomplete") was
//     stored as "cancelled" with Stripe's period end a month or a year ahead,
//     which entitlements reads as Pro to the end of the period;
//   - the same decline's invoice.payment_failed opened a 7-day grace window on
//     a plan that never started;
//   - a renewal that failed, ran out its grace and was cancelled by Stripe
//     came back as Pro for the rest of the unpaid period.
// And took it away once: one row per user, so an old subscription's failed
// retries and cancellation overwrote the row of the one being paid for.
//
// NOTHING HERE REACHES STRIPE. The secret key and the signing secret are fake
// strings and the stub below answers every request.

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const ENT = require("../entitlements");

const SECRET = "whsec_test_not_a_real_secret";
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "buyer@example.com", name: "Bea Buyer" };
const DAY = 24 * 3600 * 1000;
const secs = (ms) => Math.floor(ms / 1000);

// A Stripe subscription object, as an event or a GET would carry it.
const sub = (id, over = {}) => ({
  id, object: "subscription", customer: "cus_bea", status: "active",
  cancel_at_period_end: false, current_period_end: secs(Date.now() + 30 * DAY),
  metadata: { user_id: USER.id },
  items: { data: [{ price: { id: "price_pro_monthly" }, quantity: 1 }] },
  ...over,
});

// Stripe's API: GET /v1/subscriptions/<id> answers whatever the test put in
// `subs`. Everything else gets an empty object.
async function startStubStripe(subs) {
  const server = http.createServer((req, res) => {
    const m = /\/v1\/subscriptions\/([^/?]+)/.exec(req.url);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify((m && subs[m[1]]) || {}));
  });
  await new Promise((r) => server.listen(0, r));
  return { base: `http://localhost:${server.address().port}/v1`, stop: () => new Promise((r) => server.close(r)) };
}

async function bootAll(t, { subscriptions = [], subs = {} } = {}) {
  const db = await fake.start({ tables: {
    users: [{ ...USER, pro_tester: false, vault_beta: false, stripe_customer_id: "cus_bea" }],
    sessions: [], subscriptions, stripe_events: [], orgs: [], org_members: [], org_subscriptions: [],
    analytics_events: [],
  } });
  const stripe = await startStubStripe(subs);
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co", STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
    STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_PRO_MONTHLY: "price_pro_monthly",
    STRIPE_PRICE_CHECK: "off", STRIPE_API_URL: stripe.base,
  });
  t.after(async () => { srv.stop(); await stripe.stop(); await db.stop(); });
  return { db, srv };
}

let seq = 0;
const event = (type, object) => ({ id: `evt_${++seq}_${Date.now()}`, type, data: { object } });

// POST a signed event. `splitAt` sends the body as two writes cut at that
// byte, which is how a large event arrives off the wire.
function post(srv, evt, { splitAt = 0 } = {}) {
  const raw = Buffer.from(JSON.stringify(evt), "utf8");
  const t = secs(Date.now());
  const v1 = crypto.createHmac("sha256", SECRET).update(`${t}.${raw.toString("utf8")}`, "utf8").digest("hex");
  const u = new URL(srv.base + "/api/stripe/webhook");
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname, method: "POST",
      headers: { "content-type": "application/json", "content-length": raw.length, "stripe-signature": `t=${t},v1=${v1}` },
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    if (!splitAt) return req.end(raw);
    req.write(raw.subarray(0, splitAt));
    setTimeout(() => req.end(raw.subarray(splitAt)), 80);
  });
}

// The route answers 200 BEFORE it works, so "nothing was written" can only be
// asserted once the handler has stopped talking to the database.
async function settled(db) {
  let seen = -1, quiet = 0;
  while (quiet < 4) {
    await new Promise((r) => setTimeout(r, 60));
    if (db.requests.length === seen) quiet += 1; else { quiet = 0; seen = db.requests.length; }
  }
}
async function deliver(ctx, evt, opts) {
  const r = await post(ctx.srv, evt, opts);
  assert.equal(r.status, 200, `${evt.type} must be accepted: ${r.body}`);
  await settled(ctx.db);
}
const rowOf = (db) => db.tables.subscriptions.find((r) => r.user_id === USER.id) || null;
const stateOf = (db, at = Date.now()) => ENT.subscriptionState(rowOf(db), at);

test("a signed event is verified even when a multi-byte character straddles two chunks", async (t) => {
  // The signature is over BYTES. Until 2026-11-10 the route decoded each chunk
  // on its own, so a character cut across two of them became two U+FFFD and a
  // genuine event was refused 400 "Invalid signature" (and Stripe's retry can
  // split at the same offset). Invoice lines read "1 × Pro", so this is ordinary.
  const ctx = await bootAll(t);
  const evt = event("customer.subscription.updated", sub("sub_live", { description: "1 × CompNinja Pro (Zoë's plan)" }));
  const raw = Buffer.from(JSON.stringify(evt), "utf8");
  const at = raw.indexOf(Buffer.from("×", "utf8")) + 1;   // between the two bytes of the ×
  assert.ok(at > 1, "the fixture must contain the character");
  await deliver(ctx, evt, { splitAt: at });
  assert.equal(rowOf(ctx.db) && rowOf(ctx.db).status, "active", "and it was applied");
});

test("a forged signature is still refused", async (t) => {
  const ctx = await bootAll(t);
  const evt = event("customer.subscription.updated", sub("sub_live"));
  const res = await fetch(ctx.srv.base + "/api/stripe/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${secs(Date.now())},v1=${"0".repeat(64)}` },
    body: JSON.stringify(evt),
  });
  assert.equal(res.status, 400);
  await settled(ctx.db);
  assert.equal(rowOf(ctx.db), null);
});

test("a card declined at checkout buys nothing: no row, and no grace window", async (t) => {
  const yearOut = secs(Date.now() + 365 * DAY);
  const declined = sub("sub_new", { status: "incomplete", current_period_end: yearOut });
  const ctx = await bootAll(t, { subs: { sub_new: declined } });

  await deliver(ctx, event("customer.subscription.created", declined));
  assert.equal(rowOf(ctx.db), null, "an incomplete subscription writes no row");

  // The same decline's failed invoice. The handler forces past_due over the
  // subscription's own status, which used to open seven days of Pro.
  await deliver(ctx, event("invoice.payment_failed", { id: "in_1", subscription: "sub_new" }));
  assert.equal(rowOf(ctx.db), null, "no grace for a plan that never started");

  // Stripe gives up on it a day later.
  await deliver(ctx, event("customer.subscription.updated", { ...declined, status: "incomplete_expired" }));
  assert.equal(rowOf(ctx.db), null);
  assert.equal(stateOf(ctx.db), "none");
});

test("a sale that succeeds is Pro, and its own late 'incomplete' snapshot cannot undo it", async (t) => {
  // Stripe makes the subscription before the card clears and does not deliver
  // events in order: created(incomplete) can land after updated(active).
  const ctx = await bootAll(t);
  await deliver(ctx, event("customer.subscription.updated", sub("sub_new")));
  assert.equal(stateOf(ctx.db), "active");
  await deliver(ctx, event("customer.subscription.created", sub("sub_new", { status: "incomplete" })));
  assert.equal(stateOf(ctx.db), "active", "the late snapshot changed nothing");
  assert.equal(rowOf(ctx.db).stripe_subscription_id, "sub_new");
});

test("a renewal that fails and is cancelled by Stripe does not come back as Pro", async (t) => {
  // Paid until yesterday; the yearly renewal failed, so Stripe has already
  // rolled the period forward a year without being paid for it.
  const yearOut = secs(Date.now() + 364 * DAY);
  const failing = sub("sub_old", { status: "past_due", current_period_end: yearOut });
  const ctx = await bootAll(t, {
    subs: { sub_old: failing },
    subscriptions: [{ user_id: USER.id, stripe_subscription_id: "sub_old", stripe_customer_id: "cus_bea",
      plan: "pro_monthly", status: "active", current_period_end: new Date(Date.now() + DAY).toISOString(),
      cancel_at_period_end: false, grace_until: null }],
  });

  await deliver(ctx, event("invoice.payment_failed", { id: "in_2", subscription: "sub_old" }));
  assert.equal(stateOf(ctx.db), "grace", "a lapse on a plan that was paid for gets its seven days");
  assert.equal(stateOf(ctx.db, Date.now() + 8 * DAY), "expired", "and only seven");

  // Three weeks on, Stripe's retries run out and it cancels the subscription.
  await deliver(ctx, event("customer.subscription.deleted", {
    ...failing, status: "canceled", ended_at: secs(Date.now()),
    cancellation_details: { reason: "payment_failed" },
  }));
  const row = rowOf(ctx.db);
  assert.equal(row.status, "cancelled");
  assert.ok(Date.parse(row.current_period_end) <= Date.now() + 1000,
    `the period ends at the cancellation, not a year out: ${row.current_period_end}`);
  assert.equal(stateOf(ctx.db, Date.now() + 3 * DAY), "expired", "eleven unpaid months are not Pro");
});

test("an old subscription's events cannot take the row of the one being paid for", async (t) => {
  // Bea's card failed on sub_old, the app told her Pro had lapsed, and she
  // bought again (sub_new, active). sub_old is still in Stripe's retry schedule.
  const old = sub("sub_old", { status: "past_due" });
  const ctx = await bootAll(t, {
    subs: { sub_old: old },
    subscriptions: [{ user_id: USER.id, stripe_subscription_id: "sub_new", stripe_customer_id: "cus_bea",
      plan: "pro_monthly", status: "active", current_period_end: new Date(Date.now() + 300 * DAY).toISOString(),
      cancel_at_period_end: false, grace_until: null }],
  });

  await deliver(ctx, event("invoice.payment_failed", { id: "in_3", subscription: "sub_old" }));
  assert.equal(rowOf(ctx.db).stripe_subscription_id, "sub_new", "the old one's failed retry is not hers any more");
  assert.equal(stateOf(ctx.db), "active");

  await deliver(ctx, event("customer.subscription.updated", old));
  await deliver(ctx, event("customer.subscription.deleted", { ...old, status: "canceled", ended_at: secs(Date.now()) }));
  assert.equal(rowOf(ctx.db).stripe_subscription_id, "sub_new", "nor is its cancellation");
  assert.equal(stateOf(ctx.db, Date.now() + 100 * DAY), "active", "she is still Pro on what she paid for");

  // The subscription she IS on still answers for itself.
  await deliver(ctx, event("customer.subscription.updated", sub("sub_new", { status: "past_due" })));
  assert.equal(rowOf(ctx.db).status, "grace");
});
