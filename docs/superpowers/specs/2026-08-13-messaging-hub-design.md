# The messaging hub: brokers and tenants trading comps in one place

**Date:** 2026-08-13
**Status:** **LIVE.** Design approved by the owner 2026-08-13 (all five
shaping questions answered, §1); migration 024 applied to production
2026-08-13; slice 1 and slice 2 both merged and deployed, with devlog
entries written per ship. The three routes that shipped with no caller
(`POST /api/hub/items`, `PUT /api/hub/participants`, `POST /api/hub/close`)
were wired 2026-08-16, so nothing in §6 is now reachable only from a
console.
**DRIVEN ON PRODUCTION, 2026-08-26.** A broker
(jacobadler@compninja.co) and a client (agouraninja@gmail.com), in two
browsers, worked one requirement start to finish: hub created from /vault
with an emailed invitation, the token link opened it, a vault comp sent
("1 comp sent" — the ON CONFLICT scar in §6 is genuinely fixed in
production), the client shortlisted it, added a building of their own,
notes both ways, and the hub closed. The tenant WRITE half and the
2026-08-16 controls have now been used by a person. Nothing in the product
misbehaved. Two things looked like faults and were not, both recorded here
so the next person does not re-open them: a broker's page left in a
BACKGROUND window stays stale, which is the deliberate hidden-tab dormancy
at hub-page.js's `if (document.hidden) return` — bringing the window
forward woke it and pulled in every change with no reload; and a "Post
note" click that appeared to do nothing was the automation missing the
button, since the same click from the page's own context posted fine.

**What is still NOT driven by a person:** removing a participant and
re-inviting them (the re-invite mints a NEW token, and the old one must
stay dead), and watching the BROKER's own window wake — the live refresh
was observed on the client's side only. Both are covered by
`test/hub-run.test.js`; neither has been seen on production. The closed
QA hub cannot be used for them, because participant management is a write
and a closed hub refuses every write.

**Email invitations are no longer dormant** (observed 2026-08-26). The
create-hub response took the `emailed: true` branch on production, and that
branch is `OUTBOUND_EMAIL_LIVE() && emailFailed.length === 0` — it is the
send's own answer, so both `EMAIL_FROM` and `RESEND_API_KEY` are set on
Render and Resend accepted the message. §11's "written and waiting" is out
of date. **What that does NOT prove is delivery to a stranger**: without a
verified domain Resend only delivers to the address that owns the Resend
account, and the client in this run was that address. An invitation to a
real tenant is still unproven, and remains so until somebody sends one to
an outside address and it lands.

**Every one of those routes IS now driven end to end in software**
(`test/hub-run.test.js`, 2026-08-26): a broker and a client work one
requirement against a real server, the fake PostgREST and the fake Resend —
create, invite, open by token with no account, send a vault comp, sign in,
shortlist, add a comp of their own, trade messages, poll for what is new,
add and remove a colleague, close. That closes the gap that let every vault
send fail for a week (§6's ON CONFLICT scar), and it is why the live pass is
now a confirmation rather than the only evidence. What it deliberately does
NOT prove is anything only a real Postgres can answer — that same ON
CONFLICT bug would have passed against the fake, which does its own
filtering. So the live two-person run still has to happen; it is just no
longer where the ordinary bugs get found.

**Builds on:** `migrations/018-report-sharing.sql` + `report-access.js` (v3
client sharing, shipped), `migrations/013-broker-vault.sql` + `016` (the
vault star schema, shipped), `migrations/015-broker-lead-inbox.sql` (broker
identity on `user_id`, shipped), `docs/superpowers/specs/2026-08-06-client-sharing-design.md`.
**Roadmap:** new. Sits alongside "Later (broker-tier phases)"; it is not one
of the numbered v-phases and does not displace the hub-ratings item.

> ## Naming warning: "hub" is now overloaded
>
> The owner named this feature the **messaging hub** on 2026-08-13. Three
> other things in this repo were already called a hub, and none of them are
> this:
>
> - **The connection hub** — the public broker directory at `/brokers`, which
>   is what ROADMAP's "**Hub ratings**" and "**Hub monetization** is gated on
>   the attorney's referral-fee answer" both mean. Those two lines predate
>   this feature and do not refer to it.
> - **The Dev hub** — the internal changelog and ideas list at `/dev`.
> - **The contributor hub** — an aspiration in a server.js comment about the
>   broker directory growing up, again not this.
>
> This document says "hub" for the new object and "connection hub" for the
> directory, always. Code says `hub_*` for these tables and `hub-access.js`
> for the module; nothing in the directory's code was renamed. If the
> collision starts costing more than it saves, the cheap rename is this
> feature, because it has no users yet and the directory has URLs.

## The feature in one line

A broker and a tenant work one requirement in a shared hub where every comp
is an object with a status, instead of an attachment buried in a mail thread.

## Why now, and the honest argument against it

The argument against is on record and it is the right default: as of
2026-08-06 the product had zero real outside users, so "can anyone find this"
beats another feature, and `docs/ROADMAP.md` says so above every engineering
item.

This is the one feature that answers that objection rather than ignoring it.
Every other surface in the product is a broker alone with their own data. A
hub is the only mechanism where an existing user brings a named non-user in
by their own choosing, for their own reasons, and the non-user arrives
already holding something valuable. That makes it an acquisition loop, not a
retention feature.

That framing binds the design, and it is why the tenant side wins every
trade below:

- The tenant path must be free forever. No comp gate, no Pro prompt, no
  export tally. A tenant who hits a paywall inside their own broker's hub
  is a lost acquisition and an embarrassed broker.
- The tenant must read before they sign up. Reading is the demonstration;
  the account ask lands after it.
- Broker-side polish is the thing to cut when slice 1 gets too big.

## What this is NOT

- **Not chat.** Messages exist to annotate comps. If the hub ships and
  people use it as a slow Slack, the comp objects failed and the feature
  failed with them.
- **Not a replacement for `/r/<id>` sharing.** Shared reports keep working
  exactly as they do. A hub can *hold* a shared report as an item, and a
  share can *start* one (§1 Q5).
- **Not the connection hub.** See the naming warning above.
- **Not a marketplace.** Tenants posting requirements for any broker to
  answer is a real idea and it is slice 3, gated on the attorney's
  referral-fee answer, which already gates hub monetization.
- **Not a publishing path.** A comp sent into a hub does not enter
  `comp_corpus`, does not earn the green Verified badge, and does not touch
  the license rule in ROADMAP's "Next". Sending is private disclosure to
  named people. Publishing is a separate, deliberate, licensed act.

## 1. The decided questions (owner, 2026-08-13)

| Question | Answer | What it rules out |
|---|---|---|
| What the hub is organized around | A hub: one requirement or one pursuit, outliving any single report | Comments bolted to a share (dies with the report); generic DMs (recreates the inbox we are escaping) |
| How a tenant gets in | Emailed link with a per-participant token; reading needs no account, writing does | Mandatory signup at the door; a public link with no identity |
| What a private vault comp shows | Full detail, per-comp opt-in, never a bulk default | Anonymized-basis default (a comp without an address cannot help a tenant pick space); banning vault comps outright (guts the feature) |
| Q1 The name | **"messaging hub"**, object called a hub, route `/hub/<id>` | "Deal room", "comp room", "shared search". `/hub` was free; `/brokers`, `/dev` and `/desk` are untouched |
| Q2 Who can create one | **`ent.canUseVault`** | `ent.pro` (splits the broker surface across two flags); a third `hub_beta` grant |
| Q3 Where the broker's list lives | **`/vault`, beside the pipeline deck** | `/desk` (puts a vault-gated surface on a page every free account sees); both |
| Q4 Can a tenant add comps | **Slice 2**, deferred | Slice 1 (untrusted comp input with no vault to validate against); never (a tenant who finds a building would go back to email) |
| Q5 "Start a hub" on a shared report | **Yes, slice 1** | Deferring the only in-product discovery path rooms would have |

## 2. The core bet: the comp is the object, not the message

What gets lost in email is not the conversation, it is the comp. Three
attachments, two forwards and a reply-all later, nobody can say which four
buildings are still live.

So a hub is a **list of comps, each carrying a status**, with messages
hanging off individual comps as well as off the hub. The tenant's answer to
"where are we" is the list, not the scrollback. That is the one thing email
structurally cannot do, and it is the whole differentiation.

Concretely, the hub page's primary surface is the comp table (the same
`rd-*` statement table the vault and the report already use), with a
per-row status chip and a per-row comment count. The message stream is
secondary chrome below it, not the page.

## 3. Schema (migration 024)

023 (`vault_beta`) is still awaiting a run, so this is 024 and must be
applied after it. No file fallback: like the vault and like invited shares,
a hub is an access-control surface, and an access-control list in a JSON
file on an ephemeral disk is not one. Supabase unconfigured means every hub
route answers 503.

The file is `migrations/024-messaging-hub.sql`. Its four tables are
`hubs`, `hub_participants`, `hub_items`, `hub_messages`, and they are
registered in `migrations/verify.js` so a partial apply is caught the way
004 taught this folder to catch things.

Three schema decisions carry the weight:

**`hubs.owner_user_id` is `on delete set null`, not cascade.** Migration 018
gives the reason and it holds here: a broker deleting their account must not
vaporize a conversation their client is relying on. An ownerless hub goes
read-only and says so. Silent disappearance is the one outcome that is never
honest.

**Identity is the email** (018 precedent). A tenant invited before they have
an account is recognized the moment they sign up with that address, with
nothing to reconcile. `user_id` is **never written** — the spec and the
migration both claimed it was "stamped on the first authenticated read",
and nothing stamps it. Corrected 2026-08-14 after checking production,
where the column is null on every row. It costs nothing, because the email
match is what resolves a participant; it is recorded here so the next
reader does not build on a join that has no data behind it.

**One token per participant, hashed.** A single hub-wide link cannot say who
said what, and a forwarded hub-wide link cannot be cut off without cutting
everyone off. Only `sha256(token)` is stored, the same discipline as a
password: a database read must not hand someone the keys to every live hub.

## 4. The snapshot rule

**A comp sent into a hub is a copy, taken at send time, and it never changes
afterward.** `source_ref` records where it came from; `snapshot` records what
the tenant was actually shown.

The repo already decided this shape twice, and both precedents point the same
way: report branding is "a snapshot taken at share time, never the viewer's
own profile" (`branding.js`), and a shared report is "decided entirely by its
own snapshot". The reason is the same here and stronger: if the broker later
edits a price in the vault or deletes the upload batch, a live-join hub would
silently rewrite what the tenant read last Tuesday. A record of what was
disclosed is the only version worth keeping.

Consequence to accept knowingly: a hub can show a stale price. The fix is a
visible "updated by the broker" re-send that adds a new row, not a quiet
mutation of the old one. `hub_items_live_source_uidx` is partial on
`removed_at is null` precisely so a re-send is possible.

## 5. Access: `hub-access.js`, pure and fails closed

One module answers who may do what, and nothing else in the codebase may
answer it. Same contract as `report-access.js`: no I/O, no requires, no clock
reads, so `npm test` proves the gate with no database. server.js owns the
reads and hands them in.

```js
canReadHub({ hub, participant, user, tokenValid })   // -> { ok, reason, role }
canWriteHub({ hub, participant, user, tokenValid })  // messages and status changes
canAddItems({ hub, participant, user, tokenValid })  // slice 1: owner only
```

`tokenValid` is a boolean, not a token. server.js does the hashing and the
constant-time compare, then hands in the verdict. Keeping the crypto out
keeps this file pure, and it means the test suite can express "a valid token"
without a database or a hash.

The decision order, which is the whole design:

1. **No hub** is `not_found`.
2. **A removed participant** is refused before anything else, ownership
   included. Removal has to beat ownership too, or "removed" would mean
   "removed for other people".
3. **The owner** always reads and writes their own hub.
4. **A valid token** reads. **A signed-in participant** reads. Either is
   enough on its own, which is what lets a tenant open the link on their
   phone with no account and later sign in on a laptop with no link.
5. **No user and no valid token** is `signin_required`; a signed-in stranger
   is `not_invited`. A stranger must never be sent to a sign-in card they are
   already past, exactly as `report-access.js` decided.
6. **An unrecognized role is an observer** (read, never write). A typo in a
   column must never grant a write, the same way an unrecognized `visibility`
   is treated as invited and never as public.
7. **Writing always requires an account.** A token proves someone opened a
   link; only a session proves who is typing. This is the account ask, and it
   is deliberately placed at the first write rather than at the door.
8. **A closed hub is read-only for everyone, owner included**, but stays
   readable. Closing is not revoking: everyone keeps what is already there.
9. **An ownerless hub is read-only.** There is nobody left to moderate it.

`canAddItems` is owner-only in slice 1 (Q4).

## 6. Routes

All under the existing session/cookie machinery, all zero-dependency.

| Route | Body / query | Notes |
|---|---|---|
| `POST /api/hubs` | `{ title, market, propertyType, subjectAddress, participants: [email], fromShare? }` | Broker surface, `canUseVault`. Max 20 participants, mirroring the share viewer cap. Returns the hub and one invite link per participant. `fromShare` seeds items and participants from a shared report (Q5). |
| `GET /api/hubs` | | Returns `{ mine: [...], theirs: [...] }` in one call, because two surfaces need both on a page-load path. Same shape decision as `GET /api/shares`. |
| `POST /api/hub/access` | `{ id, token }` | Exchanges a token for a scoped httpOnly cookie. Stamps `first_viewed_at` once. |
| `GET /api/hub` | `?id=&since=` | The hub, its live items, and messages after the cursor. |
| `POST /api/hub/items` | `{ id, items: [...] }` | Snapshots at write time. `private: true` for vault sources. |
| `PATCH /api/hub/item` | `{ id, itemId, status }` or `{ removed: true }` | Slice 1 ships removal only; status is slice 2. |
| `POST /api/hub/message` | `{ id, itemId?, body }` | Body capped at 4,000 chars. Per-participant rate limit. |
| `PUT /api/hub/participants` | `{ id, emails: [...] }` | Wholesale replace, mirroring `PUT /api/shares/viewers`. One state to reason about instead of three. |
| `POST /api/hub/close` | `{ id }` | One-way. The UI says the hub stops accepting posts and cannot be reopened. |

### The token never travels in a URL the server can log

The invite link is:

```
https://compninja.co/hub/<id>#k=<token>
```

The token is in the **fragment**, which browsers do not send to servers. The
page shell renders with no hub data, its JS reads `location.hash`, and posts
the token to `POST /api/hub/access`, which sets the cookie. That is the same
reasoning that makes `POST /api/report-access` a POST, and the same reasoning
behind ROADMAP's "Next" item to move `/api/geocode` off a query string: an
address or a bearer token in a URL lands in platform access logs and in every
outbound `Referer`.

### Polling, not SSE

`GET /api/hub?since=` is polled every 15s while the tab is visible. A hidden
tab is skipped ENTIRELY rather than polled more slowly — there is nobody to
show it to, and returning to the tab catches up in the same moment. After ten
minutes with no sign of a person the timer keeps running and does nothing;
a key, a click or a refocus both wakes it and catches up, so waking is
invisible.

`openSse` exists and works, but a hub is a minutes-apart conversation, and an
SSE stream holds a Render connection open per open tab for the entire workday
to deliver four events. Revisit only if a real hub shows sustained sub-minute
traffic.

**The poll carries the comps, not just the messages** (corrected 2026-08-14).
It originally skipped the item list when `since` was set, reasoning that
"items change rarely". True in slice 1, where only the owner could change an
item; false the moment statuses shipped, because every status change is an
item change and a status is the one thing two people move at once. Until it
was fixed, a tenant shortlisting a building was invisible on the broker's
open page until they reloaded, which is the opposite of what a shared
workspace is for. The saving was a few KB on a page somebody is actively
looking at.

Two consequences of polling that only appear once it repaints often, both
handled: the page repaints the comp table only when something visibly
DIFFERS, and a half-typed note is held by comp id across repaints — otherwise
a tenant writing carefully about clear height loses it because the broker
shortlisted something in another tab.

**This section has been wrong once already.** It described 60s-when-hidden
and a 10-minute idle stop, and the code implemented neither; the idle stop is
now real and the hidden-tab behaviour is described as built. If the polling
changes again, change this paragraph in the same commit.

### `/hub/<id>` must be exempt from `ACCOUNT_WALL`

Exactly like `/r/<id>`. This is the whole tenant-access decision, and it is
one line in the wall's exemption list plus a test that fails loudly if
someone tidies it away. The page renders the signup card above the hub, the
same treatment shared reports already got.

## 7. Entitlements

- **Creating and owning a hub: `ent.canUseVault`** (Q2). It is a broker
  surface and its comps come out of the vault, so it travels with the vault
  the way the lead inbox does. `vault_beta` brokers get hubs and `pro_tester`
  passkey holders deliberately do not, which is the existing and correct
  split.
- **Participating: free, always, for everyone.** No entitlement check on any
  read, message, or status route. Not "free for now".
- **The comp gate does not apply inside a hub.** `FREE_MAX_COMPS` gates what
  a search will *show* a stranger. A comp a broker deliberately addressed to
  a named person is disclosed, full stop. A tenant seeing "4 of 12 comps,
  unlock with Pro" inside their own broker's hub is the single worst outcome
  this design can produce.
- Rules land in `entitlements.js` if they touch the tier table, so `npm test`
  covers them.

## 8. Notification reality (read this before scoping)

**Outbound email is off today.** `EMAIL_FROM` is unset because no custom
domain is verified in Resend, and the free tier only delivers to the address
that owns the Resend account. Every outbound send currently logs
`Outbound email skipped` and no-ops.

That is fatal to a feature whose first action is "invite someone", so slice 1
does not depend on it:

- `POST /api/hubs` **returns the invite links** and the broker copies them
  into their own email or text. Unglamorous, works today, and it is how the
  first real broker would have done it anyway.
- Owner notifications on tenant activity ride `LEAD_NOTIFY_EMAIL`, which does
  deliver, so Owen sees his own hubs move.
- Brokers other than Owen get **in-app only** until a domain is verified. The
  hub list carries the unread count from `last_seen_at`.

Verifying a domain in Resend is a prerequisite for slice 2, not a
nice-to-have. It should be booked as its own task, because it is a DNS change
and a wait, not a code change.

## 9. Copy drafted for a separate yes

Brand copy needs an explicit named yes, so nothing here is final. No em
dashes, plain trades, bullets over paragraphs.

- Broker empty state: "No hubs yet. A hub is where you and a client work one
  requirement: send comps, keep notes on each one, and skip the email
  thread."
- Invite link helper: "Copy this link and send it to your client. It works
  without an account. They will be asked to sign in only when they reply."
- Tenant landing header: "{Broker name} shared {n} comps with you."
- Sending a vault comp, per-comp confirm: "This comp is private to your
  vault. Sending it shows {email} the full address and price. It stays out of
  public reports."
- Close confirm: "Closing stops new posts. Everyone keeps their access to
  what is already here. This cannot be undone."
- Automated-estimate line survives every hub surface, unchanged.

## 10. Legal and privacy, which is where this actually gets stuck

ROADMAP already flags broker-data privacy for the attorney and says that one
gates launch, not development. Hubs widen it in three specific ways, and the
attorney should be asked about these named cases rather than the general
topic:

1. We now transmit a broker's private comp to a **third party we have no
   contract with**. The broker consented; the data subject and the source
   brokerage did not.
2. We store **tenant PII** (email, and whatever a tenant types about their
   own space needs and budget) with no signed terms, since the tenant may
   never create an account.
3. Deletion rights now span two parties. A broker deleting their vault upload
   must not, and under the snapshot rule does not, erase what a tenant
   already read. That is defensible and it needs to be a stated policy rather
   than a discovered behavior.

Also unchanged, and worth restating because a hub is a broker-shaped surface:
the owner is not a licensed broker, hub copy says "connect you with a local
broker" and never implies brokerage, and no hub surface calls a valuation an
appraisal.

## 11. Slices

**Slice 1 — written 2026-08-13, shipped 2026-08-14.** Migration 024.
`hub-access.js` + tests. Hubs, participants with hashed per-participant
tokens, comp items snapshotted from the vault and from a report, hub-level
messages, `/hub/<id>` with the wall exemption, polling, copy-link invites,
the broker list on `/vault` beside the pipeline deck, the tenant list on
`/desk`, and the "start a hub" button on an existing shared report.
Deliberately excluded: statuses, per-comp messages, any email.

Four bugs it shipped with and no longer has, all found by RUNNING it, none
by reading it. They are listed because each is a trap the next person here
can fall into the same way:

- **`GET /api/hub` sat outside the route dispatcher.** It is the read and
  polling endpoint and the only one carrying its id in a query string, so
  `startsWith("/api/hub/")` missed it and the page would have rendered a
  shell that could never load.
- **`ACCOUNT_NAV_JS` is a complete `<script>` element**, not raw JS.
  Interpolated inside the hub page's own script it closed the tag early and
  printed the whole script on screen as text, with a 200 and valid HTML.
- **`proConfig` IS the pro block**, not a wrapper. The desk's gate read
  `proConfig.pro.canUseVault`, which is undefined for everyone, so "Start a
  hub" would never have appeared and nothing would have failed.
- **Three Tailwind classes were missing from the vendored `tailwind.css`**
  (`min-w-[220px]`, `border-[#E7E3D9]`, `inline-block`), which silently do
  not style. Swapped for vendored equivalents, so slice 1 needs no regen.

Verification was done against stubbed endpoints, because the vault has no
file fallback and the hub routes are database-only: there is no way to see
either workspace locally without production credentials. What that leaves
UNVERIFIED, and what the first real run must check, is everything only a
database can answer — the token hash round trip through
`POST /api/hub/access`, the participant resolution order in
`resolveHubCaller`, the seeded-from-a-share path, and whether
`hub_items_live_source_uidx` really lets a removed comp be re-sent.

**Slice 2 — built and shipped 2026-08-14.**

Done, and needing no migration because 024 shipped the columns:

- **The status pipeline.** `PATCH /api/hub/item` is now two acts down one
  route: removing a comp stays the owner's (`canAddItems`), setting a status
  is any participant's (`canSetStatus`). That split is the feature — a
  pipeline only the broker can move records what the broker hopes rather than
  what the client decided. `status_by`/`status_at` come from the session,
  never the browser.
- **Per-comp note threads.** A note filed against one comp reads under that
  comp's own row; notes about the requirement stay in the stream. One message
  list split at render on `item_id`, and one post path for both kinds.

The status vocabulary now lives in three necessary places — `hub-access.js`
(which requests are allowed), 024's CHECK (which rows are), and the page's
`<select>` (what a person can pick). All three are pinned against each other
by test, one of them by reading the constraint out of the SQL file. A page
offering a status the server refuses is a control that fails on click.

`test/hub-page.test.js` is new and earns its place the way
`test/vault-page.test.js` does: the page is one template literal emitting
browser JavaScript, so a stray `${` ships a dead page silently.

**Still open in slice 2:**

- **Unread counts: DROPPED for now** (owner's decision, 2026-08-14). The
  problem was real — `last_seen_at` lives on `hub_participants` and a hub's
  OWNER has no participant row, so there was nothing to compare their last
  read against — and both fixes cost something: making the owner a
  participant breaks what `/vault`'s "N of M opened" count means, and an
  `owner_seen_at` column is a migration (027) for a convenience. Both lists
  already show when a hub was last updated, which answers "has anything
  happened" without either cost. Revisit once a real hub is running and the
  date can be judged sufficient or not, rather than guessed at with zero
  hubs in existence.

  It did leave one thing worth having: chasing it found that `GET /api/hubs`
  carried a comment claiming it dropped hubs the caller owns from the
  "shared with me" side, and no such check existed. Fixed, since a comment
  that disagrees with its code is cheapest to close while it is still
  harmless.
- **Tenant-added comps** (Q4): SHIPPED 2026-08-14 in `hub-comp.js`, the
  untrusted-comp path that reuses `broker-vault.js`'s own parsers so "1.2M"
  is refused in a tenant's box for the same reason it is refused in a
  broker's CSV.
- **Anything email**: the CODE shipped 2026-08-16 (`sendHubInvites`, called
  from both places that mint a token, riding the same `sendOutboundEmail`
  gate as every other outbound mail). It is dormant, not missing: with
  `EMAIL_FROM` unset it logs "Outbound email skipped" and the panel says so,
  and the day a domain is verified invitations send with no code change and
  no deploy. That leaves it waiting on Render config plus a verified Resend
  domain, which is Jacob's, not Owen's — the copy-link fallback is what
  works today.
- **Nobody has run a hub as two people.** The one production hub was made
  2026-08-14 and holds one comp still at `new`, zero messages, and one
  participant. So the tenant WRITE half (status, per-comp note, added comp),
  two-party polling, and every control added 2026-08-16 (send comps, the
  People panel, invite, remove, close) are unexercised by a human. Slice 1
  and slice 2 both shipped bugs that only a person clicking could find; the
  same is true of everything since, and it is the one item on this list that
  nothing but an hour with two browsers can close.

**Slice 3.** Tenant-posted requirements matched against `broker_coverage`,
which is the marketplace and reuses the lead inbox's matching wholesale.
Gated on the attorney's referral-fee answer, exactly as connection-hub
monetization already is.

## 12. How this fails

Stated plainly so it can be watched for rather than discovered:

- **The tenant replies by email anyway.** The most likely failure by a wide
  margin. The mitigation is that the *comp list* is only in the hub, so the
  hub stays the source of truth even when the talking happens elsewhere.
  Inbound email posting into a hub is a real answer and it is far out.
- **One-sided hubs.** The broker sends five comps, the tenant reads and never
  posts. That is still a win on the acquisition metric and a loss on the
  product metric. Instrument `first_viewed_at` versus first message: the gap
  between them is the feature's actual score.
- **It needs a broker with a live tenant requirement.** There is exactly one
  candidate today, and slice 1's UI should not be built out before someone
  has said they would use it on a real deal.
