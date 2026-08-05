# Broker tier v1: billing rails, and the shape of the vault

**Date:** 2026-08-05
**Status:** Billing implemented (this branch). Vault schema + dashboard NOT
started — that is the other half of v1 and is deliberately left open for a
parallel session.
**Source:** "CompNinja Ecosystem Plan" (2026-07-31, distilled from the Chuck
meeting) §2, §3, §6, §7. `docs/ROADMAP.md` "Now" → broker tier v1.

## Goal

Ship the paid broker tier's **billing and entitlement rails** so the vault
work can proceed against a settled contract, and so the tier can be sold the
moment pricing is decided — without a code change.

v1 of the broker product (Ecosystem Plan §3) is:

> Upload comps (CSV or PDF); private storage; a clean, sortable dashboard by
> property and by market. The core paid promise.

This document covers the billing half in detail (built), and fixes the
interfaces the vault half depends on (not built).

## The one rule everything else serves

**CompNinja stores broker data but never reads it into the public database.**
Ecosystem Plan §2: privacy is not a feature of the broker product, it *is* the
broker product. Concretely, in this codebase:

- `harvestComps()` must never see a vault row.
- `corpusRowsForMarket()` / `retrieveCorpusComps()` must never return one.
- `maybePublishMarketSnapshot()` and `gen-market-seed.js` must never read one.
- No vault row may influence another account's report, ever.

The single sanctioned door is **per-comp opt-in publishing** (Ecosystem Plan
§4), which is a *later* step in the build order (§7 step 3) and is explicitly
**out of scope for v1**. v1 stores and displays; nothing crosses.

The practical consequence for whoever builds the vault: the vault is a
**separate table read by separate functions**. Do not add a `private boolean`
column to `comp_corpus` and filter on it. One missed `.eq("private", false)`
in one query is a leak of a broker's book of business, and the corpus read
path already swallows its own errors (see the corpus-health note in
CLAUDE.md), so it would leak *silently*. Separate tables make the leak
impossible rather than merely unlikely.

## Billing (built on this branch)

### The plan

One new plan: **`broker_monthly`**.

It is a **superset of Pro**, not a sibling — Ecosystem Plan §2, "everything a
user gets, plus a private workspace built on their own comp data". A broker
gets unlimited comps, the 120-month lookback, unlimited exports, branding and
the Address Explorer by the ordinary Pro route, because a broker plan in a
live subscription state satisfies the existing `pro` test. The tier adds
exactly one capability on top.

Modelled as a **plan on the existing `subscriptions` table**, not a role
column on `users`. The reason is access expiry: a role flag survives a
cancelled card and would quietly keep a vault open forever, where a
subscription row runs through `subscriptionState()` and lapses like everything
else — including the 24h renewal slack and the 7-day payment grace.

`subscriptions.plan` is a free-text column with no CHECK constraint, so
**this needs no migration**. That is deliberate: it keeps the billing lane
entirely clear of the vault's schema work.

### Entitlements

Two new fields on the `computeEntitlements()` result:

| Field | Meaning |
|---|---|
| `broker` | identity — this account holds a live broker subscription (mirrors `pro`) |
| `canUseVault` | capability — may open/read/write their vault (mirrors `canBrand`) |

Two names for what is currently one boolean, matching the existing
`pro`/`canBrand`/`canExploreAddresses` split — and they genuinely diverge on
the comped-admin branch, where `admin: true` labels access as comped rather
than sold.

**Vault routes must test `ent.canUseVault` and nothing else.** Not
`ent.plan === "broker_monthly"`, not a status string. Scattered plan checks
are how a paywall grows holes, and this one guards private data.

The decision table, all covered by `npm test` (16 new tests):

| Situation | `canUseVault` |
|---|---|
| Active `broker_monthly` | ✅ |
| Broker, cancelling, inside paid period | ✅ |
| Broker, payment failed, inside 7-day grace | ✅ |
| Broker, expired | ❌ |
| Active `pro_monthly` / `pro_annual_founding` | ❌ |
| Single-report purchase | ❌ |
| Free / anonymous | ❌ |
| Live subscription, unrecognized plan name | ❌ |
| Signed-in admin (`ADMIN_KEY`), Pro enabled | ✅ (comped) |
| Admin, `PRO_ENABLED` off | ❌ |
| Anonymous request holding `ADMIN_KEY` | ❌ |
| **`PRO_ENABLED` off (dark deployment)** | ❌ |

Two rows in that table are the ones worth arguing about:

**Unrecognized plan name → no vault.** This is *stricter* than `pro`, which is
governed by subscription status alone and deliberately grants access on an
unfamiliar plan name (there is an existing test pinning that: "status still
governs access"). Erring generous is right when the alternative is stripping
comps from someone whose card cleared. It is wrong for a private data store,
where the failure mode is an unowned vault rather than a few extra rows.

**Dark deployment → no vault**, even though that same branch grants unlimited
comps, unlimited exports and the Explorer. `PRO_ENABLED=off` means "behave as
the app did before the tier existed", and it restores things visitors *used
to have for free*. The vault was never free — it did not exist. Granting it
here would hand a private workspace and an upload endpoint to every anonymous
visitor on any deployment that simply has not switched Pro on yet, which is
the default.

### The price is not in this repo

`STRIPE_PRICE_BROKER_MONTHLY`, unset today. Broker-tier pricing is an open
question for Chuck (Ecosystem Plan §8), and this repo's standing rule is that
the number lives in Stripe while the copy lives in `index.html` — they can
disagree and **nothing detects it**.

So the whole broker path ships **dark and safe**: `/api/checkout` answers
`503 "That plan isn't configured"` for `broker_monthly` until the env var is
set. Turning the tier on is: create the Stripe price → set the env var →
ship the pricing tile copy. **In that order** — undercharging while the copy
is stale is the safe direction.

### Not built, and why

**The pricing-modal buy tile.** It needs a number in prose, and inventing one
would arm exactly the copy-vs-Stripe mismatch described above. When it is
added: it belongs in the **one** existing `#pricingModal`, its
`.pricing-buy` `data-plan` must read `broker_monthly` to match the `PLANS`
table in `/api/checkout`, and any new locked surface reaches the modal via the
`.unlock-comps-btn` class rather than a second upgrade prompt.

## The vault (NOT built — the contract for whoever takes it)

Ecosystem Plan §6 settles the architecture question: **adopt the star schema
for the new broker layer; do not rebuild the existing tables.** The current
schema serves a live app well and a migration would burn weeks for no visible
gain, but the broker dashboard — "all my comps, sliced by property or by
market" — *is* a fact-table query, and designing it star-style costs nothing
at design time.

Sketch, to be settled by whoever writes the migration (next free number is
`013`):

- `broker_comps` — the fact table. One row per comp transaction, with the
  measures (price, size, $/SF, date) and foreign keys out to dimensions.
- Dimensions for property, market, broker, and time.
- `broker_uploads` — one row per CSV/PDF ingested, so a bad import can be
  rolled back as a unit and the dashboard can show provenance.

Fixed points the billing half depends on, which should not drift:

1. Every vault route resolves access through `entitlementsFor(req)` and tests
   **`canUseVault`**.
2. The vault's tables are read by their **own** functions. No corpus function
   gains a "…or broker rows" branch.
3. Vault rows carry the owning `user_id` and every read is scoped by it. A
   broker must not see another broker's vault any more than the public may.
4. Unlike the billing tables, the vault should have **no file fallback**.
   Render's filesystem is ephemeral, and a broker's uploaded book of business
   written to disk would both vanish on redeploy and sit unencrypted on a
   shared host. Fail loudly instead.

## Open questions

**For Chuck** (Ecosystem Plan §8, unchanged): broker-tier monthly price; which
dashboard views matter on day one (by property, by market, by client, by deal
stage).

**For the attorney** (§8, unchanged): terms for storing broker private data —
processing limits, deletion rights, liability if a broker uploads data they
were not licensed to hold. **This gates launch, not development.**

**Newly raised by this work, needs an owner decision:**

- **What happens to vault DATA when a subscription lapses?** `canUseVault`
  answers only "may they open it today", and after a lapse the answer is no.
  Whether the rows are retained, exported, or deleted is a product and privacy
  decision, and the privacy policy will have to state it. Retaining a lapsed
  broker's private comps indefinitely is the current implicit default and is
  probably not the right one.
- **Is there an upload size or row cap?** v1 says "upload comps" with no
  limit. Uncapped upload to a paid tier is a cost and abuse surface. Not
  invented here — it is a pricing question, so it travels with Chuck's.
- **A latent hole, pre-existing and untouched:** `pro` is true for any live
  subscription status even when the plan name is unrecognized, while `plan`
  reads `"free"`. No live row can reach that state today, since
  `subscriptionRowFrom()` only emits plans we sell. Left alone deliberately —
  an existing test pins the behavior — but it is worth a decision rather than
  a rediscovery.
