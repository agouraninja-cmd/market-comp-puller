# Client sharing (broker tier v3): permissioned reports with viewer lists

**Date:** 2026-08-06
**Status:** Design approved by the owner 2026-08-06. No code written yet.
**Source:** "CompNinja Ecosystem Plan" (2026-07-31) §3 v3, §7 step 5, §8.
`docs/ROADMAP.md` "Later" → v3 client sharing.
**Builds on:** `docs/superpowers/specs/2026-08-06-blended-comps-data-contract.md`
(v2, shipped), `migrations/013-broker-vault.sql` (v1, shipped).

## The feature in one line

A broker sends a valuation report to a named client instead of to a public
URL, and the client sees the same number the broker saw.

## Why now, and what it fixes

Sharing today is the exact opposite of permissioned. `POST /api/share` writes
an unowned payload under a random id, with no expiry, readable by anyone who
has the link. There is no owner, no audience, and no way to take it back.

v2 gave that a sharp edge. A broker's browser holds a *blended* report, so
`/api/share` now strips every `private: true` comp server-side, and the
blended-comps contract says why in one line: a shared report "is public by
design and has no viewer check to fall back on." v3 is what gives it one.

The strip has a consequence nobody has had to face yet: the hero range is
computed in the browser from the comps present, so removing the broker's own
deals moves the number. A broker walks a client through a valuation, sends the
link, and the client opens a different figure. Fixing that is the reason v3 is
worth building rather than merely nice.

## Two states on the object, not three

The plan says "broker, registered client, or public." Broker-only already
exists and is called the portfolio: a saved report on My Desk that no one else
can read. A share row exists *because* someone else must read it, so it
carries `public` or `invited`, and revoking returns the report to broker-only.

Do not build a third state. It would duplicate `portfolio_items` and give two
places to answer the same question.

## Schema (migration 018)

`shared_reports` today is `(id, payload, created_at)`. It gains four columns,
all with defaults chosen so that **every row that already exists stays exactly
what it is: an unowned public link that works forever.** That is not a
courtesy. The BOV follow-up email has already mailed `/r/<id>` links to
property owners who have no account and never will.

```sql
alter table shared_reports
  add column if not exists user_id uuid references users(id) on delete set null,
  add column if not exists visibility text not null default 'public',
  add column if not exists include_private boolean not null default false,
  add column if not exists revoked_at timestamptz;

create table report_viewers (
  id uuid primary key default gen_random_uuid(),
  share_id text not null references shared_reports(id) on delete cascade,
  email text not null,              -- lowercased, trimmed, at write time
  invited_at timestamptz not null default now(),
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  unique (share_id, email)
);
create index on report_viewers (email);
```

`on delete set null` for `user_id`, not cascade: a broker deleting their
account must not silently break a link their client is relying on. The share
loses its owner and becomes unmanageable, which is the honest outcome.

**Identity is the email, not a user id.** A viewer invited before they have an
account gets access the moment they sign up with that address, with nothing to
reconcile. The invitation email must therefore say which address to use.

## Creating a share

`POST /api/share` keeps its current body and gains three optional fields:

```jsonc
{ "data": {...}, "meta": {...},
  "visibility": "public" | "invited",   // default "public"
  "viewers": ["client@firm.com"],       // invited only, max 20
  "includePrivate": false }             // invited only, default false
```

Rules, all enforced server-side because the browser is never the authority on
who may read something:

- `visibility` defaults to `public`, so the existing Share button, the BOV
  follow-up, and every caller that sends today's body behave identically.
- `invited` requires a signed-in member with `ent.pro`. Anonymous or free gets
  403 and the pricing prompt. Public links stay free, exactly as today.
- `viewers` are lowercased, trimmed, format-checked, deduped, capped at 20.
  An empty list is allowed: the share exists, only the owner can read it, and
  viewers can be added later.
- `includePrivate` is honored only when `visibility` is `invited` **and**
  `ent.canUseVault`. `public` plus `includePrivate` is a **400, not a silent
  strip**: a client bug that would publish a broker's book of business should
  be loud on the first attempt, not quietly correct on every attempt.
- `user_id` is stamped from the session whenever one exists, including for
  public shares, so the owner can list and revoke them. An anonymous public
  share stays unowned, as now.
- **Invited shares are database-only.** If Supabase is unconfigured the route
  answers 503, the same refusal the vault makes and for the same reason: an
  access-control list in a JSON file on an ephemeral disk is not one. Public
  shares keep the file fallback untouched.

Three new routes carry the management surface:

- `GET /api/shares` returns both halves in one call, because `/desk` needs
  both and it is a page-load path: `{ mine: [...], sharedWithMe: [...] }`.
  Each `mine` row carries address, type, visibility, created_at, revoked_at
  and its viewers with their view stamps.
- `PUT /api/shares/viewers` `{ id, emails: [...] }` replaces the viewer list
  wholesale, mirroring `PUT /api/dev-ideas`. Whole-list replace has one state
  to reason about; add-and-remove has three.
- `POST /api/shares/revoke` `{ id }` stamps `revoked_at`. One-way. The UI says
  plainly that the link stops working and cannot be turned back on.

All three are scoped by `user_id` on every read and write, the same rule the
vault routes follow: knowing an id must never be enough to touch a row.

## What the client sees of the vault

| Share type | Private comps |
|---|---|
| Public | Stripped, `stripPrivateComps`, unchanged |
| Invited, default | Anonymized into `locked_basis` |
| Invited, `includePrivate` | Carried in full, `private: true` intact |

The default is the interesting one, and it reuses machinery that already
exists and is already tested. Each private comp is replaced by `basisRow()`
from `comp-gate.js`: date, transaction, size, $/SF, provenance, and nothing
else. No address, no total price, no notes, no coordinates. Those rows are
appended to `locked_basis`.

Because the browser computes the valuation from `includedComps()` plus
`lockedBasis()`, **the client's hero range then matches the broker's to the
dollar** while no identifying detail leaves the vault. This is the same
tradeoff `comp-gate.js` already documents for free-tier reports, and the same
reason: the number has to match, or the feature is a lie.

`private_count` survives on the shared report so the page can say "3 comps
from your broker's own records are included in this valuation but not shown."
The exact wording is Jacob's.

The full-detail path is a per-share checkbox, off by default, whose confirm
text states what it does: the addresses reach that person, and MLS re-share
terms are the broker's to honor. That is §8's position expressed in the
interface rather than buried in terms nobody reads.

New pure function, in `blend-comps.js` beside its sibling:
`anonymizePrivateComps(report)`, requiring `basisRow` from `comp-gate.js`.
Both modules are pure, so the require is free and `npm test` covers it.

## Reading a share

`GET /api/shared?id=` gains a viewer check:

- `public` and not revoked: served as today.
- `invited`: served only to the owner or to a session whose email is on the
  viewer list. Everyone else gets **403 with `signin_required: true`**, the
  shape the client already understands from the guest gate, so `/r/<id>`
  renders a sign-in card instead of an error. Signing in returns to the same
  URL.
- revoked: 403 saying the link was turned off, and **without**
  `signin_required`, because signing in cannot help and a sign-in card would
  send the client round a loop. Never a 404 either: "not found" sends them
  hunting for a typo in a link that was correct.
- Any error resolving the owner, the visibility, or the viewer list: **refuse.**
  Fails closed, like `/api/report-access`.

A successful invited read stamps `first_viewed_at` (once) and `last_viewed_at`
for that viewer. That is what powers "opened Aug 7" on the broker's list.

**The access-control fields are never cached.** `sharedReportsMem` caches
payloads by id for the life of the process, which is right for a payload and
catastrophic for an ACL: a revoked share would keep serving from memory until
the next deploy. The payload may cache; visibility, `revoked_at` and the
viewer list are read every time.

`/r/<id>` keeps its `ACCOUNT_WALL` exemption. An invited client has to be able
to land on the URL, see whose report it is, and sign in from there.

## The decision, in one pure module

`report-access.js`, new, pure, no I/O and no clock reads (the caller passes
`now`), exactly like `entitlements.js` and for the same reason: `npm test` can
then exercise the whole table with no database.

```js
canReadShare({ share, viewers, user, now }) -> { ok, reason }
```

`reason` is one of `public`, `owner`, `invited`, `revoked`, `not_invited`,
`signin_required`. server.js owns every read and write; nothing else in the
codebase decides who may read a share. This is the same rule the paywall
follows, and for the same reason scattered plan checks are how a paywall grows
holes.

## Where each side sees it

- **Broker,** on `/desk`: a "Shared reports" list. Address, visibility, each
  invitee with "opened Aug 7" or "not opened yet", edit the viewer list,
  revoke.
- **Client,** on `/desk`: a "Shared with me" section from the same
  `GET /api/shares` call. A free account is enough; nothing here requires Pro.

The invitation email rides the existing `sendOutboundEmail` gate, so with
`EMAIL_FROM` or `RESEND_API_KEY` unset it logs "Outbound email skipped" and
the broker copies the link by hand, exactly as password reset behaves today.
**A failed or skipped send never fails the share**: the link exists the moment
the row is written.

## One trap in the existing front end

`publishCurrentReport()` in `index.html` memoizes the created link per report
object (`lastPublished`), so that pressing Share and then requesting a BOV does
not publish twice. The memo knows nothing about visibility. Left alone, a
broker who shares a public link and then invites a client would be handed back
the **public** URL, and would believe they had sent a permissioned one.

The memo key must include visibility, the viewer list and `includePrivate`, or
the memo must be dropped when any of them is set. This is the single most
likely way to ship this feature looking correct and being wrong.

## Explicitly not in v3

- Expiry dates. Shares have never expired; a clock is a new failure mode with
  no asked-for benefit.
- Viewer comments or annotations.
- Permission levels beyond view.
- Any attempt to stop a viewer forwarding what they can already see. The
  honest control is revocation, which is built.
- Changes to export entitlements. A viewer exporting a shared report spends
  their own allowance, unchanged.

## Test obligations

`npm test` before this is done:

- `report-access.js`: the full decision table, including revoked, not-invited,
  owner-reading-own, anonymous-on-public.
- `POST /api/share` with `visibility: "invited"` from an anonymous caller is
  refused with 401, **before** the 503 a database-less server would give, so a
  stranger never learns whether the database is up. Same ordering rule
  `openVault` follows.
- Every management route (`GET /api/shares`, `PUT /api/shares/viewers`,
  `POST /api/shares/revoke`) refuses an anonymous caller and exists rather
  than 404ing.

  These wiring tests live in `test/routes.test.js`, which boots a real server
  with no Supabase. That file's standing rule is that nothing it runs touches
  an external service, so the **happy paths** (an invited email reading a
  share, a stranger being refused one) cannot live there: both need a real
  session, which needs a database. They rest on `report-access.js`'s decision
  table plus one manual check against the deployment, exactly as the vault's
  403-and-200 paths already do.
- `public` plus `includePrivate` is a 400.
- Default invited share: no comp carries `private: true`, `locked_basis` grew
  by the private count, and the valuation inputs are unchanged.
- `includePrivate` share: private comps present, and still absent from the
  cache, the corpus and any public share of the same report.
- Revoking a share makes an already-cached payload unreadable in the same
  process.

## Open questions

- **Attorney (§8):** the wording of the full-detail confirm, and whether the
  terms need to name MLS re-sharing at the moment a broker opts in. The
  feature ships with the checkbox off, so this does not block the build.
- Whether an invited client should be offered the report as a PDF export at
  all, or only on screen. Left as-is (their own entitlements) until a real
  broker asks.
