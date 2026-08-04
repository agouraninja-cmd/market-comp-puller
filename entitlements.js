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
// Free lookback stops at 36 months — WIDENED from 12 on 2026-08-04, and the
// reason matters more than the number.
//
// At 12 months the free report did not just withhold value, it frequently
// FAILED. The hero needs two priced sale comps to compute a range, and a
// 12-month window in dense industrial markets kept returning fewer: Phoenix
// came back with five comps of which one was a sale, so the headline rendered
// "-" "-" "-". A free tier that cannot answer its own headline question
// converts nobody, because a broken demo is no evidence the paid version works.
//
// It also disarmed the OTHER gate. A 12-month search often returned four or
// fewer comps, so the 4-comp limit withheld nothing and the single-report tile — which
// only appears when something is actually locked — never rendered. Widening the
// window is what gives the comp gate something to hold back.
//
// Not unlimited, deliberately: the window is clamped BEFORE the search, and the
// model is asked for up to 12 comps regardless of plan, so a 120-month free
// window would find and write far more comps on every free search. The comps
// array is 69-76% of report output and output is the cost and wall-clock
// driver, so free traffic (most traffic, billed to us) would cost materially
// more. 36 buys a working valuation; 120 stays the thing Pro sells.
const FREE_MAX_LOOKBACK_MONTHS = 36;
// Counted PER REPORT PER MONTH, not per click: CSV, image, PDF and Excel of
// the same report together cost one. People think in reports ("I get five a
// month"), and charging twice for wanting the same analysis in two formats
// reads as a bug rather than a limit. server.js keys the tally on a report id
// and inserts ignore-duplicates, so a re-export is free and idempotent.
const FREE_EXPORTS_PER_MONTH = 5;
// Zero, deliberately: exporting requires an account.
//
// The alternative — counting anonymous exports — cannot work here. Exports are
// generated ENTIRELY in the browser (CSV in JS, PNG via html2canvas, PDF via
// window.print), so the server only learns about one if the client reports it,
// and `export_usage` is keyed on a real user id. Any anonymous tally would live
// in localStorage and die with a private window.
//
// Leaving anonymous UNCOUNTED was worse than either: a signed-out visitor would
// have had unlimited exports while a signed-in one got five, making an account
// strictly worse to have. The ladder now only goes one way: 0 → 5 → unlimited.
const ANON_EXPORTS_PER_MONTH = 0;
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
 * @param {boolean} o.admin        the caller holds ADMIN_KEY — comps Pro, but
 *                                 only alongside `enabled` AND a signed-in user
 */
function computeEntitlements({ user, subscription, purchase, usage, reportId, now, enabled, admin } = {}) {
  const at = Number.isFinite(now) ? now : Date.now();

  // --- Comped Pro for the internal team -------------------------------------
  //
  // Checked before any subscription reasoning, because an admin has no Stripe
  // row to reason about — server.js short-circuits three DB reads on this
  // branch.
  //
  // Two conditions, both load-bearing:
  //
  //   `enabled` — an admin on a deployment where the tier is dark must still
  //   see the dark app, or the one person who can spot a broken paywall is the
  //   one person who never looks at it. It also keeps the disabled branch's
  //   promise literal: PRO_ENABLED off means the app behaves exactly as it did
  //   before the tier existed, for everyone.
  //
  //   `user` — possession of ADMIN_KEY identifies a machine, not a person, and
  //   the rule is that admins get Pro WHEN THEY SIGN IN. An anonymous request
  //   holding the key lands on the normal free path. (Internal machine callers
  //   like gen-market-seed.js do NOT come through here; /api/comps has its own
  //   header-only `internal` bypass for them.)
  if (enabled && admin && user) {
    return {
      plan: "admin",
      pro: true,
      // Deliberately not "active": nothing here came from Stripe, and the UI
      // must not offer a billing portal to an account with no customer record.
      status: "admin",
      maxComps: "all",
      canBrand: true,
      maxLookbackMonths: PRO_MAX_LOOKBACK_MONTHS,
      exportsRemaining: "unlimited",
      reportUnlocked: false,
      // Comped Pro means the WHOLE Pro app. Omitting this reads as `undefined`,
      // i.e. locked — which would leave the team staring at the paywall the
      // branch above exists to lift.
      canExploreAddresses: true,
      graceUntil: null,
      admin: true,
      reason: "Pro is comped for the CompNinja team.",
    };
  }

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
      canExploreAddresses: true,
      graceUntil: null,
      admin: false,
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
  // A paid report you cannot export would be a paid screenshot. The unlock
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
    // A purchase now carries Pro's full window FOR ITS OWN PROPERTY (changed
    // 2026-08-04). This only became possible when reportIdFor() stopped hashing
    // the lookback: while `months` was in the key, a re-run at a wider window
    // was a different report id, matched no purchase, and came back locked — so
    // granting the ceiling here would have done nothing. Keyed on address+type,
    // the buyer can re-run their building at ten years and it stays unlocked,
    // which is the difference between selling a snapshot and selling the
    // property's history.
    maxLookbackMonths: pro || reportUnlocked ? PRO_MAX_LOOKBACK_MONTHS : FREE_MAX_LOOKBACK_MONTHS,
    exportsRemaining,
    reportUnlocked,
    // The Address Explorer stays Pro-only, deliberately, even though everything
    // else a purchase grants now matches Pro. It is a DISCOVERY tool — its job
    // is finding the next property to value — so it is the one Pro capability
    // that is not scoped to a report and cannot be sold per-report without
    // simply being Pro at a one-off price.
    canExploreAddresses: pro,
    graceUntil: state === "grace" && subscription ? (subscription.grace_until || null) : null,
    admin: false,
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
