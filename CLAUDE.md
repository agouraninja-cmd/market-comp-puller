# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A commercial real estate comp + valuation tool, branded **CompNinja** (the
owner's independent brand — it previously carried Adler Industrial branding;
do not reintroduce Adler anywhere). A user enters a property address + type;
the server asks Claude (with web search) for recent comparable sales/leases
and returns one unified report that both answers and proves: a "What This
Building Is Worth" value hero (the building's SF is looked up from public
records when not entered), a plain-English market summary, a "What's Driving
Prices Here" card (model-supplied `value_drivers` + `market_trend`), a market
position chart, a comp map, and the full sortable comp table with per-comp
source-confidence badges (Verified / Public record / Listing / News /
Estimate). There is deliberately **no mode toggle** — an earlier owner-mode /
comps-mode split was merged (commit 87095aa); `#owner` survives only as a
deep link that pre-opens the property-details section. The hero carries a
"Get a free Broker Opinion of Value" button — the site's lead funnel; those
leads are stored with `source: "bov"` (vs `"export"` for export unlocks).
The front-end is a single HTML file plus one shared script it depends on at
runtime, **`valuation.js`** (the value-range math, extracted so the browser
and the accuracy backtest run one copy of it — see "Non-obvious flows" and
the Restart rule below); a small Node proxy holds the API key so the browser
never sees it. The public contact email across the site is
info@compninja.co. The owner is not a licensed broker: site copy must say
we "connect you with a local broker", never that we are one, and every
valuation is labeled an automated estimate, never an appraisal. That rule
reaches the DATA too, not just the copy: publishing a vault comp earns the
green "Verified · via \<name\>" badge, which means "a named broker vouched
for this deal", so **the owner does not publish** (decided 2026-08-12) and
the standing plan is to refuse `POST /api/vault/publish` without a license
on the broker profile — see docs/ROADMAP.md's "Next" for the decision and
the alternatives already rejected.

There is no build step, no linter, and **no npm dependencies** — it runs on
plain Node (uses the built-in `fetch`, so **Node 18+ is required**).

There is one small test suite: `npm test` (`node --test`, no dependencies)
covers the nine pure modules — **`entitlements.js`** (the Pro tier's
decision table), **`comp-gate.js`**, **`stripe.js`**, **`broker-vault.js`**,
**`corpus-audit.js`**, **`blend-corpus.js`** (saved deals within 10 miles
join the report at serialization, before the paywall), **`broker-leads.js`** (the broker lead inbox's
rules: coverage matching, lead anonymization allowlist, coverage seeding,
notify dedupe), **`valuation.js`** (the value-range math shared by the
browser and the accuracy backtest — the one pure module here that loads in a
browser too, via a dual Node/global export), **`backtest.js`** (the
hold-one-out accuracy scorer built on it, requiring nothing but
`valuation.js`) and **`branding.js`** (report branding's decision table: what
mark a render uses, and the rule that a shared report is decided entirely by
its own snapshot) and **`watchlist-digest.js`** (the digest's copy and its
"is this worth sending?" rule — the only email this product sends on its own
initiative, so every judgment in it is about what a person is worth
interrupting for) — plus **`report-access.js`** (the ONLY function that
decides who may read a shared report: an unrecognized `visibility` is
treated as invited, never public) and **`test/routes.test.js`**, which boots a real
server twice as a child process to prove the gates are actually WIRED to the
routes and not merely correct in isolation (320 tests on 2026-08-06). The
count moves whenever a module is added, and this line has already lagged
twice, so trust `npm test`'s own summary over the number written here.
Nothing needs a real database or a real mail provider, only the route-level
files start a server, nothing calls anything external, and the whole run
finishes in a couple of seconds, so there is
no excuse for not running it after touching any of those rules.
**`test/helpers/fake-supabase.js`** is how the second half of that stays true
(2026-08-13): a stand-in PostgREST + Resend that lets a suite exercise the
paths which exist ONLY with a database. Most of this app degrades to a local
JSON file when Supabase is unconfigured, which is what makes the rest of the
suite free — but the features that deliberately have NO file fallback (the
vault, permissioned shares, the watchlist digest) are exactly the ones where a
mistake costs a broker their book or mails a stranger twice, and before this
they could only be tested up to "it refuses without a database".
`test/watchlist-digest-run.test.js` is the first user. Two rules: the fake
implements only the query shapes server.js actually sends and **400s on
anything else rather than matching everything** (a fake that matches
everything reports a user-scoped read as working while it returns another
account's rows); and it is a stand-in, not a Postgres, so a new query shape
means teaching it that shape deliberately, never loosening its parser.
Nothing beyond those modules and that route wiring is tested; do not assume a
green suite means the app works. CI (`.github/workflows/ci.yml`) runs on
every push: `node --check` on
the entry points, the test suite, and a bare-environment boot smoke against
`/healthz` — advisory on GitHub, but since 2026-08-08 the same checks also
gate the deploy itself: `npm start` runs a `prestart` script (`node --check
server.js && npm test`), so on Render a red build exits before the server
listens and the previous green deploy keeps serving. That gate holds even
when Actions is down. A red X on
GitHub Actions still means fix or revert now. **No result at all is not the same as
green**, and it happens: during a 7-hour Actions incident on 2026-08-06 GitHub
throttled webhooks to ~15% and four branches merged with no CI run ever
created. So the workflow also carries **`workflow_dispatch`** — a "Run
workflow" button on any branch, which is a direct API call rather than a
webhook delivery and therefore still works when pushes are being dropped. Use
it to get a verdict on a commit already on main without pushing an empty commit
to manufacture a webhook. The four checks can also be run locally in about two
seconds; that is what to do when Actions is down, rather than assuming.

The one build-*ish* artifact is **`tailwind.css`**: a vendored, pre-generated
Tailwind build (checked in, served by `server.js`) that replaced the Play CDN.
A Claude Code hook (`.claude/hooks/regen-tailwind.js`) regenerates it when
`index.html` is edited in a session — do not also regen manually; outside a
session, the manual command is under "Restart rule". Either way, verify a NEW
utility class actually landed in the vendored file and commit it alongside.

## Running it

```bash
npm start          # prestart runs the checks (~2s), then node server.js -> http://localhost:3000
```

`npm start` first runs `prestart` (`node --check server.js && npm test`, about
two seconds) and refuses to boot on a failure — that is the production deploy
gate (Render's start command is `npm start`), so do not remove it to save the
two seconds. `npm start` only works if `node` is on PATH. On the owner's Windows machine Node is
a **portable (no-admin) copy**, so it's launched by full path instead:

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" server.js
```

### Restart rule (important)

- Editing **`index.html`** needs no restart — `server.js` reads it from disk on
  every request, so just refresh the browser. That page's one inline
  `<script>` block has a hard runtime dependency on **`/valuation.js`**: its
  very first statement destructures `VALUATION`, so if that file fails to
  load, the destructure throws and the whole front end aborts — no search
  form, no modals, no report rendering — while the page still renders its
  HTML and CSS, so it looks fine and does nothing. `/valuation.js` must never
  be cached stale relative to the HTML that depends on it, which is why it is
  served with `max-age: 0` while every other static asset in `STATIC_FILES`
  caches normally; do not add caching back to it.
- Editing **`server.js`** (e.g. the prompt) **requires restarting the process** —
  it's loaded once at startup. Kill the process listening on port 3000 and
  relaunch.
- Adding **new Tailwind utility classes** to `index.html` requires regenerating
  the vendored **`tailwind.css`** — a class missing from it silently won't
  style. With node on PATH, run from the project root:

  ```powershell
  $env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
  npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o tailwind.css --minify
  ```

  Classes already used anywhere in `index.html` (including inside JS strings)
  are covered; only genuinely new utilities need a regen. Commit the updated
  `tailwind.css` alongside the HTML change.

## Configuration (environment / `.env`)

`server.js` has a tiny built-in `.env` loader, so a local `.env` works without any
dependency. `.env` is git-ignored — never commit it.

- `ANTHROPIC_API_KEY` — **required.** Keep the key on ONE line with nothing after
  it; a stray comment or a smart `—` dash on the same line will corrupt it.
- `APP_PASSWORD` — optional shared password. When set, the front-end shows a lock
  screen and every `/api/comps` call must carry the matching `x-app-password`
  header (checked server-side with a constant-time compare). When unset, the app
  is fully open.
- `LEAD_CAPTURE` — optional `on`/`off`. When on, the CSV/PNG/print exports are
  unlocked by a one-time contact form (the lead-magnet flow). Defaults to ON when
  `APP_PASSWORD` is unset (public deployment) and OFF when it is set (internal).
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — optional pair. When both are set,
  leads are stored durably in a Supabase Postgres table named `leads` (written
  via its REST API with plain fetch — still zero npm deps). When unset, or if a
  DB insert fails, leads append to `leads.jsonl` (git-ignored — contains PII,
  never commit). `GET /api/leads` merges both sources.
- `ADMIN_KEY` — optional. When set, `GET /api/leads` returns the captured leads
  as CSV (send the key via `x-admin-key` header or `?key=`). Unset = that
  endpoint is disabled. Without Supabase configured, leads live only in
  `leads.jsonl`, which ephemeral-filesystem hosts wipe on every redeploy.
  **It is also the admin identity for comped Pro** — see "Admin access" below.
- `TESTER_PASSKEY` — optional shared passkey that comps Pro to a **signed-in**
  account (the beta-tester door). Unset = `POST /api/redeem-passkey` 404s and
  the pricing modal's "Have a code?" row never renders, so this is inert on any
  deployment that never configured it. **It is not `ADMIN_KEY`**: that key also
  unlocks `/admin`, `/dev` and `/contacts`, so it can never be the thing handed
  to testers. Redeeming sets `users.pro_tester` (migration 022), so the grant
  follows the ACCOUNT across devices, survives a passkey rotation, and is
  revoked one tester at a time with a one-row `update users set pro_tester =
  false where email = …` rather than by rotating the code for everyone.
  Rules live in `entitlements.js`, so `npm test` covers them; four of them
  matter. It grants everything Pro **except the broker vault** — the vault is a
  private-data workspace with an upload endpoint, and a passkey shared with a
  wider group is a bigger surface than "try Pro's reports". (The door for
  handing a broker the vault is `VAULT_PASSKEY` / `users.vault_beta` — see
  the next bullet.) It **cannot switch
  a dark deployment on** (`PRO_ENABLED` still wins, same as the admin branch).
  Its `status` is `"tester"`, never `"active"`, so the UI never offers a
  billing portal to an account with no Stripe customer. And unlike the admin
  branch it is **checked as a fallback after the subscription**, not as an
  early short-circuit: a tester who later subscribes gets their real Stripe
  status and their billing portal, and comped access resumes if that
  subscription lapses. A tester is also NOT the `internal` bypass in
  `/api/comps`, which stays header-only.
- `VAULT_PASSKEY` — optional shared passkey that grants the **broker vault**
  (and only the vault) to a signed-in account. It exists because
  `users.vault_beta` was set by hand in the Supabase SQL editor, one broker at
  a time, which put the owner in the loop for every onboarding — "hand three
  brokers a vault at a meeting" was a note-to-self rather than something that
  happened in the room. Redeeming sets the same `users.vault_beta` column
  (migration 023), so everything already true of that grant stays true:
  entitlements gives `broker`/`canUseVault` and **not one Pro report feature**,
  it cannot switch a dark deployment on (`PRO_ENABLED` still wins), it does not
  ride the subscription lapse rules, and revoking is the one-row `update users
  set vault_beta = false where email = …`.
  **It is a SECOND secret, not a widening of `TESTER_PASSKEY`**, and the two
  are independent — either can be set alone. The tester grant excludes the
  vault deliberately (see the bullet above), so folding the vault into that
  code would open a private-data workspace with an upload endpoint to everyone
  ever handed a try-Pro code. Two codes also keep the two audiences separately
  revocable: rotating one does not lock the other out. Setting them to the
  same string is a configuration mistake and the startup banner says so
  loudly (it is not fatal — a rotation closes it).
  **Both codes redeem through the same `POST /api/redeem-passkey` and the same
  input**, because someone handed a code should not also have to know which
  kind it is; the route compares against both secrets and its `granted` array
  names which door opened. The route 404s only when NEITHER is set. One
  behavior deliberately changed to make room for the second code: the
  idempotency check used to run BEFORE the secret compare, so an existing
  tester typing a rotated code was told "already" rather than "incorrect". It
  now runs after (the route cannot know which grant is claimed until it
  compares) and asks whether the account holds *everything this deployment can
  give* — identical behavior on a tester-only deployment, and pinned by tests
  in both shapes.
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
- `DAILY_SEARCH_CAP` — optional (default 150). Hard ceiling on *billed*
  Anthropic searches per UTC day; cache hits don't count. On the (cap+1)th
  search the server returns 429 to visitors and emails the owner once (via the
  same Resend notifier). An in-memory counter reset at UTC midnight and on
  process restart — a backstop against a rotating-IP scraper the per-IP limiter
  can't stop, not precise accounting.
- `ACCOUNT_WALL` — optional `on`/`off`, **default ON** (live since 2026-08-05).
  Makes the app account-only. Since 2026-08-08 a visitor with no `cn_session`
  cookie gets the **landing page rendered at `/` with a 200** (the same
  content `/how-it-works` serves, via `renderHowItWorksHTML({ home: true })`,
  canonical `/`, served no-store because what lives at `/` depends on auth
  state) — NOT the 302 to `/how-it-works` the wall shipped with, which left
  the site's strongest URL a redirect Google never followed (Search Console
  confirmed the target was never crawled). `/desk` still 302s, and since
  2026-08-13 it goes to **`/?auth=signin`** rather than `/`: asking for the
  desk is asking for your own account, and the marketing page answers that by
  telling somebody who already has one to go read about the product. The
  wall's actual rule — a personal workspace never renders anonymously — is
  unchanged, and so are the 302 and the `no-store`; only the destination
  moved, onto a door the wall already exempts. It surfaced when the watchlist
  digest started linking to `/desk` from email, and any future mail that links
  there inherits it. Query strings are still dropped
  (`/desk?checkout=success` lost them under the old target too, and a real
  checkout return carries a session cookie and never reaches this branch).
  Signed-in visitors get the app; `index.html` swaps the search form
  for a signup card (`applySearchLock()`, driven by `/api/config`'s
  `accountWall`). It decides on cookie **presence**, never `getSessionUser()`,
  because that reads the database and this route runs on every page load; the
  real gate is that the wall **forces `GUEST_SEARCH_LIMIT` to 0**, so
  `/api/comps` refuses an anonymous search whatever the browser does. The two
  settings are deliberately not allowed to disagree. Two exemptions:
  `/r/<id>` (shared reports are public by design, and now render with the
  signup card above them) and `/?auth=signup|signin` (the account modal lives
  only in `index.html`, so the signup buttons on the landing page need a door
  that serves the app — note a 200 alone no longer proves which page answered;
  tests discriminate on content). While the wall is on, `/how-it-works` serves
  the same bytes as `/` and **canonicalizes to `/`** (`home: ACCOUNT_WALL`),
  `sitemap.xml` lists `/` and drops `/how-it-works` (listing a self-declared
  duplicate is a Search Console soft error), and the `WebApplication` JSON-LD
  reaches crawlers at `/` itself via the landing render. `off` is the instant
  rollback lever and restores the pre-wall app exactly — `/` serves the app,
  `/how-it-works` reverts to its own canonical and returns to the sitemap,
  and `GUEST_SEARCH_LIMIT` keeps its own configured value; the startup banner
  says which state it is in. Spec in
  `docs/superpowers/specs/2026-08-05-account-wall-and-how-it-works-landing-design.md`
  (predates the 200-at-root change; test/account-wall.test.js pins the
  current contract).
- `GUEST_SEARCH_LIMIT` — optional (default 1, LIVE since 2026-08-03; forced to
  0 while `ACCOUNT_WALL` is on). Free
  report searches per **anonymous** visitor before a free sign-in is required —
  a signup funnel, not a paywall (any account clears it; spec in
  `docs/superpowers/specs/2026-08-03-guest-search-cap-design.md`). `0` = sign-in
  before any search; `off` = gate disabled entirely (the instant rollback lever).
  Tracked two ways, blocked when EITHER fires: the Supabase
  `guest_search_quota` ledger keyed by sha256(IP) (DDL in
  `migrations/011-guest-search-quota.sql` — already run in prod), and the httpOnly
  `cn_guest` cookie set once the quota is spent. **Cache hits count** (the
  funnel is the point); a failed search doesn't consume; admins and
  `x-admin-key` callers bypass. Enforced in `/api/comps` **and
  `/api/explore-market`** (403 + `signin_required: true`, which the client
  turns into the account modal) — the Explorer runs the same billed search
  pipeline as a report, so it spends the same single allowance, but only
  when that search PUBLISHES a page (`published: true`); a thin-data
  preview (`published: false`) does not consume it, because the preview
  lives only in memory behind a 30-minute TTL and dies on redeploy, so
  charging the visitor's one free search for it is the same empty-handed
  outcome as the 422 a thin market already returns. A market
  page that already exists is still served free and ungated above the
  check, since that's a database read, not a search. `/api/config` carries
  `guestSearch: { limit, used }` for the form hint and syncs the cookie the
  SSE exit can't set (its headers are already streaming).
  Fails OPEN on ledger errors — `DAILY_SEARCH_CAP` still backstops spend. Each
  block logs a PII-free `signup_gate` analytics event. The privacy policy's
  cookie section names `cn_guest` and the hashed-IP ledger; keep it in step.
- `GOOGLE_MAPS_API_KEY` — optional; SET on Render since 2026-07-29 (key
  "CompNinja Street View" in the owner's Google Cloud project `compninja`,
  restricted to the Street View Static API only). When set, map pin popups
  show a street-level photo of the building via `GET /api/streetview` (a
  proxy so the key never reaches the browser; Google's free metadata check
  runs first so no-imagery spots cost nothing). Unset = the route 404s and
  popups use the keyless stitched-Esri-tile aerial close-up (`aerialThumb`
  in index.html) — which is also what a Street View 404 swaps in via the
  img's onerror.
  **A pin only gets a photo at all when its OSM building footprint exists
  AND its address starts with a street number AND that street number names a
  whole property rather than one unit of it** (`snapMarkersToBuildings` —
  one batched browser-direct Overpass query per report after pins settle,
  two public endpoints tried in order, cached in localStorage
  `bldgCache.v2`): the footprint is the one signal proving the photo shows
  the property. Geocoded points sit on the street centerline, so every
  unsnapped aiming strategy (raw point, Google address geocode) produced
  photos of roads/trees on rural reports — owner's rule is "the actual
  property or nothing," so no footprint = text-only popup. The street-
  number gate exists because submarket-estimate comps ("Financial District
  (general submarket estimate)") geocode to a district point and several
  snapped onto the SAME building — one Boston report showed one white
  column three times. It is deliberately NOT the shape-lenient
  `isAggregateAddress()` in server.js, which protects corpus DATA where
  numberless comps are still valid rows.
  Two further gates, both added 2026-08-13 after a Boise mobile-home report
  photographed a bike shop 81 m up the street (same incident as the $795,000
  valuation — see flow 3 under "Non-obvious flows"). **The footprint must
  PROVE the address** (`addr:housenumber` + `addr:street`, via the existing
  `osmNumberMatches`/`streetLooksSame` written for the type detector's
  Phoenix "Mandarin Super Buffet" bug): proximity cannot tell two sides of a
  street apart, let alone a shop from the trailer park beside it. Where
  NOTHING in range carries a house number the map cannot answer and the
  main-mass pick stands, so coverage holds in the suburbs where photos work.
  Among several footprints that all prove the address (one building mapped
  in parts) it still takes the main mass — a photo of the wrong wing is
  still a photo of the right building, which is why this is the PHOTO's rule
  and not the size estimate's. **And `unitDesignatorOf()` refuses outright**
  for an address naming one unit of a site (`Trailer 51`, `Apt 3B`, `SPC 12`,
  `#45`): geocoders silently drop the unit — Census answered "6728 W
  Fairview Ave Trailer 51" with "6728 FAIRVIEW AVE" — so no footprint at
  that point is provably the subject's, and 38 of them shared that number.
  It gates comps too, because the model returns unit addresses of its own.
  Its vocabulary is tested in both directions (`test/index-html.test.js`):
  loosened, wrong buildings return; tightened, ordinary streets lose their
  photos, and "Roomy", "Lotus" and "United Nations" all parsed as unit
  designators on the first pass.
  `bldgCache` went to **v2** with these: the snap now depends on the
  ADDRESS, not just the pin, so a key of coordinates alone held one answer
  for every unit of a park — and the bump retires the wrong-building snaps
  already sitting in browsers, the same reason `geoCache` went to v2.
  Spend guardrails: Google Maps API quotas are NO LONGER user-adjustable
  (the spec's 500/day quota-cap step is obsolete) — the backstops are the
  "CompNinja Street View cap" $5/month budget alert on the billing account
  (emails the owner at 50/90/100%), the route's per-IP rate limit, and the
  10k-photos/month free tier (a fully-hovered report uses ~6).
- `STREAM_ANTHROPIC` — optional `on`/`off`, **default ON**. Streams the
  Anthropic call (`stream: true` + a hand-rolled SSE reader, `sseFrames` in
  server.js) instead of awaiting one JSON body. The parsed report is identical
  either way — the streaming branch rebuilds the text by concatenating
  `text_delta`s per block index and joining with `"\n"`, deliberately matching
  the non-streaming `content.filter(type==="text").map(.text).join("\n")` so
  `parseCompJson` sees the same input. Set it to `off` only to rule streaming
  out while debugging. **Careful if you touch the timeout**: with `stream:true`
  `fetch` resolves at the HEADERS, so `clearTimeout` must stay wrapped around
  the whole read loop or the call deadline silently stops guarding anything.
  The deadline is DERIVED per call (`searchTimeoutMsFor`: 30s slack + 10s per
  allowed search + 13ms per allowed output token — ~260s for a full 10-search
  10k-token report) so it always sits above the wall clock of a healthy call;
  a fixed constant was outgrown twice (100s, then 150s), and each time it
  aborted alive, already-billed calls into "took too long" errors.
  There is also a `STREAM_IDLE_MS` (30s) per-chunk watchdog, which only becomes
  possible once the response is streamed.
- **Live search progress** (no env var — always on for the browser). `POST
  /api/comps` **and `POST /api/explore-market`** take an optional `stream:
  true` in the body; when set, and only once the slow leg is actually about
  to run, the response switches to
  `text/event-stream` (`openSse` in server.js) emitting `progress` events then
  a final `result` (or `error`) event. **Everything fast or failed stays plain
  JSON with a real status code** — the password gate, both rate limiters,
  validation, and a 43ms cache hit — so the client chooses how to read the body
  from the response's `content-type`, *never* from the fact that it asked to
  stream. `gen-market-seed.js` simply omits the flag and is unaffected.
  Progress phases: `corpus` (coverage, before the call), `start`, `search`
  (n + the model's real query text), `results` (count), `writing`, `drafting`
  (chars, ~1/s), `comp` (one per finished comp as the model writes the array —
  `makeCompExtractor` in server.js scans the streamed text incrementally, and
  the handler's `guardComp` closure anonymizes events past the visitor's
  `maxComps` entitlement to `{ locked: true }` so gated comp identities never
  reach a free browser, even transiently), `retry`. Front-end:
  `readProgressStream` + `applyProgress` in index.html. Since 2026-08-09 the
  streamed events assemble the REAL report surfaces (`beginAssembly` /
  `assemblyComp` / `assemblySummary` / `resetAssembly`): the first `comp` or
  summary `field` event reveals `#results` with only the `data-assemble` cards
  visible (hero as a counts-only placeholder, never a dollar figure; summary;
  core-column comp table + "+ N more found · unlock with Pro" lock line),
  everything else hidden under `.asm-hidden` until `renderResults` repaints
  wholesale.
  Assembly never touches the `hidden` class except on
  `#results`/`#ownerHero`/`#loadingSkeletons`;
  every exit (result, error, `retry`) funnels through `resetAssembly` riding on
  `hideLoadingCard`. Three fallback layers, all
  load-bearing — the old wall-clock simulation still starts on submit and is
  cancelled by the first real event; a non-SSE content-type falls back to
  `res.json()`; and an 8-second silence watchdog restarts the simulation,
  which is what saves the card if Render's edge buffers the stream despite
  `x-accel-buffering: no`.
  **What the measurement showed** (worth knowing before optimizing anything
  here): the web searches finish in the first ~5 seconds; the model then spends
  **40-70 seconds writing the report**. Wall clock is roughly
  `4s x searches + output_tokens / 78`. Cutting *searches* therefore buys far
  less than it looks like it should — a corpus-strong 2-search run still took
  74s because it still had to write 4,700 tokens. **The lever is OUTPUT size.**
  Measured composition of a report: the `comps` array is 69-76% of it, and
  within that `notes` was by far the largest field (18-28% of the whole
  report, up to 466 chars on one comp), followed by `source_url` (~8-11%,
  not cuttable — it is the proof). Top-level, the four narrative fields
  (`summary`, `value_drivers`, `market_trend`, `price_discovery.note`)
  measured a combined 33% of one real report and got the same notes-style
  caps on 2026-08-03 (~450 chars / 80-per-entry / 140 / 200, banned
  patterns named, the summary's REQUIRED honesty caveats given a protected
  third-sentence slot — don't tighten further without protecting them
  again). Verified same day: summary 941 → 559, report 13% shorter.
  The comps array itself got compact encoding the same day: the model
  writes 1-3 char keys (`SHORT_COMP_KEYS`) and omits empty fields;
  `expandCompKeys` restores the long-keyed, ""-backfilled shape at parse
  time, so only the MODEL OUTPUT is smaller — every stored and served
  report keeps the classic shape. A new comp field needs a short key too
  (the add-comp-field skill has the step). Measured with caps + encoding
  together: a 7-comp report fell from 6,111 to 3,111 output tokens.
  `notes` is now capped in the prompt at two short sentences with the two
  real sources of bloat banned by name — the model narrating its own search
  ("Included as the nearest comparable found; details require CoStar") and
  restating fields that have their own columns. Result: average note
  139 → 104 chars, longest 188 → 115, report 13% shorter, price caveats
  preserved and promoted. Keep `max_tokens` generous — the cap is a quality
  instruction, and a low `max_tokens` would truncate the JSON mid-array
  instead.
  The Explorer reaches the same rule from the other side: its cache lookup
  lives inside the shared in-flight job, so it cannot decide up front whether
  the request is fast. Its SSE opens on the FIRST progress event instead, and
  a cache hit (which emits nothing) therefore answers as plain JSON with no
  special-casing. `exploreInFlight` carries a listener set and a bounded
  replay log so two visitors sharing one billed search both see it.
- `PARALLEL_SEARCH` — optional `on`/`off`, **default OFF**. When on, a report
  search that would run a 6+ search budget is split into two CONCURRENT
  Anthropic calls (`LANE_GUIDANCE` in server.js): a `primary` lane that starts
  from brokerage/listing sources and owns every market-level figure and all
  narrative, plus a `records` lane that starts from news/press/public records,
  returns comps + the subject-size lookup only, and is folded in by
  `mergeLaneReports` (address-normalized dedupe, interleaved so the slice to
  `maxComps` can't drop one lane's provenance wholesale, currency-mismatch
  guard). The records lane is additive and never retried — if it fails the
  report still renders from the primary lane.
  **Why it is off**: measured 2026-07-30 against a same-address control
  (Indianapolis Industrial), the split ran 81.7s → 47.0s (42% faster) but
  returned 3 comps instead of 4; on a dense market (Dallas) it returned a
  healthy 8 comps with a better provenance mix but saved almost no time,
  because wall clock is the SLOWER lane. A single deep call steers its later
  searches at the gaps it knows it still has; two shallow lanes rediscover
  the same easy comps. Re-measure on real traffic before flipping it on.
  Each search logs `Anthropic call [lane]: Ns · N search(es) · N out / N in
  tokens`, which is how any of this gets re-measured.
- `SITE_URL` — optional. Public URL used in `robots.txt`/`sitemap.xml`; defaults
  to the Render URL. index.html's canonical/`og:url`/JSON-LD tags are written
  against the default origin and rewritten to `SITE_URL` at serve time, so
  moving to a custom domain is a single env change — no HTML edits.
- `GOOGLE_SITE_VERIFICATION` — optional. The token from Google Search Console's
  **HTML file** verification method; accepts the whole `google<token>.html`
  filename or the bare token. Set, the server answers that exact path with the
  line Google expects and logs the live path at startup; unset, the route does
  not exist. **The file method, not the meta tag, on purpose**: meta-tag
  verification fetches the property root, and when this shipped `/` was a 302
  under `ACCOUNT_WALL`, so a tag placed there was never seen and verification
  failed with no stated reason. `/` answers 200 now (the landing page), but
  the file method stays — it is auth-independent by construction and Google
  re-checks it forever, so it must never ride on what `/` happens to serve.
  This path is its own route and the wall never touches
  it (the static handler is an allowlist). A DNS TXT record reaches the same
  place and is better where there is registrar access — it covers every
  subdomain and survives any redirect; the two do not conflict. **Keep the var
  set for good** — Google re-fetches the file and unverifies the property if it
  stops answering. Search Console is the only view of whether the ~38 market
  pages in `sitemap.xml` are indexed at all; `analytics_events` only ever sees
  people who already arrived.
- `PRO_ENABLED` — optional `on`/`off`, **default OFF**. Master switch for the
  paid Pro tier. Off means the app behaves exactly as it did before the tier
  existed: no comp gating, no export cap, no lookback limit
  (`computeEntitlements`' `enabled: false` branch returns
  `maxComps: "all"` / `exportsRemaining: "unlimited"` and skips every billing
  read, so the flag costs nothing on the hot path). **Do not turn this on
  before running the Pro DDL** in `migrations/008-pro-billing.sql`
  — and note the billing tables have **no file fallback** by
  design, so `PRO_ENABLED=on` without Supabase configured resolves every
  visitor to the free tier and logs a `⛔` line at startup.
- `PRO_AUDIENCE` — optional comma-separated email allowlist narrowing **who**
  `PRO_ENABLED` applies to. Unset (the launch setting) means everyone. Set, it
  means only those *signed-in* accounts are gated and only they can reach
  `/api/checkout` and `/api/billing-portal`; every other visitor, anonymous
  included, takes `computeEntitlements`' `enabled: false` branch and sees the
  pre-Pro app. It exists so the paid tier can be proven against the live
  deployment without gating real traffic or exposing a test-mode checkout — the
  Stripe test card numbers are public, so an open test window lets a stranger
  take a genuine subscription row for free. Three rules: `PRO_ENABLED` is still
  the master switch (`proEnabledFor()` is the AND of both); the **webhook is
  deliberately not audience-scoped** (it has no user and must keep writing rows
  or a test proves nothing); and **unsetting it is the launch** — left set, the
  product is live but unbuyable and the deployment looks perfectly healthy,
  which is why startup logs it loudly. Rules live in `entitlements.js`
  (`parseAudience` / `inAudience`), so `npm test` covers them.
- `SEARCH_PROVIDER` — optional `gemini` (**default since 2026-08-10**) or `anthropic`. Picks which
  vendor runs the comp search. An unrecognized value **exits at boot** rather
  than silently falling back, the same no-fallthrough rule `/api/checkout`'s
  `PLANS` map follows. `MODEL` still overrides the chosen provider's default
  model, so existing `MODEL=` deployments are unaffected. Gemini authenticates
  with `GEMINI_API_KEY` and needs a **paid-tier** Google project: search
  grounding 429s on the free tier, and the error names no project. Gemini
  cannot cap its search rounds (`google_search` takes no `max_uses`), so
  corpus-first retrieval remains a quality lever there but stops being a cost
  lever. Server code must branch on `PROVIDER.capabilities.*`, never on
  `PROVIDER.name`.
  **`GET /healthz` reports the live `provider` AND `model`** — ask the
  deployment, never the repo. `MODEL` is read once at startup from an env var
  nobody can see from here, and a provider's `defaultModel` moves with the
  code, so a checkout only proves what the source says. The Gemini default is
  `gemini-3.7-flash` (moved from 3.6 on 2026-08-13). Rollback is
  `SEARCH_PROVIDER=anthropic` or `MODEL=gemini-3.6-flash`.
- `PORT` — defaults to 3000. Hosts set this themselves.

### Admin access — comped Pro for the team

There is **no admin user** in this codebase: `ADMIN_KEY` is a shared secret
typed into `/admin`, `/dev` and `/contacts`, and `users` has no `is_admin`
column. So "is this an admin?" is answered by **possession of that key**, which
`isAdminRequest(req)` reads two ways:

1. the **`x-admin-key` header** — how machine callers have always identified
   themselves (`gen-market-seed.js`, the dashboards' own fetches); and
2. the **`cn_admin` cookie** — how a browser carries it. The dashboards keep the
   key in `sessionStorage`, which is scoped to **one tab**; `POST
   /api/admin-access` trades the key for this cookie, and all four dashboards
   (`/hq`, `/admin`, `/dev`, `/contacts`) call it (`grantAdminAccess()`) the
   moment their own key check passes. Since 2026-08-04 **every dashboard
   endpoint accepts the cookie** (via `isAdminRequest`) as an alternative to
   the header, so a new tab within the 30-day cookie window opens unlocked
   without retyping the key — each page's loader silently tries a keyless
   fetch before showing the gate. In a cookie session `/hq`'s CSV links are
   plain hrefs (the cookie rides along); `?key=` survives on the CSV routes
   and `/api/stats`/`/api/admin/submissions` for machine callers only.

The cookie is **not the key**: it is `<expiry ms>.<HMAC-SHA256(expiry,
ADMIN_KEY)>`, httpOnly, 30 days. It cannot be turned back into the key, and
rotating `ADMIN_KEY` invalidates every cookie ever issued. `index.html` never
holds a secret to get Pro.

Four rules, all in `entitlements.js` and covered by `npm test`:

- **It requires a signed-in account.** A key identifies a machine, not a person,
  and the rule is that admins get Pro *when they sign in*. An anonymous request
  holding the key takes the ordinary free path.
- **It cannot switch a dark deployment on.** `getEntitlements` only takes the
  admin branch when `proEnabledFor(user)` is true, so `PRO_ENABLED=off` still
  means the pre-Pro app for everyone, staff included.
- **`status` is `"admin"`, never `"active"`.** The UI decides whether to offer
  the Stripe billing portal off `status !== "none"`; reporting a Stripe status
  would send a comped account to a portal that 400s. `/api/config` also carries
  `pro.admin` so the plan card can say "Pro — comped (team)".
- **It is NOT the `internal` bypass.** `/api/comps` has its own header-only
  `internal` check that skips comp gating, the lookback clamp and the daily
  search cap for the seed generator. That stays header-only on purpose — a
  cookie must never widen a bypass a browser was not meant to have.

`POST /api/admin-access {clear:true}` drops it again, which is what the "View as
a free user" button on the plan card does. Keep that button working: the team is
permanently on the far side of the paywall, so it is the only way anyone
internal ever renders one.

This is not the only comped-Pro door: `TESTER_PASSKEY` (above) comps Pro to a
signed-in account without any dashboard access, and stores the grant on the
user row rather than in a cookie. Admin wins outright and skips the billing
reads; a tester deliberately yields to a real subscription.

There is also one comped-VAULT door, **`users.vault_beta`** (migration 023,
2026-08-11) — the broker-onboarding grant. It exists because neither existing
door could ever be handed to a real broker: the tester passkey deliberately
excludes the vault, and `ADMIN_KEY` also unlocks the dashboards. Rules in
`entitlements.js`, covered by `npm test`, and deliberately narrow: it grants
the broker surfaces only (vault, lead inbox, blended comps —
`broker`/`canUseVault`), never Pro's report features; it cannot switch a dark
deployment on (`PRO_ENABLED` still wins); and unlike everything else
vault-shaped it does NOT ride the subscription lapse rules — the grant was
never billing, so only the one-row UPDATE revokes it, and a beta broker whose
trial subscription lapses keeps their book.

**Two ways to set it**, and the column is the same either way:

1. by hand, `update users set vault_beta = true where email = …` — still the
   right tool for one specific account, and the only tool for revoking; and
2. **`VAULT_PASSKEY`** (2026-08-13), a shared code the broker redeems
   themselves at `POST /api/redeem-passkey`. This is the one to reach for
   when access is being handed out in person: the SQL path made every
   onboarding wait on the owner opening the SQL editor later, which is the
   wrong shape for the channel the product actually grows through. See the
   `VAULT_PASSKEY` bullet under Configuration for why it is a separate secret
   from `TESTER_PASSKEY` and what changed about the redeem route's
   idempotency ordering to fit two codes on one input.

`MODEL` is set in `server.js`, overridable by a `MODEL` environment variable (unset in production, so the constant is the live value). If the API returns a
404 for the model, list available models via `GET https://api.anthropic.com/v1/models`
with the key and update the constant — an earlier model ID was retired.

**Measuring a model or prompt change** (2026-08-09, contamination doors closed and a database refusal added 2026-08-10). `run-eval.js` puts the 12 fixed targets in `eval-set.json` through real searches and scores each report with the pure, tested `eval-score.js` (priced sale comps and whether a valuation was possible at all, provenance weighted with `valuation.js`'s own `TIER_WEIGHT`, aggregate-address and out-of-window and off-market rates, narrative lengths against the 2026-08-03 caps, wall clock). It is a SCORECARD, not an assertion suite: nothing has a pass/fail threshold, because a dozen stochastic searches are noisy, and the product is `--compare` between two runs. Summaries land in `docs/evals/`, timestamped in the filename so a same-day, same-label rerun can never silently clobber a possibly-good baseline (committed, so history accumulates); raw reports go to the git-ignored `eval-runs/`. Several things make it trustworthy and must not be undone. The run sends `fresh: true`, an internal-only flag that skips BOTH cache read paths (the exact hit and the derivable-window one), because a cached report would score the model that wrote it and report a false "no difference". Before every run the runner also wipes two local files and records both in the summary: `comp-corpus.jsonl` (`corpusWiped`), because `corpusRowsForMarket` reads that file fallback even with no database configured, so a previous run's harvest would otherwise hand the next run corpus coverage and a smaller search budget; and `subject-sizes.json` (`subjectSizesWiped`), because no eval target supplies `subjectSizeSqft`, so a previous run's building-size lookup would otherwise be found by `findKnownSubjectSize`, again shrinking the search budget and also silently backfilling `subject_size_sqft` regardless of what the run's own model did. The subject-size wipe is not the whole fix: `findKnownSubjectSize` also keeps an in-memory `subjectSizesMem` Map that a file delete cannot clear, so **the server must be restarted, not just have its files wiped, between two runs that are being compared** (the corpus read hits disk on every call with no in-memory layer, so it does not need this). A model comparison already forces a restart because `MODEL` is read once at server startup; this restart rule mainly matters for an A/A run pair meant to measure noise, where nothing else would force one. Before spending anything, the runner also probes the target with `GET /api/stats` (the admin key) and reads `introRequests.db`: a confirmed `true`, a failed probe, or the field simply missing all refuse the run and name the risk, because isolation (`SUPABASE_URL` blank on the server under test) is enforced only by however that server was launched, and a database the runner can see is a database it would both write into and read stale corpus coverage from; only a confirmed `false` proceeds. `EVAL_SKIP_DB_CHECK=1` is the deliberate override for someone who has already verified the database really is disposable. And the runner must target a server started from a separate worktree with `SUPABASE_URL` blank, so every write lands in that worktree's own fallback files instead of production's corpus, market pages, and cache: on Windows this is a documented trap, because in PowerShell `$env:SUPABASE_URL = ""` DELETES the variable rather than emptying it, so server.js's `.env` loader (which only fills vars that are `undefined`) silently restores whatever the worktree's own `.env` holds. Copy ONLY the `ANTHROPIC_API_KEY` line into the eval worktree's `.env`, never the whole file, and prefer a `node -e` launcher that sets `process.env.SUPABASE_URL = ""` (and `SUPABASE_SERVICE_KEY`) explicitly before requiring `./server.js`. A full run costs about $4.30, a model comparison about $8.60. The accuracy backtest (`/api/accuracy`) is the other half of the picture and answers a different question: it scores the reconciliation math over comps already harvested, never what a search found.

## Architecture

```
Browser (index.html)  --POST /api/comps-->  server.js  -->  Anthropic Messages API
        ^                                       |              (+ web_search tool)
        +-------------- JSON comps --------------+
```

**`server.js`** — zero-dependency Node HTTP server. Routes:
- `POST /api/comps` — the core endpoint. Enforces the password gate (if set),
  builds the prompt, calls Anthropic with the `web_search` tool enabled, and
  returns parsed JSON. Body takes optional `maxComps` (allowed 4/6/8/10/12,
  default 12 — the Explorer/seed pipeline stays pinned at 8) and optional
  `subjectSizeSqft`; when absent the prompt also asks the model to look up
  the building's size (returned as `subject_size_sqft` +
  `subject_size_source`) and `max_uses` rises 8 → 10 to budget the lookup
  (6 → 8 for a ≤8-comp ask). Body also takes optional `subjectDetails` — the per-type
  facts about the user's own building (see flow 4), whitelisted by
  `sanitizeSubjectDetails` against that type's `TYPE_COMP_FIELDS` keys and
  shown to the model so comp selection matches the subject. Every response carries `market_cap_rate_range`,
  `value_drivers`, `market_trend`, and a per-comp `source_type` that the
  server normalizes onto its enum (unknown → `estimate`, so badges can
  under-claim provenance but never over-claim). Normalization also ENFORCES
  the prompt's individual-property rule: a comp whose address lacks a
  leading street number, or that names a statistic
  (`isAggregateAddress`), is forced to `estimate` no matter what the model
  claimed — thin markets make the model pad with submarket rows despite
  the prompt telling it not to, and prompt rules are requests while
  normalization is a guarantee.
  **"Verified" is a reserved word (2026-08-10).** It names a badge only the
  server awards (a broker vouched, our team reviewed), so the model must
  never write it. Two layers, the same requests-vs-guarantee split: the
  `verified` field is **only in the comp shape when broker comps were
  actually offered** (`hasVerified` in `buildPrompt`) — with none offered it
  could only ever be false, and asking for it made the model award itself the
  badge, measured live at 4 of 5 comps on a market with zero submissions; and
  `scrubUnearnedVerifiedClaims` (pure, tested, in report-parse.js) rewrites
  the verified word family in `summary`/`value_drivers`/`market_trend`/
  `price_discovery`/comp `notes` whenever the finished report carries no
  verified comp. `enforceVerifiedFlags` always kept the BADGES honest; what
  was broken was that nothing revisited the prose the model wrote around
  them, so a summary described verified comps while every badge read
  Estimate/News/Listing. Three rules: the scrub is **outermost** in
  `finishReport` because it counts the FINAL flags (inside
  `attachVerifiedAttribution` it would read the model's own claims); it fires
  **only at zero** verified comps, since one real badge makes the word
  accurate; and it **rewrites rather than deletes**, because cutting a clause
  can take the summary's required honesty caveat with it. Keep the summary
  rule's own caveat examples free of the word too — they said "scarce
  verified data" and contradicted this rule on the same prompt.
  **Source-link check (2026-08-09).** After the
  report is parsed and normalized, and before the cache write, harvest, market
  snapshot, and the `gate()` funnel, `applySourceLinkCheck` (server.js) checks
  each comp's `source_url`: max 12 unique URLs in parallel under one 2.5s
  budget, HEAD with a GET-on-405 fallback, redirects never followed (one hop
  could steer past the DNS guard; a 3xx counts as live), DNS resolved first and
  private/loopback answers refused (the URLs are model-supplied, so this is an
  SSRF guard, not a nicety). Rules live in the pure, tested **`link-check.js`**:
  bot-walled hosts (loopnet, cityfeet, propertyshark, commercialsearch, costar,
  crexi, zillow, redfin, realtor) are never fetched and never demoted; only
  DNS-gone/404/410 count as dead; a dead-linked comp is demoted to `estimate`
  (dead at birth usually means the citation was never real), keeping its
  `source_url` as the audit trail; broker-`verified` comps are exempt. It runs
  inside `getComps`, so the Explorer inherits it and the served report, cache,
  corpus, and shares all agree; the backtest and corpus retrieval need no
  changes because `estimate` is already excluded from both. Fails open on any
  error. Counts ride a `link_check` analytics event packed into the `source`
  column (the analytics schema is fixed). Link rot on existing corpus rows
  deliberately does nothing; the sweep is deferred (see the spec).
  **Cached**: identical requests
  within a 30-day TTL (7 days until 2026-08-03 — widened as a cost lever) are
  served from the `search_cache` layer (Supabase table
  `search_cache`, keyed by a SHA-256 of address+type+note+window+size+a
  signature of the offered verified comps — so approving a broker comp busts
  the cache for that type — plus a signature of `subjectDetails`, appended only
  when non-empty so pre-existing cache entries keep their keys; in-memory Map +
  file fallback when Supabase is unconfigured). Since 2026-08-08 each DB entry
  also records `address_key` + `prop_type` (nullable columns, migration 020) —
  written by a separate best-effort PATCH after the main insert, never in it
  (an unknown column in the insert would divert the whole cache to the
  ephemeral file, the 004 outage's shape) — feeding the Address Explorer's
  "Instant" badge via `cachedAddressKeys()`; presence-based, failure-safe,
  and an approximation by design (the true hit still needs the exact key).
  A cache hit does NOT call Anthropic and does NOT count against
  `DAILY_SEARCH_CAP`.
- `GET /api/config` — what the front-end needs before it can render:
  `{ authRequired, leadCapture, streetview, pro }`. The `pro` block carries
  this visitor's entitlements (`enabled`, `billing`, `isPro`, `plan`, `status`,
  `maxComps`, `maxLookbackMonths`, `exportsRemaining`, `graceUntil`) so locked
  states need no second round trip. **Presentation only** — every limit in it
  is enforced server-side, so editing the response unlocks nothing but the
  visitor's own greyed-out controls. `billing` is `PRO_ENABLED &&
  STRIPE_CONFIGURED`: the UI needs both, since checkout 503s without Stripe
  keys and a Buy button that can only fail is worse than no button.
- `GET /api/pricing` — the founding-member counter for the pricing modal
  (`{ billing, foundingLeft, foundingLimit }`), deliberately kept OUT of
  `/api/config` because it costs a DB read and `/api/config` runs on every page
  load. Memoized 60s, and refreshed by the webhook when a founding seat sells.
  `foundingLeft: null` means unknown (DB down or unconfigured); checkout treats
  unknown as closed, so the UI hides the founding tile rather than advertise an
  offer that would 409.
- `POST /api/report-access` — "do I own this report yet?", answering
  `{ unlocked, pro }` for the `{ address, type, months }` in the body. Exists
  for the return from a $39 checkout: Stripe redirects the instant the card
  clears, routinely before the webhook writes the purchase row, so the client
  polls this instead of re-running the search and rendering a still-locked
  report at someone who just paid. Deliberately **not** folded into
  `/api/config`, which runs on every page load and would drag a purchase lookup
  along with it, and deliberately **POST** so the address never lands in a URL,
  a log, or a Referer header. Fails CLOSED — an error answers "not yet", which
  makes the client wait, where a false yes would render a locked report as paid.
- `POST /api/login` — validates a password so the UI can confirm before searching.
- `POST /api/lead` — stores a lead-capture submission (name/email/phone/company
  + the searched address/type + `source`: `"export"` for export unlocks,
  `"bov"` for Broker Opinion of Value requests; the Supabase `leads` table has
  a matching `source` column). Also takes an optional `size_sqft`, cleaned by
  `LEADSVC.cleanSizeSqft` and written only when present (a conditional spread,
  so a lead with no size never touches the column — protects the file
  fallback if migration 015 has not run). A durably-stored (`dest === "db"`)
  `bov` lead fires a fire-and-forget alert to every broker covering that
  market + property type: the same four anonymized facts the inbox shows,
  never the owner's name/email/phone/company/address, throttled to one email
  per broker/market/hour (`BROKER_ALERT_SUPPRESS`, `BROKER_ALERT_WINDOW_MS`)
  so a hot market cannot turn one lead into a mail storm. Rate-limited per IP.
- `POST /api/share` — publishes the current report (`{ data, meta }`) under a
  short random id so the visitor can share the link; returns
  `{ id, url, visibility, invited }`. Strips `meta.subject.noi` and
  `meta.assumptions` `debt`/`rentRoll`/`opex` (private finances) before
  storing. Stored in the Supabase `shared_reports` table
  (id/payload/created_at, plus the four columns migration 018 adds — see
  below), in-memory Map + `shared-reports.json` file fallback (the file
  fallback only ever holds the original three columns' worth of data — see
  the permissioned-sharing rules below), **no expiry**. Rate-limited per IP.
  **Permissioned sharing** (v3, 2026-08-06; migration
  `018-report-sharing.sql`, **applied to production 2026-08-06**; spec
  `docs/superpowers/specs/2026-08-06-client-sharing-design.md`). The body
  also takes `visibility` (`"public"`, the default, or `"invited"`) and, for
  an invited share, `viewers` (up to 20 emails) and `includePrivate`. An
  invited share requires a signed-in Pro account and a database — there is
  no file fallback for a viewer list, so `storeSharedReport` **refuses to
  create one without Supabase** rather than silently writing it as an
  ordinary public entry; see the rule below. A public share may never carry
  `includePrivate` (400) — a link anyone can open is the one place a
  broker's private comps must never ride along.
  What a broker's own vault comps become depends on visibility:
  `blend-comps.js`'s `stripPrivateComps()` removes them entirely from a
  public link; `anonymizePrivateComps()` (the invited default) replaces them
  with anonymized `locked_basis` rows — the same shape a free visitor's
  gated comps use — so the client's valuation range matches the broker's to
  the dollar with no address, price, or notes traveling; and the whole
  private comp travels only when the owner explicitly set
  `includePrivate: true` on an invited share **and** their entitlements
  still carry `canUseVault` at share time. Three routes manage an invited
  share afterward: `GET /api/shares` (both "my shares" and "shared with me,"
  in one call, for My Desk), `PUT /api/shares/viewers` (whole-list replace,
  ownership proven by a scoped read before the write, mails only the
  newly-added addresses), and `POST /api/shares/revoke` (one-way — there is
  no un-revoke, matching the vault's stance that access lapsing is safer
  than access silently returning).
  **Three rules a future editor will otherwise break:**
  - **The ACL is never cached.** `sharedReportsMem` caches a share's
    *payload* for the life of the process — right for a report body, and
    catastrophic for an access rule. `getShareRecord()` re-reads
    `visibility`, `revoked_at`, and the viewer list from the database on
    every single call, so a revoked link stops working immediately rather
    than at the next deploy. Never let a share's access decision ride on the
    memoized payload.
  - **An unrecognized `visibility` is treated as invited, never public.**
    `report-access.js`'s `canReadShare()` treats every value other than the
    literal string `"public"` as invited (falling through to the viewer-list
    check). A typo in a database column, or a new visibility value added
    later without updating this function, must fail toward *less* access, not
    publish a report to the whole internet.
  - **A public share may never carry a private comp, and `storeSharedReport`
    enforces that itself** rather than trusting the route to have checked.
    With no database configured, storing a share whose visibility is not
    `"public"` **throws** instead of falling back to the
    `shared-reports.json` file store — the file has no column for
    `visibility`, `user_id`, or viewers, so an invited share written there
    would come back out of `getShareRecord` as `{ visibility: "public" }`,
    publishing exactly what the member asked to restrict. This is the same
    rule the broker vault's 503 already carries (see "Broker vault" below):
    everywhere else in this app a Supabase failure falls back to a local
    file so nothing is lost, but here the file WOULD be the loss, so the
    write refuses instead. A **public** share keeps the fallback it has
    always had — the file store still holds its body and the link still
    works through a database blip, exactly as before this feature shipped;
    the asymmetry between the two visibilities is the point. `POST
    /api/share` also refuses this case at the route level (503, before
    storage is ever reached), but that check protects one caller — this one
    protects every future caller of `storeSharedReport`, which is why it
    stays even though the route should make it unreachable in practice.
- `GET /api/shared?id=` — returns a published report's `{ data, meta }`.
  For a public share, anyone with the link can view it (the original
  behavior, unchanged for every pre-v3 link already in the world). For an
  invited share, only the owner or a viewer on the list — `report-access.js`
  is the single, sole decider, returning one of `revoked` (403, the link was
  turned off), `signin_required` (403 + `signin_required: true`, which the
  client turns into a sign-in card), or `not_invited` (403, signed in but
  not on the list). `meta.shared` is
  true so the front-end renders it without saving to the viewer's history.
- `GET /r/<id>` — serves `index.html`; the SPA reads the id off the path and
  fetches the report from `/api/shared`. (server.js allow-lists this path
  alongside `/` and `/index.html`.)
- `GET /api/geocode?address=` — CORS pass-through to the free US Census
  geocoder. Comp pins are placed ENTIRELY from real geocoding — the model no
  longer returns per-comp `lat`/`lng` (dropped 2026-07-31 to shrink the slow
  report-writing burst; only `subject_lat`/`subject_lng` remain, for the
  map's first paint and the wrong-state sanity gate). Old cached reports
  still carry comp coords and render unchanged. The front-end places every
  pin from
  geocoding (this proxy, then browser-direct Nominatim as fallback, results
  cached in localStorage under `geoCache.v1`). Rate-limited per IP.
- `GET /api/streetview?lat=&lng=` (an `?address=` form exists but the
  client no longer sends it — address aiming showed the road on unmapped
  parcels) — Street View photo proxy for the map pin popups. The client
  only asks for pins with a snapped OSM building footprint, aiming the
  camera at the footprint centroid. Metadata-checks first (free, cached
  in-memory), then streams the image with a 30-day cache header. No key /
  no imagery / any error → bare 404, which the popup img's `onerror` swaps
  for the keyless aerial (flag off = aerial directly, same footprint-only
  gate). Listing-site photos (Zillow/Redfin/Realtor.com) are OFF the
  table — copyrighted, scraping-banned, and litigated; Street View + Esri
  aerials are the licensed sources. Rate-limited per IP.
- `GET /api/corpus-comps?address=&type=` — the in-report "From CompNinja's
  records" offer: provenance-good corpus rows for the subject's market+type
  (never estimate/news, priced, deduped, max 20), served from the same
  `corpusRowsForMarket` read corpus-first retrieval uses. Pure DB read — no
  Anthropic call, no cap interaction. Rate-limited per IP. Logs a PII-free
  `corpus_offer` analytics event when rows are returned. Failure-safe: any
  error returns an empty list, never an error page.
- `GET /api/leads` — downloads captured leads as CSV; requires `ADMIN_KEY`.
- `POST /api/comp-submission` — stores a broker-submitted comp (broker contact +
  comp details, `status: "pending"`) in the Supabase `comp_submissions` table
  (file fallback: `comp-submissions.jsonl`). Review is manual: setting a row's
  `status` to `approved` in Supabase puts it in the verified comp layer — each
  search fetches approved comps of the matching property type and offers them
  to the model as trusted candidates; comps the model includes from that list
  carry `"verified": true` and the front-end shows a green Verified badge in
  the Address column. **Broker loop**: the server matches each returned verified
  comp back to its submission (by normalized address) and attaches
  `verified_by` (firm or broker name), which renders as "Verified · via
  <firm>" — visible credit for the contributor. And a BOV lead's owner email
  lists any brokers who've contributed approved comps in that same market
  (`findBrokersForMarket`), so the owner can connect them. Routing is
  owner-mediated: broker contact info goes only to the owner, never the
  reverse — owner PII is never auto-forwarded to a broker (also, Resend's free
  tier only delivers to the owner address anyway). Rate-limited per IP.
- `GET /api/comp-submissions` — downloads submitted comps as CSV; requires
  `ADMIN_KEY`.
- **Comp corpus** (not a route — a persistence layer): every search response
  (billed AND cached) has its comps harvested by `harvestComps()` into the
  Supabase `comp_corpus` table (file fallback `comp-corpus.jsonl`, git-ignored),
  deduped by a normalized address|date|price key (unique constraint +
  ignore-duplicates upsert; in-memory seen-set for the file path). Fire-and-
  forget — a corpus failure never affects the request. This is the permanent
  raw-data layer that broker verification and future retrieval features build
  on; the DDL lives in `migrations/001-comp-corpus.sql` (+ `004` for the
  per-type columns).
  `GET /api/comp-corpus` downloads it as CSV (requires `ADMIN_KEY`).
  **Radius blend (2026-08-14).** At serialization, inside `gate()` and
  **before** `gateReport()`, `blendNearbyComps` folds in harvested deals of
  the same property type whose date is inside the lookback, that have
  coordinates, and that sit within 10 miles of the subject — even across city
  lines. They join the table and the Low / Likely / High math; a free report
  turns extras into `locked_basis` so the dollar range still matches Pro.
  Harvest Census-geocodes new rows before the insert (fire-and-forget with
  the rest of harvest); unlocated existing rows backfill up to 8 per request
  and join the *next* search. A deal with no point is skipped, not guessed as
  same-city. Cache, harvest, and market snapshots still see the search-only
  report, so a later search in the area picks up deals saved after the cache
  write. Rollback is `CORPUS_RADIUS=off`. Vault rows are never read. Spec:
  `docs/superpowers/specs/2026-08-14-radius-corpus-blend-design.md`.
  **Corpus health (`CORPUS_HEALTH` + `noteCorpusFailure()`).** Fire-and-forget
  means both the write (`harvestComps`) and the read (`corpusRowsForMarket`)
  swallow their errors, which once hid a total outage: ten per-comp columns
  were missing because the `ALTER TABLE` was never run, so every insert 400'd
  into the ephemeral file and every read returned empty. The corpus sat frozen
  at 65 rows for **weeks** while the log said `Comp corpus +8` on each search
  and `/admin` showed a 0% corpus hit rate with no explanation. So failures now
  accumulate in `CORPUS_HEALTH` (write fallbacks, read failures, last error +
  timestamp, and a `schemaMismatch` flag set when the message names a column or
  the schema cache — PostgREST's `PGRST204`). `/api/stats` returns it as
  `corpus.health` and `/admin` renders a red banner above the tiles whenever
  anything is non-zero, naming the missing-column case specifically because it
  has one concrete fix. Counters are in-memory and reset on restart — a smoke
  alarm, not accounting. The harvest log also distinguishes a durable insert
  from the ephemeral fallback; **a console line alone was not the fix** (one was
  already logged on every failure and nobody tails Render's logs), which is why
  this surfaces in the dashboard instead.
- **Upstream health (`UPSTREAM_HEALTH` + `upstreamError()` + `noteUpstreamFailure()`).**
  Anthropic's error text is written for *us*, not for a customer, so it is never
  passed through to the browser. On 2026-08-04 it was: the Console API credit
  balance hit zero and every visitor — including people who had just paid $39 —
  got "Anthropic API error (400). Your credit balance is too low ... purchase
  credits", which reads as *their* billing problem and names a vendor they never
  bought from. Both leak sites (the non-2xx at `callAnthropicOnce` and the
  mid-stream `error` frame) now throw `upstreamError()`, which carries
  `.message` for the log and `.userMessage` for the browser; `clientErrorMessage()`
  at the two handler catches (`/api/comps`, `/api/explore-market`) is the only
  thing that decides what a visitor reads. It deliberately passes `.message`
  through when there is no `.userMessage`, because most errors here are ours and
  are already good customer copy ("The search took too long and was stopped.").
  429/529 gets a "busy, try again in a minute" line; everything else gets
  "temporarily unavailable". The real cause goes to `/api/stats` as `upstream`,
  to a red `/admin` banner **above** the corpus one (when this fires nothing else
  on the page matters — no search is completing at all), and, for the billing
  class only, to one email per process. **API credits are prepaid and billed to
  the Console org that owns `ANTHROPIC_API_KEY`; no Claude Pro/Team subscription,
  comped or otherwise, funds them.** Recovery is buying credits — nothing to
  redeploy. Counters reset on restart: a smoke alarm, not accounting.
- **Corpus-first retrieval** (the cost saver, not a route): on a cache *miss*,
  before paying for a fresh web search, `retrieveCorpusComps()` pulls comps
  already harvested for that market+type. Rows count as *usable* when the
  provenance is better than `estimate`/`news`, a price parses, and
  `parseDealDate()` puts the deal inside the requested lookback.
  `corpusIsStrong()` — the single threshold shared by the search budget and the
  analytics tag so the two can't disagree — is `coverage >= 4 && fresh`, where
  fresh means the newest harvest for that market is under 75 days old
  (45 until 2026-07-31 — widened as a cost lever; see the comment above the
  constant before touching it again). When
  strong, the model is handed those comps and `searchBudgetFor()` cuts
  `max_uses` to a floor of 3 (or 2 when the subject size was supplied), vs
  10/8 for a full-budget 12-comp search — a
  deliberate floor rather than 0/1 — and the search is tagged
  `source: "corpus"` in `analytics_events`. Failure is always safe: any error
  returns zero coverage, i.e. today's normal full search.
  Because the key is `marketOf(address)` and matched with a **case-sensitive**
  `eq`, the write side (`harvestComps` files each comp under
  `marketOf(comp.address)`) and the read side (`marketOf(subject.address)`) must
  agree exactly — `marketOf()` canonicalizes to title-case city + uppercase
  state for precisely this reason; see the note above it before touching that
  parse. Verified end-to-end 2026-07-27 on both a 24-month and the default
  12-month lookback. Note the threshold is per market **and** property type, so
  it only pays off when traffic repeats in the same market.
  **Metro matching (2026-08-10).** Corpus-first retrieval, and ONLY it, also
  reads the subject market's immediate neighbors from `market.js`'s curated
  `METRO_GROUPS`, so a Meridian search can draw on Boise's rows. Those come
  back as a separate `nearby` list and get their own prompt block, worded more
  narrowly than the exact-market one (use only when the target's own city is
  thin, report the address exactly as given, prefer a same-city comp when both
  are comparable). The exact-market block's "never include one clearly in a
  different city" rule stays intact and absolute. **`coverage` remains
  exact-market only**, so `corpusIsStrong` and the search budget cannot be
  moved by a nearby row; that is the whole safety property, and it is why the
  two counts are kept separate rather than summed. `corpusRowsForMarket` itself
  returns the same rows for its four other callers (watchlist feed, vault gut
  check, `/api/corpus-comps`, Address Explorer), now also carrying their own
  market value; retrieval calls the new `corpusRowsForMarkets` directly
  instead. Rollback is `CORPUS_METRO=off`. Adding
  a metro group is a data edit in `market.js`; the rule is adjacent suburbs
  sharing one submarket, never a whole statistical area, and a test pins every
  entry against `marketOf` because an exact-match key that never matches is
  invisible.
- `GET /how-it-works` — the account-wall front door, reached from the header
  nav (the old "Methodology" item) and the footer. Under the wall, `/` *is*
  this render (`renderHowItWorksHTML({ home: true })`). Holds a hero (claim +
  address field + one sample exhibit), the three-step Method, the FAQ, and a
  one-block Brokers path to `/brokers`. There is no stat strip. The address
  field is not `#compForm`; it stores `pendingLandingAddress.v1` and opens
  `/?auth=signup` (signed-in: `/`). **Server-rendered and
  self-contained** like the market pages (`HOW_CSS` — the Research Desk `rd-*`
  system re-expressed as plain class names — so it does NOT depend on the purged
  `tailwind.css`). Two things live here and nowhere else: `HOW_FAQ`, the single
  Q/A array feeding both the visible accordions and the **FAQPage JSON-LD** (it
  moved off `index.html`'s `<head>` with the copy it describes), and the sample
  exhibit's illustrative figures. Listed in `sitemap.xml`.
  **It renders two variants, and the caching split between them is
  load-bearing** (2026-08-08). The page is linked from inside the signed-in
  app, and while it served one static body to everyone its "Log in / Create
  account" chrome read to a member as having been silently logged out
  mid-session. It now takes `signedIn` — decided on `cn_session` **presence**,
  the wall's own cheap rule, because this renders synchronously and
  `getSessionUser()` reads the database — and swaps all **three** signup
  surfaces (header nav, hero CTA, closing CTA) for `My Desk` / `Run a report`.
  Presentation only: a forged cookie buys different buttons and nothing else.
  The headers are the half a future editor will "simplify" and thereby
  reintroduce the bug: the signed-in variant is **`no-store`** (a cached copy
  would outlive a sign-out), while the anonymous variant keeps its hour cache
  for crawlers and carries **`vary: cookie`**. That `vary` looks redundant on
  a page whose body is static and is not — without it the hour-old signed-out
  copy is re-served after signing in, so the people who just created an
  account are exactly the ones who still get told to create one.
  `test/account-wall.test.js` pins all three (chrome swap, `no-store`,
  `vary`).
- **Signed-in header chrome on every server-rendered page** (2026-08-09;
  `ACCOUNT_NAV_CSS` / `accountNavSlots()` / `ACCOUNT_NAV_PRICING` /
  `ACCOUNT_NAV_JS`, declared just above `MARKET_CSS`). The /how-it-works
  complaint above, generalized: `MARKET_BAR` carried three links and nothing
  else, so leaving the home page dropped Pricing, My Desk and the account
  circle in one go — reading as a mid-browse logout on `/markets`, all
  `/market/<slug>` pages, `/brokers`, `/1031-exchange`, `/terms`, `/privacy`.
  Fixed the OPPOSITE way from /how-it-works, on purpose: the markup is
  byte-identical for every visitor (hidden slots) and a client script asks
  `/api/config` + `/api/account/me` (both `no-store`) after paint, then
  unhides. Why not server-render like /how-it-works: it would drag ~38
  cached market pages onto the `no-store`/`vary: cookie` split, and the
  circle wants an email, which is `getSessionUser()`, a DB read on a
  synchronous render path. The cost is the chrome popping in a beat late.
  Visibility rules are index.html's `refreshBillingUI()` restated (that copy
  is locked in its module scope): Pricing/Upgrade = billing live && !isPro;
  vault = `canUseVault`, NOT gated on billing; Manage billing = status set,
  not "none", not admin. Pricing links to **`/#pricing`** (the modal lives
  only in index.html — the `/#submit-comp` idiom; consumed in
  `refreshBillingUI` once `live`/`pro` are known, cleared either way).
  Sign-out reloads the page rather than re-hydrating, because the page
  around the bar may itself be signed-in-shaped (the vault above all).
  Traps: /how-it-works takes `accountNavSlots({ desk: false })` or a member
  sees TWO My Desk links (it renders its own); and `.hdr nav .dd a` sets
  `display:block`, which out-specifies `[hidden]`, so the
  `.hdr nav [hidden]{display:none!important}` line in ACCOUNT_NAV_CSS is
  load-bearing — without it every page shows both auth states at once.
  There are now THREE headers to keep in step (index.html, MARKET_BAR,
  /how-it-works'). `test/routes.test.js` pins presence on all seven pages
  and the no-double-desk rule.
- **Broker directory on market pages** (2026-08-06). A market page slug IS a
  (market, property type) pair — `industrial-boise-id` — the identical key
  `broker_coverage` uses, so "who covers Boise industrial" renders on
  `/market/<slug>` rather than on a directory page of its own. Rules in the
  pure, tested **`broker-directory.js`**; the cached read is
  `BROKER_DIRECTORY` / `refreshBrokerDirectory()` / `brokersCoveringMarket()`
  in server.js, stale-while-revalidate like `MARKET_CREDIT` and for the same
  reason — market pages render synchronously and must never wait on the DB.
  **TWO CONSENTS, NOT ONE.** `broker_coverage` is which markets a broker wants
  *leads* from (015) — a working preference, **not** permission to publish
  them. `broker_profiles.public` is the opt-in and is false by default. It is
  enforced **twice**, in the query (`public=is.true`) and again in the module,
  so a bug in either alone cannot publish somebody; only a literal `true`
  counts. **NO CONTACT DETAILS EVER** — name, company, and a link to the
  profile they opted into. Do not confuse `brokersCoveringMarket()` with
  `findBrokersForMarket()`: the latter carries broker email and phone and is
  OWNER-facing only. Routing is owner-mediated; a public directory is the
  reverse of that.
- `GET /brokers` — the broker-facing page (`renderBrokersPageHTML`), nav label
  **"Brokers"**. Hero payoff, then two stacked ledgers: Contribute (CREDIT /
  INTROS / PROFILE, Verified chip shown inline) and Pro (BOOK / PIPELINE /
  PRIVATE). One Submit door at the bottom (`/?submit=comp` — a query the
  account wall can see; a `/#submit-comp` hash never reaches the server).
  Unlike `/how-it-works` it carries no CSS of its own: it renders through
  `marketShell()`, so `MARKET_CSS` / `MARKET_BAR` / `MARKET_FOOTER` style it
  and it likewise does NOT depend on `tailwind.css`. Listed in `sitemap.xml`.
  Do not confuse this with `GET /broker/<slug>`, the per-contributor public
  profile.
- `GET /1031-exchange` — public 1031-exchange education page (v4 slice 3;
  spec `docs/superpowers/specs/2026-08-08-1031-guide-design.md`). All
  content lives in the pure **`guide-1031.js`** (the vault-page.js
  precedent) — FAQ array feeding both the accordions and the FAQPage
  JSON-LD, the education-not-advice compliance box, and a client-side
  45/180-day deadline-dates widget (calendar dates only, never taxes or
  dollars; nothing is sent to a server). server.js only dresses it in
  `marketShell` and spreads the module's JSON-LD nodes into the shared
  `brandGraph()` @graph. Education, never advice — the compliance strings
  are test-pinned in both directions (must-appear and must-never-appear).
  Listed in `sitemap.xml`; linked from `MARKET_FOOTER`, `/how-it-works`'s
  footer, and `/brokers`.
- **Brand entity** (not a route — `brandGraph()` in server.js). CompNinja is
  online-only, so it is **not eligible for a Google Business Profile** (Google
  requires face-to-face customer contact and video-verifies it against a real
  address; a listing filed anyway is suspended, not merely rejected). The
  structured-data brand entity is the substitute. `brandGraph()` returns one
  canonical `Organization` node (`@id` `<SITE_URL>/#organization`, legalName
  "CompNinja LLC", logo, public contact point) plus a `WebSite` node, spread
  into the `@graph` of every server-rendered page: `/market/<slug>`,
  `/markets`, `/brokers`, `/broker/<slug>`, `/how-it-works`. Those pages
  reference it via `ORG_ID` / `WEBSITE_ID` instead of restating it — **a new
  server-rendered page should do the same, never inline its own Organization
  or WebSite**. Two standing rules: the email is the public
  `info@compninja.co`, **never `LEAD_NOTIFY_EMAIL`** (the owner's personal
  inbox, and this is public output); and `sameAs` is deliberately absent
  because it means profiles the business actually controls, so add real URLs
  only when they exist. `index.html` needs no copy — under `ACCOUNT_WALL` a
  crawler at `/` gets the landing render, which spreads `brandGraph()` like
  every other server-rendered page.
- `GET /markets`, `GET /market/<slug>` — programmatic-SEO landing pages
  (directory + one page per market, e.g. `/market/industrial-ontario-ca`).
  **Server-rendered, self-contained HTML** (own inline `<style>`, so they do
  NOT depend on the purged `tailwind.css`) built from `market-seed.json` —
  static data committed to the repo, so pages survive redeploys and serve
  instantly with no DB. Each page: median/quartile $/SF, cap-rate range, a
  market summary + `value_drivers` narrative, a recent-comps table (sortable,
  Sale/Lease filter; address links to `source_url` when the snapshot has a
  sanitized http(s) URL), and a CTA — owner valuation for anonymous visitors,
  Watch + CSV for signed-in ones. Op-ex, price trend, and a rent band render
  on a second ledger row when the snapshot earned them. Regenerate/expand with `node gen-market-seed.js`
  (edit its `TARGETS` list; it runs one cached search per market against a
  locally-running server and keeps only markets with ≥3 priced sale comps, so
  no thin pages). `sitemap.xml` lists `/`, `/markets`, and every market page.
- `POST /api/explore-market` — the **Market Explorer**: generates a
  `/market/<slug>` page on demand from the header search on the app page
  (one billed search per genuinely new market; results meeting the seed
  quality bar publish permanently to the Supabase `market_pages` table,
  thinner ones get a 30-minute in-memory `/market-preview/` page). Since
  2026-08-09 it **validates the city is real before the billed leg**:
  `city-check.js` (pure, tested) asks Zippopotam's keyless city endpoint
  and refuses unknown cities with a friendly 400 that never consumes the
  guest's free search or an `explore:` limiter slot. Three name variants
  are tried — as typed, punctuation-to-space, punctuation-stripped, each
  with leading "St "/"Ft "/"Mt " expanded — because measured GeoNames data
  is inconsistent about punctuation ("Coeur D Alene" answers 200 but "Lees
  Summit" is the stripped form); **do not "simplify" this to one variant**,
  strip-only shipped first and falsely refused Winston-Salem and Coeur
  d'Alene. Fails OPEN on validator outages (`DAILY_SEARCH_CAP` backstops);
  `ok`/`unknown` verdicts memoize per process, `unavailable` never does.
  Spec: `docs/superpowers/specs/2026-08-09-explore-market-city-validation-design.md`.
- `GET /admin`, `GET /api/stats` — a small analytics dashboard. Every search,
  lead, share, and comp submission is logged as a **PII-free** event (`ts`,
  `kind`, `prop_type`, `market` = city+state only, `source`, `cached`) via
  `logEvent()` → the Supabase `analytics_events` table (`analytics.jsonl` file
  fallback). `/admin` is a self-contained page (own inline CSS/JS) that fetches
  `/api/stats` with the key as an `x-admin-key` header; `/api/stats` is
  `ADMIN_KEY`-gated and returns aggregates (searches/day billed-vs-cached, cache
  hit rate, by-type, top markets, leads by source, conversion %, and
  `corpus.health` — see the corpus-health note under **Comp corpus**, which
  renders as a red banner above the tiles). It also carries `introRequests`,
  a read of the broker inbox's `lead_intro_requests` table (count + recent
  rows with broker email and the lead's market/type — owner-facing, so that
  PII is allowed here even though analytics EVENTS stay PII-free), rendered
  as a "Broker intro requests" card on `/admin`; without it a dropped owner
  email made a request invisible. Supabase-only like the route that writes
  it (`db: false` when unconfigured), and fails safe: a read error yields
  `null`/"Unavailable", never a broken dashboard or a fabricated zero.
  **Logging is always on**; the
  dashboard only renders once `ADMIN_KEY` is set (same key as the lead CSV).
  `/admin` is `noindex` + `Disallow`ed in robots (meta tag, `X-Robots-Tag`
  header, and robots.txt).
  Reading the **corpus hit rate** tile: the denominator is *every* billed
  non-Explorer search ever, including the weeks before corpus-first retrieval
  existed, so the lifetime figure reads far lower than current behavior — judge
  the ratio going forward, not the headline. A hit requires ≥4 recent priced
  comps in that exact market **and** property type, so it only fires on repeat
  searches in the same market. Non-USD searches can never become corpus-covered
  (harvest skips them), so heavy international use slightly deflates the tile.
  `analytics_events` is queryable directly in
  Supabase when the dashboard is unavailable: `source = 'corpus'` marks a hit.
  **Whose visit an event was** (2026-08-13; migration
  `026-analytics-visitor.sql`, **run before deploying — see below**). Events
  recorded what happened and nothing about whose visit it was, so the table
  could count signups and count reports and never say whether the same
  browser did both. `visitor_id` (an opaque random id in the httpOnly
  `cn_vid` cookie) and `user_id` (once a session resolves) make that a query,
  and `/admin`'s **Visitor funnel** card reads it: arrived, hit the sign-in
  wall, created an account, ran a report. The events stay PII-free — the id
  is a random number handed to a browser, not derived from IP, user agent or
  anything else about the person, and the privacy policy's cookie section
  names `cn_vid` alongside `cn_guest`; keep it in step. Five rules:
  - **The cookie is minted only on document navigations.** A page load fires
    a dozen parallel requests; minting on whichever arrives first is a race
    where each mints its own id, the browser keeps the last, and that visit's
    events scatter across ids that never appear again.
  - **A cookie value that is not 32 hex characters is replaced, never
    stored.** It arrives from a client and is written to a column.
  - **The funnel stages are cumulative sets over distinct visitors**, so a
    stage can never exceed the one above it and the gap between two lines is
    a real drop-off rather than two different populations.
  - **Rows with no `visitor_id` are excluded, not bucketed.** Every event
    before the migration has a blank id, and lumping them together would
    invent a single visitor who did everything the product has ever seen.
  - **`AsyncLocalStorage` does NOT reach a `req.on("end")` callback**, which
    is where every route with a request body logs from. Measured, not
    assumed, and `enterWith()` does not fix it either: Node emits those
    events from the connection's async context, a sibling of the handler's
    rather than a descendant. A plain `run()` around the handler attributes
    every GET perfectly and records every signup, lead, share and vault
    import as anonymous — which is exactly why it needs a test rather than a
    spot check. `bindRequestListeners()` binds the registration functions so
    listeners added afterward inherit the context; it relies on server.js
    never removing a listener (a wrapped function cannot be matched by
    `removeListener`), so check that before adding a `.off()` anywhere.
  **This migration must be run BEFORE the code deploys**, unlike most in this
  folder: `logEvent`'s INSERT names the two columns, PostgREST 400s an insert
  on an unknown column, so every analytics write would divert to the
  ephemeral `analytics.jsonl` and the dashboard would quietly flatten.
- `GET /api/accuracy` — the valuation-accuracy backtest card on `/admin`
  (added 2026-08-06; spec in
  `docs/superpowers/specs/2026-08-06-valuation-backtest-design.md`). Gated
  exactly like `/api/stats` (`isAdminRequest`: the `x-admin-key` header or the
  `cn_admin` cookie), and it is a full-corpus read, so it is kept OFF
  `/api/stats`'s critical path and memoized 15 minutes in-process
  (`?refresh=1` busts the memo). It hold-one-out scores every usable,
  ground-truth-provenance corpus sale against its own market+type peers using
  `valuation.js`'s real math (`backtest.js` — pure, requires nothing but
  `valuation.js`, so the harness can never quietly drift from what a customer's
  report actually computes) and reports median absolute error, band coverage,
  band width, and a per-type breakdown, with a skip-reason breakdown
  (`unusable`, `notGroundTruth`, `thinPeers`, `duplicateAddress`) so the
  figure is never read as more solid than its sample. Below a floor of 20
  scored subjects the card shows progress toward the floor instead of a
  number — a median over a handful of subjects swings too much to trust.
  **Fails safe with a 200** on any error or a missing corpus, same as
  `/api/corpus-audit`: `/admin` is the page opened when something else is
  already wrong, and this panel must never be what breaks it further. It
  measures the reconciliation MATH only (comps already in the corpus, not a
  fresh search) and runs untrended (corpus rows do not store the market trend
  a live search used), and the card says both of those things next to the
  numbers. Not a public accuracy claim — nothing from this ships to a
  marketing surface.
- **Accounts + My Desk** (added 2026-07-19; spec/plan in `docs/superpowers/`):
  email+password accounts with a server-synced property **portfolio**
  (value-snapshot history per re-run) and an in-app market **watchlist** whose
  updates feed reads the comp corpus. Signed-in searches auto-save to
  `portfolio_items` (upsert on address + type); Free My Desk is an address
  list, Pro is the book of values, and the caps (100 / 500) live in
  `entitlements.js` as `portfolioMaxItems` / `portfolioValues`. The `$20`
  unlock does not auto-save. Auth is built into server.js — scrypt
  (Node built-in) password hashes, 90-day session tokens stored as SHA-256
  hashes, `cn_session` httpOnly cookie. Routes: `POST /api/account/signup|
  login|logout|forgot|reset`, `GET /api/account/me`, `DELETE /api/account`,
  `GET|POST|DELETE /api/portfolio`, `GET|POST|DELETE /api/watchlist`,
  `GET /api/watchlist/feed` (exact URL, no query string), `POST
  /api/watchlist/seen`. Storage: Supabase tables `users`, `sessions`,
  `portfolio_items`, `watchlist_items`, `password_resets` (DDL in
  `migrations/002-accounts.sql`) with a git-ignored
  `account-store.json` file fallback for local dev. Search stays fully open
  to visitors — accounts only gate saving/watching. The feed marks items
  "seen" only on explicit My Desk/bell clicks, never on render. Password
  reset emails go through the Resend outbound gate (`EMAIL_FROM` +
  `RESEND_API_KEY`); with either unset the link logs to console instead.
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
- `POST /api/redeem-passkey` — redeems `TESTER_PASSKEY` (comped Pro) or
  `VAULT_PASSKEY` (the broker vault) for the signed-in caller's account, on
  one route and one input: 401 if not signed in, rate-limited per IP, and the
  response's `granted` array names which door opened. 404s only when NEITHER
  passkey is configured. See both env bullets above for what each grant covers
  and why they are separate secrets.
- `GET /dev`, `GET /api/devlog`, `GET|PUT /api/dev-ideas` — the **Development
  Hub**: an internal changelog + future-ideas page, gated by the same
  `ADMIN_KEY` (and sessionStorage key) as `/admin`, with the same triple-noindex
  treatment. The changelog is the repo-committed **`devlog.json`**, read from
  disk per request (edits need no restart; the `/dev` page itself lives in
  server.js and does). **The standing devlog rule: every time you ship a
  fix, improvement, or feature to this project, append an entry to
  `devlog.json` in the same commit** — shape `{ "date": "YYYY-MM-DD", "type":
  "fix"|"improvement"|"feature", "title": "...", "details": "optional",
  "commit": "optional short hash (renders as a GitHub link on /dev)" }`;
  file order doesn't matter (the page groups/sorts by date); routine
  docs-only or refactor commits don't need entries, anything a changelog
  reader would care about does. **Save devlog.json as clean UTF-8, never
  Windows-1252** — em dashes, curly quotes, arrows, and emoji are normal
  and fine raw; do NOT escape them. The file has been mojibake'd by
  encoding round-trips more than once (a PowerShell write without
  `-Encoding utf8` reads UTF-8 as the ANSI codepage, and a merge conflict
  resolved in the wrong editor re-mangles what's already mangled — one
  incident doubled on five successive merges, 60 to 2307 occurrences,
  before anyone noticed). CI (`.github/workflows/ci.yml`) fails the build
  if the telltale double-encoding pattern (`Ã`, `â€`, `Â` sequences)
  appears anywhere in the file — that check is what actually guards this,
  not an ASCII-only rule. Entries are **click-to-edit** on `/dev`:
  edits and per-entry notes live in a Supabase `devlog_overrides` overlay
  (DDL in `migrations/006-devlog-overrides.sql` — run it
  before deploying) keyed by the file entry's original date+title and merged
  at read time, so devlog.json itself is never rewritten at runtime and
  stays the source of truth. Renaming an entry's date or title in the FILE
  orphans its override — re-edit on /dev if that happens. Future ideas are whole-list replaced via
  `PUT /api/dev-ideas` into the Supabase `dev_ideas` table (DDL in
  `migrations/005-dev-ideas.sql` — **run it before deploying**),
  git-ignored `dev-ideas.json` fallback otherwise. When an idea ships, mark
  it done on `/dev` and add the devlog entry.
- **Pro tier** (added 2026-07-31; launched to the public 2026-08-03). Paid plan
  gating free reports to **4 comps**, a **36-month** lookback ceiling, and
  **5 exports/month** (0 for anonymous visitors — exporting requires an
  account), against Pro's unlimited everything plus report branding.
  The free lookback was **12 months until 2026-08-04**. It was widened because
  at 12 months the free report often could not compute a valuation at all (the
  hero needs two priced sale comps and dense markets returned one), and because
  a window that short usually returned ≤4 comps, so the 4-comp gate withheld
  nothing and the $39 tile never appeared. Not widened further: the window is
  clamped BEFORE the search and the model is asked for up to 12 comps
  regardless of plan, so a longer free window grows output — the cost and
  wall-clock driver — on the majority of traffic. The numbers live in
  `entitlements.js`; the pricing modal and both plan-card strings hard-code
  them in prose and must be edited together. The desk split belongs with
  those numbers: Free My Desk is an address list (cap 100), Pro is the book
  of values (cap 500), and the pricing compare table's Portfolio row restates
  it.
  The **Address Explorer** is Pro-only too (`canExploreAddresses`) — see the
  amendment in its spec for why that gate needs a browser half AND a server
  half, and for the `proConfig` temporal-dead-zone trap that shapes the
  front-end code.
  **`entitlements.js`** holds the rules and is deliberately **pure** — no I/O,
  no clock reads (the caller passes `now`), no requires — which is what makes
  `npm test` able to exercise the whole decision table with no database.
  server.js owns the reads (`findSubscription`, `findReportPurchase`,
  `getExportUsage`, `findBrandingProfile`) and exposes the **only** sanctioned
  entry points: `getEntitlements(user, reportId)` and the request-shaped
  `entitlementsFor(req, reportId)`. **Never test a plan or subscription status
  anywhere else** — scattered plan checks are how a paywall grows holes.
  Everything **fails closed**: an unknown Stripe status, an unparseable
  period end, or a failed DB read resolves to the free tier, never to Pro.
  Two deliberate softenings of that, both tested: a **24h renewal slack** past
  `current_period_end` (Stripe renews at the boundary and the webhook lands
  seconds later — without slack a paying subscriber flickers to free), and a
  60s subscription cache that serves its last known answer if a DB read
  fails.
  **Comp gating** lives in **`comp-gate.js`** (also pure, also tested).
  `gateReport()` is applied at **serialization time only** — `/api/comps`
  gates at all three exits (cache hit, SSE `result`, plain JSON) while the
  cache, `harvestComps()`, and `maybePublishMarketSnapshot()` keep seeing
  **whole** reports, so one cached search serves free and Pro alike and the
  corpus never starves on free traffic. Selection is sales-before-leases
  (the hero's range is sales-only, so a free list of leases wouldn't support
  the number above it) then best-first by a weight that **mirrors
  index.html's `compWeight()`** — a deliberate second copy that must stay in
  sync; there is a `⚠` comment on both.
  **`locked_basis`** is the load-bearing idea: one anonymized row per
  withheld comp carrying `date`/`transaction`/`size_sqft`/`price_per_sqft`/
  `source_type` (+`verified`, +`price_per_unit`/`price_per_acre`) and
  **nothing identifying**. Client-side `valuationComps()` =
  `includedComps()` + `lockedBasis()`, so the hero, the market comparison,
  the chart median and the stat tiles all read the FULL set — a free
  report's value range is identical to a Pro one (verified: the same report
  gated and ungated both produce $6,206,732–$6,529,080 from 14 sale comps).
  Basis rows must never reach the table, map, exports, or curation — they
  have no identity to render.
  Locked table rows are **redacted placeholders, not blurred real data**: a
  CSS blur would leave the values in the DOM, and the whole point is that
  the server never sent them.
  Two side doors are closed to match: `/api/corpus-comps` and
  `/api/watchlist/feed` return a `locked_count` instead of rows for free
  users (the feed keeps its aggregates — `new_count`, `median_psf`, trend —
  which are market figures, not comp data). `gen-market-seed.js` sends
  `x-admin-key` to bypass the gate and **throws if it gets a gated report
  back**, rather than silently seeding 4-comp market pages.
  **Billing (phases 3-7, done).** Stripe is spoken to over its REST API with
  plain fetch (`stripe.js`) — still zero npm deps. Server: `POST /api/checkout`,
  `POST /api/billing-portal`, `POST /api/stripe/webhook` (raw body, signature
  verified, acknowledged before the work), `handleStripeEvent()` for all six
  events with idempotent upserts, and `GET /api/pricing` (the founding counter,
  memoized 60s). Checkout, the portal and pricing all go dark while
  `PRO_ENABLED` is unset or the caller is outside `PRO_AUDIENCE`; **the webhook
  does not** — it carries no `PRO_ENABLED` check at all, because its gate is
  the Stripe signature and it must keep recording events regardless.
  Front-end, all in `index.html`: **one** pricing modal (`#pricingModal`), and
  every locked surface reaches it through the `.unlock-comps-btn` class →
  `openUpgradePrompt()`. Do not add a second upgrade prompt — give a new locked
  surface that class instead. `refreshBillingUI()` is the single owner of every
  billing control's visibility, driven entirely by `/api/config`; because
  entitlements are per-user, sign-in, sign-out, account deletion and the
  checkout return all call `refreshProConfig()` to re-read it. Checkout returns
  land on `/desk?checkout=success|cancelled` and the success banner **polls for
  the webhook** rather than assuming Pro is live, because Stripe redirects
  before the webhook arrives.
  **The `.pricing-buy` `data-plan` values must stay in step with the `PLANS`
  table in `/api/checkout`**, which is an explicit map with **no fallthrough** —
  an unrecognized plan is a 400. It used to map everything that wasn't the
  founding plan onto monthly, which is why a $39 button was unsafe to add;
  restoring any such default would re-arm exactly that mischarge.
  **The single-report unlock — $20 since 2026-08-04** (shipped 2026-08-03 at
  $39). `plan: "single_report"` opens a Stripe **payment**-mode session, and the
  `checkout.session.completed` handler writes a `report_purchases` row, after
  which `computeEntitlements` grants **every Pro capability that can be scoped
  to a property** — `maxComps: "all"`, `PRO_MAX_LOOKBACK_MONTHS`, unlimited
  exports, `canBrand` — for that address + type. Four things to know:
  - **The price lives in Stripe, not here.** The tile's `$20` is prose in
    index.html; the actual charge comes from `STRIPE_PRICE_SINGLE_REPORT` in
    Render. **They can disagree, and nothing detects it** — changing the copy
    without creating a new Stripe price silently mischarges. Always move the
    Stripe price FIRST (undercharging while the copy is stale is the safe
    direction), then deploy the copy.
  - **The report id is derived, never accepted, and is `address|type` —
    NOT the lookback.** `reportIdFor()` hashes it out of the request body, so a
    buyer cannot unlock a report they didn't pay for by posting an id. The
    lookback left the key on 2026-08-04: while it was in there, a re-run at a
    wider window was a different id that matched no purchase, so a purchase
    could never carry Pro's ten-year window — which is exactly what the price
    is now selling. It **mirrors `exportReportKey()` in index.html byte for
    byte** (⚠ comment on both) — purchase key and export-tally key are the same
    string, which stops a bought report burning a free export. Consequence:
    exporting one property at two windows costs one export, not two.
  - **The Address Explorer is the one Pro capability a purchase does NOT
    grant** (`canExploreAddresses: pro`). It finds the NEXT property, so it
    can't be scoped to a report without making $20 a substitute for the
    subscription. It is deliberately the reason to subscribe.
  - **The unlock is permanent for that address + type**, not for a
    frozen set of comps. `report_purchases.comp_snapshot` is **nullable and
    never written**: the webhook has a session and a payment intent but no
    report data, and nothing reads a snapshot. If the table was created with
    `not null`, the ALTER in `migrations/008-pro-billing.sql` must run or every
    purchase webhook 400s. Re-running the search re-serves it whole from cache.
  - **Buying returns to `/?purchase=success`, not `/desk`** — the buyer wants
    the report, and the desk doesn't know which building it was. The address is
    kept out of the URL; `localStorage.pendingUnlock.v1` carries it across the
    redirect, and `handlePurchaseReturn()` polls **`POST /api/report-access`**
    before re-running, so nobody who just paid gets a still-locked report.
  - **The $39 tile is contextual.** `updateSingleReportTile()` shows it only
    when a report is on screen with `lockedCount() > 0` and it isn't a shared
    report. It still lives inside the ONE pricing modal — do not add a second
    upgrade prompt.
  **Report branding** (shipped 2026-08-08). `GET|PUT|DELETE /api/branding`
  lets a signed-in member save one profile (firm name, preparer, phone,
  email, license number, a short disclaimer, and a logo stored inline as a
  data URI — never a URL, because a cross-origin image taints the
  html2canvas canvas and silently breaks PNG export). Rules live in the
  pure, tested **`branding.js`**: `validateForSave` rejects an
  over-length field or a non-image logo rather than truncating it, and
  `brandForRender` decides what a given render is allowed to show. The mark
  appears everywhere a report does once entitled — the on-screen letterhead,
  the print footer, the PNG export, and both the CSV and XLSX exports — and
  the license number renders on all of those, not just the desk preview.
  **Co-branded, never white-label**: the surfaces (not `branding.js`) always
  add the CompNinja attribution and the automated-estimate line, on top of
  whatever the member's profile supplies; the owner is not a licensed
  broker, so a report carrying only a brokerage's mark would read as that
  brokerage's own appraisal. `/api/comps` carries `branding_allowed`
  (`ent.canBrand === true`) on every served report, computed per-report like
  `exports_remaining` — a $20 single-report buyer's `canBrand` is scoped to
  the property they bought, not a live Pro subscription, so this cannot be
  folded into `/api/config`. Two rules a future editor will otherwise break:
  - **A shared report renders the sender's snapshot and never the viewer's
    own profile.** `POST /api/share` looks up the sender's saved profile at
    share time (only when `user && ent.canBrand`) and writes it into
    `meta.branding` as a point-in-time snapshot, not a pointer — the report
    should look the way it looked when it was sent, and a share outlives its
    owner's subscription and even their account. `brandForRender`'s
    `isShared` branch returns `normalizeBrand(sharedBranding)`
    unconditionally and never falls through to the viewer's own profile: a
    Pro member opening a report their broker sent them must not see their
    own logo on someone else's work. `index.html`'s `normalizeBrandBlock()`
    is a deliberately narrower mirror of `branding.js`'s `normalizeBrand()`
    (camelCase/`logo` only) and must stay in step with it.
  - **Saving a profile is not the entitlement, applying it is.** `PUT
    /api/branding` is deliberately NOT gated on `canBrand` — any signed-in
    member can save one, because an unsaved-but-inert profile costs nothing
    (`brandForRender` returns null without the entitlement). The gate is on
    APPLYING a profile to a report, checked server-side at serialization
    (`/api/comps`'s `branding_allowed`) and again at share time (`POST
    /api/share`'s `ent.canBrand` check before the snapshot). This is what
    makes the $20 single-report unlock's branding promise fulfillable: the
    entitlement it grants is scoped to one address+type, so a buyer with no
    Pro subscription can still save a profile in advance and have it apply
    the moment they unlock a report, without the editor itself needing to
    know which case it is.
- **The vault is part of Pro. There is ONE subscription** (decided and shipped
  2026-08-05; the vault itself is live). Ecosystem Plan v1 — design spec and
  the vault contract in
  `docs/superpowers/specs/2026-08-05-broker-tier-design.md`, which predates the
  decision and still describes two products; read it for the vault's design,
  not for how it is sold. The tier briefly existed as a second plan,
  `broker_monthly`, modelled as a superset of Pro. It was **removed rather than
  left unset**: it is gone from `/api/checkout`'s `PLANS` map,
  `STRIPE_PRICE_BROKER_MONTHLY` is deleted, and `entitlements.js` now reads
  `const broker = pro`. Nobody lost access, because that plan was never
  sellable — its Stripe price was never set, so checkout always 503'd for it
  and no subscription row in the wild can carry it. Four things to know:
  - **Vault routes test `ent.canUseVault`, never a plan name.** The result
    carries `broker` (identity, mirrors `pro`) and `canUseVault` (capability,
    mirrors `canBrand`); `/api/config` exposes both. The usual rule applies
    with more force than usual here — this gate guards private data.
  - **An unrecognized plan name now DOES open a vault**, matching `pro`, where
    status governs access and an unfamiliar plan on a paid row is treated
    generously. This reversed on 2026-08-05 and the test that pinned the old
    rule now pins the opposite. Failing closed on the name was right when an
    unnameable plan might have been a second product; with one product it would
    withhold half of what a paying customer bought.
  - **Access still lapses with the card.** `canUseVault` tracks `broker`, which
    tracks `pro`, so it goes false at the end of a cancelling period and at the
    end of the grace window. Nothing DELETES a lapsed vault — the only delete
    paths are the broker's own "remove this import" and account deletion — and
    the plan card says so, because a broker who uploaded their book and then
    finds the door shut will assume the worst otherwise.
  - **`PRO_ENABLED=off` grants no vault**, even though that branch grants every
    other capability. "Pre-Pro behavior" restores what visitors USED TO HAVE
    free; the vault was never free, it did not exist. The opposite would open
    an upload endpoint to every anonymous visitor on an un-launched deployment.
  **Selling it is copy, in three places, and they must agree**: the Pro tile's
  bullet list and the plan-card strings in `index.html`, and the vault page's
  own 403 in `vault-page.js`. All three say "Pro" and none of them may name a
  broker plan — a visitor sent looking for one finds a product that cannot be
  bought.
  The privacy wall is the product: no vault row may ever reach `harvestComps()`,
  `corpusRowsForMarket()`, a market snapshot, or another account's report.
  Enforce it with **separate tables read by separate functions**, not a
  `private` column filtered in the corpus queries — the corpus read path
  swallows its own errors, so one missed filter would leak silently.
- **Broker vault** (v1 server side, 2026-08-05; no UI yet). `GET|POST|DELETE
  /api/vault*` — the broker's private comp store. DDL in
  `migrations/013-broker-vault.sql` (**run before deploying**); plan in
  `docs/superpowers/plans/2026-08-05-broker-vault-v1.md`. Routes:
  `GET /api/vault/template` (the CSV a broker fills in), `POST
  /api/vault/upload` (JSON `{filename, csv}` — deliberately not multipart,
  which would be hundreds of lines of hand-rolled parsing in a repo with no
  dependencies; also accepts `{filename, rows}` from the PDF confirm table,
  converted through `exportCsv` then `parseUpload` — the CSV path is
  unchanged), `POST /api/vault/extract` (JSON `{filename, file}` — base64 —
  sends the file to the extract vendor with no search tools, writes nothing,
  and returns `{ rows: [{ values, error }] }` for the confirm table),
  `GET /api/vault` (filters by `market` and `type`), and
  `DELETE /api/vault/upload?id=` (undo one import; comps cascade).
  All of these routes go through one `openVault()` helper: 401 not signed in →
  403 not a broker (`canUseVault`) → 503 no database.
  - **`/api/vault/extract` takes screenshots too** (2026-08-13). The file a
    broker actually has is often a screenshot of a CoStar table or a photo of
    a printed comp sheet rather than an exported PDF, and both providers read
    an image on the same call the PDF uses, so it is the same route, the same
    prompt, the same confirm table and the same "nothing is stored" promise.
    Four rules:
    - **The BYTES decide the media type, never the filename and never the
      browser's `type`.** `sniffExtractMedia` reads magic bytes and
      `checkExtractFile` (type + size, one place so the refusal copy cannot
      drift) is what the route calls; a `mediaType` taken off the request body
      would defeat the check that exists to stop a renamed `.xlsx` reaching a
      third-party vendor. A test pins that the route never reads one.
    - **`EXTRACT_MEDIA_TYPES` is the INTERSECTION of the two providers**
      (pdf/png/jpeg/webp), not the union: Anthropic reads GIF and Gemini does
      not, Gemini reads HEIC and Anthropic does not, and a file that imports
      on one deployment and refuses on another is a bug nobody can reproduce.
      Adding a type means checking both vendors.
    - **HEIC is recognized in order to be refused BY NAME.** An iPhone photo
      is the likeliest unsupported file to arrive here, and a generic "that
      file isn't something we can read" would send a broker looking for a
      fault in their comp sheet instead of exporting a JPEG.
    - **Only the Anthropic provider branches.** A PDF is a `document` block
      and an image is an `image` block there; Gemini's `inline_data` carries
      whichever `mime_type` it is handed. `buildExtractBody` takes
      `{ fileBase64, mediaType }` on both.
    The body field is `file` (`pdf` is still accepted, so a browser holding a
    cached copy of the old page still works). One ceiling covers both kinds,
    `MAX_EXTRACT_BYTES` = 4 MiB, sized against the handler's 8 MB body cap
    because base64 costs a third more than the bytes it carries. The
    `vault_extract` analytics event names the kind (`ok:image:5`), which is
    the only place "do brokers bring PDFs or screenshots?" can be counted.
  - **Per-comp editing, adding and export** (2026-08-10). `PATCH|DELETE
    /api/vault/comp?id=` fixes or removes one stored comp; `POST
    /api/vault/comp` adds one by hand (a broker who closed a deal on Tuesday
    should not have to author a CSV); `GET /api/vault/export.csv` downloads
    the whole book. After a spreadsheet import, `/vault` can open that book
    as a grid (`Open spreadsheet`, or Open on that import): the same PATCH,
    one field per cell, saved on leaving the cell so Tab/Enter work like a
    spreadsheet. The compact Edit form stays for a single-row change from
    the ordinary table. **`EDITABLE_FIELDS` in `broker-vault.js` is an
    allowlist**, not a second validator — `validateEdit(existing, patch)`
    merges the patch over the stored row and reruns it through
    `normalizeRow`, the same function every imported row goes through, so a
    hand-typed "1.2M" or an Excel serial date fails an edit exactly as it
    fails an upload.
    **Editing or deleting a PUBLISHED comp retracts it** (`retractPublishedComp`)
    — deletes the `comp_submissions` row and clears `published`/
    `published_at`/`published_submission_id` — and **the retraction happens
    only AFTER validation succeeds**, never before. It shipped the other way
    round first: retracting ahead of `JSON.parse`/`validateEdit`/the
    collision check meant a broker's REJECTED edit (typing "1.2M", the exact
    input the vault exists to refuse) still pulled the comp from the public
    records and stripped its firm credit before the 400 was ever returned —
    the broker saw only a parse error and had no way to know what had
    happened, and if the submission had already been approved, republishing
    creates a fresh PENDING row needing manual owner re-approval, so the
    credit does not come back on its own. DELETE has no validation step that
    can fail, so it stays retract-first.
    **An address edit nulls `property_id`** before the write, specifically
    when `row.address_key !== comp.address_key`, never on an untouched
    address. `linkVaultProperties`' relink PATCH only ever fills a NULL
    `property_id` (`property_id=is.null`, so a re-import can't rewrite a
    link that already looks correct) — left non-null after an address
    change, a comp would keep pointing at the OLD building forever and
    `attachPropertyCoords` would stitch the old building's coordinates onto
    the corrected address in every future report.
    **The export must be complete or refuse.** It does NOT build on
    `vaultReadPayload`, which hard-caps at 1000 rows; it pages until an
    EMPTY page comes back, advancing the offset by the rows actually
    returned rather than by the page size, because PostgREST can honor a
    project-level Max Rows setting by returning fewer rows than requested
    with no error — treating a short page as "done" would silently truncate
    at whatever that cap is. It orders by `deal_date.desc,id.asc`
    specifically because `deal_date` alone is day-granularity and ties
    across many rows in an imported book; Postgres only guarantees stable
    OFFSET/LIMIT paging when the ORDER BY produces a unique row order, so a
    non-unique sort key can drop (or duplicate) a comp on a page boundary.
    It also JOINS `broker_properties` for `lat`/`lng` — those are not
    columns on `broker_comps` — and separately carries every populated
    per-type column (`clear_height`, `units`, `lot_acres`, etc.), which ARE
    columns on `broker_comps` and ride along for free because the paging
    query passes no `select=`; `VAULT.exportColumns` then appends only the
    ones actually populated. Omit either source and a re-import silently
    drops that comp's specs or sends a private address back out to a
    third-party geocoder, which migration 017 and `parseCoord` exist to
    prevent.
    No migration was needed for any of this: `broker_comps.upload_id` was
    already nullable (a hand-added comp belongs to no import, so it can only
    ever be removed per-comp, never by deleting an import), and every new
    field these routes touch already had a column.
  - **Blended comps** (server half, 2026-08-06). A broker's own vault comps
    appear inside **their own** reports, flagged `private: true` with
    `source_type: "broker_vault"`, plus a top-level `private_count`. Rules in
    the pure, tested **`blend-comps.js`**; the `user_id`-scoped read is
    `vaultCompsForReport()` in server.js. Spec:
    `docs/superpowers/specs/2026-08-06-blended-comps-data-contract.md`.
    **Blending happens at SERIALIZATION only** — the exact mirror of
    `gateReport()`'s rule. It runs inside the `gate()` closure in `/api/comps`,
    which is the single funnel all four exits route through, and therefore
    downstream of `storeCachedSearch()`, `harvestComps()` and
    `maybePublishMarketSnapshot()`, all of which keep seeing the **public**
    report. Blend earlier and it fails silently twice over: before the cache
    write, one broker's private book is served to the next visitor who searches
    that address (`search_cache` is keyed by property, not by user); before the
    harvest, the rows enter the public corpus permanently with nothing alerting
    anyone, because that path swallows its own errors. **`POST /api/share`
    strips them** — it takes the report FROM the browser, and a broker's
    browser holds a blended one. A vault comp claims no public provenance: not
    `verified` (a public claim, earned by vouching in the public records) and
    not the enum default (which normalizes to `estimate` and would stamp a real
    closed transaction as guesswork). An empty vault returns the **same report
    object**, with no `private_count` key at all, so a non-broker's response is
    byte-identical to before the feature existed.
  - **The `/vault` PAGE lives in `vault-page.js`, not `server.js`** (moved
    2026-08-06). It is a web page, so it belongs to whoever owns the front end;
    as a 475-line block inside `server.js` it could not be edited without
    editing the server file, which made front-end and server work collide by
    accident. `renderVaultHTML(boot, { CN_LOGO, MARKET_CSS })` takes the site's
    shared chrome as an argument rather than copying it — a second copy would
    drift, and `server.js` already carries a keep-the-two-in-step ⚠ about that
    hazard. **The DATA is still resolved in `server.js` by `vaultReadPayload`,
    which owns the entitlement gate**; `vault-page.js` only decides how that
    data is drawn. Keep it that way — a read that happened there would be a
    read outside the gate.
  - **TWO DECKS, not ten peer sections** (Vault Direction U, approved and
    shipped 2026-08-10; card `vault/direction-u-two-decks.html`). The page is
    two products sharing one scroll, so it carries exactly two deck rules —
    serif label, ink rule, the deck's one action — and they are the level
    ABOVE `h2`. **Your book** holds the uploader, the market rollup and the
    comps; **Your pipeline** holds one table from a new lead through won or
    lost (leads and BOVs used to be two sections; they merged 2026-08-13).
    Five rules:
    - **`#addSec` is a panel, not a section, and ships CLOSED.** "Add comps"
      was a section above the comps table, so a broker with 200 comps opened
      their book and was handed an uploader. It is the book deck's action now.
      `setAddOpen()` is the single writer of its visibility (the label and
      `aria-expanded` ride with it); `applyFirstRun` only re-asserts the flag
      and deliberately does **not** force it shut, because `#res` lives inside
      the panel and an import that failed before it could raise the comp count
      would otherwise write its error into something invisible. `doImport`
      opens it for exactly that reason on the non-mapper path.
    - **Dragging a file anywhere over the page opens it.** `#drop` is inside
      that closed panel, so without the document-level `dragenter`/`dragover`
      handler drag-and-drop would silently stop existing. It is guarded on the
      book deck being visible (a 403 hides `#app`), not on a first-run page —
      the empty vault IS the two decks (2026-08-13).
    - **`.deck.hide` and `.strip.hide` are load-bearing.** Both classes set
      `display`, and both are declared BELOW `.hide` in the same stylesheet, so
      a plain `deck hide` loses the cascade and leaves a stray "Your book"
      rule. Found in a browser, not by reading. Same trap as
      `ACCOUNT_NAV_CSS`'s `[hidden]` line. Decks now ship visible; the line
      still matters if a future gate adds `hide`.
    - **The empty vault is the real vault** (2026-08-13). Both decks and the
      trust line (including zeros) always show. `#bookEmpty` / `#pipeEmpty`
      are invitations, not a numbered `#firstRun` page. Spec:
      `docs/superpowers/specs/2026-08-13-vault-empty-workspace-design.md`.
    - **One hidden-sibling CSS patch, `#rollupSec.hide + #compsSec`.** It
      replaced two others (`#firstRun.hide + #addSec`, `#addSec.hide +
      #mapSec`), which stopped being needed once those two became divs. Keep
      such rules scoped to the specific pair — a blanket hidden-sibling rule
      also strips dividers that are correct.
  - **The vault DASHBOARD** (2026-08-06, re-ranked 2026-08-10). `/vault` leads
    with a market rollup —
    one card per `market` + `property_type`, the same pair the lead coverage
    below it is keyed on — then a median-$/SF-by-year chart and a
    repeat-property list, all three scoped by one filter row. **Since Direction
    U those three are collapsed `<details class="dbox">` under a three-cell
    reading strip** (`renderStrip`), not three bordered panels in front of the
    table: measured on a seeded book the comps table moved from 4363px down
    the document to 1101px. Two rules for the strip. Its median comes from the
    same `psfList`/`median` pair that seals the table's own footer, so the two
    can never quote different figures. And a cell is a `<button>` **only** when
    the panel behind it is actually showing — an affordance over a hidden panel
    is a control that does nothing. `renderGutCheck` and `renderRepeats` feed it
    through the module-level `lastGut`/`lastReps` rather than a changed return
    type, because the return value is the outlier map the table reads. Four
    further rules:
    - **The page fetches `?limit=1000` and filters in the BROWSER.** It used to
      re-query with `market=`/`type=` params, which cannot work now: the rollup
      counts the whole book, and server-side filtering leaves the browser
      holding only the current slice. It also fixes a real bug — the route
      defaults to `limit=200`, so a broker with 400 comps was shown half their
      vault with nothing saying so. Past 1,000 the page says it is truncated
      rather than under-reporting silently.
    - **Every $/SF figure comes from the stored `price_per_sqft`, never derived
      here.** `broker-vault.js` writes that column for **sales only** and
      leaves it null on a lease, because an annual rent ÷ size is $/SF/yr and
      would corrupt any median it entered. A card with no priced sales shows
      its comp count instead of a fabricated number.
    - **Repeat properties group on `market` + address, never address alone.**
      Street names repeat across a metro; on the first test book that merged a
      Boise building and a Meridian building at the same house number into one
      property with three deals.
    - **It reads none of `vault-api.js`'s `INTERNAL_FIELDS`** (`user_id`,
      `address_key`, `dedupe_key`) — it keeps its own copy of `addressKey`
      instead — so those can be dropped from the response whenever Owen wants.
      `test/vault-page.test.js` pins that, and pins the thing this file is
      uniquely able to break: the whole page, including ~550 lines of browser
      JS, is one template literal, so a stray `${` or a single-backslash escape
      emits broken JavaScript and a blank workspace rather than failing loudly.
      That test compiles what the page actually emits.
  - **The EMPTY VAULT is the real vault** (2026-08-13; spec
    `docs/superpowers/specs/2026-08-13-vault-empty-workspace-design.md`).
    When a broker has no comps *and* no imports, `applyFirstRun()` still
    hides the comps table and the imports list, but both decks and the
    trust line (zeros included) stay up. `#bookEmpty` is the book's body
    (upload invitation + privacy disclosure + template / Choose buttons);
    `#pipeEmpty` is the pipeline's (watch-market form, visible, not
    collapsed). `#firstRun` as a numbered two-card page is gone. Four
    rules:
    - **It keys on comps AND uploads, never comps alone.** A broker whose
      import was entirely rejected, or who deleted every comp out of one, has
      been through the door already; showing the book invitation again reads as
      their work having been thrown away. Pipeline empty is independent: a
      waiting lead must show even when the book is empty.
    - **The trust line shows zeros.** It exists to let a broker watch
      "0 published" stay at zero. Hidden until 2026-08-13 because it sat over
      numbered onboarding cards; with the workspace showing, the zeros are
      the honest empty state. Privacy copy still lives in `#bookEmpty`'s
      collapsed "Required columns & privacy details" disclosure, is restated
      on the trust line, and is made again at publish. Do not put the fine
      print back on the invitation face without asking.
    - **There is exactly ONE `<input type=file>`.** Its `accept` includes
      `.pdf` and the image types as well as `.csv`. `#bookPick` and the
      ordinary "Add comps"
      button both call `$("file").click()`. Two inputs would mean two values
      and two change handlers, and an upload started from one would be
      invisible to the other's result message. Table PDFs and screenshots
      land in `#pdfSec`
      (the confirm table), not the CSV column mapper. A test pins this, and
      pins the accept list item by item — a missing image type greys the
      broker's own file out in the dialog with nothing on the page saying
      why. `isExtractFile()` in the browser is a courtesy check only (it
      reads the name and the browser's `type`, both caller-supplied); the
      server's byte sniff is the real one.
    - **The coverage form is ONE relocating node** (`#covForm`). Its home is
      `#pipeEmpty`; `renderPipeline` moves it into `#covBox` once a lead or
      BOV row exists, and walks it home when the pipeline is empty again.
      Never add a second copy — it would be a second thing to keep in step
      with the coverage rules in `broker-leads.js`.
    Empty tables are hidden throughout rather than shown with a header row and
    a "nothing here yet" line — three of those stacked up was the thing that
    made a new vault read as broken rather than new.
  - **That 503 is the opposite of the rest of the app, deliberately.**
    Everywhere else a Supabase failure falls back to a local file so nothing is
    lost. Here the file WOULD be the loss — Render erases its disk on every
    deploy, so a broker's uploaded book of business would silently vanish days
    later. The vault has **no file fallback**; it refuses instead.
  - **`market` is attached in server.js with `marketOf()`, never in
    `broker-vault.js`.** It has to agree byte for byte with `comp_corpus.market`
    so a comp published in step 2 needs no translation, and a second copy of
    that parse would be a second thing to keep in sync (the repo already has
    one such pair — `compWeight` — and it carries a ⚠).
  - **`dedupe_key` is an explicit column**, like `comp_corpus`'s, not a
    multi-column unique constraint. Postgres compares NULLs as DISTINCT, so
    `unique (user_id, address_key, deal_date, price)` would let an *unpriced*
    comp (explicitly allowed — brokers track undisclosed deals) re-import
    without limit on every upload.
  - **`broker-vault.js` rejects rather than guesses.** "1.2M", a bare number as
    a date (Excel's serial), and day-first dates are all refused with a line
    number rather than stored as a best effort — a wrong number in a broker's
    own records is worse than a rejected row, because nobody will notice it.
    Pure and tested (`npm test`, 64 cases).
  - **Every read is scoped by `user_id`**, including the DELETE — without it,
    knowing another broker's upload id would be enough to delete their data.
  - **The property dimension** (`migrations/016-broker-comps-star.sql`, **run
    before deploying**). `broker_properties` holds one row per building per
    broker; `broker_comps.property_id` links to it. It exists because
    `address_key` was written on every row since 013 and read by **nothing** —
    no index, no table, no FK — and it is the one dimension a broker slices by.
    There is deliberately **no market dimension** (it would duplicate the
    corpus vocabulary and become a second thing to keep in sync) and **no date
    dimension** (`date_trunc()` answers everything without a fiscal calendar).
    Three rules: the migration is **purely additive** and a test fails the
    build if a destructive statement appears in it, because there is no staging
    database to rehearse against; `property_id` is **nullable on purpose**, so
    migrate-then-deploy and deploy-then-migrate both work with no window where
    an upload fails; and `linkVaultProperties()` **never throws** — the
    dimension is an index onto a broker's book, not part of it, so a failed
    link costs a join while a failed upload costs a broker their spreadsheet.
    Two brokers on the same building get **separate** property rows; sharing
    one would make each one's activity inferable from the other's.
    `broker_comps_reporting` is a view for the service role and direct SQL
    ONLY — it carries `user_id` and every private measure with no per-caller
    scoping, so it must never be exposed to the anon or authenticated roles.
  - **The vault API's shape is a contract, not the table's shape.**
    `vault-api.js` owns it and `toApiComp` is an **allowlist**, so a new
    storage column cannot reach the browser by default and a dropped one fails
    the build. `user_id`, `address_key`, `dedupe_key` and `property_id` are
    omitted as plumbing. Do not go back to answering `comps: rows`.
    `PROPERTY_FIELDS` is the second list: fields a comp inherits from its
    **building** rather than from `broker_comps` (`lat`/`lng`/`geo_source`).
    They are separate because the contract tests check `API_COMP_FIELDS`
    against the `broker_comps` schema **both ways**, and a `lat` in there would
    correctly fail — the fix was a second checked list against
    `broker_properties`, never loosening the first.
  - **Private-comp coordinates**
    (`migrations/017-broker-property-coordinates.sql`; spec
    `docs/superpowers/specs/2026-08-06-private-comp-geocoding.md`, AGREED
    2026-08-06). A broker's private comp used to be geocoded **by address, from
    their own browser**, on every report — so an off-market address left in a
    URL to the US Census geocoder and, on a miss, to OpenStreetMap with the
    broker's IP. `lat`/`lng`/`geo_source`/`geocoded_at` now live on
    `broker_properties`, filled from optional `lat`,`lng` columns in the vault
    CSV. Five things to know:
    - **This is only the STORAGE half. It fixes nothing on its own.**
      `renderMap()` in index.html still geocodes every comp unconditionally
      with no check for coordinates it already carries, so until the display
      guards land these columns are stored and ignored. Stated in §2 of the
      spec; it is why the work was contracted in two halves.
    - **`parseCoord()`, NOT `parseNumber()`.** The spec said to reuse
      `parseNumber`, which **rejects negatives** — it would refuse every US
      longitude, including the spec's own Boise example. Refuses DMS and
      bearings too: reject rather than guess, because a wrong coordinate puts
      a building on the wrong continent and nobody will recognise it as wrong.
    - **Coordinates ride on `_lat`/`_lng`, which are NOT columns.**
      `broker_comps` has no coordinate columns and PostgREST 400s on an unknown
      one, which on the upload path refuses the broker's whole spreadsheet.
      `PROPS.stripCarriedKeys()` removes them before the comp insert.
    - **They are written by a separate, guarded PATCH, never the property
      upsert.** That upsert is `resolution=merge-duplicates`, which replaces
      the columns in its payload — coordinates travelling in it would mean a
      later upload that omitted them **wiped** the ones already stored. The
      PATCH filters `lat=is.null`, so a located building is never rewritten.
    - **`geo_source` is only ever `'broker'`.** `'census'` is import-time
      geocoding — step 2, deferred by the owner's §7 decision (zero real vault
      uploads exist, so the question it answers cannot be measured yet, and it
      is where the rate limit and retry policy would live). A test pins this.
  - **Gut check** (v4 slice 1, 2026-08-08; spec
    `docs/superpowers/specs/2026-08-08-gut-check-design.md`). A panel on
    `/vault` compares the broker's per-bucket median $/SF and cap rates
    against two separately-labeled public benchmarks: corpus quartiles
    (floor 4 priced sales, same usability rules as retrieval) and the
    market page's model figures. Rules live in the pure, dual-export
    **`gut-check.js`** (browser global `GUTCHECK`, served with `max-age: 0`
    exactly like `valuation.js` and for the same reason). `POST
    /api/vault/benchmarks` serves the benchmarks and **reads no vault
    rows** — the broker's numbers stay in their browser, so this feature's
    server surface cannot leak a private comp even in principle. It still
    answers through `openVault` for gate consistency. Verdicts are
    untrended and framed "worth a look", never "your data is wrong";
    individual sale comps >25% outside the band get an outlier marker in
    the comps table. No migration.
  - **BOV tracker** (v4 slice 2, 2026-08-08; spec
    `docs/superpowers/specs/2026-08-08-bov-tracking-design.md`). The broker's
    private log of BOV engagements from any source, statuses
    open/delivered/won/lost (vocabulary validated, transitions deliberately
    unpoliced). Rules in the pure, tested **`bov-log.js`**;
    table `broker_bovs` (migration 019), vault-class private: DB-only, every
    read/write user-scoped, read by no owner surface (`/admin`'s
    intro-requests card is unchanged). Intro requests auto-create rows
    (non-blocking), and `GET /api/broker/bovs` seeds from
    `lead_intro_requests` only when the broker's log is EMPTY, mirroring
    `/api/broker/leads`'s own coverage-seeding rule: seeding on every open
    resurrected a row the broker had just Removed (status reset to open,
    notes gone), so it now runs only to recover history for a log with
    nothing in it yet, and `?noseed=1` skips it for one call the same way
    `/api/broker/leads` does, which is what the page's post-delete reload
    passes. From there the intro handler's auto-create is what keeps a
    non-empty log current. Idempotent via `unique (user_id, lead_id)`, and
    the reason migration 019 has no SQL backfill (`marketOf()` is JS).
    Routes go through `requireBroker`. Manual adds log a PII-free `bov`
    analytics event. Lapse locks the log, never deletes it.
    **On `/vault` those rows share one table with the lead inbox**
    (2026-08-13; spec
    `docs/superpowers/specs/2026-08-13-vault-pipeline-deck-design.md`). A
    lead is a `New` stage whose only action is requesting an introduction;
    a BOV keeps its status select and Remove. The four tiles became a
    five-cell stage strip (New / Open / Delivered / Won / Lost) plus a note
    line for this year and the win rate (dash under 3 decided). Coverage
    collapses under "Markets you watch". No new endpoint — the browser
    already had both payloads.
  - **The credit identity is STATED, never inherited** (2026-08-12).
    `POST /api/vault/identity` writes `broker_profiles.display_name` and
    `.company`, creating the row if needed; `vaultReadPayload` returns an
    `identity` block (`display_name`, `company`, `creditedTo`) so `/vault`
    can name the credit BEFORE a publish rather than after one. Four rules.
    **`creditName(profile)` reads the profile only** — the old `user.name`
    fallback is gone, and that fallback was the bug: the publish confirm
    promises "credited to your firm by name", a vault-first broker has no
    profile, so their comps were credited to whatever they typed at signup
    and `submissionRowFrom` copied that string into `broker_company`, which
    is published as their firm. Nobody chose it, so nobody could correct
    it. **An unstated identity now returns `""`**, the publish route
    refuses with `needs_credit_name`, and the vault opens the form in
    place — a one-time question instead of a silent wrong answer.
    **It never touches `public`**: broker-directory.js's TWO CONSENTS rule
    holds, so stating a firm name creates a row that is private by default
    (`public` defaults false in 003) and the opt-in stays on `POST
    /api/broker/profile`. Verified 2026-08-12 — after saving an identity,
    `/broker/<slug>` still 404s and the market page lists nobody. **The
    page prints `creditedTo` verbatim** and never recomputes the
    company-then-name preference, or it could promise a name the write
    would not produce; a test pins that by disagreeing the two on purpose.
    Rules in the pure, tested `validateIdentity` (at least one field must
    survive trimming; the two stay separate columns because a firm is not
    a person; control characters stripped since these strings reach a
    public page, formula shapes left to `guardFormula` at `csvCell` so a
    firm really called "+Plus Realty" keeps its name).
  - **The template carries its own rules, as `#` lines** (2026-08-10; spec
    `docs/superpowers/specs/2026-08-10-vault-template-self-documenting-design.md`).
    `isCommentRow` skips any body row whose FIRST cell starts with `#`, and
    `templateCsv` ships the required columns, the six property types, the
    date format, what the number parsers really accept, and the optional
    per-type columns as exactly those lines. They used to live in the single
    example row's `notes` cell, where the broker's first edit deleted them.
    Four rules. **Only the first cell decides**, which is what lets the three
    example rows sit fully populated under their correct headers with `#` in
    the address cell — so the file we hand a broker can never plant a fake
    comp in their own book, and they activate a row by typing an address over
    the `#`. **The skip is counted, never silent**: `parseUpload` returns
    `commented`, the route passes it through, and `/vault` says "N note lines
    ignored" — a broker's own export with a `#` row is refused today anyway
    (no street number), and this keeps that visible rather than trading a
    loud rejection for a silent drop. **`total` counts data rows only**
    (body minus comments), because it is what `imported` is compared
    against and "imported 3 of 16" reads as data loss. And **the guidance is
    pinned to the constants by a test** — every `PROPERTY_TYPES` value and
    every `OPTIONAL_SPEC_COLUMNS` name must appear in the template, so adding
    a per-type field through the `add-comp-field` skill fails the build until
    the template names it. Keep the text TRUE: `parseMoney` strips `$` and
    commas, `parseNumber` accepts `45,000 SF`, `parsePercent` accepts
    `6.25%`; the old template said "no $ signs" and was simply wrong.
  - **The CSV column mapper** (2026-08-10; spec
    `docs/superpowers/specs/2026-08-10-vault-csv-column-mapper-design.md`).
    A broker uploads their own export and maps its columns once. `POST
    /api/vault/inspect` reports headers, real sample values and a suggested
    mapping; `/api/vault/upload` takes an optional `mapping`, and absent it
    behaves byte for byte as before. Six rules a future editor will
    otherwise break: **a target is suggested only when exactly ONE column
    claims it**, which is how the old "we do not guess column names"
    decision survives (two columns aliasing to `price` suggest neither);
    **a rate-shaped header may claim nothing by ALIAS** (`isRateHeader`,
    2026-08-11, tested on the RAW header because the "/" carrying the
    meaning strips away in normalization) — "$/SF" normalizes to bare
    `sf`, which made it the sole claimant of the size alias on the first
    real broker file, so the mapper confidently suggested importing
    $68.11 as a 68 sq ft building; an exact target name still maps, so a
    literal "Price Per Unit" column keeps its real multifamily column;
    **the screen is always shown unless every header is already one of
    ours**, because only four fields are required per row, so a file with
    an unrecognised "Sq Ft" column imports today with every size null and
    nothing saying so; **unmapped columns are renamed `_ignored_<i>` rather
    than left alone**, or a literal `price` column the broker chose not to
    map would shadow the one they did; **the remembered mapping is only
    ever a pre-selection**, never auto-applied, which is what makes it safe
    to key on the broker rather than on a fingerprint of their header row
    (if the screen is ever made skippable on a remembered mapping, that
    stops being true and the header signature becomes necessary); and
    **the normalized header vector is produced in exactly one place**,
    `normalizedHeaderRow(rawHeaders)`, and `inspectCsv`, `validateMapping`
    and `parseUpload` all route through it rather than calling
    `normalizeHeader` directly. A header can be real and still normalize to
    nothing — `normalizeHeader` strips every non-alphanumeric character, so
    a column headed `$`, `#`, `%` or `($)` (the comment above
    `TEMPLATE_COLUMNS` already names `$` as a header brokers use for price)
    reduces to `""` and would vanish from the mapping screen entirely: not
    listed, not mappable, not even named in the "will be ignored" line. That
    is the exact silent-drop failure this feature exists to prevent, so such
    a header now gets a positional `column_<i>` key instead; a truly blank
    header still yields `""` and stays excluded, so trailing commas still
    cost nothing. Computing the vector separately in any one of the three
    call sites is what broke the round trip the first time this shipped: the
    inspection screen offered `column_0` as a mappable source, and the
    import route, keying its own copy off a bare `normalizeHeader` map,
    refused it as a column the file did not have. `suggestMapping`
    deliberately does NOT route through `normalizedHeaderRow` — it only
    produces optional suggestions, never a required key, and a synthetic
    `column_N` can never match a semantic alias like `sale_price`, so
    running it through the positional fallback would only manufacture
    suggestions nobody could recognise.
- **Broker lead inbox** (v1, 2026-08-05). DDL in
  `migrations/015-broker-lead-inbox.sql` (**run before deploying**). Rules
  live in the pure, tested **`broker-leads.js`** (coverage matching, the lead
  anonymization allowlist, coverage seeding, notify dedupe); server.js owns
  every read/write and computes `market` with `marketOf()` before calling in.
  `GET|POST|DELETE /api/broker/coverage` — the broker's list of market +
  property-type pairs to watch. `GET` lists it; `POST` adds one pair
  (validated against `LEADSVC.isCanonicalMarket` and `VAULT.PROPERTY_TYPES`,
  capped at 200); `DELETE?id=` removes one, scoped by `user_id`.
  `GET /api/broker/leads` — the inbox itself: BOV leads from the last
  `LEAD_WINDOW_DAYS` (90) days matching the caller's coverage, anonymized to
  market/type/size/date only (`LEADSVC.anonymizeLead` — name, email, phone,
  company and street address never leave the handler). **DB-only, no file
  fallback**: any read error is a 503, because an empty inbox on error would
  misreport demand as zero. On first open with no coverage rows, seeds
  coverage from the broker's own approved comp submissions
  (`LEADSVC.seedCoverageFromSubmissions`); `?noseed=1` skips that reseed so a
  market a broker just removed stays removed for the rest of the page
  session. `POST /api/broker/leads/intro` — a broker raising a hand for one
  lead. Owner-mediated: emails the owner naming the broker, never contacts
  the property owner and never sends broker PII anywhere it didn't already
  go. Coverage-gated (mirrors the inbox's same source + window filters, so a
  broker cannot request an intro to a lead they cannot see) and deduped via
  `unique(lead_id, user_id)` on `lead_intro_requests` — a repeat request
  answers `{ ok: true, already: true }` rather than emailing the owner twice.
  All three routes go through **`requireBroker`**, a deliberate second copy
  of the vault's `openVault` gate (same three refusals, same order: 401 not
  signed in, 403 not a broker, 503 no database) — `test/routes.test.js`
  exists specifically to catch drift between the two copies.
- `GET /healthz` — health check for hosting platforms.
- `GET /robots.txt`, `GET /sitemap.xml` — SEO endpoints built from `SITE_URL`.
- `GET /` — serves `index.html`. The same handler covers `/index.html`,
  `/desk`, and `/r/<id>`, and matches on the **path only** (`req.url` split at
  `?`). That matters: Stripe returns from checkout to `/desk?checkout=success`,
  and an exact `req.url` match 404'd it — along with every campaign link to
  `/?utm_source=…`. Every other route in server.js still tests `req.url`
  directly, so keep the query string in mind when adding one.

**`index.html`** — the entire front-end (Tailwind vendored as `tailwind.css`,
html2canvas via CDN).
Holds the form, password gate, results rendering, sortable table, and the
CSV / PNG / Print-to-PDF exporters. The main form's second slot is the
Building size (SF) field; the property type is chosen at the verification
step, and the confirm dialog blocks the run until a type is resolved.
Contains **no secrets**.

**Private comps in the front end** (the display half of blended comps, 2026-08-06;
server half and spec are under the broker vault above). A comp the server flags
`private: true` renders as an ordinary comp everywhere — table, cards, map,
chart, tiles, curation and the valuation all read it without special-casing,
which is exactly what the one-flagged-array contract bought. It carries the
`broker_vault` tier in `SOURCE_TIERS`, badged **"From your vault"**: an
ownership statement, never the green Verified badge, which is a public claim a
private row has not earned. Two rules matter when editing anything down here:
- **Exports read `exportableComps()`, never `includedComps()`.** That is the
  only difference between the two, and it is the difference between a broker's
  private book staying private and being emailed to a client. Rows and cards
  also carry `no-print no-capture`, which drops them from the printed page and
  from the html2canvas PNG. `/api/share` strips them **server-side** and does
  not trust this file.
- **The valuation still counts them, so every export discloses the gap.** The
  file is short by N rows while the value above it is not, and an unexplained
  difference reads as lost data. `renderPrivateNotice()` says so on screen (and
  is deliberately NOT `no-print`/`no-capture`, so it survives into the very
  exports that dropped the rows); the CSV title row and the XLSX Valuation
  sheet repeat it. Change the filter and you have to change all four.
- **A private comp's ADDRESS is never sent to a third party** (2026-08-06; spec
  and Owen's §7 decision in
  `docs/superpowers/specs/2026-08-06-private-comp-geocoding.md`). Two guards,
  both in `renderMap()`'s geocoding, and both applied in **two** places — the
  main pass and the no-coordinates rescue loop above it, which is otherwise a
  second door straight past them:
  - **Skip.** A private comp with finite `lat`/`lng` is not geocoded at all.
    That pass otherwise geocodes EVERY comp unconditionally, treating supplied
    coordinates as a first-paint guess for the geocoder to refine — right for a
    public comp, wrong for a vault one. Without this guard, coordinates in a
    broker's upload would buy nothing.
  - **No third party.** `geocodeAddress(addr, { noThirdParty: true })` stops at
    our own `/api/geocode` proxy (US Census behind it) and never falls through
    to Nominatim, which is browser-direct and so would receive the address
    **and the broker's IP**. On a miss the comp gets no pin, deliberately —
    same rule as Street View's "the actual property or nothing".
  A refused lookup is **not cached**: `geoCache` is keyed by address alone, so
  storing that miss would deny the Nominatim fallback to the public callers
  still entitled to it. Public comps are untouched by all of this.
  Owen owns the other half (migration 017, `lat`/`lng` in the vault CSV,
  `toApiComp` lifting them onto the comp); **import-time geocoding is
  deliberately deferred**, and moving `/api/geocode` to POST ranks above it
  when this is picked up again.

### Non-obvious flows to know before editing

1. **Web-search response parsing (`server.js`).** A web-search response is a mix
   of block types. The code keeps only `block.type === "text"`, joins them, then
   `parseCompJson` defensively strips ```` ```json ```` fences and slices the
   outer `{...}` before `JSON.parse`. The model is told to return raw JSON, but
   this guards against stray text. If you change the output shape, keep the
   "return ONLY JSON" instruction intact.
   Since 2026-08-04 a FAILED parse is rescued in layers before the expensive
   full retry: first the first BALANCED object is salvaged
   (`extractFirstJsonObject` — the observed failure mode is a complete report
   plus trailing junk containing a brace, which fools the first-{-to-last-}
   slice), then one no-tools repair call (`repairCompJson`) asks the model to
   re-emit the same JSON corrected; `solo()`'s full re-search only runs if
   both fail. Every layer logs (`salvaged` / `repaired` / `retrying`), so
   Render logs show which fires and how often.

2. **Property-type-aware reporting is split across both files.** `buildPrompt` in
   `server.js` switches guidance per type (Industrial/Office/Retail/Multifamily/
   Land/Residential). **Every type also requests its own extra per-comp fields**,
   declared once in the `TYPE_COMP_FIELDS` map above `buildPrompt` (field keys +
   the prompt sentence describing them), which widens that type's JSON comp
   shape: Industrial `clear_height`/`dock_doors`, Office `building_class`/
   `floor_plate`, Retail `center_type`/`anchor_tenant`, Multifamily `units`/
   `price_per_unit`, Land `lot_acres`/`price_per_acre`/`zoning`, Residential
   `beds_baths` (a paired `lot_size` field was tried and dropped — the model's
   search budget doesn't stretch to a per-comp assessor lookup, so it came back
   empty on every test comp; see the note above `TYPE_COMP_FIELDS.Residential`).
   The front-end mirrors it in the `TYPE_COLUMNS` map
   feeding `columnsForType()` in `index.html`, where each column's `after` key
   names the column it sits behind (specs follow **Size**, per-unit/per-acre
   pricing follows **$/SF**); the active `COLUMNS` array is rebuilt per search in
   `renderResults()`. **A per-type field now spans up to four maps** —
   `TYPE_COMP_FIELDS` (server.js, the source of truth), `TYPE_COLUMNS`
   (comp-table columns), `TYPE_SUBJECT_FIELDS` (the subject-property form
   inputs, see flow 4), and `ALT_BASIS` (only for a denominator the market
   quotes, like units or acres). **The `add-comp-field` skill is the checklist
   — use it rather than working from memory.**
   A further place matters for durability: `harvestComps()` writes one flat corpus
   row per comp using `ALL_TYPE_COMP_FIELDS`, so the Supabase `comp_corpus` table
   needs a column per field. **Write the ALTER TABLE as the next numbered file
   in `migrations/` and run it before
   deploying a new field** — PostgREST 400s on an unknown column, which makes
   harvesting fall back to the ephemeral file and quietly lose data.
   `ALL_TYPE_COMP_FIELDS` is also in the `select` of `corpusRowsForMarket()`,
   so a missing column breaks **reads** too: retrieval returns empty, every
   market looks uncovered, and the corpus hit rate pins at 0%. This has already
   happened once (2026-07-27) and went unnoticed for weeks because both paths
   swallow their errors; the corpus health alarm described under **Comp corpus**
   exists to make the next occurrence visible on `/admin` within one search.
   Verify after deploying a field:
   ```sql
   select c from unnest(array['clear_height','dock_doors','building_class',
     'floor_plate','center_type','anchor_tenant','units','price_per_unit',
     'lot_acres','price_per_acre','zoning','beds_baths']) as c
   where not exists (select 1 from information_schema.columns
                     where table_name='comp_corpus' and column_name = c);
   ```
   Zero rows means the schema is complete. Confirm harvesting actually resumed
   by watching `select count(*) from comp_corpus` rise after a search — the row
   count is the only unambiguous proof, since a fallback write still logs a
   `+N` line and still returns a normal-looking report.

3a. **Per-type vocabulary (`ASSET_NOUN` / `assetNoun` / `assetNounPlural` /
   `setHeroTitle` in index.html).** The report called every subject a
   "building", so a house got a hero reading "WHAT THIS BUILDING IS WORTH"
   and a pointer to "Building Size" beside a field labelled *Property size*
   (owner feedback 2026-08-10). Residential is a `home` (which also covers
   **condos and townhomes** — they have no type of their own, and a condo is a
   home); Land, **Multifamily** and **Retail** are a `property`; only
   Industrial and Office fall through to `building`, because only those two
   genuinely are one. Multifamily is deliberately NOT "apartment building" or
   "apartment community" (owner's call, 2026-08-10): the type spans duplexes
   and 300-unit garden communities and neither phrase is true across that
   range, while `property` is also the unit the report already prices on
   (`ALT_BASIS`). Retail is `property` for the same both-shapes reason —
   "building" fits only a single-tenant pad, "center" only an anchored center.
   Three rules: **it is related to `SIZE_LABELS` but deliberately not equal to
   it** — Multifamily and Retail keep "Building size (SF)" as the FIELD label
   because that really is the building square footage the valuation divides
   by, even though the asset above it is called a property; check both when
   adding a type, and expect them to differ; **plurals come from
   `ASSET_NOUN_PLURAL`, never `noun + "s"`**
   (that shipped "propertys" on Land); and **the hero heading is set at TWO
   seams** — `renderOwnerHero` and `beginAssembly` — because assembly puts the
   hero on screen a minute before the real render repaints it, so without the
   second one a house sits under the previous report's noun for the whole
   search. The basis line reads its field name from `SIZE_LABELS[meta.type]`
   and **not** from `#targetSizeLabel`, because a shared report renders
   somebody else's type into a form still labelled for whatever this visitor
   last searched.

3b. **The lookback hint is recomputed, never written once**
   (`refreshLookbackHint` in index.html). It used to be set only by
   `applyRecommendedLookback`, so moving the window off the recommendation
   left "Recommended for Industrial" under a 6-month selection — the label
   asserting that the reader's own override was our advice. It now derives
   from `selectedLookbackMonths()` and **clears entirely on any deviation**.
   A first pass reworded it instead ("24 months recommended for Industrial",
   which is at least true) and the owner rejected that: the complaint is about
   a recommendation label still sitting under a window the reader deliberately
   changed, and rewording leaves one sitting there. The note is a caption for
   the default, not standing advice. It hangs off **three** seams and needs all of them: the select's
   `change`, the custom box's `input` (which changes the window without
   touching the select), and `setLookbackControls`. It is also called from
   `syncSubjectFieldsToType`, because both startup restores (`?type=` and
   `lastPropertyType`) set the type through that function alone and would
   otherwise leave the hint naming the page-load default type. That call
   refreshes the HINT only and deliberately never applies the recommended
   WINDOW: a restore is not a fresh decision, and a deep link may carry its
   own lookback.

3c. **`subject_last_sale` — the subject's own prior sale** (2026-08-10). The
   report never looked up whether the subject itself had recently traded, so
   a Bensalem property that sold a year earlier for $12.45M got a report that
   never mentioned it. The model returns `{ date, price, source_url }` and
   `renderSubjectLastSale` draws one line under the approaches. Four rules.
   **It costs no extra search by construction**: the ask rides on the
   `SUBJECT SIZE` step, whose assessor/parcel/listing pages already carry the
   sale history, and when `wantsSize` is false the wording drops to
   opportunistic rather than buying a search out of the comp budget. **It is
   evidence, not a fourth figure** — never put it in the ledger, because a
   years-old price shown big reads as a current valuation. **It is normalized
   server-side** (`normalizeSubjectLastSale`): no date means the whole field
   is dropped (a price with no date is unplaceable in time), and a non-http
   `source_url` is discarded before it can become an anchor href. **It is not
   a comp** — the prompt forbids it appearing in `comps`, and it is never
   harvested into `comp_corpus`, which holds comps and not a property's own
   sale of itself.

3d. **`subject_assessed` — the county's assessed value** (2026-08-14). Same
   ride-along as last-sale: the SUBJECT SIZE assessor pages already print the
   taxable/assessed figure, so it costs no extra search (`wantsSize` first;
   opportunistic otherwise). The model returns `{ value, year, source_url }`.
   **It is a cross-check, never a headline** — Low/Likely/High stay sales-comp
   or income math, and it is not the cost approach (that row stays "not
   modeled"). `assessedApproachEntry` draws one **County assessment** row in
   `#ownerApproaches` before the cost row, on every hero branch including the
   dashes branch when a value is present. **Value is required, year is not**
   (the opposite of last-sale): `normalizeSubjectAssessed` in `report-parse.js`
   drops the key without a parseable positive value, keeps a 4-digit tax year
   in 1990…current+1 (caller passes `now`), and strips non-http URLs.
   **Whole parcel or nothing** — land-only or improvements-only is a prompt
   refusal, not a parser guess. Disagreement with a dollar headline uses
   `VALUATION.outlierOf` (the same 25% nearest-edge rule as the table chips
   and the vault gut check), so the three cannot drift. Not harvested, not in
   `summary`, kept in shares (public record, not NOI-class). Spec:
   `docs/superpowers/specs/2026-08-14-tax-assessed-approach-design.md`.

3e. **`subject_asking` and `subject_year_built` — the live list price and vintage**
   (2026-08-14). A 1994 Rosedale house listed at $1.25M ($454/SF, at the
   neighborhood median) was reported at $1.65M because the comps were the
   expensive tail ($486–$653/SF) and a +5.5%/yr trend was applied in a
   declining market. The listing was sitting on the same page the size was
   read from. Four rules, the last-sale pattern reused. **It costs no extra
   search**: both fields ride the SUBJECT SIZE step. **The list price is
   evidence, not a fourth figure** — `renderSubjectAsking` draws one line
   under the approaches; `askFit` (pure, in `valuation.js`, same 25% rule as
   `outlierOf`) names a gap of more than 25% on the trust line and never
   changes the range. **Vintage is a `compWeight` factor** — free pass
   within 15 years of `subject_year_built`, then halving per further 15
   years — so a 2024 teardown-rebuild does not price a 1994 resale at full
   weight. **Distance is the fifth** — free pass within 1 mile, then a
   4-mile half-life — so a sale across town does not pull like one next
   door; `distance_mi` rides `locked_basis` (never lat/lng). `year_built`
   rides `locked_basis` so free and Pro ranges still match. **User-typed
   asking price wins** (`askingRangeFrom`); the looked-up listing is the
   fallback that lights the comparison card when the visitor never typed one.

3. **All valuation math is client-side; the model only supplies market
   figures.** `renderOwnerHero()` in `index.html` computes the Low/Likely/High
   range from sale-comp $/SF (leases are excluded even on mixed searches) ×
   the subject SF — the user's entry wins over the looked-up
   `subject_size_sqft`, and a looked-up size is auto-filled into the form
   input as an editable override. Since 2026-08-04 the browser also pre-fills
   an OSM footprint-derived size estimate during the address-confirm dialog
   (`maybeEstimateSize` in index.html: shoelace area × building:levels,
   `fpSize.v2` cache, gated to verified street-numbered non-Land addresses,
   labeled by `#sizeEstimateNote` and editable) — which doubles as a
   search-budget cut, since a size that rides the request skips the model's
   2-search size lookup. An Overpass outage is deliberately NOT cached as a
   miss. The prompt's PRICED BUT UNSIZED COMPS rule is the server-side
   sibling: a priced sale comp missing its size is worth one dedicated
   search, verified to lift priced-comp counts on thin markets.
   **This is the most expensive number in the report, because the hero
   multiplies it, and it shipped for nine days willing to measure any
   building.** On 2026-08-13 a Boise mobile home listed on Zillow at $52,000
   was reported at $795,000: "biggest footprint within 120 m" chose Bob's
   Bicycles, 10,064 sq ft, 81 m up W Fairview Ave, and 10,100 SF × the comps'
   $78/SF median is $795,000 to the dollar. Nothing was wrong with the comps
   — the model returned eight manufactured homes at $61-158/SF and said so.
   Three rules now stand between that footprint and the size box, and all
   three matter because each catches a case the others miss.
   **The footprint must PROVE the address** (`addr:housenumber` +
   `addr:street`) — the same filter `detectPropertyType` has applied since
   the Phoenix "Mandarin Super Buffet" bug, which this estimate and the map
   photo simply never adopted even though the photo's own comment claimed
   they followed the same rule. **More than one proving footprint refuses**,
   which is the deliberate OPPOSITE of `detectPropertyType` preferring the
   main mass: every part of a campus shares one property TYPE, while only one
   of them is the building whose square footage the value hangs on (38
   footprints prove #6728 at Fairview). **And a unit designator refuses**
   before the query is even made (`unitDesignatorOf`, shared with the photo
   gate — see `GOOGLE_MAPS_API_KEY` above for its vocabulary and tests).
   A refusal is cheap and self-healing: the server then spends the two
   searches it saved looking the size up from public records, which is what
   it did before this estimate existed and is better data than a measurement
   of the wrong building. `fpSize` went to **v2** because entries are now
   keyed by address as well as coordinates, and the bump retires the wrong
   sizes already cached in browsers.
   The backstop for every OTHER way a wrong size arrives (a record lookup, a
   typo) is **`VALUATION.subjectSizeFit`** — pure and tested, and the single
   owner of "how does the subject's size compare to the comps'", so the trust
   line's "N comps are a different size class" count and this warning can
   never disagree. When EVERY sized comp falls outside `compWeight`'s 0.5x-2x
   window and the subject sits entirely past one end of their range, the odd
   one out is the SUBJECT SIZE, not the comps, and the trust line says which
   figure to doubt and how far the range is extrapolated. That report already
   whispered "8 comps are a different size class and count less", which reads
   as a footnote about the comps rather than a warning that the headline was
   extrapolated 6.8× past every one of them. It deliberately stays quiet when
   the comps STRADDLE the subject (one far smaller, one far larger): that is
   a scattered comp set, which the weighting already handles, not a size box
   holding a number from a different building.
   NOI **never reaches the model or any public
   surface**: the income-approach cross-check divides the browser-held NOI by
   the model's `market_cap_rate_range`, `/api/comps` never receives it, and
   `/api/share` strips it before publishing. The same rule covers **debt
   terms** (`meta.assumptions.debt` — loan amount/rate/amortization, powering
   the debt & refi card), the **rent roll** (`meta.assumptions.rentRoll` —
   tenant-level rents behind the rollover card), and the op-ex card's **gross
   income** (`meta.assumptions.opex.grossIncome` — the expense-ratio
   denominator; the market band `market_opex_range` itself is market data and
   stays): private finances, stripped from shares. The DCF's
   four assumptions (hold/growth/discount/exit cap) are opinions, not
   finances, and stay in shares. So is the owner's own **cap rate**
   (`meta.subject.capRate`, the Refine field that replaced Price max on
   2026-08-10): browser-only like the NOI it divides, never in the
   `/api/comps` body and so never in the cache key, but NOT stripped by
   `/api/share` — it discloses nothing alone, because every surface it drives
   needs the NOI that already is stripped. It adds a second income-approach
   line beside the market's (`incomeApproachEntries` — one builder, 0-2
   entries, every hero branch spreads it so the two lines cannot drift or be
   ordered differently), carries the income approach outright when the model
   returned no `market_cap_rate_range`, and seeds the DCF at seed time only.
   A single rate renders a single figure: it is deliberately never widened
   into a band, since an invented spread would be indistinguishable on
   screen from one the comps earned. The one deliberate exception for all of
   these private figures (NOI, debt, rent roll, gross income) is the
   signed-in **portfolio**: a saved report's `meta.subject`
   and `meta.assumptions` are stored in the owner's own authenticated
   `portfolio_items` row so the analysis re-renders cross-device — any future
   share-from-portfolio feature must strip them the way `/api/share` does.
   **Report curation** (`meta.curation` — excluded comp keys, user-added
   comps, the owner's price-discovery read) is the same class of opinion:
   it persists in saved reports/portfolio and stays in shares. Added comps
   live ONLY in `meta.curation.added`, never in `data.comps`, so no server
   path (share, portfolio, harvest) ever ingests a user-authored comp into
   the corpus. The valuation math reads `includedComps()`; the table shows
   excluded rows greyed as an audit trail. Since 2026-08-09 the curation cell
   also carries a screen-only outlier chip (`buildOutlierChip`): an included
   sale comp whose displayed $/SF sits more than 25% outside the hero's
   displayed band (`VALUATION.outlierOf`, the same 25% rule as the vault gut
   check, `⚠`-paired) reads "{pct}% above/below the range". Chips derive at
   render from `currentPsfBand` (stashed by `renderOwnerHero`, one computation
   for both surfaces), are never stored, never print or capture, and never
   render on shared views; below 4 sale comps the band is the full spread, so
   they cannot fire. The hero's **comp scatter** (`renderCompScatter`, shipped
   2026-08-09) reads the same stash: a hairline number line under the ledger
   with one tick per sale comp at its own displayed $/SF, a tint spanning
   Low-High and a red mark at Likely, so the agreement the trust line asserts
   in words is visible. Four rules. **The axis spans the comps, not the
   band** — the band is the weighted interquartile range, so with 4+ comps
   roughly half of them sit OUTSIDE it by construction and an axis clipped to
   Low-High would hide half the evidence; the band is drawn inside the axis as
   the tint instead. **Ticks use the DISPLAYED figure**, never the
   trend-indexed weighted one the band is computed from, which is what stops a
   tick sitting outside the tint while `buildOutlierChip` calls that same comp
   in-range. **It only draws where the ledger above quotes the same unit** (so
   the per-unit/per-acre branch passes its own values through the same generic
   renderer, and the income-approach branch draws nothing) and only when
   `band.trimmed`, the same 4-comp floor as the chips. **It prints and
   captures on purpose**, being the evidence for the figures above it: hence
   no flex gap and no transform anywhere inside it, `print-color-adjust:
   exact` (every mark on the line is a background colour, and paper drops
   those by default — the file's only use of that property), and
   `ownerScatter` in `beginAssembly`'s `asm-hidden` list so the previous
   report's line can't hang under the next report's placeholder. Spec:
   `docs/superpowers/specs/2026-08-09-hero-comp-scatter-design.md`.
   The "Avg $/SF" stat tile and the
   market comparison read the MODEL's market-level figure and deliberately
   do not change with curation. Subject inputs
   persist in each report's `meta` (saved reports re-render without the
   form), and editing size/price/NOI after a report re-renders the
   hero/comparison/chart in place — no new billed search.

4. **Per-type subject details (the user's own building).** The "Your property
   details" section adapts to the property type: `TYPE_SUBJECT_FIELDS` +
   `renderSubjectFields()` (`index.html`) rebuild the inputs whenever the type
   changes, `readSubjectDetails()` reads them into a flat object, and the
   values ride to `POST /api/comps` as `subjectDetails` and persist at
   `meta.subject.details`. Four things are easy to get wrong here:
   - **The subject keys must be a subset of that type's `TYPE_COMP_FIELDS`
     fields.** `sanitizeSubjectDetails()` whitelists against exactly that list,
     so an input whose key isn't a declared comp field is silently dropped.
   - **`cacheKeyFor` includes the details**, appended only when non-empty so
     existing cache entries keep their keys. Without this a 48-unit and a
     6-unit building at one address collide and are served each other's comps.
   - **The type dropdown is gone from the visible form** (2026-08-08): a hidden
     `#propertyType` select remains the single source of truth, and the type is
     resolved at verification — OSM detection, per-address memory
     (localStorage `addrType.v1`), or a required pick in the confirm dialog
     (`typeResolution` in index.html: null | "detected" | "remembered" |
     "explicit"). The three resolved values split on **who** decided, because
     only a human's decision may outlive the address it was made about:
     `"explicit"` (a picker, a chip, a saved or shared report) survives address
     edits, while `"detected"` (OSM tags) and `"remembered"` (recalled from
     `addrType.v1`) are machine states about ONE address and both reset to null
     on an address change, after which that address's own memory then its own
     detection are consulted. Marking a recall explicit let address A's type
     survive onto address B, suppress B's memory, and overwrite it at submit.
     Every programmatic type change must go through `setTypeProgrammatic()` (or
     call `syncSubjectFieldsToType()` and mark `typeResolution` itself), or the
     subject inputs keep the previous type's fields. That function is a
     **no-op when the type is unchanged** — it resets the lookback window and
     re-renders (i.e. empties) the subject inputs, which is right after a
     change and destructive without one; the confirm dialog's "change" door
     pre-selects the current type, so a plain confirm used to wipe a typed
     lookback and typed details moments before the billed search. The select
     fires no `change` events anymore; nothing may rely on them. The
     `lastPropertyType` restore at startup is likewise guarded on
     `typeResolution === null`: a repeat visitor's hint may not overrule a
     decision a deep link or a restored report already made.
   - **The subject-edit listener replaces `meta.subject` wholesale**, so it
     re-reads `details` from the DOM rather than merging — anything not
     re-read is lost on the next keystroke.
   Unlike NOI/debt/rent-roll these are public property attributes, so they are
   sent to the server and **kept** in shared reports. `units` and `lot_acres`
   also drive the $/unit and $/acre cross-checks via `ALT_BASIS` /
   `altBasisEntry`, which render as entries in the hero's `renderApproaches`
   list (min 3 comps carrying the metric). Land is quoted in acres but the
   valuation path is $/SF, so `renderOwnerHero` converts acres × 43,560 when no
   SF is given.

5. **Currency (non-US searches).** The model quotes a foreign target's prices
   in the LOCAL currency and returns top-level `currency` (ISO code) +
   `usd_rate` (value of 1 unit in USD, bounded to (0, 10) — anything larger
   is treated as an inverted rate and dropped), normalized by
   `normalizeCurrency()` in server.js. The front-end never converts the
   math — `formatUsd()` and `displayMoney()` convert at the formatting layer
   when the report-header "Show in USD" switch is on, and `displayMoney`
   REFUSES ambiguous strings (ranges, European grouping, shorthand like
   "1.2M", negative heads) rather than risk a wrong number — refused values
   render raw. `harvestComps()` skips non-USD reports entirely (corpus rows
   have no currency column, so foreign prices would masquerade as USD —
   skipping beats an ALTER TABLE for a rare case). Note `marketOf()` yields
   just "Canada" for Canadian addresses (it parses "City, ST"); harmless
   while non-USD reports skip the corpus, but fix it before ever harvesting
   them. International searches run long — the first Canadian test search
   timed out under the old fixed 100s call ceiling and succeeded on retry;
   the deadline has since become per-call (`searchTimeoutMsFor`, ~260s for
   a full-budget report), sized so a healthy slow search finishes instead
   of being aborted after it was already billed.

## Deployment

Standard Node web service. Push to a Git host and deploy on Render/Railway/Fly/etc.
with start command `npm start`. Set `ANTHROPIC_API_KEY` (and `APP_PASSWORD` for a
public link) as host environment variables — do not rely on `.env` in production.
Every search is billed to the owner's Anthropic account, which is why a public
deployment should set `APP_PASSWORD` and/or a spend cap in the Anthropic console.
