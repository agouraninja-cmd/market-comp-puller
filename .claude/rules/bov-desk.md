---
paths:
  - "bov-desk.js"
  - "bov-desk-page.js"
  - "migrations/065-bov-desk.sql"
  - "test/bov-desk.test.js"
  - "test/bov-desk-page.test.js"
  - "test/bov-desk-run.test.js"
---
# The BOV desk

> Shipped 2026-11-20 (the owner: "Have a way to make the BOV replies and
> searches automated. So I dont have to worry about the proccess if you can
> think of a faster way to get them their BOVs then we have allready been
> doing then do so please"). Built straight, not from drafts. Claude Code
> loads this file when it opens a file matching `paths` above; read it by
> hand before changing this area's code in `server.js`.

## What it replaced

A Broker Opinion of Value request (a lead with `source: "bov"`, from the
report's "Get a free Broker Opinion of Value" button) used to wait on the
owner three times: to notice the notification, to search the web for local
brokers who handle that kind of property and write each one an email, and to
write the introduction once one said yes. The first real request (982 Warwick
Avenue, 2026-11-19) was worked that way in a chat session: one reply to the
requester, a web search, and four outreach drafts that were still sitting
unsent, with no recipients, the next morning.

Now:

1. **The request lands** (`POST /api/lead`, unchanged for the visitor). The
   owner's notification, the brokers' anonymized alert and the requester's
   acknowledgment go out as before. The acknowledgment gained one line: the
   phone number on file and an invitation to correct it (the hand-written
   reply always asked).
2. **`bovKickoff` runs, fire-and-forget.** It finds up to five local brokers
   and drafts an email to each (`bovPrepare`), then mails the owner "BOV
   desk: N brokers found for \<address\>" with a link to the desk. Seconds,
   not hours.
3. **The owner opens `/admin/bov`**, reads a draft and presses Send (or
   "Send all"). Nothing reaches a broker before that, unless the owner has
   switched `BOV_AUTOPILOT` on.
4. **The broker clicks the link in the email** (`/bov/accept`). The first
   to say yes is introduced to the requester on the spot, one email to both
   of them, copied to the owner. Nobody had to be at a keyboard.

A member broker who asks for a lead from their Pipeline
(`POST /api/broker/leads/intro`) is put on the desk as already accepted, so
the owner's part there is one press of Introduce.

## Files

- **`bov-desk.js`** (pure, tested): the search prompt, what of the answer is
  believed, both emails, the autopilot rules, the desk's validation. Its
  header lists the six rules; they are restated below because they are the
  ones a person on the other end pays for.
- **`bov-desk-page.js`**: the owner's page and the page a broker sees. The
  browser script is a REAL function (`deskClient`) emitted with
  `toString()`, so it is parsed by `node --check` and run in
  `test/bov-desk-page.test.js` against a stand-in document; it must read
  nothing from the module's scope.
- **server.js**, the block headed "The BOV desk": `bovFindBrokers` (the
  billed search), `bovPrepare`, `bovKickoff`, `bovSendMatch`, `bovClaim`,
  `bovIntroduce`, `bovDeskPayload`, `bovDeskAction`, `readBovDeskCount`.
- **Migration `065-bov-desk.sql`**: `bov_requests` (one row per request the
  desk has started on) and `bov_matches` (one row per broker offered it,
  holding the email exactly as it will be sent). **Deploy order is SOFT**:
  nothing else reads either table and every write from the lead route is
  fire-and-forget, so a deploy ahead of the migration costs only the desk.
  The request is stored, both existing emails go, and `/admin/bov` and
  `/admin`'s card both say "run migration 065". Tested with the stand-in's
  `missingTables`.

## Routes

- `GET /admin/bov`: a public shell that shows nothing until the admin key or
  the `cn_admin` cookie opens the API (the `/admin/heroes` pattern).
- `GET /api/admin/bov` (`ADMIN_KEY`-gated, DB-only): the BOV requests of the
  last 60 days, each with its brokers. **It only reads.**
- `POST /api/admin/bov` (`ADMIN_KEY`-gated): `{ action, ... }` with `find`
  (`more: true` forces a fresh search), `add`, `save`, `send`, `mark`
  (`sent` / `skipped` / `declined` / `draft`), `introduce`, `introduced`
  (the owner did it from their own mailbox), `close`, `reopen`.
- `GET|POST /bov/accept?m=<match id>&t=<hmac>`: the link in the email.
  `&no=1` on the POST is "no thanks", so no body is ever read.
- `/api/stats` carries `bovDesk` (`{ db, ready, toSend, toIntroduce }`) for
  `/admin`'s card, which is a count and a link and sits above the tiles.

## Rules that must hold

1. **Nothing reaches a broker unread unless `BOV_AUTOPILOT=on`.** The owner's
   standing rule for mail sent in their name is "show me the full text and
   get an explicit yes". So a draft sits on the desk in an editable box with
   its Send button under it, the box grows to its text (no inner scrollbar),
   and nothing is behind a fold. "Send all" and "Introduce" ask first.
   Autopilot is the owner's own switch, off by default.
2. **Opening the desk sends nothing and searches nothing** (the digest
   card's rule). The page's load is one GET; every send and every search a
   person starts is the POST, inside a click handler. Tested both in the
   stand-in document and against a real server (no mail, no provider call,
   no database write).
3. **No timer** (never-break rule 12). The search is started by the request
   itself or by a click. A restart mid-search loses it; "Find brokers" on
   the desk is the retry.
4. **The outreach names the property and never the person.** The
   requester's name, email, phone and company travel in exactly ONE mail,
   the introduction, and only to a broker who accepted an offer the owner
   let out or whom the owner picked. The accept page shows the address, type
   and size, never who asked. A test greps every draft and every sent mail
   for the lead's private fields.
5. **The search is told a market and a type, nothing else.** No street
   address, no name. That is also what lets the answer be reused: brokers
   found for a market and type are offered to the next request there for 60
   days ("the bench", `BENCH_DAYS`), a broker who said yes first, and a
   fresh search runs only when fewer than `MIN_BENCH` (3) are usable. A
   broker who passed, or whom the owner skipped, is not offered the next
   request either, from the bench or from a fresh search.
6. **A contact detail is copied or absent, never built.** The prompt forbids
   a guessed address; `parseCandidates` drops anything that is not shaped
   like one, a placeholder, a pattern (`first.last@`), a general inbox
   (`info@`), or a "person" that is a firm. **Then the server reads each
   cited page itself** (`bovCheckPages` → `BOVDESK.pageEmailCheck`), the
   bench's too, and `email_check` says how far to trust what is left:
   `match` (the page shows it, on the page's own domain), `free` (the page
   shows it, free mail), `differs` (the page shows it, another domain),
   `unseen` (the page was read and does NOT show it: probably built from
   the firm's pattern), `unchecked` (the page could not be read: 404,
   refused, timed out, a bot-walled portal, no page given), `manual` (the
   owner typed it), `none`. A failure of any kind lands on `unchecked`,
   never `match`. When the search returned no address but the person's page
   shows one in a personal shape (`kcasey@`, `kevin.casey@`; never a bare
   `casey@`, which could be a family-named firm's inbox, and never one of
   two), that address is copied off the page (`personalAddress`). The desk
   shows the check and the page it came from beside every address, and
   "Send all" leaves `unseen` and `unchecked` drafts to be sent one at a
   time.

   **Why (2026-11-21, the first live run, 982 Warwick Ave):** the search
   returned `mfair@hayessherry.com` and `dlucivero@hayessherry.com`, cited a
   404 PDF and a 404 team page, and the firm's real team page lists both men
   with no email for anyone; neither address appears anywhere public. The
   old check compared only domains, so both were `match` ("on the firm's own
   site"), the one label autopilot sends unread. The same run returned Kevin
   Casey with no email though his own bio page shows `kcasey@sreari.com`.
   The prompt already forbade a built address; a prompt is not a guarantee.

   The page is fetched through `fetchSite` (the logo import's: DNS-resolved
   and private addresses refused on every redirect hop, 6 s a hop, 1 MB
   cap), all pages in parallel inside `BOV_PAGE_BUDGET_MS` (10 s); a page not
   back by then is `unchecked`. Bot-walled hosts (`link-check.js`
   `BLOCKED_HOSTS`) are not fetched. `BOV_PAGE_ORIGIN` is TEST-ONLY: it
   serves `https://<host><path>` from a stub on loopback, alongside
   `LOGO_IMPORT_ALLOW_PRIVATE`. `email_check` has no check constraint in
   migration 065, so the two new values needed no migration.
7. **We connect; we are not a brokerage.** Every email says so and says the
   estimate is automated, not an appraisal. Nothing says "licensed" about a
   broker a search found: nobody checked. The owner reads each candidate
   before anything goes, which is the check.
8. **The link's GET only shows the offer.** Mail scanners and link previews
   fetch every URL in an email; a GET that accepted would introduce a
   stranger's phone number to a broker who never opened the mail. The POST
   acts. The token is an HMAC of the match id keyed on
   `SUPABASE_SERVICE_KEY` (the digest unsubscribe link's design,
   domain-separated).
9. **One introduction per request, by a filter.** `bovClaim` PATCHes
   `bov_requests` with `introduced_match_id=is.null` in the filter, so of
   two brokers accepting at once one matches a row and the other matches
   none and is told it is taken. The owner's own Introduce on the desk may
   override (`force`).
10. **Mark after the send.** A draft is marked sent, and a match introduced,
    only once the mail provider took it. A refusal leaves the row as it was
    and says so. If an accepted broker cannot be introduced on the spot
    (outbound mail off, or the provider refused), the request stays theirs,
    they are told the introduction is coming, and the owner is told to make
    it.
11. **DB-only.** No file fallback (never-break rule 4): these rows are a
    work queue holding strangers' contact details, and Render's disk is
    erased on every deploy.
12. **Nothing a stranger typed or a search returned reaches the desk as
    markup.** `createElement` and `textContent` throughout (a test fails on
    `innerHTML`), and a link's href is used only when it starts with http.

## Autopilot (`BOV_AUTOPILOT=on`)

Off by default. On, a draft may go with nobody reading it, behind four
gates. Failing any of them only means the draft waits on the desk:

- **The address was proven by its page** (`email_check === "match"`,
  `canAutoSend`): the server read the cited page and it shows that address,
  on its own domain. A free-mail, off-domain, `unseen` or `unchecked`
  address waits for a person.
- **The request's own text looks like an address and a name**
  (`autopilotSafe`). The lead form is public, and with autopilot on its text
  is mailed to a stranger under the owner's name: the address in the
  outreach, the name and company in the introduction. Anything with the
  shape of a link, markup, or a sentence holds the whole request.
- **That broker has not been mailed in `AUTOPILOT_REST_DAYS` (14).** The
  bench reuses a market's brokers, so without this fifty fake requests would
  be fifty emails to the same five people.
- **`AUTOPILOT_PER_DAY` (12)** unread sends a UTC day, in memory.

An unread send uses the plain sentence, never the search's own clause about
the broker (`plain: true`), because nobody read that clause.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `BOV_AUTOMATION` | on | a stored BOV request starts the desk on its own; `off` is the rollback (the lead route as it was before 2026-11-20; the desk still works by hand) |
| `BOV_AUTOPILOT` | off | send drafts without waiting for the owner, behind the four gates above |
| `BOV_FROM` | unset | who BOV mail is from, e.g. `Name <name@compninja.co>`; replies go there. Unset: `EMAIL_FROM`, replies to `LEAD_NOTIFY_EMAIL`. The address must be on the domain verified in Resend |
| `BOV_DAILY_SEARCHES` | 20 | broker searches per UTC day, in memory (the lead form is public) |

`EMAIL_FROM` stays the single gate for outbound mail. Without it nothing
here sends: the desk still drafts, each draft has "Open in Gmail" (a
prefilled compose window pinned to the sending account) and "Mark as sent",
and Introduce hands the owner the introduction the same way.

`test/helpers/boot.js` sets `BOV_AUTOMATION=off` for every suite but
`test/bov-desk-run.test.js`, the wider search's rule and for its reason: on,
every suite that posts a BOV lead would start a provider call.

## What has NOT been measured

**The search prompt has been run live once** (2026-11-21, Warwick RI,
Office): of four brokers, two addresses were on the person's own bio page,
two were built from a pattern (see rule 6), one address on a bio page was
missed, and two of the cited pages were 404s. One run is not a rate. The
page check is tested against stubbed pages, never against the live firm
sites, and its log line (`BOV page check: N page(s), N read · N address(es)
not on their page · N unchecked · N read off the page`) is where real
evidence about it accumulates. That is why the default is that a person reads each candidate
(with the page it came from one click away) before anything is sent, and why
turning autopilot on should wait for a few real requests' worth of evidence.
`bov_search` analytics events (`source`: `found:N`, `unreadable`,
`failed:<status>`, `timeout`) are where that evidence accumulates.

## Not built

- Reading a broker's REPLY. A broker who answers by email instead of with
  the link is introduced from the desk by hand (one press). Inbound mail is
  not parsed.
- A reminder when nobody answers. No timer, by rule; the desk shows how long
  each email has been out.
- Verifying a license. The site promises the owner a licensed local broker,
  and today that promise is kept by the owner reading each candidate.
