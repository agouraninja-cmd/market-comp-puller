// ---------------------------------------------------------------------------
// Entitlements — the single answer to "what is this visitor allowed to do".
//
// Everything in the Pro tier routes through computeEntitlements(). Nothing
// else in the codebase may test a plan, a subscription status, or a comp
// limit on its own: scattered plan checks are how a paywall grows holes.
//
// This file is deliberately PURE — no I/O, no fetch, no clock reads (the
// caller passes `now`), no require()s at all. That is what makes it testable
// with `node --test` and no database, and it is why the decision logic lives
// here instead of inside server.js's 6,000 lines. server.js owns the reads
// (subscription row, purchase row, export tally) and hands them in; this file
// owns the rules.
//
// Fails CLOSED by design. An unrecognized subscription status, an unparseable
// date, or a missing row all resolve to the free tier rather than to Pro.
// ---------------------------------------------------------------------------

// Free tier. 4 comps is the conversion driver — a free report is still a real
// report (the valuation is computed from the FULL comp set; see the
// locked-basis rows in server.js), but the itemized list is short enough that
// a professional wants the rest.
const FREE_MAX_COMPS = 4;
// Free lookback stops at 12 months. Note this is a REDUCTION from the app's
// historical default of 24 — pre-Pro reports were 24-month searches, so
// existing free users will see a shorter window than they used to.
const FREE_MAX_LOOKBACK_MONTHS = 12;
const FREE_EXPORTS_PER_MONTH = 3;
// Anonymous visitors get one export, then a nudge to make a free account.
// Tracked per browser + IP, so this is a speed bump, not a wall — see the
// note on export counting in server.js.
const ANON_EXPORTS_PER_MONTH = 1;
// /api/comps already clamps `months` to 1..120; Pro simply gets the whole
// range rather than an unlimited sentinel, so callers can compare numbers.
const PRO_MAX_LOOKBACK_MONTHS = 120;

// A failed payment keeps Pro alive for 7 days before the downgrade, so a
// dead card on a Friday does not strip a broker's branding mid-pitch.
const GRACE_DAYS = 7;

// Stripe renews AT current_period_end and the webhook lands seconds later,
// but a sleeping Render instance or a retry can widen that gap. Without slack
// a paying subscriber would flicker down to free in the window between the
// period ending and invoice.payment_succeeded arriving. One day of slack
// costs at most a day of unpaid Pro on a genuine lapse, which is the far
// cheaper error.
const RENEWAL_SLACK_MS = 24 * 60 * 60 * 1000;

const PRO_PLANS = ["pro_monthly", "pro_annual_founding"];

// Plans that keep Pro alive. `cancelling` = cancelled but inside the paid
// period; `grace` = payment failed, still inside the 7 days.
const PRO_STATES = ["active", "cancelling", "grace"];

// ---------------------------------------------------------------------------
// Audience — who the PRO_ENABLED switch applies to.
//
// PRO_ENABLED is global with no per-user dimension, which makes proving the
// paid tier against the real deployment an all-or-nothing act: it gates every
// visitor's report AND puts a working checkout in front of them. In TEST mode
// that is worse than it sounds, because the test card numbers are public — a
// stranger can help themselves to a genuine active subscription row for free,
// while a real customer's real card is declined.
//
// PRO_AUDIENCE narrows the switch to named accounts so the flow can be tested
// at leisure on the live site while the public sees the pre-Pro app unchanged.
// Unset (the launch setting) means everyone, i.e. exactly today's behavior.
// ---------------------------------------------------------------------------
function parseAudience(value) {
  return String(value == null ? "" : value)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Is this visitor inside the Pro audience?
 *
 * An empty audience is "unrestricted" — that is the DEFAULT, not a failure
 * mode, and it is what makes an unset PRO_AUDIENCE behave as if this feature
 * did not exist. Once a list is set the match is strict: an anonymous visitor,
 * a user with no email, and a blank list entry all fail to match, so the only
 * way to be inside the audience is to be signed in as a named address.
 */
function inAudience(user, audience) {
  if (!Array.isArray(audience) || audience.length === 0) return true;
  const email = user && typeof user.email === "string"
    ? user.email.trim().toLowerCase()
    : "";
  return Boolean(email) && audience.includes(email);
}

function msOf(value) {
  if (value == null || value === "") return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : NaN;
}

// Reduce a stored subscription row to one of five states. Anything we do not
// recognize lands on "expired" — an unknown Stripe status must never grant
// access we did not intend.
function subscriptionState(sub, now) {
  if (!sub) return "none";
  const status = String(sub.status || "").toLowerCase();
  const periodEnd = msOf(sub.current_period_end);
  const insidePeriod = Number.isFinite(periodEnd) && periodEnd + RENEWAL_SLACK_MS > now;

  if (status === "active") {
    // cancel_at_period_end is Stripe's "will not renew" flag; access continues
    // to the end of what was paid for.
    if (sub.cancel_at_period_end) return insidePeriod ? "cancelling" : "expired";
    return insidePeriod ? "active" : "expired";
  }
  if (status === "grace" || status === "past_due" || status === "unpaid") {
    const graceUntil = msOf(sub.grace_until);
    // A row marked past_due with no grace_until never got its webhook write —
    // fall back to the period end so a missing field cannot mean "forever".
    const until = Number.isFinite(graceUntil)
      ? graceUntil
      : (Number.isFinite(periodEnd) ? periodEnd + GRACE_DAYS * 24 * 60 * 60 * 1000 : NaN);
    return Number.isFinite(until) && until > now ? "grace" : "expired";
  }
  if (status === "cancelled" || status === "canceled") {
    return insidePeriod ? "cancelling" : "expired";
  }
  return "expired";
}

/**
 * The one entitlement decision. Pure: same inputs, same answer, always.
 *
 * @param {object}  o
 * @param {object?} o.user          signed-in user row, or null for anonymous
 * @param {object?} o.subscription  that user's subscription row, or null
 * @param {object?} o.purchase      a report_purchases row for o.reportId, or null
 * @param {object?} o.usage         { period, count } export tally, or null
 * @param {string?} o.reportId      the report being asked about, if any
 * @param {number}  o.now           epoch ms (injected so tests need no clock)
 * @param {boolean} o.enabled       PRO_ENABLED — false restores pre-Pro behavior
 */
function computeEntitlements({ user, subscription, purchase, usage, reportId, now, enabled } = {}) {
  const at = Number.isFinite(now) ? now : Date.now();

  // The feature flag is a real off switch, not a UI toggle: with Pro disabled
  // every visitor gets exactly what the app gave them before this tier
  // existed. Phases 1-4 ship dark behind this.
  if (!enabled) {
    return {
      plan: user ? "free" : "anonymous",
      pro: false,
      status: "disabled",
      maxComps: "all",
      canBrand: false,
      maxLookbackMonths: PRO_MAX_LOOKBACK_MONTHS,
      exportsRemaining: "unlimited",
      reportUnlocked: false,
      graceUntil: null,
      reason: "Pro tier is switched off (PRO_ENABLED is not 'on').",
    };
  }

  const state = subscriptionState(subscription, at);
  const pro = PRO_STATES.includes(state);
  const plan = pro && PRO_PLANS.includes(String(subscription && subscription.plan))
    ? String(subscription.plan)
    : (user ? "free" : "anonymous");

  // A single-report purchase only ever unlocks the report it was bought for.
  // Guard on the id rather than trusting the caller looked it up correctly.
  const reportUnlocked = Boolean(
    reportId && purchase && String(purchase.report_id) === String(reportId)
  );

  const exportCap = user ? FREE_EXPORTS_PER_MONTH : ANON_EXPORTS_PER_MONTH;
  const used = usage && Number.isFinite(Number(usage.count)) ? Math.max(0, Number(usage.count)) : 0;

  let exportsRemaining;
  if (pro) exportsRemaining = "unlimited";
  // A $39 report you cannot export would be a $39 screenshot. The unlock
  // covers exports OF THAT REPORT — callers ask with its reportId, so a
  // buyer's other reports still count against the free monthly cap.
  else if (reportUnlocked) exportsRemaining = "unlimited";
  else exportsRemaining = Math.max(0, exportCap - used);

  return {
    plan,
    pro,
    status: state,
    maxComps: pro || reportUnlocked ? "all" : FREE_MAX_COMPS,
    canBrand: pro || reportUnlocked,
    // A purchase is retroactive — it unlocks a report that already exists, so
    // it does not widen the search window for the NEXT search.
    maxLookbackMonths: pro ? PRO_MAX_LOOKBACK_MONTHS : FREE_MAX_LOOKBACK_MONTHS,
    exportsRemaining,
    reportUnlocked,
    graceUntil: state === "grace" && subscription ? (subscription.grace_until || null) : null,
    reason: reasonFor({ state, pro, reportUnlocked, user }),
  };
}

// Human-readable, and safe to show a visitor: no ids, no amounts, no email.
function reasonFor({ state, pro, reportUnlocked, user }) {
  if (pro && state === "grace") return "Pro access continues during the payment grace period.";
  if (pro && state === "cancelling") return "Pro access continues until the end of the paid period.";
  if (pro) return "Active Pro subscription.";
  if (reportUnlocked) return "This report was unlocked with a single-report purchase.";
  if (state === "expired") return "Pro access has ended.";
  return user ? "Free account." : "Not signed in.";
}

// Convenience wrappers so callers never re-implement the "all" sentinel.
function compLimit(ent) {
  return !ent || ent.maxComps === "all" ? Infinity : Number(ent.maxComps);
}
function clampLookback(months, ent) {
  const n = Math.round(Number(months));
  if (!Number.isFinite(n)) return Math.min(24, ent ? ent.maxLookbackMonths : 24);
  return Math.min(Math.max(1, n), ent ? ent.maxLookbackMonths : PRO_MAX_LOOKBACK_MONTHS);
}
function canExport(ent) {
  return !ent || ent.exportsRemaining === "unlimited" || Number(ent.exportsRemaining) > 0;
}
// UTC month key for export_usage rows. UTC (not local) so a user travelling
// cannot roll their own quota over early.
function usagePeriod(now) {
  return new Date(Number.isFinite(now) ? now : Date.now()).toISOString().slice(0, 7);
}

module.exports = {
  computeEntitlements,
  subscriptionState,
  parseAudience,
  inAudience,
  compLimit,
  clampLookback,
  canExport,
  usagePeriod,
  FREE_MAX_COMPS,
  FREE_MAX_LOOKBACK_MONTHS,
  FREE_EXPORTS_PER_MONTH,
  ANON_EXPORTS_PER_MONTH,
  PRO_MAX_LOOKBACK_MONTHS,
  GRACE_DAYS,
  RENEWAL_SLACK_MS,
  PRO_PLANS,
};
