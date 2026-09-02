# The 1031 broker request: a requirement packet a broker can answer

**Date:** 2026-08-31
**Status:** **DRAFT. Nothing built, nothing approved.** The shaping questions in
§1 were answered by the owner on 2026-08-31; everything below them is a
proposal. No migration has been written, no route exists, and the numbering in
§3 is provisional — `feat/property-spine-typed-corpus` already claims 043 and
044 in an open PR, and this folder has renumbered at merge time twice before
(030 from 028, 036 from 035, both recorded in `APPLIED.md`).

**Depends on** `feat/1031-replacement-criteria`, which added the criteria
capture to `/1031-exchange` — market, type wanted, price range, and a neutral
handoff to `/brokers`. That branch is the input half of this design; today the
handoff drops the user at a directory and the packet goes nowhere.

---

## The feature in one line

A 1031 buyer states what they need, picks brokers who cover that market, and
sends one requirement packet into a hub thread — and the platform keeps a
permanent, timestamped record of who was introduced to whom.

---

## Why now, and the honest argument against it

**Why now.** The worksheet already collects everything a broker would ask for
on a first call, and then strands the user at a directory. Meanwhile
`hubs` / `hub_items` / `hub_messages` / `hub_participants` (024) already carry
threaded conversation between a broker and someone outside their firm, with
access decided by `hub-access.js` and a snapshot rule that freezes an item as
sent. The two halves exist and do not touch.

**The honest argument against.** A 1031 buyer is the most time-pressured buyer
in commercial real estate, and the failure mode is not a technical one: it is
sending brokers requests they resent receiving, once, and never getting a
second look from them. CompNinja has one chance at each broker's opinion of
whether this inbox is worth opening. That argues for shipping the receipt (§4)
before anything that increases volume, and for the request being visibly scarce
rather than merely rate-limited.

The second argument against is that this is the first surface where CompNinja
stands between a buyer and a licensed professional in a transaction. §8 is the
part to read before writing code.

---

## What this is NOT

- **Not a listing service.** CompNinja holds no for-sale inventory — none, in
  any table. The corpus is closed transactions. Brokers answer with their own
  inventory; the platform never names a property to buy.
- **Not a referral.** No fee, ever, in either direction on a per-introduction
  basis. See §8, which is why this rule exists rather than being a preference.
- **Not brokerage.** The user chooses which brokers see the packet. Nothing is
  auto-assigned, ranked, or scored.
- **Not the written identification.** Same line the worksheet already walks: the
  signed list to the qualified intermediary is not this, and never becomes this.
- **Never a DST or any fractional interest.** Delaware Statutory Trust interests
  are securities. A "replacement options" surface that ever includes one puts
  CompNinja in securities regulation in a single step. This must be an explicit
  exclusion in code, not a policy nobody reads.

---

## 1. The decided questions (owner, 2026-08-31)

1. **How do replacement properties reach the user?** Broker introduction only.
   Not AI-suggested listings, not a hybrid. *(The alternative — live web search
   for active listings — is the one that most looks like brokerage and feeds a
   legally consequential 45-day identification. It stays out.)*
2. **How far does the page go on money?** The user types a budget; the page may
   do arithmetic on numbers they entered, framed as a conceptual starting point.
   Never a tax position. Shipped on `feat/1031-replacement-criteria`.
3. **All 1031 surfaces follow RESPA** and, by the owner's instruction, the
   stricter reading where RESPA and state law disagree.
4. **Which broker-protection mechanisms?** Rules 1–6, 7 and 11 of the reviewed
   list. The four dropped ones are recorded in §7 with what was lost, so they
   are not re-proposed as new ideas.

---

## 2. The core bet: the request is an object, not a form submission

024's bet was "the comp is the object, not the message" — a comp arrives in a
hub as a row with a snapshot and a status, and the conversation happens around
it. This design makes the same bet one level up: **the requirement packet is an
object in a thread**, not an email and not a form post.

What follows from that, all of it free:

- It has a **status** a broker sets (`new` → `working` → `passed`), the way a
  comp already does.
- It carries a **snapshot** — the criteria *as sent*. A buyer who widens their
  price range next week does not silently rewrite what the broker agreed to
  work on. This is 024's snapshot rule applied unchanged, and it is also what
  makes the receipt in §4 mean anything.
- Replies are **`hub_messages`**, already built, already access-controlled.
- A broker can send a comp back into the same thread — `hub_items` with
  `kind='comp'` — which is the existing vault-to-hub path, pointed the other
  way.

**This is a fourth `kind` on an existing table, not a new subsystem.** That is
the single most important sentence in this document for anyone scoping the
enterprise communication layer: build the 1031 request as a hub item, or build
a parallel messaging system and maintain two.

---

## 3. Schema

Provisional numbering; see the status block.

### 3a. Widen `hub_items` (one migration, additive)

```sql
alter table hub_items drop constraint if exists hub_items_kind_check;
alter table hub_items add constraint hub_items_kind_check
  check (kind in ('comp', 'report', 'note', 'request'));

alter table hub_items drop constraint if exists hub_items_source_check;
alter table hub_items add constraint hub_items_source_check
  check (source in ('vault', 'report', 'corpus', 'manual', 'exchange_1031'));
```

`snapshot jsonb` holds the packet: market, asset type, price range low/high,
sale closing date, day-45 and day-180 dates, and the buyer's own note. No
address of the relinquished property unless the buyer types one — the worksheet
deliberately keeps addresses out of server logs, and a packet the buyer chooses
to send is a different act from a link they copy, but the default stays off.

`status` reuses the existing column with a per-kind vocabulary. `removed_at`
gives withdrawal for free.

### 3b. `intro_receipts` — append-only, and the reason this exists

```sql
create table if not exists intro_receipts (
  id              uuid primary key default gen_random_uuid(),
  hub_id          text not null references hubs(id) on delete restrict,
  item_id         uuid not null references hub_items(id) on delete restrict,
  buyer_user_id   uuid not null references users(id) on delete restrict,
  broker_user_id  uuid not null references users(id) on delete restrict,
  market          text not null,
  property_type   text,
  criteria_sha256 text not null,   -- hash of the snapshot as sent
  sent_at         timestamptz not null default now(),
  first_opened_at timestamptz,
  responded_at    timestamptz,
  outcome         text check (outcome in ('working','passed','expired')),
  outcome_at      timestamptz
);
alter table intro_receipts enable row level security;
```

**`on delete restrict`, not `cascade`, on all four foreign keys** — the opposite
of every other table in this folder, and deliberate. A receipt is evidence. If
deleting a hub could erase the record that a broker was introduced to a buyer on
a date, the record is worth nothing precisely when it is needed. Closing an
account must not be able to destroy the other party's proof.

Nothing updates a receipt except the four timestamp columns, and only forward:
null → a time, never a time → a different time. That rule belongs in a test,
not a comment.

### 3c. Matching plumbing (no new table)

`broker_coverage` (015) is already keyed on market and property type, and
`lead_intro_requests` (015) already models a per-request introduction the broker
accepts. Both are reused as-is. A broker sees a packet only inside coverage they
claimed for themselves.

---

## 4. The receipt, which is the actual product

Brokers get paid a commission at closing, almost always out of the seller's
side, and almost always only if a deal closes. A buy-side broker on a 1031 does
all the sourcing work up front and is paid nothing if the buyer closes through
someone else.

The recurring dispute is **procuring cause** — who actually introduced this
buyer to this property. It is currently settled, badly, by reconstructing email
threads and text messages months later.

`intro_receipts` is a timestamped, immutable record of exactly that: this buyer,
these criteria, this broker, this date, this response. It is not a limit on
anything. It is the thing that makes answering a CompNinja request *safer* than
answering a cold email, and it is plausibly worth more to a broker than the lead
itself.

**Build this before anything that increases request volume.** A platform that
sends brokers more work is a cost. A platform that protects their commission is
a service, and the same requests arrive inside it.

---

## 5. Protecting the broker — the eight rules

1. **Cap the fan-out at three.** One packet reaches at most three brokers. It
   mirrors the three-property identification rule, so the constraint reads as
   domain logic rather than an arbitrary limit — and the buyer already thinks
   in threes on this page.
2. **Show the clock.** The packet leads with the closing date and days remaining
   to day 45. A buyer with a closed sale and 31 days left is a different animal
   from one considering an exchange, and this is the single strongest qualifier.
   The worksheet already computes both dates.
3. **Brokers accept or decline, per request.** Never auto-assign, never
   pre-accept. `lead_intro_requests` models this today.
4. **The requester spends something.** A verified account is the floor. A QI
   engagement letter or a closing statement raises the packet to *verified
   exchange*, shown as a badge. Friction is the filter, and the friction is
   proportional to how real the exchange is.
5. **Show the fan-out to the broker.** "Sent to 3 brokers" on the packet. Honest,
   and it lets a broker price their own effort instead of guessing.
6. **Response window.** The first broker to accept holds an exclusivity period
   on that packet — long enough to do real sourcing, short enough that the
   buyer's clock is not spent waiting.
7. **The registration receipt.** §4.
8. **Expiry tied to the clock.** §6.

Rules 1 and 6 need a number the owner has not set. Suggested starting points:
fan-out 3, exclusivity 48 hours. Both are single constants.

---

## 6. Expiry

The packet dies with the deadline it describes. After day 45 the identification
window has closed, and a live request past its own date is noise in every
broker's inbox — worse than noise, it is a signal that the platform is not
paying attention to the one clock the whole page is about.

On expiry: `outcome='expired'` on every open receipt, the item's status moves to
a terminal state, and **both sides are told why**. A request that silently
vanishes teaches a broker that the inbox is unreliable.

The expiry date comes from the packet itself — the day-45 date is already in the
snapshot — so this needs no new column and no clock skew between what the buyer
saw and what the server enforces.

---

## 7. What was deliberately not built

Four mechanisms were reviewed on 2026-08-31 and cut by the owner. Recorded with
what each would have bought, so they are re-argued rather than re-discovered.

- **Broker-set intake capacity** ("three requests a month"). Would have let a
  busy broker throttle without leaving. Cut: rule 1's fan-out cap and rule 3's
  per-request decline already bound the volume any broker sees, and a second
  limiter on top is a setting nobody tunes.
- **Buyer follow-through scoring.** Would have throttled buyers who contact
  brokers and go silent — arguably the true abusive pattern. Cut: it is a
  reputation system, and reputation systems are a product of their own. The
  receipt already records non-response as data, so this can be revisited from
  evidence rather than from theory.
- **Charging the buyer to send a packet.** The strongest filter available. Cut
  on both product and legal grounds: charging a consumer for connection to a
  broker invites a referral-fee analysis in several states even when no
  commission is shared (§8).
- **A "notify nearby brokers" expansion.** Never proposed as a feature; recorded
  because it is the obvious next idea and it breaks rule 1. Matching stays
  inside claimed `broker_coverage`.

---

## 8. Legal, which is where this actually gets stuck

Not legal advice; the owner should have counsel review this section before any
of it ships.

- **RESPA §8** bans giving or receiving a fee or thing of value for referring
  settlement-service business, and bans unearned fee splits. Its core reach is
  federally related mortgage loans, largely 1–4 family residential — so a pure
  commercial 1031 often sits outside it. CompNinja does residential too, and the
  owner's instruction is the stricter reading regardless.
- **State licensing law is the sharper constraint.** Brokerage definitions
  commonly sweep in *procuring prospects* or bringing buyers and sellers
  together for compensation. Most states also flatly prohibit paying referral
  fees to unlicensed persons — state law, commercial deals included, no mortgage
  required. This is the rule that makes "neutral, unpaid, user-initiated"
  non-negotiable rather than cautious.
- **Monetization.** A seat subscription is the clean model and is what the Firm
  tier already sells. A percentage of commission is a referral fee — do not. A
  per-lead flat fee is genuinely grey and is treated as a disguised referral fee
  in some states. The safe framing: brokers pay for access to a marketplace,
  never for an introduction.
- **Securities.** See §"What this is NOT". DSTs are securities; a suggestion
  surface that includes one requires licensing CompNinja does not have.
- **Tax advice.** §1031 is a tax provision. The packet may carry dates and the
  buyer's own figures. It may not carry what they owe, what they must reinvest,
  or what is deferred.
- **Fair Housing** applies on the residential side: no steering, and no matching
  criterion that touches a protected class.
- **The disqualified person rule** (Treas. Reg. §1.1031(k)-1(k)) bars someone
  who acted as the taxpayer's agent within two years from serving as their QI.
  A reason, among others, never to describe CompNinja as anyone's agent.

---

## 9. Slices

1. **The receipt, with no new UI.** `intro_receipts` plus writes from the
   existing `/brokers` handoff. Nothing user-visible; the evidence starts
   accumulating from the first introduction. Ships alone, safely.
2. **The packet as a hub item.** Widen `hub_items`, render a `request` card,
   create the hub on send. Buyer picks up to three brokers from coverage.
3. **Broker inbox.** Accept / decline, the fan-out count, the clock, the badge.
   Rules 2, 3, 5.
4. **Exclusivity and expiry.** Rules 6 and 8 — both are timers over data slices
   1–3 already store.
5. **Verified exchange.** Rule 4's upper tier, which needs document upload and
   therefore Supabase Storage. Blocked on the evidence layer proposed in the
   property-spine review; nothing in the repo uses Storage today.

---

## 10. How this fails

- **Brokers do not answer.** The most likely outcome, and the receipt does not
  fix it — a receipt on an unanswered request is a record of nothing. Watch
  first-response rate from slice 1, before building slices 2–4 on the assumption.
- **The clock makes it worse, not better.** A buyer on day 40 wants an answer
  today; a broker sourcing property takes a week. If the exclusivity window in
  rule 6 is set wrong in either direction, one side is always angry.
- **Three is too few.** Fan-out 3 protects brokers and may leave a buyer with
  three declines and 30 days. There is no fallback in this design, deliberately —
  the alternative is a blast, and a blast is the thing being avoided.
- **The receipt gets used against CompNinja.** A subpoenaed record in a
  commission dispute is a support burden and possibly a discovery obligation.
  Worth asking counsel what retention and disclosure look like before the first
  row is written, not after.

---

## 11. Open questions for the owner

1. Fan-out cap: 3, or a different number?
2. Exclusivity window length, and does it block the other two brokers or merely
   mark the first responder?
3. Does a packet require a *closed* sale, or may a buyer send one while still
   under contract? (Rule 2's clock reads very differently in the two cases.)
4. Who may send a packet — any signed-in user, or Pro and above?
5. Retention on `intro_receipts`. Forever is the useful answer and the one with
   the most legal weight in both directions.
