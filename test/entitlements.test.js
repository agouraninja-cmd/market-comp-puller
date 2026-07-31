// Entitlement rules — the paywall's decision table.
//
// Run: npm test   (node --test, no dependencies, no database, no server)
//
// Every case here is a state a real visitor can be in. If you change a rule in
// entitlements.js and a test fails, the test is probably right: these encode
// the promises made to paying customers (access to the end of the paid period,
// a grace window on a failed card, a purchased report staying purchased).

const test = require("node:test");
const assert = require("node:assert");

const {
  computeEntitlements,
  subscriptionState,
  compLimit,
  clampLookback,
  canExport,
  usagePeriod,
  FREE_MAX_COMPS,
  FREE_MAX_LOOKBACK_MONTHS,
  FREE_EXPORTS_PER_MONTH,
  ANON_EXPORTS_PER_MONTH,
  PRO_MAX_LOOKBACK_MONTHS,
  RENEWAL_SLACK_MS,
} = require("../entitlements");

// Fixed clock so nothing here depends on when it runs.
const NOW = Date.parse("2026-08-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const USER = { id: "u_1", email: "broker@example.com" };
const ent = (o) => computeEntitlements({ now: NOW, enabled: true, ...o });

const activeSub = (over = {}) => ({
  plan: "pro_monthly",
  status: "active",
  current_period_end: iso(NOW + 20 * DAY),
  cancel_at_period_end: false,
  ...over,
});

// --- the feature flag ------------------------------------------------------

test("flag off restores pre-Pro behavior for everyone", () => {
  for (const user of [null, USER]) {
    const e = computeEntitlements({ user, now: NOW, enabled: false });
    assert.equal(e.maxComps, "all");
    assert.equal(e.exportsRemaining, "unlimited");
    assert.equal(e.maxLookbackMonths, PRO_MAX_LOOKBACK_MONTHS);
    assert.equal(e.pro, false, "flag off must not grant Pro-only extras like branding");
    assert.equal(e.canBrand, false);
  }
});

// --- anonymous and free ----------------------------------------------------

test("anonymous visitor: 4 comps, 12 months, one export", () => {
  const e = ent({ user: null });
  assert.equal(e.plan, "anonymous");
  assert.equal(e.pro, false);
  assert.equal(e.maxComps, FREE_MAX_COMPS);
  assert.equal(e.maxLookbackMonths, FREE_MAX_LOOKBACK_MONTHS);
  assert.equal(e.exportsRemaining, ANON_EXPORTS_PER_MONTH);
  assert.equal(e.canBrand, false);
});

test("free account: 4 comps and three exports a month", () => {
  const e = ent({ user: USER });
  assert.equal(e.plan, "free");
  assert.equal(e.maxComps, FREE_MAX_COMPS);
  assert.equal(e.exportsRemaining, FREE_EXPORTS_PER_MONTH);
});

test("export tally counts down and floors at zero", () => {
  assert.equal(ent({ user: USER, usage: { count: 1 } }).exportsRemaining, 2);
  assert.equal(ent({ user: USER, usage: { count: 3 } }).exportsRemaining, 0);
  assert.equal(ent({ user: USER, usage: { count: 99 } }).exportsRemaining, 0);
  // A corrupt or negative tally must not mint extra exports.
  assert.equal(ent({ user: USER, usage: { count: -5 } }).exportsRemaining, FREE_EXPORTS_PER_MONTH);
  assert.equal(ent({ user: USER, usage: { count: "two" } }).exportsRemaining, FREE_EXPORTS_PER_MONTH);
});

// --- active Pro ------------------------------------------------------------

test("active Pro: everything unlocked", () => {
  const e = ent({ user: USER, subscription: activeSub() });
  assert.equal(e.pro, true);
  assert.equal(e.plan, "pro_monthly");
  assert.equal(e.status, "active");
  assert.equal(e.maxComps, "all");
  assert.equal(e.canBrand, true);
  assert.equal(e.maxLookbackMonths, PRO_MAX_LOOKBACK_MONTHS);
  assert.equal(e.exportsRemaining, "unlimited");
});

test("founding annual is a Pro plan and reports its own name", () => {
  const e = ent({ user: USER, subscription: activeSub({ plan: "pro_annual_founding" }) });
  assert.equal(e.pro, true);
  assert.equal(e.plan, "pro_annual_founding");
});

test("a Pro subscription ignores the export tally entirely", () => {
  const e = ent({ user: USER, subscription: activeSub(), usage: { count: 500 } });
  assert.equal(e.exportsRemaining, "unlimited");
});

// --- cancellation ----------------------------------------------------------

test("cancels mid-month: keeps Pro until the period ends", () => {
  const e = ent({
    user: USER,
    subscription: activeSub({ cancel_at_period_end: true, current_period_end: iso(NOW + 9 * DAY) }),
  });
  assert.equal(e.pro, true);
  assert.equal(e.status, "cancelling");
  assert.equal(e.maxComps, "all");
  assert.match(e.reason, /end of the paid period/i);
});

test("cancelled and the period has passed: back to free", () => {
  const e = ent({
    user: USER,
    subscription: activeSub({ status: "cancelled", current_period_end: iso(NOW - 30 * DAY) }),
  });
  assert.equal(e.pro, false);
  assert.equal(e.status, "expired");
  assert.equal(e.maxComps, FREE_MAX_COMPS);
  assert.equal(e.canBrand, false, "an expired subscriber's reports fall back to CompNinja branding");
});

test("Stripe's American spelling of cancelled is handled too", () => {
  const sub = activeSub({ status: "canceled", current_period_end: iso(NOW + 3 * DAY) });
  assert.equal(subscriptionState(sub, NOW), "cancelling");
});

// --- failed payment / grace ------------------------------------------------

test("payment failed: Pro survives the 7-day grace window", () => {
  const e = ent({
    user: USER,
    subscription: activeSub({ status: "past_due", grace_until: iso(NOW + 5 * DAY) }),
  });
  assert.equal(e.pro, true);
  assert.equal(e.status, "grace");
  assert.equal(e.maxComps, "all");
  assert.equal(e.graceUntil, iso(NOW + 5 * DAY), "the UI needs the deadline for its notice");
});

test("grace window elapsed: downgraded, branding included", () => {
  const e = ent({
    user: USER,
    subscription: activeSub({ status: "past_due", grace_until: iso(NOW - 1 * DAY) }),
  });
  assert.equal(e.pro, false);
  assert.equal(e.canBrand, false);
  assert.equal(e.maxComps, FREE_MAX_COMPS);
});

test("past_due with no grace_until falls back to the period end, never forever", () => {
  const stale = { plan: "pro_monthly", status: "past_due", current_period_end: iso(NOW - 60 * DAY) };
  assert.equal(subscriptionState(stale, NOW), "expired");
});

// --- renewal slack ---------------------------------------------------------

test("a just-renewed subscriber does not flicker to free while the webhook lands", () => {
  // Period ended an hour ago; invoice.payment_succeeded has not arrived yet.
  const sub = activeSub({ current_period_end: iso(NOW - 60 * 60 * 1000) });
  assert.equal(subscriptionState(sub, NOW), "active");
});

test("slack is one day, not indefinite", () => {
  const sub = activeSub({ current_period_end: iso(NOW - RENEWAL_SLACK_MS - 60 * 1000) });
  assert.equal(subscriptionState(sub, NOW), "expired");
});

// --- single-report purchase ------------------------------------------------

const purchase = { report_id: "rep_abc", user_id: "u_1" };

test("purchased report: full comps and branding for that report", () => {
  const e = ent({ user: USER, purchase, reportId: "rep_abc" });
  assert.equal(e.pro, false, "a one-off purchase is not a subscription");
  assert.equal(e.reportUnlocked, true);
  assert.equal(e.maxComps, "all");
  assert.equal(e.canBrand, true);
  assert.equal(e.exportsRemaining, "unlimited");
});

test("the purchase does not leak to a different report", () => {
  const e = ent({ user: USER, purchase, reportId: "rep_other" });
  assert.equal(e.reportUnlocked, false);
  assert.equal(e.maxComps, FREE_MAX_COMPS);
  assert.equal(e.exportsRemaining, FREE_EXPORTS_PER_MONTH);
});

test("a purchase row with no reportId asked about unlocks nothing", () => {
  const e = ent({ user: USER, purchase });
  assert.equal(e.reportUnlocked, false);
  assert.equal(e.maxComps, FREE_MAX_COMPS);
});

test("a purchase does not widen the search window for the next search", () => {
  const e = ent({ user: USER, purchase, reportId: "rep_abc" });
  assert.equal(e.maxLookbackMonths, FREE_MAX_LOOKBACK_MONTHS);
});

test("buying a report then subscribing: both hold, no conflict", () => {
  const e = ent({ user: USER, subscription: activeSub(), purchase, reportId: "rep_abc" });
  assert.equal(e.pro, true);
  assert.equal(e.reportUnlocked, true);
  assert.equal(e.maxComps, "all");
  assert.equal(e.exportsRemaining, "unlimited");
});

// --- failing closed --------------------------------------------------------

test("an unrecognized subscription status grants nothing", () => {
  for (const status of ["incomplete", "trialing_forever", "", "ACTIVE_MAYBE", "paused"]) {
    const e = ent({ user: USER, subscription: activeSub({ status }) });
    assert.equal(e.pro, false, `status "${status}" must not grant Pro`);
  }
});

test("an unparseable period end grants nothing", () => {
  for (const end of ["soon", "", null, undefined, NaN]) {
    const e = ent({ user: USER, subscription: activeSub({ current_period_end: end }) });
    assert.equal(e.pro, false);
  }
});

test("a plan name we do not sell does not become a Pro plan label", () => {
  const e = ent({ user: USER, subscription: activeSub({ plan: "pro_enterprise_unicorn" }) });
  assert.equal(e.pro, true, "status still governs access");
  assert.equal(e.plan, "free", "but an unknown plan name is never echoed back as a plan");
});

test("no arguments at all does not throw and grants nothing", () => {
  const e = computeEntitlements();
  assert.equal(e.maxComps, "all", "with no flag passed, Pro is off and behavior is unchanged");
  assert.equal(e.pro, false);
});

// --- helpers ---------------------------------------------------------------

test("compLimit turns the 'all' sentinel into a usable number", () => {
  assert.equal(compLimit({ maxComps: "all" }), Infinity);
  assert.equal(compLimit({ maxComps: 4 }), 4);
  assert.equal(compLimit(null), Infinity);
});

test("clampLookback holds free users to 12 months and lets Pro through", () => {
  const free = ent({ user: USER });
  const pro = ent({ user: USER, subscription: activeSub() });
  assert.equal(clampLookback(36, free), 12);
  assert.equal(clampLookback(6, free), 6);
  assert.equal(clampLookback(36, pro), 36);
  assert.equal(clampLookback(999, pro), PRO_MAX_LOOKBACK_MONTHS);
  assert.equal(clampLookback(0, pro), 1);
  assert.equal(clampLookback("nonsense", free), 12, "a junk value falls back inside the free ceiling");
});

test("canExport reads both the sentinel and the count", () => {
  assert.equal(canExport({ exportsRemaining: "unlimited" }), true);
  assert.equal(canExport({ exportsRemaining: 1 }), true);
  assert.equal(canExport({ exportsRemaining: 0 }), false);
});

test("usagePeriod is a UTC month key", () => {
  assert.equal(usagePeriod(Date.parse("2026-08-01T00:30:00Z")), "2026-08");
  // 7pm on Dec 31 in New York is already January in UTC — the quota rolls on
  // the UTC boundary for everyone, which is the point.
  assert.equal(usagePeriod(Date.parse("2027-01-01T00:30:00Z")), "2027-01");
});
