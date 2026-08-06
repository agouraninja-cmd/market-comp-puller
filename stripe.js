// ---------------------------------------------------------------------------
// Stripe — talked to over its REST API with plain fetch, no SDK.
//
// This repo has never had an npm dependency and does not start now: Checkout
// sessions and the portal are two form-encoded POSTs, and webhook signatures
// are an HMAC that Node's built-in crypto already does. The SDK would buy
// convenience at the cost of the one property that makes this app trivial to
// deploy anywhere.
//
// Everything here except stripeRequest() is PURE and covered by `npm test`.
// The parts that matter most — signature verification and the mapping from a
// Stripe subscription to our own row — are exactly the parts that must not be
// wrong, so they are the parts that are tested.
// ---------------------------------------------------------------------------

const crypto = require("crypto");

const STRIPE_API = "https://api.stripe.com/v1";

// Stripe wants form-encoded bodies with bracketed paths for nesting:
//   { line_items: [{ price: "price_1" }] } -> line_items[0][price]=price_1
function formEncode(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") formEncode(item, `${key}[${i}]`, out);
        else out.push(`${key}[${i}]=${encodeURIComponent(item)}`);
      });
    } else if (typeof v === "object") {
      formEncode(v, key, out);
    } else {
      out.push(`${key}=${encodeURIComponent(v)}`);
    }
  }
  return out.join("&");
}

async function stripeRequest(secretKey, method, path, body, idempotencyKey) {
  const headers = {
    authorization: `Bearer ${secretKey}`,
    "content-type": "application/x-www-form-urlencoded",
  };
  // Makes a retried create safe: Stripe returns the ORIGINAL result instead of
  // charging twice. Matters most if a visitor double-clicks Subscribe.
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const r = await fetch(`${STRIPE_API}/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : formEncode(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (!r.ok) {
    const msg = (json && json.error && json.error.message) || text.slice(0, 200);
    const err = new Error(`Stripe ${method} ${path} failed (${r.status}): ${msg}`);
    err.status = r.status;
    err.stripeCode = json && json.error && json.error.code;
    throw err;
  }
  return json;
}

// --- webhook signature ------------------------------------------------------

// Stripe signs `${timestamp}.${raw body}`. The RAW bytes matter: re-serializing
// the parsed JSON changes key order and whitespace and the signature stops
// matching, which is the classic way this check gets silently broken.
const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

function verifyWebhookSignature(rawBody, sigHeader, secret, nowMs = Date.now()) {
  if (!rawBody || !sigHeader || !secret) return { ok: false, reason: "missing signature, body, or secret" };
  const parts = String(sigHeader).split(",").reduce((acc, p) => {
    const i = p.indexOf("=");
    if (i > 0) {
      const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
      if (k === "v1") (acc.v1 = acc.v1 || []).push(v);
      else acc[k] = v;
    }
    return acc;
  }, {});
  const t = Number(parts.t);
  if (!Number.isFinite(t)) return { ok: false, reason: "no timestamp" };
  if (!parts.v1 || !parts.v1.length) return { ok: false, reason: "no v1 signature" };
  // Replay guard: a captured-and-resent webhook stops working after 5 minutes.
  if (Math.abs(nowMs - t * 1000) > WEBHOOK_TOLERANCE_MS) return { ok: false, reason: "timestamp outside tolerance" };

  const expected = crypto.createHmac("sha256", secret)
    .update(`${t}.${rawBody}`, "utf8").digest("hex");
  const expBuf = Buffer.from(expected, "hex");
  // Stripe can send several v1 signatures during a secret roll; any match wins.
  const ok = parts.v1.some((got) => {
    let gotBuf;
    try { gotBuf = Buffer.from(got, "hex"); } catch (_) { return false; }
    return gotBuf.length === expBuf.length && crypto.timingSafeEqual(gotBuf, expBuf);
  });
  return ok ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

// --- mapping Stripe state onto ours ----------------------------------------

// Which of our plans a Stripe price represents. Anything we do not sell maps
// to null, which the caller treats as "do not grant Pro" — a price id we do
// not recognize must never become an entitlement.
function planForPrice(priceId, priceMap) {
  if (!priceId) return null;
  const map = priceMap || {};
  // An UNSET price env var is "". The early `!priceId` return already makes
  // ""-matches-"" unreachable; the Boolean() here keeps that true if the guard
  // above is ever relaxed, since the cost of getting it wrong is granting a
  // plan nobody paid for.
  const is = (candidate) => Boolean(candidate) && priceId === candidate;
  if (is(map.monthly)) return "pro_monthly";
  if (is(map.annualFounding)) return "pro_annual_founding";
  // No broker price: one subscription (2026-08-05). A webhook carrying a price
  // we do not sell still resolves to null and writes no row, which is the same
  // fail-closed behaviour as before.
  return null;
}

// Stripe's status vocabulary is wider than ours and fails closed on both ends:
// anything unrecognized becomes "cancelled" rather than leaking access.
function statusForStripe(stripeStatus) {
  switch (String(stripeStatus || "").toLowerCase()) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "grace";
    case "canceled":
    case "cancelled":
      return "cancelled";
    // incomplete / incomplete_expired / paused: never paid, or deliberately
    // stopped. No access.
    default:
      return "cancelled";
  }
}

// current_period_end moved onto subscription items in newer API versions, so
// read both. Returned as ISO, or null when Stripe sent neither.
function periodEndIso(sub) {
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  const secs = (sub && sub.current_period_end) || (item && item.current_period_end);
  return Number.isFinite(Number(secs)) ? new Date(Number(secs) * 1000).toISOString() : null;
}

function priceIdOf(sub) {
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  return (item && item.price && item.price.id) || null;
}

/**
 * A Stripe subscription object -> the row we store.
 * Returns null when the subscription is for a price we don't sell.
 */
function subscriptionRowFrom(sub, priceMap, { userId, nowMs = Date.now(), graceDays = 7 } = {}) {
  if (!sub || !sub.id) return null;
  const plan = planForPrice(priceIdOf(sub), priceMap);
  if (!plan) return null;
  const status = statusForStripe(sub.status);
  const row = {
    ...(userId ? { user_id: userId } : {}),
    stripe_subscription_id: sub.id,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : (sub.customer && sub.customer.id) || null,
    plan,
    status,
    current_period_end: periodEndIso(sub),
    // "Won't renew" arrives in two shapes. Older API versions set the
    // cancel_at_period_end flag; newer ones (verified live 2026-07-31 on a
    // portal cancel) leave that flag FALSE and instead set cancel_at to the
    // scheduled end timestamp. Read both, or every portal cancellation looks
    // like a still-renewing subscription and the cancelling state never
    // engages.
    cancel_at_period_end: Boolean(sub.cancel_at_period_end || sub.cancel_at),
    updated_at: new Date(nowMs).toISOString(),
  };
  // The 7-day window starts when the payment actually failed. Set only on the
  // way INTO grace so a second past_due webhook can't keep extending it.
  row.grace_until = status === "grace"
    ? new Date(nowMs + graceDays * 24 * 60 * 60 * 1000).toISOString()
    : null;
  return row;
}

module.exports = {
  STRIPE_API,
  formEncode,
  stripeRequest,
  verifyWebhookSignature,
  planForPrice,
  statusForStripe,
  subscriptionRowFrom,
  periodEndIso,
  priceIdOf,
  WEBHOOK_TOLERANCE_MS,
};
