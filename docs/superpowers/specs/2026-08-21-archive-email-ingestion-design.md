# Archive (building block 1): inbound email ingestion — design

**Date:** 2026-08-21
**Status:** DESIGN ONLY. No product code, no migration file. Gated on the
extraction test in §9.
**Source:** *CompNinja Business Model Transition Plan*, v2 (17 Aug 2026) —
block 1 "Archive" (§2), the ingestion design (§5), the risks (§9.1).
**New modules proposed:** `svix-verify.js` (pure), `inbound-mail.js` (pure),
migration `037-inbound-email-ingestion.sql`
**Touches:** `server.js` (a new top-level webhook route, `commitVaultBatch`
extracted from `/api/vault/upload`, `extractFileOnce` widened to text),
`broker-vault.js` (`canPublish`, `classifyExtractRows`), `vault-api.js`
(`API_COMP_FIELDS`), `vault-page.js` (the pending inbox), `entitlements.js`
(nothing new — it rides `canUseVault`)

---

## 1. What it is

A broker forwards an email to a private address. Whatever comps are in it —
in a PDF, in a spreadsheet, or typed into the body — come back thirty seconds
later as a receipt, and sit in a review queue on `/vault` until the broker
confirms them. Confirmed rows land in `broker_comps` as an ordinary import
batch, so every feature the vault already has works on them with no
email-shaped branch anywhere.

That is the whole of block 1's missing half. The transition plan's status line
for the Archive is *"Storage built; ingestion missing"*, and it is accurate:
`broker_comps` has held rows since migration 013, and the only door into it is
a CSV upload or a file the broker is standing in front of a browser to pick.

## 2. What already exists, and what is genuinely missing

Worth being precise, because the plan document was written against commit
`c9f265c` and understates how much of the hard part already shipped.

**Already built and reusable as-is:**

| Piece | Where |
|---|---|
| Model extraction of a deals table from a PDF or screenshot | `POST /api/vault/extract`, server.js:16124 → `extractFileOnce`, server.js:5523 |
| The extraction prompt, pinned to the vault's own field names | `EXTRACT_PROMPT`, server.js:4552 |
| Extracted values → the vault's validators | `classifyExtractRows`, broker-vault.js:1685 → `vaultValues` (an allowlist) → `normalizeRow`, broker-vault.js:764 |
| A human confirm step before anything is stored | `#pdfSec`, the confirm table (spec `2026-08-13-vault-pdf-import-design.md`) |
| Per-import batch + cascading undo | `broker_uploads`, migration 013; `DELETE /api/vault/upload`, server.js:17054 |
| Outbound mail with a letterhead | `sendOutboundEmail`, server.js:4301 |
| A signed-webhook route that acks before working | `POST /api/stripe/webhook`, server.js:17902; `verifyWebhookSignature`, stripe.js:73 |

**Genuinely missing — and it is all one thing.** Today's extraction is
*synchronous and browser-mediated*: a person picks a file, waits, and reviews
a table held in a browser tab. Email is *asynchronous and headless*. Nobody is
waiting, and there is no tab to hold the candidate rows. So the new work is:

1. a per-user forwarding address, and the two-factor check that a message on
   it really came from its owner;
2. fetching the message and its attachments back from the mail provider;
3. extraction from **body text**, not only files — the plan's own example
   (§5.2) is three deals typed into an email with no attachment;
4. **somewhere to put candidate rows that is not a browser tab** — the pending
   inbox. This is the only genuinely new persistence in the feature;
5. a receipt email;
6. `origin = 'email'` as a provenance mark, and the publish gate that hangs
   off it.

## 3. A correction to the plan document

§5.2 says an MX record points `in.compninja.co` at Resend, *"which parses the
message and POSTs it to a CompNinja webhook."* The first half is right; the
second is not, and it changes the design.

Resend's inbound webhook (`email.received`) carries **metadata only** —
sender, recipients, subject, an `email_id`, and an attachment list. The body
and the attachment bytes are **fetched back** afterwards through the Receiving
API and the Attachments API, the latter returning a `download_url` per
attachment. Resend documents this as a deliberate choice so large attachments
do not have to fit in a webhook request body.

Three consequences:

- **The webhook handler makes outbound calls of its own.** It is not a pure
  function of its request body, and it can fail halfway. That is what the
  `status` column on `inbound_messages` (§6) is for.
- **`RESEND_API_KEY` becomes an inbound dependency**, not only an outbound
  one. Note the asymmetry with today's code: `sendOutboundEmail` is gated on
  `EMAIL_FROM` *and* the key, but fetching a received message needs only the
  key. So inbound can work on a deployment where outbound is still a no-op —
  which would mean silently ingesting mail and never sending the receipt.
  §5 makes that a refusal instead.
- **An attachment `download_url` is a URL we fetch.** It must be checked
  against Resend's own host before the request is made — the same posture
  `link-check.js` takes with model-supplied URLs, for the same reason.

The good news is that the 8 MB body cap on `/api/vault/extract` and
`/api/vault/upload` is not a problem here, because attachment bytes never
travel in the webhook request at all.

**Signature scheme.** Resend delivers webhooks through Svix: headers
`svix-id`, `svix-timestamp`, `svix-signature`; the signed content is
`${svix-id}.${svix-timestamp}.${raw body}`; HMAC-SHA256, **base64** (Stripe's
is hex — do not copy that line); the secret is `whsec_<base64>` and it is the
decoded bytes after the prefix that are the key; the header may carry several
space-separated `v1,<sig>` values during a secret roll and any one matching
wins. Raw bytes, never a re-serialized parse.

**What is NOT confirmed and must not be assumed.** Whether the payload exposes
SPF/DKIM/DMARC verdicts, and under what field names. §4.3 depends on this, and
the answer decides whether sender verification is real or theatre. Follow the
precedent this repo already set for an unconfirmed vendor frame shape (Gemini
streaming: `capabilities.streamingUnverified` + `scripts/verify-gemini-stream.js`)
— ship `scripts/verify-inbound-webhook.js`, which logs one real received
payload's key set and nothing else, and settle it against a real message
before the sender rule is written.

## 4. Architecture

```
  broker forwards mail
        |
        v
  MX: in.compninja.co -> Resend
        |  email.received (metadata only)
        v
  POST /api/inbound/email        <- svix signature, then sender check
        |  ack 200, then work
        v
  Resend Receiving API + Attachments API   -> body text + files
        |
        v
  extractFileOnce / extractTextOnce  (one prompt, EXTRACT_PROMPT)
        |
        v
  classifyExtractRows -> normalizeRow          [unchanged]
        |
        v
  inbound_messages + inbound_rows   <- the pending inbox. NOTHING in the vault yet.
        |
        +--> receipt email ("12 comps from Lee & Associates ...")
        |
        v
  broker reviews on /vault, confirms
        |
        v
  commitVaultBatch()  -> broker_uploads + broker_comps    [the existing path]
        |
        v
  DELETE /api/vault/upload  still undoes it, with no new code
```

### 4.1 The forwarding address

One address per broker, in its own table rather than a column on `users`,
because it has to be rotatable and rotation needs history.

**The local part is the secret, so it needs real entropy.** The plan's example
is `chuck.a7f3@in.compninja.co`. Two problems: a first name plus four hex
characters is roughly 65,000 guesses, and the name leaks which people work at
a firm to anyone who reads a forwarded header. Recommend 128 bits of
`crypto.randomBytes` in lowercase base32 — `k7m2q9x4b8n3v6c1p5r0t2w4y6@` — with
a friendly label shown beside it in the vault UI, where it costs nothing.

**A retired local part is never reissued.** `local_part` is unique across all
rows including revoked ones. Reissuing one would deliver a stranger's forwards
into a different broker's queue, which is the worst outcome this feature has
available.

Guessing the address is still not enough to write anything (§4.3), but it is
enough to burn the owner's extraction quota and fill their queue with junk, so
entropy is not redundant with the sender check.

### 4.2 Where the route lives — and why not under `/api/vault`

`POST /api/inbound/email`, a top-level route beside `/api/stripe/webhook`.

**It must not go under the `/api/vault` prefix.** That block (server.js:16014)
funnels every path through `openVault()` — `requireUser` → `canUseVault` →
`DB_CONFIGURED` — and a webhook carries no session cookie, so it would 401. The
tempting fix is an exemption inside that block, and it is the wrong move: the
401 → 403 → 503 ladder exists in three deliberate copies (`openVault`,
`requireBroker`, `openBulk`) with a test whose whole job is to catch them
drifting, and punching a session-less hole in the vault's own prefix is the
single change in this codebase most likely to be copied wrongly later.

**Order of operations in the handler**, and each step is load-bearing:

1. **Verify the Svix signature** against the raw body. Fail → 400, log, stop.
   No 400 body detail: an attacker probing this route learns nothing.
2. **Resolve the recipient** to a live `inbound_addresses` row. Unknown or
   revoked → **200 and discard**. Deliberately 200: a 4xx makes Svix retry a
   message that will never become deliverable, and a bounce would confirm to a
   prober which addresses exist.
3. **`DB_CONFIGURED` false → 503 and stop.** This is the vault's no-file-
   fallback rule (migration 013's header) landing in the one place where
   refusing does not lose anything: Svix retries, so the message is still
   there when the database is back. Everywhere else in the app a Supabase
   failure falls back to a file; here the file would be the loss.
4. **Claim `provider_message_id`** on `inbound_messages` (unique). Already
   claimed → 200, do nothing. Webhook redelivery is normal and must not create
   two pending batches.
5. **Answer 200.** Then work. Exactly the Stripe precedent at server.js:17917
   and for the same reason: a slow handler earns a retry storm for work
   already done.

### 4.3 Two-factor sender verification

The plan is right that this is "the privacy wall's newest and weakest
surface", and right that knowing the address must never be sufficient. But the
check it names — the SMTP envelope sender against `users` — is on its own
close to worthless: an envelope sender is a string the sending machine
chooses, and anyone who learns the address can set it to the broker's own
email. What actually authenticates a sender is SPF/DKIM/DMARC, evaluated by
the receiving MTA — Resend, here.

So the rule is **both, and neither alone**:

- the envelope sender (and `From`) must match a sender authorized for that
  inbound address — for v1, exactly `users.email` of the owner; **and**
- the provider's authentication verdict for the sending domain must be a
  pass.

**A missing verdict is not a pass.** If §3's open question resolves to "Resend
does not expose one", this design does not silently degrade to the envelope
check. It takes the fallback below.

**The fallback if no verdict is available: quarantine, not refusal and not
acceptance.** The message is stored with `status = 'quarantined'`, nothing is
extracted (so nothing is billed), and the broker is told on `/vault` that a
message arrived from an address we could not authenticate and can release it
themselves. That keeps the failure in front of the person who can judge it,
costs nothing, and never writes an unauthenticated row into a book of
business.

**Never auto-reply to a message that failed the sender check.** The purported
sender is exactly the field in doubt, so a "we couldn't verify you" reply
mails a stranger — classic backscatter, and on a spoofing run it makes
CompNinja the thing sending the abuse. Failures go to `notifyByEmail` (the
owner) and to the broker's own `/vault`, never outbound to the sender.

**Forwarding from a phone or a personal address** is real and common, and v1
does not solve it: a non-matching sender quarantines, and the vault says
which address it came from with a one-click "always accept this address for
me". The table for that (`inbound_senders`) is designed in §6 and left
uncreated — it is one migration and no new thinking, and it should be bought
with evidence from the first real broker rather than guessed at now.

### 4.4 Fetching the message

After the ack: `GET` the received email for the body, then the attachment list,
then each `download_url`.

- Every fetched URL's host is checked against Resend's own before the request.
- Attachment bytes go through the existing `VAULT.checkExtractFile`
  (broker-vault.js:1587) — the same byte-sniff and the same `MAX_EXTRACT_BYTES`
  (4 MiB) the browser path uses, so a broker cannot get a file type into the
  vault by mail that they could not get in by hand. **The declared MIME type
  from the mail is never trusted**, exactly as the browser's `type` is never
  trusted today.
- A `.csv` or `.xlsx` attachment is *not* an extract candidate. CSV goes
  straight to `parseUpload` (broker-vault.js:990) with no model call and no
  cost. XLSX is out of scope for v1 — it needs a parser this repo has no
  dependency for, and "export it as CSV" is a real answer.
- Cap attachments per message (proposed 10) and total bytes (proposed 16 MiB).

### 4.5 Extraction — one contract, two inputs

`extractFileOnce(fileBase64, mediaType)` becomes
`extractDealsOnce({ fileBase64, mediaType } | { text })`, and the providers'
`buildExtractBody` gains the text case. **`EXTRACT_PROMPT` is not forked.** It
already says "a deals table (CoStar, ARGUS, CMA, MLS, or similar)" and already
pins the key set to `VAULT.EXTRACT_KEYS`; one sentence widens it to a message
body. Two prompts would be two things to keep in step, and the first field
added through the `add-comp-field` skill would land in one of them.

The body is the *forwarded* body, so it contains a quoted chain, signatures and
disclaimers. The prompt's existing "Omit a field rather than invent it" and
"Omit header rows, totals, averages" rules cover most of it; add "ignore
signatures, disclaimers and quoted reply chains".

Extracted rows reach `normalizeRow` through exactly today's path, unchanged:
`classifyExtractRows` → `vaultValues` (an allowlist over `VAULT_FIELD_KEYS`,
so an unexpected key from the model is dropped rather than stored) →
`normalizeRow`. That is the answer to the plan's second question, and it needs
no new code: it is already how the PDF path works.

### 4.6 Per-field confidence, and what it is allowed to decide

The plan asks for per-field confidence on pending rows. Two honest caveats
belong in the design rather than in a later post-mortem:

**Model-stated confidence is a review-ordering hint, never a gate.** It is
poorly calibrated in general and there is no reason to think it is better here.
What actually gates a row is what already gates every other row:
`normalizeRow` refuses "1.2M", an Excel date serial and a day-first date rather
than guessing (broker-vault.js's founding rule), and then a human confirms.
Confidence decides *what the broker looks at first*. It decides nothing else.

**There is a better-calibrated signal available for free**, and the two should
be shown together:

- *absence* — the field was not in the source at all, which is a fact and not
  an estimate;
- *the parser's own verdict* — a value that reached `normalizeRow` and came
  back rewritten (a date normalized, a price stripped of `$`) versus one that
  came back refused.

So `classifyExtractRows` returns, per row, `{ values, confidence, error }`,
where `confidence` merges an optional model-supplied per-field number with
those two structural facts, and the review screen sorts "needs attention"
first. The model's number rides on an optional key that `vaultValues` already
drops from `values` — so the browser path can ignore it entirely and nothing
about today's confirm table changes.

### 4.7 The pending inbox

`inbound_messages` + `inbound_rows` (§6). This is the only new persistence,
and it exists because there is no browser tab to hold candidates in.

Three rules:

- **`normalizeRow`'s verdict is recomputed at confirm time, never trusted from
  storage.** A stored `error` is a display hint. The row that is written is
  the row that passes validation at the moment of writing, so a validator
  fixed between receipt and confirm applies, and a stored "ok" can never
  become a write.
- **Every read is scoped by `user_id`**, which is why it is denormalized onto
  `inbound_rows` rather than reached through a join. Migration 013's rule.
- **A pending row is not a comp.** Nothing reads `inbound_rows` into a report,
  a blend, the corpus, or a market snapshot. The privacy wall's separate-tables
  rule (013) extends to it for free, since it is a separate table nothing else
  queries.

### 4.8 Confirm → the existing batch → the existing undo

This is the plan's third question, and the answer is a refactor this repo has
already done once.

Extract the commit half of `POST /api/vault/upload` (server.js:16266) —
`broker_uploads` insert → `marketOf` attach → `broker_comps` upsert with
`on_conflict=user_id,dedupe_key` → `linkVaultProperties` (server.js:12758) →
`logEvent` — into a module-level

```js
commitVaultBatch(user, rows, { filename, skipped, origin })
```

and have both callers use it. This is exactly the 2026-08-21 precedent where
`runCompSearch` and `finishReportForViewer` came out of the `/api/comps`
handler so the bulk worker could run the same two functions: **one number, one
place.** A second commit path would mean a forwarded batch and an uploaded
batch differing in ways nothing on either screen could show.

Because the batch is an ordinary `broker_uploads` row, `DELETE
/api/vault/upload?id=` cascades to its comps with **no new code** — which was
the point of asking the question.

Two details:

- **The batch is created at confirm, not at receipt.** "Review before storage"
  means an unconfirmed message has no `broker_uploads` row to undo.
- **Re-forwarding the same PDF is safe but not deduped at the pending stage.**
  `provider_message_id` stops webhook *redelivery* from queueing twice; a
  broker genuinely forwarding the same file twice gets two queues, and the
  second commit is a no-op because `on_conflict=user_id,dedupe_key` already
  makes it one. The confirm screen should say "3 of these 12 are already in
  your book" *before* the click, computed with the same `dedupe_key`, so the
  count the broker sees matches what lands.

### 4.9 The receipt

One email, once extraction is done — the plan's copy is right:
*"12 comps from Lee & Associates, Boise industrial — review when you're back
at a desk."* Through `sendOutboundEmail` and the `email-shell.js` letterhead,
fire-and-forget like every other send.

Copy and the send/do-not-send decision live in the pure `inbound-mail.js`, the
shape `watchlist-digest.js` established — `buildReceipt()` returns **null**
rather than empty text when there is nothing worth saying, so a caller cannot
mail a blank receipt by forgetting to check.

**A message with nothing extractable gets no reply at all.** A broker whose
auto-forward rule points at this address would otherwise get a reply per
message, and replying into a mail loop is how a loop becomes a storm. It shows
up on `/vault` as a discarded message and nowhere else.

## 5. The four rules from §5.3, and where each is enforced

| Rule | Enforced by | Note |
|---|---|---|
| Review before storage | `inbound_rows` is a separate table; only `POST /api/inbound/confirm` calls `commitVaultBatch` | The 60-second target is a review-UI property; see §9 |
| Received data lands as `received_unverified` | `broker_comps.origin = 'email'` (§6), rendered distinctly on `/vault` | Vault comps already never carry the green Verified badge — `blend-comps.js` gives them `source_type: "broker_vault"`, an ownership statement. So the *new* rule this creates is the publish gate below, not a badge change |
| Never into the public corpus without sender attestation | `canPublish` (broker-vault.js:1310) refuses `origin === 'email'` unless `attested_at` is set | In the pure module, so `npm test` covers it. The attestation is a per-comp affirmation the broker makes at publish time that they have the right to republish. It is the code half of §9.1's data-rights risk |
| No file fallback | `DB_CONFIGURED` false → 503 from the webhook (§4.2 step 3) | The one place refusing loses nothing, because Svix retries |

## 6. Migration plan

Lands as `migrations/037-inbound-email-ingestion.sql` **after the extraction
test passes** (§9). Purely additive; safe to run before the code deploys, and
the code must not deploy before it — `broker_comps.origin` is selected by
name on the vault read path and PostgREST 400s an unknown column, which is
018's and 030's ordering rule.

```sql
-- 037 · Archive: inbound email ingestion (block 1)
-- RUN BEFORE DEPLOYING. Purely additive; no destructive statement.

begin;

-- One live forwarding address per broker. `local_part` is unique across ALL
-- rows, revoked included: reissuing a retired address would deliver one
-- broker's forwards into another broker's queue.
create table if not exists inbound_addresses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  local_part  text not null unique,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create index if not exists inbound_addresses_user_live_idx
  on inbound_addresses (user_id) where revoked_at is null;

-- One row per received message. `provider_message_id` is unique because
-- webhook redelivery is normal and must not queue the same mail twice.
-- `upload_id` is SET NULL on delete, not cascade (018's rule): undoing the
-- import must not erase the record that the email arrived.
create table if not exists inbound_messages (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users(id) on delete cascade,
  provider_message_id  text not null unique,
  from_email           text not null default '',
  to_local_part        text not null default '',
  subject              text not null default '',
  status               text not null default 'received',
  row_count            integer not null default 0,
  attachment_count     integer not null default 0,
  auth_result          text not null default '',   -- provider spf/dkim verdict, verbatim
  upload_id            uuid references broker_uploads(id) on delete set null,
  error                text,
  received_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  constraint inbound_messages_status_chk check (status in
    ('received','extracting','pending','committed','discarded','failed','quarantined'))
);
create index if not exists inbound_messages_user_recent_idx
  on inbound_messages (user_id, received_at desc);

-- Candidate rows. NOT comps: nothing outside the inbound routes reads this
-- table, so the privacy wall's separate-tables rule covers it for free.
--
-- `field_values`, not `values` — `values` is a reserved word in Postgres and
-- `create table (... values jsonb ...)` is a syntax error.
-- `row_index`, not `position`, for the same class of reason.
--
-- user_id is denormalized so every read is user-scoped without a join (013).
create table if not exists inbound_rows (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references inbound_messages(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  row_index    integer not null,
  field_values jsonb not null default '{}'::jsonb,
  confidence   jsonb not null default '{}'::jsonb,
  source_ref   text not null default '',      -- 'body' or the attachment filename
  state        text not null default 'pending',
  created_at   timestamptz not null default now(),
  unique (message_id, row_index),
  constraint inbound_rows_state_chk check (state in ('pending','accepted','rejected'))
);
create index if not exists inbound_rows_message_idx on inbound_rows (message_id, row_index);

-- Provenance. 'upload' is what every existing row is, so the default
-- backfills the whole table correctly with no UPDATE.
alter table broker_comps add column if not exists origin text not null default 'upload';
alter table broker_comps add column if not exists attested_at timestamptz;

do $$ begin
  alter table broker_comps add constraint broker_comps_origin_chk
    check (origin in ('upload','manual','email'));
exception when duplicate_object then null; end $$;

alter table inbound_addresses enable row level security;
alter table inbound_messages  enable row level security;
alter table inbound_rows      enable row level security;

commit;

-- Verify (zero rows = schema complete):
--   select t from unnest(array['inbound_addresses','inbound_messages','inbound_rows']) as t
--   where not exists (select 1 from information_schema.tables where table_name = t)
--   union all
--   select c from unnest(array['origin','attested_at']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_name='broker_comps' and column_name = c);
```

**Note the RLS line on all three tables.** Migration 016 shipped without it on
`broker_properties` and had to be re-run — the anon role could read every
broker's buildings through PostgREST until it was fixed. This table set is
strictly more sensitive.

**One build-breaking side effect, and it is the guardrail working.**
`test/vault-api.test.js` scans `migrations/*.sql` for `broker_comps` columns
and asserts the API contract names every one of them, both ways. The moment
037 exists, that test goes red until `origin` and `attested_at` are added to
`API_COMP_FIELDS` in `vault-api.js` (or deliberately omitted as internal, as
`user_id` and `dedupe_key` are). `exportColumns` (broker-vault.js:1226) is an
allowlist over the template columns, so neither field leaks into the export
CSV.

## 7. Entitlement, spend and abuse

**Entitlement is `canUseVault`** — no new flag. An inbound address exists only
for an account that has a vault, which means the tester passkey does not reach
it (that grant deliberately excludes the vault) and `PRO_ENABLED=off` grants
none.

**On lapse, mail is refused rather than dropped.** The address stops
extracting and the sender is told once. Nothing already in the queue or the
book is deleted — the vault's standing promise.

**Each message is a billed model call**, so this is a spend surface, and the
`BULK_DAILY_ADDRESSES` reasoning applies: one live job at a time bounds
concurrency, not spend.

- `INBOUND_DAILY_MESSAGES` (proposed default 50) per user per UTC day.
  Windowed on `received_at`; fails open on a read error, because a paying
  broker must not be locked out of their own inbox by one failed count, and
  the per-message caps still bound the damage.
- Attachments per message (10) and total bytes (16 MiB), refused at fetch.
- Over the cap: quarantine and tell the broker. Never mail the sender (§4.3).

The realistic abuse case is not an attacker — sender verification handles that
— it is a broker's own Outlook rule auto-forwarding their whole inbox. The
daily cap and the no-reply-when-nothing-extractable rule are aimed squarely at
that.

## 8. Tests to write first

The plan's standing guardrail is tests first on anything touching the privacy
wall. In dependency order:

1. **`svix-verify.js`** — a known-good vector passes; a tampered body, a
   tampered timestamp, a stale timestamp, a hex-not-base64 digest, a missing
   header and a wrong secret all fail; multiple `v1,` values with one match
   passes. Mirrors `test/stripe.test.js`.
2. **`inbound-mail.js`** — recipient parsing (plus-addressing, case,
   sub-addressing, an unknown domain); the sender-authorization decision table
   including *verdict absent → quarantine*; `buildReceipt` returning **null**
   with nothing to say; confidence merging.
3. **`canPublish` refuses `origin: 'email'` without `attested_at`**, and
   allows it with — in `test/broker-vault.test.js`, beside the existing
   publish rules.
4. **`commitVaultBatch` produces byte-identical batches for both callers.**
   The regression this whole refactor exists to prevent.
5. **Route-level, against `test/helpers/fake-supabase.js`** (which exists for
   exactly this class of feature — the ones with no file fallback): an
   unsigned POST is refused; a signed POST for an unknown local part is 200
   and writes nothing; a redelivered `provider_message_id` writes nothing the
   second time; `DB_CONFIGURED=false` answers 503 rather than degrading; a
   confirmed message produces a `broker_uploads` row that
   `DELETE /api/vault/upload` then removes with its comps.
6. **A source scan** that no `/api/inbound` path is registered inside the
   `/api/vault` prefix block — §4.2's rule, stated as a test the way
   `test/org-routes.test.js` pins the "no widened `user_id=eq.` read" rule.

## 9. The extraction test that gates all of this

The plan is emphatic and correct: *"Run this before writing any migration."*
Nothing above is worth building if a broker can key 12 comps faster than they
can correct 12 extracted ones.

**It needs no product code, because the mechanism already shipped.** Take 20
real comp PDFs from different brokerages and put each through the live
`POST /api/vault/extract`, which already returns exactly `{ values, error }`
per row. Score against hand-keyed ground truth:

- **Recall** — deals found ÷ deals actually in the file. Missing a row is the
  worst failure, because nothing on screen shows an absence.
- **Field precision**, per field, on the four required ones (`address`,
  `property_type`, `transaction`, `deal_date`) and on `price` and `size_sqft`
  separately, since those two are what the valuation multiplies.
- **Fabrication rate** — fields present in the output and absent from the
  source. This is the number that decides the feature. `normalizeRow` catches
  malformed values; it cannot catch a well-formed invention.
- **Correction time** — wall clock, a real person, per 10-comp file.
- **Refusal quality** — of the rows `normalizeRow` rejected, how many were
  genuinely bad data versus a good value it could not read.

**Pass condition, stated before the numbers arrive so it cannot be moved
afterwards:** review of a 10-comp file completes in under 60 seconds, recall
is high enough that a broker is not re-reading the PDF to check for missing
rows, and the fabrication rate is at or near zero. Fail on fabrication is
fatal regardless of the other numbers — a wrong number in a broker's own
records is worse than a rejected row, because nobody will ever notice it, and
that is the sentence the whole vault module is built around.

**Two properties of the harness protect that verdict, and both were added
after an audit rather than in the first pass** (`scripts/extraction-eval.js`):

- **It never trips the route's rate limiter.** `/api/vault/extract` allows 8
  calls per rolling 5 minutes per IP, and `rateLimited()` appends a hit *even
  when it refuses* — so retrying into a 429 slides the window forward and digs
  the hole deeper. The runner paces itself to 7 per window instead. Twenty
  files is about 12 minutes, roughly 7 of it deliberate waiting, and the run
  says so before it starts so nobody kills a healthy run that looks hung.
- **An infrastructure failure is EXCLUDED, never scored.** A 429, a 5xx, a
  network error or a file the route refused (wrong type, over 4 MB) is named
  and left out of every figure, and the run exits non-zero so a partial run
  cannot be read as a verdict. Only a genuine empty extraction — the model
  read the file and found no table — is scored, as the real miss it is.
  Without this, a rate-limited file counted as 0% recall: a false failure, on
  the exact number that decides whether the Archive gets built.

Prove the pipeline with `--limit 2` before spending twenty files' worth.

A single deliverable: the numbers, and a written pass or fail. Then 037.

## 10. Deliberately not built

- **An Outlook add-in.** The plan is right: a sales unlock, not a product
  unlock. The forwarding address works identically in Outlook desktop, Outlook
  web, Gmail and iPhone Mail with no OAuth, no Microsoft review and no
  enterprise infosec conversation.
- **XLSX attachments.** No dependency for it, and "export it as CSV" is a real
  answer. CSV attachments *are* handled, and cost nothing.
- **Additional verified sender addresses** (`inbound_senders`). Designed in
  §4.3, deferred to the first real broker who forwards from their phone.
  Import-time geocoding's precedent: buy it with evidence.
- **Auto-confirm above a confidence threshold.** Directly against §5.3's first
  rule, and §4.6's calibration point is why.
- **Ingesting BOVs, market reports and lease abstracts as documents.** Block 1's
  scope line names them, and they are not comps — they have no
  `normalizeRow` to land in. That is a document store, which is its own design
  and should follow the comp path rather than ride along with it.
- **Any reading of received data into the public corpus.** §9.1's exposure.
  The publish gate in §5 is the only door and it needs a human attestation.

## 11. Open questions

1. **Does Resend's `email.received` payload expose an SPF/DKIM verdict, and
   under what field name?** §4.3 hangs on it. Settle with one real message
   before writing the sender rule; `scripts/verify-inbound-webhook.js`.
2. **`in.compninja.co` MX vs. Resend's default `.resend.app` domain.** The
   subdomain keeps the apex's mail untouched, which matters because
   `info@compninja.co` is the public contact address. Confirm the MX priority
   requirement before changing DNS.
3. **Body-text extraction quality is untested**, unlike the PDF path. §9
   should include five body-only messages, because the plan's own example is a
   body-only forward.
4. **Where the pending inbox sits on `/vault`.** It belongs in the "Your book"
   deck, but the empty-workspace design (`2026-08-13-vault-empty-workspace-design.md`)
   is deliberate about what a new broker sees, and a fourth empty state there
   would undo it. Design that surface with a before/after screenshot pair, per
   the standing rule.
5. **What the attestation actually says at publish.** It is a legal sentence,
   not a UI one, and §9.1 says to get counsel's cleared paragraph before the
   free audit begins — which is before this ships.
