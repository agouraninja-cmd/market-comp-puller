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
    // The Address Explorer shipped free and only became Pro-only afterwards, so
    // "pre-Pro behavior" means it stays open to everyone while the tier is dark.
    assert.equal(e.canExploreAddresses, true);
  }
});

// --- comped team access ----------------------------------------------------
//
// "Admin" is possession of ADMIN_KEY, which server.js resolves from a header or
// the cn_admin cookie. By the time it reaches here it is a boolean, and these
// tests pin the two conditions that boolean is NOT allowed to override.

test("admin: comped Pro with no subscription, purchase or export tally", () => {
  const e = ent({ user: USER, admin: true });
  assert.equal(e.plan, "admin");
  assert.equal(e.pro, true);
  assert.equal(e.admin, true);
  assert.equal(e.maxComps, "all");
  assert.equal(e.maxLookbackMonths, PRO_MAX_LOOKBACK_MONTHS);
  assert.equal(e.exportsRemaining, "unlimited");
  assert.equal(e.canBrand, true);
  // Comped means the WHOLE app. This one is asserted rather than assumed
  // because it is the failure a merge produces silently: the admin branch is a
  // separate early return, so a Pro-only field added to the branches below it
  // is simply ABSENT here, and `undefined` reads as locked.
  assert.equal(e.canExploreAddresses, true);
});

test("every Pro-granting branch answers every Pro question", () => {
  // The guard for the trap above, generalized: whatever an active subscriber is
  // granted, a comped admin must be granted too, or the team ends up staring at
  // a paywall only they can see.
  const pro = ent({ user: USER, subscription: activeSub() });
  const admin = ent({ user: USER, admin: true });
  for (const key of Object.keys(pro)) {
    assert.ok(key in admin, `admin entitlements are missing "${key}"`);
  }
  for (const key of ["pro", "maxComps", "canBrand", "maxLookbackMonths", "exportsRemaining", "canExploreAddresses"]) {
    assert.deepEqual(admin[key], pro[key], `admin should match Pro on "${key}"`);
  }
});

test("admin status is never a Stripe status — there is no customer to manage", () => {
  // The UI decides whether to offer the billing portal off `status !== "none"`.
  // Reporting "active" here would send a comped account to a portal that 400s.
  assert.equal(ent({ user: USER, admin: true }).status, "admin");
});

test("admin without an account gets nothing — the key identifies a machine", () => {
  const e = ent({ user: null, admin: true });
  assert.equal(e.plan, "anonymous");
  assert.equal(e.pro, false);
  assert.equal(e.maxComps, FREE_MAX_COMPS);
});

test("admin cannot switch a dark deployment back on", () => {
  // PRO_ENABLED off must mean the pre-Pro app for EVERYONE, staff included —
  // otherwise the only people who can spot a broken paywall never render one.
  const e = computeEntitlements({ user: USER, admin: true, now: NOW, enabled: false });
  assert.equal(e.plan, "free");
  assert.equal(e.admin, false);
  assert.equal(e.status, "disabled");
});

test("admin does not spend, or get credit for, a real subscription", () => {
  // A subscribed admin stays on the comped branch; their row is untouched and
  // unread, so cancelling Pro can never look like losing admin access.
  const e = ent({ user: USER, admin: true, subscription: activeSub({ plan: "pro_annual_founding" }) });
  assert.equal(e.plan, "admin");
  assert.equal(e.graceUntil, null);
});

test("non-admins carry admin:false, so the UI can read one field", () => {
  assert.equal(ent({ user: USER }).admin, false);
  assert.equal(ent({ user: USER, subscription: activeSub() }).admin, false);
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
  assert.equal(e.canExploreAddresses, false);
});

test("the Address Explorer is Pro-only once the tier is on", () => {
  // Covers the states a visitor is actually in when they click the link, and
  // pins the two that keep paying customers whole: cancelling and grace both
  // still hold Pro, so neither may lock the explorer.
  assert.equal(ent({ user: null }).canExploreAddresses, false, "anonymous");
  assert.equal(ent({ user: USER }).canExploreAddresses, false, "free account");
  assert.equal(
    ent({ user: USER, subscription: activeSub({ status: "canceled", cancel_at_period_end: true }) }).canExploreAddresses,
    true, "cancelling, still inside the paid period");
  assert.equal(
    ent({ user: USER, subscription: activeSub({ status: "past_due", grace_until: iso(NOW + 3 * DAY) }) }).canExploreAddresses,
    true, "inside the payment grace window");
  assert.equal(
    ent({ user: USER, subscription: activeSub({ status: "canceled", current_period_end: iso(NOW - 30 * DAY) }) }).canExploreAddresses,
    false, "expired");
});

test("free account: 4 comps and three exports a month", () => {
  const e = ent({ user: USER });
  assert.equal(e.plan, "free");
  assert.equal(e.maxComps, FREE_MAX_COMPS);
  assert.equal(e.exportsRemaining, FREE_EXPORTS_PER_MONTH);
});

test("export tally counts down and floors at zero", () => {
  // Written against the constant, not the number: the cap is a product dial
  // (3 → 5 on 2026-08-03) and a test that hard-codes it fails for the wrong
  // reason every time someone turns it.
  const cap = FREE_EXPORTS_PER_MONTH;
  assert.equal(ent({ user: USER, usage: { count: 1 } }).exportsRemaining, cap - 1);
  assert.equal(ent({ user: USER, usage: { count: cap } }).exportsRemaining, 0);
  assert.equal(ent({ user: USER, usage: { count: 99 } }).exportsRemaining, 0);
  // A corrupt or negative tally must not mint extra exports.
  assert.equal(ent({ user: USER, usage: { count: -5 } }).exportsRemaining, cap);
  assert.equal(ent({ user: USER, usage: { count: "two" } }).exportsRemaining, cap);
});

test("exporting requires an account — anonymous gets zero, never one", () => {
  // The ladder must only ever go up: anonymous 0 -> free 5 -> Pro unlimited.
  // If an anonymous visitor could export MORE than a signed-in one, creating an
  // account would be a downgrade and people would learn to stay signed out.
  assert.equal(ANON_EXPORTS_PER_MONTH, 0);
  assert.equal(ent({ user: null }).exportsRemaining, 0);
  assert.equal(canExport(ent({ user: null })), false);
  assert.ok(
    ANON_EXPORTS_PER_MONTH < FREE_EXPORTS_PER_MONTH,
    "an account must always be worth more than no account"
  );
  // A signed-in free user with an untouched allowance can still export.
  assert.equal(canExport(ent({ user: USER })), true);
});

test("the tier being switched off restores unlimited exports for everyone", () => {
  // PRO_ENABLED unset must look exactly like the app before the tier existed —
  // including for anonymous visitors, who are otherwise capped at zero.
  assert.equal(computeEntitlements({ user: null, enabled: false }).exportsRemaining, "unlimited");
  assert.equal(computeEntitlements({ user: USER, enabled: false }).exportsRemaining, "unlimited");
  assert.equal(canExport(computeEntitlements({ user: null, enabled: false })), true);
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
  assert.equal(e.canExploreAddresses, true);
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

test("a purchase does not buy the Address Explorer either", () => {
  // Same reasoning as the lookback window: $39 buys one report that already
  // exists, and the explorer's whole job is finding the NEXT property.
  const e = ent({ user: USER, purchase, reportId: "rep_abc" });
  assert.equal(e.reportUnlocked, true);
  assert.equal(e.canExploreAddresses, false);
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

// --- PRO_AUDIENCE ----------------------------------------------------------
// The test-window allowlist. Two failure modes matter and they pull in
// opposite directions: an audience that accidentally matches everyone turns a
// private test into a public launch, and one that accidentally matches nobody
// turns a launch into an invisible product.

test("parseAudience normalizes a comma-separated env var", () => {
  assert.deepEqual(parseAudience("A@B.com, c@d.com"), ["a@b.com", "c@d.com"]);
  assert.deepEqual(parseAudience("  spaced@x.com  "), ["spaced@x.com"]);
  // Empty entries from a trailing or doubled comma must not become "" — an
  // empty needle would match a user with no email.
  assert.deepEqual(parseAudience("a@b.com,,c@d.com,"), ["a@b.com", "c@d.com"]);
  assert.deepEqual(parseAudience(""), []);
  assert.deepEqual(parseAudience("   "), []);
  assert.deepEqual(parseAudience(undefined), []);
  assert.deepEqual(parseAudience(null), []);
});

test("an empty audience means everyone — the launch setting", () => {
  assert.equal(inAudience({ email: "anyone@example.com" }, []), true);
  assert.equal(inAudience(null, []), true, "anonymous visitors included too");
  // A caller that forgot to parse must not accidentally restrict access.
  assert.equal(inAudience({ email: "anyone@example.com" }, undefined), true);
  assert.equal(inAudience({ email: "anyone@example.com" }, "a@b.com"), true);
});

test("a non-empty audience admits only the listed accounts", () => {
  const aud = parseAudience("owner@example.com");
  assert.equal(inAudience({ email: "owner@example.com" }, aud), true);
  assert.equal(inAudience({ email: "OWNER@Example.COM" }, aud), true, "case-insensitive");
  assert.equal(inAudience({ email: " owner@example.com " }, aud), true, "whitespace-tolerant");
  assert.equal(inAudience({ email: "someone@example.com" }, aud), false);
});

test("a restricted audience never admits a visitor without an email", () => {
  const aud = parseAudience("owner@example.com");
  assert.equal(inAudience(null, aud), false, "anonymous");
  assert.equal(inAudience({}, aud), false, "signed in, no email field");
  assert.equal(inAudience({ email: "" }, aud), false);
  assert.equal(inAudience({ email: "   " }, aud), false);
  assert.equal(inAudience({ email: null }, aud), false);
  // Not a string — must not throw and must not match.
  assert.equal(inAudience({ email: 42 }, aud), false);
  assert.equal(inAudience({ email: ["owner@example.com"] }, aud), false);
});

test("audience decides which branch of computeEntitlements a visitor gets", () => {
  // This mirrors server.js's proEnabledFor(): PRO_ENABLED && inAudience().
  const aud = parseAudience("owner@example.com");
  const owner = { id: "u1", email: "owner@example.com" };
  const stranger = { id: "u2", email: "stranger@example.com" };
  const enabledFor = (u) => true && inAudience(u, aud);

  const gated = computeEntitlements({ user: owner, now: NOW, enabled: enabledFor(owner) });
  assert.equal(gated.maxComps, FREE_MAX_COMPS, "the tester sees the real free tier");
  assert.equal(gated.maxLookbackMonths, FREE_MAX_LOOKBACK_MONTHS);

  const untouched = computeEntitlements({ user: stranger, now: NOW, enabled: enabledFor(stranger) });
  assert.equal(untouched.status, "disabled");
  assert.equal(untouched.maxComps, "all", "the public keeps the pre-Pro app");
  assert.equal(untouched.exportsRemaining, "unlimited");
  assert.equal(untouched.maxLookbackMonths, PRO_MAX_LOOKBACK_MONTHS);
});
