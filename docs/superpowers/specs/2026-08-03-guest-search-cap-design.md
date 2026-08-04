# Guest search cap: one free search, then free sign-in

**Date:** 2026-08-03
**Status:** Approved (approach chosen by owner: IP ledger + cookie)

## Goal

Every visitor without an account gets exactly **one free report search, ever**.
After that, running another search requires signing in with a **free** account.
No payment is involved; this is a signup funnel, not a paywall. Signed-in users
have no personal search cap (the existing per-IP burst limiter and the global
`DAILY_SEARCH_CAP` still protect spend).

## What counts as "a search"

A served report from `POST /api/comps`: fresh, cache hit, or derived-window
hit all count. Cache hits cost nothing in API spend, but the funnel is the
point; a guest must not be able to re-run cached addresses free forever.

Out of scope, deliberately not counted:

- `POST /api/explore-market` (Address Explorer): corpus-first, has its own
  tight limiter (3 per 15 min per IP). Left ungated for now.
- Viewing shared reports (`/r/<id>`), market pages, and every other read-only
  surface.
- Internal callers sending `x-admin-key` (seed generator, Explorer pipeline):
  bypass, exactly like the Pro gate.

A **failed** search does not consume the free search: the quota is consumed
only at the moment a report is actually served.

## Tracking (the two signals)

A guest has "used their free search" when **either** signal says so:

1. **Hashed-IP ledger** (authoritative, durable). A row per SHA-256 of the
   client IP (`clientIp(req)`, the existing spoof-resistant helper) recording
   how many searches that IP has consumed. Stored in a new Supabase table
   `guest_search_quota` (DDL comment in server.js beside the feature, same
   convention as every other table):

   ```sql
   create table guest_search_quota (
     ip_hash text primary key,
     used integer not null default 0,
     first_ts timestamptz not null default now(),
     last_ts timestamptz not null default now()
   );
   ```

   Fallback when Supabase is unconfigured or down: in-memory Map plus a
   git-ignored `guest-quota.jsonl` append file, consistent with the other
   stores. Raw IPs are never stored, only the hash.

2. **`cn_guest` cookie** (fast path, survives IP changes). httpOnly,
   SameSite=Lax, Path=/, Max-Age two years. The cookie does **not** carry a
   count (a client-held count is trivially forged); it is set only once the
   ledger says the quota is exhausted, and its presence alone blocks. It is
   set on the plain-JSON `/api/comps` exits, and, because the SSE path sends
   headers before the outcome is known, also on any `GET /api/config`
   response where the ledger says the guest is exhausted. `/api/config` runs
   on every page load, so the cookie syncs no later than the next visit.

**Failure posture: fail open.** A ledger read error allows the search (the
global daily cap is the cost backstop). Ledger writes are fire-and-forget.

## Enforcement point

In `POST /api/comps`, after the password gate, rate limiter, and validation,
and **before any report exit** (cache hit, derived hit, fresh search):

- Resolve the session user (`getSessionUser(req)`; cheap, session-cached).
- If signed in, or internal, or the gate is disabled: proceed as today.
- If guest and (cookie present OR ledger `used >= limit`): respond
  `403 { error: "...", signin_required: true }`. The front-end keys off the
  `signin_required` flag, never the status code.
- Otherwise proceed; when a report is served, increment the ledger
  (fire-and-forget) and set the cookie if the limit is now reached.

## Configuration

`GUEST_SEARCH_LIMIT`, a new env var:

- unset or `1` (default): one free search per guest.
- any positive integer N: N free searches.
- `0`: no free searches; guests must sign in before any search.
- `off`: gate disabled entirely, app behaves exactly as today. This is the
  instant rollback lever on Render, no deploy needed.

Startup logs the active setting, matching the existing cap log line.

## API surface changes

- `GET /api/config` gains `guestSearch: { limit, used }` (both numbers;
  omitted entirely when the gate is off or the visitor is signed in). The
  `.catch` fallback response omits it, which the front-end treats as "no
  gate". Presentation only; enforcement is server-side.
- `POST /api/comps` gains the `403 { error, signin_required: true }` response.
- A PII-free `logEvent("signup_gate", { market, prop_type })` fires when a
  guest is blocked, so /admin can show whether the funnel converts.

## Front-end changes (index.html)

- **Blocked search:** when the `/api/comps` response body carries
  `signin_required`, open the existing account modal in signup mode:
  `openAcctModal("signup", "You've used your free search. Create a free
  account to keep searching. It's free, no card needed.")`. No new modal, no
  new error UI. After signing in, the form state is still on screen; the user
  resubmits. (Auto-resubmit after sign-in is a possible later polish, not in
  scope.)
- **Up-front hint:** when `/api/config` reports the guest is exhausted
  (`used >= limit`) and no one is signed in, show one calm line under the
  search button: "You've used your free search. Sign in free to keep
  searching." No banners, no color noise, per the calm-UI rule.
- Sign-in/sign-out already calls `refreshProConfig()`; that re-read naturally
  clears the hint.

## Privacy policy

The policy currently says the Service sets one essential cookie,
`cn_session`. Update that sentence to cover `cn_guest` (essential,
non-tracking, used to enforce the free-search allowance) and note that the
server keeps a hashed form of the visitor's IP address for the same purpose.

## Edge cases and accepted trade-offs

- **Shared office IP:** the second person behind one IP finds the free search
  already spent. Accepted; their remedy is the free signup, which is the goal.
- **Determined bypass:** VPN plus incognito defeats both signals. Accepted;
  accounts are free anyway, and the burst limiter plus daily cap bound the
  spend. This gate is friction for the honest majority, not security.
- **DAILY_SEARCH_CAP interaction:** unchanged. The global cap still only
  counts billed searches; the guest gate counts served reports.
- **`APP_PASSWORD` deployments:** the gate still applies after the password
  gate. Internal deployments that want no gate set `GUEST_SEARCH_LIMIT=off`.
- **Account deletion:** deleting an account does not refund the guest quota
  for that IP. Accepted.

## Testing

The decision itself (used vs limit, signed-in bypass, off switch) is a few
lines and lives in server.js beside the rate limiter; no new test surface.
`npm test` (entitlements.js) must still pass untouched. Manual verification
before deploy: guest first search succeeds, second search opens the signup
modal, sign-in unblocks, `GUEST_SEARCH_LIMIT=off` restores today's behavior,
and the cookie plus a cleared-cookie retry (same IP) both stay blocked.

## Shipping notes

- Run the `guest_search_quota` DDL in Supabase **before** deploying.
- Add the fallback file to `.gitignore`.
- Devlog entry in the same commit, per the standing rule.
