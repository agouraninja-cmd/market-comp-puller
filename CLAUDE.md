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
The front-end is a single HTML file; a small Node proxy holds the API key so
the browser never sees it. The public contact email across the site is
info@compninja.co. The owner is not a licensed broker: site copy must say
we "connect you with a local broker", never that we are one, and every
valuation is labeled an automated estimate, never an appraisal.

There is no build step, no linter, and **no npm dependencies** — it runs on
plain Node (uses the built-in `fetch`, so **Node 18+ is required**).

There is one small test suite: `npm test` (`node --test`, no dependencies)
covers **`entitlements.js`** only — the Pro tier's decision table. It needs no
database and no running server, and it finishes in under a tenth of a second,
so there is no excuse for not running it after touching entitlement rules.
Nothing else in the repo is tested; do not assume a green suite means the app
works.

The one build-*ish* artifact is **`tailwind.css`**: a vendored, pre-generated
Tailwind build (checked in, served by `server.js`) that replaced the Play CDN.
It is NOT regenerated automatically — see the rule under "Restart rule".

## Running it

```bash
npm start          # = node server.js  -> serves http://localhost:3000
```

`npm start` only works if `node` is on PATH. On the owner's Windows machine Node is
a **portable (no-admin) copy**, so it's launched by full path instead:

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" server.js
```

### Restart rule (important)

- Editing **`index.html`** needs no restart — `server.js` reads it from disk on
  every request, so just refresh the browser.
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
- `RESEND_API_KEY` — optional. When set, every stored lead AND every broker
  comp submission fires an email notification via Resend's REST API (plain
  fetch, free tier is plenty). Fire-and-forget: a failing provider is logged
  but never breaks the request. Caveat: without a verified domain Resend only
  delivers to the address that owns the Resend account, so the account must be
  registered with the notify address itself.
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
- `GUEST_SEARCH_LIMIT` — optional (default 1, LIVE since 2026-08-03). Free
  report searches per **anonymous** visitor before a free sign-in is required —
  a signup funnel, not a paywall (any account clears it; spec in
  `docs/superpowers/specs/2026-08-03-guest-search-cap-design.md`). `0` = sign-in
  before any search; `off` = gate disabled entirely (the instant rollback lever).
  Tracked two ways, blocked when EITHER fires: the Supabase
  `guest_search_quota` ledger keyed by sha256(IP) (DDL in
  `migrations/011-guest-search-quota.sql` — already run in prod), and the httpOnly
  `cn_guest` cookie set once the quota is spent. **Cache hits count** (the
  funnel is the point); a failed search doesn't consume; admins and
  `x-admin-key` callers bypass. Enforced in `/api/comps` (403 +
  `signin_required: true`, which the client turns into the account modal);
  `/api/config` carries `guestSearch: { limit, used }` for the form hint and
  syncs the cookie the SSE exit can't set (its headers are already streaming).
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
  AND its address starts with a street number** (`snapMarkersToBuildings` —
  one batched browser-direct Overpass query per report after pins settle,
  two public endpoints tried in order, cached in localStorage
  `bldgCache.v1`): the footprint is the one signal proving the photo shows
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
  /api/comps` takes an optional `stream: true` in the body; when set, and only
  once the slow leg is actually about to run, the response switches to
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
  `readProgressStream` +`applyProgress` in
  index.html, driving the existing loading card; `comp` events render as
  plain text lines via `addLoadingCompLine` (5 most recent + a "+N more"
  lock line). Three fallback layers, all
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
- `PORT` — defaults to 3000. Hosts set this themselves.

### Admin access — comped Pro for the team

There is **no admin user** in this codebase: `ADMIN_KEY` is a shared secret
typed into `/admin`, `/dev` and `/contacts`, and `users` has no `is_admin`
column. So "is this an admin?" is answered by **possession of that key**, which
`isAdminRequest(req)` reads two ways:

1. the **`x-admin-key` header** — how machine callers have always identified
   themselves (`gen-market-seed.js`, the dashboards' own fetches); and
2. the **`cn_admin` cookie** — how a browser carries it. The dashboards keep the
   key in `sessionStorage`, which is scoped to **one tab**, so a developer who
   unlocked `/admin` and then opened the app in a second tab would silently be a
   free user again. `POST /api/admin-access` trades the key for this cookie, and
   all three dashboards call it (`grantAdminAccess()`) the moment their own key
   check passes.

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

`MODEL` is hard-coded in `server.js` as `claude-sonnet-4-6`. If the API returns a
404 for the model, list available models via `GET https://api.anthropic.com/v1/models`
with the key and update the constant — an earlier model ID was retired.

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
  normalization is a guarantee. **Cached**: identical requests
  within a 30-day TTL (7 days until 2026-08-03 — widened as a cost lever) are
  served from the `search_cache` layer (Supabase table
  `search_cache`, keyed by a SHA-256 of address+type+note+window+size+a
  signature of the offered verified comps — so approving a broker comp busts
  the cache for that type — plus a signature of `subjectDetails`, appended only
  when non-empty so pre-existing cache entries keep their keys; in-memory Map +
  file fallback when Supabase is unconfigured). A cache hit does NOT call Anthropic and does NOT count against
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
  a matching `source` column). Rate-limited per IP.
- `POST /api/share` — publishes the current report (`{ data, meta }`) under a
  short random id so the visitor can share the link; returns `{ id, url }`.
  Strips `meta.subject.noi` and `meta.assumptions` `debt`/`rentRoll`/`opex`
  (private finances) before storing. Stored in the Supabase
  `shared_reports` table (id/payload/created_at), in-memory Map +
  `shared-reports.json` file fallback, **no expiry**. Rate-limited per IP.
- `GET /api/shared?id=` — returns a published report's `{ data, meta }` (public;
  the whole point is that anyone with the link can view it). `meta.shared` is
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
- `GET /how-it-works` — the standalone proof/FAQ page, reached from the header
  nav (the old "Methodology" item) and the footer. Holds the four blocks that
  used to sit below the fold on the home page: the stat strip, the sample-report
  exhibit, the three-step Method, and the FAQ. **Server-rendered and
  self-contained** like the market pages (`HOW_CSS` — the Research Desk `rd-*`
  system re-expressed as plain class names — so it does NOT depend on the purged
  `tailwind.css`). Two things live here and nowhere else: `HOW_FAQ`, the single
  Q/A array feeding both the visible accordions and the **FAQPage JSON-LD** (it
  moved off `index.html`'s `<head>` with the copy it describes), and the sample
  exhibit's illustrative figures. The home page keeps only a one-line pointer
  strip linking here. Listed in `sitemap.xml`.
- `GET /brokers` — the broker-facing page (`renderBrokersPageHTML`), nav label
  **"Brokers"**. Holds the contribute-for-credit pitch, the owner-introduction
  offer, and what the Verified badge means — content that used to be a
  `#for-brokers` section on the landing page reachable only by a scroll-to
  button, with no URL of its own. Unlike `/how-it-works` it carries no CSS of
  its own: it renders through `marketShell()`, so `MARKET_CSS` / `MARKET_BAR` /
  `MARKET_FOOTER` style it and it likewise does NOT depend on `tailwind.css`.
  Listed in `sitemap.xml`. Its "Submit a comp" CTA links to **`/#submit-comp`**,
  a deep link `index.html` handles by opening the existing comp-submission
  modal and then clearing the hash — deliberately one form, not a second copy
  of it on this page. Do not confuse this with `GET /broker/<slug>`, the
  per-contributor public profile.
- `GET /markets`, `GET /market/<slug>` — programmatic-SEO landing pages
  (directory + one page per market, e.g. `/market/industrial-ontario-ca`).
  **Server-rendered, self-contained HTML** (own inline `<style>`, so they do
  NOT depend on the purged `tailwind.css`) built from `market-seed.json` —
  static data committed to the repo, so pages survive redeploys and serve
  instantly with no DB. Each page: median/quartile $/SF, cap-rate range, a
  market summary + `value_drivers` narrative, a recent-comps table, and a
  valuation CTA into the app. Regenerate/expand with `node gen-market-seed.js`
  (edit its `TARGETS` list; it runs one cached search per market against a
  locally-running server and keeps only markets with ≥3 priced sale comps, so
  no thin pages). `sitemap.xml` lists `/`, `/markets`, and every market page.
- `GET /admin`, `GET /api/stats` — a small analytics dashboard. Every search,
  lead, share, and comp submission is logged as a **PII-free** event (`ts`,
  `kind`, `prop_type`, `market` = city+state only, `source`, `cached`) via
  `logEvent()` → the Supabase `analytics_events` table (`analytics.jsonl` file
  fallback). `/admin` is a self-contained page (own inline CSS/JS) that fetches
  `/api/stats` with the key as an `x-admin-key` header; `/api/stats` is
  `ADMIN_KEY`-gated and returns aggregates (searches/day billed-vs-cached, cache
  hit rate, by-type, top markets, leads by source, conversion %, and
  `corpus.health` — see the corpus-health note under **Comp corpus**, which
  renders as a red banner above the tiles). **Logging is always on**; the
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
- **Accounts + My Desk** (added 2026-07-19; spec/plan in `docs/superpowers/`):
  email+password accounts with a server-synced property **portfolio**
  (value-snapshot history per re-run) and an in-app market **watchlist** whose
  updates feed reads the comp corpus. Auth is built into server.js — scrypt
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
  reader would care about does. Entries are **click-to-edit** on `/dev`:
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
  them in prose and must be edited together.
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
  Still unbuilt: report branding. `canBrand` is a real entitlement and
  `findBrandingProfile()` exists, but there is no UI at all, so the bullet stays
  off the pricing tile.
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
CSV / PNG / Print-to-PDF exporters. Contains **no secrets**.

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

3. **All valuation math is client-side; the model only supplies market
   figures.** `renderOwnerHero()` in `index.html` computes the Low/Likely/High
   range from sale-comp $/SF (leases are excluded even on mixed searches) ×
   the subject SF — the user's entry wins over the looked-up
   `subject_size_sqft`, and a looked-up size is auto-filled into the form
   input as an editable override. Since 2026-08-04 the browser also pre-fills
   an OSM footprint-derived size estimate during the address-confirm dialog
   (`maybeEstimateSize` in index.html: shoelace area × building:levels,
   `fpSize.v1` cache, gated to verified street-numbered non-Land addresses,
   labeled by `#sizeEstimateNote` and editable) — which doubles as a
   search-budget cut, since a size that rides the request skips the model's
   2-search size lookup. An Overpass outage is deliberately NOT cached as a
   miss. The prompt's PRICED BUT UNSIZED COMPS rule is the server-side
   sibling: a priced sale comp missing its size is worth one dedicated
   search, verified to lift priced-comp counts on thin markets.
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
   finances, and stay in shares. The one deliberate exception for all of
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
   excluded rows greyed as an audit trail. The "Avg $/SF" stat tile and the
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
   - **Assigning `#propertyType.value` does not fire `change`.** Every
     programmatic type change (localStorage restore, recent-search chips,
     shared-report restore, market-explorer parse) must call
     `syncSubjectFieldsToType()`, or the inputs keep the previous type's
     fields. The localStorage restore runs long after the initial paint.
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
