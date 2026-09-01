# Firm messaging — design

**Date:** 2026-09-01
**Status:** slice 1 built
**Owner's brief, verbatim:**

> Take communication and have it as a separate feature.
> Make it like an instagram or slack or linkedin messaging hub
> Where they can share comps but it's also company messaging.
> Comps that are sent between employees are saved.

---

## 1. What is wrong today

Two facts, and the gap between them is the whole feature.

**The comp hub is not company messaging.** `/hub/<id>` is broker↔client: a
token-gated deal room where a broker sends a client a list of comps and the two
leave notes on them. Its "messages" are those notes — one `hub_messages` table,
one route, one client function, and the only difference between a hub note and a
per-comp note is whether `item_id` is null. It works, it is proven on
production, and nothing here changes it. It is simply pointed the other way:
outward, at one deal, at somebody who is not in the firm.

**Colleagues at one firm have no surface at all.** They already share a shelf
(`shared_reports` with `visibility: "org"`), a vault opt-in (`org_comps`), a
contact list (`org_contacts`) and a letterhead (`org_branding`). What they do
not have is a place to talk. So the comp one broker sends another — "what do you
think of this one" — goes out by text message or email and leaves no trace in
the firm's records. It is exactly the knowledge the transition plan says this
product exists to keep: *your deal knowledge stops walking out the door*. Today
it walks out through iMessage.

## 2. What this is

**`/messages` — firm messaging.** Conversations between the members of one
firm: direct messages and named group channels, in the shape a person already
knows from Slack, Instagram or LinkedIn — a list of threads on the left, the
thread on the right, a composer at the bottom.

A message can carry comps out of the sender's vault. **A comp that is sent is
saved**: it lands in the thread permanently as its own record, it is listed in
the thread's Comps tab for as long as the thread exists, and any recipient can
put it in their own vault with one click.

## 3. What this is NOT

- **Not the comp hub.** `/hub/<id>` is untouched. Different audience, different
  access model (a hashed per-participant token vs firm membership), different
  purpose.
- **Not the connection hub at `/brokers`**, and not the development hub at
  `/dev`. Four things in this repo are called "hub"; this one is called
  **Messages**, in the nav and in every string a person reads.
- **Not cross-firm.** Slice 1 is inside one firm. A broker cannot message a
  client here — that is what a hub is for.
- **Not email or push.** Notification mail is slice 2, and it will reuse
  `shouldNotifyByEmail`'s one-nudge-per-absence rule rather than inventing a
  second one.

## 4. Vocabulary

`thread` internally and on screen. Not "conversation" (long), not "channel"
(only half of them are), not "hub" (four things already are). A thread is
either a **direct message** between two colleagues or a **channel** with a name
and any number of them.

## 5. Data model — migration 044

Four new tables. All firm-scoped, all read by their own functions, none of them
ever read by the corpus, a report, a market snapshot or a share. That is 013's
separate-tables rule for the fifth time, and it is what makes the wrong thing
unspellable rather than merely discouraged.

- **`msg_threads`** — `org_id`, `kind` (`dm`|`channel`), `title`, `dm_key`,
  `created_by`, `last_message_at`.
- **`msg_thread_members`** — `thread_id`, `user_id`, `email`, `last_read_at`,
  `left_at`.
- **`msg_messages`** — `thread_id`, **`org_id`** (denormalized), `user_id`,
  `author_email`, `body`, `comp_count`.
- **`msg_comps`** — the saved comp. `message_id`, `thread_id`, `org_id`,
  `shared_by`, `shared_by_name`, `source`, `source_comp_id`, `address`,
  `address_key`, `property_type`, **`snapshot jsonb`**.
- **`msg_comp_saves`** — who has already put a shared comp in their own vault,
  so the button can say so instead of making a second copy.

### The five rules a future editor will otherwise break

1. **`msg_comps.snapshot` is a SNAPSHOT, never a pointer, and
   `source_comp_id` is deliberately NOT a foreign key.** `hub_items` made this
   decision first and for the same reason: a live join lets a later vault edit
   silently rewrite what a colleague read last week. It is the opposite of
   `org_comps`, which cascades — and the difference is what each table is *for*.
   `org_comps` is a live copy of a row in a broker's book, so it must track it.
   A message is **a record of what was said**, so it must not. Deleting the
   vault comp leaves the thread exactly as it was.

2. **Every read is walled twice: by membership AND by `org_id`.** The thread id
   always arrives from the browser and proves nothing. `openMessaging` resolves
   the caller's firm from their own email rows, and then every query carries
   `org_id=eq.<that firm>` as well as the membership check. Either wall alone
   would do; two mean a bug in one of them is not a cross-firm leak. This is
   `canReadShare`'s rule — require BOTH, fail toward less access.

3. **A comp reaches a thread only by its owner's explicit act.** Ids are read
   back from `broker_comps` scoped by `user_id`, exactly as the hub's vault send
   does, so a member can only ever send comps that are already theirs. Nothing
   auto-shares, ever.

4. **Saving a received comp goes through the ordinary add path.** `POST
   /api/messages/comp/save` re-posts the snapshot through the same
   `normalizeRow` every imported and hand-typed comp goes through, so a comp the
   vault would refuse to be told today cannot arrive by message. That is the
   undo-a-delete precedent, and it is why the route does not insert directly.

5. **The snapshot is `VAULTAPI.toApiComp`, not a new allowlist.** The vault's
   API contract already decides what a stored row may become, it is
   schema-tested in both directions, and `hub_items` already sends exactly this
   shape to a *client*. A colleague is a narrower audience than that, so a
   second list would be a second thing to keep in step for no gain.

## 6. Entitlements

**Messaging itself is not gated.** It is firm membership and nothing else —
`canUseOrg`'s rule, which gates creating a firm and inviting but never accepting
or reading. A colleague on a free seat is exactly an invited viewer, and a firm
whose junior broker cannot be messaged does not solve the problem this exists
for.

**Attaching a comp and saving one need `canUseVault`.** Both touch a vault, and
both are the same act the vault's own routes gate. The Attach control is not
rendered without it — the Buy-button rule: a control that can only fail is worse
than no control.

`openMessaging` is the gate: **401** not signed in → **503** no database →
**403 `no_firm`** not in a firm. It is deliberately NOT a fourth copy of the
vault's 401/403/503 ladder, because its middle refusal is a different question
with a different answer on screen ("Messages are for your firm" + a door to
`/firms`, not "this is part of Pro").

**The database check sits ABOVE the firm check**, which is the one place this
ladder's order differs from the vault's, and it is not cosmetic: resolving the
caller's firm *is* a database read. Asked the other way round, an outage would
report itself to every member as "you are not in a firm" — the
misreport-an-outage-as-absence trap the hub list and the lead inbox each had to
fix.

## 7. Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/messages` | My threads + my firm's roster, in one call |
| POST | `/api/messages/thread` | Create a channel, or open the DM with a colleague (idempotent on `dm_key`) |
| GET | `/api/messages/thread?id=&since=` | One thread's messages and their comps; `since` is the poll cursor |
| POST | `/api/messages/send` | `{ threadId, body, compIds }` |
| POST | `/api/messages/read` | Stamp `last_read_at` |
| POST | `/api/messages/comp/save` | Put a received comp in my own vault |
| GET | `/messages` | The page |

Prefix chosen to stay clear of `/api/hub*`, whose single `if` block swallows
everything under `/api/hub/` with its own 404.

## 8. The page

`messages-page.js` renders a `marketShell` **body**, the `bulk-page.js` /
`firms-page.js` / `vault-page.js` pattern: no chrome of its own, its stylesheet
emitted in the body so it wins on equal specificity against `MARKET_CSS`.

Two panes at 900px and up, one pane below it (list → thread, with a back
control). Threads on the left with an unread count; the thread on the right,
messages grouped by day and consecutive messages from one author collapsed the
way every messenger does it. Comps render as cards inside the message. A
**Comps** tab on the thread header lists every comp ever shared in it — that
list is the visible form of "sent comps are saved".

Polling is the hub's: 15s, skipped entirely while `document.hidden`, a
server-issued cursor, and a catch-up tick on `visibilitychange`. The known
consequence is the hub's too — **an automated browser reports
`document.hidden: true`, so no scripted pass can ever witness live sync here.**
A person with a visible window is the only instrument for that.

## 9. Nav

**Messages** becomes a rail destination, **directly under Vault**, on both
copies of the rail — `marketBar` in server.js and `.rd-appbar` in index.html.
The order is:

    Workspace, Vault, Messages, Market explorer, 1031 guide, Bulk valuation

The owner pinned that order on 2026-08-29 and asserts it as a SEQUENCE rather
than mere presence, so adding a row is a deliberate change to it. This one
shipped above the vault for one afternoon; below is the owner's placement
(2026-09-01).

It renders for every signed-in member with no hydration and no entitlement read,
unlike Vault or Bulk: the answer is "are you signed in", which the synchronous
render already knows. A member with no firm gets the page and an invitation to
start one, which is a better answer than a missing row.

One consequence to know rather than fix: the Vault row above it ships hidden
and is revealed by entitlement, so for a member without one Messages closes up
directly under Workspace. Bulk valuation already behaves that way, and it is
why the order is pinned as a sequence rather than by position.

## 10. Deliberately not built

- Notification email (slice 2 — reuse `shouldNotifyByEmail`).
- Typing indicators, reactions, threads-within-threads, file upload.
- Editing and deleting a message (`edited_at` / `deleted_at` columns exist so
  neither needs a migration when it lands).
- Cross-firm messaging, and messaging a hub participant.
- A message that carries a whole report. A share link in the body already does
  that, and a second serialization of a report is a second thing to strip.
