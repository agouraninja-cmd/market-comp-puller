// Stripe plumbing — the parts that must not be wrong.
//
// Run: npm test
//
// Webhook signature verification is the security boundary: anything that gets
// past it can grant a stranger a Pro subscription. The mapping from a Stripe
// subscription to our own row is the correctness boundary: get it wrong and a
// paying customer loses access, or a cancelled one keeps it.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

const {
  formEncode, verifyWebhookSignature, planForPrice, statusForStripe,
  subscriptionRowFrom, periodEndIso, refundOf, WEBHOOK_TOLERANCE_MS,
} = require("../stripe");
// The whole module too, for the per-seat cases at the foot of this file.
const stripe = require("../stripe");

const SECRET = "whsec_test_secret";
const NOW = Date.parse("2026-08-01T12:00:00Z");
const PRICES = {
  monthly: "price_monthly",
  annualFounding: "price_founding",
  singleReport: "price_single",
  brokerMonthly: "price_broker",
};

function sign(body, secret = SECRET, atMs = NOW) {
  const t = Math.floor(atMs / 1000);
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
}

// --- form encoding ---------------------------------------------------------

test("form encoding uses Stripe's bracketed paths", () => {
  assert.equal(
    formEncode({ mode: "subscription", line_items: [{ price: "price_1", quantity: 1 }] }),
    "mode=subscription&line_items[0][price]=price_1&line_items[0][quantity]=1");
});

test("form encoding escapes values and drops empties", () => {
  const out = formEncode({ success_url: "https://x.test/ok?a=1&b=2", cancel: null, skip: undefined });
  assert.equal(out, "success_url=https%3A%2F%2Fx.test%2Fok%3Fa%3D1%26b%3D2");
});

test("nested metadata encodes one level down", () => {
  assert.equal(formEncode({ metadata: { user_id: "u_1" } }), "metadata[user_id]=u_1");
});

// --- webhook signature: the security boundary ------------------------------

test("a genuine Stripe signature verifies", () => {
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  assert.equal(verifyWebhookSignature(body, sign(body), SECRET, NOW).ok, true);
});

test("a forged signature is rejected", () => {
  const body = JSON.stringify({ id: "evt_1" });
  const forged = `t=${Math.floor(NOW / 1000)},v1=${"0".repeat(64)}`;
  assert.equal(verifyWebhookSignature(body, forged, SECRET, NOW).ok, false);
});

test("a signature from the wrong secret is rejected", () => {
  const body = JSON.stringify({ id: "evt_1" });
  assert.equal(verifyWebhookSignature(body, sign(body, "whsec_attacker"), SECRET, NOW).ok, false);
});

test("a tampered body is rejected even with a real signature", () => {
  const body = JSON.stringify({ id: "evt_1", amount: 100 });
  const header = sign(body);
  const tampered = JSON.stringify({ id: "evt_1", amount: 999999 });
  assert.equal(verifyWebhookSignature(tampered, header, SECRET, NOW).ok, false);
});

test("a replayed webhook stops verifying after the tolerance window", () => {
  const body = JSON.stringify({ id: "evt_1" });
  const header = sign(body, SECRET, NOW);
  const later = NOW + WEBHOOK_TOLERANCE_MS + 1000;
  assert.equal(verifyWebhookSignature(body, header, SECRET, NOW + 60_000).ok, true, "still fine a minute later");
  const res = verifyWebhookSignature(body, header, SECRET, later);
  assert.equal(res.ok, false);
  assert.match(res.reason, /tolerance/);
});

test("multiple v1 signatures (a secret roll) verify if any matches", () => {
  const body = JSON.stringify({ id: "evt_1" });
  const t = Math.floor(NOW / 1000);
  const good = crypto.createHmac("sha256", SECRET).update(`${t}.${body}`, "utf8").digest("hex");
  const header = `t=${t},v1=${"a".repeat(64)},v1=${good}`;
  assert.equal(verifyWebhookSignature(body, header, SECRET, NOW).ok, true);
});

test("malformed or missing signature headers are rejected, not thrown", () => {
  const body = "{}";
  for (const h of ["", null, undefined, "garbage", "t=abc,v1=xyz", `t=${Math.floor(NOW / 1000)}`, "v1=deadbeef"]) {
    const res = verifyWebhookSignature(body, h, SECRET, NOW);
    assert.equal(res.ok, false, `header "${h}" must not verify`);
  }
});

test("an odd-length or non-hex signature is rejected without throwing", () => {
  const body = "{}";
  const header = `t=${Math.floor(NOW / 1000)},v1=zzz`;
  assert.equal(verifyWebhookSignature(body, header, SECRET, NOW).ok, false);
});

test("a missing secret rejects rather than accepting everything", () => {
  const body = "{}";
  assert.equal(verifyWebhookSignature(body, sign(body), "", NOW).ok, false);
  assert.equal(verifyWebhookSignature(body, sign(body), undefined, NOW).ok, false);
});

// --- price -> plan ---------------------------------------------------------

test("our two Pro prices map to our two plans", () => {
  assert.equal(planForPrice("price_monthly", PRICES), "pro_monthly");
  assert.equal(planForPrice("price_founding", PRICES), "pro_annual_founding");
});

test("a price we do not sell maps to nothing", () => {
  for (const p of ["price_single", "price_someone_elses", "", null, undefined]) {
    assert.equal(planForPrice(p, PRICES), null, `${p} must not become a plan`);
  }
});

test("a retired broker price maps to NOTHING under one subscription", () => {
  // The separate broker plan was retired on 2026-08-05. It was never sold —
  // its Stripe price was never set, so checkout 503'd for it — which is why
  // removing it strips access from nobody. A webhook quoting an old or foreign
  // price must resolve to null and write no row, the same fail-closed
  // behaviour every unknown price has always had.
  assert.equal(planForPrice("price_broker", PRICES), null);
});

test("an unconfigured price grants nothing", () => {
  // An unset env var is "", and nothing may map onto a plan through an empty
  // slot.
  const unset = { ...PRICES, brokerMonthly: "" };
  assert.equal(planForPrice("price_broker", unset), null);
  assert.equal(planForPrice("", unset), null);
  assert.equal(planForPrice(undefined, unset), null);
  // And a price map missing the key entirely must not throw.
  const absent = { monthly: "price_monthly" };
  assert.equal(planForPrice("price_broker", absent), null);
  assert.equal(planForPrice("price_monthly", absent), "pro_monthly");
});

// --- Stripe status -> ours -------------------------------------------------

test("Stripe statuses map onto ours and fail closed", () => {
  assert.equal(statusForStripe("active"), "active");
  assert.equal(statusForStripe("trialing"), "active");
  assert.equal(statusForStripe("past_due"), "grace");
  assert.equal(statusForStripe("unpaid"), "grace");
  assert.equal(statusForStripe("canceled"), "cancelled");
  for (const s of ["incomplete", "incomplete_expired", "paused", "", null, "something_new"]) {
    assert.equal(statusForStripe(s), "cancelled", `"${s}" must not grant access`);
  }
});

// --- subscription -> our row -----------------------------------------------

const periodEnd = Math.floor(Date.parse("2026-09-01T12:00:00Z") / 1000);
const stripeSub = (over = {}) => ({
  id: "sub_123",
  customer: "cus_123",
  status: "active",
  cancel_at_period_end: false,
  current_period_end: periodEnd,
  items: { data: [{ price: { id: "price_monthly" } }] },
  ...over,
});

test("an active subscription becomes an active row", () => {
  const row = subscriptionRowFrom(stripeSub(), PRICES, { userId: "u_1", nowMs: NOW });
  assert.equal(row.user_id, "u_1");
  assert.equal(row.stripe_subscription_id, "sub_123");
  assert.equal(row.stripe_customer_id, "cus_123");
  assert.equal(row.plan, "pro_monthly");
  assert.equal(row.status, "active");
  assert.equal(row.current_period_end, "2026-09-01T12:00:00.000Z");
  assert.equal(row.cancel_at_period_end, false);
  assert.equal(row.grace_until, null);
});

test("a subscription for the retired broker price produces no row at all", () => {
  // Retiring the plan must not silently write a row with a null plan. The
  // whole point of the fail-closed price map is that a price we do not sell
  // grants nothing, and that has to keep holding for a price we USED to
  // recognize.
  const row = subscriptionRowFrom(
    stripeSub({ items: { data: [{ price: { id: "price_broker" } }] } }),
    PRICES, { userId: "u_1", nowMs: NOW });
  assert.equal(row, null);
});

test("a failed payment sets a 7-day grace deadline", () => {
  const row = subscriptionRowFrom(stripeSub({ status: "past_due" }), PRICES, { nowMs: NOW });
  assert.equal(row.status, "grace");
  assert.equal(row.grace_until, new Date(NOW + 7 * 24 * 3600 * 1000).toISOString());
});

test("recovering from grace clears the deadline", () => {
  const row = subscriptionRowFrom(stripeSub({ status: "active" }), PRICES, { nowMs: NOW });
  assert.equal(row.grace_until, null, "a stale deadline would re-expire a recovered subscriber");
});

test("cancel_at_period_end is carried through", () => {
  const row = subscriptionRowFrom(stripeSub({ cancel_at_period_end: true }), PRICES, { nowMs: NOW });
  assert.equal(row.cancel_at_period_end, true);
  assert.equal(row.status, "active", "still active — entitlements decide when it lapses");
});

test("a newer-API portal cancel (cancel_at set, flag false) still reads as won't-renew", () => {
  // Observed live 2026-07-31: the portal's cancel-at-period-end arrives as
  // cancel_at_period_end: false plus cancel_at: <period end>. Missing this
  // meant a cancelled subscriber looked active until the hard drop.
  const row = subscriptionRowFrom(
    stripeSub({ cancel_at_period_end: false, cancel_at: periodEnd, canceled_at: NOW / 1000 }),
    PRICES, { nowMs: NOW });
  assert.equal(row.cancel_at_period_end, true);
  assert.equal(row.status, "active", "still active until the scheduled end");
});

test("period end is read from the item when the top level lacks it", () => {
  const sub = stripeSub({ current_period_end: undefined });
  sub.items.data[0].current_period_end = periodEnd;
  assert.equal(periodEndIso(sub), "2026-09-01T12:00:00.000Z");
  assert.equal(subscriptionRowFrom(sub, PRICES, { nowMs: NOW }).current_period_end, "2026-09-01T12:00:00.000Z");
});

test("a subscription for a price we do not sell produces no row at all", () => {
  const sub = stripeSub();
  sub.items.data[0].price.id = "price_not_ours";
  assert.equal(subscriptionRowFrom(sub, PRICES, { nowMs: NOW }), null);
});

test("a customer sent as an expanded object still yields its id", () => {
  const row = subscriptionRowFrom(stripeSub({ customer: { id: "cus_expanded" } }), PRICES, { nowMs: NOW });
  assert.equal(row.stripe_customer_id, "cus_expanded");
});

test("garbage in produces null, not a throw", () => {
  assert.equal(subscriptionRowFrom(null, PRICES), null);
  assert.equal(subscriptionRowFrom({}, PRICES), null);
  assert.equal(subscriptionRowFrom({ id: "sub_1" }, PRICES), null);
});

// --- the founding-member row round-trips into an entitlement ---------------

test("a founding annual row grants Pro through the entitlement function", () => {
  const { computeEntitlements } = require("../entitlements");
  const sub = stripeSub({ items: { data: [{ price: { id: "price_founding" } }] } });
  const row = subscriptionRowFrom(sub, PRICES, { userId: "u_1", nowMs: NOW });
  const ent = computeEntitlements({ user: { id: "u_1" }, subscription: row, now: NOW, enabled: true });
  assert.equal(ent.pro, true);
  assert.equal(ent.plan, "pro_annual_founding");
  assert.equal(ent.maxComps, "all");
});

test("a grace row still grants Pro, and an expired grace row does not", () => {
  const { computeEntitlements } = require("../entitlements");
  const row = subscriptionRowFrom(stripeSub({ status: "past_due" }), PRICES, { userId: "u_1", nowMs: NOW });
  assert.equal(computeEntitlements({ user: { id: "u_1" }, subscription: row, now: NOW, enabled: true }).pro, true);
  const after = NOW + 8 * 24 * 3600 * 1000;
  assert.equal(computeEntitlements({ user: { id: "u_1" }, subscription: row, now: after, enabled: true }).pro, false);
});

// --- refunds ---------------------------------------------------------------
//
// `charge.refunded` fires for partial refunds as well as full ones, and the
// difference decides whether a customer keeps the report they bought. Until
// this handler existed no refund revoked anything at all.

test("a fully refunded charge is a full refund", () => {
  assert.deepEqual(
    refundOf({ id: "ch_1", payment_intent: "pi_1", refunded: true, amount: 2000, amount_refunded: 2000 }),
    { paymentIntentId: "pi_1", full: true });
});

test("amounts alone can establish a full refund when the flag is absent", () => {
  assert.equal(refundOf({ payment_intent: "pi_1", amount: 2000, amount_refunded: 2000 }).full, true);
});

test("a partial refund is NOT full — the unlock must survive it", () => {
  const r = refundOf({ payment_intent: "pi_1", refunded: false, amount: 2000, amount_refunded: 500 });
  assert.equal(r.full, false);
  assert.equal(r.paymentIntentId, "pi_1");
});

test("a charge with nothing refunded is not a full refund of nothing", () => {
  // amount_refunded >= amount is true at 0 >= 0, which would make every
  // zero-amount object look fully refunded.
  assert.equal(refundOf({ payment_intent: "pi_1", amount: 0, amount_refunded: 0 }).full, false);
  assert.equal(refundOf({ payment_intent: "pi_1", amount: 2000, amount_refunded: 0 }).full, false);
});

test("an expanded payment intent still yields its id", () => {
  assert.equal(refundOf({ payment_intent: { id: "pi_9" }, refunded: true }).paymentIntentId, "pi_9");
});

test("a charge with no payment intent yields null, not a guess", () => {
  // The payment intent is the only join to report_purchases; without it the
  // handler must report the refund as unmatched rather than pick a row.
  assert.equal(refundOf({ id: "ch_1", refunded: true }).paymentIntentId, null);
  assert.equal(refundOf({ payment_intent: "" }).paymentIntentId, null);
});

test("garbage in produces a safe answer, not a throw", () => {
  assert.deepEqual(refundOf(null), { paymentIntentId: null, full: false });
  assert.deepEqual(refundOf(undefined), { paymentIntentId: null, full: false });
  assert.equal(refundOf({ amount: "x", amount_refunded: "y" }).full, false);
});

// ---------------------------------------------------------------------------
// Per-seat firm billing (2026-08-16, migration 031).
// ---------------------------------------------------------------------------

test("the firm price resolves to firm_monthly, and only when it is configured", () => {
  const map = { monthly: "price_m", annualFounding: "price_a", firmMonthly: "price_f" };
  assert.equal(planForPrice("price_f", map), "firm_monthly");
  // A SEPARATE price from the individual plan on purpose: sharing one would
  // make the two indistinguishable in every webhook that arrives afterwards.
  assert.equal(planForPrice("price_m", map), "pro_monthly");
  // Unset is "", and an unset price must never match an empty price id —
  // the fail-closed rule the whole map already follows.
  assert.equal(planForPrice("price_f", { monthly: "price_m" }), null);
  assert.equal(planForPrice("", { firmMonthly: "" }), null);
});

test("seatsOf reads the subscription ITEM, across both shapes Stripe has used", () => {
  assert.equal(stripe.seatsOf({ items: { data: [{ quantity: 6 }] } }), 6);
  assert.equal(stripe.seatsOf({ quantity: 4 }), 4, "the older flat shape");
  assert.equal(stripe.seatsOf({ items: { data: [{ quantity: 3 }] }, quantity: 99 }),
    3, "the item wins — it is what Stripe actually bills");
});

test("seatsOf falls back to ONE, never to zero", () => {
  // Zero would read as "a firm with no seats", which the invite gate enforces
  // as "nobody may be in this firm" — turning a shape change at Stripe into a
  // lockout for a paying customer.
  for (const junk of [null, undefined, {}, { items: {} }, { items: { data: [] } },
    { quantity: 0 }, { quantity: -3 }, { quantity: "many" }]) {
    assert.equal(stripe.seatsOf(junk), 1, JSON.stringify(junk));
  }
  assert.equal(stripe.seatsOf({ quantity: 2.9 }), 2, "and never a fractional seat");
});

test("a firm subscription row carries no user_id", () => {
  // The row goes into org_subscriptions, keyed on the firm. A user_id on it
  // would be the buyer's, and 008's table would then hold a personal
  // subscription their firm is paying for.
  const row = stripe.subscriptionRowFrom(
    { id: "sub_1", status: "active", customer: "cus_1",
      items: { data: [{ price: { id: "price_f" }, quantity: 5 }] },
      current_period_end: 1900000000 },
    { firmMonthly: "price_f" }, { graceDays: 7 });
  assert.equal(row.plan, "firm_monthly");
  assert.equal(row.status, "active");
  assert.equal("user_id" in row, false);
});
