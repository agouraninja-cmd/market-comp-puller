# Tester passkey — comped Pro for beta testers

Date: 2026-08-10
Status: approved, not yet implemented

## Problem

The owner wants to hand out free Pro access to a wider group of testers
(friends, beta testers) without giving them the `ADMIN_KEY`, which also
unlocks the internal dashboards (`/admin`, `/dev`, `/contacts` — analytics,
leads, dev ideas). There is currently no way to comp Pro to someone who
should not also get staff tooling.

## Decisions (made with the owner)

- **Audience**: a wider group than the internal team — testers, not staff.
- **Code model**: one shared passkey for everyone, not individually
  generated/revocable per-tester codes. Simpler to operate; the owner
  accepted that revoking one tester means editing their account row
  directly, not rotating a per-person code.
- **Revocation**: the grant is stored **per-account in the database**, not
  as a session/cookie. It survives across devices and can be revoked for
  one specific tester (flip their row in Supabase) without affecting
  anyone else or forcing everyone to re-redeem after a passkey rotation.
- **Discovery**: the redeem UI lives in the existing pricing modal
  (`#pricingModal`), not on a separate account-settings page.
- **Vault**: comped testers do **not** get the broker vault. The vault is a
  private-data workspace (a broker's uploaded book of business); handing
  out upload access to a passkey shared with a wider group is a bigger
  surface than "try Pro's report features" and is out of scope here. Vault
  access stays admin/paid-only.

## Architecture

This mirrors the existing comped-admin-Pro mechanism in `entitlements.js`
and `server.js` as closely as possible — same shape, same order of checks,
same short-circuit-before-DB-reads structure — rather than inventing a
parallel system.

### Config

- `TESTER_PASSKEY` — new optional env var, same pattern as `ADMIN_KEY` /
  `APP_PASSWORD`. Unset means the redeem route is dark (404), matching how
  `ADMIN_KEY`-gated CSV routes behave when unset.

### Data model

New migration `migrations/022-tester-passkey.sql`:

```sql
alter table users add column pro_tester boolean not null default false;
```

Purely additive, no backfill needed. Works through the existing
`users` DB/file-fallback abstraction (`findUserById`, `updateUserPassword`,
etc. in server.js) — no new persistence layer, this is just a new column
on a table that already has both a Supabase path and a local-dev file
fallback (`account-store.json`).

### Server: redeem route

`POST /api/redeem-passkey`

Body: `{ passkey: string }`

Order of checks (mirrors `openVault`'s refusal order elsewhere in the
codebase):

1. `TESTER_PASSKEY` unset → 404 (feature doesn't exist on this deployment).
2. Rate-limited per IP (reuse `rateLimited()`, a tighter cap than the
   default — this guards a shared secret against brute force).
3. Not signed in (`getSessionUser(req)` returns null) → 401
   `{ error: "Sign in first." }`. The grant attaches to an account, so
   there is nothing to attach it to for an anonymous caller.
4. Already a tester (`user.pro_tester === true`) → `{ ok: true, already: true }`,
   no write. Idempotent, mirrors the broker intro-request dedupe pattern.
5. `secretMatches(passkey, TESTER_PASSKEY)` fails → 401
   `{ error: "Incorrect code." }`.
6. Match → persist `pro_tester = true` on the user's row (new
   `setUserTester(id)` function, DB PATCH + file-store fallback, mirroring
   the existing `updateUserPassword`). Return `{ ok: true }`.

No confirmation email, no analytics event — this is a low-volume, owner-
operated flow and doesn't need the machinery built for the lead/broker
funnels.

### Server: entitlements

**`getSessionUser()` currently narrows the DB row to
`{ id, email, name }`** before returning it (server.js:939). This must be
extended to also carry `pro_tester: Boolean(user.pro_tester)`, or the flag
never reaches anything downstream — this is the one line most likely to be
missed.

**Deliberately NOT a before-the-DB-reads short-circuit, unlike admin.**
A first draft of this mirrored the admin branch exactly (skip the
subscription/purchase/usage reads entirely for a tester). That's wrong: a
tester who later becomes a real paying customer would be permanently stuck
showing as "comped tester" — no billing portal, no real Stripe status —
even while being charged, because the comped branch would win forever with
no way for a real subscription to take precedence. Admins get away with
the short-circuit because possession of `ADMIN_KEY` is a staff signal, not
a customer flag; `pro_tester` is a persistent per-account flag on people
who may well go on to actually subscribe, so it must yield to a real
subscription.

**`getEntitlements(user, reportId, admin)`** (server.js) keeps the DB
reads for a tester and passes the flag through instead of short-circuiting:

```js
async function getEntitlements(user, reportId, admin = false) {
  if (admin && user && proEnabledFor(user)) {
    return ENT.computeEntitlements({ user, admin: true, now: Date.now(), enabled: true });
  }
  if (!proEnabledFor(user)) return ENT.computeEntitlements({ user, enabled: false });
  const now = Date.now();
  const [subscription, purchase, usage] = await Promise.all([
    findSubscription(user && user.id),
    findReportPurchase(user && user.id, reportId),
    getExportUsage(user && user.id, ENT.usagePeriod(now)),
  ]);
  const tester = Boolean(user && user.pro_tester);
  return ENT.computeEntitlements({
    user, subscription, purchase, usage, reportId, now, enabled: true, tester,
  });
}
```

`PRO_ENABLED=off` still means the pre-Pro app for a tester too (unchanged
`!proEnabledFor` check above), and a tester outside `PRO_AUDIENCE` (if that
is ever set) is not comped either.

**`computeEntitlements()`** (entitlements.js) gets a new `tester`
parameter and checks it as a **fallback**, after the real subscription
state is known and only when that state is not already a paid Pro state:

```js
const state = subscriptionState(subscription, at);
const pro = PRO_STATES.includes(state);

// Comped tester access — only when there is no real paid subscription to
// prefer. A tester who goes on to actually subscribe gets their real
// Stripe-driven status (and the billing portal) from here on, not this
// branch; pro_tester never gets cleared automatically and doesn't need to.
if (!pro && tester && user) {
  return {
    plan: "tester",
    pro: true,
    status: "tester",      // not "active" — no Stripe row behind this
    maxComps: "all",
    canBrand: true,
    maxLookbackMonths: PRO_MAX_LOOKBACK_MONTHS,
    exportsRemaining: "unlimited",
    reportUnlocked: false,
    canExploreAddresses: true,
    broker: false,          // deliberately NOT true — see "Vault" above
    canUseVault: false,
    graceUntil: null,
    admin: false,
    tester: true,
    reason: "Pro is comped for a beta tester.",
  };
}
```

Placed after `pro` is computed but before the rest of the normal free/Pro
resolution — so a real active/cancelling/grace subscription always wins,
and the comped branch only ever fires for a tester with no live paid
subscription.

### `/api/config`

Add `tester: ent.tester === true` next to the existing `admin: ent.admin === true`
in the `pro` block, so the front end can label the plan without a second
round trip (presentation only, like every other field in that block — the
routes re-check entitlements server-side).

## Front-end (`index.html`)

**Pricing modal.** A small "Have a code?" link near the existing
`#pricingCancel` ("Not now") button, shown only when `currentUser` is
truthy (redemption needs an account; a signed-out visitor should sign in
first via the existing account flows). Clicking it reveals a text input +
"Redeem" button + inline error/success line, styled like the modal's
existing `#pricingError`.

On submit: `POST /api/redeem-passkey`. On success, call the existing
`refreshProConfig()` (already used after checkout returns, sign-in/out,
account deletion) to re-pull `/api/config` and update every entitlement-
driven UI surface in place, then close the modal. On failure, show the
server's error message inline (`"Incorrect code."` / `"Sign in first."`).

**Plan-status copy.** `billingStatusCopy()` gets a `p.tester` branch
parallel to the existing `p.admin` one:

```js
if (p.tester) {
  return {
    title: "Pro — comped (beta tester)",
    detail: "Full Pro access as a beta tester. Nothing is billed, and there's no subscription behind it.",
  };
}
```

Checked in the same position as the admin check (before the Stripe-status
branches), same reasoning: a tester has none of those states either.

**`hasBillingHistory()`** currently reads:
```js
return Boolean(currentUser) && proConfig && proConfig.status
  && proConfig.status !== "none" && !isAdminPro();
```
Add a parallel `isTesterPro()` helper (`Boolean(proConfig && proConfig.tester)`)
and exclude it the same way admin is excluded — a comped tester's
`status` is `"tester"`, not `"none"`, so without this exclusion they'd see
a "Manage billing" button that 400s at Stripe.

Everything else — hiding the upgrade/pricing buttons, unlocking comps/
exports/lookback/Explorer in the UI, the on-screen letterhead gating — is
already driven by the generic `proConfig.isPro` / `canExploreAddresses` /
`canBrand` flags the same way it is for admins and paying subscribers, so
no further UI changes are needed there.

## Security notes

- Passkey comparison uses the existing constant-time `secretMatches()`
  helper — no new timing side-channel.
- The route is signed-in-only and rate-limited per IP, so brute-forcing
  the passkey costs an account plus a slow IP-limited loop.
- The grant is Pro-only. It does not touch the `internal` header-only
  bypass in `/api/comps`, does not touch the vault, and does not touch the
  admin dashboards. A leaked `TESTER_PASSKEY` costs comped Pro accounts,
  not comped staff tooling.
- Like the admin branch, this is entirely inert while `PRO_ENABLED` is off
  or `TESTER_PASSKEY` is unset — no behavior change on a deployment that
  hasn't configured it.

## Testing

- `entitlements.js` — pure, so `npm test` covers the new branch directly:
  granted only when `enabled && !pro && tester && user`; a real active/
  cancelling/grace subscription always wins over a tester flag;
  `PRO_ENABLED=off` still wins over everything; `broker`/`canUseVault` are
  false on this branch; `status` is `"tester"` never `"active"`.
- `test/routes.test.js` — boot a real server and prove
  `POST /api/redeem-passkey` is actually wired: 404 when unset, 401 signed
  out, 401 wrong passkey, 200 + flag set on match, idempotent on repeat.
- No new pure module needed — the redeem route's logic is a handful of
  sequential checks, not a decision table worth extracting.

## Out of scope (deliberately)

- Per-tester individual codes, expiry, or usage tracking — the owner chose
  the single shared passkey model.
- A UI for the owner to see who has redeemed — `select email from users
  where pro_tester` in Supabase is enough for a low-volume beta.
- Vault access for testers.
