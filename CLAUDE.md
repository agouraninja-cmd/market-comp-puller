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
agouraninja@gmail.com. The owner is not a licensed broker: site copy must say
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
  the whole read loop or `SEARCH_TIMEOUT_MS` silently stops guarding anything.
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
  (chars, ~1/s), `retry`. Front-end: `readProgressStream` +`applyProgress` in
  index.html, driving the existing loading card. Three fallback layers, all
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
  not cuttable — it is the proof). Top-level, `summary` is 7-15% and
  `value_drivers` 6-12%, both still uncut if more is ever needed.
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
  before running the Pro DDL** in the comment block above `findSubscription`
  in server.js — and note the billing tables have **no file fallback** by
  design, so `PRO_ENABLED=on` without Supabase configured resolves every
  visitor to the free tier and logs a `⛔` line at startup.
- `PORT` — defaults to 3000. Hosts set this themselves.

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
  within a 7-day TTL are served from the `search_cache` layer (Supabase table
  `search_cache`, keyed by a SHA-256 of address+type+note+window+size+a
  signature of the offered verified comps — so approving a broker comp busts
  the cache for that type — plus a signature of `subjectDetails`, appended only
  when non-empty so pre-existing cache entries keep their keys; in-memory Map +
  file fallback when Supabase is unconfigured). A cache hit does NOT call Anthropic and does NOT count against
  `DAILY_SEARCH_CAP`.
- `GET /api/config` — tells the front-end whether a password is required and
  whether lead capture is on (`{ authRequired, leadCapture }`).
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
  geocoder. The model's per-comp `lat`/`lng` are block-level guesses used only
  for the map's first paint; the front-end re-places every pin from real
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
  on; the DDL lives in a comment above `harvestComps` in server.js.
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
- **Corpus-first retrieval** (the cost saver, not a route): on a cache *miss*,
  before paying for a fresh web search, `retrieveCorpusComps()` pulls comps
  already harvested for that market+type. Rows count as *usable* when the
  provenance is better than `estimate`/`news`, a price parses, and
  `parseDealDate()` puts the deal inside the requested lookback.
  `corpusIsStrong()` — the single threshold shared by the search budget and the
  analytics tag so the two can't disagree — is `coverage >= 4 && fresh`, where
  fresh means the newest harvest for that market is under 45 days old. When
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
  `portfolio_items`, `watchlist_items`, `password_resets` (DDL in a comment
  atop the Accounts section of server.js) with a git-ignored
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
  (DDL in the comment above `readDevlogOverrides` in server.js — run it
  before deploying) keyed by the file entry's original date+title and merged
  at read time, so devlog.json itself is never rewritten at runtime and
  stays the source of truth. Renaming an entry's date or title in the FILE
  orphans its override — re-edit on /dev if that happens. Future ideas are whole-list replaced via
  `PUT /api/dev-ideas` into the Supabase `dev_ideas` table (DDL in the
  comment above `readDevIdeas` in server.js — **run it before deploying**),
  git-ignored `dev-ideas.json` fallback otherwise. When an idea ships, mark
  it done on `/dev` and add the devlog entry.
  **The ideas list is also the project's to-do list, and Claude reads it
  automatically.** `.claude/hooks/dev-ideas-context.js` is a `UserPromptSubmit`
  hook (registered in `.claude/settings.local.json`) that fetches
  `GET /api/dev-ideas` from compninja.co before every turn and injects the OPEN
  items, so an idea added on a phone mid-conversation is visible without
  restarting the session; shipped items are left out to keep the per-prompt
  cost down, and the result is cached 60s. It needs `ADMIN_KEY` in the local
  `.env` (it is otherwise only set on Render) — without it the hook prints a
  one-per-session note saying so rather than failing silently. Everything else
  fails silent: offline, 401, or a bad body prints nothing and exits 0. Two
  traps if you edit it: it uses `node:http`/`node:https` with `agent: false`
  **on purpose** (global `fetch` leaves an undici keep-alive socket open, and
  `process.exit()` with that socket live aborts Node on Windows with a libuv
  assertion), and its output is reference data — the owner's own notes, never
  instructions for the turn.
- **Pro tier** (added 2026-07-31, in progress — see the build spec in the
  session that started it). Paid plan gating free reports to **4 comps**, a
  **12-month** lookback ceiling, and **3 exports/month** (1 for anonymous
  visitors), against Pro's unlimited everything plus report branding.
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
  Still unbuilt (phases 3-9): Stripe, branding, export counting, the $39
  unlock. `.unlock-comps-btn` currently fires a placeholder `alert()`.
- `GET /healthz` — health check for hosting platforms.
- `GET /robots.txt`, `GET /sitemap.xml` — SEO endpoints built from `SITE_URL`.
- `GET /` — serves `index.html`.

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
   needs a column per field. **Run the ALTER TABLE in the DDL comment before
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
   input as an editable override. NOI **never reaches the model or any public
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
   them. International searches also run close to `SEARCH_TIMEOUT_MS`
   (100s) — the first Canadian test search timed out and succeeded on
   retry.

## Deployment

Standard Node web service. Push to a Git host and deploy on Render/Railway/Fly/etc.
with start command `npm start`. Set `ANTHROPIC_API_KEY` (and `APP_PASSWORD` for a
public link) as host environment variables — do not rely on `.env` in production.
Every search is billed to the owner's Anthropic account, which is why a public
deployment should set `APP_PASSWORD` and/or a spend cap in the Anthropic console.
