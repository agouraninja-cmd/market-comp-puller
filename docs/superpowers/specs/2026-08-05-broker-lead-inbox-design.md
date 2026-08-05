# Broker lead inbox, and one broker identity

**Date:** 2026-08-05
**Status:** Designed, not built.
**Source:** Ecosystem Plan (2026-07-31) §5 (the Broker Connection Hub) and §7;
`HANDOFF-2026-08-05-broker-tier.md` "Not built" item 1 and the "broker identity
is still two systems" known gap; `docs/ROADMAP.md` "Later" (hub monetization
fallback: lead visibility as a subscription benefit).

## Goal

Give a paying broker the thing they would actually pay for: visibility into
BOV demand in their markets, delivered the moment it happens, without moving
any personal data that does not already move today.

Today a BOV lead goes only to the owner's inbox. The broker whose market it
landed in never learns it happened; `findBrokersForMarket()` pastes their
contact details into the owner's email for a manual introduction. This feature
formalizes the broker-facing half of that loop and nothing else: the owner
still makes every connection by hand.

Referral fees are assumed barred (Ecosystem Plan §5: the owner is unlicensed;
attorney question still open). This design is the sanctioned fallback: lead
visibility is a benefit of the broker subscription, not a per-lead
transaction. No money moves per lead, so nothing here waits on the attorney.

## What a broker sees, and what they never see

A lead in the inbox is four facts: **market** ("Boise, ID"), **property
type**, **size** (when known), and **date**. Never the owner's name, email,
phone, company, or street address. The anonymization happens server-side; the
identifying fields never leave the server, so no client bug can leak them.

The broker's one action is **Request introduction**. That emails the owner
(who already holds the lead's PII) naming the broker and the lead. Nothing is
sent to the property owner, and no broker PII goes anywhere it does not
already go. The owner connects the two by hand, exactly as today. The
request also tells the owner which leads brokers actually want: pricing
signal for the tier.

## Part 0: one broker identity (prerequisite)

The handoff's flagged gap, fixed first because every new broker surface would
otherwise deepen it. Today `/api/broker/me` decides "is a broker" by "has this
email ever submitted a comp", and `broker_profiles` is keyed on `email` with
no `user_id`; the paid tier keys on a subscription against `user_id`. A broker
who pays but never submitted reads `isBroker: false`, and an email change
orphans a profile.

- Migration 015 adds `user_id uuid references users(id) on delete set null`
  to `broker_profiles`, unique where not null, plus a backfill matching
  existing profiles to `users` on lowercased email.
- server.js: any signed-in touch of a broker surface (`/api/broker/me`, the
  profile save) adopts the email-matched profile row and stamps its
  `user_id`. Reads prefer `user_id` and fall back to email for legacy rows.
- "Is a paying broker" is `canUseVault`, already computed and failing closed
  in `entitlements.js`. "Has contributed comps" stays a separate, weaker
  fact. No new plan checks anywhere else (the standing entitlements rule).

## Part 1: coverage (which leads a broker sees)

New table `broker_coverage` (migration 015): `id`, `user_id not null
references users(id) on delete cascade`, `market text not null`,
`property_type text not null`, `source text` ('earned' or 'chosen'),
`created_at`, `unique (user_id, market, property_type)`.

- **Seeded from contributions:** on a broker's first inbox open (zero
  coverage rows), the server derives markets from their approved
  `comp_submissions` and inserts them with `source: 'earned'`.
- **Editable:** `GET/POST/DELETE /api/broker/coverage`, gated on
  `canUseVault`. A paying broker with no contributions picks their markets
  and sees leads immediately; contributors get theirs pre-filled.
- `market` is written only via `marketOf()` in server.js, the same
  canonical-form rule `broker_comps.market` follows, so coverage rows match
  `marketOf(lead.address)` byte for byte. `broker-leads.js` (the pure module)
  deliberately does not compute markets.

## Part 2: lead size

`leads` gains nullable `size_sqft` (migration 015). The BOV form starts
sending the subject SF it already holds client-side; `POST /api/lead` cleans
it (positive finite number, else null). Old leads render size as a dash.
This is what makes an anonymized card worth reading: "Industrial · Boise, ID
· 42,000 SF · Aug 5".

The `leads` table predates the migrations folder, so migration 015's notes
must record its verified primary key; if it has none usable, 015 adds one.
`migrations/verify.js` learns every new table and column.

## Part 3: the inbox

`GET /api/broker/leads`, gated on `canUseVault` exactly like `/api/vault*`.

- Reads recent BOV leads (last 90 days, capped at 200, newest first),
  filters `marketOf(address)` + property type against the caller's coverage
  in server.js (the `findBrokersForMarket` fetch-then-filter pattern), and
  returns only `{ id, market, type, size_sqft, ts, intro_requested }`.
- **DB-only, no file fallback** (the vault rule): a read error returns 503
  and the UI says it could not load. An empty list on error would misreport
  demand as zero, which is worse than admitting the outage.
- UI: a Leads section on the existing vault page, plus a lead count on the
  My Desk broker card. Calm, table-style, no new visual language.

## Part 4: request introduction

`POST /api/broker/leads/intro { lead_id }`, gated on `canUseVault`.

- Validates the lead exists and is inside the caller's coverage (no
  requesting introductions to leads you cannot see).
- Inserts into new table `lead_intro_requests` (migration 015): `id`,
  `lead_id not null`, `user_id not null references users(id) on delete
  cascade`, `created_at`, `unique (lead_id, user_id)`. Duplicate requests
  answer 200 with `already: true`; no double emails.
- Emails the owner via the existing `notifyByEmail`: broker identity plus
  the full lead. The owner already holds that PII; this is the same email
  flow that announced the lead, now carrying which broker wants it.
- The inbox renders the requested state from this table.

## Part 5: new-lead notification

In the existing `POST /api/lead` BOV branch, after the lead is stored:
query `broker_coverage` for that market + type, resolve broker emails
through `users`, and `sendOutboundEmail` each match (capped at 20) the
anonymized line with a link to the inbox. Fire-and-forget through the
existing `EMAIL_FROM` gate, so a mail failure never breaks lead capture and
an unset `EMAIL_FROM` means the sends no-op with a log line. The owner's own
notification email is unchanged.

## Testing

New pure module `broker-leads.js`, no I/O and no clock reads, same contract
as `entitlements.js` and `comp-gate.js`, covered by `npm test`:

- coverage matching (lead + coverage rows in, matched user_ids out),
- lead anonymization (the exact allowed field list, everything else
  stripped; a test pins that name/email/phone/company/address never pass),
- coverage seeding from submission rows (dedupe, market canonical form
  supplied by the caller),
- intro-request validation (in-coverage check, duplicate handling).

server.js owns every read and write. No entitlement logic changes:
`canUseVault` already exists and is already tested.

## Rollout

Ships dark by construction: `canUseVault` is false for everyone except
signed-in admins until `STRIPE_PRICE_BROKER_MONTHLY` is set. No new env
vars. Migration 015 runs before deploy (`node migrations/verify.js` to
confirm); devlog entry in the same commit as the ship.

## Out of scope

- Revealing owner PII to brokers after owner approval (a later hub step,
  and premature before attorney review of broker-facing terms).
- The broker directory (handoff item 2; separate spec when picked up).
- Daily digests or any scheduler; per-lead email only.
- Lead pricing, per-lead billing, or referral fees in any form.
- Backfilling size onto historical leads.

## Open questions

- **Chuck:** does per-lead email volume feel right for a working broker, or
  does it want a frequency control before launch?
- **Attorney (gates launch, not development):** broker-facing terms for
  lead visibility as a subscription benefit; confirm no referral-fee
  exposure in the request-introduction flow.
