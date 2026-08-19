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

// Free tier. 10 comps is the conversion driver — a free report is still a real
// report (the valuation is computed from the FULL comp set; see the
// locked-basis rows in server.js), but the itemized list is short enough that
// a professional wants the rest.
const FREE_MAX_COMPS = 10;
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
const FREE_PORTFOLIO_MAX_ITEMS = 100;
const PRO_PORTFOLIO_MAX_ITEMS = 500;

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

// ---------------------------------------------------------------------------
// ONE SUBSCRIPTION (owner's decision, 2026-08-05). There is no separate broker
// plan any more: the private vault is a capability of Pro, not of a second
// tier sold beside it.
//
// The Ecosystem Plan (§2, §3) modelled two account types with `broker_monthly`
// as a superset of Pro. That shipped as billing rails on 2026-08-05 and was
// never sold — `STRIPE_PRICE_BROKER_MONTHLY` was never set, so checkout 503'd
// for it and no subscription row in the wild can carry that plan. Collapsing
// it therefore strips access from nobody, which is why this is a clean delete
// rather than a migration.
//
// What this changes: every paid Pro subscriber can open a private vault.
// What it does NOT change: the privacy wall. Whether a vault may be opened is
// an entitlement question; what may be read out of one is enforced by separate
// tables read by separate functions, and is untouched by this.
//
// The one-off report unlock still does NOT reach the vault, for the same
// reason it does not reach the Address Explorer: the vault is a workspace, not
// a property, so scoping it to a single report is meaningless.
// ---------------------------------------------------------------------------

// Every plan we actually sell. Used only for the `plan` LABEL — access itself
// is governed by subscription status (see the note in computeEntitlements).
const PAID_PLANS = [...PRO_PLANS];

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
 * @param {boolean} o.tester       this account's users.pro_tester flag — comps
 *                                 Pro, but only alongside `enabled`, a signed-in
 *                                 user, and NO live paid subscription
 * @param {boolean} o.vaultBeta    this account's users.vault_beta flag
 *                                 (migration 023) — grants the BROKER surfaces
 *                                 only (vault, lead inbox, blended comps),
 *                                 never Pro's report features. Requires
 *                                 `enabled` and a signed-in user; deliberately
 *                                 independent of billing, so a beta broker's
 *                                 book stays reachable with no subscription to
 *                                 lapse.
 */
function computeEntitlements({ user, subscription, purchase, usage, reportId, now, enabled, admin, tester, vaultBeta } = {}) {
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
      // The broker vault included, for the same reason: the team is permanently
      // on the far side of every paywall, so this is the only way anyone
      // internal ever renders the broker workspace at all. `admin: true` below
      // is what the UI reads to label it comped rather than sold — exactly how
      // `pro: true` is already handled on this branch.
      broker: true,
      canUseVault: true,
      canUseOrg: true,
      graceUntil: null,
      admin: true,
      tester: false,
      portfolioMaxItems: PRO_PORTFOLIO_MAX_ITEMS,
      portfolioValues: true,
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
      // FALSE here, unlike every other capability on this branch — and the
      // asymmetry is deliberate, not an oversight.
      //
      // "Pre-Pro behavior" means restoring what a visitor USED TO HAVE. Comps,
      // exports, the lookback and the Explorer were all free before the tier
      // existed, so switching Pro off gives them back. The broker vault was
      // never free: it did not exist. Granting it here would hand a private
      // workspace — and an upload endpoint — to every anonymous visitor on any
      // deployment that simply has not turned Pro on yet, which is the default.
      //
      // Same rule stated the other way: the vault is only ever opened by a paid
      // broker plan or by the comped-admin branch above. There is no third door.
      broker: false,
      canUseVault: false,
      // FALSE for the vault's exact reason, restated because it is the same
      // trap: creating a firm did not exist before the tier either, and it is
      // a multi-tenant access surface with an endpoint that MAILS PEOPLE.
      // Granting it on a dark deployment would hand both to every anonymous
      // visitor. Reading a firm's shares needs no entitlement (a colleague may
      // be on the free plan, exactly like an invited share's viewer); this
      // flag governs creating one and inviting to it.
      canUseOrg: false,
      graceUntil: null,
      admin: false,
      tester: false,
      // Same pattern as canExploreAddresses: today's desk already showed likely
      // value to everyone before Pro, so dark restores that — unlike the vault.
      portfolioMaxItems: FREE_PORTFOLIO_MAX_ITEMS,
      portfolioValues: true,
      reason: "Pro tier is switched off (PRO_ENABLED is not 'on').",
    };
  }

  const state = subscriptionState(subscription, at);
  const pro = PRO_STATES.includes(state);

  // --- Comped Pro for a beta tester -----------------------------------------
  //
  // A persistent flag on the user row (users.pro_tester), set by redeeming
  // TESTER_PASSKEY. Deliberately NOT an early short-circuit like the admin
  // branch above, and the difference is the whole design:
  //
  //   Admin is possession of a KEY — a staff signal, and staff are not
  //   customers, so it is right for it to win outright and skip the
  //   subscription reads entirely.
  //
  //   A tester is an ordinary person who may go on to actually subscribe. If
  //   this branch won outright, that person would be stuck reading as
  //   "comped" forever — no real status, no billing portal — while their card
  //   was being charged. So it is checked only when there is no live paid
  //   subscription to prefer, which also means comped access resumes if that
  //   subscription later lapses.
  //
  // `enabled` is already guaranteed true here (the !enabled branch returned
  // above), so this cannot switch a dark deployment on. `user` is required for
  // the same reason the admin branch requires it: the grant lives on an
  // account, and there is no account on an anonymous request.
  if (!pro && tester && user) {
    return {
      plan: "tester",
      pro: true,
      // Not "active": nothing here came from Stripe, and the UI must not offer
      // a billing portal to an account with no customer record.
      status: "tester",
      maxComps: "all",
      canBrand: true,
      maxLookbackMonths: PRO_MAX_LOOKBACK_MONTHS,
      exportsRemaining: "unlimited",
      reportUnlocked: false,
      canExploreAddresses: true,
      // The ONE place a tester is deliberately not equal to Pro. The vault is
      // a private-data workspace with an upload endpoint; a passkey shared
      // with a wider group is a bigger surface than "try Pro's reports", so
      // vault access stays admin/paid-only — unless this account ALSO holds
      // the per-account vault_beta grant (migration 023), which is exactly
      // the narrow, one-row-at-a-time door the passkey exclusion points
      // people toward.
      broker: vaultBeta === true,
      canUseVault: vaultBeta === true,
      // Tracks `broker` here too, and the vault's argument covers it twice
      // over: a passkey handed to a wider group must not also hand out an
      // endpoint that sends email to any address typed into it. A tester who
      // holds the vault_beta grant gets both.
      canUseOrg: vaultBeta === true,
      graceUntil: null,
      admin: false,
      tester: true,
      portfolioMaxItems: PRO_PORTFOLIO_MAX_ITEMS,
      portfolioValues: true,
      reason: "Pro is comped for a beta tester.",
    };
  }

  const planName = String((subscription && subscription.plan) || "");
  const plan = pro && PAID_PLANS.includes(planName)
    ? planName
    : (user ? "free" : "anonymous");

  // Unlike `pro`, the vault requires a RECOGNIZED plan and not merely a live
  // subscription status. The two rules differ on purpose:
  //
  //   `pro` is deliberately governed by status alone, so an unfamiliar plan
  //   name on a paid-up row still gets the access it paid for (there is a test
  //   pinning that: "status still governs access"). Erring generous is right
  //   when the alternative is stripping comps from someone whose card cleared.
  //
  //   The vault now rides that same rule. Under one subscription there is no
  //   separate plan name to test, so `broker` IS `pro`: any paid-up
  //   subscription opens a vault, and the moment it lapses the vault closes
  //   with everything else. The old fail-closed-on-unknown-plan rule existed
  //   only to stop a subscription we could not name from opening a private
  //   data store; with a single product there is nothing left to disambiguate.
  //
  //   ONE exception: the per-account vault_beta grant (migration 023), the
  //   broker-onboarding door. It requires a signed-in user — the grant lives
  //   on an account row, so an anonymous request can never carry it — and it
  //   deliberately does NOT ride the lapse rules above: it was never billing,
  //   so there is no subscription whose end should close the book. Revoking
  //   it is a one-row UPDATE, not a lapse.
  const broker = pro || (vaultBeta === true && Boolean(user));

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
    broker,
    // Now simply Pro. Under one subscription the vault is a Pro capability,
    // not a second tier's, so this tracks `pro` exactly.
    //
    // Note it rides the SAME lapse rules as everything else — `broker` is false
    // the moment subscriptionState() stops returning a Pro state, including at
    // the end of a cancelling period and at the end of the 7-day grace window.
    // What happens to the DATA in a lapsed vault is a product decision, not an
    // entitlement one (see the spec's open questions); this flag only answers
    // "may they open it today", and after a lapse the answer is no.
    canUseVault: broker,
    // Creating a firm and inviting colleagues to it (migration 030). Tracks
    // `broker` for the same reason canUseVault does — one subscription, and
    // the firm is a Pro capability rather than a second tier's.
    //
    // It governs the CREATE and INVITE side only. Accepting an invite and
    // reading what a firm has shared needs no entitlement at all: the
    // colleague on the receiving end is exactly an invited share's viewer,
    // who has never needed a plan, and requiring one would mean a firm could
    // only share with people who had already bought the product.
    //
    // It rides the lapse rules, so a lapsed firm cannot invite anyone new.
    // Nothing here deletes a firm or evicts its members — same stance as the
    // vault, and for the same reason: access lapsing is honest, data
    // vanishing is not.
    canUseOrg: broker,
    graceUntil: state === "grace" && subscription ? (subscription.grace_until || null) : null,
    admin: false,
    tester: false,
    portfolioMaxItems: pro ? PRO_PORTFOLIO_MAX_ITEMS : FREE_PORTFOLIO_MAX_ITEMS,
    portfolioValues: pro,
    reason: reasonFor({ state, pro, broker, reportUnlocked, user }),
  };
}

// Human-readable, and safe to show a visitor: no ids, no amounts, no email.
function reasonFor({ state, pro, broker, reportUnlocked, user }) {
  if (pro && state === "grace") return "Pro access continues during the payment grace period.";
  if (pro && state === "cancelling") return "Pro access continues until the end of the paid period.";
  if (pro) return "Active subscription — every Pro capability, including the private vault.";
  if (pro) return "Active Pro subscription.";
  if (reportUnlocked) return "This report was unlocked with a single-report purchase.";
  // Named before the expired line on purpose: a lapsed subscriber who holds
  // the beta grant still has their vault, and saying "access has ended" over
  // an open vault reads as a bug.
  if (broker) return "Free account with vault access (broker beta).";
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
  PAID_PLANS,
  FREE_PORTFOLIO_MAX_ITEMS,
  PRO_PORTFOLIO_MAX_ITEMS,
};
