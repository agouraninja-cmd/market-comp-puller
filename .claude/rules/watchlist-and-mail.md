---
paths:
  - "watchlist-digest.js"
  - "search-demand.js"
  - "email-shell.js"
  - "test/watchlist-digest*.test.js"
  - "test/search-demand.test.js"
  - "test/email-shell.test.js"
---
# Outbound mail, leads and the watchlist

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Configuration

- `RESEND_API_KEY` — optional. When set, every stored lead AND every broker
  comp submission fires an email notification via Resend's REST API (plain
  fetch, free tier is plenty). Fire-and-forget: a failing provider is logged
  but never breaks the request. Caveat: without a verified domain Resend only
  delivers to the address that owns the Resend account, so the account must be
  registered with the notify address itself.
- `RESEND_API_URL` — **test-only**, defaults to Resend's real endpoint and is
  never set in production. It exists because the watchlist digest is the one
  feature whose entire point is an email leaving the building, and without it
  the suite could reach the send call and then had to stop and assume. With
  it, `test/watchlist-digest-run.test.js` asserts who was mailed and what the
  body said. Not a secret and authorizes nothing (`RESEND_API_KEY` still
  does), but it decides where mail is posted, so treat it as trusted config.
- `LEAD_NOTIFY_EMAIL` — where those notifications go; defaults to
  agouraninja@gmail.com.
- `EMAIL_FROM` — optional, e.g. `CompNinja <reports@yourdomain.com>`. The single
  gate for OUTBOUND mail (to leads and brokers, not the owner): a BOV lead gets
  a follow-up with their report share link, and a broker gets a confirmation
  after submitting a comp. Leave UNSET until a custom domain is verified in
  Resend — the free tier only delivers to the owner, so without it these sends
  log `Outbound email skipped` and silently no-op. Replies go to
  `LEAD_NOTIFY_EMAIL` (Resend `reply_to`).

## Architecture

- `POST /api/lead` — stores a lead-capture submission (name/email/phone/company
  + the searched address/type + `source`: `"export"` for export unlocks,
  `"bov"` for Broker Opinion of Value requests, and — on rows written
  before 2026-09-12 — `"1031"` for a BOV request from a browser that had
  recently read the since-removed `/1031-exchange` guide (it stamped
  localStorage `cnRef1031.v1`; index.html no longer reads it, so nothing
  writes the tag any more); the Supabase `leads` table has a matching
  `source` column. `"1031"` stays bov-CLASS everywhere behavior branches
  (`bovClass` in the handler, and the inbox/intro queries use
  `source=in.(bov,1031)`) so the existing rows keep reading as the BOV
  requests they are — the tag was attribution and urgency, never a separate
  funnel, and it still surfaces as an anonymized `is_1031` boolean in the
  broker inbox (never the raw tag).
  Also takes an optional `size_sqft`, cleaned by
  `LEADSVC.cleanSizeSqft` and written only when present (a conditional spread,
  so a lead with no size never touches the column — protects the file
  fallback if migration 015 has not run). A durably-stored (`dest === "db"`)
  bov-class lead fires a fire-and-forget alert to every broker covering that
  market + property type: the same four anonymized facts the inbox shows,
  never the owner's name/email/phone/company/address, throttled to one email
  per broker/market/hour (`BROKER_ALERT_SUPPRESS`, `BROKER_ALERT_WINDOW_MS`)
  so a hot market cannot turn one lead into a mail storm. Rate-limited per IP.
- **The watchlist digest** (2026-08-13; migration `025-watchlist-digest.sql`,
  **run before deploying**). `POST /api/watchlist/digest` mails each watcher
  the markets of theirs that have new comps. It is **the only thing this
  product sends on its own initiative** — everything else it mails answers
  something a person just did — and the whole file is written to that bar:
  when in doubt, send nothing.
  Copy and the "is this worth sending?" rule live in the pure, tested
  **`watchlist-digest.js`**; `buildDigest` returns **null** rather than an
  empty string when there is no news, so a caller cannot mail a blank digest
  by forgetting to check. The feed itself is `buildWatchlistFeed()` in
  server.js, **shared with `GET /api/watchlist/feed`** so the page and the
  email can never quote different numbers for the same market; the callers
  differ only in the cutoff they pass.
  Six rules a future editor will otherwise break:
  - **It is ADMIN_KEY-gated and manually triggered, never a timer.** A
    `setInterval` in this process would fire at an hour nobody chose, fire
    again after every deploy restart, and fire twice the day this runs on two
    instances — and the failure mode of all three is mailing real people the
    same comps again. A route makes the schedule an explicit decision (a
    Render cron, an Action, a person) and makes "run it and look" possible.
    **The trigger is the "Watchlist digest" card on `/admin`** — Preview
    (builds every email, sends none, marks nothing) and Send now (confirms
    first, and says the send cannot be recalled). "Manual" meant curl-only
    before that card existed, which is a feature nobody runs. One property is
    load-bearing and tested: **opening `/admin` must not send email.** Every
    other card there fetches on load, so the obvious way to write this one is
    the wrong way and the mistake is invisible — the page looks identical and
    the mail has already gone. `renderDigestCard()` takes no arguments and
    fetches nothing; the only call to the route lives inside the click
    handler. On a cadence, drive the same route from outside:
    `curl -fsS -X POST https://compninja.co/api/watchlist/digest -H
    "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' -d '{}'`.
    Nothing bad happens if that fires twice — the high-water marks make the
    second run a no-op — which is what makes an external scheduler safe here.
  - **The send cutoff is the LATER of `last_digest_at` and `last_seen_at`.**
    Two markers, deliberately: the digest reading only its own would mail
    comps the reader already saw in the app, and reading only `last_seen_at`
    would mail the same ones forever to somebody who never clicks the bell.
    The happy consequence is that an active user quietly stops receiving
    digests without ever unsubscribing.
  - **It refuses without a database (503) AND without outbound mail (503).**
    The second one is the subtle one: `sendOutboundEmail` is a silent no-op
    when `EMAIL_FROM`/`RESEND_API_KEY` are unset, so running blind would
    advance every high-water mark and DELETE a digest nobody received. This
    is the only caller for which that no-op is destructive, which is why the
    check is here and not there. `{ dryRun: true }` builds every email, sends
    none, marks nothing, and returns the copy — it skips the mail check on
    purpose, since inspecting copy should not need a verified domain.
  - **Mark AFTER the send, and only the markets that carried news.** A failed
    mark costs one duplicate next run; marking first would lose the digest
    outright on a failed send, and a lost digest is invisible where a
    duplicate is merely annoying. Markets with nothing new keep their old
    high-water mark, so the day one does get a comp the digest still reaches
    back to when the watch started.
  - **One bad account never stops the run** — the rest of the list is still
    owed its mail.
  - **Unsubscribe is a token link, and the GET only CONFIRMS.** `GET
    /watchlist/unsubscribe?u=&t=` renders a page whose button POSTs; the POST
    flips `users.digest_optout`. The second click is correctness, not
    politeness: corporate mail scanners and link-preview bots fetch every URL
    in an email, and a GET that unsubscribed would opt people out of mail they
    never opened. The token is an HMAC of the user id keyed on
    `SUPABASE_SERVICE_KEY` (guaranteed present, since the digest refuses
    without a database; domain-separated so it cannot collide with any other
    use of that key), so the link authenticates itself for somebody who is not
    signed in, months later, on a phone. `&on=1` is the same link in reverse —
    a one-way off switch with no way back is a support ticket.
- **Search demand on the desk** (2026-08-25). Each watched market on My Desk
  carries a line saying how many people searched it lately: "9 people ran 14
  searches here in the last 30 days, 6 of them Industrial." It reads
  `analytics_events`, which has logged every search since long before this
  shipped; nothing new is recorded and no hot path changed.
  **Pro-only**, via `canSeeSearchDemand` in `entitlements.js` — Pro, tester and
  comped-admin get it; a **single-report purchase does not** (the Address
  Explorer's argument: a $39 unlock buys one property's history, and a
  market's demand is not scoped to a property), and it is **false on a dark
  deployment** (the vault's argument, not the Explorer's: it never existed
  before the tier, and it reports this site's own traffic). A free account
  gets `demand_locked: true` on the feed item instead of a figure, which the
  card renders as the standard `.unlock-comps-btn` prompt.
  The RULES live in the pure, tested **`search-demand.js`**; server.js owns
  only the read (`demandRowsForMarkets`, filtered at the database — the
  `/admin` reducer's whole-table scan is right for a dashboard one person
  opens and wrong for a route every subscriber hits). Four of them exist
  because each is a way the number could flatter us, and the file's bar is
  under-claim, never over-:
  - **The broker's own searches are excluded** (`excludeUserId`). Without it
    the first thing a broker sees on their home market is themselves,
    reported as somebody else's interest.
  - **Explorer sweeps are excluded** (`source: "explore"`). One Pro
    subscriber walking a market address by address is not demand.
  - **A `signup_gate` counts** — a blocked visitor wanted the same answer —
    but is dropped when that visitor completed a search in the same market
    the same UTC day, because that is one attempt writing two rows.
  - **People and searches are separate numbers**, and where a row carries no
    `visitor_id` (anything before migration 026) they all collapse into ONE
    person rather than one each. Undercounting is the allowed error.
  Aggregate only: the payload is `{ window_days, searches, viewers, in_type }`
  and carries no address, email, visitor id or user id.
  `buildWatchlistFeed(user, ent, cutoffOf, { withDemand: true })` is
  **opt-in, and only the page opts in** — the digest does not, both because a
  search count is not news anybody asked to be mailed and because its loop
  over every account would fire one analytics query per watcher for a figure
  it discards.
  **It needs traffic to be worth reading.** At today's volume most markets
  answer "no one searched this market in the last 30 days", which is honest
  and is also the site telling a broker how quiet it is. The same
  prerequisite blocks routing real leads to contributors.
