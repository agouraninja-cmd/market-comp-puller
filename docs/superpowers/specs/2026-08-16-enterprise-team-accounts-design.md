# Enterprise accounts: a firm as an account, not a login everyone shares

Status: **DESIGN ONLY — nothing here is built.** Written 2026-08-16 in answer
to Chuck's email of the same day. Sections 1 and 12 hold questions only the
owner and the attorney can answer; sections 2-11 are the design that follows
from the answers this document recommends.

Chuck's email, quoted because the whole design turns on the example in it:

> Currently the system only allows one user to view their private data and the
> comps shared with them directly. We should look into an "enterprise" type
> account relationship. So users from the same company can see their companies
> data and shared comp reports, BOVs etc.
>
> Ex: Brad doesn't have to email Spencer the BOV and then email it to Mike or
> Charity if they ask for it. They just login to their account, and see the
> uploaded BOV from the different brokers.
>
> Many accounts can have shared data access but can still have their own comp
> reports, and dashboard items.

The last sentence is the specification. Everything below is an attempt to
build only that, and specifically to avoid building the thing it is one small
step away from — a firm login where everyone can read everyone.

## The feature in one line

A firm is an account of its own with a shelf on it; each broker keeps the
workspace they have today and *publishes onto* the firm's shelf, so the firm's
work outlives the email thread that used to carry it.

## What Chuck is actually describing, precisely

His example is a **distribution** problem, not a storage problem. The BOV
already exists, in Brad's account, correctly. What fails is that the only way
Mike gets it is Brad noticing the request and forwarding a file — and six
months later the only copy is in four inboxes.

That distinction decides the architecture. The naive reading ("let coworkers
into each other's accounts") is a much larger and much more dangerous feature
than the one that solves his example, and it is the one that breaks the
promise the vault is sold on. The right primitive is a **firm-scoped shelf
that individuals publish onto**, plus **firm membership as a share audience**.

One naming precision, because the repo already uses the word two ways: a "BOV"
here is the **document a broker produces**, tracked in `broker_bovs`
(migration 019) and shared as a report link. It is not the `source: "bov"`
lead — a request from a property owner — which is a different table and a
different privacy class. Chuck means the document.

## What this is NOT

- **Not a data pool across firms.** Nothing here touches `comp_corpus`,
  `harvestComps()`, market snapshots, or the public records. Firm-shared is
  not published; the two words stay separate, and the "0 published" counter on
  `/vault` keeps meaning exactly what it means today.
- **Not an admin who can read a member's account.** A firm admin gets the
  shelf and the member list. They never get another member's reports,
  portfolio, watchlist, leads, BOV pipeline, or vault. The email says members
  "can still have their own comp reports, and dashboard items" and that is
  enforced, not merely respected.
- **Not retroactive.** Joining a firm exposes nothing a member ran before
  joining, and nothing they ran after unless they published it or set a
  default that says to.
- **Not a replacement for CBRE's research desk.** The pitch line is about
  retention, not about generating research — see §11.

## 1. The decided questions (owner + Chuck; NOT decided as of writing)

These gate the build. Recommended answers in brackets; each is argued below.

1. **Who owns a comp an employee uploaded, when they leave?** [Recommended:
   the uploader owns their vault; the firm keeps whatever was published to the
   shelf, as a snapshot.] This is the one that needs the attorney, and it is
   the same attorney question already open in ROADMAP about broker data.
2. **Does a member's new work go to the shelf by default?** [Recommended: the
   firm admin sets a default at creation; the member can override per report;
   never retroactive.]
3. **May a firm-shared vault comp blend into a colleague's report?**
   [Recommended: yes, opt-in per import, attributed by name — this is the
   feature's whole value, and §7 is the safe way to do it.]
4. **Is enterprise sold per seat now, or granted by hand?** [Recommended:
   granted by hand, the `vault_beta` precedent, until a real firm asks. See
   §9.]
5. **Do firm-shared reports carry the sender's private financials?**
   [Recommended: no by default, with an explicit per-report include that
   mirrors invited sharing's `includePrivate`.]

## 2. The constraint that shapes everything: the vault promise

`/vault` says "Visible only to you" in four separate places, and migration 013
says the reason plainly: a broker does not hand over their book because the
terms promise we cannot read it, they do it because they can watch the
published counter stay at zero. Migration 013 also chose *separate tables over
a `private` column* specifically because the public read path swallows its own
errors, so a missed filter would leak silently.

Enterprise cannot quietly redefine "you" as "your firm". Two rules follow, and
they are the two rules most likely to be broken by someone implementing this
in a hurry:

- **No existing `user_id=eq.` filter is widened to an org.** There are 61 of
  them in `server.js` and they are the wall. Firm-scoped reads are *new
  functions against new tables*, never an `or=(user_id.eq.X,org_id.eq.Y)`
  bolted onto a read that guards private data.
- **The moment a vault belongs to a firm member, the copy must say so.**
  "Visible only to you" becomes false the first time a comp is shared to the
  shelf, and a promise that quietly stops being true is worse than one that
  was never made. The header becomes conditional: personal comps say what they
  say today; shared ones say "Visible to you and 4 others at Colliers Boise".

## 3. Membership: invite-only, identified by email, never by domain

`orgs` + `org_members`. Identity is the **email**, adopting migration 018's
decision wholesale (and 024's after it): a colleague invited before they have
an account is recognized the moment they sign up with that address, with
nothing to reconcile. `user_id` is stamped on first authenticated read as a
join convenience, never as the thing access is decided on.

**Auto-join by email domain is refused outright**, and this is the single
most important refusal in the document:

- `gmail.com` and `outlook.com` are "companies" by that logic, and a large
  share of independent brokers use exactly those addresses.
- Even a real corporate domain proves only that someone can receive mail
  there — an intern, a contractor, a former employee whose forwarder still
  works, anyone at a firm that later splits.
- The blast radius is not a wrong preference, it is a stranger reading a
  firm's deal book.

A domain may be used as a **suggestion to an admin** ("3 people with
@colliers.com signed up — invite them?") and never as a grant. Equally,
`broker_profiles.company` is free text a broker typed about themselves; two
people typing "Colliers" are not verified colleagues and must never be joined
on it.

Roles are `owner` / `admin` / `member`, and an unrecognized role reads as
`member` — the least privileged — the same way `hub-access.js` reads an
unknown role as an observer and `report-access.js` reads an unknown visibility
as invited. Removal is `removed_at` and beats everything, ownership included;
it is one-way, matching the vault's stance that access lapsing is safer than
access silently returning.

## 4. Schema sketch (migration 028, purely additive)

```sql
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references users(id) on delete set null,
  -- The §5 default. 'none' = nothing reaches the shelf unless published by hand.
  share_default text not null default 'none'
    check (share_default in ('none', 'reports')),
  seats integer not null default 1,
  created_at timestamptz not null default now()
);

create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,                    -- normalized, org-access.js at write time
  user_id uuid references users(id) on delete set null,
  role text not null default 'member' check (role in ('owner','admin','member')),
  invited_by uuid references users(id) on delete set null,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  removed_at timestamptz,
  unique (org_id, email)
);
create index on org_members (email) where removed_at is null;

-- The shelf. A SNAPSHOT of what was published, never a live join back to the
-- member's own rows — hub_items' rule (024) and branding's before it.
create table org_shelf_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null check (kind in ('report','bov','comp')),
  source_ref text,                        -- shared_reports.id | broker_bovs.id | broker_comps.id
  owner_user_id uuid references users(id) on delete set null,
  snapshot jsonb not null,
  market text, property_type text, address text,
  published_by_email text not null,
  published_at timestamptz not null default now(),
  removed_at timestamptz
);
create index on org_shelf_items (org_id, published_at desc) where removed_at is null;
```

A member cap of one row per person per org, a shelf capped and paged like the
vault export, and RLS enabled on all three — the standing pattern.

**No file fallback.** Same stance as 013, 018 and 024, for the same reason: an
access-control list in a JSON file on an ephemeral disk is not one. Every org
route answers 503 with Supabase unconfigured rather than degrading into
something that looks like it works.

## 5. What reaches the shelf, and when

Three doors, in the order they should be built:

1. **Publish this report to the firm** — a button beside Share. Writes an
   `org_shelf_items` row holding the same payload `POST /api/share` would
   store, through **the same strip**: `meta.subject.noi` and `assumptions`
   `debt` / `rentRoll` / `opex` are removed. A broker's client's financials
   are not firm property by default. An explicit "include my financial
   assumptions" toggle mirrors invited sharing's `includePrivate`.
2. **The firm default.** `orgs.share_default = 'reports'` publishes a member's
   new reports as they are saved, with a per-report opt-out. This is what makes
   Chuck's example work without Brad having to be diligent — and it is
   deliberately an admin decision at creation, disclosed to members on join,
   never a silent default we choose for them.
3. **A BOV row** published from the pipeline, carrying the same anonymization
   rules the lead inbox already applies to anything owner-facing.

**Never retroactive.** Turning the default on affects work from that moment.
A bulk "publish my last 90 days" is a separate, explicit action by the member
who owns the rows — never by an admin.

## 6. Reading: `org-access.js`, pure and fails closed

One new pure module, the fourth in the family after `entitlements.js`,
`report-access.js` and `hub-access.js`, with the same contract: no I/O, no
requires, no clock reads, `server.js` owns the reads and hands them in, and
`npm test` proves the gate with no database.

```js
canReadShelf({ membership, item, user })   // -> { ok, reason }
canPublishToOrg({ membership })            // member and up; removed_at beats all
canManageMembers({ membership })           // admin and up
```

And one surgical change to an existing gate: `report-access.js`'s
`canReadShare` gains a **third branch** for a share addressed to an org, below
the revocation check and above the viewer list. Everything else about that
file is untouched, including its governing rule — an unrecognized visibility
is still treated as invited, never public. The org branch is `visibility ===
"org"` and nothing else; it can only ever *add* a named audience, never widen
an existing one.

This is what makes slice 1 (§10) small: shares and hubs already resolve people
by email, so a firm is just another way of naming a set of emails.

## 7. The shared vault, and why it is last

This is the part Chuck's pitch actually sells — "no one has the ability to
retain every comp they've ever been sent" — and it is the part that can lose a
broker their book, so it ships behind everything else.

Design:

- **Opt-in per import, or per comp.** Never per account, and never a default.
  The uploader chooses at the moment they upload, on a screen that names who
  will be able to read it.
- **The shelf holds a copy** (`kind: 'comp'`), not a widened read of
  `broker_comps`. This is 013's separate-tables rule applied again: the option
  of adding `or=(org_id...)` to `vaultCompsForReport` is exactly the shape of
  the mistake that migration warns about, and it fails silently because that
  path swallows its own errors and returns `[]`.
- **The owner's edit refreshes the copy; their delete pulls it.** Hook it to
  the same seam as `retractPublishedComp`, and after validation succeeds,
  never before — that ordering is already a scar in this codebase. Within one
  firm the correction is the owner's to make, which is why this deliberately
  differs from `hub_items`' frozen snapshot: a hub records what was disclosed
  to an outside party, a shelf holds the firm's own working book.
- **It blends into a colleague's report, attributed.** A firm comp reaching
  Mike's report keeps `private: true` on the wire — the flag means "claims no
  public provenance", not "only you" — and gets its own badge, "From
  Colliers Boise · added by Brad", never "From your vault" and never the green
  Verified badge, which is a public claim earned by vouching in the public
  records.
- **`POST /api/share` strips them,** exactly as it strips vault comps today,
  and it does so server-side without trusting the browser. A firm's book must
  not leave the firm through a client link.
- **Publishing to the public corpus is unchanged** and still personal: the
  `Verified · via <firm>` badge names a broker who vouched, and the pending
  license rule in ROADMAP applies to them, not to their employer.

## 8. Entitlements: `server.js` learns about orgs; `entitlements.js` does not

`subscriptions` is keyed on `user_id` (migration 008) and stays that way. The
resolution rule is the repo's existing division of labour, restated:
**`server.js` owns the reads, `entitlements.js` owns the rules.** So
`findSubscription` learns to resolve a member's org subscription when the
member has no row of their own; `computeEntitlements` gains no org concept at
all, beyond one presentational field so the plan card can say "Pro — via
Colliers Boise" instead of offering a billing portal to someone who is not the
payer.

Two rules carried forward without amendment: the whole file still fails closed
(a failed org read resolves to the member's own tier, never up), and
`PRO_ENABLED=off` still means the pre-Pro app for everyone — an org cannot
switch a dark deployment on, the same way the admin and tester branches
cannot.

`canUseVault` remains the gate on every vault route. Shelf routes test a new
`canUseOrg`, mirroring it.

## 9. Billing: grant seats by hand first

Per-seat Stripe (`quantity`, the org as customer, a refusal to invite past the
seat count) is the eventual answer and is not the first move. The product had
zero real outside users as of 2026-08-06; the fastest way to have an
enterprise story that is *true* is the `vault_beta` precedent — a column, set
by hand or redeemed with a passkey, revoked with a one-row update. That is how
the vault itself was handed to its first brokers, it kept the owner out of
Stripe's object model while the shape of the product was still moving, and it
is exactly right for a feature whose first three customers will be
hand-onboarded in a room.

Build the seat billing when a firm asks to pay for seats. Not before.

## 10. Slices

- **Slice 0 — no code.** §1's five questions, plus the attorney question that
  ROADMAP already lists as gating launch: what may we hold, and whose is it
  when someone leaves. Enterprise makes that question sharper, not new.
- **Slice 1 — the firm as an audience.** `orgs`, `org_members`, invite +
  accept, `org-access.js`, the `canReadShare` org branch, and "Shared with my
  firm" beside the existing "Shared with me" on `/desk`. No shelf, no vault.
  This alone delivers Chuck's example for anything already shareable as a
  link, and it is the demo.
- **Slice 2 — the shelf.** `org_shelf_items`, publish-to-firm, the firm feed,
  the `share_default`, BOV publishing.
- **Slice 3 — the shared vault.** §7, opt-in, attributed, with the conditional
  vault copy from §2.
- **Slice 4 — seats.** §9, when someone asks to pay.

Slices 1 and 2 are worth building on their own evidence. Slice 3 should wait
for a real firm with a real book, for the same reason import-time geocoding
waited for a real upload: its central question — do brokers at one firm
actually want each other's comps in their reports, or do they want a shelf
they can search — is measurable the moment there is one customer and
guesswork until then.

## 11. For the pitch (Chuck writes this tomorrow; here is what is true today)

Chuck's framing — connect the professional to a problem they have not named,
then be the solution — is right, and the strongest version of it is about
**retention, not generation**. CBRE and Colliers have research analysts who
produce comps. Nobody, at any firm, has the ability to keep every comp they
have ever been *sent*. That asymmetry is real and it is what the vault plus a
firm shelf addresses.

What can be claimed truthfully today, before any of this is built: a broker's
private comps are stored, never read into public records, and blend into their
own valuations. What needs slice 1 before it can be said: a firm sees its own
work in one place. Nothing in the pitch should say "your whole firm's comp
history, searchable" until slice 3 exists — the gap between the pitch and the
product is the one thing a broker in the room will find in ninety seconds, and
this product's entire currency with brokers is that its claims are exact.

## 12. How this fails

- **The domain shortcut gets added later.** Someone will notice invites are
  friction and wire up auto-join by email domain. It reads as a convenience
  and it is a stranger in the deal book. §3 exists to be cited.
- **A `user_id=eq.` filter gets widened.** The one-line version of the shared
  vault is `or=(user_id.eq.X,org_id.eq.Y)` on `vaultCompsForReport`, and it
  will look correct in review and fail silently in production because that
  path returns `[]` on error and logs nothing a person reads.
- **The departure case is unanswered when it happens.** A broker leaves, the
  firm asks for their comps, the broker asks for them back. The design says
  the uploader keeps their vault and the firm keeps the shelf snapshot — but
  that is a recommendation, not an agreement, and the first time it matters is
  the worst time to decide it.
- **An admin is assumed to be a superuser.** Every SaaS trains people to
  expect that a workspace admin can see everything in the workspace. The first
  firm admin will ask why they cannot see Brad's pipeline, and the answer —
  because Brad's clients are not the firm's to read — has to be a decision the
  product is willing to defend rather than a gap it apologizes for.
- **It ships to nobody.** The most likely failure is not a leak, it is that
  enterprise is built for a firm that never signs. Slice 1 is one week of work
  and makes the demo true; slices 2-4 should be bought with a customer.
